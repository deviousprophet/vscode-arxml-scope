/**
 * The Document-only interaction model, collapse, hierarchy, details entry, key map and
 * guardrails, asserted on the row data and the page's own serialized functions.
 *
 * `@vscode/test-electron` exposes no webview DOM, so a click cannot be performed here.
 * The inlined script is located by name and then compiled/driven where self-contained;
 * the DOM pass remains the browser harness's evidence.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { RowPayload, collapsedIdsFor, moveTarget, pruneCollapsed, renderHtml, toggleCollapsed } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';
import { repoRoot } from './editorTestUtils';
import { functionSource } from './scriptTestUtils';

const FIXTURE = 'editor/render.arxml';

function page(): string {
	return renderHtml(scanEcucValues(fixtureText(FIXTURE)), { nonce: 'test-nonce' });
}

function payload(source = page()): RowPayload {
	const match = /<script type="application\/json" id="ecuc-rows"[^>]*>([\s\S]*?)<\/script>/.exec(source);
	assert.ok(match, 'the page embeds the row document');
	return JSON.parse(match[1]) as RowPayload;
}

function styleOf(html: string): string {
	const match = /<style[^>]*>([\s\S]*?)<\/style>/.exec(html);
	assert.ok(match, 'one inlined style block');
	return match[1];
}

suite('editor Document interactions', () => {
	test('bracket guides fade at rest and activate on container hover', () => {
		const script = page();
		const hover = functionSource(script, 'onTreeHover');
		assert.ok(hover.includes('hoveredGuideId'), 'the hovered container is tracked');
		assert.ok(hover.includes('applyGuideHover()'), 'the rendered guides are updated');
		assert.ok(hover.includes('.brace[data-row-id]'), 'hovering a brace keeps its container guide active');
		assert.ok(functionSource(script, 'applyGuideHover').includes("classList.toggle("));
		const style = styleOf(script);
		assert.ok(/\.guide\s*\{[^}]*opacity:\s*0\.28/.test(style));
		assert.ok(/\.guide\.guide-active\s*\{[^}]*opacity:\s*0\.85/.test(style));
	});

	test('a plain click selects and never reveals; the deliberate gestures reveal', () => {
		const script = page();
		const click = functionSource(script, 'onRowClick');
		assert.ok(click.includes('selectItem(item)'));
		assert.ok(!click.includes('revealItem'), 'a click never reveals');
		const doubleClick = functionSource(script, 'onRowDoubleClick');
		assert.ok(doubleClick.includes('revealItem(item)'));
		const keys = functionSource(script, 'onTreeKeydown');
		assert.ok(keys.includes('event.ctrlKey || event.altKey'), 'Ctrl/Alt+Enter is the deliberate key');
		assert.ok(keys.includes('revealItem(id)'));
		const space = keys.slice(keys.indexOf("event.key === ' '"), keys.indexOf('event.key.length === 1'));
		assert.ok(space.includes('selectItem(item)'), 'Space selects');
		assert.ok(!space.includes('revealItem') && !space.includes('flipCollapsed'), 'and does nothing else');
	});

	test('a toggle is built only where the row has children, with no glyph or inline hint', () => {
		const script = page();
		const build = functionSource(script, 'buildNodeRow');
		assert.ok(build.includes('if (row.hasChildren)'), 'a leaf has no fold control');
		assert.ok(build.includes('rowElement.appendChild(twistySpan())'), 'the fold control sits in the fixed gutter');
		assert.ok(!build.includes('spacerSpan'), 'leaves do not need a spacer in the gutter');
		assert.ok(!build.includes('innerHTML'), 'model text is never inserted as markup');
		assert.ok(!build.includes('.style'), 'depth is attribute CSS, not an inline style');
		assert.ok(!build.includes('glyphSpan'), 'the Tree glyph is removed');
		assert.ok(!build.includes('F2'), 'no inline F2 hint in the row builder');
		assert.ok(!functionSource(script, 'valueSpan').includes('F2'), 'no F2 hover hint on the value');
		assert.ok(functionSource(script, 'twistySpan').includes("className = 'twisty'"));
		assert.ok(functionSource(script, 'twistyIcon').includes('createElementNS'), 'inline SVG, not an asset');
		assert.ok(
			functionSource(script, 'twistyIcon').includes('M6.14601 3.14579'),
			'the exact Codicon chevron-right outline'
		);

		const rows = payload().rows;
		assert.strictEqual(rows.find((row) => row.label === 'ContA')!.hasChildren, true);
		assert.strictEqual(rows.find((row) => row.label === 'IniValue')!.hasChildren, false);

		const style = styleOf(script);
		assert.ok(/\.node\[aria-expanded="true"\] > \.row > \.twisty svg\s*\{[^}]*transform:\s*rotate\(90deg\)/.test(style));
		assert.ok(!/content:\s*"  F2"/.test(style), 'no F2 pseudo hint');
	});

	test('reference tooltips show the target without display punctuation', () => {
		const value = functionSource(page(), 'valueSpan');
		assert.ok(value.includes("'Follow to the target: ' + (row.shownValue || '')"));
		assert.ok(value.includes("'Target not found in this file: ' + (row.shownValue || '')"));
		assert.ok(!value.includes(': = '), 'the display = is not part of the tooltip');
	});

	test('aria-expanded follows the displayed list, including a filter force-expand', () => {
		const script = page();
		const build = functionSource(script, 'buildNodeRow');
		assert.ok(build.includes("setAttribute('aria-expanded', expandedIds.has(row.id) ? 'true' : 'false')"));
		assert.ok(build.includes('if (row.hasChildren)'), 'a leaf never gains aria-expanded');

		const rebuild = functionSource(script, 'rebuildDisplay');
		assert.ok(rebuild.includes('expandedIds = new Set()'), 'the displayed expansion set is rebuilt');
		assert.ok(rebuild.includes('row.hasChildren && descendantShown'), 'expansion follows the displayed list');
		assert.ok(
			!rebuild.includes('!collapsed.has(row.id)'),
			'a filtered container cannot claim expansion when it has no displayed child'
		);
		assert.ok(rebuild.includes('filterActive: active'), 'the active filter is passed to the flatten pass');
		assert.ok(rebuild.includes('visible: active && filterResult'), 'and its visibility drives the display list');
		assert.ok(rebuild.includes("tree.dataset.empty"), 'and the empty state follows the display list');

		const flip = functionSource(script, 'flipCollapsed');
		assert.ok(flip.includes('toggleCollapsed('), 'the toggle flips membership');
		assert.ok(flip.includes('rebuildDisplay()'), 'and rebuilds the flat display list');
		assert.ok(flip.includes('renderWindow(true)'));
		assert.ok(!flip.includes('setSelection'), 'without moving the selection');
		assert.ok(!flip.includes('.style'), 'visibility is not a DOM hide');
	});

	test('toggling flips membership and never collapses a leaf', () => {
		assert.deepStrictEqual(toggleCollapsed([], 'a', true), ['a']);
		assert.deepStrictEqual(toggleCollapsed(['a', 'b'], 'a', true), ['b']);
		assert.deepStrictEqual(toggleCollapsed([], 'leaf', false), []);
		assert.deepStrictEqual(collapsedIdsFor([{ id: 'a', hasChildren: true }, { id: 'b', hasChildren: false }]), ['a']);
	});

	test('pruning drops the ids that are gone and leaves the rest alone', () => {
		assert.deepStrictEqual(pruneCollapsed(['a', 'gone', 'b'], ['a', 'b']), ['a', 'b']);
		assert.deepStrictEqual(pruneCollapsed([], ['a']), []);
	});

	test('the page re-renders from rows without a DOM swap', () => {
		const script = page();
		assert.ok(script.includes('setRows(message.rows, message.selectedId)'));
		assert.ok(!script.includes('main.innerHTML'), 'there is no DOM-swap render path');
		assert.ok(!script.includes('reRenderTree'), 'the old tree swap is gone');
		assert.ok(script.includes('treeWindow.textContent'), 'only the virtual window is replaced');
		const handler = script.slice(script.lastIndexOf("if (message.type === 'model')"));
		assert.ok(handler.includes('updateInspector()'), 'a re-scan refreshes the details panel');
	});

	test('expand-all and collapse-all touch nothing but the collapsed set', () => {
		const script = page();
		assert.ok(script.includes('collapsed = new Set(collapsedIdsFor(rows))'));
		assert.ok(script.includes('collapsed = new Set()'));
		const collapse = functionSource(script, 'collapseAll');
		const expand = functionSource(script, 'expandAll');
		assert.ok(!collapse.includes('setSelection') && !expand.includes('setSelection'));
		assert.ok(!collapse.includes('selectedId') && !expand.includes('selectedId'));
	});

	test('the Document row carries level, position, group size and selection state', () => {
		const script = page();
		const build = functionSource(script, 'buildNodeRow');
		for (const attribute of ['role', 'aria-level', 'aria-posinset', 'aria-setsize', 'aria-selected']) {
			assert.ok(build.includes(`setAttribute('${attribute}'`), attribute);
		}
		assert.ok(build.includes("node.tabIndex = -1"), 'roving tabindex');
		assert.ok(build.includes('node.dataset.subtree'), 'the selected-subtree marker');
		assert.ok(!build.includes('dataset.line'), 'no source line');
		assert.ok(functionSource(script, 'applyRoving').includes('element.tabIndex = renderedId === id ? 0 : -1'));
	});

	test('Home, End, PageUp and PageDown move focus as expected', () => {
		assert.strictEqual(moveTarget('Home', 5, 20, 8), 0);
		assert.strictEqual(moveTarget('End', 5, 20, 8), 19);
		assert.strictEqual(moveTarget('PageUp', 10, 20, 8), 2);
		assert.strictEqual(moveTarget('PageDown', 10, 20, 8), 18);
		assert.strictEqual(moveTarget('ArrowDown', 10, 20, 8), 11);
		assert.strictEqual(moveTarget('ArrowUp', 10, 20, 8), 9);
	});

	test('the key handler wires movement, expansion, F2/Enter editing and type-ahead', () => {
		const keys = functionSource(page(), 'onTreeKeydown');
		for (const key of ['ArrowLeft', 'ArrowRight', 'Enter', 'F2']) {
			assert.ok(keys.includes(`'${key}'`), key);
		}
		assert.ok(keys.includes('event.preventDefault()'), 'the default scroll is suppressed');
		assert.ok(keys.includes('moveTarget('), 'arrow/Home/End/Page movement goes through the shared map');
		assert.ok(keys.includes('focusRow(nextId)'), 'the target is rendered before it is focused');
		assert.ok(keys.includes('beginDetailsEdit(id)'), 'F2/Enter open the details editor');
		assert.ok(keys.includes('typeAheadJump('), 'type-ahead is wired');
	});

	test('the details editor owns Enter, Escape and Tab', () => {
		const html = page();
		const details = functionSource(html, 'detailsValueInput');
		assert.ok(details.includes("event.key === 'Enter'") && details.includes('commitDetailsEdit()'));
		assert.ok(details.includes("event.key === 'Escape'") && details.includes('cancelDetailsEdit()'));
		assert.ok(details.includes("event.key === 'Tab'"), 'Tab moves to the adjacent parameter');
		assert.ok(details.includes("dir: event.shiftKey ? 'prev' : 'next'"));
		assert.ok(details.includes('stopPropagation()'), 'the tree does not also act on the key');
		const commit = functionSource(html, 'commitDetailsEdit');
		assert.ok(commit.includes("type: 'edit'"), 'the existing write message');
		assert.ok(commit.includes('edit.input.value'));
	});

	test('a refused write keeps the typed text and marks the details input invalid', () => {
		const html = page();
		const error = functionSource(html, 'setDetailsError');
		assert.ok(html.includes('details-value-error'));
		assert.ok(error.includes("'aria-invalid', 'true'"));
		assert.ok(error.includes("'/* ' + reason + ' */'"));
		assert.ok(html.includes('detailsEdit.input.focus()'), 'the refused input keeps focus');
		assert.ok(!html.includes('.value-edit'), 'no inline document editor');
	});

	test('a refused or pending edit keeps its draft across an inspector rebuild', () => {
		const details = functionSource(page(), 'detailsValueInput');
		assert.ok(
			details.includes('detailsEdit && detailsEdit.rowId === row.id ? detailsEdit : null'),
			'the same row keeps its draft even while a write is pending'
		);
		assert.ok(details.includes('pending: previous ? previous.pending : false'), 'pending survives the rebuild');
	});

	test('no runtime dependency was added and nothing is fetched', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
			dependencies?: Record<string, string>;
		};
		assert.strictEqual(pkg.dependencies, undefined, 'no runtime dependency');
		const html = page();
		assert.ok(!/<script[^>]+src=/.test(html), 'no external script');
		assert.ok(!/fetch\(|XMLHttpRequest|new Worker|serviceWorker/.test(html), 'no remote/worker path');
	});

	test('the stylesheet keeps only the documented colour literals', () => {
		const style = styleOf(page());
		const hexes = [...style.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
		assert.deepStrictEqual(
			hexes.sort(),
			['#4EC9B0', '#80808040', '#DCDCAA'].sort(),
			'the fixed container accent and guide/reference fallbacks are the only literals'
		);
		assert.ok(!/style="--/.test(page()), 'no CSP-blocked inline custom property');
	});

	test('the presentation adds no write path', () => {
		const html = page();
		assert.ok(!html.includes('WorkspaceEdit'));
		assert.ok(!html.includes('writeFile'));
		assert.ok(!html.includes('.value-edit'));
		assert.ok(html.includes("type: 'edit'"), 'the existing host edit message remains');
	});
});