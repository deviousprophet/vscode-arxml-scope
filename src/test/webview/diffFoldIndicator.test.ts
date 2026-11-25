import * as assert from 'assert';

import type { DiffRow } from '../../core/diff/diffModel';
import {
	collapsedDifferenceKeys,
	subtreeHasDifference
} from '../../webview/monaco/diffFoldIndicator';

function row(
	key: string,
	status: DiffRow['status'],
	subtreeSize = 0,
	changes: DiffRow['changes'] = []
): DiffRow {
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
		changes,
		haystack: key
	};
}

function nameChange(): DiffRow['changes'] {
	return [{ field: 'short name', left: 'Old', right: 'New' }];
}

function valueChange(): DiffRow['changes'] {
	return [{ field: 'value', left: '1', right: '2' }];
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

	test('the collapsed row’s own rename does not mark it', () => {
		assert.strictEqual(subtreeHasDifference([row('renamed', 'changed', 0, nameChange())], 0), false);
		assert.strictEqual(subtreeHasDifference([row('value', 'changed', 0, valueChange())], 0), true);
	});

	test('a descendant change still marks a renamed collapsed row', () => {
		const changedChild = [row('renamed', 'changed', 1, nameChange()), row('value', 'changed', 0, valueChange())];
		assert.strictEqual(subtreeHasDifference(changedChild, 0), true);
		const renamedChild = [row('renamed', 'changed', 1, nameChange()), row('child', 'changed', 0, nameChange())];
		assert.strictEqual(subtreeHasDifference(renamedChild, 0), true);
	});
});
