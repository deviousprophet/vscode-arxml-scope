/**
 * The semantic body adapter behind the Monaco diff decorations.
 *
 * The adapter must never invent a side: a row's line numbers and block lines
 * come from the same per-side synthetic documents Monaco renders, and a missing
 * side reports no line at all so no placeholder can be painted.
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
	buildDiffSyntheticDocuments,
	type DiffSyntheticDocuments,
} from '../../webview/monaco/synthetic';
import {
	buildDiffBody,
	cursorChangeIndex,
	lineOnSide,
	linesOnSide,
	mergeSourceSide,
	navigationTarget,
	owningSides,
	semanticChanges,
	stepChange,
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

function syntheticPair(leftText: string, rightText: string, semantic = true): {
	document: DiffDocument;
	synthetic: DiffSyntheticDocuments;
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
	return { document, synthetic: buildDiffSyntheticDocuments(document) };
}

function rowWithStatus(document: DiffDocument, status: DiffRow['status']): DiffRow {
	const row = document.rows.find((candidate) => candidate.status === status);
	assert.ok(row, `a ${status} row exists`);
	return row!;
}

function bodyRow(document: DiffDocument, synthetic: DiffSyntheticDocuments, key: string): DiffBodyRow {
	const body = buildDiffBody(document, synthetic);
	const row = body.byKey.get(key);
	assert.ok(row, `the body has row ${key}`);
	return row!;
}

function assertLeftLines(synthetic: DiffSyntheticDocuments, row: DiffBodyRow): void {
	for (const line of row.leftLines) {
		assert.ok(line >= 1 && line <= synthetic.left.lines.length, `left line ${line} is in the model`);
		assert.strictEqual(synthetic.leftLineKeys[line - 1], row.key);
	}
}

function assertRightLines(synthetic: DiffSyntheticDocuments, row: DiffBodyRow): void {
	for (const line of row.rightLines) {
		assert.ok(line >= 1 && line <= synthetic.right.lines.length, `right line ${line} is in the model`);
		assert.strictEqual(synthetic.rightLineKeys[line - 1], row.key);
	}
}

suite('diff body adapter', () => {
	test('every merged row keeps its semantic status and changes', () => {
		const { document, synthetic } = syntheticPair(fixtureText('diff/left.arxml'), fixtureText('diff/right.arxml'));
		const body = buildDiffBody(document, synthetic);
		assert.strictEqual(body.rows.length, document.rows.length);
		for (const row of body.rows) {
			assert.strictEqual(row.status, document.rows.find((candidate) => candidate.key === row.key)?.status);
			assert.deepStrictEqual(row.changes, document.rows.find((candidate) => candidate.key === row.key)?.changes);
			assert.strictEqual(body.byKey.get(row.key), row);
		}
	});

	test('a changed row owns both sides and the node line is the synthetic line', () => {
		const { document, synthetic } = syntheticPair(fixtureText('diff/left.arxml'), fixtureText('diff/right.arxml'));
		const changed = rowWithStatus(document, 'changed');
		const row = bodyRow(document, synthetic, changed.key);
		assert.deepStrictEqual(owningSides(row), ['left', 'right']);
		assert.strictEqual(row.leftLine, synthetic.left.rowLine.get(changed.key));
		assert.strictEqual(row.rightLine, synthetic.right.rowLine.get(changed.key));
		assert.strictEqual(lineOnSide(row, 'left'), row.leftLine);
		assert.strictEqual(lineOnSide(row, 'right'), row.rightLine);
		assert.ok(row.changes.length > 0, 'the changed row carries its semantic fields');
		assert.ok(row.leftLines.includes(row.leftLine!), 'the block lines include the node line');
		assert.ok(row.rightLines.includes(row.rightLine!), 'the block lines include the node line');
	});

	test('an added row has no left line and no placeholder block', () => {
		const { document, synthetic } = syntheticPair(fixtureText('diff/left.arxml'), fixtureText('diff/right.arxml'));
		const added = rowWithStatus(document, 'added');
		const row = bodyRow(document, synthetic, added.key);
		assert.deepStrictEqual(owningSides(row), ['right']);
		assert.strictEqual(row.leftCell, undefined);
		assert.strictEqual(row.leftLine, undefined);
		assert.deepStrictEqual(row.leftLines, []);
		assert.deepStrictEqual(linesOnSide(row, 'left'), []);
		assert.ok(row.rightLine !== undefined);
		assert.ok(row.rightLines.length > 1, 'a container block owns its brace lines too');
	});

	test('a removed row mirrors the added row', () => {
		const { document, synthetic } = syntheticPair(fixtureText('diff/left.arxml'), fixtureText('diff/right.arxml'));
		const removed = rowWithStatus(document, 'removed');
		const row = bodyRow(document, synthetic, removed.key);
		assert.deepStrictEqual(owningSides(row), ['left']);
		assert.strictEqual(row.rightCell, undefined);
		assert.strictEqual(row.rightLine, undefined);
		assert.deepStrictEqual(row.rightLines, []);
		assert.ok(row.leftLine !== undefined);
		assert.ok(row.leftLines.length > 1);
	});

	test('merge clicks keep the existing copy/delete source rule', () => {
		const { document, synthetic } = syntheticPair(fixtureText('diff/left.arxml'), fixtureText('diff/right.arxml'));
		const added = bodyRow(document, synthetic, rowWithStatus(document, 'added').key);
		assert.strictEqual(mergeSourceSide(added, 'left'), 'right');
		assert.strictEqual(mergeSourceSide(added, 'right'), 'right');
		const removed = bodyRow(document, synthetic, rowWithStatus(document, 'removed').key);
		assert.strictEqual(mergeSourceSide(removed, 'left'), 'left');
		assert.strictEqual(mergeSourceSide(removed, 'right'), 'left');
		const changed = bodyRow(document, synthetic, rowWithStatus(document, 'changed').key);
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
		const { document, synthetic } = syntheticPair(left, right);
		const renamed = document.rows.filter((row) => row.status === 'changed' && row.match?.kind === 'semantic');
		assert.ok(renamed.length > 0, 'the semantic pass paired the renamed container');
		const body = buildDiffBody(document, synthetic);
		assert.ok(body.rows.some((row) => row.renamed), 'the body marks the semantic pair');
		assert.ok(
			body.rows
				.filter((row) => row.status !== 'changed')
				.every((row) => !row.renamed),
			'an unchanged semantic pair is not a rename'
		);
	});

	test('block line numbers stay inside the synthetic models', () => {
		const { document, synthetic } = syntheticPair(fixtureText('diff/left.arxml'), fixtureText('diff/right.arxml'));
		for (const row of buildDiffBody(document, synthetic).rows) {
			assertLeftLines(synthetic, row);
			assertRightLines(synthetic, row);
		}
	});

	test('semantic changes are the non-unchanged rows in merged order', () => {
		const { document, synthetic } = syntheticPair(fixtureText('diff/left.arxml'), fixtureText('diff/right.arxml'));
		const body = buildDiffBody(document, synthetic);
		const changes = semanticChanges(body.rows);
		assert.ok(changes.length > 0, 'the fixture has semantic changes');
		for (let at = 0; at < changes.length; at += 1) {
			const change = changes[at];
			const row = body.byKey.get(change.key);
			assert.ok(row, `the change row ${change.key} is in the body`);
			assert.notStrictEqual(row!.status, 'unchanged');
			assert.strictEqual(change.status, row!.status);
			assert.strictEqual(change.leftLine, row!.leftLine);
			assert.strictEqual(change.rightLine, row!.rightLine);
			assert.strictEqual(change.renamed, row!.renamed);
			if (at > 0) {
				assert.ok(change.order > changes[at - 1].order, 'the order follows the merged body');
			}
		}
	});

	test('a one-sided change keeps only its owning side as a navigation target', () => {
		const { document, synthetic } = syntheticPair(fixtureText('diff/left.arxml'), fixtureText('diff/right.arxml'));
		const changes = semanticChanges(buildDiffBody(document, synthetic).rows);
		const added = changes.find((change) => change.status === 'added');
		assert.ok(added, 'an added row exists');
		assert.strictEqual(added!.leftLine, undefined);
		assert.ok(added!.rightLine !== undefined);
		assert.deepStrictEqual(navigationTarget(added!, 'left'), { side: 'right', line: added!.rightLine });
		assert.deepStrictEqual(navigationTarget(added!, 'right'), { side: 'right', line: added!.rightLine });
		const removed = changes.find((change) => change.status === 'removed');
		assert.ok(removed, 'a removed row exists');
		assert.strictEqual(removed!.rightLine, undefined);
		assert.deepStrictEqual(navigationTarget(removed!, 'right'), { side: 'left', line: removed!.leftLine });
	});

	test('a changed row targets the preferred pane and falls back through swap', () => {
		const { document, synthetic } = syntheticPair(fixtureText('diff/left.arxml'), fixtureText('diff/right.arxml'));
		const changed = semanticChanges(buildDiffBody(document, synthetic).rows).find(
			(change) => change.status === 'changed'
		);
		assert.ok(changed);
		assert.deepStrictEqual(navigationTarget(changed!, 'left'), { side: 'left', line: changed!.leftLine });
		assert.deepStrictEqual(navigationTarget(changed!, 'right'), { side: 'right', line: changed!.rightLine });
	});

	test('navigation steps wrap at both ends and start at the first/last change', () => {
		assert.strictEqual(stepChange(4, undefined, 1), 0);
		assert.strictEqual(stepChange(4, undefined, -1), 3);
		assert.strictEqual(stepChange(4, 0, 1), 1);
		assert.strictEqual(stepChange(4, 3, 1), 0);
		assert.strictEqual(stepChange(4, 0, -1), 3);
		assert.strictEqual(stepChange(4, 3, -1), 2);
		assert.strictEqual(stepChange(0, undefined, 1), undefined);
		assert.strictEqual(stepChange(4, 99, 1), 0);
		assert.strictEqual(stepChange(4, -1, -1), 3);
	});

	test('the cursor anchor does not skip a change above the first row', () => {
		const { document, synthetic } = syntheticPair(fixtureText('diff/left.arxml'), fixtureText('diff/right.arxml'));
		const changes = semanticChanges(buildDiffBody(document, synthetic).rows);
		const rightAt = changes.findIndex((change) => change.rightLine !== undefined);
		assert.ok(rightAt >= 0);
		const line = changes[rightAt].rightLine!;
		assert.strictEqual(cursorChangeIndex(changes, 1, 'right'), undefined);
		assert.strictEqual(cursorChangeIndex(changes, line, 'right'), rightAt);
		const lastRight = changes.reduce(
			(found, change, at) => (change.rightLine === undefined ? found : at),
			rightAt
		);
		assert.strictEqual(cursorChangeIndex(changes, line + 100, 'right'), lastRight);
	});

	test('a semantic rename that moved is one navigation row on both panes', () => {
		const moduleOf = (containers: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0"><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS>
<ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>Nav</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/Nav</DEFINITION-REF><CONTAINERS>${containers}</CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES>
</ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const widget = (shortName: string): string =>
			`<ECUC-CONTAINER-VALUE><SHORT-NAME>${shortName}</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/Nav/Widget</DEFINITION-REF></ECUC-CONTAINER-VALUE>`;
		const items = `<ECUC-CONTAINER-VALUE><SHORT-NAME>Items</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/Nav/Items</DEFINITION-REF><PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/Nav/Items/Value</DEFINITION-REF><VALUE>1</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE>`;
		// The renamed container also moved across Items in the right document.
		const left = moduleOf(widget('NMH_Widget') + items);
		const right = moduleOf(items + widget('NM_Widget'));
		const { document, synthetic } = syntheticPair(left, right);
		const changes = semanticChanges(buildDiffBody(document, synthetic).rows);
		const renamed = changes.find((change) => change.renamed);
		assert.ok(renamed, 'the semantic pass paired the moved rename');
		assert.strictEqual(renamed!.status, 'changed');
		assert.ok(renamed!.leftLine !== undefined && renamed!.rightLine !== undefined, 'both panes own the row');
		assert.strictEqual(renamed!.leftLine, synthetic.left.rowLine.get(renamed!.key));
		assert.strictEqual(renamed!.rightLine, synthetic.right.rowLine.get(renamed!.key));
	});
});
