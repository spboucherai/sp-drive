// A minimal PDF writer for tests: one text page per entry (lines of ASCII text, Helvetica, US Letter).
// `padding` adds that many bytes of filler per page, to obtain files large enough for Range loading.
export function makePdf(pages, { padding = 0 } = {}) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const catalog = add(''), tree = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (const lines of pages) {
    const text = ['BT', '/F1 14 Tf', '72 720 Td', '20 TL', ...lines.map((l) => `(${esc(l)}) Tj T*`), 'ET'].join('\n') + (padding ? `\n%${'x'.repeat(padding)}` : '');
    const content = add(`<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objects[tree - 1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] >>`;
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
