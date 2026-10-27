/**
 * AC4, AC6–AC9 — the details inspector, the two-line grid, the source positions, the
 * details toggle and the filter/empty-state feedback.
 *
 * There is no webview DOM in the test host, so the assertions are on the rendered markup,
 * the model-derived data attributes and the page's own inline script. The DOM pass — a
 * click filling the panel, a re-scan not destroying it, hover/focus — is observed in the
 * browser harness and recorded in `implement.md`; it is not implied here.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { LineIndex } from '../../core/text/offsets';
import { filterScript } from '../../editor/filter';
import { renderHtml, renderTree } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';
import { repoRoot } from './editorTestUtils';
import { functionSource } from './scriptTestUtils';

const FIXTURE = 'editor/render.arxml';

function text(): string {
	return fixtureText(FIXTURE);
}

function page(): string {
	const source = text();
	return renderHtml(scanEcucValues(source), { nonce: 'test-nonce', lineIndex: new LineIndex(source) });
}

function tree(): string {
	const source = text();
	return renderTree(scanEcucValues(source), { lineIndex: new LineIndex(source) });
}

function styleOf(html: string): string {
	const match = /<style[^>]*>([\s\S]*?)<\/style>/.exec(html);
	assert.ok(match, 'one inlined style block');
	return match[1];
}

suite('editor visual polish (AC4, AC6–AC9)', () => {
	test('AC4: the page has a details inspector outside the re-rendered tree region', () => {
		const html = page();
		assert.ok(html.includes('<aside id="inspector" class="inspector" role="region" aria-label="Node details" hidden>'));
		assert.ok(html.includes('id="details-toggle"'));
		assert.ok(html.includes('aria-controls="inspector"'));
		assert.ok(/id="details-toggle"[^>]*aria-pressed="false"/.test(html));
		assert.ok(/id="view-toggle"[^>]*aria-pressed="true"/.test(html));
		assert.ok(html.includes('Select a node to see its details.'));
		assert.ok(!renderTree(scanEcucValues(text()), {}).includes('id="inspector"'), 'the tree swap cannot remove it');
	});

	test('AC4: every node carries the definition path, short name and value the panel needs', () => {
		const html = tree();
		assert.ok(html.includes('data-definition-ref="/PkgA/PkgB/ModDefs/ModX"'));
		assert.ok(html.includes('data-definition-ref="/PkgA/PkgB/ModDefs/ModX/ContA"'));
		assert.ok(html.includes('data-short-name="ContA"'));
		assert.ok(html.includes('data-value="63"'), 'a parameter carries the raw value');
		assert.ok(html.includes('data-target="/PkgA/PkgB/ModX/ContA/ContB"'), 'a reference carries the raw target');
	});

	test('AC4: the source range is derived from LineIndex, not from the displayed order', () => {
		const source = text();
		const model = scanEcucValues(source);
		const index = new LineIndex(source);
		const container = model.modules[0].containers[0];
		const parameter = container.parameters.find((candidate) => candidate.name === 'IniValue');
		assert.ok(parameter, 'the fixture has IniValue');
		const start = index.positionAt(parameter.range.start);
		const end = index.positionAt(parameter.range.end);
		const html = renderTree(model, { lineIndex: index });
		assert.ok(
			html.includes(
				`data-line="${start.line}" data-column="${start.character}"` +
					` data-end-line="${end.line}" data-end-column="${end.character}"`
			),
			'the parameter carries its real source position'
		);
		assert.ok(!html.includes('data-range-start='), 'the unused raw range is not duplicated as data');
	});

	test('AC4: the inspector reads the data and posts reveal/copy, with no innerHTML', () => {
		// Source-level field list: the DOM pass is browser-observed (implement.md); driving the
		// whole inspector would need a full DOM and is not claimed here.
		const html = page();
		const update = functionSource(html, 'updateInspector');
		for (const field of [
			'Definition',
			'Short name',
			'Variant',
			'Value',
			'Hexadecimal',
			'Target',
			'Context',
			'Conditions',
			'Annotations',
			'Source',
			'Reveal in source',
			'Copy path',
			'Copy value',
		]) {
			assert.ok(update.includes(`'${field}'`), field);
		}
		assert.ok(update.includes("vscode.postMessage({ type: 'copy', text: path })"));
		assert.ok(update.includes("vscode.postMessage({ type: 'copy', text: valueText })"));
		assert.ok(update.includes('revealItem(item)'));
		assert.ok(update.includes('Number(line) + 1'), 'the display line is one-based');
		assert.ok(update.includes("inspector.textContent = ''"), 'the panel is rebuilt from text nodes');
		assert.ok(!update.includes('innerHTML'), 'model text is never inserted as markup');
	});

	test('AC4/AC8: selection and a re-scan update the panel; the toggle controls it', () => {
		const html = page();
		const select = functionSource(html, 'setSelection');
		assert.ok(select.includes('updateInspector()'), 'a selection fills the panel');
		// The page's own prepareFocus adopts a host-rendered selection on first paint, so
		// the panel is not empty until the first click. Drive the page's copy, not a grep.
		const marked = { dataset: { nodeId: 'node-1' } };
		const focused: unknown[] = [];
		const prepare = new Function(
			'document',
			'allItems',
			'focusItem',
			`let selectedId; ${functionSource(html, 'prepareFocus')}\nprepareFocus();\nreturn selectedId;`
		) as (
			document: { querySelector(selector: string): unknown },
			allItems: () => unknown[],
			focusItem: (item: unknown) => void
		) => string | undefined;
		const adopted = prepare(
			{ querySelector: (selector: string) => (selector === '#tree [aria-selected="true"]' ? marked : null) },
			() => [marked],
			(item) => focused.push(item)
		);
		assert.strictEqual(adopted, 'node-1', 'the initial host selection fills the panel');
		assert.deepStrictEqual(focused, [marked], 'and is focused');
		const firstPaint = html.lastIndexOf('prepareFocus();');
		assert.ok(
			firstPaint !== -1 && html.indexOf('updateInspector();', firstPaint) > firstPaint,
			'and the first paint fills the panel after adopting it'
		);
		const script = html;
		// The value editor also has a model handler; the tree's is the last one. Scope the
		// assertion to it so the trailing updateInspector() at page load cannot satisfy it.
		const modelAt = script.lastIndexOf("if (message.type === 'model')");
		const rerenderAt = script.indexOf('reRenderTree(message.tree', modelAt);
		const updateAt = script.indexOf('updateInspector();', rerenderAt);
		const nextBranchAt = script.indexOf("} else if (message.type", rerenderAt);
		assert.ok(
			modelAt !== -1 && rerenderAt !== -1 && updateAt !== -1 && nextBranchAt !== -1 && updateAt < nextBranchAt,
			'a re-scan refreshes the panel'
		);
		assert.ok(script.includes("detailsToggle.addEventListener('click'"));
		assert.ok(script.includes('viewState.inspectorHidden = !viewState.inspectorHidden'));
		assert.ok(script.includes('applyInspectorVisibility()'));
		assert.ok(script.includes("detailsToggle.setAttribute('aria-pressed'"));
		assert.ok(script.includes("viewToggle.addEventListener('click'"));
		assert.ok(script.includes('viewState.view'));
		assert.ok(script.includes('vscode.getState()'), 'the panel preference is restored on a reload');
		assert.ok(script.includes('vscode.setState(viewState)'), 'and saved through the host state');
		assert.ok(script.includes('viewState.inspectorHidden'), 'the saved flag is the hidden state');
	});

	test('AC6: rows are a two-line grid and .value stays a direct child of .row', () => {
		const html = tree();
		assert.ok(html.includes('class="row k-module no-value"'));
		assert.ok(html.includes('class="row k-container no-value"'));
		assert.ok(html.includes('class="row k-parameter has-value"'));
		assert.ok(html.includes('class="row k-reference has-value"'));
		assert.ok(html.includes('<span class="label">IniValue</span><span class="value"'), 'the value is still a direct child');
		assert.ok(html.includes('<span class="row-meta">'), 'the secondary fields have their own line');
		assert.ok(html.includes('<span class="hex" title="(= 0x3F)">(= 0x3F)</span>'), 'metadata carries a tooltip');
		assert.ok(html.includes('<span class="short" title="ModX">"ModX"</span>'), 'and a short-name tooltip');
		assert.ok(html.includes('<span class="condition" title='), 'a condition carries a tooltip');
		assert.ok(html.includes('<span class="annotation" title='), 'an annotation carries a tooltip');
		const style = styleOf(page());
		assert.ok(style.includes('grid-template-columns: 12px 12px 26ch minmax(0, 1fr)'));
		assert.ok(/\.row\.no-value \.label\s*\{[^}]*grid-column:\s*3\s*\/\s*-1/.test(style));
		assert.ok(/\.row-meta\s*\{[^}]*grid-column:\s*3\s*\/\s*-1/.test(style));
		assert.ok(/\.row-meta > span\s*\{[^}]*text-overflow:\s*ellipsis/.test(style), 'metadata ellipsizes');
		assert.ok(/\.label\s*\{[^}]*text-overflow:\s*ellipsis/.test(style));
		assert.ok(/\.value\s*\{[^}]*text-overflow:\s*ellipsis/.test(style));
	});

	test('AC7: the filter has a clear button, a count state and an empty state', () => {
		const html = page();
		assert.ok(html.includes('id="filter-clear"'));
		assert.ok(html.includes('id="count"') && html.includes('data-state="none"'));
		assert.ok(html.includes('id="empty"'));
		assert.ok(tree().includes('id="empty"'), 'the empty block belongs to the swapped tree region');
		assert.ok(html.includes('id="empty-text"'));
		assert.ok(html.includes('id="empty-clear"'));
		const script = filterScript();
		const apply = functionSource(script, 'applyFilter');
		assert.ok(apply.includes("getElementById('empty')"), 'the empty block is looked up after a swap');
		assert.ok(apply.includes("getElementById('empty-text')"));
		assert.ok(apply.includes("countLabel.dataset.state = 'none'"));
		assert.ok(apply.includes("countLabel.dataset.state = 'empty'"));
		assert.ok(apply.includes("countLabel.dataset.state = 'filtered'"));
		assert.ok(apply.includes("clearButton.hidden = filterInput.value.trim() === ''"));
		assert.ok(apply.includes("emptyText.textContent = 'No matches for \"' + filterInput.value.trim() + '\".'"));
		assert.ok(script.includes('#empty-clear'), 'the clear action survives the tree swap by delegation');
	});

	test('AC7: the filter still highlights label, short name and value through the shared matchRanges', () => {
		const script = filterScript();
		assert.ok(
			script.includes(
				":scope > .row > .label, :scope > .row > .row-meta .short, :scope > .row > .value"
			),
			'the highlight set follows the new metadata line'
		);
		assert.ok(script.includes('matchRanges('), 'the one definition of a match is still used');
	});

	test('AC9: a selected row uses the selection foreground for token-coloured text', () => {
		const style = styleOf(page());
		assert.ok(style.includes('--ecuc-selection-fg: var(--vscode-list-activeSelectionForeground)'));
		assert.ok(style.includes('--ecuc-selection-fg: var(--vscode-list-inactiveSelectionForeground)'));
		assert.ok(
			/:is\(\.node\[data-selected="true"\], \.node:focus-visible\) > \.row > \.value[\s\S]*?color: var\(--ecuc-selection-fg\)/.test(
				style
			),
			'the value and secondary fields do not keep a low-contrast token colour on the selection'
		);
	});

	test('AC9: fonts have usable fallbacks and no colour literal was introduced', () => {
		const style = styleOf(page());
		assert.ok(style.includes('font-family: var(--vscode-font-family,'));
		assert.ok(style.includes('font-family: var(--vscode-editor-font-family,'));
		const hexes = [...style.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
		assert.deepStrictEqual(hexes, ['#80808040'], 'the indent-guide fallback is the only literal');
		const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
			dependencies?: Record<string, string>;
		};
		assert.strictEqual(pkg.dependencies, undefined, 'no runtime dependency');
	});
});
