/**
 * Task design §4 and §7 — the page-side filter/flatten engine is row-indexed:
 * one normalised haystack index, matches plus ancestors, subtree skipping for
 * collapse and filtering, Document brace rows, counts and a debounced
 * generation token. The existing `haystack`/`matchRanges`/`filterTree`
 * semantics must stay untouched; these tests pin the new row functions only.
 */
import * as assert from 'assert';

import {
	FilterIndex,
	FilterRow,
	ancestorIds,
	buildFilterIndex,
	createFilterDebouncer,
	filterRows,
	flattenRows,
} from '../../editor/filter';

const ROWS: FilterRow[] = [
	{ id: 'm', parentId: null, level: 1, subtreeSize: 5, hasChildren: true, haystack: 'pkga.pkgb.moddefs.modx modx' },
	{ id: 'a', parentId: 'm', level: 2, subtreeSize: 2, hasChildren: true, haystack: 'conta conta' },
	{ id: 'p1', parentId: 'a', level: 3, subtreeSize: 0, hasChildren: false, haystack: 'inivalue 63' },
	{ id: 'p2', parentId: 'a', level: 3, subtreeSize: 0, hasChildren: false, haystack: 'title hello' },
	{ id: 'b', parentId: 'm', level: 2, subtreeSize: 1, hasChildren: true, haystack: 'contb contb' },
	{ id: 'p3', parentId: 'b', level: 3, subtreeSize: 0, hasChildren: false, haystack: 'text nested' },
];

function nodeIndexes(collapsed?: ReadonlySet<string>, visible?: readonly boolean[]): number[] {
	return flattenRows(ROWS, { collapsed, visible }).map((row) => row.rowIndex);
}

