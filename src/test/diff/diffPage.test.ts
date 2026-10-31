/**
 * The diff page shell and its serialized helpers (task design §3; ac14).
 * The test host has no webview DOM, so the page is asserted at the level of the
 * rendered shell plus the page's own functions, extracted with `scriptTestUtils`.
 * The real webview pass is the Extension Development Host.
 */
import * as assert from 'assert';

import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { DiffCell, DiffDocument, DiffRow, buildDiffDocument, flattenDiffDocument } from '../../diff/diffModel';
import { diffContentWidth, diffRowChars, encodeDiffDocument, renderDiffHtml } from '../../diff/diffPage';
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

function widthCell(overrides: Partial<DiffCell> = {}): DiffCell {
	return {
		kind: 'parameter',
		label: 'Foo',
		definitionRef: '/P/Foo',
		meta: [],
		range: { start: 0, end: 1 },
		...overrides,
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
			controls.indexOf('class="toolbar-left"') < controls.indexOf('class="toolbar-center"') &&
				controls.indexOf('class="toolbar-center"') < controls.indexOf('class="toolbar-right"'),
			'left controls, centred Swap, right Search'
		);
		const leftGroup = controls.slice(controls.indexOf('class="toolbar-left"'), controls.indexOf('class="toolbar-center"'));
		assert.ok(
			leftGroup.indexOf('id="diff-view-all"') < leftGroup.indexOf('id="diff-view-diff"') &&
				leftGroup.indexOf('id="diff-view-diff"') < leftGroup.indexOf('id="diff-prev"') &&
				leftGroup.indexOf('id="diff-prev"') < leftGroup.indexOf('id="diff-next"'),
			'Show all, Show diff only, Prev diff, Next diff on the left'
		);
		assert.ok(
			controls.indexOf('id="diff-swap"') > controls.indexOf('class="toolbar-center"'),
			'Swap sits in the centre track'
		);
		assert.ok(
			controls.indexOf('class="search-box"') > controls.indexOf('class="toolbar-right"'),
			'Search sits in the right track'
		);
		assert.ok(
			html.includes('id="diff-hscroll-left"') &&
				html.includes('id="diff-hscroll-right"') &&
				(html.match(/class="hscroll"/g) || []).length === 2,
			'one horizontal scrollbar per pane'
		);
		assert.ok(!html.includes('id="diff-detail"'), 'the bottom details strip is gone');
		assert.ok(!html.includes('detail-table') && !html.includes('detail-columns'), 'no strip table survives');
		assert.ok(
			!html.includes('diffFieldLabel') && !html.includes('diffCellFields') && !html.includes('diffFieldRank'),
			'no field-strip helpers survive'
		);
		assert.strictEqual((html.match(/let diffX =/g) || []).length, 1, 'one shared horizontal offset');
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
			functionSource(html, 'onKeyDown').includes('event.target === document.body'),
			'arrows still navigate after focus leaves the tree'
		);
		assert.ok(
			functionSource(html, 'onKeyDown').includes("vscode.postMessage({ type: 'reveal'"),
			'Enter still reveals the selected row'
		);
		const row = functionSource(html, 'buildDiffRow');
		assert.ok(row.includes('displayLeft(row)') && row.includes('displayRight(row)'));
		assert.ok(row.includes("element.dataset.status = status"), 'the displayed status is rendered');
		assert.ok(row.includes("element.dataset.searchCurrent = 'true'"));
		const swap = functionSource(html, 'setSwapped');
		assert.ok(swap.includes('renderHeaders()') && swap.includes('renderWindow(true)'));
		assert.ok(swap.includes('diffX = 0') && swap.includes('syncBars()'), 'swap resets both horizontal offsets');
		assert.ok(!swap.includes('scrollTop'), 'swapping never resets the single vertical scroll container');
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
		assert.ok(html.includes('rowElement.dataset.level = String(row.level)'), 'depth is carried as data');
		assert.ok(/\.diff-cell > \.node > \.row\[data-level="3"\]/.test(html), 'indentation comes from generated attribute CSS');
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
		assert.strictEqual(diffRowChars(container), 3 + 4 + 1 + 10 + 10, 'Document padding plus one indent step');
		const moduleRow = widthRow({
			level: 1,
			kind: 'module',
			left: widthCell({ kind: 'module', label: 'M', meta: [] }),
		});
		assert.strictEqual(diffRowChars(moduleRow), 3 + 1 + 7, 'the rendered "module " prefix is counted');
		assert.strictEqual(
			diffRowChars(widthRow({ left: widthCell({ label: 'P', shownValue: undefined, meta: [] }) })),
			3 + 1 + 3,
			'the "= " separator renders even without a value'
		);
		assert.strictEqual(diffRowChars(widthRow({ left: undefined, right: undefined })), 0);
	});

	test('the horizontal range ends at the longest rendered line', () => {
		assert.strictEqual(diffContentWidth(100, 8), 834, 'ceil(chars * chWidth) plus the gutter and slack');
		assert.strictEqual(diffContentWidth(0, 8), 34, 'an empty diff still has the gutter and slack');
		assert.strictEqual(diffContentWidth(5000, 8), 40034, 'no cap: the range must reach the end of the longest line');
	});

	test('the shared offset clamps to the pane-limited content and sizes the proxy exactly', () => {
		const factory = new Function(
			'scroll',
			'hscroll',
			'virtualStyle',
			`
			let diffContent = 0;
			let diffX = 0;
			let spacerTop = 0;
			let spacerBottom = 0;
			let virtualStyleText = '';
			const hscrollLeft = hscroll;
			const hscrollRight = hscroll;
			const hscrolls = [hscroll, hscroll];
			${functionSource(page(), 'paneWidth')}
			${functionSource(page(), 'maxDiffX')}
			${functionSource(page(), 'writeVirtualStyle')}
			${functionSource(page(), 'applyDiffX')}
			return {
				setContent: function (value) { diffContent = value; },
				max: maxDiffX,
				x: function () { return diffX; },
				apply: applyDiffX,
				render: writeVirtualStyle,
				style: function () { return virtualStyle.textContent; }
			};
		`
		) as (
			scroll: { clientWidth: number },
			hscroll: { clientWidth: number },
			virtualStyle: { textContent: string }
		) => {
			setContent(value: number): void;
			max(): number;
			x(): number;
			apply(next: number): void;
			render(): void;
			style(): string;
		};
		const horizontal = factory({ clientWidth: 900 }, { clientWidth: 1000 }, { textContent: '' });
		horizontal.setContent(1450);
		assert.strictEqual(horizontal.max(), 1000, 'content minus one 450px pane');
		horizontal.render();
		assert.ok(
			horizontal.style().includes('.hscroll-inner{width:2000px}'),
			'proxy width cancels its own client width, not the scroller width'
		);
		horizontal.apply(1500);
		assert.strictEqual(horizontal.x(), 1000, 'the offset clamps to the pane limit');
		assert.ok(horizontal.style().includes('#diff-scroll{--diff-x:-1000px}'));
		horizontal.apply(-20);
		assert.strictEqual(horizontal.x(), 0, 'the offset never goes negative');
		horizontal.setContent(400);
		assert.strictEqual(horizontal.max(), 0, 'content that fits has no range');
	});

	test('diff rows use the Document gutter, indent and meta typography', () => {
		const html = page();
		const style = styleOf(html);
		assert.ok(/--fold-gutter:\s*26px/.test(style), 'the Document fold gutter');
		assert.ok(/--doc-pad:\s*3ch/.test(style) && /--indent:\s*4ch/.test(style));
		assert.ok(/--content-pad:\s*calc\(var\(--fold-gutter\) \+ var\(--doc-pad\)\)/.test(style));
		assert.ok(
			/\.diff-cell\s*\{[^}]*padding:\s*0;/.test(style),
			'the pane edge is the clip boundary, not cell padding'
		);
		assert.ok(
			/\.row\s*\{[^}]*padding:\s*0 0 0 var\(--content-pad\)/.test(style),
			'rows start at the Document content pad'
		);
		assert.ok(
			/\.diff-cell > \.node > \.row\[data-level="2"\][\s\S]*?padding-left:\s*calc\(var\(--content-pad\) \+ var\(--indent\) \* 1\)/.test(
				style
			),
			'the level rule uses the Document formula'
		);
		assert.ok(
			/\.twisty\s*\{[^}]*position:\s*absolute[^}]*left:\s*2px[^}]*width:\s*16px/.test(style),
			'the twisty sits in the gutter, not in the flex row'
		);
		assert.ok(/\.label\s*\{[^}]*font-weight:\s*600/.test(style), 'Document label weight');
		assert.ok(
			/\.row-meta\s*\{[^}]*flex-wrap:\s*nowrap[^}]*gap:\s*1ch[^}]*white-space:\s*pre/.test(style),
			'Document meta keeps one monospace line'
		);
		assert.ok(
			/@media \(max-width: 720px\)[\s\S]*?--doc-pad:\s*2\.5ch[\s\S]*?--indent:\s*3ch/.test(style),
			'the Document narrow-width values carry over'
		);
	});

	test('both panes stay 50/50 and one shared offset moves their content', () => {
		const html = page();
		const style = styleOf(html);
		assert.ok(
			/\.pane-headers\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/.test(style),
			'headers are half the viewport each'
		);
		assert.ok(
			/\.diff-row, \.probe\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/.test(style),
			'rows are half the viewport each'
		);
		assert.ok(!/--diff-col/.test(style), 'no column-widening variable');
		assert.strictEqual((style.match(/overflow-x:\s*auto/g) || []).length, 1, 'one horizontal scroll surface');
		assert.ok(
			/\.hscroll\s*\{[^}]*overflow-x:\s*auto[^}]*overflow-y:\s*hidden/.test(style),
			'the proxy bar scrolls sideways only'
		);
		assert.ok(
			/\.diff-cell > \.node > \.row,[\s\S]*?\.diff-cell > \.comment > \.row\s*\{[^}]*transform:\s*translateX\(var\(--diff-x, 0px\)\)/.test(
				style
			),
			'both panes read the same offset'
		);
		assert.ok(html.includes('id="diff-ch-probe"'), 'one font probe feeds the width model');
		assert.strictEqual((html.match(/id="diff-ch-probe"/g) || []).length, 1);
		assert.ok(/\.toolbar\s*\{[^}]*height:\s*26px/.test(style), 'the diff toolbar stays one 26px row');

		const measure = functionSource(html, 'measureDiffWidth');
		const maxX = functionSource(html, 'maxDiffX');
		const pane = functionSource(html, 'paneWidth');
		assert.ok(measure.includes('diffRowChars(row)') && measure.includes('diffContentWidth(maxChars, chWidth)'));
		assert.ok(pane.includes('scroll.clientWidth / 2'), 'the pane is half the vertical scroller width');
		assert.ok(maxX.includes('diffContent - paneWidth()'), 'the limit is one pane width short of the content');
		assert.ok(
			functionSource(html, 'writeVirtualStyle').includes('bar.clientWidth - paneWidth()'),
			'the proxy maximum cancels the proxy width, not the scroller width'
		);
		assert.ok(measure.includes('maxDiffX()') && measure.includes('bar.hidden'), 'the bars appear only on overflow');
		assert.ok(html.includes("scroll.addEventListener('wheel'"), 'horizontal wheel over a pane drives the offset');
		assert.ok(html.includes('applyDiffX(diffX + horizontal)'));
		assert.ok(html.includes('bar.scrollLeft = diffX'));
		assert.ok(html.includes('new ResizeObserver'), 'a pane resize recomputes the width');
		assert.ok(
			functionSource(html, 'setSwapped').includes('diffX = 0') &&
				functionSource(html, 'setSwapped').includes('syncBars()'),
			'swapping resets both horizontal offsets'
		);
	});

	test('pane headers render their own schema and package lines', () => {
		const document = documentOf();
		const html = page({
			...document,
			leftHeader: { schema: '00048', packages: ['PkgA'] },
			rightHeader: { schema: '00048', packages: ['PkgB', 'PkgC'] }
		});
		assert.ok(html.includes('id="diff-left-header"'), 'the left header exists');
		assert.ok(html.includes('<span class="keyword">schema</span> <span class="number">00048</span>'));
		assert.ok(html.includes('<span class="keyword">package</span> PkgA'));
		assert.ok(html.includes('<span class="keyword">package</span> PkgB'));
		assert.ok(html.includes('<span class="keyword">package</span> PkgC'));
		assert.strictEqual(
			(html.match(/<div class="package">&nbsp;<\/div>/g) || []).length,
			1,
			'the shorter header is padded so both panes start their rows at the same y'
		);
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
			'flattenDiffDocument',
			'nextChangeIndex',
			'diffRowChars',
			'diffContentWidth',
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
		const flatten = evaluateFunction<typeof flattenDiffDocument>(html, 'flattenDiffDocument');
		assert.strictEqual(flatten(rows).length, flattenDiffDocument(rows).length);
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
			leftHeader: { packages: [] },
			rightHeader: { packages: [] },
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

	test('every colour is a --vscode-* variable, with no stray colour literal', () => {
		const style = styleOf(page());
		assert.ok(style.includes('var(--vscode-'), 'theme variables are used');
		const literals = Array.from(new Set(style.match(/#[0-9a-fA-F]{3,8}\b/g) || [])).sort();
		assert.deepStrictEqual(literals, ['#80808040', '#DCDCAA'], 'only the documented Document fallbacks remain');
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
