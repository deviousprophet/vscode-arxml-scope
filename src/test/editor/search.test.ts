/**
 * Search over the whole row store, its jump/selection policy and the two
 * highlight tiers (all matches plus the current match).
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
import { RowPayload, renderHtml } from '../../editor/renderHtml';
import { TreeRow, flattenRows, haystack, matchRanges, searchRows, stepMatch } from '../../editor/treeQuery';
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

const ROWS: TreeRow[] = [
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

	test('the whole row store is searched, even below a collapsed ancestor', () => {
		const collapsedDisplay = flattenRows(ROWS, { collapsed: new Set(['b']), braces: true });
		assert.ok(
			!collapsedDisplay.some((flat) => flat.type === 'node' && flat.rowIndex === 5),
			'the collapsed display hides the nested row'
		);
		assert.deepStrictEqual(searchRows(ROWS, 'nested'), [5], 'a collapsed row stays a candidate');
		assert.deepStrictEqual(searchRows(ROWS, 'title'), [3], 'siblings are candidates');
	});

	test('matchRanges finds every occurrence and haystack joins the searched fields', () => {
		assert.strictEqual(haystack({ label: 'IniValue', shortName: 'ContA', value: '63' }), 'inivalue conta 63');
		assert.strictEqual(haystack({ label: 'ContA' }), 'conta');
		assert.strictEqual(
			haystack({ label: 'Title', value: 'hello', meta: [{ text: '[Note] keep' }, { text: 'context A.B' }] }),
			'title hello [note] keep context a.b',
			'visible meta fragments are searchable'
		);
		assert.deepStrictEqual(matchRanges('IniValue', 'inivalue'), [{ start: 0, end: 8 }]);
		assert.deepStrictEqual(matchRanges('IniValue', 'i'), [
			{ start: 0, end: 1 },
			{ start: 2, end: 3 },
		]);
		assert.deepStrictEqual(matchRanges('aba', 'a'), [
			{ start: 0, end: 1 },
			{ start: 2, end: 3 },
		]);
		assert.deepStrictEqual(matchRanges('abc', 'zzz'), []);
		assert.deepStrictEqual(matchRanges('abc', ''), []);
		assert.deepStrictEqual(matchRanges('abc', '   '), []);
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

	test('the page serializes the chunked engine and the step helper', () => {
		const html = page();
		assert.ok(html.includes('class RowSearchEngine'), 'the chunked engine is in the page');
		assert.ok(html.includes('SEARCH_DEBOUNCE_MS = 120'));
		assert.ok(html.includes('SEARCH_CHUNK_BUDGET_MS = 24'));
		const inlinedStep = evaluateFunction<typeof stepMatch>(html, 'stepMatch');
		const inlinedRanges = evaluateFunction<typeof matchRanges>(html, 'matchRanges');
		for (const current of [-1, 0, 1, 2, 5]) {
			assert.strictEqual(inlinedStep([10, 20, 30], current, 1), stepMatch([10, 20, 30], current, 1));
			assert.strictEqual(inlinedStep([10, 20, 30], current, -1), stepMatch([10, 20, 30], current, -1));
		}
		for (const [text, query] of [['IniValue', 'i'], ['aba', 'a'], ['abc', '']] as Array<[string, string]>) {
			assert.deepStrictEqual(inlinedRanges(text, query), matchRanges(text, query));
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
		'searchInput',
		'searchBusy',
		`let searchRunning = false;
		${functionSource(html, 'renderSearchUi')}
		return function (query, matches, current, clear, prev, next, count) {
			searchQuery = query;
			searchMatches = matches;
			searchIndex = current;
			searchClear = clear;
			searchPrev = prev;
			searchNext = next;
			searchCount = count;
			searchInput.value = query;
			renderSearchUi();
		};`
	)({}, [], -1, null, null, null, null, { value: '' }, { dataset: {} }) as never;
}

interface StartSearchResult {
	run(query: string, previousId?: string, immediate?: boolean): void;
	progress(matches: number[]): void;
	complete(matches: number[]): void;
	state(): {
		query: string;
		matches: number[];
		index: number;
		running: boolean;
		jumps: number[];
		searched: string;
		immediate: boolean;
		cleared: number;
		ui: number;
		windows: number;
	};
}

function compileStartSearch(html: string, rows: TreeRow[]): StartSearchResult {
	const state = {
		jumps: [] as number[],
		running: false,
		searched: '',
		immediate: false,
		cleared: 0,
		ui: 0,
		windows: 0,
		handlers: null as {
			onProgressUpdate?(matches: number[]): void;
			onComplete(matches: number[]): void;
		} | null,
	};
	const rowIndexById = new Map(rows.map((row, at) => [row.id, at]));
	const searchEngine = {
		clear: () => {
			state.cleared++;
		},
		search: (
			_nextRows: readonly TreeRow[],
			query: string,
			nextHandlers: { onProgressUpdate?(matches: number[]): void; onComplete(matches: number[]): void },
			immediate: boolean
		) => {
			state.searched = query;
			state.immediate = immediate === true;
			state.handlers = nextHandlers;
		},
	};
	const result = new Function(
		'state',
		'rows',
		'rowIndexById',
		'searchEngine',
		`
		let searchQuery = '';
		let searchMatches = [];
		let searchIndex = -1;
		let highlightQuery = '';
		let searchFirstJumpDone = false;
		function resetSearchResults() {
			searchQuery = '';
			searchMatches = [];
			searchIndex = -1;
			highlightQuery = '';
			searchFirstJumpDone = false;
			state.running = false;
		}
		function setSearchBusy(busy) { state.running = busy === true; }
		function renderSearchUi() { state.ui++; }
		function renderWindow() { state.windows++; }
		function currentMatchId() {
			const rowIndex = searchMatches[searchIndex];
			const row = rowIndex === undefined ? undefined : rows[rowIndex];
			return row ? row.id : undefined;
		}
		${functionSource(html, 'searchIndexOfId')}
		function jumpToSearchMatch(index) { state.jumps.push(index); }
		${functionSource(html, 'startSearch')}
		return {
			run: startSearch,
			progress: function (matches) { state.handlers.onProgressUpdate(matches); },
			complete: function (matches) { state.handlers.onComplete(matches); },
			state: function () {
				return {
					query: searchQuery,
					matches: searchMatches,
					index: searchIndex,
					running: state.running,
					jumps: state.jumps.slice(),
					searched: state.searched,
					immediate: state.immediate,
					cleared: state.cleared,
					ui: state.ui,
					windows: state.windows
				};
			}
		};
	`
	)(state, rows, rowIndexById, searchEngine) as StartSearchResult;
	return result;
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
	highlightQuery: string
): (parent: FakeElement, text: string, query?: string) => void {
	return new Function(
		'highlightQuery',
		'matchRanges',
		'document',
		`${functionSource(html, 'appendHighlighted')}\nreturn appendHighlighted;`
	)(highlightQuery, matchRanges, fakeDocument()) as never;
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

interface ExecuteSearchState {
	query: string;
	start: number;
	cycle: number;
	reset: number;
}

function compileExecuteSearch(
	html: string,
	input: string,
	initialQuery = ''
): {
	run(direction?: number): ExecuteSearchState;
} {
	const state = { start: 0, cycle: 0, reset: 0 };
	const factory = new Function(
		'state',
		'input',
		'initialQuery',
		`
		let searchQuery = initialQuery;
		const searchInput = { value: input };
		function startSearch(query) { state.start++; searchQuery = query; }
		function cycleSearch(direction) { state.cycle++; state.direction = direction; }
		function resetSearchResults() { state.reset++; searchQuery = ''; }
		${functionSource(html, 'executeSearch')}
		return function (direction) {
			executeSearch(direction);
			return { query: searchQuery, start: state.start, cycle: state.cycle, reset: state.reset };
		};
	`
	);
	return { run: factory(state, input, initialQuery) as (direction?: number) => ExecuteSearchState };
}

function compileMetaSpan(
	html: string,
	highlightQuery: string
): (row: { meta: { cls: string; text: string; title: string }[] }) => FakeElement {
	return new Function(
		'highlightQuery',
		'matchRanges',
		'document',
		`${functionSource(html, 'appendHighlighted')}
${functionSource(html, 'metaSpan')}
return metaSpan;`
	)(highlightQuery, matchRanges, fakeDocument()) as never;
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
		let searchFirstJumpDone = false;
		const searchInput = { value: 'alp', focus: function () { state.focused = true; } };
		const searchEngine = { clear: function () { state.cleared = (state.cleared || 0) + 1; } };
		let searchUi = 0;
		let windows = 0;
		function renderSearchUi() { searchUi++; }
		function renderWindow() { windows++; }
		function setSearchBusy() {}
		${functionSource(html, 'resetSearchResults')}
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
	windows: number;
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
		function renderWindow() { state.windows++; }
		${functionSource(html, 'syncSearchToSelection')}
		return function (id) {
			syncSearchToSelection(id);
			return searchIndex;
		};
	`
	)(state) as (id: string) => number;
}

suite('search page', () => {
	test('the toolbar has one query field, a count and one clear control', () => {
		const html = page();
		const start = html.indexOf('<div class="toolbar">');
		const contentAt = html.indexOf('<div id="content"');
		assert.ok(start >= 0 && contentAt > start, 'the toolbar is a distinct strip');
		const toolbar = html.slice(start, contentAt);
		assert.strictEqual((toolbar.match(/<input\b/g) || []).length, 1, 'Search is the only query control');
		assert.ok(toolbar.includes('class="search-box"'), 'the search field owns the toolbar query area');
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
		assert.ok(/id="search-count"[^>]*class="search-count"[^>]*role="status"[^>]*aria-live="polite"/.test(toolbar));
		assert.ok(
			/id="search-busy"[^>]*class="search-progress"[^>]*role="status"[^>]*aria-label="Searching"[^>]*data-busy="false"/.test(
				toolbar
			)
		);
		assert.ok(
			toolbar.indexOf('id="collapse-all"') < toolbar.indexOf('class="search-box"') &&
				toolbar.indexOf('id="expand-all"') < toolbar.indexOf('class="search-box"') &&
				toolbar.lastIndexOf('class="search-box"') > toolbar.indexOf('id="expand-all"'),
			'Search closes the toolbar, after Collapse and Expand'
		);
		assert.strictEqual((html.match(/id="search-clear"/g) || []).length, 1);
		assert.ok(!html.includes('id="find"') && !html.includes('find-bar'), 'there is no separate find bar');
		assert.ok(!/style="/.test(toolbar), 'no inline styles');

		const searchField = /<div class="search-field">([\s\S]*?)<\/div>/.exec(html);
		assert.ok(searchField, 'the search field wraps the input and its X');
		assert.strictEqual((searchField[1].match(/<button\b/g) || []).length, 1, 'exactly one search X');
	});

	test('the shared field style and the narrow-width rule are used', () => {
		const style = styleOf(page());
		assert.ok(/input\[type="search"\]::-webkit-search-cancel-button/.test(style), 'native cancellation is suppressed');
		assert.ok(/input\[type="search"\]::-webkit-search-decoration/.test(style));
		assert.ok(/\.search-box\s*\{[^}]*display:\s*flex[^}]*gap:\s*3px/.test(style));
		assert.ok(/\.search-field\s*\{[^}]*position:\s*relative/.test(style));
		assert.ok(/\.search-field \.search-input\s*\{[^}]*padding:\s*0 22px 0 25px/.test(style), 'room for the icon and X');
		assert.ok(/\.search-icon\s*\{[^}]*--vscode-descriptionForeground/.test(style));
		assert.ok(
			/\.search-input:focus\s*\{[^}]*--vscode-focusBorder/.test(style),
			'the field focus border is visible'
		);
		assert.ok(
			/\.search-count\s*\{[^}]*width:\s*14ch[^}]*font-variant-numeric:\s*tabular-nums/.test(style),
			'the search count is a fixed tabular column'
		);
		assert.ok(/\.search-progress::before\s*\{[^}]*animation:\s*ecuc-search-spin/.test(style), 'the busy spinner lives in the toolbar');
		assert.ok(
			/\.search-progress\[data-busy="false"\]\s*\{[^}]*visibility:\s*hidden/.test(style),
			'the busy spinner keeps its slot instead of collapsing'
		);
		assert.ok(!/\.search-count\[hidden\]/.test(style), 'the count is never removed from the flow');
		assert.ok(
			/@media \(max-width: 720px\)[\s\S]*?\.search-box\s*\{[^}]*flex:\s*1 1 0/.test(style),
			'the field shrinks instead of overlapping the actions'
		);
		assert.ok(/\.search-box \.search-nav\s*\{[^}]*width:\s*28px[^}]*height:\s*26px/.test(style));
		assert.ok(/\.search-clear\s*\{[^}]*width:\s*18px[^}]*height:\s*18px/.test(style));
	});

	test('the count reads 1 / N, 0 / 0, or nothing; nav disables with no matches', () => {
		const render = compileSearchUi(page());
		const blank = { clear: controls(), prev: controls(), next: controls(), count: controls() };
		render('', [], -1, blank.clear, blank.prev, blank.next, blank.count);
		assert.strictEqual(blank.count.textContent, '');
		assert.strictEqual(blank.clear.hidden, true);
		assert.strictEqual(blank.prev.disabled, true);
		assert.strictEqual(blank.next.disabled, true);

		const empty = { clear: controls(), prev: controls(), next: controls(), count: controls() };
		render('zzz', [], -1, empty.clear, empty.prev, empty.next, empty.count);
		assert.strictEqual(empty.count.textContent, '0 / 0');
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

	test('startSearch streams the first match, then preserves the current row on completion', () => {
		const html = page();
		const rows: TreeRow[] = [
			{ id: 'r0', parentId: null, level: 1, subtreeSize: 0, hasChildren: false, haystack: 'alpha' },
			{ id: 'r1', parentId: null, level: 1, subtreeSize: 0, hasChildren: false, haystack: 'beta' },
			{ id: 'r2', parentId: null, level: 1, subtreeSize: 0, hasChildren: false, haystack: 'alpine' },
			{ id: 'r3', parentId: null, level: 1, subtreeSize: 0, hasChildren: false, haystack: 'gamma' },
			{ id: 'r4', parentId: null, level: 1, subtreeSize: 0, hasChildren: false, haystack: 'delta' },
		];
		const run = compileStartSearch(html, rows);
		run.run('alp', undefined, false);
		assert.strictEqual(run.state().searched, 'alp');
		assert.strictEqual(run.state().running, true, 'the busy state starts with the search');
		assert.deepStrictEqual(run.state().matches, [], 'no stale matches are kept');

		run.progress([0, 2]);
		assert.deepStrictEqual(run.state().matches, [0, 2]);
		assert.strictEqual(run.state().index, 0, 'the first streamed match is current');
		assert.deepStrictEqual(run.state().jumps, [0], 'and is jumped to once');
		assert.strictEqual(run.state().running, true, 'still scanning');

		run.complete([0, 2]);
		assert.strictEqual(run.state().running, false, 'completion clears the busy state');
		assert.strictEqual(run.state().index, 0, 'the current row is preserved by id');
		assert.deepStrictEqual(run.state().jumps, [0, 0], 'completion reselects the same match');
	});

	test('a re-scan restarts immediately and preserves the current row by id', () => {
		const html = page();
		const rows: TreeRow[] = [
			{ id: 'r0', parentId: null, level: 1, subtreeSize: 0, hasChildren: false, haystack: 'alpha' },
			{ id: 'r1', parentId: null, level: 1, subtreeSize: 0, hasChildren: false, haystack: 'beta' },
			{ id: 'r2', parentId: null, level: 1, subtreeSize: 0, hasChildren: false, haystack: 'alpine' },
		];
		const run = compileStartSearch(html, rows);
		run.run('alp', 'r2', true);
		assert.strictEqual(run.state().immediate, true, 'a re-scan skips the debounce');
		run.progress([0, 2]);
		assert.strictEqual(run.state().index, 1, 'the previous row is kept while streaming');
		assert.deepStrictEqual(run.state().jumps, [], 'streaming does not steal the selection on a re-scan');
		run.complete([0, 2]);
		assert.strictEqual(run.state().index, 1);
		assert.deepStrictEqual(run.state().jumps, [1], 'completion jumps to the preserved row');
	});

	test('a blank start clears the previous result set', () => {
		const html = page();
		const rows: TreeRow[] = [
			{ id: 'r0', parentId: null, level: 1, subtreeSize: 0, hasChildren: false, haystack: 'alpha' },
		];
		const run = compileStartSearch(html, rows);
		run.run('   ', undefined, false);
		assert.strictEqual(run.state().running, false);
		assert.deepStrictEqual(run.state().matches, []);
		assert.strictEqual(run.state().index, -1);
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

	test('executeSearch starts a changed query and cycles an executed one', () => {
		const html = page();
		const first = compileExecuteSearch(html, 'alp');
		assert.deepStrictEqual(first.run(1), { query: 'alp', start: 1, cycle: 0, reset: 0 }, 'first Enter starts');
		assert.deepStrictEqual(first.run(1), { query: 'alp', start: 1, cycle: 1, reset: 0 }, 'second Enter cycles');
		const blank = compileExecuteSearch(html, '   ');
		assert.deepStrictEqual(blank.run(1), { query: '', start: 0, cycle: 0, reset: 1 });
		const changed = compileExecuteSearch(html, 'bravo', 'alp');
		assert.deepStrictEqual(changed.run(1), { query: 'bravo', start: 1, cycle: 0, reset: 0 });
		const previous = compileExecuteSearch(html, 'alp', 'alp');
		assert.deepStrictEqual(previous.run(-1), { query: 'alp', start: 0, cycle: 1, reset: 0 });
	});

	test('clearing the search resets query/current/highlight', () => {
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
		compileHighlight(html, cleared.highlight)(label, 'IniValue');
		assert.deepStrictEqual(marksOf(label), [], 'a cleared search leaves no marks');

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
			windows: 0,
		};
		const sync = compileSyncSearch(html, state);
		assert.strictEqual(sync('r0'), 0, 'a match becomes current');
		assert.strictEqual(state.renders, 1, 'and the count is repainted');
		assert.strictEqual(state.windows, 1, 'and the stronger current mark moves');
		assert.strictEqual(sync('r1'), 0, 'a non-match leaves the current match alone');
		assert.strictEqual(state.renders, 1, 'without repainting the count');
		assert.strictEqual(sync('missing'), 0);

		const blank: SyncSearchState = { ...state, query: '  ', index: 1, renders: 0, windows: 0 };
		const ignore = compileSyncSearch(html, blank);
		assert.strictEqual(ignore('r0'), 1, 'a blank query is not a search');
		assert.strictEqual(blank.renders, 0);
		assert.strictEqual(blank.windows, 0);
	});

	test('search input, clear, nav, Ctrl+F, Escape, Enter and F3 are wired', () => {
		const html = page();
		const start = html.indexOf('if (searchInput) {');
		const end = html.indexOf('if (conditionsAdd) {');
		assert.ok(start >= 0 && end > start, 'the search wiring is a distinct block');
		const block = html.slice(start, end);
		assert.ok(block.includes("searchInput.addEventListener('input'"), 'typing updates the field');
		assert.ok(block.includes("searchInput.addEventListener('keydown'"), 'Enter is handled in the field');
		const inputAt = block.indexOf("searchInput.addEventListener('input'");
		const keydownAt = block.indexOf("searchInput.addEventListener('keydown'");
		const inputBlock = block.slice(inputAt, keydownAt);
		assert.ok(!inputBlock.includes('searchEngine.search'), 'typing never starts a scan');
		assert.ok(!inputBlock.includes('jumpToSearchMatch'), 'typing never jumps');
		assert.ok(inputBlock.includes('resetSearchResults()'), 'typing drops stale marks');
		assert.ok(block.includes('executeSearch(event.shiftKey ? -1 : 1)'), 'Enter runs or cycles');
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
		const execute = functionSource(html, 'executeSearch');
		assert.ok(execute.includes('startSearch(query, undefined, false)'), 'Enter starts a changed query');
		assert.ok(execute.includes('cycleSearch(direction === -1 ? -1 : 1)'), 'the same query cycles');
		const focusTree = functionSource(html, 'focusTreeAfterSearch');
		assert.ok(focusTree.includes('displayIndexById.has(selectedId)'), 'Escape returns to the selected row when visible');
		assert.ok(focusTree.includes('visibleNodeIds[0]'), 'otherwise to the first visible row');
	});

	test('search never changes rows or collapse state and a re-scan restarts it', () => {
		const html = page();
		for (const name of [
			'startSearch',
			'resetSearchResults',
			'executeSearch',
			'renderSearchUi',
			'clearSearch',
			'cycleSearch',
			'syncSearchToSelection',
		]) {
			const source = functionSource(html, name);
			assert.ok(!source.includes('collapsed'), `${name} never writes the collapsed set`);
			assert.ok(!source.includes('postMessage'), `${name} never messages the host`);
		}
		const jump = functionSource(html, 'jumpToSearchMatch');
		assert.ok(
			jump.includes("vscode.postMessage({ type: 'select', nodeId: id })"),
			'the jump persists its selection so a re-scan keeps it'
		);
		assert.strictEqual(jump.match(/postMessage/g)?.length, 1, 'the jump sends only the select message');
		assert.ok(
			functionSource(html, 'startSearch').includes('searchEngine.search('),
			'the chunked engine scans the whole store'
		);

		const setRows = functionSource(html, 'setRows');
		assert.ok(setRows.includes('const previousMatchId = currentMatchId();'));
		assert.ok(setRows.indexOf('currentMatchId()') < setRows.indexOf('rows = incoming'), 'the current match id is captured first');
		assert.ok(setRows.includes('startSearch(searchQuery, previousMatchId, true)'), 'the re-scan restarts immediately');
		assert.ok(!/searchQuery\s*=/.test(setRows), 'the query survives a re-scan');
		const rebuild = functionSource(html, 'rebuildDisplay');
		assert.ok(!rebuild.includes('visible:'), 'the display list has no query visibility input');

		const click = functionSource(html, 'onRowClick');
		assert.ok(click.indexOf('selectItem(item)') < click.indexOf('syncSearchToSelection(item.dataset.nodeId)'));
		const sync = functionSource(html, 'syncSearchToSelection');
		assert.ok(sync.includes('searchMatches.indexOf(rowIndex)') && sync.includes('searchIndex = at'));
		assert.ok(sync.includes('renderWindow(true)'), 'the current-mark repaint follows the index');
	});

	test('every match is marked and the current match gets the stronger mark', () => {
		const html = page();
		const text = 'IniValue ContA';
		const all = fakeElement();
		compileHighlight(html, 'inivalue')(all, text);
		assert.deepStrictEqual(marksOf(all), ['IniValue'], 'all occurrences of the query are marked');

		const explicit = fakeElement();
		compileHighlight(html, 'inivalue')(explicit, text, 'conta');
		assert.deepStrictEqual(marksOf(explicit), ['ContA'], 'an explicit query still bypasses the page fallback');
		assert.strictEqual(textOf(all), text, 'highlighting preserves the full text');

		const build = functionSource(html, 'buildNodeRow');
		assert.ok(build.includes("node.dataset.searchCurrent = 'true'"), 'the current row carries a data flag');
		assert.ok(build.includes('row.id === currentMatchId()'), 'and it is the row at the current index');
		const style = styleOf(html);
		assert.ok(
			/--match-bg:\s*rgba\(234, 179, 8, 0\.32\)/.test(style),
			'all matches use the fixed subtle yellow tier'
		);
		assert.ok(/--match-hi:\s*rgba\(234, 179, 8, 0\.7\)/.test(style), 'the current match uses the stronger tier');
		assert.ok(
			/\.node\[data-search-current="true"\] > \.row mark\s*\{[^}]*background:\s*var\(--match-hi\)/.test(style),
			'the current mark uses the stronger match background'
		);
		assert.ok(
			/mark\s*\{[^}]*background:\s*var\(--match-bg\)/.test(style),
			'the other marks keep the subtle highlight'
		);

		const diffDocument: DiffDocument = {
			left: { name: 'left.arxml', path: '/work/left.arxml' },
			right: { name: 'right.arxml', path: '/work/right.arxml' },
			labels: ['left.arxml', 'right.arxml'],
			rows: [],
			summary: { changed: 0, added: 0, removed: 0, unchanged: 0 },
		};
		assert.ok(
			renderDiffHtml(diffDocument, { nonce: 'test-nonce' }).includes("let highlightQuery = '';"),
			'the diff page still declares the shared highlight global'
		);
	});

	test('every visible meta fragment is highlighted, including context paths', () => {
		const html = page();
		const meta = compileMetaSpan(html, 'note');
		const row = {
			meta: [
				{ cls: 'short', text: '"ContA"', title: 'ContA' },
				{ cls: 'variant', text: '(VariantPreCompile)', title: 'VariantPreCompile' },
				{ cls: 'annotation', text: '[Note] keep', title: '[Note] keep' },
				{ cls: 'context', text: 'context A.Note', title: 'context A.Note' },
			],
		};
		assert.deepStrictEqual(marksOf(meta(row)), ['Note', 'Note'], 'annotation and context path matches');
		const context = compileMetaSpan(html, 'context');
		assert.deepStrictEqual(marksOf(context({ meta: [{ cls: 'context', text: 'context A.B', title: '' }] })), [
			'context',
		]);
	});

	test('the search label and count are owned by Search', () => {
		const html = page();
		const searchUi = functionSource(html, 'renderSearchUi');
		assert.ok(searchUi.includes("(searchIndex + 1) + ' / ' + searchMatches.length"), 'search prints current of total');
		assert.ok(searchUi.includes("'0 / 0'"), 'a query with no matches says 0 / 0');
		assert.ok(searchUi.includes('searchPrev.disabled = !hasMatches'));
		assert.ok(searchUi.includes('searchNext.disabled = !hasMatches'));
		assert.ok(html.includes('id="search-count"'));
		assert.ok(!html.includes('id="count"'), 'there is no second toolbar count');
	});
});
