/**
 * The semantic body adapter behind the Monaco diff decorations.
 *
 * The adapter must never invent a side: a row's line numbers and block lines
 * come from the same aligned synthetic documents Monaco renders, and a missing
 * side reports no line at all so a placeholder can never be painted.
 */
import * as assert from 'assert';

import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { scanEcucValues } from '../../core/ecuc/scanner';
import {
	buildDiffDocument,
	type DiffDocument,
	type DiffRow,
} from '../../core/diff/diffModel';
import { buildNodeIndex } from '../../core/ecuc/nodeId';
import { buildRows, type EcucRow } from '../../core/ecuc/renderRows';
import {
	buildAlignedSyntheticDocuments,
	type AlignedSyntheticDocuments,
} from '../../webview/monaco/synthetic';
import {
	buildDiffBody,
	lineOnSide,
	linesOnSide,
	mergeSourceSide,
	owningSides,
	type DiffBodyRow,
} from '../../webview/monaco/diffBody';
import { fixtureText } from '../core/modelTestUtils';

interface Side {
	rows: EcucRow[];
	rangeOf: (id: string) => { start: number; end: number } | undefined;
}

function side(text: string): Side {
	const model = scanEcucValues(text);
	const index = buildNodeIndex(model);
	const rows = buildRows(model, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows;
	return { rows, rangeOf: (id) => index.byId.get(id)?.range };
}

function alignedPair(leftText: string, rightText: string, semantic = true): {
	document: DiffDocument;
	aligned: AlignedSyntheticDocuments;
} {
	const left = side(leftText);
	const right = side(rightText);
	const document = buildDiffDocument(
		{ name: 'left.arxml', path: '/work/left.arxml' },
		{ name: 'right.arxml', path: '/work/right.arxml' },
		left.rows,
		right.rows,
		left.rangeOf,
		right.rangeOf,
		{ left: { packages: ['Pkg'] }, right: { packages: ['Pkg'] } },
		{ semanticMatching: semantic }
	);
	return { document, aligned: buildAlignedSyntheticDocuments(document) };
}

function rowWithStatus(document: DiffDocument, status: DiffRow['status']): DiffRow {
	const row = document.rows.find((candidate) => candidate.status === status);
	assert.ok(row, `a ${status} row exists`);
	return row!;
}

function bodyRow(document: DiffDocument, aligned: AlignedSyntheticDocuments, key: string): DiffBodyRow {
	const body = buildDiffBody(document, aligned);
	const row = body.byKey.get(key);
	assert.ok(row, `the body has row ${key}`);
	return row!;
}

function assertLeftLines(aligned: AlignedSyntheticDocuments, row: DiffBodyRow): void {
	for (const line of row.leftLines) {
		assert.ok(line >= 1 && line <= aligned.left.lines.length, `left line ${line} is in the model`);
		assert.strictEqual(aligned.leftLineKeys[line - 1], row.key);
	}
}

function assertRightLines(aligned: AlignedSyntheticDocuments, row: DiffBodyRow): void {
	for (const line of row.rightLines) {
		assert.ok(line >= 1 && line <= aligned.right.lines.length, `right line ${line} is in the model`);
		assert.strictEqual(aligned.rightLineKeys[line - 1], row.key);
	}
}

suite('diff body adapter', () => {
	test('every merged row keeps its semantic status and changes', () => {
		const { document, aligned } = alignedPair(fixtureText('diff/left.arxml'), fixtureText('diff/right.arxml'));
		const body = buildDiffBody(document, aligned);
		assert.strictEqual(body.rows.length, document.rows.length);
		for (const row of body.rows) {
			assert.strictEqual(row.status, document.rows.find((candidate) => candidate.key === row.key)?.status);
			assert.deepStrictEqual(row.changes, document.rows.find((candidate) => candidate.key === row.key)?.changes);
			assert.strictEqual(body.byKey.get(row.key), row);
		}
	});

	test('a changed row owns both sides and the node line is the aligned line', () => {
		const { document, aligned } = alignedPair(fixtureText('diff/left.arxml'), fixtureText('diff/right.arxml'));
		const changed = rowWithStatus(document, 'changed');
		const row = bodyRow(document, aligned, changed.key);
		assert.deepStrictEqual(owningSides(row), ['left', 'right']);
		assert.strictEqual(row.leftLine, aligned.left.rowLine.get(changed.key));
		assert.strictEqual(row.rightLine, aligned.right.rowLine.get(changed.key));
		assert.strictEqual(lineOnSide(row, 'left'), row.leftLine);
		assert.strictEqual(lineOnSide(row, 'right'), row.rightLine);
		assert.ok(row.changes.length > 0, 'the changed row carries its semantic fields');
		assert.ok(row.leftLines.includes(row.leftLine!), 'the block lines include the node line');
		assert.ok(row.rightLines.includes(row.rightLine!), 'the block lines include the node line');
	});

	test('an added row has no left line and no placeholder block', () => {
		const { document, aligned } = alignedPair(fixtureText('diff/left.arxml'), fixtureText('diff/right.arxml'));
		const added = rowWithStatus(document, 'added');
		const row = bodyRow(document, aligned, added.key);
		assert.deepStrictEqual(owningSides(row), ['right']);
		assert.strictEqual(row.leftCell, undefined);
		assert.strictEqual(row.leftLine, undefined);
		assert.deepStrictEqual(row.leftLines, []);
		assert.deepStrictEqual(linesOnSide(row, 'left'), []);
		assert.ok(row.rightLine !== undefined);
		assert.ok(row.rightLines.length > 1, 'a container block owns its brace lines too');
	});

	test('a removed row mirrors the added row', () => {
		const { document, aligned } = alignedPair(fixtureText('diff/left.arxml'), fixtureText('diff/right.arxml'));
		const removed = rowWithStatus(document, 'removed');
		const row = bodyRow(document, aligned, removed.key);
		assert.deepStrictEqual(owningSides(row), ['left']);
		assert.strictEqual(row.rightCell, undefined);
		assert.strictEqual(row.rightLine, undefined);
		assert.deepStrictEqual(row.rightLines, []);
		assert.ok(row.leftLine !== undefined);
		assert.ok(row.leftLines.length > 1);
	});

	test('merge clicks keep the existing copy/delete source rule', () => {
		const { document, aligned } = alignedPair(fixtureText('diff/left.arxml'), fixtureText('diff/right.arxml'));
		const added = bodyRow(document, aligned, rowWithStatus(document, 'added').key);
		assert.strictEqual(mergeSourceSide(added, 'left'), 'right');
		assert.strictEqual(mergeSourceSide(added, 'right'), 'right');
		const removed = bodyRow(document, aligned, rowWithStatus(document, 'removed').key);
		assert.strictEqual(mergeSourceSide(removed, 'left'), 'left');
		assert.strictEqual(mergeSourceSide(removed, 'right'), 'left');
		const changed = bodyRow(document, aligned, rowWithStatus(document, 'changed').key);
		assert.strictEqual(mergeSourceSide(changed, 'left'), 'left');
		assert.strictEqual(mergeSourceSide(changed, 'right'), 'right');
	});

	test('a semantic pair is marked renamed only when it changed', () => {
		const left = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0"><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS>
<ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/M</DEFINITION-REF><CONTAINERS>
<ECUC-CONTAINER-VALUE><SHORT-NAME>NMH_RENAMED</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/D/Renamed</DEFINITION-REF>
<PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/D/Renamed/Value</DEFINITION-REF><VALUE>1</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES>
</ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES>
</ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const right = left.replaceAll('NMH_RENAMED', 'NM_RENAMED');
		const { document, aligned } = alignedPair(left, right);
		const renamed = document.rows.filter((row) => row.status === 'changed' && row.match?.kind === 'semantic');
		assert.ok(renamed.length > 0, 'the semantic pass paired the renamed container');
		const body = buildDiffBody(document, aligned);
		assert.ok(body.rows.some((row) => row.renamed), 'the body marks the semantic pair');
		assert.ok(
			body.rows
				.filter((row) => row.status !== 'changed')
				.every((row) => !row.renamed),
			'an unchanged semantic pair is not a rename'
		);
	});

	test('block line numbers stay inside the aligned models', () => {
		const { document, aligned } = alignedPair(fixtureText('diff/left.arxml'), fixtureText('diff/right.arxml'));
		for (const row of buildDiffBody(document, aligned).rows) {
			assertLeftLines(aligned, row);
			assertRightLines(aligned, row);
		}
	});
});
