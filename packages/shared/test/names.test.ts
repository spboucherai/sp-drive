import { describe, expect, it } from 'vitest';
import { extOf, nameKey, nextFreeName, previewKind, safePathSegments, sanitizeName, splitExt } from '../src/index.ts';

describe('sanitizeName', () => {
  it('neutralises paths, control characters and reserved names', () => {
    expect(sanitizeName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(sanitizeName('..')).toBe('sans-nom');
    expect(sanitizeName('.htaccess')).toBe('htaccess');
    expect(sanitizeName('a\u0000b\nc.txt')).toBe('a_b_c.txt');
    expect(sanitizeName('C:\\Windows\\cmd.exe')).toBe('C__Windows_cmd.exe');
    expect(sanitizeName('CON.txt')).toBe('_CON.txt');
    expect(sanitizeName('  rapport final .pdf.  ')).toBe('rapport final .pdf');
    expect(sanitizeName('facture\u202Efdp.exe')).toBe('facture_fdp.exe'); // right-to-left override trick
    expect(sanitizeName('')).toBe('sans-nom');
  });
  it('never returns a separator or a name over 255 bytes', () => {
    const long = sanitizeName(`${'é'.repeat(400)}.pdf`);
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(255);
    expect(long.endsWith('.pdf')).toBe(true);
    for (const raw of ['a/b', 'a\\b', '/abs', '~/x', 'x/../../y']) expect(sanitizeName(raw)).not.toMatch(/[/\\]/);
  });
  it('normalises Unicode so two spellings of one name collide', () => {
    expect(nameKey(sanitizeName('Cafe\u0301.TXT'))).toBe(nameKey(sanitizeName('Café.txt')));
  });
});
describe('names', () => {
  it('splits extensions', () => {
    expect(splitExt('archive.tar.gz')).toEqual(['archive', '.tar.gz']);
    expect(splitExt('README')).toEqual(['README', '']);
    expect(extOf('Photo.HEIC')).toBe('heic');
  });
  it('finds the next free name', () => {
    const taken = new Set(['a.txt', 'a (2).txt']);
    expect(nextFreeName('a.txt', (k) => taken.has(k))).toBe('a (3).txt');
    expect(nextFreeName('b.txt', (k) => taken.has(k))).toBe('b.txt');
  });
  it('keeps relative paths inside the tree', () => {
    expect(safePathSegments('../../a/./b/../c.txt')).toEqual(['a', 'b', 'c.txt']);
    expect(safePathSegments('/etc/passwd')).toEqual(['etc', 'passwd']);
  });
  it('classifies previews by name', () => {
    expect(previewKind('x.pdf')).toBe('pdf'); expect(previewKind('x.HEIC')).toBe('heic'); expect(previewKind('x.tar.gz')).toBe('archive');
    expect(previewKind('x.gz')).toBe('none'); expect(previewKind('x.docx')).toBe('office'); expect(previewKind('x.xlsx')).toBe('sheet'); expect(previewKind('x.bin')).toBe('none');
  });
});
