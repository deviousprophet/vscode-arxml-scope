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
import { webviewCss } from '../cssTestUtils';
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
	dom.post({ type: 'document', semantic: false, document });
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
	const summary = { changed: 0, added: 0, removed: 0, unchanged: 0, renamed: 0 };
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
		semanticSkipped: 0,
	};
}

/** A module, a nested container and two changed parameters for collapse tests. */
function nestedRows(): DiffRow[] {
	return [
		wordRow({
			key: 'm',
			kind: 'module',
			level: 1,
			hasChildren: true,
			subtreeSize: 3,
			left: containerCell('M'),
			right: containerCell('M'),
		}),
		wordRow({
			key: 'c1',
			parentKey: 'm',
			kind: 'container',
			level: 2,
			hasChildren: true,
			subtreeSize: 2,
			left: containerCell('C1'),
			right: containerCell('C1'),
		}),
		wordRow({
			key: 'p1',
			parentKey: 'c1',
			kind: 'parameter',
			level: 3,
			left: wordCell({ label: 'P1' }),
			right: wordCell({ label: 'P1', shownValue: '200', value: '200' }),
		}),
		wordRow({
			key: 'p2',
			parentKey: 'c1',
			kind: 'parameter',
			level: 3,
			left: wordCell({ label: 'P2' }),
			right: wordCell({ label: 'P2', shownValue: '300', value: '300' }),
		}),
	];
}

/** One parameter row of the 14-parameter container; index 6 is the change. */
function contextRow(index: number): DiffRow {
	const name = `P${String(index).padStart(2, '0')}`;
	const changed = index === 6;
	const value = changed ? '1' : '0';
	const cell = (): NonNullable<DiffRow['left']> =>
		wordCell({ label: name, definitionRef: `/P/${name}`, shownValue: value, value, valueKind: 'numeric' });
	return wordRow({
		key: `p${index}`,
		parentKey: 'c',
		level: 3,
		posinset: index + 1,
		setsize: 14,
		kind: 'parameter',
		status: changed ? 'changed' : 'unchanged',
		left: cell(),
		right: cell(),
		changes: changed ? [{ field: 'value', left: '0', right: '1' }] : [],
		haystack: name.toLowerCase(),
	});
}

/** A 14-parameter container with one changed row, enough for a 5-line context window. */
function contextRows(): DiffRow[] {
	const moduleCell = (): NonNullable<DiffRow['left']> =>
		wordCell({ kind: 'module', label: 'M1', definitionRef: '/P/M1', shownValue: undefined, value: undefined, valueKind: undefined });
	const rows: DiffRow[] = [
		wordRow({
			key: 'm',
			kind: 'module',
			level: 1,
			hasChildren: true,
			subtreeSize: 15,
			status: 'unchanged',
			left: moduleCell(),
			right: moduleCell(),
		}),
		wordRow({
			key: 'c',
			parentKey: 'm',
			kind: 'container',
			level: 2,
			hasChildren: true,
			subtreeSize: 14,
			status: 'unchanged',
			left: containerCell('C1'),
			right: containerCell('C1'),
		}),
	];
	for (let index = 0; index < 14; index++) {
		rows.push(contextRow(index));
	}
	return rows;
}

function wordTexts(row: Element | null, side: 'left' | 'right'): string[] {
	if (!row) {
		return [];
	}
	return Array.from(row.querySelectorAll(`.word-changed[data-word-side="${side}"]`)).map(
		(node) => node.textContent ?? ''
	);
}

function paneGutter(dom: ReturnType<typeof installDom>, pane: 'left' | 'right'): HTMLElement {
	const gutter = dom.document.querySelector(`#diff-pane-${pane} .document-tree-lines`) as HTMLElement | null;
	assert.ok(gutter, `${pane} pane has a line-number gutter`);
	return gutter;
}

function paneCells(dom: ReturnType<typeof installDom>, pane: 'left' | 'right'): HTMLElement[] {
	return Array.from(paneGutter(dom, pane).querySelectorAll('.document-tree-line-number')) as HTMLElement[];
}

function paneCellAt(dom: ReturnType<typeof installDom>, pane: 'left' | 'right', index: number): HTMLElement {
	const cell = paneGutter(dom, pane).querySelector(
		`.document-tree-line-number[data-document-index="${index}"]`
	) as HTMLElement | null;
	assert.ok(cell, `${pane} gutter has a cell for virtual row ${index}`);
	return cell;
}

/** Numbered cells in one pane read 1..N; blank missing-side cells are skipped. */
function assertPaneNumbering(dom: ReturnType<typeof installDom>, pane: 'left' | 'right'): number {
	let expected = 1;
	for (const cell of paneCells(dom, pane)) {
		if ((cell.textContent ?? '') === '') {
			continue;
		}
		assert.strictEqual(cell.textContent, String(expected), `${pane} line ${expected} is numbered in order`);
		expected++;
	}
	return expected - 1;
}

async function runDiffSearch(dom: ReturnType<typeof installDom>, query: string): Promise<void> {
	const input = dom.document.getElementById('diff-search-input') as HTMLInputElement;
	input.value = query;
	input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
	input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
	await settleSearch();
}

function windowRowPositions(at: number): Pick<DiffRow, 'parentKey' | 'level' | 'posinset' | 'setsize'> {
	if (at === 0) {
		return { parentKey: null, level: 1, posinset: 1, setsize: 1 };
	}
	return { parentKey: 'row-0', level: 2, posinset: at, setsize: 1199 };
}

function windowDiffRow(at: number): DiffRow {
	return {
		key: `row-${at}`,
		...windowRowPositions(at),
		kind: 'parameter',
		hasChildren: false,
		subtreeSize: 0,
		status: 'changed',
		changes: [],
		haystack: `row ${at}`,
		left: { kind: 'parameter', label: `row-${at}`, definitionRef: '/P/row', meta: [], range: { start: 0, end: 1 } },
	};
}

function isKeywordQuery(query: string): boolean {
	return query === 'package' || query === 'pack' || query === 'schema' || query === 'sche';
}

function assertPaneHeaderMatch(dom: ReturnType<typeof installDom>, pane: 'left' | 'right', query: string): void {
	const row = dom.document.querySelector(
		`#diff-pane-${pane} .diff-header-row[data-search-current="true"]`
	) as HTMLElement | null;
	assert.ok(row, `${pane} ${query}: the header row is the current match`);
	const mark = row.querySelector('mark');
	assert.ok(mark, `${pane} ${query}: the matched text is marked`);
	assert.ok(
		(mark.textContent ?? '').toLowerCase().includes(query.toLowerCase()),
		`${pane} ${query}: the mark covers the match`
	);
	if (isKeywordQuery(query)) {
		assert.ok(row.querySelector('.keyword mark'), `${pane} ${query}: the keyword is marked`);
	} else {
		assert.ok(
			row.querySelector('.package mark, .number mark'),
			`${pane} ${query}: the value is marked`
		);
	}
	assert.strictEqual(
		dom.document.querySelectorAll(`#diff-pane-${pane} .diff-header-row[data-search-current="true"]`).length,
		1
	);
}

function assertHeaderSearch(dom: ReturnType<typeof installDom>, query: string): void {
	assert.strictEqual(
		dom.document.getElementById('diff-search-count')!.textContent,
		'1 / 1',
		`${query}: one aligned header line is one match`
	);
	for (const pane of ['left', 'right'] as const) {
		assertPaneHeaderMatch(dom, pane, query);
	}
}

function assertGapInBothPanes(dom: ReturnType<typeof installDom>, message: string): void {
	const left = dom.document.querySelector('#diff-pane-left .diff-module-gap-row');
	const right = dom.document.querySelector('#diff-pane-right .diff-module-gap-row');
	assert.ok(left && right, message);
}

