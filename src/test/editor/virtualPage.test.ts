/**
 * Task design §4, §5 and §8 — the page's own row/window/flatten/focus code.
 *
 * The test host has no webview DOM, so the page script is the artifact: the
 * functions it serializes are extracted from the rendered page and driven with
 * real row data. That is enough to pin the window range, collapse flattening, the
 * offscreen inspector and the focus/state rules; the DOM pass is the browser
 * harness's job.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { FlatNodeRow, TreeRow, ancestorIds, flattenRows, matchRanges } from '../../editor/treeQuery';
import {
	RowPayload,
	encodeRowDocument,
	guidesFor,
	inspectorFields,
	reconcileRowState,
	renderHtml,
	resolveFocusId,
	subtreeRowIds,
} from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';
import { evaluateFunction, functionSource } from './scriptTestUtils';

const FIXTURE = 'editor/render.arxml';

function page(): string {
	return renderHtml(scanEcucValues(fixtureText(FIXTURE)), { nonce: 'test-nonce' });
}

/** The escaped row payload, parsed exactly as the page parses it. */
function payload(html = page()): RowPayload {
	const match = /<script type="application\/json" id="ecuc-rows"[^>]*>([\s\S]*?)<\/script>/.exec(html);
	assert.ok(match, 'the page embeds the row document');
	return JSON.parse(match[1]) as RowPayload;
}

/** The page's own serialized virtual math, compiled with its private helpers. */
function pageVirtualMath(html: string): {
	calcVisibleRange(state: {
		rowCount: number;
		rowHeight: (index: number) => number;
		containerHeight: number;
		scrollTop: number;
		bufferSize: number;
		heightVersion?: number;
	}): [number, number];
	calcTotalHeight(state: unknown): number;
	calcRowOffset(index: number, state: unknown): number;
} {
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
	return new Function(
		`let cache; ${source}\nreturn { calcVisibleRange, calcTotalHeight, calcRowOffset };`
	)() as never;
}

function syntheticRows(count = 12): TreeRow[] {
	return Array.from({ length: count }, (_, at) => ({
		id: 'row-' + at,
		parentId: at === 0 ? null : 'row-' + (at - 1),
		level: at + 1,
		subtreeSize: count - at - 1,
		hasChildren: at < count - 1,
		haystack: 'label' + at + ' value' + at,
	}));
}

