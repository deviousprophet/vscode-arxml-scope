/**
 * AC1–AC6 — the quiet-source document view: default view, hidden details, the editor surface,
 * real source line numbers, the gutter/fold column, the restrained token system, selection/focus,
 * content parity, the strip and the state toggles.
 *
 * There is no webview DOM in the test host. The page's own `applyView` and
 * `applyInspectorVisibility` are driven with stub DOM objects; the rest is asserted on the
 * rendered markup/styles and the inlined script. The browser pass is the rendered evidence.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { LineIndex } from '../../core/text/offsets';
import { renderHtml, renderTree } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';
import { functionSource } from './scriptTestUtils';

const FIXTURE = 'editor/render.arxml';

function text(): string {
	return fixtureText(FIXTURE);
}

function page(): string {
	return renderHtml(scanEcucValues(text()), { nonce: 'test-nonce' });
}

function tree(): string {
	return renderTree(scanEcucValues(text()), {});
}

function styleOf(html: string): string {
	const match = /<style[^>]*>([\s\S]*?)<\/style>/.exec(html);
	assert.ok(match, 'one inlined style block');
	return match[1];
}

suite('editor document view (AC1–AC6)', () => {
	test('AC2/AC6: Document is the default; the strip and toggles exist', () => {
		const html = page();
		assert.ok(html.includes('<body data-view="document">'));
		assert.ok(/id="view-toggle"[^>]*aria-pressed="true"/.test(html));
		assert.ok(html.includes('<span class="view-document">Document</span>'));
		assert.ok(html.includes('<span class="view-tree">Tree</span>'));
		assert.ok(/id="details-toggle"[^>]*aria-pressed="false"/.test(html));
		assert.ok(html.includes('aria-controls="inspector"'));
		assert.ok(html.includes('<aside id="inspector" class="inspector" role="region" aria-label="Node details" hidden>'));
		assert.ok(html.includes('Select a line to see its details.'));
		assert.ok(html.includes('Click a line or press Space.'));
	});

	test('AC2: the document CSS is one editor surface with the quiet-source tokens', () => {
		const style = styleOf(page());
		assert.ok(/body\[data-view\]\s*\{[^}]*--ecuc-fs:\s*var\(--vscode-editor-font-size, 13px\)/.test(style));
		assert.ok(/body\[data-view\]\s*\{[^}]*--ecuc-lh:\s*calc\(var\(--ecuc-fs\) \* 1\.55\)/.test(style));
		assert.ok(/--tok-keyword:\s*var\(--vscode-debugTokenExpression-boolean/.test(style));
		assert.ok(/--tok-string:\s*var\(--vscode-debugTokenExpression-string/.test(style));
		assert.ok(/--tok-number:\s*var\(--vscode-debugTokenExpression-number/.test(style));
		assert.ok(/--tok-meta:\s*var\(--vscode-debugTokenExpression-name/.test(style));
		assert.ok(/--tok-comment:\s*color-mix/.test(style));
		assert.ok(/--tok-key:\s*var\(--vscode-symbolIcon-variableForeground/.test(style));
		assert.ok(/--tok-punct:\s*color-mix/.test(style));
		assert.ok(/--tok-dim:\s*color-mix/.test(style));
		assert.ok(/--hover-bg:\s*var\(--vscode-list-hoverBackground/.test(style));
		assert.ok(/--sel-bg:\s*var\(--vscode-list-inactiveSelectionBackground/.test(style));
		assert.ok(/--sel-bg-focus:\s*var\(--vscode-list-activeSelectionBackground/.test(style));
		assert.ok(/--rail:\s*var\(--vscode-focusBorder/.test(style));

		assert.ok(/body\[data-view="document"\] #tree\s*\{[^}]*position:\s*relative/.test(style));
		assert.ok(/body\[data-view="document"\] #tree\s*\{[^}]*font-family:\s*var\(--vscode-editor-font-family/.test(style));
		assert.ok(/body\[data-view="document"\] #tree\s*\{[^}]*font-size:\s*var\(--ecuc-fs\)/.test(style));
		assert.ok(/body\[data-view="document"\] #tree\s*\{[^}]*line-height:\s*var\(--ecuc-lh\)/.test(style));
		assert.ok(/body\[data-view="document"\] #tree\s*\{[^}]*font-variant-ligatures:\s*none/.test(style));
		assert.ok(/body\[data-view="document"\] #tree\s*\{[^}]*tab-size:\s*4/.test(style));
		assert.ok(/body\[data-view="document"\] #tree\s*\{[^}]*white-space:\s*pre/.test(style));
		assert.ok(
			/body\[data-view="document"\] #tree\s*\{[^}]*padding:\s*calc\(var\(--ecuc-lh\) \* 0\.5\) 2ch calc\(var\(--ecuc-lh\) \* 3\) var\(--gut\)/.test(
				style
			)
		);
		assert.ok(/body\[data-view="document"\] \.row\s*\{[^}]*display:\s*flex/.test(style));
		assert.ok(/body\[data-view="document"\] \.row\s*\{[^}]*gap:\s*1ch/.test(style));
		assert.ok(/body\[data-view="document"\] \.row\s*\{[^}]*padding:\s*0/.test(style));
		assert.ok(/body\[data-view="document"\] \.row\s*\{[^}]*border:\s*0/.test(style));
		assert.ok(/body\[data-view="document"\] \.row\s*\{[^}]*background:\s*transparent/.test(style));
		assert.ok(/body\[data-view="document"\] \.glyph\s*\{[^}]*display:\s*none/.test(style));
		assert.ok(/body\[data-view="document"\] \.row-meta\s*\{[^}]*display:\s*flex/.test(style));
		assert.ok(/body\[data-view="document"\] \.row-meta\s*\{[^}]*flex-wrap:\s*nowrap/.test(style));
		assert.ok(/body\[data-view="document"\] \.row-meta\s*\{[^}]*font-size:\s*inherit/.test(style));
		assert.ok(/body\[data-view="document"\] \.children\s*\{[^}]*margin-left:\s*var\(--indent\)/.test(style));
		assert.ok(/body\[data-view="document"\] \.children::before\s*\{[^}]*content:\s*"\{"\s*;/.test(style));
		assert.ok(/body\[data-view="document"\] \.children::after\s*\{[^}]*content:\s*"\}"\s*;/.test(style));
		assert.ok(/body\[data-view="document"\] \.children::before[\s\S]*?margin-left:\s*calc\(-1 \* var\(--indent\)\)/.test(style));
		assert.ok(/body\[data-view="document"\] \.row\s*\{[^}]*margin-left:\s*calc\(-1 \* var\(--gut\)\)/.test(style));
		assert.ok(/body\[data-view="document"\] \.row\s*\{[^}]*padding-left:\s*var\(--gut\)/.test(style));
		assert.ok(
			/body\[data-view="document"\] \.children \.row\s*\{[^}]*margin-left:\s*calc\(-1 \* \(var\(--gut\) \+ var\(--indent\)\)\)/.test(
				style
			)
		);
		assert.ok(/body\[data-view="document"\] \.document\s*\{[^}]*--indent:\s*4ch/.test(style));
		assert.ok(/@media \(max-width: 720px\)[\s\S]*?--indent:\s*3ch/.test(style));
		assert.ok(/body\[data-view="document"\] #tree > \.node \+ \.node\s*\{[^}]*margin-top:\s*var\(--ecuc-lh\)/.test(style));
		assert.ok(/body\[data-view="document"\] \.meta\s*\{[^}]*margin-bottom:\s*var\(--ecuc-lh\)/.test(style));
		assert.ok(/body\[data-view="document"\] \.condition,[\s\S]*?border:\s*0/.test(style));
		assert.ok(/body\[data-view="document"\] \.annotation::before\s*\{[^}]*content:\s*"\/\*/.test(style));
		assert.ok(/body\[data-view="document"\] \.row\.k-module \.label::before\s*\{[^}]*content:\s*"module /.test(style));
		// The Tree view is still the base presentation; document selectors are scoped.
		assert.ok(/\.row\s*\{[^}]*display:\s*grid/.test(style));
		assert.ok(!/body\[data-view="document"\] \.row-meta\s*\{[^}]*display:\s*none/.test(style), 'metadata is not hidden');
	});

	test('AC2: rows carry real 1-based source line numbers and the gutter width', () => {
		const source = text();
		const model = scanEcucValues(source);
		const index = new LineIndex(source);
		const region = renderTree(model, { lineIndex: index });
		assert.ok(/class="document" style="--ln-digits:\d+"/.test(region));
		const module = model.modules[0];
		const parameter = module.containers[0].parameters.find((candidate) => candidate.name === 'IniValue');
		assert.ok(parameter, 'the fixture has IniValue');
		const moduleLine = index.positionAt(module.range.start).line + 1;
		const parameterLine = index.positionAt(parameter.range.start).line + 1;
		assert.ok(region.includes(`class="row k-module no-value" data-line="${moduleLine}"`));
		assert.ok(region.includes(`class="row k-parameter has-value" data-line="${parameterLine}"`));
		// Header and braces stay unnumbered; only entity rows carry data-line.
		assert.ok(!/<div class="meta"[^>]*data-line=/.test(region));
		assert.ok(!/class="children"[^>]*data-line=/.test(region));
		const style = styleOf(page());
		assert.ok(/body\[data-view="document"\] \.document\s*\{[^}]*--ln-w:\s*calc\(var\(--ln-digits, 4\) \* 1ch \+ 1ch\)/.test(style));
		assert.ok(/body\[data-view="document"\] \.document\s*\{[^}]*--gut:\s*calc\(var\(--ln-w\) \+ 4ch\)/.test(style));
		assert.ok(/body\[data-view="document"\] \.row::before\s*\{[^}]*content:\s*attr\(data-line\)/.test(style));
		assert.ok(/body\[data-view="document"\] \.row::before\s*\{[^}]*position:\s*absolute[^}]*width:\s*var\(--ln-w\)/.test(style));
		assert.ok(
			/body\[data-view="document"\] \.twisty,\nbody\[data-view="document"\] \.spacer\s*\{[^}]*position:\s*absolute[^}]*left:\s*calc\(var\(--ln-w\) \+ 1ch\)/.test(
				style
			)
		);
		assert.ok(/body\[data-view="document"\] \.node\[aria-expanded="false"\] > \.row::after\s*\{[^}]*content:\s*" \{ … \}"/.test(style));
		assert.ok(/body\[data-view="document"\] \.node\[data-kind="parameter"\]\[data-selected="true"\] > \.row::after\s*\{[^}]*content:\s*"  F2"/.test(style));
	});

	test('AC1: document labels are neutral and only the semantic tokens carry accent', () => {
		const style = styleOf(page());
		assert.ok(/body\[data-view="document"\] \.label\s*\{[^}]*color:\s*var\(--vscode-editor-foreground\)/.test(style));
		assert.ok(!/body\[data-view="document"\] \.row\.k-module \.label\s*\{/.test(style), 'no module-path label colour');
		assert.ok(!/body\[data-view="document"\] \.row\.k-container \.label\s*\{/.test(style), 'no container label colour');
		assert.ok(!/body\[data-view="document"\] \.row\.k-parameter \.label,[\s\S]*?--vscode-symbolIcon-variableForeground/.test(style));
		assert.ok(/body\[data-view="document"\] \.node\[data-kind="parameter"\] > \.row > \.label,[\s\S]*?--tok-key/.test(style));
		assert.ok(/body\[data-view="document"\] \.meta \.keyword\s*\{[^}]*--tok-keyword/.test(style));
		assert.ok(/body\[data-view="document"\] \.row\.k-module \.label::before\s*\{[^}]*--tok-keyword/.test(style));
		assert.ok(/body\[data-view="document"\] \.variant,[\s\S]*?--tok-meta/.test(style));
		assert.ok(/body\[data-view="document"\] \.hex\s*\{[^}]*--tok-number/.test(style));
		assert.ok(
			/body\[data-view="document"\] \.target\s*\{[^}]*color:\s*var\(--vscode-editor-foreground\)[^}]*text-decoration:\s*none/.test(
				style
			),
			'the target is plain text, not a permanent blue underline'
		);
		assert.ok(
			/body\[data-view="document"\] \.target:hover \.value-text\s*\{[^}]*--vscode-textLink-foreground[^}]*text-decoration:\s*underline/.test(
				style
			),
			'the link affordance is hover-only'
		);
	});

	test('AC3/AC5: quiet selection, focus rail and plain values', () => {
		const style = styleOf(page());
		assert.ok(/body\[data-view="document"\] \.node\[data-selected="true"\] > \.row\s*\{[^}]*background:\s*var\(--sel-bg\)/.test(style));
		assert.ok(
			/body\[data-view="document"\] #tree:focus-within \.node\[data-selected="true"\] > \.row\s*\{[^}]*background:\s*var\(--sel-bg-focus\)/.test(
				style
			)
		);
		assert.ok(/body\[data-view="document"\] \.node:focus-visible > \.row\s*\{[^}]*box-shadow:\s*inset 2px 0 0 var\(--rail\)/.test(style));
		assert.ok(!style.includes('--ecuc-selection-fg'), 'selection never recolours syntax');
		assert.ok(/body\[data-view="document"\] \.row\.k-parameter > \.value\s*\{[^}]*border-bottom:\s*0/.test(style));
		assert.ok(/body\[data-view="document"\] \.row\.k-parameter:hover > \.value::after\s*\{[^}]*content:\s*none/.test(style));
		assert.ok(/body\[data-view="document"\] \.node\[data-kind="parameter"\] > \.row > \.value:hover\s*\{[^}]*cursor:\s*text/.test(style));
	});

	test('AC4: the strip is compact and flat', () => {
		const style = styleOf(page());
		assert.ok(/\.toolbar\s*\{[^}]*height:\s*26px/.test(style));
		assert.ok(/\.toolbar\s*\{[^}]*padding:\s*0 8px/.test(style));
		assert.ok(/\.toolbar\s*\{[^}]*flex-wrap:\s*nowrap/.test(style));
		assert.ok(/\.filter-wrap\s*\{[^}]*flex:\s*0 1 28ch/.test(style));
		assert.ok(/\.filter:not\(:placeholder-shown\)\s*\{[^}]*var\(--vscode-input-background\)/.test(style));
		assert.ok(/\.tool\s*\{[^}]*background:\s*transparent[^}]*border:\s*0/.test(style));
		assert.ok(/\.view-switch\[aria-pressed="true"\] \.view-document/.test(style));
	});

	test('AC4: the strip keeps the collapse/expand, view and details controls', () => {
		const html = page();
		assert.ok(/id="collapse-all"[^>]*aria-label="Collapse every container"[^>]*><svg/.test(html));
		assert.ok(/id="expand-all"[^>]*aria-label="Expand every container"[^>]*><svg/.test(html));
		assert.ok(/id="view-toggle"[^>]*aria-pressed="true"[^>]*>.*view-document/.test(html));
		assert.ok(/id="details-toggle"[^>]*aria-label="Show node details"[^>]*><svg/.test(html));
	});

	test('AC3/AC4: the document keeps every parent §6 field and the direct .value', () => {
		const html = tree();
		for (const needle of [
			'<span class="label">ContA</span>',
			'<span class="short" title="ContA">"ContA"</span>',
			'class="variant"',
			'class="hex"',
			'class="context"',
			'<span class="keyword">context</span>',
			'class="condition"',
			'class="annotation"',
			'<span class="label">IniValue</span><span class="value"',
		]) {
			assert.ok(html.includes(needle), needle);
		}
		assert.ok(html.includes('data-value="63"'));
		assert.ok(html.includes('(= 0x3F)'));
	});

	test('AC2: the value separator is muted punctuation and stays out of the value token', () => {
		const html = tree();
		assert.ok(html.includes('<span class="punct">=</span> <span class="value-text">63</span>'));
		const style = styleOf(page());
		assert.ok(/\.punct\s*\{[^}]*--tok-punct/.test(style));
		assert.ok(/body\[data-view="document"\] \.value\s*\{[^}]*flex:\s*0 0 auto/.test(style));
	});

	test('AC5/AC7: the details width and narrow layout are specified', () => {
		const style = styleOf(page());
		assert.ok(/#inspector\s*\{[^}]*flex:\s*0 0 clamp\(260px, 30%, 340px\)/.test(style));
		assert.ok(/@media \(max-width: 720px\)[\s\S]*?body\[data-view="document"\] \.row::before\s*\{[^}]*display:\s*none/.test(style));
		assert.ok(/@media \(max-width: 720px\)[\s\S]*?\.details-toggle \.lbl[\s\S]*?display:\s*none/.test(style));
		assert.ok(/@media \(max-width: 720px\)[\s\S]*?\.grow[\s\S]*?display:\s*none/.test(style));
		assert.ok(/@media \(max-width: 720px\)[\s\S]*?#inspector\s*\{[^}]*max-height:\s*45vh/.test(style));
	});

	test('AC2: Tree view shares the quiet-source surface tokens', () => {
		const style = styleOf(page());
		assert.ok(/\.tree\s*\{[^}]*font-family:\s*var\(--vscode-editor-font-family/.test(style));
		assert.ok(/\.tree\s*\{[^}]*font-size:\s*var\(--ecuc-fs\)/.test(style));
		assert.ok(/\.target\s*\{[^}]*color:\s*var\(--vscode-editor-foreground\)/.test(style));
		assert.ok(!/\.target\s*\{[^}]*text-decoration:\s*underline/.test(style), 'targets are hover-only underlined');
		assert.ok(/\.target:hover \.value-text\s*\{[^}]*text-decoration:\s*underline/.test(style));
	});

	test('AC5: the page’s own applyView/applyInspectorVisibility drive the stubs', () => {
		const html = page();
		const viewState = { view: 'document', inspectorHidden: true };
		const body = { dataset: {} as Record<string, string> };
		const viewToggle = {
			attrs: {} as Record<string, string>,
			textContent: '',
			title: '',
			setAttribute(name: string, value: string) {
				this.attrs[name] = value;
			},
		};
		const applyView = new Function(
			'viewState',
			'document',
			'viewToggle',
			`${functionSource(html, 'applyView')}\napplyView();`
		) as (state: unknown, doc: unknown, toggle: unknown) => void;
		applyView(viewState, { body }, viewToggle);
		assert.strictEqual((body.dataset as Record<string, string>).view, 'document');
		assert.strictEqual(viewToggle.attrs['aria-pressed'], 'true');
		assert.strictEqual(viewToggle.title, 'Switch to tree view');
		assert.strictEqual(viewToggle.textContent, '', 'the Document|Tree spans are static');

		const treeState = { view: 'tree', inspectorHidden: true };
		applyView(treeState, { body }, viewToggle);
		assert.strictEqual((body.dataset as Record<string, string>).view, 'tree');
		assert.strictEqual(viewToggle.attrs['aria-pressed'], 'false');
		assert.strictEqual(viewToggle.title, 'Switch to document view');

		const inspector = { hidden: false };
		const details = {
			attrs: {} as Record<string, string>,
			title: '',
			setAttribute(name: string, value: string) {
				this.attrs[name] = value;
			},
		};
		const applyInspector = new Function(
			'viewState',
			'inspector',
			'detailsToggle',
			`${functionSource(html, 'applyInspectorVisibility')}\napplyInspectorVisibility();`
		) as (state: unknown, panel: unknown, toggle: unknown) => void;
		applyInspector({ view: 'document', inspectorHidden: true }, inspector, details);
		assert.strictEqual(inspector.hidden, true);
		assert.strictEqual(details.attrs['aria-pressed'], 'false');
		assert.strictEqual(details.attrs['aria-label'], 'Show node details');
		assert.strictEqual(details.title, 'Show node details');
		applyInspector({ view: 'document', inspectorHidden: false }, inspector, details);
		assert.strictEqual(inspector.hidden, false);
		assert.strictEqual(details.attrs['aria-pressed'], 'true');
		assert.strictEqual(details.attrs['aria-label'], 'Hide node details');
		assert.strictEqual(details.title, 'Hide node details');
	});

	test('AC5/AC6: the defaults and persistence path are present', () => {
		const script = page();
		assert.ok(script.includes("viewState.view = 'document'"));
		assert.ok(script.includes('viewState.inspectorHidden = true'));
		assert.ok(script.includes('viewToggle.addEventListener'));
		assert.ok(script.includes('viewState.view = viewState.view ==='));
		assert.ok(script.includes('viewState.inspectorHidden = !viewState.inspectorHidden'));
		assert.ok(script.includes('document.body.dataset.view'));
		assert.ok(script.includes('vscode.getState()'));
		assert.ok(script.includes('vscode.setState(viewState)'));
	});
});
