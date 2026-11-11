#!/bin/bash
# Regenerates the preview fixtures (macOS: sips, ffmpeg, LibreOffice; exceljs from services/api). Run from anywhere.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../../.. && pwd)"
SOFFICE=/Applications/LibreOffice.app/Contents/MacOS/soffice
FFMPEG=/opt/homebrew/bin/ffmpeg
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# PDF: 3 pages, the word "marmotte" 5 times (2 + 1 + 2)
node --input-type=module -e "
import { writeFileSync } from 'node:fs';
import { makePdf } from './pdf-gen.mjs';
writeFileSync('sample.pdf', makePdf([
  ['SP Drive - page un', 'La marmotte dort sous la neige.', 'Une autre Marmotte veille pres du terrier.'],
  ['SP Drive - page deux', 'Le castor construit un barrage.', 'La marmotte observe le castor.'],
  ['SP Drive - page trois', 'Derniere page du document.', 'MARMOTTE et marmotte, encore.'],
]));"

# images: PNG and JPEG drawn by ffmpeg, HEIC by sips
"$FFMPEG" -loglevel error -y -f lavfi -i "testsrc2=size=320x240:rate=1" -frames:v 1 sample.png
"$FFMPEG" -loglevel error -y -f lavfi -i "smptebars=size=640x360:rate=1" -frames:v 1 -q:v 4 sample.jpg
sips -s format heic sample.png --out sample.heic >/dev/null

# SVG that tries to run script three ways
cat > hostile.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 120" width="200" height="120" onload="window.__pwned = 1; fetch('/api/v1/__pwned?via=svg-onload')">
  <rect width="200" height="120" fill="#2456e6"/>
  <circle cx="100" cy="60" r="36" fill="#ffd34d"/>
  <script>window.__pwned = 1; top.__pwned = 1; fetch('/api/v1/__pwned?via=svg-script');</script>
  <image href="/api/v1/__pwned?via=svg-image" width="1" height="1"/>
  <foreignObject width="1" height="1"><img xmlns="http://www.w3.org/1999/xhtml" src="x" onerror="window.__pwned = 1"/></foreignObject>
</svg>
SVG

# video and audio: one second each
"$FFMPEG" -loglevel error -y -f lavfi -i "testsrc2=size=320x180:rate=15" -f lavfi -i "sine=frequency=440:sample_rate=44100" -t 1 -c:v libx264 -pix_fmt yuv420p -profile:v baseline -c:a aac -b:a 48k -movflags +faststart sample.mp4
"$FFMPEG" -loglevel error -y -f lavfi -i "sine=frequency=523:sample_rate=44100" -t 1 -c:a libmp3lame -b:a 48k sample.mp3

# text family
printf 'Premiere ligne\nDeuxieme ligne avec une tres longue suite de mots pour verifier le retour a la ligne dans la visionneuse de texte de SP Drive, encore et encore et encore, puis encore une fois pour depasser la largeur d un grand ecran de bureau sans le moindre doute possible, et un peu plus loin pour faire bonne mesure.\n\n<script>window.__pwned = 1</script>\n\tindentation\nDerniere ligne\n' > sample.txt
cat > hostile.md <<'MD'
# Titre du document

Un paragraphe avec du **gras**, de l'*italique* et du `code`.

<script>window.__pwned = 1; fetch('/api/v1/__pwned?via=md-script');</script>

<img src="x" onerror="window.__pwned = 1">

<iframe src="javascript:parent.__pwned = 1"></iframe>

