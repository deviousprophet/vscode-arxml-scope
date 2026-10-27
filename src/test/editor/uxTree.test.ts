/**
 * AC1, AC3–AC8 and AC10–AC12 — the interaction model, collapse, hierarchy, the widget's
 * affordance, the key map and the guardrails, asserted on the string `renderHtml`
 * returns.
 *
 * `@vscode/test-electron` exposes no webview DOM, so a click cannot be performed here.
 * The markup is asserted, and the inlined script is located by name and then **compiled
 * and driven**, so the page's own copy of each helper is what the test exercises rather
 * than the host-side twin it was serialized from. What that still leaves unverified — the
 * real hit area of a twisty, hover, and a scroll that survives a re-scan in a live
 * webview — is recorded in `implement.md` §Manual verification and is not implied here.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { scanEcucValues } from '../../core/ecuc/scanner';
import {
	ReRenderHooks,
	collapsedIdsFor,
	moveTarget,
	pruneCollapsed,
	reRenderTree,
	renderHtml,
	renderTree,
	toggleCollapsed,
} from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';
import { repoRoot } from './editorTestUtils';
import { evaluateFunction, functionSource } from './scriptTestUtils';

const FIXTURE = 'editor/render.arxml';

function page(): string {
	return renderHtml(scanEcucValues(fixtureText(FIXTURE)), { nonce: 'test-nonce' });
}

function styleOf(html: string): string {
	const match = /<style[^>]*>([\s\S]*?)<\/style>/.exec(html);
	assert.ok(match, 'one inlined style block');
	return match[1];
}

/** The opening tag of the node that owns the first `.row k-<kind>` in `tree`. */
function nodeTagFor(tree: string, kind: string): string {
	const at = tree.indexOf(`<span class="row k-${kind}`);
	assert.notStrictEqual(at, -1, `a ${kind} row is rendered`);
	const open = tree.lastIndexOf('<div class="node"', at);
	assert.notStrictEqual(open, -1, `the ${kind} row belongs to a node`);
	return tree.slice(open, tree.indexOf('>', open) + 1);
}

