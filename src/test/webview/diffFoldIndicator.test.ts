import * as assert from 'assert';

import type { DiffRow } from '../../core/diff/diffModel';
import {
	collapsedDifferenceKeys,
	subtreeHasDifference
} from '../../webview/monaco/diffFoldIndicator';

function row(key: string, status: DiffRow['status'], subtreeSize = 0): DiffRow {
	return {
		key,
		parentKey: null,
		level: 0,
		posinset: 1,
		setsize: 1,
		kind: 'container',
		hasChildren: subtreeSize > 0,
		subtreeSize,
		status,
		changes: [],
		haystack: key
	};
}

suite('diff fold indicator', () => {
	const rows = [
		row('module', 'unchanged', 4),
		row('container', 'unchanged', 2),
		row('parameter', 'changed'),
		row('other', 'unchanged'),
		row('tail', 'unchanged')
	];

	test('a changed row or descendant is detected', () => {
		assert.strictEqual(subtreeHasDifference(rows, 0), true);
		assert.strictEqual(subtreeHasDifference(rows, 1), true);
		assert.strictEqual(subtreeHasDifference(rows, 2), true);
		assert.strictEqual(subtreeHasDifference(rows, 3), false);
	});

	test('only collapsed rows whose subtree changed get a marker', () => {
		assert.deepStrictEqual(
			[...collapsedDifferenceKeys(rows, new Set(['container', 'other', 'missing']))],
			['container']
		);
	});

	test('a one-sided added or removed row counts as a difference', () => {
		const sideRows = [row('module', 'unchanged', 1), row('added', 'added')];
		assert.strictEqual(subtreeHasDifference(sideRows, 0), true);
	});
});
