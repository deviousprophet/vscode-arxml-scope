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

import { scanEcucValues } from '../../../core/ecuc/scanner';
import { RowPayload, renderHtml } from '../../../webview/editorViewer';
import {
	collapsedIdsFor,
	moveTarget,
	pruneCollapsed,
	toggleCollapsed,
} from '../../../webview/components/documentTree/documentTreeState';
import { detailsInputAllowed } from '../../../webview/components/detailsEditor/detailsEditor';
import { fixtureText } from '../../core/modelTestUtils';
import { repoRoot } from '../../extension/testUtils';
import { functionSource } from '../scriptTestUtils';

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
		const build = functionSource(script, 'buildDocumentNodeRow');
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
		assert.ok(value.includes("'Target: ' + (row.shownValue || '')"));
		assert.ok(!value.includes('Follow to the target'), 'the Document no longer advertises follow');
		assert.ok(!value.includes("'Target not found in this file: '"), 'no follow-specific unresolved wording');
		assert.ok(!value.includes(': = '), 'the display = is not part of the tooltip');
		assert.ok(!value.includes('data-follow'), 'the Document value is not a link');
	});

	test('the details panel owns the reference jump action', () => {
		const html = page();
		const update = functionSource(html, 'updateInspector');
		assert.ok(update.includes("'Jump to target'"));
		assert.ok(update.includes("row.kind === 'reference' && row.followable === true"));
		const value = functionSource(html, 'valueSpan');
		assert.ok(!value.includes('target'), 'no target class on the Document value');
		assert.ok(!functionSource(html, 'onRowClick').includes('followItem'), 'a Document click does not follow');
		assert.ok(!functionSource(html, 'onTreeKeydown').includes('followItem'), 'Enter does not follow');
	});

	test('details controls follow the parameter type', () => {
		const html = page();
		const details = functionSource(html, 'detailsValueInput');
		assert.ok(details.includes("boolean ? 'select' : 'input'"), 'Boolean gets a select');
		assert.ok(details.includes("for (const option of ['true', 'false'])"), 'true/false options');
		assert.ok(details.includes('input.inputMode'), 'numeric inputs set an input mode');
		assert.ok(details.includes('detailsInputAllowed(type, event.data)'), 'character checks use the type');
		assert.ok(functionSource(html, 'focusDetailsInput').includes("typeof input.select === 'function'"));

		assert.strictEqual(detailsInputAllowed('Integer', '1'), true);
		assert.strictEqual(detailsInputAllowed('Integer', '0x3F'), true);
		assert.strictEqual(detailsInputAllowed('Integer', '-7'), true);
		assert.strictEqual(detailsInputAllowed('Integer', '1.5'), false);
		assert.strictEqual(detailsInputAllowed('Integer', '1g'), false);
		assert.strictEqual(detailsInputAllowed('Float', '1.5e-3'), true);
		assert.strictEqual(detailsInputAllowed('Float', '0x3F'), false);
		assert.strictEqual(detailsInputAllowed('Float', 'true'), false);
		assert.strictEqual(detailsInputAllowed('String', 'anything at all'), true);
	});

	test('the details panel renders the type and value formats', () => {
		const update = functionSource(page(), 'updateInspector');
		assert.ok(update.includes("inspectorRow('Type', data.type)"));
		assert.ok(update.includes('for (const format of data.formats)'));
		assert.ok(update.includes('inspectorRow(format.label, format.value)'));
	});

	test('aria-expanded follows the displayed list', () => {
		const script = page();
		const build = functionSource(script, 'buildDocumentNodeRow');
		assert.ok(build.includes("setAttribute('aria-expanded', context.expandedIds.has(row.id) ? 'true' : 'false')"));
		assert.ok(build.includes('if (row.hasChildren)'), 'a leaf never gains aria-expanded');

		const rebuild = functionSource(script, 'rebuildDisplay');
		assert.ok(rebuild.includes('expandedIds = new Set()'), 'the displayed expansion set is rebuilt');
		assert.ok(rebuild.includes('flat.expanded'), 'expansion comes from the display list');
		assert.ok(!rebuild.includes('descendantShown'), 'the page does not re-derive expansion from neighbours');
		assert.ok(rebuild.includes('flattenRows(rows, {'), 'the display list is built from rows and collapse state');
		assert.ok(!rebuild.includes('visible:'), 'the display list has no query visibility input');
		assert.ok(script.includes('this.setEmpty(rowCount === 0)'), 'and the empty state follows the display list');

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
		assert.ok(script.includes('setRows(message.rows, message.selectedId, message.header)'));
		assert.ok(!script.includes('main.innerHTML'), 'there is no DOM-swap render path');
		assert.ok(!script.includes('reRenderTree'), 'the old tree swap is gone');
		assert.ok(script.includes('this.windowEl.textContent'), 'only the component window is replaced');
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
		const build = functionSource(script, 'buildDocumentNodeRow');
		for (const attribute of ['role', 'aria-level', 'aria-posinset', 'aria-setsize', 'aria-selected']) {
			assert.ok(build.includes(`setAttribute('${attribute}'`), attribute);
		}
		assert.ok(build.includes("node.tabIndex = -1"), 'roving tabindex');
		assert.ok(build.includes('context.subtreeIds.has(row.id)'), 'the selected-subtree marker');
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
		const details = functionSource(html, 'detailsRegisterKeydown');
		assert.ok(details.includes("event.key === 'Enter'") && details.includes('commitDetailsEdit(edit.field)'));
		assert.ok(details.includes("event.key === 'Escape'") && details.includes('cancelDetailsEdit(edit.field)'));
		assert.ok(details.includes("event.key === 'Tab'"), 'Tab moves to the adjacent parameter');
		assert.ok(details.includes("event.shiftKey ? 'prev' : 'next'"), 'Shift reverses the move');
		assert.ok(details.includes('stopPropagation()'), 'the tree does not also act on the key');
		assert.ok(
			details.includes('detailsFieldSibling(edit.field, dir)'),
			'a container Tab targets the other field'
		);
		assert.ok(
			details.includes('!document.getElementById(detailsFieldId(sibling))'),
			'a Tab with no field to move to does not trap focus in the panel'
		);
		assert.ok(
			functionSource(html, 'detailsValueInput').includes('detailsRegisterKeydown(input, edit)'),
			'the value input uses the shared key handler'
		);
		assert.ok(
			functionSource(html, 'detailsFieldInput').includes('detailsRegisterKeydown(input, edit)'),
			'the container fields use the same key handler'
		);
		const commit = functionSource(html, 'commitDetailsEdit');
		assert.ok(commit.includes("type: 'edit'"), 'the existing write message');
		assert.ok(commit.includes('edit.input.value'));
	});

	test('R1/R2: a container exposes editable short name and definition controls', () => {
		const html = page();
		const fields = functionSource(html, 'detailsContainerFields');
		assert.ok(fields.includes("'shortName', 'Short name'"), 'the short name control');
		assert.ok(fields.includes("'definitionRef', 'Definition'"), 'the definition control');

		const field = functionSource(html, 'detailsFieldInput');
		assert.ok(field.includes('detailsFieldId(field)'), 'the id comes from the field');
		assert.ok(field.includes("setAttribute('data-field', field)"), 'the field travels with the control');
		assert.ok(field.includes("input.setAttribute('aria-label'"), 'the control has an accessible name');

		const ids = functionSource(html, 'detailsFieldId');
		assert.ok(ids.includes("return 'details-short-name'"));
		assert.ok(ids.includes("return 'details-definition-ref'"));
		assert.ok(ids.includes("return 'details-value'"), 'the parameter id is unchanged');

		const commit = functionSource(html, 'commitDetailsEdit');
		assert.ok(commit.includes('field: edit.field'), 'a container commit names its field');
		assert.ok(
			commit.includes("if (edit.field === 'value')"),
			'a parameter commit keeps the old message without a field'
		);

		const focus = functionSource(html, 'focusDetailsField');
		assert.ok(focus.includes('detailsFieldId(field)'));
		const update = functionSource(html, 'updateInspector');
		assert.ok(update.includes('detailsContainerFields(row, data)'), 'containers get the controls');
		assert.ok(
			update.includes("row.kind === 'container'"),
			'and the read-only rows are kept for every other kind'
		);
		assert.ok(!update.includes("detailsFieldInput(row, 'shortName'"), 'the container facts are not shown twice');

		const begin = functionSource(html, 'beginDetailsEdit');
		assert.ok(begin.includes('field || detailsFirstField(row)'), 'the default field follows the row kind');
		assert.ok(functionSource(html, 'detailsFirstField').includes("return 'shortName'"));
		// Tab between the two container fields is a separate pending action from the
		// parameter-to-parameter move.
		assert.ok(html.includes('pendingFieldFocus = { rowId: edit.rowId, field: edit.field'));
		assert.ok(html.includes('beginFieldDetailsEdit(focus)'));
		assert.ok(html.includes('detailsEdits = {}'), 'a re-scan clears every field draft');
	});

	test('a refused write keeps the typed text and marks the details input invalid', () => {
		const html = page();
		const error = functionSource(html, 'setDetailsError');
		assert.ok(html.includes('details-value-error'));
		assert.ok(error.includes("'aria-invalid', 'true'"));
		assert.ok(error.includes("'/* ' + reason + ' */'"));
		assert.ok(html.includes('edit.input.focus()'), 'the refused input keeps focus');
		assert.ok(!html.includes('.value-edit'), 'no inline document editor');
	});

	test('a refused or pending edit keeps its draft across an inspector rebuild', () => {
		const details = functionSource(page(), 'detailsValueInput');
		assert.ok(
			details.includes("detailsStoredEdit(row, 'value')"),
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