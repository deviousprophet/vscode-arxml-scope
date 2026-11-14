/**
 * Plan rows DIFF-01, 03, 04 from `docs/TEST_PLAN.md`.
 *
 * DIFF-02 described the removed three-way merge and is re-scoped in the plan.
 * DIFF-05 (1,200 changed rows stay windowed) lives in `diffPage.test.ts` because
 * it asserts the rendered DOM budget.
 */
import * as assert from 'assert';

import { buildDiffDocument } from '../../core/diff/diffModel';
import { buildNodeIndex } from '../../core/ecuc/nodeId';
import { buildRows } from '../../core/ecuc/renderRows';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { DiffSession } from './diffSessionOracle';

function doc(containers: string): string {
	return `<?xml version="1.0"?><AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/M</DEFINITION-REF><CONTAINERS>${containers}</CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
}

function container(name: string, value: string, definition = `/D/${name}`): string {
	return `<ECUC-CONTAINER-VALUE><SHORT-NAME>${name}</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">${definition}</DEFINITION-REF><PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/V</DEFINITION-REF><VALUE>${value}</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE>`;
}

function side(text: string) {
	const model = scanEcucValues(text);
	const index = buildNodeIndex(model);
	const rows = buildRows(model, { sort: 'all' }).rows;
	return { rows, rangeOf: (id: string) => index.byId.get(id)?.range, header: { packages: ['P'] } };
}

function diff(leftText: string, rightText: string, semanticPairBudget?: number) {
	return buildDiffDocument(
		{ name: 'left.arxml', path: '/left.arxml' },
		{ name: 'right.arxml', path: '/right.arxml' },
		side(leftText).rows,
		side(rightText).rows,
		side(leftText).rangeOf,
		side(rightText).rangeOf,
		undefined,
		{ semanticMatching: true, ...(semanticPairBudget === undefined ? {} : { semanticPairBudget }) }
	);
}

suite('plan coverage: DIFF', () => {
	test('DIFF-01 same name with different children is one changed pair', () => {
		const left = doc(container('Same', '1'));
		const right = doc(container('Same', '2'));
		const document = diff(left, right);
		assert.strictEqual(document.summary.added, 0);
		assert.strictEqual(document.summary.removed, 0);
		const changed = document.rows.filter((row) => row.status === 'changed');
		assert.strictEqual(changed.length, 1, 'the value is the one changed row');
		assert.ok(changed[0].left && changed[0].right);
		assert.strictEqual(changed[0].kind, 'parameter');
	});

	test('DIFF-03 a budget-limited pair reports the reason and the skipped count', () => {
		const left = doc(`${container('NMH_01', '1', '/D/Main')}${container('NMH_02', '2', '/D/Main')}`);
		const right = doc(`${container('NM_01', '1', '/D/Main')}${container('NM_02', '2', '/D/Main')}`);
		const document = diff(left, right, 1);
		assert.ok(document.semanticSkipped > 0, `skipped ${document.semanticSkipped}`);
		assert.strictEqual(document.semanticLimitReason, 'budget');
	});

	test('DIFF-04 toggling strict/semantic reuses each cached document', () => {
		const leftText = doc(container('NMH_01', '1', '/D/Main'));
		const rightText = doc(container('NM_01', '1', '/D/Main'));
		const session = new DiffSession(
			{ name: 'left.arxml', path: '/left.arxml' },
			{ name: 'right.arxml', path: '/right.arxml' },
			side(leftText),
			side(rightText)
		);
		const strict = session.document(false).document;
		const semantic = session.document(true).document;
		assert.ok(semantic.summary.renamed > strict.summary.renamed, 'the semantic pass pairs the rename');
		const again = session.document(false);
		assert.strictEqual(again.document, strict, 'the strict document is reused');
		assert.strictEqual(again.changed, true, 'the display changes when the mode changes');
		session.invalidate();
		const rebuilt = session.document(false).document;
		assert.notStrictEqual(rebuilt, strict, 'invalidate drops the cache');
		assert.deepStrictEqual(rebuilt.summary, strict.summary);
	});
});
