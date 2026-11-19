// spd-textkit — local text extraction, OCR, perceptual hashing and sentence embeddings for SP Drive.
//
// Compiled on the node by scripts/textkit-build.sh (Command Line Tools are enough) and only ever started by the worker
// inside the sandbox-exec profile of services/api/src/tools.ts: no network, no access to the home directory, one
// decrypted input file in a private work directory. Nothing here talks to a server; Apple's on-device frameworks only.
//
//   spd-textkit probe
//   spd-textkit extract <input> <output.json> [--max-pages N] [--ocr on|off] [--ocr-max-pages N] [--max-chars N] [--langs fr-FR,en-US]
//   spd-textkit dhash <image> [--max-pixels N]
//   spd-textkit embed <input.json> <output.json> [--model sentence|contextual]
import AppKit
import CoreGraphics
import Foundation
import ImageIO
import NaturalLanguage
import PDFKit
import Vision

setvbuf(stdout, nil, _IONBF, 0)
func fail(_ message: String, code: Int32 = 1) -> Never { FileHandle.standardError.write((message + "\n").data(using: .utf8)!); exit(code) }
func writeJSON(_ object: Any, to path: String) {
  guard let data = try? JSONSerialization.data(withJSONObject: object, options: []) else { fail("cannot encode the result") }
  do { try data.write(to: URL(fileURLWithPath: path), options: .atomic) } catch { fail("cannot write \(path): \(error.localizedDescription)") }
}
func option(_ name: String, _ args: [String]) -> String? { if let i = args.firstIndex(of: "--\(name)"), i + 1 < args.count { return args[i + 1] }; return nil }

