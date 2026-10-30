/**
 * The diff page shell and its serialized helpers (task design §3; ac14).
 * The test host has no webview DOM, so the page is asserted at the level of the
 * rendered shell plus the page's own functions, extracted with `scriptTestUtils`.
 * The real webview pass is the Extension Development Host.
 */
import * as assert from 'assert';

import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { DiffCell, DiffDocument, DiffRow, buildDiffDocument, flattenDiffRows } from '../../diff/diffModel';
import { diffCellFields, diffColumnWidth, diffFieldLabel, diffFieldRank, diffRowChars, encodeDiffDocument, renderDiffHtml } from '../../diff/diffPage';
import { buildNodeIndex } from '../../editor/nodeId';
import { buildRows } from '../../editor/renderRows';
import { renderHtml } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';
import { evaluateFunction, functionSource } from '../editor/scriptTestUtils';

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
		right.rangeOf
	);
}

function page(document = documentOf(), nonce = 'test-nonce'): string {
	return renderDiffHtml(document, { nonce });
}

function embedded(source = page()): DiffDocument {
	const match = /<script type="application\/json" id="diff-document"[^>]*>([\s\S]*?)<\/script>/.exec(source);
	assert.ok(match, 'the page embeds the diff document');
	return JSON.parse(match[1]) as DiffDocument;
}

function styleOf(source: string): string {
	const match = /<style[^>]*nonce[^>]*>([\s\S]*?)<\/style>/.exec(source);
	assert.ok(match, 'the nonce-carrying stylesheet is present');
	return match[1];
}

/** The smallest DOM the strip renderer needs, so `updateDetail` can be driven. */
class FakeElement {
	readonly tagName: string;
	className = '';
	title = '';
	children: FakeElement[] = [];
	readonly attributes: Record<string, string> = {};
	private text = '';

	constructor(tagName: string) {
		this.tagName = tagName;
	}

	get textContent(): string {
		return this.text;
	}

	set textContent(value: string) {
		this.text = value;
		if (value === '') {
			this.children = [];
		}
	}

	appendChild(child: FakeElement): void {
		this.children.push(child);
	}

	get childNodes(): FakeElement[] {
		return this.children;
	}

	setAttribute(name: string, value: string): void {
		this.attributes[name] = value;
	}

	addEventListener(): void {
		// The test never clicks a reveal button.
	}
}

function fakeDocument(): { createElement: (tag: string) => FakeElement } {
	return { createElement: (tag) => new FakeElement(tag) };
}

type DetailRenderer = (document: DiffDocument, row: DiffRow | undefined, swapped: boolean) => FakeElement;

/** Compiles the page's own strip renderer with its real helpers and a fake DOM. */
function compileDetail(html: string): DetailRenderer {
	const factory = new Function(
		'document',
		'vscode',
		`
		${functionSource(html, 'detailElement')}
		${functionSource(html, 'revealButton')}
		${functionSource(html, 'detailSideCell')}
		${functionSource(html, 'diffFieldLabel')}
		${functionSource(html, 'diffFieldRank')}
		${functionSource(html, 'diffCellFields')}
		${functionSource(html, 'displayLeft')}
		${functionSource(html, 'displayRight')}
		${functionSource(html, 'displayStatus')}
		let detail;
		let selectedKey;
		let rowByKey = new Map();
		let diffDocument = { left: { path: '' }, right: { path: '' }, labels: ['', ''] };
		let swapped = false;
		function appendConditionTokens(parent, text) { parent.textContent = text; }
		${functionSource(html, 'updateDetail')}
		return function (documentModel, row, isSwapped) {
			detail = document.createElement('div');
			diffDocument = documentModel;
			selectedKey = row === undefined ? undefined : row.key;
			rowByKey = row === undefined ? new Map() : new Map([[row.key, row]]);
			swapped = isSwapped === true;
			updateDetail();
			return detail;
		};
	`
	);
	return factory(fakeDocument(), { postMessage: () => undefined }) as DetailRenderer;
}

function descendants(element: FakeElement, className: string): FakeElement[] {
	const out: FakeElement[] = [];
	for (const child of element.children) {
		if (child.className.split(' ').includes(className)) {
			out.push(child);
		}
		out.push(...descendants(child, className));
	}
	return out;
}

