/**
 * Applying a `diff.patch` to the displayed document.
 *
 * The engine's patch is the same on both sides of the seam: the host applies it to its
 * copy, the page applies the message. These tests pin the splice, the ancestor re-send
 * and the offset shift.
 */
import * as assert from 'assert';

import type { DiffDocument, DiffRow } from '../../core/diff/diffModel';
import { applyDiffPatch, type DiffPatch } from '../../core/diff/diffPatch';

function row(key: string, label: string, start: number, end: number): DiffRow {
	return {
		key,
		parentKey: null,
		level: 2,
		posinset: 1,
		setsize: 1,
		kind: 'parameter',
		hasChildren: false,
		subtreeSize: 0,
		status: 'unchanged',
		changes: [],
		haystack: label.toLowerCase(),
		left: { kind: 'parameter', label, definitionRef: '/P', meta: [], range: { start, end } },
		right: { kind: 'parameter', label, definitionRef: '/P', meta: [], range: { start, end } }
	};
}

function documentOf(rows: DiffRow[]): DiffDocument {
	return {
		left: { name: 'left.arxml', path: '/work/left.arxml' },
		right: { name: 'right.arxml', path: '/work/right.arxml' },
		labels: ['left.arxml', 'right.arxml'],
		leftHeader: { packages: [] },
		rightHeader: { packages: [] },
		rows,
		summary: { changed: 0, added: 0, removed: 0, unchanged: rows.length, renamed: 0 },
		semanticSkipped: 0
	};
}

function patchOf(overrides: Partial<DiffPatch> = {}): DiffPatch {
	return {
		at: 1,
		remove: 1,
		rows: [row('b', 'Beta', 20, 30)],
		ancestors: [],
		summary: { changed: 0, added: 0, removed: 0, unchanged: 2, renamed: 0 },
		semanticSkipped: 0,
		...overrides
	};
}

suite('diff patch', () => {
	test('a span replaces exactly the rows it names', () => {
		const document = documentOf([row('a', 'Alpha', 0, 10), row('b', 'Bravo', 10, 20), row('c', 'Charlie', 20, 30)]);
		const patched = applyDiffPatch(document, patchOf());
		assert.deepStrictEqual(
			patched.rows.map((entry) => entry.key),
			['a', 'b', 'c']
		);
		assert.strictEqual(patched.rows[1].left?.label, 'Beta');
	});

	test('an ancestor row is re-sent rather than left stale', () => {
		const parent = { ...row('up', 'Parent', 0, 40), level: 1, subtreeSize: 3 };
		const document = documentOf([parent, row('a', 'Alpha', 0, 10)]);
		const moved = { ...parent, subtreeSize: 4 };
		const patched = applyDiffPatch(document, patchOf({ at: 1, remove: 0, rows: [], ancestors: [moved] }));
		assert.strictEqual(patched.rows[0].subtreeSize, 4);
	});

	test('rows after the edit shift by the reported delta', () => {
		const rightRange = (entry: DiffRow) => entry.right?.range;
		const document = documentOf([row('a', 'Alpha', 0, 10), row('b', 'Bravo', 10, 20), row('c', 'Charlie', 20, 30)]);
		const patched = applyDiffPatch(
			document,
			patchOf({
				at: 0,
				remove: 0,
				rows: [row('new', 'New', 0, 4)],
				shift: { side: 'right', after: 10, by: 4 }
			})
		);
		// The inserted row keeps its own ranges; rows before the shift point stay.
		assert.deepStrictEqual(rightRange(patched.rows[0]), { start: 0, end: 4 });
		assert.deepStrictEqual(rightRange(patched.rows[1]), { start: 0, end: 10 });
		assert.deepStrictEqual(rightRange(patched.rows[2]), { start: 14, end: 24 });
		assert.deepStrictEqual(rightRange(patched.rows[3]), { start: 24, end: 34 });
	});

	test('the summary and skip counters follow the patch', () => {
		const document = documentOf([row('a', 'Alpha', 0, 10)]);
		const patched = applyDiffPatch(
			document,
			patchOf({
				at: 1,
				remove: 0,
				rows: [],
				summary: { changed: 3, added: 1, removed: 0, unchanged: 1, renamed: 1 },
				semanticSkipped: 2
			})
		);
		assert.deepStrictEqual(patched.summary, { changed: 3, added: 1, removed: 0, unchanged: 1, renamed: 1 });
		assert.strictEqual(patched.semanticSkipped, 2);
	});
});
