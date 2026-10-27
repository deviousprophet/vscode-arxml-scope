/**
 * AC1–AC6 — the editor-like document default: default view, hidden details, the document CSS,
 * neutral labels, the restrained palette, content parity, the gutter/selection/value affordances
 * and the state toggles.
 *
 * There is no webview DOM in the test host. The page's own `applyView` and
 * `applyInspectorVisibility` are driven with stub DOM objects; the rest is asserted on the
 * rendered markup/styles and the inlined script. The browser pass is the rendered evidence.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
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
	test('AC2/AC6: Document is the default; the view and details toggles exist', () => {
		const html = page();
		assert.ok(html.includes('<body data-view="document">'));
		assert.ok(/id="view-toggle"[^>]*aria-pressed="true"/.test(html));
		assert.ok(html.includes('>Tree</button>'), 'the view toggle offers the tree view');
		assert.ok(/id="details-toggle"[^>]*aria-pressed="false"/.test(html));
		assert.ok(html.includes('aria-controls="inspector"'));
		assert.ok(html.includes('<aside id="inspector" class="inspector" role="region" aria-label="Node details" hidden>'));
	});

	test('AC2: the document CSS is an editor-like, one-line presentation over the tree', () => {
		const style = styleOf(page());
		assert.ok(/body\[data-view="document"\] #tree\s*\{[^}]*--vscode-editor-font-family/.test(style));
		assert.ok(/body\[data-view="document"\] #tree\s*\{[^}]*font-size:\s*var\(--vscode-editor-font-size, 14px\)/.test(style));
		assert.ok(/body\[data-view="document"\] #tree\s*\{[^}]*line-height:\s*1\.5/.test(style));
		assert.ok(/body\[data-view="document"\] #tree\s*\{[^}]*padding:\s*8px 0 24px 3\.5ch/.test(style));
		assert.ok(/body\[data-view="document"\] \.row\s*\{[^}]*display:\s*flex/.test(style));
		assert.ok(/body\[data-view="document"\] \.row\s*\{[^}]*gap:\s*1ch/.test(style));
		assert.ok(/body\[data-view="document"\] \.row\s*\{[^}]*padding:\s*0/.test(style));
		assert.ok(/body\[data-view="document"\] \.row\s*\{[^}]*border:\s*0/.test(style));
		assert.ok(/body\[data-view="document"\] \.row\s*\{[^}]*background:\s*transparent/.test(style));
		assert.ok(/body\[data-view="document"\] \.glyph\s*\{[^}]*display:\s*none/.test(style));
		assert.ok(/body\[data-view="document"\] \.row-meta\s*\{[^}]*display:\s*flex/.test(style));
		assert.ok(/body\[data-view="document"\] \.row-meta\s*\{[^}]*flex-wrap:\s*nowrap/.test(style));
		assert.ok(/body\[data-view="document"\] \.row-meta\s*\{[^}]*font-size:\s*inherit/.test(style));
		assert.ok(/body\[data-view="document"\] \.children\s*\{[^}]*margin-left:\s*4ch/.test(style));
		assert.ok(/body\[data-view="document"\] \.children::before\s*\{[^}]*content:\s*"\{"\s*;/.test(style));
		assert.ok(/body\[data-view="document"\] \.children::after\s*\{[^}]*content:\s*"\}"\s*;/.test(style));
		assert.ok(/body\[data-view="document"\] \.children::before[\s\S]*?margin-left:\s*-4ch/.test(style));
		assert.ok(/body\[data-view="document"\] \.condition,[\s\S]*?border:\s*0/.test(style));
		assert.ok(/body\[data-view="document"\] \.annotation::before\s*\{[^}]*content:\s*"\/\*/.test(style));
		assert.ok(/body\[data-view="document"\] \.row\.k-module \.label::before\s*\{[^}]*content:\s*"module /.test(style));
		// The Tree view is still the base presentation; document selectors are scoped.
		assert.ok(/\.row\s*\{[^}]*display:\s*grid/.test(style));
		assert.ok(!/body\[data-view="document"\] \.row-meta\s*\{[^}]*display:\s*none/.test(style), 'metadata is not hidden');
	});

	test('AC1: document labels are neutral and only the semantic tokens carry accent', () => {
		const style = styleOf(page());
		assert.ok(/body\[data-view="document"\] \.label\s*\{[^}]*color:\s*var\(--vscode-editor-foreground\)/.test(style));
		assert.ok(!/body\[data-view="document"\] \.row\.k-module \.label\s*\{/.test(style), 'no module-path label colour');
		assert.ok(!/body\[data-view="document"\] \.row\.k-container \.label\s*\{/.test(style), 'no container label colour');
		assert.ok(!/body\[data-view="document"\] \.row\.k-parameter \.label,[\s\S]*?--vscode-symbolIcon-variableForeground/.test(style));
		assert.ok(/body\[data-view="document"\] \.meta \.keyword\s*\{[^}]*--vscode-symbolIcon-keywordForeground/.test(style));
		assert.ok(/body\[data-view="document"\] \.row\.k-module \.label::before\s*\{[^}]*--vscode-symbolIcon-keywordForeground/.test(style));
		assert.ok(/body\[data-view="document"\] \.variant,[\s\S]*?--vscode-descriptionForeground/.test(style));
		assert.ok(/body\[data-view="document"\] \.hex\s*\{[^}]*--vscode-symbolIcon-numberForeground/.test(style));
		assert.ok(
			/body\[data-view="document"\] \.target\s*\{[^}]*color:\s*var\(--vscode-editor-foreground\)[^}]*text-decoration:\s*none/.test(
				style
			),
			'the target is plain text, not a permanent blue underline'
		);
		assert.ok(
			/body\[data-view="document"\] \.target:hover\s*\{[^}]*--vscode-textLink-foreground[^}]*text-decoration:\s*underline/.test(
				style
			),
			'the link affordance is hover-only'
		);
	});

	test('AC3/AC5: gutter, quiet selection and plain values', () => {
		const style = styleOf(page());
		assert.ok(
			/body\[data-view="document"\] \.twisty,\nbody\[data-view="document"\] \.spacer\s*\{[^}]*position:\s*absolute[^}]*left:\s*-2\.2ch/.test(
				style
			),
			'the twisty lives in the gutter, not the text flow'
		);
		assert.ok(
			/body\[data-view="document"\] \.node\[data-selected="true"\] > \.row,[\s\S]*?--vscode-editor-lineHighlightBackground/.test(
				style
			),
			'a document selection is a line highlight, not the list bar'
		);
		assert.ok(
			/body\[data-view="document"\] \.node:focus-visible > \.row\s*\{[^}]*box-shadow:\s*inset 2px 0 0 var\(--vscode-focusBorder\)/.test(
				style
			),
			'keyboard focus keeps a visible edge'
		);
		assert.ok(/body\[data-view="document"\] \.row\.k-parameter > \.value\s*\{[^}]*border-bottom:\s*0/.test(style));
		assert.ok(/body\[data-view="document"\] \.row\.k-parameter:hover > \.value::after\s*\{[^}]*content:\s*none/.test(style));
	});

	test('AC4: the document bar is compact and flat', () => {
		const style = styleOf(page());
		assert.ok(/body\[data-view="document"\] \.toolbar\s*\{[^}]*padding:\s*3px 8px/.test(style));
		assert.ok(/body\[data-view="document"\] \.filter-wrap\s*\{[^}]*max-width:\s*240px/.test(style));
		assert.ok(/body\[data-view="document"\] \.toolbar \.filter\s*\{[^}]*max-width:\s*240px/.test(style));
		assert.ok(/body\[data-view="document"\] \.toolbar \.tool\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/.test(style));
	});

	test('AC3/AC4: the document keeps every parent §6 field and the direct .value', () => {
		const html = tree();
		for (const needle of [
			'<span class="label">ContA</span>',
			'<span class="short" title="ContA">"ContA"</span>',
			'class="variant"',
			'class="hex"',
			'class="context"',
			'class="condition"',
			'class="annotation"',
			'<span class="label">IniValue</span><span class="value"',
		]) {
			assert.ok(html.includes(needle), needle);
		}
		assert.ok(html.includes('data-value="63"'));
		assert.ok(html.includes('(= 0x3F)'));
	});

	test('AC3: the module prefix and selected/focused labels keep their emphasis', () => {
		const style = styleOf(page());
		assert.ok(/body\[data-view="document"\] \.row\.k-module \.label::before\s*\{[^}]*--vscode-symbolIcon-keywordForeground/.test(style));
		assert.ok(
			/body\[data-view="document"\] :is\(\.node\[data-selected="true"\], \.node:focus-visible\) > \.row > \.label[\s\S]*?--ecuc-selection-fg/.test(
				style
			),
			'a selected/focused label uses the emphasis foreground'
		);
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
		assert.strictEqual(viewToggle.textContent, 'Tree');

		const treeState = { view: 'tree', inspectorHidden: true };
		applyView(treeState, { body }, viewToggle);
		assert.strictEqual((body.dataset as Record<string, string>).view, 'tree');
		assert.strictEqual(viewToggle.attrs['aria-pressed'], 'false');
		assert.strictEqual(viewToggle.textContent, 'Document');

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
		assert.strictEqual(details.title, 'Show node details');
		applyInspector({ view: 'document', inspectorHidden: false }, inspector, details);
		assert.strictEqual(inspector.hidden, false);
		assert.strictEqual(details.attrs['aria-pressed'], 'true');
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
