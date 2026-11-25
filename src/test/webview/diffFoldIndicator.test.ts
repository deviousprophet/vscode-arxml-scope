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
	const cell = {} as NonNullable<DiffRow['left']>;
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
		left: cell,
		right: cell,
		changes,
		haystack: key
	};
}

function existingOn(
	key: string,
	status: DiffRow['status'],
	side: 'left' | 'right',
	subtreeSize = 0,
	changes: DiffRow['changes'] = []
): DiffRow {
	const rowValue = row(key, status, subtreeSize, changes);
	return side === 'left'
		? { ...rowValue, right: undefined }
		: { ...rowValue, left: undefined };
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

	test('a collapsed row that exists on only one side never marks', () => {
		const rows = [existingOn('removed', 'removed', 'left', 1), existingOn('child', 'added', 'left')];
		assert.strictEqual(subtreeHasDifference(rows, 0), false);
	});

	test('a one-sided descendant marks a shared root', () => {
		const rows = [row('module', 'unchanged', 1), existingOn('added', 'added', 'left')];
		assert.strictEqual(subtreeHasDifference(rows, 0), true);
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
