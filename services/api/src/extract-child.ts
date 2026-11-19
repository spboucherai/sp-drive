// Entry point of the sandboxed child process that reads text out of text, HTML and zip-based office files.
import { extractChild } from './textextract.ts';

await extractChild(process.argv.slice(2));
