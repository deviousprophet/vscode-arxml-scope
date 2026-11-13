/**
 * Row oracle: the TypeScript row store for one fixture.
 *
 * Test-only. `scripts/parityRows.mjs` bundles this module as an entry and compares
 * its output with `arxml-cli rows`; `src/test/extension/engine.test.ts` imports
 * `oracleRows` directly to cross-check the live engine on one fixture. It is not
 * imported by the extension.
 */
import { readFileSync } from 'node:fs';

import { buildRows } from '../../core/ecuc/renderRows';
import { scanEcucValues } from '../../core/ecuc/scanner';

export type OracleSort = 'all' | 'declaration';

/** The TypeScript rows for `file`, serialized exactly as the CLI prints them. */
export function oracleRows(file: string, sort: OracleSort = 'all'): string {
	const text = readFileSync(file, 'utf8');
	return JSON.stringify(buildRows(scanEcucValues(text), { sort }).rows);
}

/** True when the bundled module is the process entry point, not an import. */
function isEntryPoint(): boolean {
	return (process.argv[1] ?? '').replaceAll('\\', '/').endsWith('/oracleRows.cjs');
}

if (isEntryPoint()) {
	const sort = (process.argv[3] ?? 'all') as OracleSort;
	process.stdout.write(oracleRows(process.argv[2], sort));
}
