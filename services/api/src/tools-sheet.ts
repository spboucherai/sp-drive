/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : services/api/src/tools-sheet.ts
 * Module           : services
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-11
 * Last Modified    : 2026-11-11
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: support@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

// XLSX reader used only inside the sandboxed child process (no configuration, no database).
export interface SheetPreview { sheets: { name: string; rows: string[][]; totalRows: number; totalColumns: number; truncated: boolean }[]; truncatedSheets: boolean }
const MAX_SHEETS = 30, MAX_ROWS = 1000, MAX_COLS = 60, MAX_CELL = 500;
/** Body of the child process started by sheetPreview (sheet-child.ts). */
export async function sheetChild(input: string, output: string): Promise<void> {
  const { default: ExcelJS } = await import('exceljs');
  const { writeFile } = await import('node:fs/promises');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(input);
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().replace('T00:00:00.000Z', '');
    if (typeof v === 'object') {
      const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[]; error?: unknown; hyperlink?: unknown };
      if (o.richText) return o.richText.map((t) => t.text).join('');
      if ('result' in o) return cell(o.result);
      if ('text' in o) return cell(o.text);
      if ('error' in o) return String(o.error);
      return '';
    }
    return String(v);
  };
  const sheets = wb.worksheets.slice(0, MAX_SHEETS).map((ws) => {
    const rows: string[][] = [];
    const cols = Math.min(ws.columnCount, MAX_COLS);
    for (let r = 1; r <= Math.min(ws.rowCount, MAX_ROWS); r++) {
      const row = ws.getRow(r);
      rows.push(Array.from({ length: cols }, (_, c) => cell(row.getCell(c + 1).value).slice(0, MAX_CELL)));
    }
    return { name: ws.name, rows, totalRows: ws.rowCount, totalColumns: ws.columnCount, truncated: ws.rowCount > MAX_ROWS || ws.columnCount > MAX_COLS };
  });
  await writeFile(output, JSON.stringify({ sheets, truncatedSheets: wb.worksheets.length > MAX_SHEETS } satisfies SheetPreview));
}
