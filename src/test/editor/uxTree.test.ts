/**
 * AC1, AC3–AC8 and AC10–AC12 — the interaction model, collapse, hierarchy, the widget's
 * affordance, the key map and the guardrails, asserted on the row data the page receives
 * and on the page's own serialized functions.
 *
 * `@vscode/test-electron` exposes no webview DOM, so a click cannot be performed here.
 * The inlined script is located by name and then **compiled and driven** where it is
 * self-contained; the DOM pass remains the browser harness's evidence.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { RowPayload, collapsedIdsFor, moveTarget, pruneCollapsed, renderHtml, toggleCollapsed } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';
import { repoRoot } from './editorTestUtils';
import { evaluateFunction, functionSource } from './scriptTestUtils';

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

suite('editor interaction, collapse and hierarchy (AC1, AC3–AC8, AC10–AC12)', () => {
	test('AC1: a plain click selects and never reveals', () => {
		const click = functionSource(page(), 'onRowClick');
		assert.ok(click.includes('selectItem(item)'), 'a click on the row selects it');
		assert.ok(!click.includes('revealItem'), 'and opens no text editor');
		assert.ok(click.includes('flipCollapsed'), 'the twisty toggles instead');
		assert.ok(click.includes('followItem'), 'the reference target follows instead');
		assert.ok(click.indexOf('flipCollapsed') < click.indexOf('selectItem(item)'));
		assert.ok(click.indexOf('followItem') < click.indexOf('selectItem(item)'));
		assert.ok(!click.includes('stopImmediatePropagation'), 'the tree does not steal an event the widget claimed');
	});

	test('AC1/AC2: the deliberate gestures are the double click and Ctrl/Alt+Enter', () => {
		const script = page();
		const double = functionSource(script, 'onRowDoubleClick');
		assert.ok(double.includes('revealItem(item)'), 'a double click reveals');
		assert.ok(double.includes('.twisty') && double.includes('[data-follow]'), 'a toggle or a follow is not also a reveal');

		const keys = functionSource(script, 'onTreeKeydown');
		assert.ok(keys.includes('event.ctrlKey || event.altKey'), 'Ctrl/Alt+Enter is the deliberate key');
		assert.ok(keys.includes('revealItem(id)'));

		const space = keys.slice(keys.indexOf("event.key === ' '"), keys.indexOf('event.key.length === 1'));
		assert.ok(space.includes('selectItem(item)'), 'Space selects');
		assert.ok(!space.includes('revealItem') && !space.includes('flipCollapsed'), 'and does nothing else');

		assert.ok(script.includes("vscode.postMessage({ type: 'select', nodeId: id })"));
	});

	test('AC3: a toggle is built only where the row has children', () => {
		const script = page();
		const build = functionSource(script, 'buildNodeRow');
		assert.ok(build.includes('row.hasChildren ? twistySpan() : spacerSpan()'), 'a leaf gets a spacer');
		assert.ok(!build.includes('innerHTML'), 'model text is never inserted as markup');
		assert.ok(!build.includes('.style'), 'depth is attribute CSS, not an inline style');
		assert.ok(functionSource(script, 'twistySpan').includes("className = 'twisty'"));
		assert.ok(functionSource(script, 'spacerSpan').includes("className = 'spacer'"));
		const svg = functionSource(script, 'svgIcon');
		assert.ok(svg.includes('createElementNS'), 'inline SVG, not an asset');
		assert.ok(svg.includes("setAttribute('class', 'g-' + kind)"), 'the kind class');

		const rows = payload().rows;
		assert.strictEqual(rows.find((row) => row.label === 'ContA')!.hasChildren, true);
		assert.strictEqual(rows.find((row) => row.label === 'IniValue')!.hasChildren, false);

		const style = styleOf(script);
		assert.ok(/\.node\[aria-expanded="true"\] > \.row > \.twisty svg\s*\{[^}]*transform:\s*rotate\(90deg\)/.test(style));
		assert.ok(/\.node\[aria-expanded="false"\] > \.row > \.twisty\s*\{[^}]*opacity:\s*1/.test(styleOf(script)));
	});

	test('AC3: aria-expanded follows the displayed list, including a filter force-expand', () => {
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

	test('AC3: toggling flips membership and never collapses a leaf', () => {
		assert.deepStrictEqual(toggleCollapsed([], 'a', true), ['a']);
		assert.deepStrictEqual(toggleCollapsed(['a', 'b'], 'a', true), ['b']);
		assert.deepStrictEqual(toggleCollapsed(['a'], 'a', false), ['a'], 'a leaf cannot be collapsed');
		assert.deepStrictEqual(toggleCollapsed([], 'a', false), []);
	});

	test('AC4: pruning drops the ids that are gone and leaves the rest alone', () => {
		assert.deepStrictEqual(pruneCollapsed(['a', 'b', 'c'], ['b', 'c', 'd']), ['b', 'c']);
		assert.deepStrictEqual(pruneCollapsed([], ['a']), []);
		assert.deepStrictEqual(pruneCollapsed(['a'], []), [], 'a removed node takes its id with it');
		assert.deepStrictEqual(pruneCollapsed(['a', 'b'], ['a', 'b']), ['a', 'b'], 'the others are untouched');

		const script = page();
		const inlined = evaluateFunction<typeof pruneCollapsed>(script, 'pruneCollapsed');
		assert.deepStrictEqual(inlined(['a', 'b', 'c'], ['b', 'c', 'd']), ['b', 'c']);
	});

	test('AC4: the page re-renders from rows, keeping #main as the scroll box without a DOM swap', () => {
		const script = page();
		assert.ok(script.includes('setRows(message.rows, message.digits, message.selectedId)'));
		assert.ok(!script.includes('main.innerHTML'), 'the full-tree DOM swap is gone');
		assert.ok(!script.includes('reRenderTree'), 'the old sequence is gone');
		assert.ok(script.includes("const main = document.getElementById('main')"));
		assert.ok(script.includes('const treeWindow = document.getElementById(\'tree-window\')'));
		assert.ok(script.includes('main.addEventListener(\'scroll\''), 'scroll updates the window');
		assert.ok(script.includes('requestAnimationFrame'), 'through one rAF frame');
		assert.ok(script.includes('renderWindow(false)'), 'a scroll within the buffer does not force a render');
		assert.ok(/bufferSize:\s*bufferRows/.test(script), 'the window keeps a small overscan');

		const style = styleOf(script);
		assert.ok(/#main\s*\{[^}]*overflow:\s*auto/.test(style), '#main scrolls');
		assert.ok(/body\s*\{[^}]*overflow:\s*hidden/.test(style), 'and the page does not scroll behind it');
		assert.ok(
			/#main\s*\{[^}]*overflow-anchor:\s*none/.test(style),
			'scroll anchoring cannot fight the virtual range'
		);

		const filterAt = script.indexOf('id="filter"');
		const mainAt = script.indexOf('id="main"');
		assert.ok(filterAt !== -1 && mainAt !== -1, 'both the filter box and the scroll region exist');
		assert.ok(filterAt < mainAt, 'the filter box is not inside the region a re-scan replaces');
	});

	test('AC5: expand-all and collapse-all touch nothing but the collapsed set', () => {
		const script = page();
		assert.ok(script.includes('id="expand-all"') && script.includes('id="collapse-all"'));
		assert.ok(script.includes("getElementById('collapse-all').addEventListener('click', collapseAll)"));
		assert.ok(script.includes("getElementById('expand-all').addEventListener('click', expandAll)"));

		const collapse = functionSource(script, 'collapseAll');
		assert.ok(collapse.includes('collapsedIdsFor(rows)'), 'collapse-all is every row that has children');
		assert.ok(collapse.includes('rebuildDisplay()'));
		assert.ok(!collapse.includes('setSelection') && !collapse.includes('selectedId'), 'the selection is intact');

		const expand = functionSource(script, 'expandAll');
		assert.ok(expand.includes('collapsed = new Set()'));
		assert.ok(!expand.includes('setSelection') && !expand.includes('selectedId'));

		assert.deepStrictEqual(
			collapsedIdsFor([
				{ id: 'a', hasChildren: true },
				{ id: 'b', hasChildren: false },
				{ id: 'c', hasChildren: true },
			]),
			['a', 'c'],
			'a leaf is never collapsed'
		);
		const inlined = evaluateFunction<typeof collapsedIdsFor>(script, 'collapsedIdsFor');
		assert.deepStrictEqual(inlined([{ id: 'a', hasChildren: true }, { id: 'b', hasChildren: false }]), ['a']);
	});

	test('AC6: each kind has its own class, marker shape and accent', () => {
		const script = page();
		const build = functionSource(script, 'buildNodeRow');
		assert.ok(build.includes("'row k-' + row.kind"), 'the kind class');
		const svg = functionSource(script, 'svgIcon');
		for (const kind of ['module', 'container', 'parameter', 'reference']) {
			assert.ok(svg.includes(`kind === '${kind}'`), kind);
		}
		assert.ok(svg.includes("createElementNS(svgNamespace, 'rect')"), 'square shapes');
		assert.ok(svg.includes("createElementNS(svgNamespace, 'circle')"), 'a dot for a parameter');
		assert.ok(svg.includes("setAttribute('d', 'M2.5 8h8M8 5l3 3-3 3')"), 'an arrow for a reference');

		const style = styleOf(script);
		assert.ok(/\.row\.k-module\s*\{[^}]*--vscode-symbolIcon-moduleForeground/.test(style));
		assert.ok(/\.row\.k-container\s*\{[^}]*--vscode-symbolIcon-namespaceForeground/.test(style));
		assert.ok(/\.row\.k-parameter\s*\{[^}]*var\(--vscode-symbolIcon-fieldForeground/.test(style));
		assert.ok(/\.row\.k-reference\s*\{[^}]*var\(--vscode-symbolIcon-referenceForeground/.test(style));
	});

	test('AC7: the indent guide falls back to a visible colour, never transparent', () => {
		const style = styleOf(page());
		const rule = /body\[data-view="document"\] \.row\s*\{([^}]*)\}/.exec(style);
		assert.ok(rule, 'the flat document row carries the guide');
		assert.ok(/repeating-linear-gradient/.test(rule![1]), 'a guide every indent step');
		assert.ok(
			rule![1].includes('var(--vscode-tree-indentGuidesStroke, var(--vscode-panel-border, #80808040))'),
			'the chain falls through to a colour when the theme defines neither variable'
		);
		assert.ok(!/transparent 0 100%/.test(rule![1]));
	});

	test('AC6: the row states come from the theme, including the unfocused selection', () => {
		const style = styleOf(page());
		assert.ok(/\.row:hover\s*\{[^}]*var\(--hover-bg\)/.test(style), 'a row has a hover state');
		assert.ok(
			/\.node\[data-selected="true"\]\s*>\s*\.row\s*\{[^}]*background-color:\s*var\(--sel-bg\)/.test(style),
			'an unfocused selection uses the quiet tint'
		);
		assert.ok(
			/\.node\[data-selected="true"\]\s*>\s*\.row\s*\{[^}]*box-shadow:\s*inset 2px 0 0 var\(--rail\)/.test(style),
			'an unfocused selection keeps a non-colour rail cue'
		);
		assert.ok(
			/#tree:focus-within\s+\.node\[data-selected="true"\]\s*>\s*\.row\s*\{[^}]*var\(--sel-bg-focus\)/.test(style),
			'a focused selection uses the focused tint'
		);
		assert.ok(/--sel-bg:\s*color-mix\([^;]*--vscode-list-inactiveSelectionBackground/.test(style));
		assert.ok(/--sel-bg-focus:\s*color-mix\([^;]*--vscode-list-activeSelectionBackground/.test(style));
		assert.ok(!style.includes('--ecuc-selection-fg'), 'selection never recolours syntax');
	});

	test('AC8: a value advertises that it is editable, by tooltip and by hover', () => {
		const script = page();
		const value = functionSource(script, 'valueSpan');
		assert.ok(value.includes("value.dataset.valueKind"), 'the value kind is data');
		assert.ok(value.includes("'Click to edit, or press F2: = '"), 'the tooltip');
		assert.ok(value.includes("text.className = 'value-text'"), 'the direct value text');
		const style = styleOf(script);
		assert.ok(/\.row\.k-parameter\s*>\s*\.value\s*\{[^}]*cursor:\s*text/.test(style), 'the caret');
		assert.ok(/\.row\.k-parameter:hover\s*>\s*\.value::after/.test(style), 'the hover affordance');
		assert.ok(style.includes('\\270E'), 'a pencil glyph, drawn by CSS rather than shipped as an asset');
		assert.ok(script.includes('F2'), 'the key');
		assert.ok(script.includes('input.value = item.dataset.value'), 'the editor starts from the rendered value');
	});

	test('AC8: a refused write keeps the typed text and marks the input invalid', () => {
		const script = page();
		const commit = functionSource(script, 'commitValueEdit');
		assert.ok(commit.includes('valueEdit.pending = true'), 'the widget waits for the host');
		assert.ok(!commit.includes('input.remove()'), 'committing does not close the editor');
		assert.ok(!commit.includes('input.value ='), 'and does not clear what was typed');

		const close = functionSource(script, 'closeValueEdit');
		assert.ok(close.includes('input.remove()'), 'only an explicit close drops the input');

		const refusal = script.slice(script.indexOf("message.kind === 'warn'"));
		assert.ok(refusal.includes("setAttribute('aria-invalid', 'true')"), 'a refusal marks the input invalid');
		assert.ok(refusal.includes('valueEdit.pending = false'), 'and lets the user fix it');
		assert.ok(/\.value-edit\[aria-invalid="true"\]/.test(styleOf(script)), 'and it is visible');

		const widgetClick = script.indexOf("document.addEventListener('click', (event) => {");
		const treeClick = script.indexOf("document.addEventListener('click', onRowClick)");
		const firstClick = script.indexOf("document.addEventListener('click', ");
		assert.ok(widgetClick !== -1 && treeClick !== -1);
		assert.strictEqual(widgetClick, firstClick, 'the widget registers the first document click listener');
		assert.ok(widgetClick < treeClick, 'the widget sees the click first');
		assert.ok(
			script.slice(widgetClick, treeClick).includes('stopImmediatePropagation()'),
			'and stops the tree from also acting on it'
		);
	});

	test('AC10: a treeitem carries its level, position, group size and selection state', () => {
		const script = page();
		const build = functionSource(script, 'buildNodeRow');
		for (const attribute of ['aria-level', 'aria-posinset', 'aria-setsize', 'aria-selected']) {
			assert.ok(build.includes(`setAttribute('${attribute}'`), attribute);
		}
		assert.ok(build.includes("setAttribute('role', 'treeitem')"));
		assert.ok(script.includes('role="tree"'), 'the container is a real tree');
		assert.ok(!script.includes('role="group"'), 'the flat tree deliberately drops group wrappers');

		const rows = payload().rows;
		const module = rows[0];
		assert.deepStrictEqual(
			{ pos: module.posinset, size: module.setsize },
			{ pos: 1, size: 1 },
			'one module, so the group of modules is a single item'
		);
		const contAChildren = rows.filter((row) => row.parentId === rows.find((row) => row.label === 'ContA')!.id);
		assert.deepStrictEqual(
			contAChildren.map((row) => [row.label, row.posinset, row.setsize]),
			[
				['Flag', 1, 6],
				['IniValue', 2, 6],
				['Title', 3, 6],
				['PeerIref', 4, 6],
				['PeerRef', 5, 6],
				['ContB', 6, 6],
			]
		);
	});

	test('AC10: Home, End, PageUp and PageDown move focus as expected', () => {
		assert.strictEqual(moveTarget('Home', 5, 10, 3), 0);
		assert.strictEqual(moveTarget('End', 5, 10, 3), 9);
		assert.strictEqual(moveTarget('PageDown', 1, 10, 3), 4, 'a screen down');
		assert.strictEqual(moveTarget('PageDown', 9, 10, 3), 9, 'clamped to the last item');
		assert.strictEqual(moveTarget('PageUp', 1, 10, 3), 0, 'clamped to the first item');
		assert.strictEqual(moveTarget('PageUp', 8, 10, 3), 5);
		assert.strictEqual(moveTarget('ArrowDown', 9, 10, 3), 9);
		assert.strictEqual(moveTarget('ArrowUp', 0, 10, 3), 0);
		assert.strictEqual(moveTarget('x', 0, 10, 3), undefined, 'a printable key is type-ahead, not a move');
		assert.strictEqual(moveTarget('Home', 0, 0, 3), undefined, 'an empty tree moves nowhere');

		const inlined = evaluateFunction<typeof moveTarget>(page(), 'moveTarget');
		for (const [key, from, count, size] of [
			['Home', 5, 10, 3],
			['End', 5, 10, 3],
			['PageDown', 9, 10, 3],
			['PageUp', 1, 10, 3],
			['ArrowDown', 0, 1, 3],
			['nope', 0, 10, 3],
			['Home', 0, 0, 3],
		] as Array<[string, number, number, number]>) {
			assert.strictEqual(inlined(key, from, count, size), moveTarget(key, from, count, size), key);
		}
	});

	test('AC10: the key handler wires movement, expansion, type-ahead and the live count', () => {
		const script = page();
		const keys = functionSource(script, 'onTreeKeydown');
		assert.ok(keys.includes('moveTarget(event.key, at, visibleNodeIds.length, page)'), 'one key map');
		assert.ok(keys.includes('event.preventDefault()'), 'the default scroll is suppressed');
		assert.ok(keys.includes("event.key === 'ArrowRight'"), 'expand');
		assert.ok(keys.includes("event.key === 'ArrowLeft'"), 'collapse');
		assert.ok(keys.includes('typeAheadJump(event.key)'), 'type-ahead');
		assert.ok(functionSource(script, 'typeAheadJump').includes('2000'), 'with a time window');
		assert.ok(script.includes('role="status" aria-live="polite"'), 'the count is announced politely');
	});

	test('AC11: no runtime dependency was added and nothing is fetched', () => {
		const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
		assert.strictEqual(manifest.dependencies, undefined, 'the extension still has no runtime dependencies');

		const html = page();
		assert.ok(!/\ssrc=/.test(html), 'nothing is loaded by src');
		assert.ok(!/<link\b/.test(html), 'no stylesheet link');
		assert.ok(!/url\(\s*['"]?(https?:|\/\/)/.test(html), 'no remote url()');

		const sources = fs.readdirSync(path.join(repoRoot, 'src', 'editor'));
		assert.deepStrictEqual(
			sources.filter((name) => !name.endsWith('.ts')),
			[],
			'the editor is TypeScript only'
		);
	});

	test('AC11: every colour literal is a fallback inside a --vscode-* variable', () => {
		const style = styleOf(page());
		const hexes = [...style.matchAll(/#[0-9a-fA-F]{3,8}\b/g)];
		assert.deepStrictEqual(
			hexes.map((match) => match[0]),
			['#80808040'],
			'the indent-guide fallback is the only literal'
		);
		for (const match of hexes) {
			const before = style.slice(0, match.index);
			const open = before.lastIndexOf('var(');
			assert.ok(open > before.lastIndexOf(')'), 'a literal only ever appears inside a var()');
			assert.ok(before.slice(open).includes('--vscode-'), 'and it is a --vscode-* fallback');
		}
		assert.ok(style.includes('var(--vscode-'), 'theming through CSS custom properties');
	});

	test('AC12: the presentation changes add no write path', () => {
		const editorDir = path.join(repoRoot, 'src', 'editor');
		let writes = 0;
		for (const name of fs.readdirSync(editorDir)) {
			if (!name.endsWith('.ts')) {
				continue;
			}
			const source = fs.readFileSync(path.join(editorDir, name), 'utf8');
			writes += (source.match(/new vscode\.WorkspaceEdit\(/g) ?? []).length;
			writes += (source.match(/fs\.writeFile/g) ?? []).length;
		}
		assert.strictEqual(writes, 1, 'the value editor’s single WorkspaceEdit is still the only write');

		assert.strictEqual((page().match(/type: 'edit'/g) ?? []).length, 1);
	});
});
