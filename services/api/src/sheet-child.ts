// Child process of the worker: reads one workbook, writes one JSON file, exits. Runs sandboxed with a bounded heap.
import { sheetChild } from './tools-sheet.ts';
const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('usage: sheet-child <input.xlsx> <output.json>'); process.exit(2); }
sheetChild(input, output).then(() => process.exit(0), (e) => { console.error(String(e?.message ?? e)); process.exit(1); });
