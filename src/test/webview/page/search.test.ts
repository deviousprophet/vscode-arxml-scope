/**
 * Search over the whole row store: pure matching rules, then the mounted page's
 * Enter/F3/clear flow. The chunked engine's own timing is covered in
 * `render/rowSearch.test.ts`.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../../core/ecuc/scanner';
import { buildRows } from '../../../core/ecuc/renderRows';
import { SORT_EXCEPTIONS } from '../../../core/ecuc/order';
import { TreeRow, flattenRows, haystack, matchRanges, searchRows, stepMatch } from '../../../webview/render/treeQuery';
import { fixtureText } from '../../core/modelTestUtils';
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
});