suite('virtual page (design §4, §5, §8)', () => {
	test('design §5: the page renders only the viewport window plus a bounded overscan', () => {
		const html = page();
		const math = pageVirtualMath(html);
		const rowCount = 12001;
		const state = {
			rowCount,
			rowHeight: () => 20,
			containerHeight: 900,
			scrollTop: 20 * 6000,
			bufferSize: 10,
			heightVersion: 1,
		};
		const [start, end] = math.calcVisibleRange(state);
		assert.ok(start > 0 && end <= rowCount, 'a middle scroll has a real window');
		assert.ok(end - start <= 200, `the window is bounded (${end - start} rows)`);
		assert.strictEqual(math.calcTotalHeight(state), rowCount * 20);
		assert.strictEqual(math.calcRowOffset(0, state), 0);
		assert.strictEqual(math.calcRowOffset(rowCount, state), rowCount * 20);
		assert.ok(
			html.includes('for (let at = start; at < end; at++)'),
			'the component iterates the window, not the row store'
		);
		assert.ok(
			html.includes('this.setSpacers(top, Math.max(0, total - calcRowOffset(end, state)))'),
			'the top/bottom spacers keep the full scroll height'
		);
		assert.ok(html.includes('calcTotalHeight(state)'), 'the spacer total comes from the virtual math');
		assert.ok(html.includes('this.bufferSize = 10'), 'the overscan is a small constant');
		assert.ok(html.includes('getRowsScrollTop()'), 'the component scrollTop excludes its own top padding');
		assert.ok(!html.includes('treeWindowTop'), 'no separate rows-offset measurement remains');
	});

	test('design §4: collapse skips a contiguous subtree and Document adds brace rows', () => {
		const html = page();
		const flatten = evaluateFunction<typeof flattenRows>(html, 'flattenRows');
		const rows = syntheticRows(12);
		const tree = flatten(rows);
		const collapsed = flatten(rows, { collapsed: new Set([rows[0].id]) });
		assert.deepStrictEqual(collapsed.map((row) => row.type), ['node'], 'a collapsed root hides its subtree');
		const reopened = flatten(rows, { braces: true });
		assert.ok(reopened.some((row) => row.type === 'brace-open'), 'Document has brace rows');
		assert.ok(reopened.some((row) => row.type === 'brace-close'));
		assert.ok(
			flatten(rows, { collapsed: new Set([rows[0].id]), braces: true }).every((row) => row.type !== 'brace-open'),
			'a collapsed node gets no brace pair'
		);
		assert.ok(tree.length > collapsed.length);
	});

	test('design §4: annotation comment rows join the window but never the selectable ids', () => {
		const html = page();
		const flatten = evaluateFunction<typeof flattenRows>(html, 'flattenRows');
		const rows = syntheticRows(3).map((row) =>
			row.id === 'row-1' ? { ...row, comments: ['[Note] above'] } : row
		);
		const list = flatten(rows);
		assert.deepStrictEqual(
			list.map((row) => row.type),
			['node', 'comment', 'node', 'node'],
			'the comment sits directly above its node'
		);
		const rebuild = functionSource(html, 'rebuildDisplay');
		assert.ok(rebuild.includes("if (flat.type === 'node')"), 'only node rows enter focus and selection state');
		assert.ok(rebuild.includes('visibleNodeIds.push(row.id)'));
		assert.ok(!rebuild.includes("flat.type === 'comment'"), 'comments are no tree items');
	});

	test('design §8: the inspector reads an offscreen row from the row map', () => {
		const html = page();
		const rows = payload(html).rows;
		const parameter = rows.find((row) => row.label === 'IniValue');
		assert.ok(parameter, 'the fixture has IniValue');
		const fields = inspectorFields(parameter);
		assert.strictEqual(fields.kind, 'parameter');
		assert.strictEqual(fields.definitionRef, '/PkgA/PkgB/ModDefs/ModX/ContA/IniValue');
		assert.strictEqual(fields.value, '63');
		assert.strictEqual(fields.type, 'Integer');
		assert.deepStrictEqual(fields.formats, [
			{ label: 'Decimal', value: '63' },
			{ label: 'Hexadecimal', value: '0x3F' },
			{ label: 'Binary', value: '0b00111111' },
		]);
		assert.ok(!('source' in fields), 'the details Source block is removed');
		// The page's copy is the same function; updateInspector looks the row up by id
		// and never queries the rendered tree.
		const inline = evaluateFunction<typeof inspectorFields>(html, 'inspectorFields');
		assert.deepStrictEqual(inline(parameter), fields);
		const update = functionSource(html, 'updateInspector');
		assert.ok(update.includes('rowById.get(selectedId)'), 'the selected row comes from the map');
		assert.ok(!update.includes('querySelector'), 'the inspector does not read the rendered DOM');
		assert.ok(!update.includes('innerHTML'), 'model text is never inserted as markup');
	});

	test('design §5/§8: focus is restored by id, or the nearest rendered row is roving', () => {
		const html = page();
		const inline = evaluateFunction<typeof resolveFocusId>(html, 'resolveFocusId');
		for (const [previous, rendered, preferred, expected] of [
			['a', ['a', 'b'], 'b', 'a'],
			['gone', ['a', 'b'], 'b', 'b'],
			['gone', ['a', 'b'], undefined, 'a'],
			[undefined, ['a', 'b'], 'b', 'b'],
			[undefined, [], 'b', undefined],
		] as Array<[string | undefined, string[], string | undefined, string | undefined]>) {
			assert.strictEqual(inline(previous, rendered, preferred), expected);
			assert.strictEqual(resolveFocusId(previous, rendered, preferred), expected);
		}
		const render = functionSource(html, 'renderWindow');
		assert.ok(render.includes('resolveFocusId('), 'a window update re-decides the roving row');
		assert.ok(render.includes('renderedById.get(previousFocus)'), 'and restores focus when the row remains');
		assert.ok(render.includes('element.focus({ preventScroll: true })'));
	});

	test('design §4: subtree ids and bracket guides cover only the selected container', () => {
		const rows = [
			{ id: 'root', subtreeSize: 3 },
			{ id: 'a', subtreeSize: 1 },
			{ id: 'b', subtreeSize: 0 },
			{ id: 'sibling', subtreeSize: 0 },
		];
		assert.deepStrictEqual(subtreeRowIds('root', rows), ['root', 'a', 'b', 'sibling']);
		assert.deepStrictEqual(subtreeRowIds('a', rows), ['a', 'b']);
		assert.deepStrictEqual(subtreeRowIds('b', rows), ['b']);
		assert.deepStrictEqual(subtreeRowIds('missing', rows), []);
		assert.deepStrictEqual(subtreeRowIds(undefined, rows), []);

		const display = [
			{ type: 'node' as const, rowIndex: 0, depth: 0, level: 1, expanded: true },
			{ type: 'brace-open' as const, rowIndex: 0, level: 1 },
			{ type: 'node' as const, rowIndex: 1, depth: 1, level: 2, expanded: true },
			{ type: 'brace-open' as const, rowIndex: 1, level: 2 },
			{ type: 'node' as const, rowIndex: 2, depth: 2, level: 3, expanded: false },
			{ type: 'brace-close' as const, rowIndex: 1, level: 2 },
			{ type: 'brace-close' as const, rowIndex: 0, level: 1 },
		];
		assert.deepStrictEqual(
			guidesFor(display, [{ id: 'root' }, { id: 'a' }, { id: 'b' }]),
			[
				[],
				[],
				[{ level: 1, id: 'root' }],
				[{ level: 1, id: 'root' }],
				[{ level: 1, id: 'root' }, { level: 2, id: 'a' }],
				[{ level: 1, id: 'root' }],
				[],
			]
		);
		const inlineGuides = evaluateFunction<typeof guidesFor>(page(), 'guidesFor');
		assert.deepStrictEqual(inlineGuides(display, [{ id: 'root' }, { id: 'a' }, { id: 'b' }]), guidesFor(display, [{ id: 'root' }, { id: 'a' }, { id: 'b' }]));
		const inlineSubtree = evaluateFunction<typeof subtreeRowIds>(page(), 'subtreeRowIds');
		assert.deepStrictEqual(inlineSubtree('root', rows), subtreeRowIds('root', rows));
		const build = functionSource(page(), 'documentRowOptions');
		assert.ok(build.includes('guides: guideLevels[displayIndex] || []'), 'every node row carries its open guides');
		const shared = functionSource(page(), 'buildDocumentNodeRow');
		assert.ok(shared.includes('appendDocumentGuides(rowElement, context.guides)'), 'the shared builder paints the guides');
		assert.ok(shared.includes('context.subtreeIds.has(row.id)'), 'the selected container marks its descendants');
		const rebuild = functionSource(page(), 'rebuildDisplay');
		assert.ok(rebuild.includes('guideLevels = guidesFor(displayRows, rows)'));
		const setRows = functionSource(page(), 'setRows');
		assert.ok(setRows.includes('subtreeIds = new Set(subtreeRowIds(selectedId, rows))'));
	});

	test('design §5/§8: a host select refreshes the window and the initial focus can expand', () => {
		const html = page();
		const select = html.slice(html.indexOf("message.type === 'select'"));
		assert.ok(
			select.indexOf('renderWindow(true)') !== -1 &&
				select.indexOf('renderWindow(true)') < select.indexOf('focusRow(message.nodeId)'),
			'a host select refreshes the spacers before it scrolls to the selected row'
		);
		const prepare = functionSource(html, 'prepareFocus');
		assert.ok(prepare.includes('expandAncestors(selectedId)'), 'an initial selection can expand its ancestors');
		assert.ok(prepare.includes('displayIndexById.has(selectedId)'), 'and is only focused once displayed');
		const inspector = functionSource(html, 'updateInspector');
		assert.ok(inspector.includes('detailsValueInput(row, data)'), 'the details editor owns the value field');
		assert.ok(!inspector.includes("'Source'"), 'the Source block is gone');
		assert.ok(!inspector.includes('Copy path') && !inspector.includes('Copy value'), 'copy actions are gone');
	});

	test('design §8: a re-scan preserves selection and collapse where possible', () => {
		const html = page();
		const inline = new Function(
			`${functionSource(html, 'pruneCollapsed')}\n${functionSource(html, 'reconcileRowState')}\nreturn reconcileRowState;`
		)() as typeof reconcileRowState;
		const state = { selectedId: 'b', collapsed: ['a', 'gone'] };
		const next = [{ id: 'a' }, { id: 'b' }];
		const preserved = reconcileRowState(state, next);
		assert.deepStrictEqual(preserved, {
			selectedId: 'b',
			collapsed: ['a'],
		});
		assert.deepStrictEqual(inline(state, next), preserved);

		const dropped = reconcileRowState(state, [{ id: 'a' }, { id: 'c' }]);
		assert.strictEqual(dropped.selectedId, undefined, 'a selected row that is gone is dropped');
		const handler = html.slice(html.indexOf("if (message.type === 'model')"));
		assert.ok(handler.includes('setRows(message.rows, message.selectedId, message.header)'));
		assert.ok(handler.includes('const scrollTop = treeView ? treeView.getScrollTop() : 0'), 'a re-scan captures the scroll position');
		assert.ok(handler.includes('treeView.setScrollTop(scrollTop)'), 'and restores it where possible');
		assert.ok(!handler.includes('message.tree'), 'the re-scan carries rows, not full-tree HTML');
		assert.ok(!html.includes('main.innerHTML'), 'there is no DOM-swap render path');
		assert.ok(
			(html.match(/message\.type === 'model'/g) ?? []).length >= 2,
			'the details editor still sees the message type it clears on'
		);
	});

	test('design §6: a context meta keeps the space between the keyword and the path', () => {
		const html = page();
		const fakeDocument = {
			createElement: () => ({
				className: '',
				title: '',
				textContent: '',
				children: [] as unknown[],
				appendChild(child: unknown) {
					this.children.push(child);
				},
			}),
			createTextNode: (text: string) => ({ textContent: text }),
		};
		const metaSpan = new Function(
			'document',
			'highlightQuery',
			'matchRanges',
			`${functionSource(html, 'appendHighlighted')}
${functionSource(html, 'metaSpan')}
return metaSpan;`
		)(fakeDocument, '', matchRanges) as (row: unknown) => { children: unknown[] };
		const meta = metaSpan({ meta: [{ cls: 'context', text: 'context PkgA.PkgB', title: '' }] });
		const collect = (node: unknown): string => {
			const typed = node as { textContent?: string; children?: unknown[] };
			if (typed.children && typed.children.length > 0) {
				return typed.children.map(collect).join('');
			}
			return typed.textContent ?? '';
		};
		assert.strictEqual(collect(meta), 'context PkgA.PkgB');
	});

	test('design §3: the initial payload is escaped JSON, not row HTML', () => {
		const html = page();
		const rows = payload(html).rows;
		assert.ok(rows.length > 0);
		const module = rows.find((row) => row.kind === 'module');
		assert.ok(module);
		const escaped = encodeRowDocument({
			rows: [{ ...module, label: '</script><script>alert(1)</script>' }],
		});
		assert.ok(!escaped.includes('</script>'), 'model text cannot close the script element');
		assert.strictEqual(JSON.parse(escaped).rows[0].label, '</script><script>alert(1)</script>');
		assert.ok(!html.includes('data-node-id='), 'the initial page has no tree rows');
		assert.ok(html.includes('id="ecuc-rows"'));
	});

	test('design §4: the page consumes expansion instead of inferring it', () => {
		const html = page();
		const flatten = evaluateFunction<typeof flattenRows>(html, 'flattenRows');
		const rows = syntheticRows(12);
		const nodes = (list: ReturnType<typeof flattenRows>): FlatNodeRow[] =>
			list.filter((row): row is FlatNodeRow => row.type === 'node');

		assert.strictEqual(nodes(flatten(rows))[0].expanded, true, 'the display list reports expansion on the row');
		assert.strictEqual(
			nodes(flatten(rows, { collapsed: new Set([rows[0].id]) }))[0].expanded,
			false,
			'a collapsed row reports no expansion'
		);

		const rebuild = functionSource(html, 'rebuildDisplay');
		assert.ok(!rebuild.includes('next.type'), 'the page no longer reads the next display row');
		assert.ok(rebuild.includes('flat.expanded'), 'the page takes expansion from the flat row');

		const ancestors = evaluateFunction<typeof ancestorIds>(html, 'ancestorIds');
		assert.deepStrictEqual(ancestors(rows, 'row-4'), ['row-3', 'row-2', 'row-1', 'row-0'], 'nearest parent first');
	});

	test('design §4: expandAncestors expands exactly the ids ancestorIds reports', () => {
		const html = page();
		const rows = syntheticRows(6);
		const collapsed = new Set(['row-1', 'row-3']);
		const globals = globalThis as unknown as { rows?: unknown; collapsed?: unknown; ancestorIds?: unknown };
		const saved = { rows: globals.rows, collapsed: globals.collapsed, ancestorIds: globals.ancestorIds };
		globals.rows = rows;
		globals.collapsed = collapsed;
		globals.ancestorIds = evaluateFunction<typeof ancestorIds>(html, 'ancestorIds');
		try {
			const expandAncestors = evaluateFunction<(id: string) => boolean>(html, 'expandAncestors');
			assert.strictEqual(expandAncestors('row-4'), true, 'a collapsed ancestor is expanded');
			assert.deepStrictEqual(Array.from(collapsed), [], 'exactly the ancestors were removed');
			assert.strictEqual(expandAncestors('row-4'), false, 'a second reveal changes nothing');
		} finally {
			globals.rows = saved.rows;
			globals.collapsed = saved.collapsed;
			globals.ancestorIds = saved.ancestorIds;
		}
	});
});
