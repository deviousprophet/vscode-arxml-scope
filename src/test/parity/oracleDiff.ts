/**
 * Parity oracle: prints the TypeScript strict diff for two files as JSON.
 *
 * Test-only. `scripts/parityDiff.mjs` bundles this entry and compares it with
 * `arxml-cli diff --left … --right …`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { buildNodeIndex } from '../../core/ecuc/nodeId';
import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { buildRows } from '../../core/ecuc/renderRows';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { buildDiffDocument } from '../../core/diff/diffModel';
import { documentHeader } from '../../webviewProtocol';

function side(file: string) {
	const model = scanEcucValues(readFileSync(file, 'utf8'));
	const index = buildNodeIndex(model);
	const rows = buildRows(model, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows;
	return { model, index, rows };
}

const leftFile = process.argv[2];
const rightFile = process.argv[3];
const left = side(leftFile);
const right = side(rightFile);
const document = buildDiffDocument(
	{ name: path.basename(leftFile), path: leftFile.replaceAll('\\', '/') },
	{ name: path.basename(rightFile), path: rightFile.replaceAll('\\', '/') },
	left.rows,
	right.rows,
	(id) => left.index.byId.get(id)?.range,
	(id) => right.index.byId.get(id)?.range,
	{ left: documentHeader(left.model), right: documentHeader(right.model) },
	{ semanticMatching: false }
);
process.stdout.write(JSON.stringify(document));
