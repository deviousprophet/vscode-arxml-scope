/**
 * Parity oracle: prints the TypeScript rows for one file as JSON.
 *
 * Test-only. `scripts/parityRows.mjs` bundles this entry with esbuild, runs it, and
 * compares the output with `arxml-cli rows --json`. It is not imported by the
 * extension.
 */
import { readFileSync } from 'node:fs';

import { buildRows } from '../../core/ecuc/renderRows';
import { scanEcucValues } from '../../core/ecuc/scanner';

const file = process.argv[2];
const sort = (process.argv[3] ?? 'all') as 'all' | 'declaration';
const text = readFileSync(file, 'utf8');
const rows = buildRows(scanEcucValues(text), { sort }).rows;
process.stdout.write(JSON.stringify(rows));
