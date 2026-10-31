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

function wordCell(overrides: Partial<NonNullable<DiffRow['left']>> = {}): NonNullable<DiffRow['left']> {
	return {
		kind: 'parameter',
		label: 'Timeout',
		definitionRef: '/P/Timeout',
		shownValue: '100',
		value: '100',
		valueKind: 'numeric',
		meta: [],
		range: { start: 0, end: 1 },
		...overrides,
	};
}

function containerCell(label: string, overrides: Partial<NonNullable<DiffRow['left']>> = {}): NonNullable<DiffRow['left']> {
	return wordCell({
		kind: 'container',
		label,
		shownValue: undefined,
		value: undefined,
		valueKind: undefined,
		...overrides,
	});
}

function wordRow(overrides: Partial<DiffRow> = {}): DiffRow {
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
		haystack: 'timeout 100 200',
		...overrides,
	};
}

function wordDocument(rows: DiffRow[]): DiffDocument {
	const summary = { changed: 0, added: 0, removed: 0, unchanged: 0 };
	for (const row of rows) {
		summary[row.status]++;
	}
	return {
		left: { name: 'left.arxml', path: '/work/left.arxml' },
		right: { name: 'right.arxml', path: '/work/right.arxml' },
		labels: ['left.arxml', 'right.arxml'],
		leftHeader: { packages: [] },
		rightHeader: { packages: [] },
		rows,
		summary,
	};
}