function detailRow(overrides: Partial<DiffRow> = {}): DiffRow {
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

function detailCell(overrides: Partial<DiffCell> = {}): DiffCell {
	return {
		kind: 'parameter',
		label: 'Foo',
		definitionRef: '/P/Foo',
		meta: [],
		range: { start: 0, end: 1 },
		...overrides,
	};
}

function labels(): DiffDocument {
	return {
		left: { name: 'left.arxml', path: '/work/left.arxml' },
		right: { name: 'right.arxml', path: '/work/right.arxml' },
		labels: ['left.arxml', 'right.arxml'],
		rows: [],
		summary: { changed: 0, added: 0, removed: 0, unchanged: 0 },
	};
}

suite('semantic diff page (design §3)', () => {
	test('the shell has Search, Show all/Show diff only, Prev/Next diff and Swap sides', () => {
		const html = page();
		assert.strictEqual((html.match(/id="diff-filter"/g) || []).length, 0, 'the filter is gone');
		assert.strictEqual((html.match(/id="diff-changes"/g) || []).length, 0, 'the changes-only checkbox is gone');
		assert.strictEqual((html.match(/id="diff-summary"/g) || []).length, 0, 'the summary is gone');
		assert.strictEqual((html.match(/id="diff-collapse"/g) || []).length, 0, 'Collapse is gone');
		assert.strictEqual((html.match(/id="diff-expand"/g) || []).length, 0, 'Expand is gone');
		assert.strictEqual((html.match(/id="diff-search-input"/g) || []).length, 1);
		assert.ok(/id="diff-search-input"[^>]*type="search"/.test(html), 'Search is type="search"');
		assert.strictEqual((html.match(/id="diff-search-clear"/g) || []).length, 1, 'one clear control');
		assert.strictEqual((html.match(/id="diff-search-prev"/g) || []).length, 1);
		assert.strictEqual((html.match(/id="diff-search-next"/g) || []).length, 1);
		assert.ok(html.includes('id="diff-search-count"') && html.includes('id="diff-search-busy"'));
		assert.ok(
			/<span id="diff-search-count"[^>]*aria-live="polite"><\/span>/.test(html),
			'the count reserves its slot instead of hiding'
		);
		assert.ok(/id="diff-search-busy"[^>]*data-busy="false"/.test(html));
		assert.ok(/id="diff-view-all"[^>]*aria-pressed="true"[^>]*>Show all</.test(html));
		assert.ok(/id="diff-view-diff"[^>]*aria-pressed="false"[^>]*>Show diff only</.test(html));
		assert.ok(/id="diff-prev"[\s\S]*?>Prev diff</.test(html));
		assert.ok(/id="diff-next"[\s\S]*?>Next diff</.test(html));
		assert.ok(/id="diff-swap"[^>]*aria-pressed="false"[\s\S]*?>Swap sides</.test(html));
		const toolbar = /<div class="toolbar">([\s\S]*?)<div id="diff-notice"/.exec(html);
		assert.ok(toolbar, 'the toolbar is a distinct strip');
		const controls = toolbar[1];
		assert.ok(
			controls.indexOf('class="toolbar-center"') < controls.indexOf('class="toolbar-right"'),
			'Swap sits between the two flexible slots'
		);
		assert.ok(
			controls.indexOf('id="diff-view-all"') < controls.indexOf('id="diff-prev"') &&
				controls.indexOf('id="diff-prev"') < controls.indexOf('id="diff-next"') &&
				controls.indexOf('id="diff-next"') < controls.indexOf('class="search-box"'),
			'Show all, Show diff only, Prev diff, Next diff, then Search'
		);
		assert.ok(/id="diff-detail"[^>]*role="region"/.test(html), 'the detail strip is a region');
		assert.ok(html.includes('id="diff-empty"') && html.includes('id="diff-empty-text"'), 'the empty state exists');
		assert.ok(html.includes("'No differences'"), 'a pair with no changes has an explicit empty message');
		assert.ok(!html.includes(' changed · '), 'the changed/added/removed summary text is gone');
		assert.ok(html.includes('id="diff-left-label">left.arxml'), 'the left pane header');
		assert.ok(html.includes('id="diff-right-label">right.arxml'), 'the right pane header');
		assert.strictEqual((html.match(/id="diff-scroll"/g) || []).length, 1, 'one synchronized scroll container');
	});

	test('the page serializes search and side-swap behavior', () => {
		const html = page();
		assert.ok(html.includes('class RowSearchEngine'), 'the chunked row search engine');
		assert.ok(html.includes('searchCandidates = showChangesOnly'), 'search candidates follow the active view');
		assert.ok(html.includes("row.status !== 'unchanged'"));
		assert.ok(html.includes("searchInput.addEventListener('keydown'"), 'Search owns its keys');
		assert.ok(html.includes('executeSearch(event.shiftKey ? -1 : 1)'), 'Enter and Shift+Enter navigate');
		assert.ok(html.includes("event.key.toLowerCase() === 'f'"), 'Ctrl+F focuses Search');
		assert.ok(
			functionSource(html, 'onKeyDown').includes("closest('#diff-detail')"),
			'arrows still navigate after selecting strip text'
		);
		const row = functionSource(html, 'buildDiffRow');
		assert.ok(row.includes('displayLeft(row)') && row.includes('displayRight(row)'));
		assert.ok(row.includes("element.dataset.status = status"), 'the displayed status is rendered');
		assert.ok(row.includes("element.dataset.searchCurrent = 'true'"));
		const detail = functionSource(html, 'updateDetail');
		assert.ok(detail.includes('displayStatus(row)'));
		assert.ok(detail.includes('diffDocument.labels'), 'the strip headings follow the panes');
		assert.ok(detail.includes('displayLeft(row)') && detail.includes('displayRight(row)'), 'the strip shows the displayed sides');
		const reveal = functionSource(html, 'revealButton');
		assert.ok(reveal.includes("side: hostSide(side)"), 'a displayed side maps back to the host side');
		const swap = functionSource(html, 'setSwapped');
		assert.ok(swap.includes('renderHeaders()') && swap.includes('renderWindow(true)'));
		assert.ok(!swap.includes('scrollTop'), 'swapping never resets the single scroll container');
	});

	test('the shell is a tree with top/window/bottom spacers and a hidden probe', () => {
		const html = page();
		assert.ok(/id="diff-list"[^>]*role="tree"/.test(html));
		assert.ok(html.includes('id="diff-top"'));
		assert.ok(html.includes('id="diff-window"'));
		assert.ok(html.includes('id="diff-bottom"'));
		assert.ok(html.includes('id="diff-measure"'));
		assert.ok(html.includes("setAttribute('role', 'treeitem')"), 'rows are treeitems');
		assert.ok(html.includes("setAttribute('aria-level'"), 'rows expose their level');
		assert.ok(html.includes("setAttribute('aria-posinset'"), 'rows expose their sibling position');
		assert.ok(html.includes("setAttribute('aria-setsize'"), 'rows expose their sibling count');
		assert.ok(html.includes("setAttribute('aria-expanded'"), 'containers expose expansion');
		assert.ok(html.includes("setAttribute('aria-selected'"), 'rows expose selection');
		assert.ok(html.includes("'sr-only'"), 'a visually hidden status word is emitted');
		assert.ok(html.includes('line.dataset.level = String(row.level)'), 'depth is carried as data');
		assert.ok(/\.diff-cell > \.row\[data-level="3"\]/.test(html), 'indentation comes from generated attribute CSS');
	});

	test('the CSP and nonce guard the page; model text is escaped JSON', () => {
		const html = page();
		assert.ok(
			html.includes(
				"default-src 'none'; style-src 'nonce-test-nonce'; script-src 'nonce-test-nonce';"
			),
			'the CSP allows only the nonce-carrying style and script'
		);
		assert.ok(!html.includes('innerHTML'), 'model text is never inserted as markup');
		assert.ok(!html.includes('style="'), 'no inline style attributes');
		const hostile = documentOf();
		hostile.rows[0].left = {
			...hostile.rows[0].left!,
			label: '</script><img src=x>',
		};
		const payload = embedded(page(hostile));
		assert.strictEqual(payload.rows[0].left?.label, '</script><img src=x>', 'the text survives the JSON round trip');
		const encoded = encodeDiffDocument(hostile);
		assert.ok(encoded.includes('\\u003c/script\\u003e'), '< and > are escaped so model text cannot close the script');
		assert.ok(!encoded.includes('</script>'), 'the raw end tag never appears in the payload');
	});

	test('F7 is scoped to the diff list, so filter/input focus keeps its own keys', () => {
		const source = functionSource(page(), 'onKeyDown');
		assert.ok(source.includes("closest('#diff-list')"), 'F7 checks that the event target is in the tree');
		const f7 = source.indexOf("event.key === 'F7'");
		assert.ok(f7 >= 0, 'the F7 branch exists');
		assert.ok(source.indexOf("closest('#diff-list')") > f7, 'the scope check is inside the F7 branch');
		assert.ok(
			source.indexOf("closest('#diff-list')") < source.indexOf('gotoChange'),
			'the scope check runs before the F7 action'
		);
	});

	test('same-named files are disambiguated in the pane headers, and a swap follows', () => {
		const left = side('diff/left.arxml');
		const right = side('diff/right.arxml');
		const document = buildDiffDocument(
			{ name: 'same.arxml', path: '/w/a/same.arxml' },
			{ name: 'same.arxml', path: '/w/b/same.arxml' },
			left.rows,
			right.rows,
			left.rangeOf,
			right.rangeOf
		);
		const html = page(document);
		assert.ok(html.includes('id="diff-left-label">a/same.arxml'), 'the left header is disambiguated at first paint');
		assert.ok(html.includes('id="diff-right-label">b/same.arxml'), 'the right header is disambiguated at first paint');

		const run = new Function(
			'diffDocument',
			'swapped',
			'leftLabel',
			'rightLabel',
			'leftHeader',
			'rightHeader',
			`${functionSource(html, 'renderHeaders')}\nrenderHeaders();`
		) as (document: DiffDocument, swapped: boolean, left: unknown, right: unknown, leftHeader: unknown, rightHeader: unknown) => void;
		const leftEl = { textContent: '' };
		const rightEl = { textContent: '' };
		const leftHead = { title: '' };
		const rightHead = { title: '' };
		run(document, false, leftEl, rightEl, leftHead, rightHead);
		assert.strictEqual(leftEl.textContent, 'a/same.arxml');
		assert.strictEqual(rightEl.textContent, 'b/same.arxml');
		run(document, true, leftEl, rightEl, leftHead, rightHead);
		assert.strictEqual(leftEl.textContent, 'b/same.arxml', 'the label follows the displayed side');
		assert.strictEqual(rightEl.textContent, 'a/same.arxml');
		assert.strictEqual(leftHead.title, '/w/b/same.arxml', 'the tooltip follows the displayed side');
	});

	test('the strip vocabulary maps every compared field and keeps canonical order', () => {
		assert.strictEqual(diffFieldLabel('definition ref'), 'Definition');
		assert.strictEqual(diffFieldLabel('definition dest'), 'Definition DEST');
		assert.strictEqual(diffFieldLabel('short name'), 'Short name');
		assert.strictEqual(diffFieldLabel('variant'), 'Variant');
		assert.strictEqual(diffFieldLabel('value'), 'Value');
		assert.strictEqual(diffFieldLabel('shown value'), 'Value');
		assert.strictEqual(diffFieldLabel('target'), 'Target');
		assert.strictEqual(diffFieldLabel('context'), 'Context');
		assert.strictEqual(diffFieldLabel('condition'), 'Condition');
		assert.strictEqual(diffFieldLabel('annotation'), 'Annotations');
		assert.strictEqual(diffFieldLabel('mystery'), 'mystery', 'unknown fields survive as-is');

		const fields = [
			'annotation',
			'condition',
			'context',
			'target',
			'value',
			'variant',
			'short name',
			'definition dest',
			'definition ref',
			'mystery',
		];
		assert.deepStrictEqual(
			fields.slice().sort((a, b) => diffFieldRank(a) - diffFieldRank(b)),
			[
				'definition ref',
				'definition dest',
				'short name',
				'variant',
				'value',
				'target',
				'context',
				'condition',
				'annotation',
				'mystery',
			]
		);
	});

	test('an added or removed cell lists only its non-empty fields in canonical order', () => {
		assert.deepStrictEqual(
			diffCellFields(
				detailCell({
					definitionRef: '/P/Foo',
					shortName: '',
					shownValue: '7',
					value: '7',
					meta: [
						{ cls: 'variant', text: 'variant pre', title: '' },
						{ cls: 'condition', text: 'A == 1', title: '' },
						{ cls: 'condition', text: 'B == 2', title: '' },
						{ cls: 'annotation', text: 'one', title: '' },
						{ cls: 'annotation', text: 'two', title: '' },
					],
				})
			),
			[
				{ field: 'definition ref', text: '/P/Foo' },
				{ field: 'variant', text: 'variant pre' },
				{ field: 'value', text: '7' },
				{ field: 'condition', text: 'A == 1\nB == 2' },
				{ field: 'annotation', text: 'one\ntwo' },
			],
			'empty fields are dropped and meta groups are joined'
		);
		assert.deepStrictEqual(
			diffCellFields(detailCell({ definitionRef: '/P/C', contextPaths: ['A.B', 'C.D'], meta: [] })),
			[
				{ field: 'definition ref', text: '/P/C' },
				{ field: 'context', text: 'A.B, C.D' },
			],
			'a container reports its context path list'
		);
	});

	test('the strip styles reserve 22vh, stick its headings and hide the old definition line', () => {
		const html = page();
		const style = styleOf(html);
		assert.ok(/#diff-detail\s*\{[^}]*max-height:\s*22vh[^}]*overflow:\s*auto/.test(style), 'the strip scrolls internally');
		assert.ok(/#diff-detail\s*\{[^}]*user-select:\s*text/.test(style), 'the values are selectable');
		assert.ok(/\.detail-columns\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/.test(style), 'headings stick');
		assert.ok(/\.detail-columns,\s*\.detail-change\s*\{[^}]*14ch minmax\(0, 1fr\) minmax\(0, 1fr\)/.test(style));
		assert.ok(/\.detail-missing\s*\{[^}]*--tok-dim[^}]*font-style:\s*italic/.test(style));
		assert.ok(!/\.detail-definition/.test(style), 'the separate definition line is gone');
		const update = functionSource(html, 'updateDetail');
		assert.ok(update.includes("'detail-table'") && update.includes("'detail-columns'"), 'one table renderer');
		assert.ok(update.includes('diffDocument.labels'), 'the headings come from the model labels');
		assert.ok(
			functionSource(html, 'detailSideCell').includes("'— not in this file —'"),
			'the missing column explains itself'
		);
		assert.ok(update.includes("'No differences for this row.'"));
		assert.ok(update.includes("'Select a row to see its changes.'"));
		assert.ok(!update.includes('detail-definition'), 'the definition line is not rebuilt');
	});

	test('a changed row lists only its differing fields, sorted canonically', () => {
		const render = compileDetail(page());
		const row = detailRow({
			changes: [
				{ field: 'condition', left: 'A == 1', right: 'A == 2' },
				{ field: 'value', left: '1', right: '2' },
				{ field: 'definition ref', left: '/P/Foo', right: '/P/Bar' },
			],
			left: detailCell({ shortName: 'Same' }),
			right: detailCell({ shortName: 'Same', definitionRef: '/P/Bar' }),
		});
		const detail = render(labels(), row, false);
		const table = descendants(detail, 'detail-table')[0];
		assert.ok(table, 'a changed row has a table');
		assert.strictEqual(table.attributes.role, 'table');
		assert.strictEqual(table.attributes['aria-label'], 'left.arxml versus right.arxml');
		const headings = descendants(table, 'detail-columns')[0];
		assert.deepStrictEqual(
			headings.children.map((cell) => cell.textContent),
			['', 'left.arxml', 'right.arxml']
		);
		const lines = descendants(table, 'detail-change');
		assert.deepStrictEqual(
			lines.map((line) => line.children[0].textContent),
			['Definition', 'Value', 'Condition'],
			'canonical order, no unchanged Short name row'
		);
		assert.deepStrictEqual(
			lines.map((line) => [line.children[1].textContent, line.children[2].textContent]),
			[
				['/P/Foo', '/P/Bar'],
				['1', '2'],
				['A == 1', 'A == 2'],
			]
		);
		assert.strictEqual(descendants(detail, 'detail-actions')[0].children.length, 2, 'both sides reveal');
	});

	test('an added row lists the surviving side and marks the missing column', () => {
		const render = compileDetail(page());
		const row = detailRow({
			status: 'added',
			right: detailCell({
				definitionRef: '/P/New',
				shownValue: '7',
				meta: [{ cls: 'annotation', text: 'note', title: '' }],
			}),
		});
		const detail = render(labels(), row, false);
		const lines = descendants(detail, 'detail-change');
		assert.deepStrictEqual(
			lines.map((line) => [line.children[1].textContent, line.children[2].textContent]),
			[
				['— not in this file —', '/P/New'],
				['— not in this file —', '7'],
				['— not in this file —', 'note'],
			]
		);
		assert.ok(lines.every((line) => line.children[1].className.includes('detail-missing')));
		assert.ok(lines.every((line) => !line.children[2].className.includes('detail-missing')));

		const swapped = render(labels(), row, true);
		const flipped = descendants(swapped, 'detail-change');
		assert.deepStrictEqual(
			flipped.map((line) => [line.children[1].textContent, line.children[2].textContent]),
			[
				['/P/New', '— not in this file —'],
				['7', '— not in this file —'],
				['note', '— not in this file —'],
			],
			'after Swap sides the surviving file is the left column'
		);
	});

	test('swap flips the strip values and headings together', () => {
		const render = compileDetail(page());
		const row = detailRow({
			changes: [{ field: 'value', left: '1', right: '2' }],
			left: detailCell(),
			right: detailCell(),
		});
		const detail = render(labels(), row, true);
		assert.deepStrictEqual(
			descendants(detail, 'detail-columns')[0].children.map((cell) => cell.textContent),
			['', 'right.arxml', 'left.arxml']
		);
		const line = descendants(detail, 'detail-change')[0];
		assert.deepStrictEqual([line.children[1].textContent, line.children[2].textContent], ['2', '1']);
	});

	test('unchanged and unselected rows show a note, never a table', () => {
		const render = compileDetail(page());
		const unchanged = render(labels(), detailRow({ status: 'unchanged' }), false);
		assert.strictEqual(descendants(unchanged, 'detail-table').length, 0);
		assert.deepStrictEqual(
			descendants(unchanged, 'detail-note').map((note) => note.textContent),
			['No differences for this row.']
		);
		const none = render(labels(), undefined, false);
		assert.deepStrictEqual(
			descendants(none, 'detail-hint').map((hint) => hint.textContent),
			['Select a row to see its changes.']
		);
	});

	test('the width model counts indent, label, value and meta on the wider side', () => {
		const parameter = detailRow({
			level: 1,
			left: detailCell({ label: 'Foo', shownValue: '123', meta: [] }),
			right: detailCell({ label: 'LongerName', shownValue: '12345', meta: [] }),
		});
		assert.strictEqual(diffRowChars(parameter), 2 + 10 + 5 + 3, 'the longer side wins');
		const container = detailRow({
			level: 2,
			left: detailCell({
				kind: 'container',
				label: 'C',
				meta: [
					{ cls: 'short', text: 'short abc', title: '' },
					{ cls: 'variant', text: 'variant v', title: '' },
				],
			}),
		});
		assert.strictEqual(diffRowChars(container), 4 + 1 + 10 + 10, 'indent and one gap per fragment');
		const moduleRow = detailRow({
			level: 1,
			kind: 'module',
			left: detailCell({ kind: 'module', label: 'M', meta: [] }),
		});
		assert.strictEqual(diffRowChars(moduleRow), 2 + 1 + 7, 'the rendered "module " prefix is counted');
		assert.strictEqual(
			diffRowChars(detailRow({ left: detailCell({ label: 'P', shownValue: undefined, meta: [] }) })),
			2 + 1 + 3,
			'the "= " separator renders even without a value'
		);
		assert.strictEqual(diffRowChars(detailRow({ left: undefined, right: undefined })), 0);
	});

	test('a column is at least half the viewport, fits the longest row and is capped', () => {
		assert.strictEqual(diffColumnWidth(10, 8, 500, 1600), 500, 'short content keeps the half-viewport column');
		assert.strictEqual(diffColumnWidth(100, 8, 500, 1600), 828, 'the longest row widens both tracks');
		assert.strictEqual(diffColumnWidth(5000, 8, 500, 1600), 1600, 'a pathological line is clamped');
	});

	test('the tracks share one width and one scrollbar moves both panes', () => {
		const html = page();
		const style = styleOf(html);
		assert.ok(/#diff-scroll\s*\{[^}]*--diff-col:\s*50vw/.test(style), 'the first paint has a half-viewport column');
		assert.ok(
			/\.pane-headers\s*\{[^}]*grid-template-columns:\s*var\(--diff-col\) var\(--diff-col\)[^}]*width:\s*calc\(var\(--diff-col\) \* 2\)/.test(
				style
			),
			'the header row is as wide as its tracks'
		);
		assert.ok(
			/#diff-window\s*\{[^}]*width:\s*calc\(var\(--diff-col\) \* 2\)/.test(style),
			'the row window is as wide as its tracks'
		);
		assert.ok(
			/#diff-measure \.diff-row,\s*#diff-measure \.probe\s*\{[^}]*minmax\(0, 1fr\) minmax\(0, 1fr\)/.test(style),
			'the hidden probe is never widened'
		);
		assert.ok(/#diff-scroll\s*\{[^}]*overflow:\s*auto/.test(style), 'the diff scroller is the scroll surface');
		assert.strictEqual((style.match(/overflow-x:/g) || []).length, 0, 'no second horizontal scroll surface');
		assert.ok(html.includes('id="diff-ch-probe"'), 'one font probe feeds the width model');
		assert.strictEqual((html.match(/id="diff-ch-probe"/g) || []).length, 1);
		assert.ok(/\.toolbar\s*\{[^}]*height:\s*26px/.test(style), 'the diff toolbar stays one 26px row');

		const measure = functionSource(html, 'measureColumnWidth');
		assert.ok(measure.includes('diffRowChars(row)') && measure.includes('scroll.clientWidth / 2'));
		assert.ok(measure.includes('diffColumnWidth(maxChars, chWidth, scroll.clientWidth / 2, 1600)'));
		assert.ok(measure.includes('writeVirtualStyle()'));
		assert.ok(html.includes('new ResizeObserver'), 'a pane resize recomputes the width');
		assert.ok(functionSource(html, 'setSpacers').includes('writeVirtualStyle()'), 'spacers and width share one sheet write');
		assert.ok(!functionSource(html, 'setSwapped').includes('scrollLeft'), 'swapping keeps the horizontal offset');
	});

	test('the embedded document is the model the host built', () => {
		const expected = documentOf();
		// The payload is JSON: absent optional fields are dropped, which is exactly
		// what the page parses back.
		const roundTrip = JSON.parse(JSON.stringify(expected)) as DiffDocument;
		const actual = embedded();
		assert.deepStrictEqual(actual.left, roundTrip.left);
		assert.deepStrictEqual(actual.right, roundTrip.right);
		assert.deepStrictEqual(actual.labels, roundTrip.labels);
		assert.deepStrictEqual(actual.summary, roundTrip.summary);
		assert.strictEqual(actual.rows.length, roundTrip.rows.length);
		assert.deepStrictEqual(actual.rows[0], roundTrip.rows[0]);
	});

	test('the page serializes the diff helpers and the shared row primitives', () => {
		const html = page();
		for (const name of [
			'diffVisibility',
			'flattenDiffRows',
			'nextChangeIndex',
			'diffFieldLabel',
			'diffFieldRank',
			'diffCellFields',
			'diffRowChars',
			'diffColumnWidth',
			'calcVisibleRange',
			'calcTotalHeight',
			'calcRowOffset',
			'appendHighlighted',
			'conditionTokens',
			'appendConditionTokens',
			'valueSpan',
			'metaSpan',
		]) {
			assert.ok(html.includes(`function ${name}(`), `${name} is inlined`);
		}
		assert.ok(html.includes('class RowSearchEngine'), 'the chunked search engine is inlined');
		// The page's own copy is the tested copy.
		const rows = documentOf().rows;
		const visible = evaluateFunction<typeof import('../../diff/diffModel').diffVisibility>(html, 'diffVisibility');
		assert.ok(visible(rows, false).every(Boolean), 'Show all sees every row');
		const flatten = evaluateFunction<typeof flattenDiffRows>(html, 'flattenDiffRows');
		assert.strictEqual(flatten(rows).length, flattenDiffRows(rows).length);
	});

	test('only the viewport window is built, with spacer heights from the virtual math', () => {
		const html = page();
		const render = functionSource(html, 'renderWindow');
		assert.ok(
			render.includes('for (let at = start; at < end; at++)'),
			'the renderer iterates the window, not the row store'
		);
		assert.ok(render.includes('calcVisibleRange(state)'), 'the window comes from the shared math');
		assert.ok(render.includes('calcTotalHeight(state)'), 'the total comes from the shared math');
		assert.ok(
			render.includes('setSpacers(calcRowOffset(start, state), Math.max(0, total - calcRowOffset(end, state)))'),
			'the top/bottom spacers keep the full scroll height'
		);
		assert.ok(html.includes('const bufferRows = 10'), 'the overscan is a small constant');
		assert.ok(html.includes("'#diff-top{height:'"), 'the nonce-carrying sheet carries the spacer heights');
	});

	test('AC12: a large document is windowed by the shared virtual math', () => {
		const rows = Array.from({ length: 1200 }, (_, at) => ({
			key: `row-${at}`,
			parentKey: at === 0 ? null : 'row-0',
			level: at === 0 ? 1 : 2,
			posinset: at === 0 ? 1 : at,
			setsize: at === 0 ? 1 : 1199,
			kind: 'parameter' as const,
			hasChildren: false,
			subtreeSize: 0,
			status: 'changed' as const,
			changes: [],
			haystack: `row ${at}`,
			left: {
				kind: 'parameter' as const,
				label: `row-${at}`,
				definitionRef: '/P/row',
				meta: [],
				range: { start: 0, end: 1 },
			},
		}));
		const html = page({
			left: { name: 'left.arxml', path: '/work/left.arxml' },
			right: { name: 'right.arxml', path: '/work/right.arxml' },
			labels: ['left.arxml', 'right.arxml'],
			rows,
			summary: { changed: rows.length, added: 0, removed: 0, unchanged: 0 },
		});
		const names = [
			'rowCountOf',
			'heightAt',
			'cumulativeHeights',
			'rowAtOffset',
			'calcTotalHeight',
			'calcRowOffset',
			'calcVisibleRange',
		];
		const source = names.map((name) => functionSource(html, name)).join('\n');
		const math = new Function(
			`let cache; ${source}\nreturn { calcVisibleRange, calcTotalHeight, calcRowOffset };`
		)() as {
			calcVisibleRange(state: unknown): [number, number];
			calcTotalHeight(state: unknown): number;
			calcRowOffset(index: number, state: unknown): number;
		};
		const state = {
			rowCount: rows.length,
			rowHeight: () => 20,
			containerHeight: 600,
			scrollTop: 20 * 600,
			bufferSize: 10,
			heightVersion: 1,
		};
		const [start, end] = math.calcVisibleRange(state);
		assert.ok(start > 0 && end <= rows.length, 'a middle scroll has a real window');
		assert.ok(end - start <= 200, `the window is bounded (${end - start} rows)`);
		assert.strictEqual(math.calcTotalHeight(state), rows.length * 20);
		assert.strictEqual(math.calcRowOffset(rows.length, state), rows.length * 20);
	});

	test('every colour is a --vscode-* variable, with no colour literal', () => {
		const style = styleOf(page());
		assert.ok(style.includes('var(--vscode-'), 'theme variables are used');
		assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(style), 'no hex colour literal remains');
		assert.ok(style.includes('--vscode-diffEditor-insertedLineBackground'), 'added rows use the diff theme colour');
		assert.ok(style.includes('--vscode-diffEditor-removedLineBackground'), 'removed rows use the diff theme colour');
		assert.ok(style.includes('.diff-row[data-status="changed"] > .diff-cell'), 'a changed row marks both sides');
		assert.ok(
			style.includes('.diff-row[data-status="added"] > .diff-cell[data-side="right"]'),
			'an added row marks the right side'
		);
		assert.ok(
			style.includes('.diff-row[data-status="removed"] > .diff-cell[data-side="left"]'),
			'a removed row marks the left side'
		);
		assert.ok(style.includes('@media (forced-colors: active)'), 'high contrast uses outlines');
		assert.ok(style.includes('.syscond-name'), 'condition names keep their token colour in the diff');
		assert.ok(
			/\.condition\[data-state="false"\]\s*\{[^}]*border-color/.test(style),
			'a false diff condition is marked by its edge'
		);
	});

	test('the editor page and the diff page serialize byte-identical row primitives', () => {
		const editor = renderHtml(scanEcucValues(fixtureText('editor/render.arxml')), { nonce: 'test-nonce' });
		const diff = page();
		for (const name of ['appendHighlighted', 'valueSpan', 'metaSpan']) {
			assert.strictEqual(
				functionSource(editor, name),
				functionSource(diff, name),
				`${name} has one definition for both pages`
			);
		}
	});

	test('the diff page reports an unreadable payload and a boot error instead of failing silently', () => {
		const html = page();
		const reported: string[] = [];
		const globals = globalThis as unknown as {
			document?: unknown;
			window?: {
				diffReportError?: (text: string) => void;
				addEventListener?: (type: string, listener: (event: unknown) => void) => void;
			};
		};
		const savedDocument = globals.document;
		const savedWindow = globals.window;
		globals.document = { getElementById: () => ({ textContent: '{ not json' }) };
		globals.window = { diffReportError: (text: string) => reported.push(text) };
		try {
			const read = evaluateFunction<() => DiffDocument>(html, 'readInitialDocument');
			const fallback = read();
			assert.deepStrictEqual(fallback.rows, []);
			assert.strictEqual(fallback.summary.changed, 0);
		} finally {
			globals.document = savedDocument;
			globals.window = savedWindow;
		}
		assert.strictEqual(reported.length, 1);
		assert.ok(reported[0].includes('could not be read'), reported[0]);

		const listeners: Record<string, (event: unknown) => void> = {};
		const notice = { textContent: '', dataset: {} as Record<string, string> };
		globals.document = { getElementById: () => notice };
		globals.window = {
			addEventListener: (type: string, listener: (event: unknown) => void) => {
				listeners[type] = listener;
			},
		};
		try {
			evaluateFunction<() => void>(html, 'diffInstallErrorSurface')();
			assert.ok(listeners.error && listeners.unhandledrejection);
			listeners.error({ message: 'boom', lineno: 7 });
			assert.ok(notice.textContent.includes('boom'));
			assert.ok(notice.textContent.includes('Webview Developer Tools'));
			assert.strictEqual(notice.dataset.kind, 'warn');
		} finally {
			globals.document = savedDocument;
			globals.window = savedWindow;
		}
	});

	test('the page boots from the embedded document and announces ready', () => {
		const html = page();
		assert.ok(html.includes("setDocument(readInitialDocument());"), 'the initial document is installed');
		assert.ok(html.includes("vscode.postMessage({ type: 'ready' });"), 'a live page tells the host it booted');
		assert.ok(html.indexOf('diffInstallErrorSurface();') < html.indexOf("acquireVsCodeApi()"), 'errors are surfaced first');
	});

	test('refreshes keep the view mode, swap, collapse, selection, search and scroll state', () => {
		const html = page();
		const message = /window\.addEventListener\('message'[\s\S]*?\n\}\);/.exec(html);
		assert.ok(message, 'the message handler exists');
		assert.ok(message![0].includes("message.type === 'diff'"), 'the host refresh type is handled');
		assert.ok(message![0].includes('captureAnchor()'), 'the scroll anchor is captured before the update');
		assert.ok(message![0].includes('restoreAnchor(anchor)'), 'and restored afterwards');
		assert.ok(html.includes('setDocument(message.document)'), 'the row store is replaced, not markup');
		assert.ok(message![0].includes("message.type === 'error'"), 'a refresh error keeps the last document');
		assert.ok(!html.includes('innerHTML'), 'a refresh never swaps HTML');
		const set = functionSource(html, 'setDocument');
		assert.ok(set.includes('refreshVisibility()'), 'the active view is recomputed');
		assert.ok(set.includes('renderHeaders()'), 'the swap state is preserved');
		assert.ok(set.includes('startSearch(searchQuery, currentMatchKey(), true)'), 'an active search restarts');
		assert.ok(!set.includes('showChangesOnly ='), 'a refresh never resets the view mode');
		assert.ok(!set.includes('swapped ='), 'a refresh never resets the swap');
	});
});
