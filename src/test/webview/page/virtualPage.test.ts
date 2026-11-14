/**
 * The page's pure row/window/flatten/focus rules. The bundled page consumes these
 * modules directly; the DOM pass is covered by the editor page suite.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../../core/ecuc/scanner';
import { SORT_EXCEPTIONS } from '../../../core/ecuc/order';
import { buildRows } from '../../../core/ecuc/renderRows';
import { FlatNodeRow, TreeRow, ancestorIds, flattenRows, haystack, matchRanges } from '../../../webview/render/treeQuery';
import {
	guidesFor,
	reconcileRowState,
	resolveFocusId,
	subtreeRowIds,
} from '../../../webview/components/documentTree/documentTreeState';
import { inspectorFields } from '../../../webview/components/sidebar/detailsPanel/detailsPanel';
import { calcRowOffset, calcTotalHeight, calcVisibleRange } from '../../../webview/render/virtualScroll';
import { fixtureText } from '../../core/modelTestUtils';
import { installDom, loadModule, treeRows } from '../pageTestUtils';
import { documentHeader } from '../../../webviewProtocol';

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

/** A document with enough parameters that a late row starts outside the window. */
function parameterDocument(count: number): string {
	let parameters = '';
	for (let at = 0; at < count; at++) {
		const name = 'P' + String(at).padStart(4, '0');
		parameters += `<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/M/C/${name}</DEFINITION-REF><VALUE>${at}</VALUE></ECUC-NUMERICAL-PARAM-VALUE>`;
	}
	return `<?xml version="1.0" encoding="UTF-8"?>\n<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/M</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/C</DEFINITION-REF><PARAMETER-VALUES>${parameters}</PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
}

function renderedRow(document: any, id: string): any {
	return treeRows(document).find((row: any) => row.getAttribute('data-node-id') === id);
}

suite('virtual page (design §4, §5, §8)', () => {
	test('design §5: only the viewport window plus a bounded overscan is visible', () => {
		const rowCount = 12001;
		const state = {
			rowCount,
			rowHeight: () => 20,
			containerHeight: 900,
			scrollTop: 20 * 6000,
			bufferSize: 10,
			heightVersion: 1,
		};
		const [start, end] = calcVisibleRange(state);
		assert.ok(start > 0 && end <= rowCount, 'a middle scroll has a real window');
		assert.ok(end - start <= 200, `the window is bounded (${end - start} rows)`);
		assert.strictEqual(calcTotalHeight(state), rowCount * 20);
		assert.strictEqual(calcRowOffset(0, state), 0);
		assert.strictEqual(calcRowOffset(rowCount, state), rowCount * 20);
	});

	test('design §4: collapse skips a contiguous subtree and Document adds brace rows', () => {
		const rows = syntheticRows(12);
		const tree = flattenRows(rows);
		const collapsed = flattenRows(rows, { collapsed: new Set([rows[0].id]) });
		assert.deepStrictEqual(collapsed.map((row) => row.type), ['node'], 'a collapsed root hides its subtree');
		const reopened = flattenRows(rows, { braces: true });
		assert.ok(reopened.some((row) => row.type === 'brace-open'));
		assert.ok(reopened.some((row) => row.type === 'brace-close'));
		assert.ok(
			flattenRows(rows, { collapsed: new Set([rows[0].id]), braces: true }).every((row) => row.type !== 'brace-open'),
			'a collapsed node gets no brace pair'
		);
		assert.ok(tree.length > collapsed.length);
	});

	test('design §4: annotation comment rows join the window but never the selectable ids', () => {
		const rows = syntheticRows(3).map((row) =>
			row.id === 'row-1' ? { ...row, comments: ['[Note] above'] } : row
		);
		const list = flattenRows(rows);
		assert.deepStrictEqual(
			list.map((row) => row.type),
			['node', 'comment', 'node', 'node'],
			'the comment sits directly above its node'
		);
		const nodes = list.filter((row): row is FlatNodeRow => row.type === 'node');
		assert.deepStrictEqual(nodes.map((row) => row.rowIndex), [0, 1, 2]);
	});

	test('design §8: the inspector reads an offscreen row from the row map', () => {
		const model = scanEcucValues(fixtureText('editor/render.arxml'));
		const rows = buildRows(model, { sort: 'all', sortExcept: [] }).rows;
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
		assert.deepStrictEqual(documentHeader(model), { schema: '00048', packages: ['PkgA.PkgB'] });
	});

	test('design §5/§8: focus is restored by id, or the nearest rendered row is roving', () => {
		for (const [previous, rendered, preferred, expected] of [
			['a', ['a', 'b'], 'b', 'a'],
			['gone', ['a', 'b'], 'b', 'b'],
			['gone', ['a', 'b'], undefined, 'a'],
			[undefined, ['a', 'b'], 'b', 'b'],
			[undefined, [], 'b', undefined],
		] as Array<[string | undefined, string[], string | undefined, string | undefined]>) {
			assert.strictEqual(resolveFocusId(previous, rendered, preferred), expected);
		}
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
		assert.deepStrictEqual(guidesFor(display, [{ id: 'root' }, { id: 'a' }, { id: 'b' }]), [
			[],
			[],
			[{ level: 1, id: 'root' }],
			[{ level: 1, id: 'root' }],
			[{ level: 1, id: 'root' }, { level: 2, id: 'a' }],
			[{ level: 1, id: 'root' }],
			[],
		]);
	});

	test('design §8: a re-scan preserves selection and collapse where possible', () => {
		const state = { selectedId: 'b', collapsed: ['a', 'gone'] };
		const preserved = reconcileRowState(state, [{ id: 'a' }, { id: 'b' }]);
		assert.deepStrictEqual(preserved, { selectedId: 'b', collapsed: ['a'] });
		const dropped = reconcileRowState(state, [{ id: 'a' }, { id: 'c' }]);
		assert.strictEqual(dropped.selectedId, undefined, 'a selected row that is gone is dropped');
	});

	test('design §6: the shared meta keeps the space between the keyword and the path', () => {
		assert.strictEqual(haystack({ label: 'Title', meta: [{ text: 'context A.B' }] }), 'title context a.b');
		assert.deepStrictEqual(matchRanges('aba', 'a'), [
			{ start: 0, end: 1 },
			{ start: 2, end: 3 },
		]);
	});

	test('design §4: the display list reports expansion on the row itself', () => {
		const rows = syntheticRows(12);
		const nodes = (list: ReturnType<typeof flattenRows>): FlatNodeRow[] =>
			list.filter((row): row is FlatNodeRow => row.type === 'node');
		assert.strictEqual(nodes(flattenRows(rows))[0].expanded, true);
		assert.strictEqual(nodes(flattenRows(rows, { collapsed: new Set([rows[0].id]) }))[0].expanded, false);
		assert.deepStrictEqual(ancestorIds(rows, 'row-4'), ['row-3', 'row-2', 'row-1', 'row-0'], 'nearest parent first');
	});

	test('TREE-02 a documentPatch outside the rendered window updates the store without patching a hidden row', async () => {
		const rows = buildRows(scanEcucValues(parameterDocument(300)), {
			sort: 'all',
			sortExcept: SORT_EXCEPTIONS,
		}).rows;
		const at = 250;
		const target = rows[at];
		assert.strictEqual(target.kind, 'parameter', 'the patched index is a parameter row');

		const dom = installDom('editor');
		try {
			loadModule<typeof import('../../../webview/editorViewer')>('../../webview/editorViewer').mountEditor();
			dom.post({ type: 'document', document: { rows } });

			const before = treeRows(dom.document);
			assert.ok(before.length > 0 && before.length < rows.length, `the window is bounded (${before.length} rows)`);
			assert.strictEqual(renderedRow(dom.document, target.id), undefined, 'the target starts outside the window');
			const visibleHtml = before.map((row: any) => row.innerHTML).join('\n');

			dom.post({
				type: 'documentPatch',
				patch: {
					at,
					remove: 1,
					rows: [{ ...target, value: '424242', shownValue: '424242', haystack: `${target.haystack} 424242` }],
					structural: false,
				},
			});

			assert.strictEqual(renderedRow(dom.document, target.id), undefined, 'a hidden row gets no DOM patch');
			assert.strictEqual(treeRows(dom.document).length, before.length, 'the window size is unchanged');
			assert.strictEqual(
				treeRows(dom.document).map((row: any) => row.innerHTML).join('\n'),
				visibleHtml,
				'visible rows are untouched by a patch for a hidden row'
			);

			const scroller = dom.document.querySelector('#tree .virtual-scroll-vscroll') as HTMLElement;
			scroller.scrollTop = at * 20;
			scroller.dispatchEvent(new dom.window.Event('scroll'));
			await new Promise((resolve) => setTimeout(resolve, 20));

			const updated = renderedRow(dom.document, target.id);
			assert.ok(updated, 'scrolling to the patched index renders the row');
			assert.ok(
				(updated.querySelector('.value')?.textContent ?? '').includes('424242'),
				'the patched store value is what the window paints'
			);
		} finally {
			dom.restore();
		}
	});

	test('TREE-04 150k rows scroll to the end and back rebuild the window with no height drift', () => {
		const state = {
			rowCount: 150_000,
			rowHeight: () => 20,
			containerHeight: 600,
			scrollTop: 0,
			bufferSize: 10,
			heightVersion: 1,
		};
		const first = calcVisibleRange(state);
		const total = calcTotalHeight(state);
		assert.strictEqual(total, 3_000_000);
		assert.ok(first[1] < 100, `the first window is bounded (${first[1]} rows)`);

		const end = calcVisibleRange({ ...state, scrollTop: total - 600 });
		assert.ok(end[0] > 149_000, `the end window starts near the end (${end[0]})`);
		assert.strictEqual(end[1], 150_000, 'the end window includes the last row');

		const back = calcVisibleRange(state);
		assert.deepStrictEqual(back, first, 'scrolling back rebuilds the same window');
		assert.strictEqual(calcTotalHeight(state), total, 'the total height does not drift');
		assert.strictEqual(calcRowOffset(150_000, state), total, 'the last offset still equals the total height');
	});

	test('TREE-06 a zero-height viewport still renders at least one row', () => {
		const state = {
			rowCount: 500,
			rowHeight: () => 20,
			containerHeight: 0,
			scrollTop: 0,
			bufferSize: 0,
			heightVersion: 1,
		};
		assert.deepStrictEqual(calcVisibleRange(state), [0, 1], 'the top row stays renderable');
		assert.deepStrictEqual(calcVisibleRange({ ...state, scrollTop: 400 }), [20, 21], 'a mid-list target stays renderable');
		assert.deepStrictEqual(calcVisibleRange({ ...state, scrollTop: 9_999 }), [499, 500], 'the last row stays renderable');
	});
});