// --- OCR -----------------------------------------------------------------------------------------------------
func recognise(_ image: CGImage, langs: [String]) -> String {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  request.recognitionLanguages = langs
  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  do { try handler.perform([request]) } catch { FileHandle.standardError.write("ocr: \(error.localizedDescription)\n".data(using: .utf8)!); return "" }
  let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
  return lines.joined(separator: "\n")
}
/** Largest picture (in pixels) that is ever decoded; set by --max-pixels. A tiny file can declare a gigapixel image. */
var maxPixels = 120_000_000
func loadImage(_ path: String, maxPixel: Int) -> CGImage? {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { return nil }
  // the declared size is read from the header, before any pixel is decoded
  guard let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
        let w = (props[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue, let h = (props[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue, w > 0, h > 0 else { return nil }
  if w > 100_000 || h > 100_000 || w * h > maxPixels { fail("image too large to decode (\(w) x \(h) pixels)", code: 4) }
  let opts: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: maxPixel]
  guard let img = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
  return flatten(img)
}
/** Transparent pixels become white (a PNG of black text on a clear background would otherwise read as a black page). */
func flatten(_ img: CGImage) -> CGImage {
  switch img.alphaInfo { case .none, .noneSkipFirst, .noneSkipLast: return img; default: break }
  guard let ctx = CGContext(data: nil, width: img.width, height: img.height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return img }
  let r = CGRect(x: 0, y: 0, width: img.width, height: img.height)
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); ctx.fill(r); ctx.draw(img, in: r)
  return ctx.makeImage() ?? img
}
/** A PDF page as a bitmap, about 200 dpi, bounded so a poster-sized page cannot exhaust memory. */
func render(_ page: PDFPage) -> CGImage? {
  let box = page.bounds(for: .mediaBox)
  guard box.width > 1, box.height > 1 else { return nil }
  let scale = min(200.0 / 72.0, 3400.0 / max(box.width, box.height))
  let w = Int(box.width * scale), h = Int(box.height * scale)
  guard w > 0, h > 0, let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.scaleBy(x: scale, y: scale)
  ctx.translateBy(x: -box.origin.x, y: -box.origin.y)
  page.draw(with: .mediaBox, to: ctx)
  return ctx.makeImage()
}

// --- extract -------------------------------------------------------------------------------------------------
func extract(_ args: [String]) {
  guard args.count >= 2 else { fail("usage: extract <input> <output.json>", code: 2) }
  let input = args[0], output = args[1]
  let maxPages = Int(option("max-pages", args) ?? "") ?? 500
  let ocr = (option("ocr", args) ?? "on") == "on"
  let ocrMaxPages = Int(option("ocr-max-pages", args) ?? "") ?? 60
  let maxChars = Int(option("max-chars", args) ?? "") ?? 2_000_000
  let langs = (option("langs", args) ?? "fr-FR,en-US").split(separator: ",").map(String.init)
  var pages: [[String: Any]] = []
  var total = 0, ocrPages = 0, textPages = 0, truncated = false, pageCount = 0
  let ext = (input as NSString).pathExtension.lowercased()
  if ext == "pdf" {
    guard let doc = PDFDocument(url: URL(fileURLWithPath: input)) else { fail("unreadable PDF", code: 3) }
    if doc.isLocked { writeJSON(["kind": "pdf", "locked": true, "pageCount": doc.pageCount, "pages": [], "ocrPages": 0, "textPages": 0, "truncated": false], to: output); return }
    pageCount = doc.pageCount
    for i in 0..<min(pageCount, maxPages) {
      if total >= maxChars { truncated = true; break }
      autoreleasepool {
        guard let page = doc.page(at: i) else { return }
        var text = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        var viaOcr = false
        // a page with (almost) no text layer is a scan: read it with Vision
        if text.count < 16 && ocr && ocrPages < ocrMaxPages, let img = render(page) {
          let seen = recognise(img, langs: langs).trimmingCharacters(in: .whitespacesAndNewlines)
          if seen.count > text.count { text = seen; viaOcr = true }
          ocrPages += 1
        }
        if text.isEmpty { return }
        if total + text.count > maxChars { text = String(text.prefix(maxChars - total)); truncated = true }
        total += text.count
        if viaOcr { } else { textPages += 1 }
        pages.append(["page": i + 1, "text": text, "ocr": viaOcr])
      }
    }
    if pageCount > maxPages { truncated = true }
    let ocrUsed = pages.contains { ($0["ocr"] as? Bool) == true }
    writeJSON(["kind": "pdf", "locked": false, "pageCount": pageCount, "pages": pages, "ocrPages": ocrPages, "textPages": textPages, "truncated": truncated,
               "source": ocrUsed ? (textPages > 0 ? "pdf-text+ocr" : "ocr") : "pdf-text"], to: output)
    return
  }
  // an image: OCR is the only source of text
  guard ocr else { writeJSON(["kind": "image", "pageCount": 1, "pages": [], "ocrPages": 0, "textPages": 0, "truncated": false, "source": "ocr"], to: output); return }
  guard let img = loadImage(input, maxPixel: 4096) else { fail("unreadable image", code: 3) }
  var text = recognise(img, langs: langs).trimmingCharacters(in: .whitespacesAndNewlines)
  if text.count > maxChars { text = String(text.prefix(maxChars)); truncated = true }
  if !text.isEmpty { pages.append(["page": 1, "text": text, "ocr": true]) }
  writeJSON(["kind": "image", "pageCount": 1, "pages": pages, "ocrPages": 1, "textPages": 0, "truncated": truncated, "source": "ocr"], to: output)
}

// --- dhash: 64-bit difference hash (9×8 greyscale, each bit = "left pixel brighter than its right neighbour") -----
func dhash(_ args: [String]) {
  guard let path = args.first, let img = loadImage(path, maxPixel: 512) else { fail("unreadable image", code: 3) }
  let w = 9, h = 8
  var px = [UInt8](repeating: 0, count: w * h)
  guard let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { fail("no bitmap context") }
  ctx.interpolationQuality = .high
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
  var bits: UInt64 = 0
  for y in 0..<h { for x in 0..<(w - 1) { bits = (bits << 1) | (px[y * w + x] > px[y * w + x + 1] ? 1 : 0) } }
  print(String(format: "%016llx", bits))
}

// --- embeddings ----------------------------------------------------------------------------------------------
func language(of text: String) -> NLLanguage {
  let r = NLLanguageRecognizer(); r.languageConstraints = [.french, .english]; r.processString(String(text.prefix(2000)))
  return r.dominantLanguage ?? .french
}
func normalise(_ v: [Double]) -> [Double] { let n = (v.reduce(0) { $0 + $1 * $1 }).squareRoot(); return n > 0 ? v.map { $0 / n } : v }
var sentenceModels: [NLLanguage: NLEmbedding] = [:]
func sentenceModel(_ l: NLLanguage) -> NLEmbedding? { if let m = sentenceModels[l] { return m }; let m = NLEmbedding.sentenceEmbedding(for: l); if let m { sentenceModels[l] = m }; return m }
var contextual: NLContextualEmbedding?
func contextualModel() -> NLContextualEmbedding? {
  if let c = contextual { return c }
  guard let m = NLContextualEmbedding(language: .french) ?? NLContextualEmbedding(script: .latin) else { return nil }
  guard m.hasAvailableAssets else { return nil }
  do { try m.load() } catch { return nil }
  contextual = m; return m
}
func contextualVector(_ text: String, lang: NLLanguage) -> [Double]? {
  guard let m = contextualModel(), let r = try? m.embeddingResult(for: text, language: lang) else { return nil }
  var sum = [Double](repeating: 0, count: m.dimension), n = 0
  r.enumerateTokenVectors(in: text.startIndex..<text.endIndex) { v, _ in for i in 0..<min(v.count, sum.count) { sum[i] += v[i] }; n += 1; return true }
  return n > 0 ? normalise(sum.map { $0 / Double(n) }) : nil
}
func embed(_ args: [String]) {
  guard args.count >= 2, let data = FileManager.default.contents(atPath: args[0]), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let texts = obj["texts"] as? [[String: Any]] else { fail("usage: embed <input.json> <output.json>", code: 2) }
  let model = option("model", args) ?? "sentence"
  var rows: [String] = [], dim = 0
  for t in texts {
    let text = String((t["text"] as? String ?? "").prefix(4000))
    let lang = (t["lang"] as? String).flatMap { $0 == "en" ? NLLanguage.english : $0 == "fr" ? NLLanguage.french : nil } ?? language(of: text)
    let code = lang == .english ? "en" : "fr"
    var vector: [Double]?
    if model == "contextual" { vector = contextualVector(text, lang: lang) }
    else if let m = sentenceModel(lang), let v = m.vector(for: text) { vector = normalise(v) }
    if let v = vector { dim = v.count; rows.append("{\"lang\":\"\(code)\",\"vector\":[" + v.map { String(format: "%.5f", $0) }.joined(separator: ",") + "]}") }
    else { rows.append("{\"lang\":\"\(code)\",\"vector\":null}") }
  }
  // written by hand: JSONSerialization prints a Double with seventeen digits, five are plenty for a cosine
  let json = "{\"model\":\"\(model == "contextual" ? "contextual" : "sentence")\",\"dim\":\(dim),\"vectors\":[" + rows.joined(separator: ",") + "]}"
  do { try json.data(using: .utf8)!.write(to: URL(fileURLWithPath: args[1]), options: .atomic) } catch { fail("cannot write \(args[1])") }
}

func probe() {
  var info: [String: Any] = ["ok": true, "vision": true, "pdfkit": true]
  info["ocrLanguages"] = (try? VNRecognizeTextRequest().supportedRecognitionLanguages()) ?? []
  info["sentence"] = ["fr": NLEmbedding.sentenceEmbedding(for: .french)?.dimension ?? 0, "en": NLEmbedding.sentenceEmbedding(for: .english)?.dimension ?? 0]
  if let c = NLContextualEmbedding(language: .french) ?? NLContextualEmbedding(script: .latin) {
    info["contextual"] = ["identifier": c.modelIdentifier, "dimension": c.dimension, "assets": c.hasAvailableAssets]
  } else { info["contextual"] = NSNull() }
  let data = try! JSONSerialization.data(withJSONObject: info, options: [.sortedKeys])
  print(String(data: data, encoding: .utf8)!)
}

let argv = Array(CommandLine.arguments.dropFirst())
if let m = option("max-pixels", argv), let n = Int(m), n > 0 { maxPixels = n }
switch argv.first {
case "probe": probe()
case "extract": extract(Array(argv.dropFirst()))
case "dhash": dhash(Array(argv.dropFirst()))
case "embed": embed(Array(argv.dropFirst()))
default: fail("usage: spd-textkit probe | extract | dhash | embed", code: 2)
}
