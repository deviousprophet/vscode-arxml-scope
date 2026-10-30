/**
 * Tree-query helpers: the display list the virtual window walks and the one
 * ancestor walk a reveal/search jump expands. Search itself is exercised in
 * `search.test.ts`.
 */
import * as assert from 'assert';

import { TreeRow, ancestorIds, flattenRows } from '../../editor/treeQuery';

const ROWS: TreeRow[] = [
	{ id: 'm', parentId: null, level: 1, subtreeSize: 5, hasChildren: true, haystack: 'pkga.pkgb.moddefs.modx modx' },
	{ id: 'a', parentId: 'm', level: 2, subtreeSize: 2, hasChildren: true, haystack: 'conta conta' },
	{ id: 'p1', parentId: 'a', level: 3, subtreeSize: 0, hasChildren: false, haystack: 'inivalue 63' },
	{ id: 'p2', parentId: 'a', level: 3, subtreeSize: 0, hasChildren: false, haystack: 'title hello' },
	{ id: 'b', parentId: 'm', level: 2, subtreeSize: 1, hasChildren: true, haystack: 'contb contb' },
	{ id: 'p3', parentId: 'b', level: 3, subtreeSize: 0, hasChildren: false, haystack: 'text nested' },
];

function nodeIndexes(collapsed?: ReadonlySet<string>): number[] {
	return flattenRows(ROWS, { collapsed }).map((row) => row.rowIndex);
}

suite('tree query helpers', () => {
	test('flattenRows keeps every row in display order', () => {
		assert.deepStrictEqual(nodeIndexes(), [0, 1, 2, 3, 4, 5]);
	});

	test('annotation comments are fixed display rows above their node', () => {
		const rows = ROWS.map((row) =>
			row.id === 'a' ? { ...row, comments: ['[Note] first', 'second'] } : row
		);
		const list = flattenRows(rows, { braces: true });
		assert.deepStrictEqual(
			list.map((row) => `${row.type}:${row.rowIndex}`),
			[
				'node:0',
				'brace-open:0',
				'comment:1',
				'comment:1',
				'node:1',
				'brace-open:1',
				'node:2',
				'node:3',
				'brace-close:1',
				'node:4',
				'brace-open:4',
				'node:5',
				'brace-close:4',
				'brace-close:0',
			]
		);
		const comments = list.filter((row) => row.type === 'comment');
		assert.deepStrictEqual(
			comments.map((row) => (row.type === 'comment' ? `${row.level}:${row.text}` : '')),
			['2:[Note] first', '2:second'],
			'comments carry the owner level and source order'
		);
		assert.ok(
			flattenRows(ROWS).every((row) => row.type !== 'comment'),
			'a row without annotations adds no display row'
		);
	});

	test('a collapsed node hides its subtree', () => {
		assert.deepStrictEqual(nodeIndexes(new Set(['a'])), [0, 1, 4, 5]);
		assert.deepStrictEqual(nodeIndexes(new Set(['m'])), [0], 'a collapsed module hides everything below it');
		assert.deepStrictEqual(nodeIndexes(new Set(['b'])), [0, 1, 2, 3, 4]);
	});

	test('Document adds brace rows around expanded subtrees', () => {
		const document = flattenRows(ROWS, { braces: true });
		assert.deepStrictEqual(
			document.map((row) => `${row.type}:${row.rowIndex}:${row.level}`),
			[
				'node:0:1',
				'brace-open:0:1',
				'node:1:2',
				'brace-open:1:2',
				'node:2:3',
				'node:3:3',
				'brace-close:1:2',
				'node:4:2',
				'brace-open:4:2',
				'node:5:3',
				'brace-close:4:2',
				'brace-close:0:1',
			]
		);
	});

	test('a collapsed node keeps its row but gets no brace pair', () => {
		const document = flattenRows(ROWS, { collapsed: new Set(['a']), braces: true });
		assert.deepStrictEqual(
			document.map((row) => `${row.type}:${row.rowIndex}`),
			[
				'node:0',
				'brace-open:0',
				'node:1',
				'node:4',
				'brace-open:4',
				'node:5',
				'brace-close:4',
				'brace-close:0',
			]
		);
		assert.deepStrictEqual(
			flattenRows(ROWS, { collapsed: new Set(['m']), braces: true }).map((row) => `${row.type}:${row.rowIndex}`),
			['node:0'],
			'a collapsed module is its own stub, with no braces'
		);
	});

	test('brace rows and node entries expose the fields the window renderer needs', () => {
		const document = flattenRows(ROWS, { braces: true });
		const firstBrace = document[1];
		assert.strictEqual(firstBrace.type, 'brace-open');
		assert.strictEqual(firstBrace.rowIndex, 0);
		assert.strictEqual(firstBrace.level, 1);
		const deepNode = document.find((row) => row.type === 'node' && row.rowIndex === 5);
		assert.ok(deepNode && deepNode.type === 'node');
		assert.strictEqual(deepNode.depth, 2, '0-based indentation depth');
		assert.strictEqual(deepNode.level, 3);
	});

	test('flattenRows reports its own expansion decision', () => {
		const expandedFor = (collapsed?: ReadonlySet<string>): Record<string, boolean> => {
			const out: Record<string, boolean> = {};
			for (const row of flattenRows(ROWS, { collapsed })) {
				if (row.type === 'node') {
					out[ROWS[row.rowIndex].id] = row.expanded;
				}
			}
			return out;
		};

		const open = expandedFor();
		assert.strictEqual(open.m, true, 'an uncollapsed parent is expanded');
		assert.strictEqual(open.a, true);
		assert.strictEqual(open.p1, false, 'a leaf is never expanded');

		const closed = expandedFor(new Set(['m']));
		assert.strictEqual(closed.m, false, 'a collapsed parent is not expanded');
		assert.strictEqual(closed.a, undefined, 'its subtree is not displayed');
	});

	test('ancestorIds is the one owner of the parent walk', () => {
		assert.deepStrictEqual(ancestorIds(ROWS, 'p1'), ['a', 'm'], 'nearest parent first');
		assert.deepStrictEqual(ancestorIds(ROWS, 'm'), [], 'a root has no ancestors');
		assert.deepStrictEqual(ancestorIds(ROWS, 'missing'), [], 'an unknown id resolves to nothing');

		const cyclic: TreeRow[] = [
			{ id: 'x', parentId: 'y', level: 1, subtreeSize: 0, hasChildren: false, haystack: 'x' },
			{ id: 'y', parentId: 'x', level: 2, subtreeSize: 0, hasChildren: false, haystack: 'y' },
		];
		assert.deepStrictEqual(ancestorIds(cyclic, 'x'), ['y'], 'a parent cycle stops instead of looping');
	});
});
