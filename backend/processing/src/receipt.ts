import fs from 'node:fs';
import { parseRows } from './parse';
import { boxesToRows, parseRowsText, serializeRows } from './rows';
const input = fs.readFileSync(0, 'utf8');
if (Buffer.byteLength(input) > 4 * 1024 * 1024) throw new Error('processing_output_limit');
const mode = process.argv[2];
if (mode === 'rows') {
  process.stdout.write(JSON.stringify(parseRows(parseRowsText(input))));
} else if (mode === 'boxes') {
  const rows = boxesToRows(JSON.parse(input));
  process.stdout.write(JSON.stringify({ parsed: parseRows(rows), rowsText: serializeRows(rows) }));
} else {
  throw new Error('explicit_extraction_mode_required');
}
