/**
 * Search over the whole row store: pure matching rules, then the mounted page's
 * Enter/F3/clear flow. The chunked engine's own timing is covered in
 * `render/rowSearch.test.ts`.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../../core/ecuc/scanner';
import { buildRows } from '../../../core/ecuc/renderRows';
import { SORT_EXCEPTIONS } from '../../../core/ecuc/order';
import { RowSearchEngine } from '../../../webview/render/rowSearch';
import { TreeRow, flattenRows, haystack, matchRanges, searchRows, stepMatch } from '../../../webview/render/treeQuery';
import { fixtureText } from '../../core/modelTestUtils';
import { webviewCss } from '../cssTestUtils';
import { installDom, loadModule, messagesOf, settleSearch, treeRows } from '../pageTestUtils';

const ROWS: TreeRow[] = [
	{ id: 'm', parentId: null, level: 1, subtreeSize: 5, hasChildren: true, haystack: 'pkga.pkgb.moddefs.modx modx' },
	{ id: 'a', parentId: 'm', level: 2, subtreeSize: 2, hasChildren: true, haystack: 'conta conta' },
	{ id: 'p1', parentId: 'a', level: 3, subtreeSize: 0, hasChildren: false, haystack: 'inivalue 63' },
	{ id: 'p2', parentId: 'a', level: 3, subtreeSize: 0, hasChildren: false, haystack: 'title hello' },
	{ id: 'b', parentId: 'm', level: 2, subtreeSize: 1, hasChildren: true, haystack: 'contb contb' },
	{ id: 'p3', parentId: 'b', level: 3, subtreeSize: 0, hasChildren: false, haystack: 'text nested' },
];

function mountEditor(): ReturnType<typeof installDom> {
	const dom = installDom('editor');
	loadModule<typeof import('../../../webview/editorViewer')>('../../webview/editorViewer').mountEditor();
	const model = scanEcucValues(fixtureText('editor/render.arxml'));
	dom.post({
		type: 'document',
		document: { rows: buildRows(model, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows },
	});
	return dom;
}

async function runSearch(dom: ReturnType<typeof installDom>, query: string, key = 'Enter'): Promise<void> {
	const input = dom.document.getElementById('search-input') as HTMLInputElement;
	input.value = query;
	input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
	input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
	await settleSearch();
}

function isKeywordQuery(query: string): boolean {
	return query === 'package' || query === 'pack' || query === 'schema' || query === 'sche';
}

function assertHeaderMatch(dom: ReturnType<typeof installDom>, query: string): void {
	const headerRow = dom.document.querySelector(
		'#tree .document-tree-header-row[data-search-current="true"]'
	) as HTMLElement | null;
	assert.ok(headerRow, `${query}: the header row is the current match`);
	const mark = headerRow.querySelector('mark');
	assert.ok(mark, `${query}: the matched header text is marked`);
	assert.ok(
		(mark.textContent ?? '').toLowerCase().includes(query.toLowerCase()),
		`${query}: the mark covers the match`
	);
	if (isKeywordQuery(query)) {
		assert.ok(headerRow.querySelector('.keyword mark'), `${query}: the keyword is marked`);
	} else {
		assert.ok(
			headerRow.querySelector('.package mark, .number mark'),
			`${query}: the value is marked`
		);
	}
	assert.strictEqual(messagesOf(dom.api, 'select').length, 0, `${query}: a header jump never selects`);
}

async function settleFrame(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 10));
}

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
});

suite('search page', () => {
	test('SEARCH-01 a query that exists only in meta text finds the row', async () => {
		const dom = mountEditor();
		try {
			await runSearch(dom, 'context');
			const current = dom.document.querySelector('#tree [data-search-current="true"]');
			assert.ok(current, 'the meta-only token matches');
			assert.strictEqual(current.querySelector('.label')?.textContent, 'PeerIref');
		} finally {
			dom.restore();
		}
	});

	test('SEARCH-03 a documentPatch updates the searched haystack', async () => {
		const dom = mountEditor();
		try {
			const model = scanEcucValues(fixtureText('editor/render.arxml'));
			const rows = buildRows(model, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows;
			dom.post({
				type: 'documentPatch',
				patch: { at: 1, remove: 1, rows: [{ ...rows[1], haystack: `${rows[1].haystack} zzz-meta` }], structural: false }
			});
			await runSearch(dom, 'zzz-meta');
			const count = dom.document.getElementById('search-count')!.textContent || '';
			assert.ok(count.length > 0, `the patched row is in the result set (${count})`);
			assert.ok(dom.document.querySelector('#tree [data-search-current="true"]'), 'the patched row is the current match');
		} finally {
			dom.restore();
		}
	});

	test('Enter jumps to the first match, marks every match and selects it', async () => {
		const dom = mountEditor();
		try {
			await runSearch(dom, 'IniValue');
			assert.ok(/^1 \/ [1-9]/.test(dom.document.getElementById('search-count')!.textContent || ''));
			assert.strictEqual(dom.document.getElementById('search-busy')!.getAttribute('data-busy'), 'false');
			const current = dom.document.querySelector('#tree [data-search-current="true"]');
			assert.ok(current, 'the current match is marked');
			assert.strictEqual(current.querySelector('.label')!.textContent, 'IniValue');
			assert.ok(current.innerHTML.includes('<mark>IniValue</mark>'), 'the match text is marked');
			assert.ok(messagesOf(dom.api, 'select').length >= 1, 'the jump selects the row in the host');
		} finally {
			dom.restore();
		}
	});

	test('F3 cycles the current match and Shift+F3 goes back', async () => {
		const dom = mountEditor();
		try {
			await runSearch(dom, 'Cont');
			const first = dom.document.querySelector('#tree [data-search-current="true"]')!.getAttribute('data-node-id');
			dom.document.dispatchEvent(
				new dom.window.KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true })
			);
			const second = dom.document.querySelector('#tree [data-search-current="true"]')!.getAttribute('data-node-id');
			assert.notStrictEqual(second, first, 'F3 moves to the next match');
			dom.document.dispatchEvent(
				new dom.window.KeyboardEvent('keydown', { key: 'F3', shiftKey: true, bubbles: true, cancelable: true })
			);
			const third = dom.document.querySelector('#tree [data-search-current="true"]')!.getAttribute('data-node-id');
			assert.strictEqual(third, first, 'Shift+F3 returns');
		} finally {
			dom.restore();
		}
	});

	test('clearing resets the count and removes the highlight', async () => {
		const dom = mountEditor();
		try {
			await runSearch(dom, 'IniValue');
			(dom.document.getElementById('search-clear') as HTMLElement).click();
			assert.strictEqual(dom.document.getElementById('search-count')!.textContent, '');
			assert.strictEqual(dom.document.querySelector('#tree mark'), null, 'no stale highlight');
			assert.strictEqual((dom.document.getElementById('search-input') as HTMLInputElement).value, '');
		} finally {
			dom.restore();
		}
	});

	test('Ctrl+F focuses Search from the tree', () => {
		const dom = mountEditor();
		try {
			treeRows(dom.document)[0].dispatchEvent(
				new dom.window.KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
			);
			assert.strictEqual(dom.document.activeElement, dom.document.getElementById('search-input'));
		} finally {
			dom.restore();
		}
	});

	test('schema/package rows are searchable, focusable and never select', async () => {
		const dom = mountEditor();
		try {
			const model = scanEcucValues(fixtureText('editor/render.arxml'));
			dom.post({
				type: 'document',
				document: {
					rows: buildRows(model, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows,
					header: { schema: '00048', packages: ['HeaderPkg'] }
				}
			});
			await runSearch(dom, 'HeaderPkg');
			assert.strictEqual(dom.document.getElementById('search-count')!.textContent, '1 / 1');
			const headerRow = dom.document.querySelector(
				'#tree .document-tree-header-row[data-header-id="header:package:0"]'
			) as HTMLElement;
			assert.ok(headerRow, 'the package line is a header row');
			assert.ok(headerRow.querySelector('mark'), 'the match is highlighted in the header');
			assert.strictEqual(messagesOf(dom.api, 'select').length, 0, 'search does not select an ECUC row');
			headerRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			assert.strictEqual(messagesOf(dom.api, 'select').length, 0, 'clicking a header row does not select');
		} finally {
			dom.restore();
		}
	});

	test('the header keyword and its value are marked and the current header uses the strong tier', async () => {
		const dom = mountEditor();
		try {
			const model = scanEcucValues(fixtureText('editor/render.arxml'));
			dom.post({
				type: 'document',
				document: {
					rows: buildRows(model, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows,
					header: { schema: '00048', packages: ['HeaderPkg'] }
				}
			});
			for (const query of ['package', 'pack', 'schema', 'sche', '00048', 'Head']) {
				await runSearch(dom, query);
				assert.strictEqual(
					dom.document.getElementById('search-count')!.textContent,
					'1 / 1',
					`${query}: the header line is one match`
				);
				assertHeaderMatch(dom, query);
			}
			const css = webviewCss('components', 'documentTree', 'documentTree.css');
			assert.ok(
				/\.document-tree-header-row\[data-search-current="true"\] mark\s*\{[^}]*var\(--match-hi\)/.test(css),
				'the current header uses the strong search tier'
			);
		} finally {
			dom.restore();
		}
	});

	test('the two search tiers are calm, distinct and keep changed-word outlines', () => {
		const tokens = webviewCss('styles', 'tokens.css');
		const tree = webviewCss('components', 'documentTree', 'documentTree.css');
		const diff = webviewCss('components', 'diffView', 'diffView.css');
		const base = /--match-bg:\s*rgba\(234, 179, 8, 0\.18\);/.exec(tokens);
		const current = /--match-hi:\s*rgba\(234, 179, 8, 0\.36\);/.exec(tokens);
		assert.ok(base, 'every match uses the calmer 0.18 amber tier');
		assert.ok(current, 'the current match uses the stronger 0.36 amber tier');
		assert.notStrictEqual(base[0], current[0], 'the current tier stays distinct from every match');
		assert.strictEqual(
			(tokens.match(/--match-(?:bg|hi)\s*:/g) ?? []).length,
			2,
			'exactly two match tiers'
		);
		assert.ok(/^mark\s*\{[^}]*background:\s*var\(--match-bg\)/m.test(tree), 'every mark uses the base tier');
		assert.ok(
			/\.node\[data-search-current="true"\] > \.row mark\s*\{[^}]*var\(--match-hi\)/.test(tree),
			'the current Document row uses the strong tier'
		);
		assert.ok(
			/\.document-tree-header-row\[data-search-current="true"\] mark\s*\{[^}]*var\(--match-hi\)/.test(tree),
			'the current header uses the strong tier'
		);
		assert.ok(
			/\.diff-row\[data-search-current="true"\] \.diff-cell mark\s*\{[^}]*var\(--match-hi\)/.test(diff),
			'the current diff row uses the strong tier'
		);
		assert.ok(
			/\.diff-row \.word-changed\[data-word-side="left"\]\s*\{[^}]*outline:\s*1px solid var\(--diff-removed-edge\)/.test(
				diff
			),
			'the removed-word outline survives a mark'
		);
		assert.ok(
			/\.diff-row \.word-changed\[data-word-side="right"\]\s*\{[^}]*outline:\s*1px solid var\(--diff-added-edge\)/.test(
				diff
			),
			'the added-word outline survives a mark'
		);
		assert.ok(
			/@media \(forced-colors: active\)[\s\S]*body\[data-view\] mark\s*\{[^}]*outline:/.test(tree),
			'forced colors keep marks visible as outlines'
		);
		assert.ok(
			/body\.vscode-high-contrast\[data-view\] mark\s*\{[^}]*outline:/.test(tree),
			'the high-contrast theme keeps marks visible as outlines'
		);
	});

	test('SEARCH-02 clearing a running chunked search discards results and paints nothing late', async () => {
		// Deterministic in-flight scan: a fake clock advances six units per read,
		// so the first 24-unit slice scans four of ten rows and schedules a chunk.
		const timers = new Map<number, () => void>();
		let nextHandle = 1;
		let clock = 0;
		const updates: number[][] = [];
		let completions = 0;
		const engine = new RowSearchEngine({
			debounceMs: 0,
			budgetMs: 10,
			progressMs: 0,
			batchSize: 2,
			now: () => (clock += 6),
			setTimer: (callback) => {
				const handle = nextHandle++;
				timers.set(handle, callback);
				return handle;
			},
			clearTimer: (handle) => {
				timers.delete(handle as number);
			},
		});
		const rows: TreeRow[] = Array.from({ length: 10 }, (_, at) => ({
			id: 'r' + at,
			parentId: null,
			level: 1,
			subtreeSize: 0,
			hasChildren: false,
			haystack: at === 0 ? 'needle first' : 'row ' + at,
		}));
		engine.search(
			rows,
			'needle',
			{
				onProgressUpdate: (matches) => updates.push(matches),
				onComplete: () => {
					completions++;
				},
			},
			true
		);
		assert.deepStrictEqual(updates, [[0]], 'the first chunk painted one match');
		assert.strictEqual(completions, 0, 'the scan is still in flight');
		const pending = [...timers.values()];
		assert.strictEqual(pending.length, 1, 'one chunk timer is pending');

		engine.clear();
		assert.strictEqual(timers.size, 0, 'clear cancels the pending chunk');
		pending.forEach((callback) => callback());
		assert.deepStrictEqual(updates, [[0]], 'no late partial result reaches the page');
		assert.strictEqual(completions, 0, 'no late completion reaches the page');

		// The page's Clear control resets the same engine and leaves no stale UI.
		const dom = mountEditor();
		try {
			const input = dom.document.getElementById('search-input') as HTMLInputElement;
			input.value = 'IniValue';
			input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
			input.dispatchEvent(
				new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
			);
			(dom.document.getElementById('search-clear') as HTMLElement).click();
			await settleSearch();
			assert.strictEqual(dom.document.getElementById('search-count')!.textContent, '');
			assert.strictEqual(dom.document.querySelector('#tree mark'), null, 'no late highlight');
			assert.strictEqual(messagesOf(dom.api, 'select').length, 0, 'no late jump selects a row');
		} finally {
			dom.restore();
		}
	});

	test('SEARCH-04 100k rows with one match at the end completes within the engine budget', async () => {
		const rows: TreeRow[] = Array.from({ length: 100_000 }, (_, at) => ({
			id: 'r' + at,
			parentId: null,
			level: 1,
			subtreeSize: 0,
			hasChildren: false,
			haystack: at === 99_999 ? 'needle at the end' : 'row ' + at,
		}));
		const started = performance.now();
		const matches = await new Promise<number[]>((resolve) => {
			new RowSearchEngine().search(rows, 'needle', { onComplete: resolve }, true);
		});
		const elapsed = performance.now() - started;
		assert.deepStrictEqual(matches, [99_999]);
		assert.ok(elapsed < 2000, `100k rows took ${Math.round(elapsed)} ms (ceiling 2000 ms)`);
	});

	test('the schema/package rows scroll out of the rendered window', async () => {
		const dom = mountEditor();
		try {
			const model = scanEcucValues(fixtureText('editor/render.arxml'));
			dom.post({
				type: 'document',
				document: {
					rows: buildRows(model, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows,
					header: { schema: '00048', packages: ['PkgA', 'PkgB'] }
				}
			});
			const scroller = dom.document.querySelector('#tree .virtual-scroll-vscroll') as HTMLElement;
			const windowEl = dom.document.querySelector('#tree-pane .document-tree-window') as HTMLElement;
			assert.strictEqual(windowEl.style.top, '0px', 'the header rows start at the top');
			scroller.scrollTop = 400;
			scroller.dispatchEvent(new dom.window.Event('scroll'));
			await settleFrame();
			assert.notStrictEqual(windowEl.style.top, '0px', 'the window follows the scrolled content');
			assert.strictEqual(
				dom.document.querySelectorAll('#tree .document-tree-header-row').length,
				0,
				'the header rows scroll out with the document'
			);
		} finally {
			dom.restore();
		}
	});
});
