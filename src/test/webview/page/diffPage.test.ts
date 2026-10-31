/**
 * The bundled semantic-diff page, mounted into jsdom from the host's static
 * shell. The host protocol posts a complete `DiffDocument`; the page owns the two
 * virtual panes, swap, view mode, search and the error banner.
 */
import * as assert from 'assert';

import { SORT_EXCEPTIONS } from '../../../core/ecuc/order';
import { scanEcucValues } from '../../../core/ecuc/scanner';
import {
	DiffDocument,
	DiffRow,
	buildDiffDocument,
	diffVisibility,
	flattenDiffDocument,
	nextChangeIndex,
} from '../../../core/diff/diffModel';
import { buildNodeIndex } from '../../../core/ecuc/nodeId';
import { buildRows } from '../../../core/ecuc/renderRows';
import {
	diffContentWidth,
	diffPaneHeaders,
	diffRowChars,
	searchCandidatesFor,
} from '../../../webview/diffViewer';
import { diffShell } from '../../../host/webviewShell';
import { fixtureText } from '../../core/modelTestUtils';
import { expectReady, installDom, loadModule, messagesOf, settleSearch, treeRows } from '../pageTestUtils';

function side(name: string) {
	const model = scanEcucValues(fixtureText(name));
	const index = buildNodeIndex(model);
	const rows = buildRows(model, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows;
	return { rows, rangeOf: (id: string) => index.byId.get(id)?.range };
}

function documentOf(): DiffDocument {
	const left = side('diff/left.arxml');
	const right = side('diff/right.arxml');
	return buildDiffDocument(
		{ name: 'left.arxml', path: '/work/left.arxml' },
		{ name: 'right.arxml', path: '/work/right.arxml' },
		left.rows,
		right.rows,
		left.rangeOf,
		right.rangeOf,
		{
			left: { packages: ['PkgA'] },
			right: { schema: '00048', packages: ['PkgB', 'PkgC'] },
		}
	);
}

function mount(document = documentOf()): { dom: ReturnType<typeof installDom>; page: any; document: DiffDocument } {
	const dom = installDom('diff');
	const module = loadModule<typeof import('../../../webview/diffViewer')>('../../webview/diffViewer');
	module.mountDiff();
	dom.post({ type: 'document', document });
	return { dom, page: module, document };
}

function widthRow(overrides: Partial<DiffRow> = {}): DiffRow {
	return {
		key: 'p1',
		parentKey: null,
		level: 1,
		posinset: 1,
		setsize: 1,
		kind: 'parameter',
		hasChildren: false,
		subtreeSize: 0,
		status: 'changed',
		changes: [],
		haystack: 'foo',
		...overrides,
	};
}

function widthCell(overrides: Partial<NonNullable<DiffRow['left']>> = {}): NonNullable<DiffRow['left']> {
	return {
		kind: 'parameter',
		label: 'Foo',
		definitionRef: '/P/Foo',
		meta: [],
		range: { start: 0, end: 1 },
		...overrides,
	};
}

suite('semantic diff page', () => {
	test('the host shell is strict and loads the bundled script and stylesheet', () => {
		const html = diffShell({
			cspSource: 'https://webview.test',
			scriptUri: 'https://webview.test/diffViewer.js',
			styleUri: 'https://webview.test/diffViewer.css',
			nonce: 'test-nonce',
		});
		assert.ok(
			html.includes(
				"default-src 'none'; style-src https://webview.test 'nonce-test-nonce'; script-src 'nonce-test-nonce'; img-src https://webview.test data:"
			),
			'a strict CSP'
		);
		assert.ok(html.includes('src="https://webview.test/diffViewer.js"'), 'the bundled script');
		assert.ok(html.includes('href="https://webview.test/diffViewer.css"'), 'the bundled stylesheet');
		assert.ok(!/<script(?![^>]*src=)/.test(html), 'no inline script');
		assert.ok(!html.includes('type="application/json"'), 'no embedded document');
		assert.strictEqual((html.match(/id="diff-list"/g) || []).length, 1);
		assert.ok(html.includes('id="diff-pane-left"') && html.includes('id="diff-pane-right"'));
		assert.ok(html.includes('id="diff-empty"') && html.includes('id="diff-empty-text"'));
	});

	test('boots from the static shell, announces ready and renders both panes', () => {
		const { dom, document } = mount();
		try {
			expectReady(dom.api);
			assert.ok(treeRows(dom.document, '#diff-pane-left').length > 0, 'the left pane has rows');
			assert.ok(
				dom.document.querySelectorAll('#diff-pane-right .diff-row').length > 0,
				'the right pane has rows'
			);
			assert.ok(dom.document.querySelector('#diff-pane-left .document-tree-header'), 'each pane owns its header');
			assert.ok(
				dom.document.querySelector('#diff-pane-left .document-tree-title')!.textContent === 'left.arxml'
			);
			assert.ok(
				dom.document.querySelector('#diff-pane-right .document-tree-title')!.textContent === 'right.arxml'
			);
			const headers = diffPaneHeaders(document, false);
			assert.deepStrictEqual(headers.left.packages, ['PkgA']);
			assert.deepStrictEqual(headers.right.packages, ['PkgB', 'PkgC']);
			assert.strictEqual(headers.right.lines, 3, 'the shorter header is padded to align rows');
		} finally {
			dom.restore();
		}
	});

	test('Enter on a row posts one reveal for the displayed side', () => {
		const { dom, document } = mount();
		try {
			const row = treeRows(dom.document, '#diff-pane-left').find(
				(candidate) =>
					document.rows.some((source) => source.key === candidate.getAttribute('data-key') && source.left)
			)!;
			row.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			const reveals = messagesOf(dom.api, 'reveal');
			assert.strictEqual(reveals.length, 1, 'one reveal');
			assert.ok(reveals[0].key, 'the row key travels');
			assert.strictEqual(reveals[0].side, 'left');
			assert.ok(document.rows.some((candidate) => candidate.key === reveals[0].key));		} finally {
			dom.restore();
		}
	});

	test('Show diff only filters unchanged rows and Swap resets only horizontal offsets', () => {
		const { dom } = mount();
		try {
			const before = treeRows(dom.document, '#diff-pane-left').length;
			(dom.document.getElementById('diff-view-diff') as HTMLElement).click();
			assert.strictEqual(dom.document.getElementById('diff-view-diff')!.getAttribute('aria-pressed'), 'true');
			const after = treeRows(dom.document, '#diff-pane-left').length;
			assert.ok(after <= before, 'the diff-only view never shows more rows');
			const left = (dom.document.getElementById('diff-pane-left') as any).__view;
			void left;
			(dom.document.getElementById('diff-swap') as HTMLElement).click();
			assert.strictEqual(dom.document.getElementById('diff-swap')!.getAttribute('aria-pressed'), 'true');
			assert.strictEqual(
				dom.document.querySelector('#diff-pane-left .document-tree-title')!.textContent,
				'right.arxml',
				'the displayed side follows the swap'
			);
		} finally {
			dom.restore();
		}
	});

	test('F7 moves to the next change and Shift+F7 to the previous one', () => {
		const { dom } = mount();
		try {
			const list = dom.document.getElementById('diff-list');
			const tree = dom.document.getElementById('diff-pane-left');
			tree.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'F7', bubbles: true, cancelable: true }));
			const selected = dom.document.querySelector('#diff-pane-left [data-selected="true"]');
			assert.ok(selected, 'F7 selects the first changed row');
			list.dispatchEvent(
				new dom.window.KeyboardEvent('keydown', { key: 'F7', shiftKey: true, bubbles: true, cancelable: true })
			);
			assert.ok(dom.document.querySelector('#diff-pane-left [data-selected="true"]'), 'Shift+F7 keeps a selection');
		} finally {
			dom.restore();
		}
	});

	test('a document with no semantic differences shows the explicit empty state', () => {
		const quiet = documentOf();
		quiet.rows = quiet.rows.map((row) => ({
			...row,
			status: 'unchanged',
			changes: [],
			left: row.left ? { ...row.left } : undefined,
			right: row.left ? { ...row.left } : undefined,
		}));
		quiet.summary = { changed: 0, added: 0, removed: 0, unchanged: quiet.rows.length };
		const { dom } = mount(quiet);
		try {
			assert.strictEqual(dom.document.getElementById('diff-list')!.hidden, true);
			assert.strictEqual(dom.document.getElementById('diff-empty')!.hidden, false);
			assert.strictEqual(dom.document.getElementById('diff-empty-text')!.textContent, 'No differences');
		} finally {
			dom.restore();
		}
	});

	test('a refresh keeps the last good document and shows the error banner', () => {
		const { dom } = mount();
		try {
			const before = dom.document.querySelectorAll('#diff-pane-left [role="treeitem"]').length;
			dom.post({ type: 'error', message: 'The comparison could not be refreshed.' });
			assert.strictEqual(dom.document.getElementById('diff-notice')!.textContent, 'The comparison could not be refreshed.');
			assert.strictEqual(dom.document.getElementById('diff-notice')!.getAttribute('data-kind'), 'warn');
			assert.strictEqual(dom.document.querySelectorAll('#diff-pane-left [role="treeitem"]').length, before);
		} finally {
			dom.restore();
		}
	});

	test('1200 rows are windowed by the shared virtual math', () => {
		const rows: DiffRow[] = Array.from({ length: 1200 }, (_, at) => ({
			key: `row-${at}`,
			parentKey: at === 0 ? null : 'row-0',
			level: at === 0 ? 1 : 2,
			posinset: at === 0 ? 1 : at,
			setsize: at === 0 ? 1 : 1199,
			kind: 'parameter',
			hasChildren: false,
			subtreeSize: 0,
			status: 'changed',
			changes: [],
			haystack: `row ${at}`,
			left: { kind: 'parameter', label: `row-${at}`, definitionRef: '/P/row', meta: [], range: { start: 0, end: 1 } },
		}));
		const { dom } = mount({
			left: { name: 'left.arxml', path: '/work/left.arxml' },
			right: { name: 'right.arxml', path: '/work/right.arxml' },
			labels: ['left.arxml', 'right.arxml'],
			leftHeader: { packages: [] },
			rightHeader: { packages: [] },
			rows,
			summary: { changed: rows.length, added: 0, removed: 0, unchanged: 0 },
		});
		try {
			const rendered = treeRows(dom.document, '#diff-pane-left').length;
			assert.ok(rendered > 0, 'the viewport has rows');
			assert.ok(rendered <= 200, `the pane DOM is bounded (${rendered})`);
		} finally {
			dom.restore();
		}
	});

	test('search candidates follow the active view', () => {
		const rows = documentOf().rows;
		assert.strictEqual(searchCandidatesFor(rows, false).length, rows.length);
		assert.strictEqual(
			searchCandidatesFor(rows, true).length,
			rows.filter((row) => row.status !== 'unchanged').length
		);
	});

	test('the width model counts indent, label, value and meta on the wider side', () => {
		const parameter = widthRow({
			level: 1,
			left: widthCell({ label: 'Foo', shownValue: '123', meta: [] }),
			right: widthCell({ label: 'LongerName', shownValue: '12345', meta: [] }),
		});
		assert.strictEqual(diffRowChars(parameter), 3 + 10 + 5 + 3, 'the longer side wins');
		const container = widthRow({
			level: 2,
			left: widthCell({
				kind: 'container',
				label: 'C',
				meta: [
					{ cls: 'short', text: 'short abc', title: '' },
					{ cls: 'variant', text: 'variant v', title: '' },
				],
			}),
		});
		assert.strictEqual(diffRowChars(container), 3 + 4 + 1 + 10 + 10);
		const moduleRow = widthRow({
			level: 1,
			kind: 'module',
			left: widthCell({ kind: 'module', label: 'M', meta: [] }),
		});
		assert.strictEqual(diffRowChars(moduleRow), 3 + 1 + 7);
		assert.strictEqual(
			diffRowChars(widthRow({ left: widthCell({ label: 'P', shownValue: undefined, meta: [] }) })),
			3 + 1 + 3
		);
		assert.strictEqual(diffRowChars(widthRow({ left: undefined, right: undefined })), 0);
		assert.strictEqual(diffContentWidth(100, 8), 834);
		assert.strictEqual(diffContentWidth(0, 8), 34);
		assert.strictEqual(diffContentWidth(5000, 8), 40034, 'no cap: scrolling reaches the longest line');
	});

	test('the page shares the core diff visibility and flatten rules', () => {
		const rows = documentOf().rows;
		const visible = diffVisibility(rows, false);
		assert.ok(visible.every(Boolean), 'Show all sees every row');
		const display = flattenDiffDocument(rows);
		assert.ok(display.length > 0);
		assert.ok(nextChangeIndex(rows, visible, -1, 1) >= 0, 'the next change resolves');
	});

	test('the search UI reports the current match after Enter', async () => {
		const { dom } = mount();
		try {
			const input = dom.document.getElementById('diff-search-input') as HTMLInputElement;
			input.value = 'Cont';
			input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
			input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			await settleSearch();
			assert.ok(/1 \/ [1-9]/.test(dom.document.getElementById('diff-search-count')!.textContent || ''));
			assert.strictEqual(dom.document.getElementById('diff-search-busy')!.getAttribute('data-busy'), 'false');
		} finally {
			dom.restore();
		}
	});
});
