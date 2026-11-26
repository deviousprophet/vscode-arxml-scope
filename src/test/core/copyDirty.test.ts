/**
 * Copied-but-unsaved rows.
 *
 * The store is the host's memory of what a merge copy wrote. These tests pin the
 * two rules the pages depend on: only the target side is marked, and a record
 * disappears when its span is undone or edited over.
 */
import * as assert from 'assert';

import {
	CopyDirtyStore,
	copiedRowKeys,
	sideKey,
	type CopyRecord
} from '../../core/copy/copyDirty';
import type { DiffRow } from '../../core/diff/diffModel';

function row(
	key: string,
	left: { start: number; end: number } | undefined,
	right: { start: number; end: number } | undefined
): DiffRow {
	return {
		key,
		parentKey: null,
		level: 2,
		posinset: 1,
		setsize: 1,
		kind: 'parameter',
		hasChildren: false,
		subtreeSize: 0,
		status: 'changed',
		changes: [],
		haystack: key,
		...(left === undefined
			? {}
			: { left: { kind: 'parameter', label: key, definitionRef: '/P', meta: [], range: left } }),
		...(right === undefined
			? {}
			: { right: { kind: 'parameter', label: key, definitionRef: '/P', meta: [], range: right } })
	};
}

function record(overrides: Partial<CopyRecord> = {}): CopyRecord {
	return {
		side: 'right',
		keys: ['P.A'],
		start: 100,
		end: 140,
		text: 'P.A = 1',
		version: 3,
		...overrides
	};
}

suite('copied-row keys', () => {
	test('an added right row is keyed by the bare row id', () => {
		assert.strictEqual(sideKey(row('right:Mod/A', undefined, { start: 0, end: 1 }), 'right'), 'Mod/A');
		assert.strictEqual(sideKey(row('Mod/A', { start: 0, end: 1 }, { start: 0, end: 1 }), 'right'), 'Mod/A');
		assert.strictEqual(sideKey(row('Mod/A', { start: 0, end: 1 }, undefined), 'right'), undefined);
	});

	test('only rows with a cell on the written side are keys', () => {
		const rows = [
			row('A', { start: 10, end: 20 }, undefined),
			row('right:B', undefined, { start: 100, end: 130 }),
			row('C', { start: 30, end: 40 }, { start: 130, end: 150 })
		];
		assert.deepStrictEqual(copiedRowKeys(rows, 'right', { start: 100, end: 140 }), ['B', 'C']);
		assert.deepStrictEqual(copiedRowKeys(rows, 'left', { start: 100, end: 140 }), []);
		assert.deepStrictEqual(copiedRowKeys(rows, 'left', { start: 15, end: 35 }), ['A', 'C']);
	});

	test('a row touching the span edge is not part of it', () => {
		const rows = [row('A', undefined, { start: 0, end: 100 }), row('B', undefined, { start: 100, end: 140 })];
		assert.deepStrictEqual(copiedRowKeys(rows, 'right', { start: 100, end: 140 }), ['B']);
	});
});

suite('copied-row store', () => {
	test('records rows per document and drops the duplicates', () => {
		const store = new CopyDirtyStore();
		store.record('/r', record());
		store.record('/r', record({ keys: ['P.A', 'P.B'] }));
		assert.deepStrictEqual(store.keys('/r'), ['P.A', 'P.B']);
		assert.deepStrictEqual(store.keys('/l'), []);
		assert.strictEqual(store.has('/r'), true);
	});

	test('a save clears every copy in the document', () => {
		const store = new CopyDirtyStore();
		store.record('/r', record());
		assert.strictEqual(store.clear('/r'), true);
		assert.strictEqual(store.has('/r'), false);
		assert.strictEqual(store.clear('/r'), false);
	});

	test('an edit before the copy shifts it and keeps the rows', () => {
		const store = new CopyDirtyStore();
		store.record('/r', record());
		// Twelve characters inserted at offset 10: the copy moves right by 12.
		assert.strictEqual(store.applyChange('/r', [{ start: 10, end: 10, text: 'x'.repeat(12) }], 4), false);
		assert.deepStrictEqual(store.keys('/r'), ['P.A']);
		assert.deepStrictEqual(store.records('/r')[0].start, 112);
		assert.deepStrictEqual(store.records('/r')[0].end, 152);
	});

	test('an edit after the copy leaves it alone', () => {
		const store = new CopyDirtyStore();
		store.record('/r', record());
		assert.strictEqual(store.applyChange('/r', [{ start: 200, end: 201, text: '' }], 4), false);
		assert.deepStrictEqual(store.keys('/r'), ['P.A']);
	});

	test('undoing the copy span removes the marker', () => {
		const store = new CopyDirtyStore();
		store.record('/r', record());
		assert.strictEqual(store.applyChange('/r', [{ start: 100, end: 140, text: '' }], 4), true);
		assert.deepStrictEqual(store.keys('/r'), []);
	});

	test('typing inside the copied span removes the marker', () => {
		const store = new CopyDirtyStore();
		store.record('/r', record());
		assert.strictEqual(store.applyChange('/r', [{ start: 120, end: 120, text: '7' }], 4), true);
		assert.deepStrictEqual(store.keys('/r'), []);
	});

	test('the copy edit itself is not a user change', () => {
		const store = new CopyDirtyStore();
		store.record('/r', record({ version: 5 }));
		assert.strictEqual(store.applyChange('/r', [{ start: 100, end: 140, text: '' }], 5), false);
		assert.deepStrictEqual(store.keys('/r'), ['P.A']);
	});

	test('one event with two disjoint changes keeps both records', () => {
		const store = new CopyDirtyStore();
		store.record('/r', record({ keys: ['P.A'], start: 100, end: 140 }));
		store.record('/r', record({ keys: ['P.B'], start: 300, end: 340 }));
		const changed = store.applyChange(
			'/r',
			[
				{ start: 0, end: 0, text: 'abc' },
				{ start: 500, end: 500, text: 'de' }
			],
			6
		);
		assert.strictEqual(changed, false);
		assert.deepStrictEqual(store.keys('/r'), ['P.A', 'P.B']);
		assert.deepStrictEqual(store.records('/r')[0].start, 103);
	});

	test('forget drops a closed buffer without a save', () => {
		const store = new CopyDirtyStore();
		store.record('/r', record());
		assert.strictEqual(store.forget('/r'), true);
		assert.deepStrictEqual(store.keys('/r'), []);
	});
});