[lien piege](javascript:window.__pwned=1) et [lien sain](https://example.org/page).

<a href="javascript:window.__pwned=1" onclick="window.__pwned=1">ancre brute</a>

![image distante](/api/v1/__pwned?via=md-image)

<div style="background:url(/api/v1/__pwned?via=md-style)">style</div>

- un
- deux

| A | B |
|---|---|
| 1 | 2 |
MD
printf 'nom,ville,note\r\n"Tremblay, Luc",Gatineau,"Il a dit ""bonjour"""\r\n"Roy; Anne","Québec","ligne 1\nligne 2"\r\nSimple,Hull,ok\r\n' > sample.csv
printf 'nom;montant\n"Gagnon; Paul";12,50\nCote;7,25\n' > semicolon.csv
cat > sample.json <<'JSON'
{"titre": "SP Drive", "version": 3, "actif": true, "vide": null, "tags": ["alpha", "beta"], "auteur": {"nom": "Marmotte", "contact": {"ville": "Gatineau"}}}
JSON
printf '{"cassé": [1, 2, \n' > broken.json
cat > sample.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<catalogue><livre id="1"><titre>Le castor</titre></livre><script>window.__pwned = 1</script></catalogue>
XML

# office documents through LibreOffice
cat > "$TMP/lettre.html" <<'HTML'
<html><body><h1>Rapport Castor</h1><p>Ce document Word contient le mot ornithorynque.</p></body></html>
HTML
"$SOFFICE" --headless --convert-to 'docx:MS Word 2007 XML' --outdir "$TMP" "$TMP/lettre.html" >/dev/null 2>&1
cp "$TMP/lettre.docx" sample.docx
cat > "$TMP/diapos.fodp" <<'FODP'
<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.presentation">
  <office:body><office:presentation>
    <draw:page draw:name="un"><draw:frame svg:x="2cm" svg:y="2cm" svg:width="20cm" svg:height="3cm"><draw:text-box><text:p>Diapositive Quokka</text:p></draw:text-box></draw:frame></draw:page>
    <draw:page draw:name="deux"><draw:frame svg:x="2cm" svg:y="2cm" svg:width="20cm" svg:height="3cm"><draw:text-box><text:p>Seconde diapositive</text:p></draw:text-box></draw:frame></draw:page>
  </office:presentation></office:body>
</office:document>
FODP
"$SOFFICE" --headless --convert-to pptx --outdir "$TMP" "$TMP/diapos.fodp" >/dev/null 2>&1
cp "$TMP/diapos.pptx" sample.pptx

# a PDF that needs a password to open ("secret")
echo '<html><body><p>secret castor</p></body></html>' > "$TMP/locked.html"
"$SOFFICE" --headless --convert-to 'pdf:writer_web_pdf_Export:{"EncryptFile":{"type":"boolean","value":"true"},"DocumentOpenPassword":{"type":"string","value":"secret"}}' --outdir "$TMP" "$TMP/locked.html" >/dev/null 2>&1
cp "$TMP/locked.pdf" locked.pdf

# workbook with two sheets (exceljs lives in services/api)
(cd "$ROOT/services/api" && OUT="$OLDPWD/sample.xlsx" node --input-type=module -e "
import ExcelJS from 'exceljs';
const wb = new ExcelJS.Workbook();
const a = wb.addWorksheet('Ventes');
a.addRow(['Produit', 'Quantite', 'Prix']); a.addRow(['Sirop', 12, 8.5]); a.addRow(['Tuque', 3, 24]); a.addRow(['Total', { formula: 'B2+B3', result: 15 }, '']);
const b = wb.addWorksheet('Clients');
b.addRow(['Nom', 'Ville']); b.addRow(['Castor Bricoleur', 'Gatineau']);
await wb.xlsx.writeFile(process.env.OUT);")

# archives with nested paths
mkdir -p "$TMP/arc/docs/notes/2026" "$TMP/arc/images"
echo 'bonjour' > "$TMP/arc/lisezmoi.txt"; echo 'note profonde' > "$TMP/arc/docs/notes/2026/secret.txt"; echo 'rapport' > "$TMP/arc/docs/rapport.txt"; cp sample.png "$TMP/arc/images/photo.png"
(cd "$TMP/arc" && zip -qr "$OLDPWD/sample.zip" . -x '.*' && COPYFILE_DISABLE=1 tar czf "$OLDPWD/sample.tar.gz" lisezmoi.txt docs images)

# an unsupported type
head -c 2048 /dev/urandom > sample.bin
ls -la