suite('editor interaction, collapse and hierarchy (AC1, AC3–AC8, AC10–AC12)', () => {
	test('AC1: a plain click selects and never reveals', () => {
		const click = functionSource(page(), 'onRowClick');
		assert.ok(click.includes('selectItem(item)'), 'a click on the row selects it');
		assert.ok(!click.includes('revealItem'), 'and opens no text editor');
		assert.ok(click.includes('flipCollapsed'), 'the twisty toggles instead');
		assert.ok(click.includes('followItem'), 'the reference target follows instead');
		// One interaction, one effect: the toggle and the follow each return before the
		// select, so a toggle cannot also move the selection.
		assert.ok(click.indexOf('flipCollapsed') < click.indexOf('selectItem(item)'));
		assert.ok(click.indexOf('followItem') < click.indexOf('selectItem(item)'));
		assert.ok(!click.includes('stopImmediatePropagation'), 'the tree does not steal an event the widget claimed');
	});

	test('AC1/AC2: the deliberate gestures are the double click and Ctrl/Alt+Enter', () => {
		const script = page();
		const double = functionSource(script, 'onRowDoubleClick');
		assert.ok(double.includes('revealItem(item)'), 'a double click reveals');
		assert.ok(
			double.includes('.twisty') && double.includes('[data-follow]'),
			'a toggle or a follow is not also a reveal'
		);

		const keys = functionSource(script, 'onTreeKeydown');
		assert.ok(keys.includes('event.ctrlKey || event.altKey'), 'Ctrl/Alt+Enter is the deliberate key');
		assert.ok(keys.includes('revealItem(item)'));

		// Space selects only: it must not toggle and must not reveal.
		const space = keys.slice(keys.indexOf("event.key === ' '"), keys.indexOf('event.key.length === 1'));
		assert.ok(space.includes('selectItem(item)'), 'Space selects');
		assert.ok(!space.includes('revealItem') && !space.includes('flipCollapsed'), 'and does nothing else');

		// The selection is the host's too, so a re-scan cannot move it back (AC4).
		assert.ok(script.includes("vscode.postMessage({ type: 'select', nodeId: item.dataset.nodeId })"));
	});

	test('AC3: a toggle is rendered only where there is something to toggle', () => {
		const tree = renderTree(scanEcucValues(fixtureText(FIXTURE)), {});
		assert.ok(/class="row k-module[^"]*"[^>]*><span class="twisty"/.test(tree), 'a module has a toggle');
		assert.ok(/class="row k-container[^"]*"[^>]*><span class="twisty"/.test(tree), 'a container has a toggle');
		assert.ok(/class="row k-parameter[^"]*"[^>]*><span class="spacer"/.test(tree), 'a parameter gets a spacer');
		assert.ok(/class="row k-reference[^"]*"[^>]*><span class="spacer"/.test(tree), 'a reference gets a spacer');
		assert.ok(tree.includes('aria-hidden="true"'), 'the marker is not announced twice');
		assert.ok(tree.includes('class="twisty" aria-hidden="true"><svg'), 'the twisty is inline SVG, not an asset');

		const module = nodeTagFor(tree, 'module');
		const parameter = nodeTagFor(tree, 'parameter');
		assert.ok(module.includes('aria-expanded="true"'), 'a toggle carries the state');
		assert.ok(!parameter.includes('aria-expanded'), 'a leaf carries none');

		// The rule that actually hides a collapsed subtree. Without it the toggle would
		// only flip an attribute and the children would stay on screen (design §4.2).
		assert.ok(
			/\.node\[aria-expanded="false"\]\s*>\s*\.children\s*\{[^}]*display:\s*none/.test(styleOf(page())),
			'a collapsed node hides its children'
		);
	});

	test('AC3: aria-expanded is decided in one place, from the collapsed set', () => {
		const script = page();
		const apply = functionSource(script, 'applyCollapsed');
		assert.ok(apply.includes("setAttribute('aria-expanded'"), 'the attribute follows the state');
		assert.ok(apply.includes("'false'"), 'a collapsed node renders as false');
		assert.ok(apply.includes('itemHasChildren(item)'), 'a leaf is skipped, so it never gains the attribute');
		assert.ok(apply.includes('collapsed.has(id)'), 'the state is the collapsed set');
		assert.ok(apply.includes('expandedOverride'), 'a filter override is honoured');

		const flip = functionSource(script, 'flipCollapsed');
		assert.ok(flip.includes('toggleCollapsed('), 'the toggle flips membership');
		assert.ok(flip.includes('applyCollapsed()'), 'and re-decides visibility');
		assert.ok(!flip.includes('setSelection'), 'without moving the selection');

		// The page's own toggleCollapsed behaves as the host's, for the same inputs.
		const inlined = evaluateFunction<typeof toggleCollapsed>(script, 'toggleCollapsed');
		for (const [collapsed, id, hasChildren] of [
			[[], 'a', true],
			[['a', 'b'], 'a', true],
			[['a'], 'a', false],
		] as Array<[string[], string, boolean]>) {
			assert.deepStrictEqual(inlined(collapsed, id, hasChildren), toggleCollapsed(collapsed, id, hasChildren));
		}
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

	test('AC4: a re-render reads the scroll first and writes it back last', () => {
		const calls: string[] = [];
		let written = '';
		const hooks: ReRenderHooks = {
			readScrollTop: () => {
				calls.push('readScrollTop');
				return 42;
			},
			writeHtml: (tree) => {
				written = tree;
				calls.push('writeHtml');
			},
			pruneCollapsed: () => calls.push('pruneCollapsed'),
			applyCollapsed: () => calls.push('applyCollapsed'),
			applyFilter: () => calls.push('applyFilter'),
			prepareFocus: () => calls.push('prepareFocus'),
			writeScrollTop: (top) => calls.push(`writeScrollTop:${top}`),
		};

		reRenderTree('<div id="tree"></div>', hooks);

		assert.strictEqual(written, '<div id="tree"></div>', 'the swapped region is the re-scanned tree');
		assert.deepStrictEqual(calls, [
			'readScrollTop',
			'writeHtml',
			'pruneCollapsed',
			'applyCollapsed',
			'applyFilter',
			'prepareFocus',
			'writeScrollTop:42',
		]);
	});

	test('AC4: the page re-renders through the same sequence, over the #main scroll box', () => {
		const script = page();
		assert.ok(script.includes('reRenderTree(message.tree, {'), 'the model message uses the one sequence');
		assert.ok(script.includes('readScrollTop: () => main.scrollTop'));
		assert.ok(script.includes('main.innerHTML = tree'));
		assert.ok(script.includes('main.scrollTop = top'));
		assert.ok(script.includes("const main = document.getElementById('main')"));

		// The handler has to *wire* every step, not merely call the sequence: dropping the
		// prune or the re-apply leaves the shape intact and the collapse state broken.
		const handler = script.slice(script.indexOf('reRenderTree(message.tree, {'));
		for (const hook of [
			'readScrollTop: () => main.scrollTop',
			'main.innerHTML = tree',
			'pruneCollapsed: prune',
			'applyCollapsed: () => applyCollapsed()',
			'applyFilter: applyFilter',
			'prepareFocus: prepareFocus',
			'main.scrollTop = top',
		]) {
			assert.ok(handler.includes(hook), `the model handler wires ${hook}`);
		}

		// `main.scrollTop` is only meaningful if #main is the scroll container.
		const style = styleOf(script);
		assert.ok(/#main\s*\{[^}]*overflow:\s*auto/.test(style), '#main scrolls');
		assert.ok(/body\s*\{[^}]*overflow:\s*hidden/.test(style), 'and the page does not scroll behind it');

		// The filter box sits outside the swapped region, which is what keeps what the
		// user typed across a re-scan (R-UX4).
		const filterAt = script.indexOf('id="filter"');
		const mainAt = script.indexOf('id="main"');
		assert.ok(filterAt !== -1 && mainAt !== -1, 'both the filter box and the swapped region exist');
		assert.ok(filterAt < mainAt, 'the filter box is not inside the region the re-scan replaces');

		// The page's own reRenderTree runs the sequence the host test above asserts.
		const calls: string[] = [];
		const inlined = evaluateFunction<typeof reRenderTree>(script, 'reRenderTree');
		inlined('tree', {
			readScrollTop: () => {
				calls.push('read');
				return 7;
			},
			writeHtml: () => calls.push('writeHtml'),
			pruneCollapsed: () => calls.push('prune'),
			applyCollapsed: () => calls.push('applyCollapsed'),
			applyFilter: () => calls.push('applyFilter'),
			prepareFocus: () => calls.push('prepareFocus'),
			writeScrollTop: (top) => calls.push(`write:${top}`),
		});
		assert.deepStrictEqual(calls, ['read', 'writeHtml', 'prune', 'applyCollapsed', 'applyFilter', 'prepareFocus', 'write:7']);
	});

	test('AC5: expand-all and collapse-all are offered and touch nothing but the collapsed set', () => {
		const script = page();
		assert.ok(script.includes('id="expand-all"') && script.includes('id="collapse-all"'));
		assert.ok(script.includes("getElementById('collapse-all').addEventListener('click', collapseAll)"));
		assert.ok(script.includes("getElementById('expand-all').addEventListener('click', expandAll)"));

		const collapse = functionSource(script, 'collapseAll');
		assert.ok(collapse.includes('collapsedIdsFor('), 'collapse-all is every node that has children');
		assert.ok(collapse.includes('applyCollapsed()'), 'and re-decides visibility');
		assert.ok(!collapse.includes('setSelection') && !collapse.includes('selectedId'), 'the selection is intact');

		const expand = functionSource(script, 'expandAll');
		assert.ok(expand.includes('collapsed = new Set()'), 'expand-all is the empty collapsed set');
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

	test('AC6: each kind has its own class, its own marker shape and its own accent', () => {
		const tree = renderTree(scanEcucValues(fixtureText(FIXTURE)), {});
		for (const kind of ['module', 'container', 'parameter', 'reference']) {
			assert.ok(tree.includes(`class="row k-${kind}`), `the ${kind} class`);
			assert.ok(tree.includes(`class="g-${kind}"`), `the ${kind} marker`);
		}
		// Distinct shapes, so the kinds are told apart without colour (high-contrast safe).
		assert.ok(/class="g-module"[^>]*><rect/.test(tree), 'a filled square');
		assert.ok(/class="g-container"[^>]*fill="none"[^>]*><rect/.test(tree), 'a hollow square');
		assert.ok(/class="g-parameter"[^>]*><circle/.test(tree), 'a dot');
		assert.ok(/class="g-reference"[^>]*><path/.test(tree), 'an arrow');

		const style = styleOf(page());
		assert.ok(/\.row\.k-module,\s*\.row\.k-container\s*\{[^}]*var\(--vscode-/.test(style));
		assert.ok(/\.row\.k-parameter\s*\{[^}]*var\(--vscode-symbolIcon-fieldForeground/.test(style));
		assert.ok(/\.row\.k-reference\s*\{[^}]*var\(--vscode-symbolIcon-referenceForeground/.test(style));
	});

	test('AC7: the indent guide falls back to a visible colour, never transparent', () => {
		const style = styleOf(page());
		const rule = /\.children\s*\{([^}]*)\}/.exec(style);
		assert.ok(rule, 'the children group carries the guide');
		const border = /border-left:\s*1px solid ([^;]+);/.exec(rule![1]);
		assert.ok(border, 'a border draws the guide');
		assert.strictEqual(
			border![1].trim(),
			'var(--vscode-tree-indentGuidesStroke, var(--vscode-panel-border, #80808040))',
			'the chain falls through to a colour when the theme defines neither variable'
		);
		assert.ok(!/transparent/.test(border![1]), 'transparent is the defect this exists for');
	});

	test('AC6: the row states come from the theme, including the unfocused selection', () => {
		const style = styleOf(page());
		// Design §1.3 lists these as defects of the flat tree, so they are asserted rather
		// than assumed: a hover state, and a selection that stops using the active colours
		// when the webview is not focused.
		assert.ok(
			/\.row:hover\s*\{[^}]*var\(--vscode-list-hoverBackground/.test(style),
			'a row has a hover state'
		);
		assert.ok(
			/\.node\[data-selected="true"\]\s*>\s*\.row\s*\{[^}]*var\(--vscode-list-activeSelectionBackground/.test(style),
			'a focused selection uses the active colours'
		);
		assert.ok(
			/body:not\(:focus-within\)\s+\.node\[data-selected="true"\]\s*>\s*\.row\s*\{[^}]*var\(--vscode-list-inactiveSelectionBackground/.test(style),
			'an unfocused selection uses the inactive colours'
		);
	});

	test('AC8: a value advertises that it is editable, by tooltip and by hover', () => {
		const script = page();
		assert.ok(script.includes('<span class="value" title="Click to edit, or press F2:'), 'the tooltip');
		assert.ok(script.includes('= "hello"'), 'and it carries the full value for a clipped cell');
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

		// The widget's listeners are registered before the tree's, and claim their events.
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

	test('AC10: an item carries its position, its group size and its selection state', () => {
		const tree = renderTree(scanEcucValues(fixtureText(FIXTURE)), {});
		assert.ok(tree.includes('aria-posinset="1"') && tree.includes('aria-setsize='));
		assert.ok(tree.includes('aria-selected="false"'), 'an unselected item says so');
		assert.ok(
			/role="treeitem" aria-level="1" aria-posinset="1" aria-setsize="1" aria-selected="false"/.test(tree),
			'one module, so the group of modules is a single item'
		);
		assert.ok(
			/aria-level="3" aria-posinset="6" aria-setsize="6"/.test(tree),
			'the last of ContA’s six members knows it is sixth of six'
		);
		assert.ok(/aria-level="4" aria-posinset="1" aria-setsize="1"/.test(tree), 'the nested parameter');
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

		// The page runs the same function, so the branches above are the branches the
		// keyboard reaches.
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
		assert.ok(keys.includes('moveTarget(event.key, at, items.length, page)'), 'the move keys share one map');
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

		// No asset file was added beside the editor sources.
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

		// And the page posts exactly one kind of edit message.
		assert.strictEqual((page().match(/type: 'edit'/g) ?? []).length, 1);
	});
});
