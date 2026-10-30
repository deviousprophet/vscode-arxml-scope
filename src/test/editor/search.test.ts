/**
 * Search within the rows the filter displays (find-bar task; PRD R6-R14).
 *
 * There is no webview DOM in the test host. The pure candidate/step helpers are
 * imported, their page copies are compiled from `renderHtml`, and the page's own
 * search functions are driven with stubs where their dependencies are page state.
 * The live focus/scroll/inspector pass is the Extension Development Host check.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { DiffDocument } from '../../diff/diffModel';
import { renderDiffHtml } from '../../diff/diffPage';
import {
	FilterRow,
	buildFilterIndex,
	filterRows,
	flattenRows,
	haystack,
	matchRanges,
	searchRows,
	stepMatch,
} from '../../editor/filter';
import { RowPayload, renderHtml } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';
import { evaluateFunction, functionSource } from './scriptTestUtils';

const FIXTURE = 'editor/render.arxml';

function page(): string {
	return renderHtml(scanEcucValues(fixtureText(FIXTURE)), { nonce: 'test-nonce' });
}

function payload(source = page()): RowPayload {
	const match = /<script type="application\/json" id="ecuc-rows"[^>]*>([\s\S]*?)<\/script>/.exec(source);
	assert.ok(match, 'the page embeds the row document');
	return JSON.parse(match[1]) as RowPayload;
}

function styleOf(html: string): string {
	const match = /<style[^>]*>([\s\S]*?)<\/style>/.exec(html);
	assert.ok(match, 'one inlined style block');
	return match[1];
}

const ROWS: FilterRow[] = [
	{ id: 'm', parentId: null, level: 1, subtreeSize: 5, hasChildren: true, haystack: 'pkga.pkgb.moddefs.modx modx' },
	{ id: 'a', parentId: 'm', level: 2, subtreeSize: 2, hasChildren: true, haystack: 'conta conta' },
	{ id: 'p1', parentId: 'a', level: 3, subtreeSize: 0, hasChildren: false, haystack: 'inivalue 63' },
	{ id: 'p2', parentId: 'a', level: 3, subtreeSize: 0, hasChildren: false, haystack: 'title hello' },
	{ id: 'b', parentId: 'm', level: 2, subtreeSize: 1, hasChildren: true, haystack: 'contb contb' },
	{ id: 'p3', parentId: 'b', level: 3, subtreeSize: 0, hasChildren: false, haystack: 'text nested' },
];

suite('search helpers', () => {
	test('a blank query matches nothing; a query matches haystacks case-insensitively', () => {
		assert.deepStrictEqual(searchRows(ROWS, ''), []);
		assert.deepStrictEqual(searchRows(ROWS, '   '), []);
		assert.deepStrictEqual(searchRows(ROWS, 'inivalue'), [2]);
		assert.deepStrictEqual(searchRows(ROWS, '  INIVALUE  '), [2]);
		assert.deepStrictEqual(searchRows(ROWS, '63'), [2]);
		assert.deepStrictEqual(searchRows(ROWS, 'conta'), [1]);
		assert.deepStrictEqual(searchRows(ROWS, 'cont'), [1, 4], 'row order, not match order');
		assert.deepStrictEqual(searchRows(ROWS, 'nothing-matches-this'), []);
	});

	test('the visible flags are the only candidate restriction; collapse is not an input', () => {
		const filtered = filterRows(ROWS, 'inivalue');
		assert.deepStrictEqual(searchRows(ROWS, 'title', filtered.visible), [], 'a filter-hidden row is not a candidate');
		assert.deepStrictEqual(searchRows(ROWS, 'title'), [3], 'without the filter the whole tree is searched');
		assert.deepStrictEqual(searchRows(ROWS, 'nested', filtered.visible), [], 'a hidden subtree is not searched');
		assert.deepStrictEqual(searchRows(ROWS, 'nested'), [5], 'and is found with no filter even when ancestors are collapsed');

		const collapsedDisplay = flattenRows(ROWS, { collapsed: new Set(['b']), braces: true });
		assert.ok(
			!collapsedDisplay.some((flat) => flat.type === 'node' && flat.rowIndex === 5),
			'the collapsed display hides the nested row'
		);
		assert.deepStrictEqual(searchRows(ROWS, 'nested'), [5], 'a collapsed row stays a candidate');
	});

	test('stepMatch wraps in both directions and handles current = -1', () => {
		assert.strictEqual(stepMatch([], -1, 1), -1);
		assert.strictEqual(stepMatch([], 4, -1), -1);
		assert.strictEqual(stepMatch([10, 20, 30], -1, 1), 0, 'nothing current starts at the first');
		assert.strictEqual(stepMatch([10, 20, 30], -1, -1), 2, 'previous from nothing starts at the last');
		assert.strictEqual(stepMatch([10, 20, 30], 0, 1), 1);
		assert.strictEqual(stepMatch([10, 20, 30], 2, 1), 0, 'next wraps');
		assert.strictEqual(stepMatch([10, 20, 30], 0, -1), 2, 'previous wraps');
		assert.strictEqual(stepMatch([10, 20, 30], 99, 1), 0, 'an out-of-range current recovers');
		assert.strictEqual(stepMatch([10, 20, 30], 99, -1), 2);
	});

	test('the page serializes the same two helpers', () => {
		const html = page();
		const inlinedSearch = evaluateFunction<typeof searchRows>(html, 'searchRows');
		const inlinedStep = evaluateFunction<typeof stepMatch>(html, 'stepMatch');
		for (const query of ['', '  ', 'inivalue', 'CONT', 'nope']) {
			assert.deepStrictEqual(inlinedSearch(ROWS, query), searchRows(ROWS, query), query);
		}
		for (const current of [-1, 0, 1, 2, 5]) {
			assert.strictEqual(inlinedStep([10, 20, 30], current, 1), stepMatch([10, 20, 30], current, 1));
			assert.strictEqual(inlinedStep([10, 20, 30], current, -1), stepMatch([10, 20, 30], current, -1));
		}
	});
});

interface SearchControls {
	hidden: boolean;
	disabled: boolean;
	textContent: string;
}

function controls(): SearchControls {
	return { hidden: false, disabled: false, textContent: '' };
}

function compileSearchUi(
	html: string
): (
	query: string,
	matches: readonly number[],
	current: number,
	clear: SearchControls,
	prev: SearchControls,
	next: SearchControls,
	count: SearchControls
) => void {
	return new Function(
		'searchQuery',
		'searchMatches',
		'searchIndex',
		'searchClear',
		'searchPrev',
		'searchNext',
		'searchCount',
		`${functionSource(html, 'renderSearchUi')}
		return function (query, matches, current, clear, prev, next, count) {
			searchQuery = query;
			searchMatches = matches;
			searchIndex = current;
			searchClear = clear;
			searchPrev = prev;
			searchNext = next;
			searchCount = count;
			renderSearchUi();
		};`
	)() as never;
}

interface RefreshState {
	rows: FilterRow[];
	rowIndexById: Map<string, number>;
	searchQuery: string;
	filterResult: { visible: boolean[] } | null;
	searchMatches: number[];
	searchIndex: number;
	selectedId?: string;
	highlightQuery: string;
}

interface RefreshHarness {
	run(startAtSelection: boolean, previousId?: string): void;
	reindex(nextRows: FilterRow[]): void;
	state(): { matches: number[]; index: number; highlight: string };
}

function compileRefresh(html: string, initial: RefreshState): RefreshHarness {
	const source = ['searchCandidates', 'firstMatchAtOrAfterSelection', 'refreshSearch']
		.map((name) => functionSource(html, name))
		.join('\n');
	return new Function(
		'searchRows',
		'renderSearchUi',
		'renderWindow',
		'initial',
		`
		let rows = initial.rows;
		let rowIndexById = initial.rowIndexById;
		let searchQuery = initial.searchQuery;
		let filterResult = initial.filterResult;
		let searchMatches = initial.searchMatches;
		let searchIndex = initial.searchIndex;
		let selectedId = initial.selectedId;
		let highlightQuery = initial.highlightQuery;
		${source}
		return {
			run: refreshSearch,
			reindex: function (nextRows) {
				rows = nextRows;
				rowIndexById = new Map(nextRows.map(function (row, at) { return [row.id, at]; }));
			},
			state: function () {
				return { matches: searchMatches, index: searchIndex, highlight: highlightQuery };
			}
		};
	`
	)(searchRows, function () {}, function () {}, initial) as never;
}

function refreshState(overrides: Partial<RefreshState> = {}): RefreshState {
	const rows: FilterRow[] = [
		{ id: 'r0', parentId: null, level: 1, subtreeSize: 0, hasChildren: false, haystack: 'alpha' },
		{ id: 'r1', parentId: null, level: 1, subtreeSize: 0, hasChildren: false, haystack: 'beta' },
		{ id: 'r2', parentId: null, level: 1, subtreeSize: 0, hasChildren: false, haystack: 'alpine' },
		{ id: 'r3', parentId: null, level: 1, subtreeSize: 0, hasChildren: false, haystack: 'gamma' },
		{ id: 'r4', parentId: null, level: 1, subtreeSize: 0, hasChildren: false, haystack: 'delta' },
	];
	return {
		rows,
		rowIndexById: new Map(rows.map((row, at) => [row.id, at])),
		searchQuery: 'alp',
		filterResult: null,
		searchMatches: [],
		searchIndex: -1,
		highlightQuery: '',
		...overrides,
	};
}

interface JumpRecord {
	calls: string[];
	rebuilds: number;
	focusOptions: unknown[];
	messages: unknown[];
}

function runJump(
	html: string,
	options: { expanded?: boolean; displayIndex?: number; matches?: number[] } = {}
): JumpRecord {
	const record: JumpRecord = { calls: [], rebuilds: 0, focusOptions: [], messages: [] };
	const rows = [{ id: 'r0' }, { id: 'r1' }, { id: 'r2' }];
	const displayIndexById = new Map<string, number>();
	if (options.displayIndex !== undefined) {
		displayIndexById.set('r1', options.displayIndex);
	}
	const jump = new Function(
		'rows',
		'searchMatches',
		'expandAncestors',
		'rebuildDisplay',
		'displayIndexById',
		'ensureVisible',
		'setSelection',
		'renderWindow',
		'renderSearchUi',
		'searchInput',
		'vscode',
		`${functionSource(html, 'jumpToSearchMatch')}\nreturn jumpToSearchMatch;`
	)(
		rows,
		options.matches ?? [1],
		() => {
			record.calls.push('expand');
			return options.expanded === true;
		},
		() => {
			record.rebuilds++;
			record.calls.push('rebuild');
		},
		displayIndexById,
		(index: number) => record.calls.push('ensure:' + index),
		(id: string) => record.calls.push('select:' + id),
		() => record.calls.push('render'),
		() => record.calls.push('searchUi'),
		{
			focus: (opts: unknown) => {
				record.calls.push('focus');
				record.focusOptions.push(opts);
			},
		},
		{ postMessage: (message: unknown) => record.messages.push(message) }
	) as (index: number) => void;
	jump(0);
	return record;
}

interface FakeText {
	kind: 'text';
	text: string;
}

interface FakeElement {
	kind: 'element';
	className: string;
	title: string;
	dataset: Record<string, string>;
	textContent: string;
	children: FakeNode[];
	appendChild(child: FakeNode): void;
}

type FakeNode = FakeText | FakeElement;

function fakeElement(): FakeElement {
	return {
		kind: 'element',
		className: '',
		title: '',
		dataset: {},
		textContent: '',
		children: [],
		appendChild(child: FakeNode): void {
			this.children.push(child);
		},
	};
}

function fakeDocument(): {
	createElement(tag: string): FakeElement;
	createTextNode(text: string): FakeText;
} {
	return {
		createElement: (tag: string) => {
			const element = fakeElement();
			element.className = tag;
			return element;
		},
		createTextNode: (text: string) => ({ kind: 'text', text }),
	};
}

function textOf(node: FakeNode): string {
	if (node.kind === 'text') {
		return node.text;
	}
	return node.children.length === 0 ? node.textContent : node.children.map(textOf).join('');
}

function marksOf(node: FakeNode): string[] {
	if (node.kind === 'text') {
		return [];
	}
	const marks: string[] = [];
	for (const child of node.children) {
		if (child.kind === 'element' && child.className === 'mark') {
			marks.push(child.textContent);
		} else {
			marks.push(...marksOf(child));
		}
	}
	return marks;
}

function compileHighlight(
	html: string,
	filterQuery: string,
	highlightQuery: string
): (parent: FakeElement, text: string, query?: string) => void {
	return new Function(
		'filterQuery',
		'highlightQuery',
		'matchRanges',
		'document',
		`${functionSource(html, 'appendHighlighted')}\nreturn appendHighlighted;`
	)(filterQuery, highlightQuery, matchRanges, fakeDocument()) as never;
}

interface ClearSearchResult {
	query: string;
	matches: number[];
	index: number;
	highlight: string;
	value: string;
	focused: boolean;
	searchUi: number;
	windows: number;
}

function compileClearSearch(html: string): (focusInput: boolean) => ClearSearchResult {
	const state: { focused?: boolean } = {};
	return new Function(
		'state',
		`
		let searchQuery = 'alp';
		let searchMatches = [0, 2];
		let searchIndex = 1;
		let highlightQuery = 'alp';
		const searchInput = { value: 'alp', focus: function () { state.focused = true; } };
		let searchUi = 0;
		let windows = 0;
		function renderSearchUi() { searchUi++; }
		function renderWindow() { windows++; }
		${functionSource(html, 'clearSearch')}
		return function (focusInput) {
			clearSearch(focusInput);
			return {
				query: searchQuery,
				matches: searchMatches,
				index: searchIndex,
				highlight: highlightQuery,
				value: searchInput.value,
				focused: state.focused === true,
				searchUi: searchUi,
				windows: windows
			};
		};
	`
	)(state) as (focusInput: boolean) => ClearSearchResult;
}

interface SyncSearchState {
	query: string;
	rowIndexById: Map<string, number>;
	matches: number[];
	index: number;
	renders: number;
}

function compileSyncSearch(html: string, state: SyncSearchState): (id: string) => number {
	return new Function(
		'state',
		`
		let searchQuery = state.query;
		let rowIndexById = state.rowIndexById;
		let searchMatches = state.matches;
		let searchIndex = state.index;
		function renderSearchUi() { state.renders++; }
		${functionSource(html, 'syncSearchToSelection')}
		return function (id) {
			syncSearchToSelection(id);
			return searchIndex;
		};
	`
	)(state) as (id: string) => number;
}

suite('search page', () => {
	test('the toolbar has separate filter and search fields, a count and one X per field', () => {
		const html = page();
		const start = html.indexOf('<div class="toolbar">');
		const noticeAt = html.indexOf('<div id="notice"');
		assert.ok(start >= 0 && noticeAt > start, 'the toolbar is a distinct strip');
		const toolbar = html.slice(start, noticeAt);
		assert.ok(toolbar.includes('class="filter-wrap"'), 'the filter keeps its wrapper');
		assert.ok(/id="filter"[^>]*class="filter"[^>]*type="search"[^>]*aria-label="Filter the ECUC tree"/.test(toolbar));
		assert.ok(toolbar.includes('class="search-box"'), 'the search field is a toolbar sibling');
		assert.ok(
			/id="search-input"[^>]*class="search-input"[^>]*type="search"[^>]*aria-label="Search the ECUC tree"/.test(toolbar),
			'the search field uses the shared input style and an accessible name'
		);
		assert.ok(toolbar.includes('class="search-icon" aria-hidden="true"'), 'the magnifier is decorative');
		assert.ok(/id="search-clear"[^>]*class="[^"]*nav-btn[^"]*search-clear[^"]*"[^>]*\shidden(?=[\s>])/.test(toolbar));
		assert.ok(/id="search-clear"[^>]*aria-label="Clear search"/.test(toolbar), 'the clear action has a name');
		assert.ok(/id="search-prev"[^>]*class="[^"]*nav-btn[^"]*"[^>]*\sdisabled(?=[\s>])/.test(toolbar));
		assert.ok(/id="search-prev"[^>]*aria-label="Previous match"/.test(toolbar), 'previous has a name');
		assert.ok(/id="search-next"[^>]*class="[^"]*nav-btn[^"]*"[^>]*\sdisabled(?=[\s>])/.test(toolbar));
		assert.ok(/id="search-next"[^>]*aria-label="Next match"/.test(toolbar), 'next has a name');
		assert.ok(/id="search-count"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden/.test(toolbar));
		assert.strictEqual((html.match(/id="filter-clear"/g) || []).length, 1);
		assert.strictEqual((html.match(/id="search-clear"/g) || []).length, 1);
		assert.ok(!html.includes('id="find"') && !html.includes('find-bar'), 'there is no separate find bar');
		assert.ok(!/style="/.test(toolbar), 'no inline styles');

		const filterWrap = /<div class="filter-wrap">([\s\S]*?)<\/div>/.exec(html);
		assert.ok(filterWrap, 'the filter wrapper is emitted');
		assert.strictEqual((filterWrap[1].match(/<button\b/g) || []).length, 1, 'exactly one filter X');
		const searchField = /<div class="search-field">([\s\S]*?)<\/div>/.exec(html);
		assert.ok(searchField, 'the search field wraps the input and its X');
		assert.strictEqual((searchField[1].match(/<button\b/g) || []).length, 1, 'exactly one search X');
	});

	test('the shared field style, count and narrow-width rules are used', () => {
		const style = styleOf(page());
		assert.ok(/input\[type="search"\]::-webkit-search-cancel-button/.test(style), 'native cancellation is suppressed');
		assert.ok(/input\[type="search"\]::-webkit-search-decoration/.test(style));
		assert.ok(/\.search-box\s*\{[^}]*display:\s*flex[^}]*gap:\s*3px/.test(style));
		assert.ok(/\.search-field\s*\{[^}]*position:\s*relative/.test(style));
		assert.ok(/\.search-field \.search-input\s*\{[^}]*padding:\s*0 22px 0 25px/.test(style), 'room for the icon and X');
		assert.ok(/\.search-icon\s*\{[^}]*--vscode-descriptionForeground/.test(style));
		assert.ok(
			/\.filter:focus,\s*\.search-input:focus\s*\{[^}]*--vscode-focusBorder/.test(style),
			'the shared field focus border is visible'
		);
		assert.ok(
			/\.search-count\s*\{[^}]*width:\s*14ch[^}]*font-variant-numeric:\s*tabular-nums/.test(style),
			'the search count is a fixed tabular column'
		);
		assert.ok(/\.count\s*\{[^}]*font-variant-numeric:\s*tabular-nums/.test(style), 'the filter count is tabular too');
		assert.ok(/\.search-count\[hidden\]\s*\{[^}]*display:\s*none/.test(style));
		assert.ok(
			/@media \(max-width: 720px\)[\s\S]*?\.filter-wrap\s*\{[^}]*flex:\s*1 1 0[\s\S]*?\.search-box\s*\{[^}]*flex:\s*1 1 0/.test(style),
			'both fields shrink instead of overlapping the actions'
		);
		assert.ok(/\.search-box \.search-nav\s*\{[^}]*width:\s*28px[^}]*height:\s*26px/.test(style));
		assert.ok(/\.filter-clear,\s*\.search-clear\s*\{[^}]*width:\s*18px[^}]*height:\s*18px/.test(style));
	});

	test('the count reads 1 / N, 0 / 0, or hides; nav disables with no matches', () => {
		const render = compileSearchUi(page());
		const blank = { clear: controls(), prev: controls(), next: controls(), count: controls() };
		render('', [], -1, blank.clear, blank.prev, blank.next, blank.count);
		assert.strictEqual(blank.count.textContent, '');
		assert.strictEqual(blank.count.hidden, true, 'a blank query hides the count');
		assert.strictEqual(blank.clear.hidden, true);
		assert.strictEqual(blank.prev.disabled, true);
		assert.strictEqual(blank.next.disabled, true);

		const empty = { clear: controls(), prev: controls(), next: controls(), count: controls() };
		render('zzz', [], -1, empty.clear, empty.prev, empty.next, empty.count);
		assert.strictEqual(empty.count.textContent, '0 / 0');
		assert.strictEqual(empty.count.hidden, false);
		assert.strictEqual(empty.prev.disabled, true);
		assert.strictEqual(empty.next.disabled, true);
		assert.strictEqual(empty.clear.hidden, false, 'a query still has a clear action');

		const first = { clear: controls(), prev: controls(), next: controls(), count: controls() };
		render('al', [0, 2, 5], 0, first.clear, first.prev, first.next, first.count);
		assert.strictEqual(first.count.textContent, '1 / 3');
		assert.strictEqual(first.prev.disabled, false);
		assert.strictEqual(first.next.disabled, false);

		const middle = { clear: controls(), prev: controls(), next: controls(), count: controls() };
		render('al', [0, 2, 5], 2, middle.clear, middle.prev, middle.next, middle.count);
		assert.strictEqual(middle.count.textContent, '3 / 3');
	});

	test('typing starts at the selection; a filter/re-scan keeps the current match by id', () => {
		const html = page();
		const first = compileRefresh(html, refreshState());
		first.run(true);
		assert.deepStrictEqual(first.state(), { matches: [0, 2], index: 0, highlight: 'alp' }, 'no selection starts at the first');

		const later = compileRefresh(html, refreshState({ selectedId: 'r1' }));
		later.run(true);
		assert.deepStrictEqual(
			later.state(),
			{ matches: [0, 2], index: 1, highlight: 'alp' },
			'the first match at/after the selection'
		);

		const wrap = compileRefresh(html, refreshState({ selectedId: 'r4', searchMatches: [0, 2], searchIndex: 1 }));
		wrap.run(true);
		assert.deepStrictEqual(
			wrap.state(),
			{ matches: [0, 2], index: 0, highlight: 'alp' },
			'all matches before the selection wrap to the first'
		);

		const preserve = compileRefresh(html, refreshState({ searchMatches: [0, 2], searchIndex: 1, selectedId: 'r3' }));
		preserve.run(false, 'r2');
		assert.deepStrictEqual(
			preserve.state(),
			{ matches: [0, 2], index: 1, highlight: 'alp' },
			'the current row stays current when it remains a candidate'
		);

		const baseRows = refreshState().rows;
		const reordered = [baseRows[2], baseRows[4], baseRows[3], baseRows[1], baseRows[0]];
		const rescanned = compileRefresh(html, refreshState({ searchMatches: [0, 2], searchIndex: 1 }));
		rescanned.reindex(reordered);
		rescanned.run(false, 'r2');
		assert.deepStrictEqual(
			rescanned.state(),
			{ matches: [0, 4], index: 0, highlight: 'alp' },
			'a re-scan that shifts row indices keeps the current match by id, not by old index'
		);

		const filtered = compileRefresh(
			html,
			refreshState({
				searchMatches: [0, 2],
				searchIndex: 1,
				filterResult: { visible: [false, false, true, false, false] },
			})
		);
		filtered.run(false, 'r0');
		assert.deepStrictEqual(
			filtered.state(),
			{ matches: [2], index: 0, highlight: 'alp' },
			'the filter restricts candidates and the first remaining match is current'
		);

		const none = compileRefresh(html, refreshState({ searchQuery: 'zzz', searchMatches: [0, 2], searchIndex: 1 }));
		none.run(true);
		assert.deepStrictEqual(none.state(), { matches: [], index: -1, highlight: 'zzz' });

		const cleared = compileRefresh(html, refreshState({ searchQuery: '', searchMatches: [0, 2], searchIndex: 1 }));
		cleared.run(true);
		assert.deepStrictEqual(cleared.state(), { matches: [], index: -1, highlight: '' }, 'a blank query clears the highlight override');
	});

	test('a search jump expands ancestors, scrolls, selects and keeps focus in the input', () => {
		const html = page();
		const expanded = runJump(html, { expanded: true, displayIndex: 7 });
		assert.deepStrictEqual(expanded.calls, ['expand', 'rebuild', 'ensure:7', 'select:r1', 'render', 'searchUi', 'focus']);
		assert.deepStrictEqual(expanded.focusOptions, [{ preventScroll: true }], 'Enter can repeat from the input');

		const alreadyVisible = runJump(html, { expanded: false, displayIndex: 2 });
		assert.deepStrictEqual(alreadyVisible.calls, ['expand', 'ensure:2', 'select:r1', 'render', 'searchUi', 'focus']);
		assert.strictEqual(alreadyVisible.rebuilds, 0, 'no rebuild when nothing was collapsed');
		assert.deepStrictEqual(expanded.messages, [{ type: 'select', nodeId: 'r1' }], 'the host keeps the search selection across a re-scan');
		assert.deepStrictEqual(alreadyVisible.messages, [{ type: 'select', nodeId: 'r1' }]);

		const undisplayed = runJump(html, { expanded: false });
		assert.deepStrictEqual(undisplayed.calls, ['expand', 'searchUi'], 'an undisplayed target is not selected or focused');
		assert.deepStrictEqual(undisplayed.messages, [], 'an impossible jump does not move the host selection');

		const source = functionSource(html, 'jumpToSearchMatch');
		assert.ok(!source.includes('focusRow('), 'the tree is selected without taking focus');
		const order = ['expandAncestors(id)', 'ensureVisible(displayIndex)', 'setSelection(id)', 'renderWindow(true)'];
		const positions = order.map((needle) => source.indexOf(needle));
		assert.ok(positions.every((at) => at >= 0), 'every jump step is present');
		assert.deepStrictEqual([...positions].sort((a, b) => a - b), positions, 'the steps run in the designed order');
	});

	test('clearing the search resets query/current/highlight and restores the filter marks', () => {
		const html = page();
		const clear = compileClearSearch(html);
		const cleared = clear(false);
		assert.deepStrictEqual(cleared, {
			query: '',
			matches: [],
			index: -1,
			highlight: '',
			value: '',
			focused: false,
			searchUi: 1,
			windows: 1,
		});

		const label = fakeElement();
		compileHighlight(html, 'IniValue', cleared.highlight)(label, 'IniValue');
		assert.deepStrictEqual(marksOf(label), ['IniValue'], 'the filter query marks the row again');

		const refocused = clear(true);
		assert.strictEqual(refocused.focused, true, 'the clear X keeps focus in the field');
		assert.strictEqual(refocused.searchUi, 2);
		assert.strictEqual(refocused.windows, 2);
	});

	test('clicking a matching row makes it the current match; other rows do not', () => {
		const html = page();
		const state: SyncSearchState = {
			query: 'alp',
			rowIndexById: new Map([
				['r0', 0],
				['r1', 1],
				['r2', 2],
			]),
			matches: [0, 2],
			index: 1,
			renders: 0,
		};
		const sync = compileSyncSearch(html, state);
		assert.strictEqual(sync('r0'), 0, 'a match becomes current');
		assert.strictEqual(state.renders, 1, 'and the count is repainted');
		assert.strictEqual(sync('r1'), 0, 'a non-match leaves the current match alone');
		assert.strictEqual(state.renders, 1, 'without repainting the count');
		assert.strictEqual(sync('missing'), 0);

		const blank: SyncSearchState = { ...state, query: '  ', index: 1, renders: 0 };
		const ignore = compileSyncSearch(html, blank);
		assert.strictEqual(ignore('r0'), 1, 'a blank query is not a search');
		assert.strictEqual(blank.renders, 0);
	});

	test('search input, clear, nav, Ctrl+F, Escape, Enter and F3 are wired', () => {
		const html = page();
		const start = html.indexOf('if (searchInput) {');
		const end = html.indexOf('if (conditionsAdd) {');
		assert.ok(start >= 0 && end > start, 'the search wiring is a distinct block');
		const block = html.slice(start, end);
		assert.ok(block.includes("searchInput.addEventListener('input'"), 'typing is live');
		assert.ok(block.includes('searchQuery = searchInput.value'));
		assert.ok(block.includes('refreshSearch(true, undefined, false)'));
		assert.ok(block.includes('jumpToSearchMatch(searchIndex)'));
		assert.ok(block.includes("event.key === 'Enter'") && block.includes('cycleSearch(event.shiftKey ? -1 : 1)'));
		assert.ok(block.includes("event.key === 'Escape'"));
		assert.ok(block.includes('clearSearch(false)') && block.includes('focusTreeAfterSearch()'));
		assert.ok(block.includes('clearSearch(true)'), 'the X keeps focus in the field');
		assert.ok(block.includes('cycleSearch(-1)') && block.includes('cycleSearch(1)'));
		assert.ok(block.includes("event.key.toLowerCase() === 'f'"), 'Ctrl/Cmd+F focuses the field');
		assert.ok(block.includes('searchInput.focus();') && block.includes('searchInput.select();'));
		assert.ok(block.includes("event.key === 'F3'") && block.includes("searchQuery.trim() !== ''"));
		const f3At = block.indexOf("event.key === 'F3'");
		assert.ok(f3At >= 0);
		assert.ok(
			block.slice(f3At).includes('cycleSearch(event.shiftKey ? -1 : 1)'),
			'F3 goes forward and Shift+F3 backward'
		);
		const focusTree = functionSource(html, 'focusTreeAfterSearch');
		assert.ok(focusTree.includes('displayIndexById.has(selectedId)'), 'Escape returns to the selected row when visible');
		assert.ok(focusTree.includes('visibleNodeIds[0]'), 'otherwise to the first visible row');
	});

	test('search never changes filter visibility or count, and a filter change recomputes it', () => {
		const html = page();
		for (const name of [
			'refreshSearch',
			'searchCandidates',
			'renderSearchUi',
			'clearSearch',
			'cycleSearch',
			'syncSearchToSelection',
		]) {
			const source = functionSource(html, name);
			assert.ok(!/filterQuery\s*=/.test(source), `${name} never writes the filter query`);
			assert.ok(!/filterResult\s*=/.test(source), `${name} never writes the filter result`);
			assert.ok(!/updateFilterUi\s*\(/.test(source), `${name} never repaints the filter count`);
			assert.ok(!source.includes('postMessage'), `${name} never messages the host`);
		}
		const jump = functionSource(html, 'jumpToSearchMatch');
		assert.ok(
			jump.includes("vscode.postMessage({ type: 'select', nodeId: id })"),
			'the jump persists its selection so a re-scan keeps it'
		);
		assert.strictEqual(jump.match(/postMessage/g)?.length, 1, 'the jump sends only the select message');
		const apply = functionSource(html, 'applyFilterQuery');
		assert.ok(apply.includes('refreshSearch(false, previousMatchId)'), 'the filter recomputes search candidates');
		assert.ok(apply.indexOf('refreshFilter()') < apply.indexOf('refreshSearch('), 'after the filter result exists');
		assert.ok(apply.indexOf('updateFilterUi()') < apply.indexOf('refreshSearch('), 'and after the filter count is painted');
		assert.ok(!apply.includes('clearSearch'), 'the filter never clears search');
		assert.ok(!apply.includes("filterQuery = ''"), 'and never clears itself');

		const setRows = functionSource(html, 'setRows');
		assert.ok(setRows.includes('const previousMatchId = currentMatchId();'));
		assert.ok(setRows.indexOf('currentMatchId()') < setRows.indexOf('rows = incoming'), 'the current match id is captured first');
		assert.ok(setRows.includes('refreshSearch(false, previousMatchId)'), 'the re-scan recomputes over the new rows');
		assert.ok(!/searchQuery\s*=/.test(setRows), 'the query survives a re-scan');

		const click = functionSource(html, 'onRowClick');
		assert.ok(click.indexOf('selectItem(item)') < click.indexOf('syncSearchToSelection(item.dataset.nodeId)'));
		const sync = functionSource(html, 'syncSearchToSelection');
		assert.ok(sync.includes('searchMatches.indexOf(rowIndex)') && sync.includes('searchIndex = at'));
	});

	test('an active filter restricts candidates, and the cleared filter restores filter highlighting', () => {
		const html = page();
		const rows = payload(html).rows;
		const index = buildFilterIndex(rows);
		const filter = filterRows(rows, 'IniValue', index);
		const titleAt = rows.findIndex((row) => row.label === 'Title');
		const contAt = rows.findIndex((row) => row.label === 'ContA');
		const iniAt = rows.findIndex((row) => row.label === 'IniValue');
		assert.ok(titleAt >= 0 && contAt >= 0 && iniAt >= 0);
		assert.strictEqual(filter.visible[titleAt], false, 'the filter hides the sibling');
		assert.deepStrictEqual(searchRows(rows, 'Title', filter.visible), [], 'so Title is not a search candidate');
		assert.deepStrictEqual(searchRows(rows, 'Title'), [titleAt], 'without the filter it is found');
		assert.deepStrictEqual(searchRows(rows, 'ContA', filter.visible), [contAt], 'context ancestors stay candidates');
		assert.deepStrictEqual(searchRows(rows, 'IniValue', filter.visible), [iniAt]);
		const snapshot = {
			matches: filter.matches.slice(),
			visible: filter.visible.slice(),
			matchCount: filter.matchCount,
			visibleCount: filter.visibleCount,
		};
		searchRows(rows, 'ContA', filter.visible);
		searchRows(rows, 'IniValue');
		assert.deepStrictEqual(filter, snapshot, 'searchRows does not mutate the filter result');

		const filterAppend = compileHighlight(html, 'IniValue', '');
		const filteredLabel = fakeElement();
		filterAppend(filteredLabel, 'IniValue');
		assert.deepStrictEqual(marksOf(filteredLabel), ['IniValue'], 'the filter query is the fallback highlight');
	});

	test('search highlighting takes precedence over the filter until the query is cleared', () => {
		const html = page();
		const text = 'IniValue ContA';
		const filterOnly = fakeElement();
		compileHighlight(html, 'cont', '')(filterOnly, text);
		assert.deepStrictEqual(marksOf(filterOnly), ['Cont'], 'the filter marks its own query');

		const searchWins = fakeElement();
		compileHighlight(html, 'cont', 'inivalue')(searchWins, text);
		assert.deepStrictEqual(marksOf(searchWins), ['IniValue'], 'the search query wins while non-blank');

		const blankSearch = fakeElement();
		compileHighlight(html, 'cont', '   ')(blankSearch, text);
		assert.deepStrictEqual(marksOf(blankSearch), ['Cont'], 'a blank search restores the filter marks');

		const explicit = fakeElement();
		compileHighlight(html, 'cont', 'inivalue')(explicit, text, 'conta');
		assert.deepStrictEqual(marksOf(explicit), ['ContA'], 'an explicit query still bypasses the page fallback');

		const appendSource = functionSource(html, 'appendHighlighted');
		assert.ok(appendSource.includes("typeof highlightQuery === 'string' && highlightQuery.trim() !== ''"));
		assert.ok(appendSource.includes(': filterQuery'));
		assert.ok(html.includes("let highlightQuery = '';"), 'the editor page declares the override');
		const diffDocument: DiffDocument = {
			left: { name: 'left.arxml', path: '/work/left.arxml' },
			right: { name: 'right.arxml', path: '/work/right.arxml' },
			rows: [],
			summary: { changed: 0, added: 0, removed: 0, unchanged: 0 },
		};
		assert.ok(
			renderDiffHtml(diffDocument, { nonce: 'test-nonce' }).includes("let highlightQuery = '';"),
			'the diff page declares it too'
		);
		assert.strictEqual(textOf(filterOnly), text, 'highlighting preserves the full text');
	});

	test('the search label and count are independent from the filter count', () => {
		const html = page();
		const filterUi = functionSource(html, 'updateFilterUi');
		assert.ok(filterUi.includes("filterResult.visibleCount + ' of ' + rows.length"), 'the filter count keeps its shown-of-total text');
		const searchUi = functionSource(html, 'renderSearchUi');
		assert.ok(searchUi.includes("(searchIndex + 1) + ' / ' + searchMatches.length"), 'search prints current of total');
		assert.ok(searchUi.includes("'0 / 0'"), 'a query with no matches says 0 / 0');
		assert.ok(searchUi.includes('searchPrev.disabled = !hasMatches'));
		assert.ok(searchUi.includes('searchNext.disabled = !hasMatches'));
		assert.ok(!searchUi.includes('visibleCount'), 'search never rewrites the filter count');
		assert.ok(html.includes('id="count"') && html.includes('id="search-count"'), 'both counts exist');
		assert.strictEqual(haystack({ label: 'IniValue', shortName: 'ContA', value: '63' }), 'inivalue conta 63');
	});
});
