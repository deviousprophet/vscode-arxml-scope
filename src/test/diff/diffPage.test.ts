/**
 * The diff page shell and its serialized helpers (task design §3; ac14).
 *
 * The test host has no webview DOM, so the page is asserted at the level of the
 * rendered shell plus the page's own functions, extracted with `scriptTestUtils`.
 * The real webview pass is the Extension Development Host.
 */
import * as assert from 'assert';

import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { DiffDocument, buildDiffDocument, flattenDiffRows } from '../../diff/diffModel';
import { encodeDiffDocument, renderDiffHtml } from '../../diff/diffPage';
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

suite('semantic diff page (design §3)', () => {
	test('the shell has one text filter, a changes-only toggle, summary, navigation and detail strip', () => {
		const html = page();
		assert.strictEqual((html.match(/id="diff-filter"/g) || []).length, 1);
		assert.ok(/id="diff-filter"[^>]*type="text"/.test(html), 'the filter is type="text", so it has no native clear X');
		assert.strictEqual((html.match(/type="search"/g) || []).length, 0);
		assert.strictEqual((html.match(/id="diff-filter-clear"/g) || []).length, 1, 'exactly one clear control');
		assert.ok(/id="diff-changes"[^>]*type="checkbox"/.test(html), 'the changes-only toggle exists');
		assert.ok(/id="diff-summary"[^>]*role="status"/.test(html), 'the summary is a live status');
		assert.strictEqual((html.match(/id="diff-prev"/g) || []).length, 1);
		assert.strictEqual((html.match(/id="diff-next"/g) || []).length, 1);
		assert.strictEqual((html.match(/id="diff-collapse"/g) || []).length, 1);
		assert.strictEqual((html.match(/id="diff-expand"/g) || []).length, 1);
		assert.ok(/id="diff-detail"[^>]*role="region"/.test(html), 'the detail strip is a region');
		assert.ok(html.includes('id="diff-empty"') && html.includes('id="diff-empty-text"'), 'the empty state exists');
		assert.ok(html.includes("'No differences'"), 'a pair with no changes has an explicit empty message');
		assert.ok(html.includes("summary.changed + ' changed · '"), 'the summary counts changed/added/removed');
		assert.ok(html.includes('class="pane-header" title="/work/left.arxml">left.arxml'), 'the left pane header');
		assert.ok(html.includes('class="pane-header" title="/work/right.arxml">right.arxml'), 'the right pane header');
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

	test('the embedded document is the model the host built', () => {
		const expected = documentOf();
		// The payload is JSON: absent optional fields are dropped, which is exactly
		// what the page parses back.
		const roundTrip = JSON.parse(JSON.stringify(expected)) as DiffDocument;
		const actual = embedded();
		assert.deepStrictEqual(actual.left, roundTrip.left);
		assert.deepStrictEqual(actual.right, roundTrip.right);
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
			'calcVisibleRange',
			'calcTotalHeight',
			'calcRowOffset',
			'appendHighlighted',
			'valueSpan',
			'metaSpan',
		]) {
			assert.ok(html.includes(`function ${name}(`), `${name} is inlined`);
		}
		// The page's own copy is the tested copy.
		const rows = documentOf().rows;
		const visible = evaluateFunction<typeof import('../../diff/diffModel').diffVisibility>(html, 'diffVisibility');
		assert.strictEqual(visible(rows, '', false).visibleCount, rows.length);
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

	test('refreshes keep the filter, changes-only, collapse, selection and scroll state', () => {
		const html = page();
		const message = /window\.addEventListener\('message'[\s\S]*?\n\}\);/.exec(html);
		assert.ok(message, 'the message handler exists');
		assert.ok(message![0].includes("message.type === 'diff'"), 'the host refresh type is handled');
		assert.ok(message![0].includes('captureAnchor()'), 'the scroll anchor is captured before the update');
		assert.ok(message![0].includes('restoreAnchor(anchor)'), 'and restored afterwards');
		assert.ok(html.includes('setDocument(message.document)'), 'the row store is replaced, not markup');
		assert.ok(message![0].includes("message.type === 'error'"), 'a refresh error keeps the last document');
		assert.ok(!html.includes('innerHTML'), 'a refresh never swaps HTML');
	});
});