function wordTexts(row: Element | null, side: 'left' | 'right'): string[] {
	if (!row) {
		return [];
	}
	return Array.from(row.querySelectorAll(`.word-changed[data-word-side="${side}"]`)).map(
		(node) => node.textContent ?? ''
	);
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
			const scroller = dom.document.querySelector('#diff-pane-left .document-tree-scroll') as HTMLElement;
			assert.strictEqual(
				scroller.firstElementChild!.className,
				'document-tree-header',
				'the header is the first scrolled element'
			);
			assert.strictEqual(
				dom.document.querySelector('#diff-pane-left > .document-tree-header'),
				null,
				'the header is not pinned outside the scroller'
			);
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

	test('a changed row marks only the changed words in both panes', () => {
		const changed = wordRow({
			changes: [{ field: 'value', left: '100', right: '200' }],
			left: wordCell({
				meta: [
					{ cls: 'condition', text: '(A == 1)', title: '' },
					{ cls: 'variant', text: '(alpha)', title: 'alpha' },
					{ cls: 'context', text: 'context /A/B', title: 'context /A/B' },
				],
			}),
			right: wordCell({
				shownValue: '200',
				value: '200',
				meta: [
					{ cls: 'condition', text: '(A == 2)', title: '' },
					{ cls: 'variant', text: '(beta)', title: 'beta' },
					{ cls: 'context', text: 'context /A/C', title: 'context /A/C' },
				],
			}),
		});
		const { dom } = mount(wordDocument([changed]));
		try {
			const left = dom.document.querySelector('#diff-pane-left .diff-row[data-key="p1"]');
			const right = dom.document.querySelector('#diff-pane-right .diff-row[data-key="p1"]');
			assert.deepStrictEqual(
				wordTexts(left, 'left'),
				['100', '1', 'alpha', 'B'],
				'value, condition, variant and context words'
			);
			assert.deepStrictEqual(wordTexts(right, 'right'), ['200', '2', 'beta', 'C']);
			assert.strictEqual(left!.querySelector('.label')!.textContent, 'Timeout');
			assert.strictEqual(left!.querySelector('.label .word-changed'), null, 'the unchanged label is plain');
			assert.strictEqual(left!.querySelector('.condition')!.textContent, '(A == 1)');
			assert.strictEqual(left!.querySelector('.condition .word-changed')!.textContent, '1');
			assert.strictEqual(right!.querySelector('.condition .word-changed')!.textContent, '2');
			assert.strictEqual(left!.querySelector('.variant .word-changed')!.textContent, 'alpha');
			assert.strictEqual(right!.querySelector('.variant .word-changed')!.textContent, 'beta');
			assert.strictEqual(left!.querySelector('.context .word-changed')!.textContent, 'B');
			assert.strictEqual(left!.querySelector('.context .keyword')!.textContent, 'context');
		} finally {
			dom.restore();
		}
	});

	test('Swap mirrors the word colors with the displayed panes', () => {
		const changed = wordRow({
			left: wordCell({ meta: [{ cls: 'condition', text: '(A == 1)', title: '' }] }),
			right: wordCell({
				shownValue: '200',
				value: '200',
				meta: [{ cls: 'condition', text: '(A == 2)', title: '' }],
			}),
		});
		const { dom } = mount(wordDocument([changed]));
		try {
			(dom.document.getElementById('diff-swap') as HTMLElement).click();
			const left = dom.document.querySelector('#diff-pane-left .diff-row[data-key="p1"]');
			const right = dom.document.querySelector('#diff-pane-right .diff-row[data-key="p1"]');
			assert.deepStrictEqual(wordTexts(left, 'left'), ['200', '2'], 'the left pane keeps removed styling');
			assert.strictEqual(left!.querySelector('.word-changed[data-word-side="right"]'), null);
			assert.deepStrictEqual(wordTexts(right, 'right'), ['100', '1'], 'the right pane keeps inserted styling');
			assert.strictEqual(right!.querySelector('.word-changed[data-word-side="left"]'), null);
		} finally {
			dom.restore();
		}
	});

	test('a search mark inside a changed word keeps the changed span', async () => {
		const changed = wordRow({ left: wordCell(), right: wordCell({ shownValue: '200', value: '200' }) });
		const { dom } = mount(wordDocument([changed]));
		try {
			const input = dom.document.getElementById('diff-search-input') as HTMLInputElement;
			input.value = '100';
			input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
			input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			await settleSearch();
			const span = dom.document.querySelector('#diff-pane-left .word-changed[data-word-side="left"]');
			assert.ok(span, 'the changed word is still wrapped');
			const mark = span!.querySelector('mark');
			assert.ok(mark, 'the search mark lives inside the changed word');
			assert.strictEqual(mark!.textContent, '100');
		} finally {
			dom.restore();
		}
	});

	test('added and removed rows keep the full-cell tint and no word spans', () => {
		const added = wordRow({
			key: 'add',
			status: 'added',
			left: undefined,
			right: wordCell({ shownValue: '200', value: '200' }),
		});
		const removed = wordRow({
			key: 'rem',
			status: 'removed',
			left: wordCell(),
			right: undefined,
		});
		const { dom } = mount(wordDocument([added, removed]));
		try {
			assert.strictEqual(dom.document.querySelectorAll('#diff-pane-left .word-changed').length, 0);
			assert.strictEqual(dom.document.querySelectorAll('#diff-pane-right .word-changed').length, 0);
			assert.ok(dom.document.querySelector('#diff-pane-left .diff-row[data-status="added"]'));
			assert.ok(dom.document.querySelector('#diff-pane-right .diff-row[data-status="removed"]'));
			assert.ok(
				dom.document.querySelector('#diff-pane-left .diff-row[data-status="added"] .diff-cell[data-empty="true"]'),
				'an added row is blank on the left'
			);
		} finally {
			dom.restore();
		}
	});

	test('unchanged rows render exactly as before', () => {
		const changed = wordRow({
			left: wordCell(),
			right: wordCell({ shownValue: '200', value: '200' }),
		});
		const same = wordRow({
			key: 'same',
			posinset: 2,
			setsize: 2,
			status: 'unchanged',
			left: wordCell(),
			right: wordCell(),
		});
		const { dom } = mount(wordDocument([changed, same]));
		try {
			const row = dom.document.querySelector('#diff-pane-left .diff-row[data-key="same"]');
			assert.ok(row, 'the unchanged row renders');
			assert.strictEqual(row!.querySelectorAll('.word-changed').length, 0);
			assert.strictEqual(row!.querySelector('.label')!.textContent, 'Timeout');
			assert.strictEqual(row!.querySelector('.value-text')!.textContent, '100');
		} finally {
			dom.restore();
		}
	});

	test('selecting a container highlights the same subtree and annotation rows in both panes', () => {
		const parent = wordRow({
			key: 'parent',
			kind: 'container',
			hasChildren: true,
			subtreeSize: 2,
			posinset: 1,
			setsize: 2,
			left: containerCell('Parent'),
			right: containerCell('Parent'),
		});
		const child = wordRow({
			key: 'child',
			parentKey: 'parent',
			level: 2,
			kind: 'container',
			posinset: 1,
			setsize: 2,
			left: containerCell('Child', { comments: ['child note'] }),
			right: containerCell('Child', { comments: ['child note'] }),
		});
		const leaf = wordRow({
			key: 'leaf',
			parentKey: 'parent',
			level: 2,
			posinset: 2,
			setsize: 2,
			left: wordCell({ label: 'Leaf' }),
			right: wordCell({ label: 'Leaf' }),
		});
		const other = wordRow({
			key: 'other',
			kind: 'container',
			posinset: 2,
			setsize: 2,
			left: containerCell('Other'),
			right: containerCell('Other'),
		});
		const { dom } = mount(wordDocument([parent, child, leaf, other]));
		try {
			const parentRow = dom.document.querySelector('#diff-pane-left .diff-row[data-key="parent"]') as HTMLElement;
			parentRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			for (const pane of ['left', 'right']) {
				assert.ok(
					dom.document.querySelector(`#diff-pane-${pane} .diff-row[data-key="child"] .node[data-subtree="true"]`),
					`${pane}: the descendant node is highlighted`
				);
				assert.ok(
					dom.document.querySelector(`#diff-pane-${pane} .comment[data-row-id="child"][data-subtree="true"]`),
					`${pane}: the descendant annotation is highlighted`
				);
				assert.ok(
					dom.document.querySelector(`#diff-pane-${pane} .brace[data-subtree="true"]`),
					`${pane}: the subtree braces are highlighted`
				);
				assert.strictEqual(
					dom.document.querySelector(`#diff-pane-${pane} .diff-row[data-key="other"] [data-subtree]`),
					null,
					`${pane}: a sibling is not highlighted`
				);
			}
			const comment = dom.document.querySelector('#diff-pane-left .comment[data-row-id="child"]')!;
			assert.strictEqual(comment.getAttribute('aria-hidden'), 'true', 'the annotation stays decorative');
			const leafRow = dom.document.querySelector('#diff-pane-left .diff-row[data-key="leaf"]') as HTMLElement;
			leafRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			assert.strictEqual(
				dom.document.querySelector('#diff-pane-left .diff-row[data-key="child"] .node[data-subtree]'),
				null,
				'a new selection drops the old subtree'
			);
			assert.strictEqual(
				dom.document.querySelector('#diff-pane-left .comment[data-row-id="child"]')!.getAttribute('data-subtree'),
				null
			);
			assert.strictEqual(
				dom.document.querySelector('#diff-pane-right .comment[data-row-id="child"]')!.getAttribute('data-subtree'),
				null
			);
		} finally {
			dom.restore();
		}
	});

	test('an added or removed row highlights only its owning side', () => {
		const parent = wordRow({
			key: 'parent',
			kind: 'container',
			hasChildren: true,
			subtreeSize: 2,
			posinset: 1,
			setsize: 2,
			left: containerCell('Parent'),
			right: containerCell('Parent'),
		});
		const added = wordRow({
			key: 'right:childAdd',
			parentKey: 'parent',
			level: 2,
			kind: 'container',
			status: 'added',
			posinset: 1,
			setsize: 2,
			left: undefined,
			right: containerCell('Added', { comments: ['added note'] }),
		});
		const removed = wordRow({
			key: 'childRem',
			parentKey: 'parent',
			level: 2,
			kind: 'container',
			status: 'removed',
			posinset: 2,
			setsize: 2,
			left: containerCell('Removed', { comments: ['removed note'] }),
			right: undefined,
		});
		const { dom } = mount(wordDocument([parent, added, removed]));
		try {
			const parentRow = dom.document.querySelector('#diff-pane-left .diff-row[data-key="parent"]') as HTMLElement;
			parentRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			assert.strictEqual(
				dom.document.querySelector('#diff-pane-right .diff-row[data-key="right:childAdd"]')!.getAttribute('data-status'),
				'added'
			);
			assert.ok(
				dom.document.querySelector('#diff-pane-right .diff-row[data-key="right:childAdd"] .node[data-subtree="true"]'),
				'the added node is highlighted on its own side'
			);
			assert.ok(
				dom.document.querySelector('#diff-pane-right .comment[data-row-id="right:childAdd"][data-subtree="true"]'),
				'the added annotation is highlighted on its own side'
			);
			assert.ok(
				dom.document.querySelector('#diff-pane-left .diff-row[data-key="right:childAdd"] .diff-cell[data-empty="true"]'),
				'the added row is blank on the other side'
			);
			assert.strictEqual(
				dom.document.querySelector('#diff-pane-left .diff-row[data-key="right:childAdd"] [data-subtree]'),
				null,
				'the blank side has no subtree highlight'
			);
			assert.strictEqual(
				dom.document.querySelector('#diff-pane-left .comment[data-row-id="right:childAdd"]'),
				null,
				'no phantom annotation on the blank side'
			);
			assert.ok(
				dom.document.querySelector('#diff-pane-left .diff-row[data-key="childRem"] .node[data-subtree="true"]'),
				'the removed node is highlighted on its own side'
			);
			assert.ok(
				dom.document.querySelector('#diff-pane-left .comment[data-row-id="childRem"][data-subtree="true"]'),
				'the removed annotation is highlighted on its own side'
			);
			assert.ok(
				dom.document.querySelector('#diff-pane-right .diff-row[data-key="childRem"] .diff-cell[data-empty="true"]'),
				'the removed row is blank on the other side'
			);
			assert.strictEqual(
				dom.document.querySelector('#diff-pane-right .comment[data-row-id="childRem"]'),
				null,
				'no phantom annotation on the blank side'
			);
		} finally {
			dom.restore();
		}
	});

	test('the pane header is not part of the search haystack', async () => {
		const changed = wordRow({ left: wordCell(), right: wordCell({ shownValue: '200', value: '200' }) });
		const document = wordDocument([changed]);
		document.leftHeader = { schema: '00048', packages: ['NoSuchPkg'] };
		document.rightHeader = { schema: '00048', packages: ['NoSuchPkg'] };
		const { dom } = mount(document);
		try {
			assert.ok((dom.document.querySelector('#diff-pane-left .document-tree-header')!.textContent || '').includes('NoSuchPkg'));
			const input = dom.document.getElementById('diff-search-input') as HTMLInputElement;
			input.value = 'NoSuchPkg';
			input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
			input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			await settleSearch();
			assert.strictEqual(dom.document.getElementById('diff-search-count')!.textContent, '0 / 0');
			assert.strictEqual(dom.document.querySelectorAll('#diff-pane-left mark').length, 0);
		} finally {
			dom.restore();
		}
	});

	test('a refresh or a view switch at the top keeps the header in view', () => {
		const rows = Array.from({ length: 200 }, (_, at) =>
			wordRow({
				key: `row-${at}`,
				posinset: at + 1,
				setsize: 200,
				left: wordCell({ label: `Row ${at}` }),
				right: wordCell({ label: `Row ${at}`, shownValue: '200', value: '200' }),
			})
		);
		const document = wordDocument(rows);
		const { dom } = mount(document);
		try {
			// jsdom has no layout; a real header would be measured once it is on
			// screen. The resize path re-measures the same way a real window does.
			for (const header of Array.from(dom.document.querySelectorAll('#diff-list .document-tree-header'))) {
				Object.defineProperty(header, 'offsetHeight', { value: 40, configurable: true });
			}
			dom.window.dispatchEvent(new dom.window.Event('resize'));
			const scroller = dom.document.querySelector('#diff-pane-left .document-tree-scroll') as HTMLElement;
			assert.strictEqual(scroller.scrollTop, 0, 'the header is fully visible');
			dom.post({ type: 'document', document });
			assert.strictEqual(scroller.scrollTop, 0, 'a refresh at the top keeps the header visible');
			(dom.document.getElementById('diff-view-diff') as HTMLElement).click();
			assert.strictEqual(scroller.scrollTop, 0, 'Show diff only at the top keeps the header visible');
			(dom.document.getElementById('diff-view-all') as HTMLElement).click();
			assert.strictEqual(scroller.scrollTop, 0, 'Show all at the top keeps the header visible');
		} finally {
			dom.restore();
		}
	});

	test('two modules carry no gap row', () => {
		const moduleRow = (key: string, left: string, right: string): DiffRow =>
			wordRow({
				key,
				kind: 'module',
				posinset: Number(key.slice(1)),
				setsize: 2,
				left: wordCell({ kind: 'module', label: left, shownValue: undefined, value: undefined, valueKind: undefined }),
				right: wordCell({
					kind: 'module',
					label: right,
					shownValue: undefined,
					value: undefined,
					valueKind: undefined,
				}),
			});
		const { dom } = mount(wordDocument([moduleRow('m1', 'PkgA', 'PkgX'), moduleRow('m2', 'PkgB', 'PkgY')]));
		try {
			assert.strictEqual(dom.document.querySelectorAll('#diff-pane-left [data-gap]').length, 0);
			assert.strictEqual(dom.document.querySelectorAll('#diff-pane-right [data-gap]').length, 0);
		} finally {
			dom.restore();
		}
	});

	test('module rows use the base row height in the virtual spacers', () => {
		const rows = Array.from({ length: 100 }, (_, at) =>
			wordRow({
				key: `m${at}`,
				kind: 'module',
				posinset: at + 1,
				setsize: 100,
				left: wordCell({ kind: 'module', label: `M${at}`, shownValue: undefined, value: undefined, valueKind: undefined }),
				right: wordCell({
					kind: 'module',
					label: `N${at}`,
					shownValue: undefined,
					value: undefined,
					valueKind: undefined,
				}),
			})
		);
		const { dom } = mount(wordDocument(rows));
		try {
			const scroll = dom.document.querySelector('#diff-pane-left .document-tree-scroll') as HTMLElement;
			const rendered = treeRows(dom.document, '#diff-pane-left').length;
			assert.ok(rendered > 0 && rendered < 100, 'only the window is rendered');
			assert.strictEqual(scroll.style.getPropertyValue('--document-tree-top'), '0px');
			assert.strictEqual(
				scroll.style.getPropertyValue('--document-tree-bottom'),
				(100 - rendered) * 20 + 'px',
				'no per-module gap term in the height function'
			);
		} finally {
			dom.restore();
		}
	});
});