suite('row filter engine (design §4, §7)', () => {
	test('design §7: the index normalises every haystack once', () => {
		const mixed = [
			{ ...ROWS[0], haystack: 'PkgA.ModX' },
			{ ...ROWS[1], haystack: 'ContA' },
		];
		assert.deepStrictEqual(buildFilterIndex(mixed).haystacks, ['pkga.modx', 'conta']);
	});

	test('design §7: a match keeps itself and every ancestor', () => {
		const result = filterRows(ROWS, 'inivalue');
		assert.deepStrictEqual(result.matches, [false, false, true, false, false, false]);
		assert.deepStrictEqual(result.visible, [true, true, true, false, false, false]);
		assert.strictEqual(result.matchCount, 1);
		assert.strictEqual(result.visibleCount, 3, 'the count the current UI shows is shown-of-total');
	});

	test('design §7: label, short-name and value substrings match, case-insensitively', () => {
		assert.deepStrictEqual(filterRows(ROWS, '  INIVALUE  ').matches, [false, false, true, false, false, false]);
		assert.deepStrictEqual(filterRows(ROWS, 'conta').visible, [true, true, false, false, false, false]);
		assert.deepStrictEqual(filterRows(ROWS, '63').matches, [false, false, true, false, false, false]);
		assert.deepStrictEqual(filterRows(ROWS, '63').visible, [true, true, true, false, false, false]);
	});

	test('design §7: the index can be reused for another query without changing semantics', () => {
		const index: FilterIndex = buildFilterIndex(ROWS);
		for (const query of ['inivalue', 'hello', 'nested', 'nope']) {
			assert.deepStrictEqual(
				filterRows(ROWS, query, index).visible,
				filterRows(ROWS, query).visible,
				query
			);
		}
	});

	test('design §7: an empty query is the identity; a missing match is the empty state', () => {
		const all = filterRows(ROWS, '');
		assert.deepStrictEqual(all.matches, [true, true, true, true, true, true]);
		assert.deepStrictEqual(all.visible, [true, true, true, true, true, true]);
		assert.strictEqual(all.matchCount, 6);
		assert.strictEqual(all.visibleCount, 6);
		assert.deepStrictEqual(filterRows(ROWS, '   ').visible, all.visible, 'a blank query is empty too');

		const none = filterRows(ROWS, 'nothing-matches-this');
		assert.deepStrictEqual(none.matches, [false, false, false, false, false, false]);
		assert.deepStrictEqual(none.visible, [false, false, false, false, false, false]);
		assert.strictEqual(none.matchCount, 0);
		assert.strictEqual(none.visibleCount, 0);
	});

	test('design §4: a matching container does not show its unmatched children', () => {
		const result = filterRows(ROWS, 'conta');
		assert.strictEqual(result.matchCount, 1);
		assert.deepStrictEqual(nodeIndexes(undefined, result.visible), [0, 1], 'only the container and its ancestor');
		assert.deepStrictEqual(
			flattenRows(ROWS, { visible: result.visible, braces: true }).map((row) => row.type),
			['node', 'brace-open', 'node', 'brace-close'],
			'no empty braces around hidden children'
		);
	});

	test('design §4: a collapsed node hides its subtree in both views', () => {
		assert.deepStrictEqual(nodeIndexes(new Set(['a'])), [0, 1, 4, 5]);
		assert.deepStrictEqual(nodeIndexes(new Set(['m'])), [0], 'a collapsed module hides everything below it');
		assert.deepStrictEqual(nodeIndexes(new Set(['b'])), [0, 1, 2, 3, 4]);
	});

	test('design §4: Document adds brace rows around expanded subtrees, Tree does not', () => {
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
		assert.deepStrictEqual(nodeIndexes(undefined), [0, 1, 2, 3, 4, 5], 'Tree has the same nodes without braces');
	});

	test('design §4: a collapsed node keeps its row but gets no brace pair', () => {
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

	test('design §4: a filter force-expands ancestors without touching the collapsed set', () => {
		const collapsed = new Set(['a']);
		const result = filterRows(ROWS, 'inivalue');
		assert.deepStrictEqual(nodeIndexes(collapsed, result.visible), [0, 1, 2], 'the ancestor override reveals the match');
		assert.deepStrictEqual(Array.from(collapsed), ['a'], 'the saved collapsed set is unchanged');
		assert.deepStrictEqual(nodeIndexes(collapsed), [0, 1, 4, 5], 'clearing the filter restores it');
	});

	test('design §4: an all-true identity result does not bypass the collapsed set when inactive', () => {
		const identity = filterRows(ROWS, '').visible;
		assert.deepStrictEqual(
			flattenRows(ROWS, { collapsed: new Set(['a']), visible: identity, filterActive: false }).map((row) => row.rowIndex),
			[0, 1, 4, 5],
			'an empty query passes filterActive: false and keeps the collapsed set'
		);
	});

	test('design §4: a collapsed matching container expands when a descendant also matches', () => {
		const collapsed = new Set(['a']);
		const result = filterRows(ROWS, 'a');
		assert.ok(result.matches[1], 'the container itself matches');
		assert.ok(result.matches[2], 'and a descendant matches too');
		assert.deepStrictEqual(nodeIndexes(collapsed, result.visible), [0, 1, 2], 'the descendant is reachable');
	});

	test('design §4: hidden subtrees are skipped rather than visited', () => {
		const visible = [true, false, false, false, false, false];
		const flat = flattenRows(ROWS, { visible });
		assert.deepStrictEqual(flat.map((row) => row.rowIndex), [0], 'the hidden subtree is not emitted');
		assert.deepStrictEqual(
			flattenRows(ROWS, { visible, braces: true }).map((row) => row.type),
			['node'],
			'a node without a visible descendant has no brace pair'
		);
	});

	test('design §4: brace rows and node entries expose the fields the window renderer needs', () => {
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

	test('design §7: the debouncer only runs the newest query and invalidates stale tokens', () => {
		let next = 1;
		const timers = new Map<number, { callback: () => void; delay: number }>();
		const debouncer = createFilterDebouncer(
			120,
			(callback, delay) => {
				const handle = next++;
				timers.set(handle, { callback, delay });
				return handle;
			},
			(handle) => {
				timers.delete(handle as number);
			}
		);
		const runs: Array<[string, number]> = [];
		const fire = (): void => {
			const pending = Array.from(timers.values());
			timers.clear();
			for (const timer of pending) {
				timer.callback();
			}
		};

		const first = debouncer.schedule('first', (query, generation) => runs.push([query, generation]));
		assert.strictEqual(first, 1);
		assert.strictEqual(timers.size, 1);
		assert.strictEqual(Array.from(timers.values())[0].delay, 120);

		const second = debouncer.schedule('second', (query, generation) => runs.push([query, generation]));
		assert.strictEqual(second, 2);
		assert.strictEqual(timers.size, 1, 'the first timer is replaced');
		fire();
		assert.deepStrictEqual(runs, [['second', 2]], 'only the newest query runs');
		assert.strictEqual(debouncer.isCurrent(2), true);
		assert.strictEqual(debouncer.isCurrent(1), false, 'a first generation result is stale');

		const third = debouncer.schedule('third', (query, generation) => runs.push([query, generation]));
		assert.strictEqual(debouncer.isCurrent(2), false, 'scheduling immediately invalidates the previous token');
		debouncer.cancel();
		assert.strictEqual(timers.size, 0);
		assert.strictEqual(debouncer.isCurrent(third), false, 'cancel invalidates dispatched work');
		fire();
		assert.deepStrictEqual(runs, [['second', 2]], 'a cancelled query never runs');
	});

	test('design §4: flattenRows reports its own expansion decision', () => {
		const expandedFor = (collapsed?: ReadonlySet<string>, visible?: readonly boolean[]): Record<string, boolean> => {
			const out: Record<string, boolean> = {};
			for (const row of flattenRows(ROWS, { collapsed, visible })) {
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

		const forced = expandedFor(new Set(['m']), filterRows(ROWS, 'inivalue').visible);
		assert.strictEqual(forced.m, true, 'an active filter force-expands the collapsed ancestor');
		assert.strictEqual(forced.a, true);

		const noVisibleChild = expandedFor(undefined, filterRows(ROWS, 'conta').visible);
		assert.strictEqual(noVisibleChild.a, false, 'a filter-visible container with no visible child is not expanded');
	});

	test('design §4: ancestorIds is the one owner of the parent walk', () => {
		assert.deepStrictEqual(ancestorIds(ROWS, 'p1'), ['a', 'm'], 'nearest parent first');
		assert.deepStrictEqual(ancestorIds(ROWS, 'm'), [], 'a root has no ancestors');
		assert.deepStrictEqual(ancestorIds(ROWS, 'missing'), [], 'an unknown id resolves to nothing');

		const cyclic: FilterRow[] = [
			{ id: 'x', parentId: 'y', level: 1, subtreeSize: 0, hasChildren: false, haystack: 'x' },
			{ id: 'y', parentId: 'x', level: 2, subtreeSize: 0, hasChildren: false, haystack: 'y' },
		];
		assert.deepStrictEqual(ancestorIds(cyclic, 'x'), ['y'], 'a parent cycle stops instead of looping');
	});
});
