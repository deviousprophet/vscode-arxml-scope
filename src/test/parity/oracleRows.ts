/**
 * Row oracle: the TypeScript row store for one fixture.
 *
 * Test-only. `rowParity.test.ts` compares the engine's rows with this oracle for every
 * fixture; `src/test/extension/engine.test.ts` imports it directly to cross-check the
 * live engine on one fixture. It is not imported by the extension.
 */
import { readFileSync } from 'node:fs';

import { buildRows } from '../../core/ecuc/renderRows';
import { scanEcucValues } from '../../core/ecuc/scanner';

export type OracleSort = 'all' | 'declaration';

/** The TypeScript rows for `file`, serialized as the engine returns them. */
export function oracleRows(file: string, sort: OracleSort = 'all'): string {
	const text = readFileSync(file, 'utf8');
	return JSON.stringify(buildRows(scanEcucValues(text), { sort }).rows);
}