function isGapAfterFirstModule(left: Element): boolean | undefined {
	return left.previousElementSibling?.classList.contains('diff-structural');
}

function isGapBeforeSecondModule(left: Element): boolean {
	const next = left.nextElementSibling;
	return next?.classList.contains('diff-row') === true && next?.getAttribute('data-key') === 'm2';
}

function assertGapPlacement(left: HTMLElement, right: HTMLElement): void {
	assert.strictEqual(left.dataset.documentIndex, right.dataset.documentIndex);
	assert.ok(isGapAfterFirstModule(left), 'the gap follows the first module subtree');
	assert.ok(isGapBeforeSecondModule(left), 'the gap precedes the second module');
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
		assert.ok(html.includes('id="diff-title-strip"'));
		assert.ok(html.includes('id="diff-title-left"') && html.includes('id="diff-title-right"'));
		assert.ok(html.includes('id="diff-empty"') && html.includes('id="diff-empty-text"'));
	});

	test('surfaces the semantic skip count from the document', () => {
		const dom = installDom('diff');
		try {
			const module = loadModule<typeof import('../../../webview/diffViewer')>('../../webview/diffViewer');
			module.mountDiff();
			dom.post({
				type: 'document',
				semantic: true,
				document: { ...documentOf(), semanticSkipped: 3 },
			});
			const notice = dom.document.getElementById('diff-semantic-skip') as HTMLElement;
			assert.strictEqual(notice.hidden, false);
			assert.strictEqual(notice.textContent, '3 containers in one group could not be matched semantically.');
			dom.post({ type: 'document', semantic: true, document: documentOf() });
			assert.strictEqual(notice.hidden, true);
			assert.strictEqual(notice.textContent, '');
		} finally {
			dom.restore();
		}
	});

	test('surfaces the reason a semantic comparison was limited', () => {
		const dom = installDom('diff');
		try {
			const module = loadModule<typeof import('../../../webview/diffViewer')>('../../webview/diffViewer');
			module.mountDiff();
			dom.post({
				type: 'document',
				semantic: true,
				document: { ...documentOf(), semanticSkipped: 2, semanticLimitReason: 'budget' },
			});
			const notice = dom.document.getElementById('diff-semantic-skip') as HTMLElement;
			assert.strictEqual(
				notice.textContent,
				'2 containers were left unmatched because the comparison reached its work budget.'
			);
			dom.post({
				type: 'document',
				semantic: true,
				document: { ...documentOf(), semanticSkipped: 1, semanticLimitReason: 'fallback' },
			});
			assert.strictEqual(
				notice.textContent,
				'1 container in a large group could not be matched semantically.'
			);
		} finally {
			dom.restore();
		}
	});

	test('shows an in-progress state until the first document arrives', () => {
		const dom = installDom('diff');
		try {
			const module = loadModule<typeof import('../../../webview/diffViewer')>('../../webview/diffViewer');
			module.mountDiff();
			const empty = dom.document.getElementById('diff-empty') as HTMLElement;
			assert.strictEqual(empty.hidden, false);
			assert.strictEqual(empty.getAttribute('aria-busy'), 'true');
			assert.strictEqual(dom.document.getElementById('diff-empty-text')!.textContent, 'Loading comparison…');
			assert.ok(!(empty.textContent || '').includes('No differences'));
			dom.post({ type: 'document', semantic: false, document: documentOf() });
			assert.strictEqual(empty.hidden, true);
			assert.strictEqual(empty.getAttribute('aria-busy'), null);
			assert.strictEqual(empty.dataset.busy, undefined);
		} finally {
			dom.restore();
		}
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
			assert.ok(dom.document.querySelector('#diff-pane-left .diff-header-row'), 'each pane owns its header rows');
			const scroller = dom.document.querySelector('#diff-list > .virtual-scroll-vscroll') as HTMLElement;
			assert.ok(scroller, 'one shared vertical scroller');
			assert.ok(
				dom.document.querySelector('#diff-pane-left .document-tree-window'),
				'the left docs view window is inside the shared scroll surface'
			);
			assert.ok(
				dom.document.querySelector('#diff-pane-right .document-tree-window'),
				'the right docs view window is inside the shared scroll surface'
			);
			assert.strictEqual(dom.document.querySelector('#diff-pane-left .document-tree-header'), null);
			assert.strictEqual(dom.document.querySelector('#diff-pane-left .document-tree-title-bar'), null);
			assert.strictEqual(
				dom.document.getElementById('diff-title-left')!.textContent,
				'left.arxml',
				'the fixed file name is outside the scroll surface'
			);
			assert.strictEqual(
				dom.document.getElementById('diff-title-right')!.textContent,
				'right.arxml',
				'the fixed file name is outside the scroll surface'
			);
			assert.ok(
				dom.document.getElementById('diff-title-left')!.title.endsWith('left.arxml'),
				'the full path stays in the tooltip'
			);
			assert.ok(!dom.document.querySelector('#diff-list [role="presentation"] .document-tree-header'));
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

	test('Show diff filters unchanged rows and Swap resets only horizontal offsets', () => {
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
				dom.document.getElementById('diff-title-left')!.textContent,
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
		quiet.summary = { changed: 0, added: 0, removed: 0, unchanged: quiet.rows.length, renamed: 0 };
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
		const rows: DiffRow[] = Array.from({ length: 1200 }, (_, at) => windowDiffRow(at));
		const { dom } = mount({
			left: { name: 'left.arxml', path: '/work/left.arxml' },
			right: { name: 'right.arxml', path: '/work/right.arxml' },
			labels: ['left.arxml', 'right.arxml'],
			leftHeader: { packages: [] },
			rightHeader: { packages: [] },
			rows,
			summary: { changed: rows.length, added: 0, removed: 0, unchanged: 0, renamed: 0 },
			semanticSkipped: 0,
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
			assert.strictEqual(
				left!.querySelector('.condition .word-changed .syscond-number')!.textContent,
				'1',
				'the changed condition token keeps its syntax colour'
			);
			assert.strictEqual(
				right!.querySelector('.condition .word-changed .syscond-number')!.textContent,
				'2'
			);
			assert.strictEqual(left!.querySelector('.variant .word-changed')!.textContent, 'alpha');
			assert.strictEqual(right!.querySelector('.variant .word-changed')!.textContent, 'beta');
			assert.strictEqual(left!.querySelector('.context .word-changed')!.textContent, 'B');
			assert.strictEqual(left!.querySelector('.context .keyword')!.textContent, 'context');
		} finally {
			dom.restore();
		}
	});

	test('repeated condition chips pair by index in both panes', () => {
		const changed = wordRow({
			left: wordCell({
				meta: [
					{ cls: 'condition', text: '[A == 1]', title: '' },
					{ cls: 'condition', text: '<X == 1>', title: '' },
				],
			}),
			right: wordCell({
				meta: [
					{ cls: 'condition', text: '[A == 2]', title: '' },
					{ cls: 'condition', text: '<X == 2>', title: '' },
				],
			}),
		});
		const { dom } = mount(wordDocument([changed]));
		try {
			const left = dom.document.querySelector('#diff-pane-left .diff-row[data-key="p1"]') as HTMLElement;
			const right = dom.document.querySelector('#diff-pane-right .diff-row[data-key="p1"]') as HTMLElement;
			assert.strictEqual(left.querySelectorAll('.condition').length, 2, 'both chips render');
			assert.strictEqual(right.querySelectorAll('.condition').length, 2);
			assert.deepStrictEqual(
				Array.from(left.querySelectorAll('.condition .word-changed')).map((node) => node.textContent),
				['1', '1'],
				'both left chips highlight their own pair'
			);
			assert.deepStrictEqual(
				Array.from(right.querySelectorAll('.condition .word-changed')).map((node) => node.textContent),
				['2', '2'],
				'both right chips highlight their own pair'
			);
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

	test('a semantic pair renders like a changed row and the mode group posts the target', () => {
		const row = wordRow({
			key: 'renamed',
			kind: 'container',
			hasChildren: false,
			left: containerCell('OldName'),
			right: containerCell('NewName'),
			match: {
				kind: 'semantic',
				score: 0.83,
				reasons: { children: 1, name: 0.8, position: 1, substitution: 0.5 },
				substitutions: ['Old→New'],
			},
		});
		const document = wordDocument([row]);
		const { dom } = mount();
		try {
			dom.post({ type: 'document', semantic: true, document });
			const rendered = dom.document.querySelector('#diff-pane-left .diff-row[data-key="renamed"]');
			assert.ok(rendered);
			assert.strictEqual(rendered!.getAttribute('data-status'), 'changed');
			assert.strictEqual(rendered!.hasAttribute('data-rename-implied'), false);
			assert.strictEqual(dom.document.querySelector('.diff-match-badge'), null);
			assert.strictEqual(dom.document.getElementById('diff-summary'), null);

			const semantic = dom.document.getElementById('diff-mode-semantic') as HTMLElement;
			const strict = dom.document.getElementById('diff-mode-strict') as HTMLElement;
			assert.strictEqual(semantic.getAttribute('aria-pressed'), 'true');
			assert.strictEqual(strict.getAttribute('aria-pressed'), 'false');

			strict.click();
			assert.strictEqual(semantic.getAttribute('aria-pressed'), 'false', 'the view group flips immediately');
			assert.strictEqual(strict.getAttribute('aria-pressed'), 'true');
			assert.strictEqual(strict.getAttribute('aria-busy'), 'true');
			assert.strictEqual(dom.document.getElementById('diff-match-status')!.textContent, 'Switching to Strict…');
			assert.strictEqual(messagesOf(dom.api, 'matchMode')[0].semantic, false);
			dom.post({ type: 'matchModeState', semantic: false });
			assert.strictEqual(strict.getAttribute('aria-busy'), 'false');
			assert.strictEqual(dom.document.getElementById('diff-match-status')!.textContent, '');

			semantic.click();
			assert.strictEqual(semantic.getAttribute('aria-busy'), 'true');
			assert.strictEqual(dom.document.getElementById('diff-match-status')!.textContent, 'Switching to Semantic…');
			dom.post({ type: 'document', semantic: true, document });
			assert.strictEqual(semantic.getAttribute('aria-busy'), 'false');
			assert.strictEqual(semantic.getAttribute('aria-pressed'), 'true');
			assert.strictEqual(strict.getAttribute('aria-pressed'), 'false');
			assert.strictEqual(dom.document.getElementById('diff-match-status')!.textContent, '');

			strict.click();
			assert.strictEqual(strict.getAttribute('aria-busy'), 'true');
			dom.post({ type: 'error', message: 'switch failed' });
			assert.strictEqual(strict.getAttribute('aria-busy'), 'false', 'an error also clears pending');
			assert.strictEqual(dom.document.getElementById('diff-match-status')!.textContent, '');
			assert.ok(dom.document.getElementById('diff-notice')!.textContent!.includes('switch failed'));
		} finally {
			dom.restore();
		}
	});

	test('Context defaults to five lines and widens the hidden runs when toggled off', () => {
		const { dom } = mount();
		try {
			dom.post({ type: 'document', semantic: true, document: wordDocument(contextRows()) });
			(dom.document.getElementById('diff-view-diff') as HTMLElement).click();
			const context = dom.document.getElementById('diff-context') as HTMLElement;
			assert.strictEqual(context.hasAttribute('disabled'), false);
			assert.strictEqual(context.getAttribute('aria-pressed'), 'true');
			const firstGap = dom.document.querySelector('#diff-pane-left .diff-gap-toggle');
			assert.ok(firstGap);
			assert.ok(firstGap!.textContent!.includes('1 unchanged line'), firstGap!.textContent!);
			assert.strictEqual(dom.document.querySelector('#diff-pane-left .diff-row[data-key="p0"]'), null);

			context.click();
			assert.strictEqual(context.getAttribute('aria-pressed'), 'false');
			const widerGap = dom.document.querySelector('#diff-pane-left .diff-gap-toggle');
			assert.ok(widerGap);
			assert.ok(widerGap!.textContent!.includes('6 unchanged lines'), widerGap!.textContent!);
		} finally {
			dom.restore();
		}
	});

	test('a split line expands and collapses the hidden unchanged rows', () => {
		const { dom } = mount();
		try {
			dom.post({ type: 'document', semantic: true, document: wordDocument(contextRows()) });
			(dom.document.getElementById('diff-view-diff') as HTMLElement).click();
			(dom.document.getElementById('diff-context') as HTMLElement).click();
			const gap = dom.document.querySelector('#diff-pane-left .diff-gap-toggle') as HTMLElement;
			assert.ok(gap);
			assert.strictEqual(gap.getAttribute('aria-expanded'), 'false');
			assert.strictEqual(dom.document.querySelector('#diff-pane-left .diff-row[data-key="p0"]'), null);
			assert.strictEqual(dom.document.querySelector('#diff-pane-right .diff-gap-toggle'), null);
			const line = dom.document.querySelector('#diff-pane-right .diff-gap-line') as HTMLElement;
			assert.ok(line);
			line.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			const expanded = dom.document.querySelector('#diff-pane-left .diff-gap-toggle') as HTMLElement;
			assert.strictEqual(expanded.getAttribute('aria-expanded'), 'true');
			assert.ok(dom.document.querySelector('#diff-pane-left .diff-row[data-key="p0"]'));

			expanded.click();
			const collapsed = dom.document.querySelector('#diff-pane-left .diff-gap-toggle') as HTMLElement;
			assert.strictEqual(collapsed.getAttribute('aria-expanded'), 'false');
			assert.strictEqual(dom.document.querySelector('#diff-pane-left .diff-row[data-key="p0"]'), null);
		} finally {
			dom.restore();
		}
	});

	test('a container carries the live expanded state in both panes', () => {
		const parent = wordRow({
			key: 'parent',
			kind: 'container',
			hasChildren: true,
			subtreeSize: 1,
			left: containerCell('Parent'),
			right: containerCell('Parent'),
		});
		const child = wordRow({
			key: 'child',
			parentKey: 'parent',
			level: 2,
			subtreeSize: 0,
			left: wordCell({ label: 'Child' }),
			right: wordCell({ label: 'Child' }),
		});
		const { dom } = mount();
		try {
			dom.post({ type: 'document', semantic: false, document: wordDocument([parent, child]) });
			for (const pane of ['left', 'right']) {
				assert.strictEqual(
					dom.document.querySelector(`#diff-pane-${pane} .diff-row[data-key="parent"] .node`)?.getAttribute('aria-expanded'),
					'true',
					`${pane}: expanded`
				);
			}
			const twisty = dom.document.querySelector('#diff-pane-left .diff-row[data-key="parent"] .twisty');
			assert.ok(twisty);
			twisty!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			for (const pane of ['left', 'right']) {
				assert.strictEqual(
					dom.document.querySelector(`#diff-pane-${pane} .diff-row[data-key="parent"] .node`)?.getAttribute('aria-expanded'),
					'false',
					`${pane}: collapsed`
				);
			}
		} finally {
			dom.restore();
		}
	});

	test('clicking either pane selects the row in both panes', () => {
		const parent = wordRow({
			key: 'parent',
			kind: 'container',
			hasChildren: true,
			subtreeSize: 1,
			left: containerCell('Parent'),
			right: containerCell('Parent'),
		});
		const child = wordRow({
			key: 'child',
			parentKey: 'parent',
			level: 2,
			left: wordCell({ label: 'Child' }),
			right: wordCell({ label: 'Child' }),
		});
		const { dom } = mount();
		try {
			dom.post({ type: 'document', semantic: false, document: wordDocument([parent, child]) });
			const row = dom.document.querySelector('#diff-pane-right .diff-row[data-key="parent"] .row');
			assert.ok(row);
			row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			for (const pane of ['left', 'right']) {
				assert.strictEqual(
					dom.document.querySelector(`#diff-pane-${pane} .diff-row[data-key="parent"]`)?.getAttribute('data-selected'),
					'true',
					`${pane}: selected`
				);
			}
		} finally {
			dom.restore();
		}
	});

	test('the diff uses the shared document selection rule', () => {
		const diff = webviewCss('components', 'diffView', 'diffView.css');
		assert.ok(!diff.includes('.diff-row[data-selected="true"]'), 'the diff-only selection rule is gone');
		const tree = webviewCss('components', 'documentTree', 'documentTree.css');
		assert.ok(tree.includes('.node[data-kind="module"][data-selected="true"] > .row'));
		assert.ok(tree.includes('.node[aria-expanded="false"] > .row::after'));
	});

	test('added rows use a leading edge and split lines own their styles', () => {
		const diff = webviewCss('components', 'diffView', 'diffView.css');
		assert.ok(diff.includes('.diff-row[data-status="added"] > .diff-cell[data-side="right"]'));
		assert.ok(diff.includes('inset 3px 0 0 var(--diff-added-edge)'));
		assert.ok(!diff.includes('inset -3px 0 0 var(--diff-added-edge)'), 'the trailing added edge is gone');
		assert.ok(diff.includes('.diff-gap-toggle'));
		assert.ok(diff.includes('.diff-gap-line'));
		assert.ok(diff.includes('.toolbar-center'));
		assert.ok(/\.toolbar-center\s*\{[^}]*position:\s*absolute/.test(diff));
		assert.ok(/left:\s*50%/.test(diff));
		assert.ok(/transform:\s*translate\(-50%,\s*-50%\)/.test(diff));
		assert.ok(!diff.includes('.diff-match-badge'), 'the renamed badge is gone');
		assert.ok(!diff.includes('data-rename-implied'), 'the dashed rename marker is gone');
		const toolbar = webviewCss('components', 'toolbar', 'toolbar.css');
		assert.ok(toolbar.includes('.diff-tool'));
		assert.ok(toolbar.includes('.toolbar-divider'));
		const diffGapCss = webviewCss('components', 'diffView', 'diffView.css');
		assert.ok(/\.diff-header-gap-row\s*\{[^}]*height:\s*var\(--ecuc-lh\)/.test(diffGapCss));
		assert.ok(!diffGapCss.includes('.diff-header-gap-line'), 'the header gap has no rule element');
		assert.ok(
			/\.document-tree-line-number\[data-status="added"\]\s*\{[^}]*--vscode-diffEditorGutter-insertedLineBackground[^}]*--diff-added-bg/.test(
				diffGapCss
			),
			'the added gutter follows the inserted tint'
		);
		assert.ok(
			/\.document-tree-line-number\[data-status="removed"\]\s*\{[^}]*--vscode-diffEditorGutter-removedLineBackground[^}]*--diff-removed-bg/.test(
				diffGapCss
			),
			'the removed gutter follows the deleted tint'
		);
		assert.ok(
			/\.document-tree-line-number\[data-status="changed"\]\s*\{[^}]*--diff-changed-bg/.test(diffGapCss),
			'the changed gutter follows the changed tint'
		);
		assert.ok(
			diffGapCss.includes(
				'.document-tree-lines[data-side="left"] .document-tree-line-number[data-status="changed"]'
			),
			'the left pane redraws its changed rail over the gutter'
		);
		assert.ok(
			diffGapCss.includes(
				'.document-tree-lines[data-side="left"] .document-tree-line-number[data-status="removed"]'
			),
			'the left pane redraws its removed rail over the gutter'
		);
		assert.ok(
			diffGapCss.includes(
				'.document-tree-lines[data-side="right"] .document-tree-line-number[data-status="added"]'
			),
			'the right pane redraws its added rail over the gutter'
		);
		assert.ok(toolbar.includes('flex-direction: column'));
		assert.ok(toolbar.includes('width: 60px'), 'one fixed width for every diff button');
		assert.ok(toolbar.includes('height: 48px'), 'one fixed height for every diff button');
		assert.ok(toolbar.includes('white-space: normal'), 'long labels wrap inside the fixed box');
		assert.ok(toolbar.includes('max-width: 1040px'), 'labels hide before the row can overlap');
		assert.ok(toolbar.includes('max-width: 720px'), 'compact icon buttons at very narrow widths');
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

	test('the header keyword and value are searchable and marked in both panes', async () => {
		const changed = wordRow({ left: wordCell(), right: wordCell({ shownValue: '200', value: '200' }) });
		const document = wordDocument([changed]);
		document.leftHeader = { schema: '00048', packages: ['HeaderPkg'] };
		document.rightHeader = { schema: '00048', packages: ['HeaderPkg'] };
		const { dom } = mount(document);
		try {
			for (const query of ['Head', 'HeaderPkg', 'package', 'pack', 'schema', 'sche', '00048']) {
				await runDiffSearch(dom, query);
				assertHeaderSearch(dom, query);
			}
			assert.strictEqual(messagesOf(dom.api, 'select').length, 0, 'a header search jump never selects');
		} finally {
			dom.restore();
		}
	});

	test('a refresh or a view switch at the top keeps the header rows at the top', () => {
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
		document.leftHeader = { schema: '00048', packages: ['PkgA'] };
		document.rightHeader = { schema: '00048', packages: ['PkgA'] };
		const { dom } = mount(document);
		try {
			const scroller = dom.document.querySelector('#diff-list > .virtual-scroll-vscroll') as HTMLElement;
			assert.strictEqual(scroller.scrollTop, 0, 'the header rows are at the top');
			assert.ok(dom.document.querySelector('#diff-pane-left .diff-header-row'));
			dom.post({ type: 'document', semantic: false, document });
			assert.strictEqual(scroller.scrollTop, 0, 'a refresh at the top keeps the header rows');
			(dom.document.getElementById('diff-view-diff') as HTMLElement).click();
			assert.strictEqual(scroller.scrollTop, 0, 'Show diff at the top keeps the header rows');
			(dom.document.getElementById('diff-view-all') as HTMLElement).click();
			assert.strictEqual(scroller.scrollTop, 0, 'Show all at the top keeps the header rows');
		} finally {
			dom.restore();
		}
	});

	test('the shorter header is padded so the first compared row aligns', () => {
		const document = wordDocument([
			wordRow({ left: wordCell(), right: wordCell({ shownValue: '200', value: '200' }) })
		]);
		document.leftHeader = { schema: '00048', packages: ['PkgA'] };
		document.rightHeader = { schema: '00048', packages: ['PkgB', 'PkgC'] };
		const { dom } = mount(document);
		try {
			const leftRows = Array.from(dom.document.querySelectorAll('#diff-pane-left .diff-header-row')) as HTMLElement[];
			const rightRows = Array.from(dom.document.querySelectorAll('#diff-pane-right .diff-header-row')) as HTMLElement[];
			assert.strictEqual(leftRows.length, 3);
			assert.strictEqual(rightRows.length, 3);
			assert.ok(leftRows[0].textContent!.includes('00048'));
			assert.ok(rightRows[0].textContent!.includes('00048'));
			assert.ok(leftRows[2].querySelector('.diff-header-cell[data-header-empty="true"]'), 'the left pad row is blank');
			assert.ok(rightRows[2].textContent!.includes('PkgC'));
		} finally {
			dom.restore();
		}
	});

	test('the header gap is one inert blank line with no rule in both panes', () => {
		const { dom } = mount(documentOf());
		try {
			for (const pane of ['left', 'right'] as const) {
				const gap = dom.document.querySelector(`#diff-pane-${pane} .diff-header-gap-row`) as HTMLElement;
				assert.ok(gap, `${pane} gap exists`);
				assert.strictEqual(gap.getAttribute('role'), 'presentation');
				assert.strictEqual(gap.getAttribute('aria-hidden'), 'true');
				assert.strictEqual(gap.hasAttribute('data-key'), false);
				assert.strictEqual(gap.tabIndex, -1);
				assert.strictEqual(gap.children.length, 0, `${pane} gap has no rule child`);
				assert.ok(gap.previousElementSibling?.classList.contains('diff-header-row'), `${pane} gap follows headers`);
				assert.ok(gap.nextElementSibling?.classList.contains('diff-row'), `${pane} gap precedes data rows`);
				const headerCount = dom.document.querySelectorAll(
					`#diff-pane-${pane} .diff-header-cell:not([data-header-empty="true"])`
				).length;
				assert.strictEqual(
					paneCellAt(dom, pane, Number(gap.dataset.documentIndex)).textContent,
					String(headerCount + 1),
					`${pane} gap is a numbered blank line`
				);
			}
			const gap = dom.document.querySelector('#diff-pane-left .diff-header-gap-row') as HTMLElement;
			gap.click();
			assert.strictEqual(messagesOf(dom.api, 'reveal').length, 0, 'clicking the gap does not reveal');
			assert.strictEqual(messagesOf(dom.api, 'select').length, 0, 'clicking the gap does not select');
		} finally {
			dom.restore();
		}
	});

	test('each pane numbers its own lines and leaves a padded header side blank', () => {
		const { dom } = mount(documentOf());
		try {
			const left = paneGutter(dom, 'left');
			const right = paneGutter(dom, 'right');
			assert.strictEqual(left.getAttribute('data-side'), 'left');
			assert.strictEqual(right.getAttribute('data-side'), 'right');
			assert.strictEqual(left.getAttribute('aria-hidden'), 'true');
			assert.strictEqual(left.tabIndex, -1);
			const leftWidth = (dom.document.getElementById('diff-pane-left') as HTMLElement).style.getPropertyValue(
				'--line-numbers-width'
			);
			const rightWidth = (dom.document.getElementById('diff-pane-right') as HTMLElement).style.getPropertyValue(
				'--line-numbers-width'
			);
			assert.ok(/^\d+ch$/.test(leftWidth) && /^\d+ch$/.test(rightWidth), `${leftWidth} / ${rightWidth}`);
			assert.ok(Number.parseFloat(leftWidth) >= 5 && Number.parseFloat(rightWidth) >= 5);

			// left header: one package line; right header: schema + two packages.
			assert.strictEqual(paneCellAt(dom, 'left', 0).textContent, '1');
			assert.strictEqual(paneCellAt(dom, 'left', 1).textContent, '', 'the padded left header line is blank');
			assert.strictEqual(paneCellAt(dom, 'left', 2).textContent, '', 'the padded left header line is blank');
			assert.deepStrictEqual(['0', '1', '2'].map((index) => paneCellAt(dom, 'right', Number(index)).textContent), [
				'1',
				'2',
				'3',
			]);
			assert.strictEqual(paneCellAt(dom, 'left', 3).textContent, '2', 'the gap continues the left numbering');
			assert.strictEqual(paneCellAt(dom, 'right', 3).textContent, '4', 'the gap continues the right numbering');
			assertPaneNumbering(dom, 'left');
			assertPaneNumbering(dom, 'right');
		} finally {
			dom.restore();
		}
	});

	test('a row missing on one side leaves that gutter blank', () => {
		const added = wordRow({
			key: 'add',
			status: 'added',
			left: undefined,
			right: wordCell({ shownValue: '200', value: '200' }),
		});
		const removed = wordRow({ key: 'rem', status: 'removed', left: wordCell(), right: undefined });
		const { dom } = mount(wordDocument([added, removed]));
		try {
			assert.strictEqual(paneCellAt(dom, 'left', 0).textContent, '', 'an added row has no left line');
			assert.strictEqual(paneCellAt(dom, 'right', 0).textContent, '1');
			assert.strictEqual(paneCellAt(dom, 'left', 1).textContent, '1');
			assert.strictEqual(paneCellAt(dom, 'right', 1).textContent, '', 'a removed row has no right line');
			assert.strictEqual(assertPaneNumbering(dom, 'left'), 1);
			assert.strictEqual(assertPaneNumbering(dom, 'right'), 1);
		} finally {
			dom.restore();
		}
	});

	test('a hidden unchanged run is not numbered and visible rows renumber around it', () => {
		const { dom } = mount();
		try {
			dom.post({ type: 'document', semantic: true, document: wordDocument(contextRows()) });
			(dom.document.getElementById('diff-view-diff') as HTMLElement).click();
			const gap = dom.document.querySelector('#diff-pane-left .diff-gap-row') as HTMLElement;
			assert.ok(gap, 'a hidden unchanged run is a split line');
			assert.strictEqual(
				paneCellAt(dom, 'left', Number(gap.dataset.documentIndex)).textContent,
				'',
				'the split line is not numbered'
			);
			assert.strictEqual(
				paneCellAt(dom, 'right', Number(gap.dataset.documentIndex)).textContent,
				''
			);
			const numbers = paneCells(dom, 'left').filter((cell) => (cell.textContent ?? '') !== '');
			for (let at = 1; at < numbers.length; at++) {
				assert.strictEqual(
					Number(numbers[at].textContent),
					Number(numbers[at - 1].textContent) + 1,
					'numbering skips the hidden run without a gap'
				);
			}
			assertPaneNumbering(dom, 'left');
			assertPaneNumbering(dom, 'right');
		} finally {
			dom.restore();
		}
	});

	test('Show diff, Context, Swap and Collapse renumber both gutters', () => {
		const { dom } = mount(wordDocument(nestedRows()));
		try {
			assert.strictEqual(assertPaneNumbering(dom, 'left'), 8, 'nodes and brace lines all carry numbers');
			(dom.document.getElementById('diff-view-diff') as HTMLElement).click();
			assertPaneNumbering(dom, 'left');
			assertPaneNumbering(dom, 'right');
			(dom.document.getElementById('diff-context') as HTMLElement).click();
			assertPaneNumbering(dom, 'left');
			assertPaneNumbering(dom, 'right');
			(dom.document.getElementById('diff-swap') as HTMLElement).click();
			assertPaneNumbering(dom, 'left');
			assertPaneNumbering(dom, 'right');
			(dom.document.getElementById('diff-collapse-all') as HTMLElement).click();
			assert.strictEqual(assertPaneNumbering(dom, 'left'), 1, 'only the module row keeps a line');
			assert.strictEqual(assertPaneNumbering(dom, 'right'), 1);
			(dom.document.getElementById('diff-expand-all') as HTMLElement).click();
			assert.strictEqual(assertPaneNumbering(dom, 'left'), 8);
		} finally {
			dom.restore();
		}
	});

	test('the selected row number is active in both panes and clears with the row', () => {
		const nested = wordDocument(nestedRows());
		const { dom } = mount(nested);
		try {
			const row = dom.document.querySelector('#diff-pane-left .diff-row[data-key="c1"] .row') as HTMLElement;
			row.click();
			const index = Number(
				(dom.document.querySelector('#diff-pane-left .diff-row[data-key="c1"]') as HTMLElement).dataset.documentIndex
			);
			for (const pane of ['left', 'right'] as const) {
				const active = paneCells(dom, pane).filter((cell) => cell.dataset.active === 'true');
				assert.strictEqual(active.length, 1, `${pane} has one active number`);
				assert.strictEqual(Number(active[0].dataset.documentIndex), index);
			}
			dom.post({
				type: 'document',
				semantic: false,
				document: { ...nested, rows: nested.rows.filter((candidate) => candidate.key !== 'c1') },
			});
			for (const pane of ['left', 'right'] as const) {
				assert.strictEqual(
					paneCells(dom, pane).filter((cell) => cell.dataset.active === 'true').length,
					0,
					`${pane} clears the active number`
				);
			}
		} finally {
			dom.restore();
		}
	});

	test('the gutters never translate with the horizontally panned rows', async () => {
		const { dom } = mount();
		try {
			const bar = dom.document.querySelector('#diff-list .virtual-scroll-hscroll[data-pane="0"]') as HTMLElement;
			Object.defineProperty(bar, 'scrollLeft', { configurable: true, value: 40 });
			bar.dispatchEvent(new dom.window.Event('scroll'));
			await new Promise((resolve) => setTimeout(resolve, 10));
			for (const pane of ['left', 'right']) {
				const windowEl = dom.document.querySelector(
					`#diff-pane-${pane} .document-tree-window`
				) as HTMLElement;
				assert.strictEqual(windowEl.style.transform, 'translateX(-40px)');
				assert.strictEqual(
					(dom.document.querySelector(`#diff-pane-${pane} .document-tree-lines`) as HTMLElement).style.transform,
					'',
					`${pane} gutter stays fixed`
				);
			}
			assertPaneNumbering(dom, 'left');
			assertPaneNumbering(dom, 'right');
		} finally {
			dom.restore();
		}
	});

	test('the header gap is absent when there is no schema/package header', () => {
		const { dom } = mount(wordDocument(nestedRows()));
		try {
			assert.strictEqual(dom.document.querySelector('#diff-pane-left .diff-header-gap-row'), null);
			assert.strictEqual(dom.document.querySelector('#diff-pane-right .diff-header-gap-row'), null);
		} finally {
			dom.restore();
		}
	});

	test('Collapse all hides every child in both panes and Expand restores them', () => {
		const { dom } = mount(wordDocument(nestedRows()));
		try {
			const collapse = dom.document.getElementById('diff-collapse-all') as HTMLElement;
			const expand = dom.document.getElementById('diff-expand-all') as HTMLElement;
			collapse.focus();
			collapse.click();
			assert.ok(dom.document.querySelector('#diff-pane-left .diff-row[data-key="m"]'));
			assert.ok(dom.document.querySelector('#diff-pane-right .diff-row[data-key="m"]'));
			assert.strictEqual(dom.document.querySelector('#diff-pane-left .diff-row[data-key="c1"]'), null);
			assert.strictEqual(dom.document.querySelector('#diff-pane-right .diff-row[data-key="c1"]'), null);
			assert.strictEqual(dom.document.querySelector('#diff-pane-left .diff-row[data-key="p1"]'), null);
			assert.strictEqual(
				dom.document.querySelector('#diff-pane-left .diff-row[data-key="m"] .node')?.getAttribute('aria-expanded'),
				'false'
			);
			assert.strictEqual(dom.document.activeElement, collapse, 'focus stays on the toolbar button');
			collapse.click();
			assert.strictEqual(dom.document.querySelector('#diff-pane-left .diff-row[data-key="c1"]'), null);
			expand.click();
			assert.ok(dom.document.querySelector('#diff-pane-left .diff-row[data-key="c1"]'));
			assert.ok(dom.document.querySelector('#diff-pane-right .diff-row[data-key="p2"]'));
		} finally {
			dom.restore();
		}
	});

	test('Collapse all moves a hidden selection to its nearest visible ancestor', () => {
		const { dom } = mount(wordDocument(nestedRows()));
		try {
			const p1 = dom.document.querySelector(
				'#diff-pane-left .diff-row[data-key="p1"] .row'
			) as HTMLElement;
			p1.click();
			(dom.document.getElementById('diff-collapse-all') as HTMLElement).click();
			assert.strictEqual(
				dom.document.querySelector('#diff-pane-left .diff-row[data-key="m"]')?.getAttribute('data-selected'),
				'true',
				'selection moves to the nearest visible ancestor'
			);
			assert.strictEqual(
				dom.document.querySelector('#diff-pane-left .diff-row[data-key="m"] .node')?.getAttribute('data-selected'),
				'true',
				'the visible ancestor is painted selected in both panes'
			);
			(dom.document.getElementById('diff-expand-all') as HTMLElement).click();
			assert.strictEqual(
				dom.document.querySelector('#diff-pane-left .diff-row[data-key="m"]')?.getAttribute('data-selected'),
				'true',
				'expand restores rows without moving the selection'
			);
		} finally {
			dom.restore();
		}
	});

	test('Collapse all works in Show diff with Context off', () => {
		const { dom } = mount(wordDocument(nestedRows()));
		try {
			(dom.document.getElementById('diff-view-diff') as HTMLElement).click();
			(dom.document.getElementById('diff-context') as HTMLElement).click();
			assert.strictEqual(dom.document.getElementById('diff-context')!.getAttribute('aria-pressed'), 'false');
			(dom.document.getElementById('diff-collapse-all') as HTMLElement).click();
			assert.strictEqual(dom.document.querySelector('#diff-pane-left .diff-row[data-key="c1"]'), null);
			(dom.document.getElementById('diff-expand-all') as HTMLElement).click();
			assert.ok(dom.document.querySelector('#diff-pane-left .diff-row[data-key="c1"]'));
		} finally {
			dom.restore();
		}
	});

	test('Collapse all is a no-op for a leaf-only document', () => {
		const { dom } = mount(wordDocument([wordRow({ left: wordCell(), right: wordCell() })]));
		try {
			(dom.document.getElementById('diff-collapse-all') as HTMLElement).click();
			assert.ok(dom.document.querySelector('#diff-pane-left .diff-row[data-key="p1"]'));
		} finally {
			dom.restore();
		}
	});

	test('each pane owns an independent horizontal scrollbar', async () => {
		const { dom } = mount();
		try {
			const leftBar = dom.document.querySelector(
				'#diff-list .virtual-scroll-hscroll[data-pane="0"]'
			) as HTMLElement;
			const rightBar = dom.document.querySelector(
				'#diff-list .virtual-scroll-hscroll[data-pane="1"]'
			) as HTMLElement;
			assert.ok(leftBar && rightBar, 'one bar per pane');
			const leftSpacer = leftBar.querySelector('.virtual-scroll-hspacer') as HTMLElement;
			assert.ok(Number.parseFloat(leftSpacer.style.width) > 40, 'the left bar has a scrollable extent');
			let leftOffset = 0;
			Object.defineProperty(leftBar, 'scrollLeft', {
				configurable: true,
				get: () => leftOffset,
				set: (value: number) => {
					leftOffset = value;
				}
			});
			let rightOffset = 0;
			Object.defineProperty(rightBar, 'scrollLeft', {
				configurable: true,
				get: () => rightOffset,
				set: (value: number) => {
					rightOffset = value;
				}
			});
			Object.defineProperty(leftBar, 'scrollWidth', { value: 500, configurable: true });
			Object.defineProperty(leftBar, 'clientWidth', { value: 200, configurable: true });
			leftBar.scrollLeft = 40;
			leftBar.dispatchEvent(new dom.window.Event('scroll'));
			await new Promise((resolve) => setTimeout(resolve, 10));
			const leftWindow = dom.document.querySelector('#diff-pane-left .document-tree-window') as HTMLElement;
			const rightWindow = dom.document.querySelector('#diff-pane-right .document-tree-window') as HTMLElement;
			assert.strictEqual(leftWindow.style.transform, 'translateX(-40px)');
			assert.strictEqual(rightWindow.style.transform, 'translateX(-40px)');
			assert.strictEqual(rightBar.scrollLeft, 40, 'the other pane bar follows');
		} finally {
			dom.restore();
		}
	});

	test('the shared module gap is one blank numbered row in both panes', () => {
		const moduleRow = (key: string, posinset: number, left: string, right: string): DiffRow =>
			wordRow({
				key,
				kind: 'module',
				posinset,
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
		const { dom } = mount(
			wordDocument([moduleRow('m1', 1, 'PkgA', 'PkgX'), moduleRow('m2', 2, 'PkgB', 'PkgY')])
		);
		try {
			const gaps = ['left', 'right'].map(
				(pane) =>
					dom.document.querySelector(`#diff-pane-${pane} .diff-module-gap-row`) as HTMLElement
			);
			assert.ok(gaps[0] && gaps[1], 'both panes render the shared gap');
			assert.strictEqual(
				gaps[0].dataset.documentIndex,
				gaps[1].dataset.documentIndex,
				'the gap is the same virtual row in both panes'
			);
			const index = Number(gaps[0].dataset.documentIndex);
			for (const gap of gaps) {
				assert.ok(gap.classList.contains('diff-row'));
				assert.strictEqual(gap.getAttribute('role'), 'presentation');
				assert.strictEqual(gap.getAttribute('aria-hidden'), 'true');
				assert.strictEqual(gap.tabIndex, -1);
				assert.strictEqual(gap.hasAttribute('data-key'), false);
				assert.strictEqual(gap.hasAttribute('data-status'), false);
				assert.strictEqual(gap.children.length, 0, 'the gap has no cell or rule child');
				assert.strictEqual(
					gap.previousElementSibling?.getAttribute('data-key'),
					'm1',
					'the gap follows the first module'
				);
				assert.strictEqual(gap.nextElementSibling?.getAttribute('data-key'), 'm2');
			}
			assert.strictEqual(
				dom.document.querySelectorAll('#diff-pane-left .diff-cell').length,
				dom.document.querySelectorAll('#diff-pane-left [role="treeitem"]').length +
					dom.document.querySelectorAll('#diff-pane-left .diff-structural').length,
				'the gap adds no cell'
			);
			for (const pane of ['left', 'right'] as const) {
				assert.strictEqual(paneCellAt(dom, pane, index).textContent, '2', `${pane} numbers the gap`);
				assert.strictEqual(assertPaneNumbering(dom, pane), 3, `${pane} numbering continues through it`);
			}

			gaps[0].click();
			assert.strictEqual(messagesOf(dom.api, 'select').length, 0, 'clicking the gap does not select');
			assert.strictEqual(messagesOf(dom.api, 'reveal').length, 0, 'clicking the gap does not reveal');
			paneCellAt(dom, 'left', index).click();
			assert.strictEqual(messagesOf(dom.api, 'select').length, 0, 'clicking the gap number does not select');

			const tree = dom.document.getElementById('diff-pane-left') as HTMLElement;
			tree.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'F7', bubbles: true, cancelable: true }));
			assert.strictEqual(
				dom.document.querySelectorAll('.diff-module-gap-row[data-selected="true"]').length,
				0,
				'F7 never selects the gap'
			);
		} finally {
			dom.restore();
		}
	});

	test('a module hidden by Show diff gets no gap; Show all restores it', () => {
		const rows: DiffRow[] = [
			wordRow({
				key: 'm1',
				kind: 'module',
				hasChildren: true,
				subtreeSize: 1,
				status: 'unchanged',
				left: containerCell('M1'),
				right: containerCell('M1'),
			}),
			wordRow({
				key: 'p1',
				parentKey: 'm1',
				level: 2,
				status: 'unchanged',
				left: wordCell({ label: 'P1' }),
				right: wordCell({ label: 'P1' }),
			}),
			wordRow({
				key: 'm2',
				kind: 'module',
				posinset: 2,
				setsize: 2,
				hasChildren: true,
				subtreeSize: 1,
				status: 'unchanged',
				left: containerCell('M2'),
				right: containerCell('M2'),
			}),
			wordRow({
				key: 'p2',
				parentKey: 'm2',
				level: 2,
				status: 'changed',
				left: wordCell({ label: 'P2' }),
				right: wordCell({ label: 'P2', shownValue: '2', value: '2' }),
			}),
		];
		const comparison = wordDocument(rows);
		const { dom } = mount(comparison);
		try {
			(dom.document.getElementById('diff-view-diff') as HTMLElement).click();
			(dom.document.getElementById('diff-context') as HTMLElement).click();
			assert.strictEqual(
				dom.document.querySelectorAll('.diff-module-gap-row').length,
				0,
				'the hidden first module leaves no gap and the first visible module needs none'
			);
			assert.strictEqual(
				dom.document.querySelectorAll('.diff-gap-row').length,
				2,
				'each hidden run is still its own split line'
			);
			assertPaneNumbering(dom, 'left');
			assertPaneNumbering(dom, 'right');

			(dom.document.getElementById('diff-view-all') as HTMLElement).click();
			const left = dom.document.querySelector('#diff-pane-left .diff-module-gap-row') as HTMLElement;
			const right = dom.document.querySelector('#diff-pane-right .diff-module-gap-row') as HTMLElement;
			assert.ok(left && right, 'Show all restores the gap in both panes');
			assertGapPlacement(left, right);
			assert.strictEqual(
				assertPaneNumbering(dom, 'left'),
				9,
				'both modules, their braces and the gap are numbered'
			);
			(dom.document.getElementById('diff-swap') as HTMLElement).click();
			assertGapInBothPanes(dom, 'a swap keeps the shared gap');
			assertPaneNumbering(dom, 'left');
			assertPaneNumbering(dom, 'right');
			dom.post({ type: 'document', semantic: false, document: comparison });
			assertGapInBothPanes(dom, 'a refresh rebuilds the shared gap');
			assertPaneNumbering(dom, 'left');
			assertPaneNumbering(dom, 'right');
			(dom.document.getElementById('diff-collapse-all') as HTMLElement).click();
			assert.strictEqual(
				dom.document.querySelectorAll('.diff-module-gap-row').length,
				2,
				'collapse rebuilds the gap in both panes'
			);
			assertPaneNumbering(dom, 'left');
			assertPaneNumbering(dom, 'right');
		} finally {
			dom.restore();
		}
	});

	test('search skips the shared module gap', async () => {
		const moduleRow = (key: string, posinset: number, label: string): DiffRow =>
			wordRow({
				key,
				kind: 'module',
				posinset,
				setsize: 2,
				left: wordCell({ kind: 'module', label, shownValue: undefined, value: undefined, valueKind: undefined }),
				right: wordCell({ kind: 'module', label, shownValue: undefined, value: undefined, valueKind: undefined }),
			});
		const { dom } = mount(wordDocument([moduleRow('m1', 1, 'PkgA'), moduleRow('m2', 2, 'PkgB')]));
		try {
			await runDiffSearch(dom, 'PkgB');
			assert.strictEqual(
				dom.document.querySelectorAll('.diff-module-gap-row[data-search-current="true"]').length,
				0,
				'the gap is not a search candidate'
			);
			const gapIndex = Number(
				(dom.document.querySelector('#diff-pane-left .diff-module-gap-row') as HTMLElement).dataset
					.documentIndex
			);
			assert.strictEqual(
				dom.document.querySelectorAll(
					`#diff-pane-left [data-search-current="true"][data-document-index="${gapIndex}"]`
				).length,
				0
			);
		} finally {
			dom.restore();
		}
	});

	test('the diff content width includes the header lines', () => {
		const document = wordDocument([wordRow({ left: wordCell(), right: wordCell() })]);
		const longPackage = 'Pkg.' + 'X'.repeat(180);
		document.leftHeader = { packages: [longPackage] };
		document.rightHeader = { packages: [longPackage] };
		const { dom } = mount(document);
		try {
			const spacer = dom.document.querySelector(
				'#diff-list .virtual-scroll-hscroll[data-pane="0"] .virtual-scroll-hspacer'
			) as HTMLElement;
			assert.ok(
				Number.parseFloat(spacer.style.width) > longPackage.length,
				'a long package path drives the horizontal extent'
			);
			const windowEl = dom.document.querySelector('#diff-pane-left .document-tree-window') as HTMLElement;
			const contentWidth = Number.parseFloat(
				windowEl.style.getPropertyValue('--document-tree-content-width')
			);
			assert.ok(
				contentWidth > longPackage.length,
				`the pane model publishes the header width (${contentWidth})`
			);
			assert.strictEqual(
				Number.parseFloat(spacer.style.width),
				contentWidth,
				'the window minimum covers the pane content extent, including the number column'
			);
		} finally {
			dom.restore();
		}
	});

	test('Arrow keys move the selection and Home/End jump to the ends', () => {
		const { dom } = mount(wordDocument(nestedRows()));
		try {
			const row = (key: string): HTMLElement =>
				dom.document.querySelector(`#diff-pane-left .diff-row[data-key="${key}"]`) as HTMLElement;
			const selected = (): string | undefined =>
				dom.document.querySelector('#diff-pane-left .diff-row[data-selected="true"]')?.getAttribute('data-key') ?? undefined;
			const press = (key: string, target: HTMLElement): KeyboardEvent => {
				const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
				target.dispatchEvent(event);
				return event;
			};

			assert.strictEqual(press('ArrowDown', row('m')).defaultPrevented, true);
			assert.strictEqual(selected(), 'm', 'ArrowDown starts at the first node');
			press('ArrowDown', row('m'));
			assert.strictEqual(selected(), 'c1');
			press('ArrowUp', row('c1'));
			assert.strictEqual(selected(), 'm');
			press('Home', row('m'));
			assert.strictEqual(selected(), 'm', 'Home stops at the first node');
			press('End', row('m'));
			assert.strictEqual(selected(), 'p2', 'End stops at the last node');
			press('Home', row('p2'));
			assert.strictEqual(selected(), 'm');
		} finally {
			dom.restore();
		}
	});

	test('ArrowRight enters or expands and ArrowLeft collapses or returns to the parent', () => {
		const { dom } = mount(wordDocument(nestedRows()));
		try {
			const row = (key: string): HTMLElement =>
				dom.document.querySelector(`#diff-pane-left .diff-row[data-key="${key}"]`) as HTMLElement;
			const selected = (): string | undefined =>
				dom.document.querySelector('#diff-pane-left .diff-row[data-selected="true"]')?.getAttribute('data-key') ?? undefined;
			const press = (key: string, target: HTMLElement): void => {
				target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
			};

			row('m').querySelector('.row')!.dispatchEvent(
				new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
			);
			press('ArrowRight', row('m'));
			assert.strictEqual(selected(), 'c1', 'a right arrow enters the first child');
			press('ArrowRight', row('c1'));
			assert.strictEqual(selected(), 'p1');
			press('ArrowLeft', row('p1'));
			assert.strictEqual(selected(), 'c1', 'a left arrow returns to the parent');
			press('ArrowLeft', row('c1'));
			assert.strictEqual(selected(), 'c1', 'the expanded container stays selected');
			assert.strictEqual(dom.document.querySelector('#diff-pane-left .diff-row[data-key="p1"]'), null);
			press('ArrowRight', row('c1'));
			assert.strictEqual(selected(), 'c1', 'a collapsed container stays selected');
			assert.ok(dom.document.querySelector('#diff-pane-left .diff-row[data-key="p1"]'), 'right expands it');
		} finally {
			dom.restore();
		}
	});

	test('Space selects a row and Ctrl+F focuses Search', () => {
		const { dom } = mount(wordDocument(nestedRows()));
		try {
			const p2 = dom.document.querySelector('#diff-pane-left .diff-row[data-key="p2"]') as HTMLElement;
			const space = new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
			p2.dispatchEvent(space);
			assert.strictEqual(space.defaultPrevented, true);
			assert.strictEqual(
				(dom.document.querySelector('#diff-pane-left .diff-row[data-key="p2"]') as HTMLElement).dataset.selected,
				'true',
				'Space selects the row'
			);

			const shortcut = new dom.window.KeyboardEvent('keydown', {
				key: 'f',
				ctrlKey: true,
				bubbles: true,
				cancelable: true,
			});
			dom.document.body.dispatchEvent(shortcut);
			assert.strictEqual(shortcut.defaultPrevented, true);
			assert.strictEqual(dom.document.activeElement, dom.document.getElementById('diff-search-input'));
		} finally {
			dom.restore();
		}
	});

	test('Enter steps through search matches and wraps in both directions', async () => {
		const rows = ['alpha one', 'alpha two'].map((haystack, at) =>
			wordRow({
				key: `a${at + 1}`,
				posinset: at + 1,
				setsize: 2,
				haystack,
				left: wordCell({ label: `A${at + 1}` }),
				right: wordCell({ label: `A${at + 1}` }),
			})
		);
		const { dom } = mount(wordDocument(rows));
		try {
			await runDiffSearch(dom, 'alpha');
			const input = dom.document.getElementById('diff-search-input') as HTMLInputElement;
			const count = (): string => dom.document.getElementById('diff-search-count')!.textContent ?? '';
			const step = (shiftKey = false): void => {
				input.dispatchEvent(
					new dom.window.KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true, cancelable: true })
				);
			};
			assert.strictEqual(count(), '1 / 2');
			step();
			assert.strictEqual(count(), '2 / 2');
			step();
			assert.strictEqual(count(), '1 / 2', 'Enter wraps forward');
			step(true);
			assert.strictEqual(count(), '2 / 2', 'Shift+Enter wraps backward');
		} finally {
			dom.restore();
		}
	});

	test('clicking a header row focuses it without selecting a row', () => {
		const { dom } = mount(documentOf());
		try {
			const header = dom.document.querySelector('#diff-pane-left .diff-header-row') as HTMLElement;
			header.click();
			assert.strictEqual(header.tabIndex, 0, 'the header becomes the roving focus target');
			assert.strictEqual(dom.document.activeElement, header);
			assert.strictEqual(dom.document.querySelector('#diff-pane-left .diff-row[data-selected="true"]'), null);
			assert.strictEqual(messagesOf(dom.api, 'reveal').length, 0);
		} finally {
			dom.restore();
		}
	});

	test('module rows use the base row height in the virtual content', () => {
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
			const scroll = dom.document.querySelector('#diff-list > .virtual-scroll-vscroll') as HTMLElement;
			const content = scroll.querySelector('.virtual-scroll-content') as HTMLElement;
			const rendered = treeRows(dom.document, '#diff-pane-left').length;
			assert.ok(rendered > 0 && rendered < 199, 'only the window is rendered');
			assert.strictEqual(
				content.style.height,
				'3980px',
				'100 rows plus 99 shared module gaps at one base row height'
			);
		} finally {
			dom.restore();
		}
	});
});
