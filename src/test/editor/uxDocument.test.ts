/**
 * The Document-only quiet-source surface: no Tree toggle or Tree CSS, no source-line gutter,
 * bracket guides and selected-subtree highlighting, the editor surface/tokens, selection/focus,
 * details width, the details value editor and the state defaults.
 *
 * There is no webview DOM in the test host. The page's own `applyInspectorVisibility` is
 * driven with stub DOM objects; the rest is asserted on the row data, the shell, its styles
 * and the inlined script. The browser pass is the rendered evidence.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { RowPayload, renderHtml } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';
import { functionSource } from './scriptTestUtils';

const FIXTURE = 'editor/render.arxml';

function text(): string {
	return fixtureText(FIXTURE);
}

function page(): string {
	return renderHtml(scanEcucValues(text()), { nonce: 'test-nonce' });
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

suite('editor document view', () => {
	test('Document is the only view; the strip and details exist', () => {
		const html = page();
		assert.ok(html.includes('<body data-view="document">'));
		assert.ok(!html.includes('id="view-toggle"'), 'the Tree view toggle is gone');
		assert.ok(!html.includes('view-document') && !html.includes('view-tree'), 'no view switch labels');
		assert.ok(/id="details-toggle"[^>]*aria-pressed="true"/.test(html));
		assert.ok(html.includes('aria-controls="inspector"'));
		assert.ok(html.includes('<aside id="inspector" class="inspector" role="region" aria-label="Node details">'));
		assert.ok(html.includes('Select a line to see its details.'));
		assert.ok(html.includes('Click a line or press Space.'));
		assert.ok(html.includes('<div id="notice" class="notice" role="status" aria-live="polite"></div>'));
		assert.equal(html.match(/id="notice"/g)?.length, 1, 'the notice id is unique');
		assert.ok(!html.includes('data-ln-digits'), 'no line-number gutter width');
		assert.ok(!html.includes('data-line='), 'no source-line display data');
		assert.ok(!html.includes('class="glyph"'), 'no Tree glyph column');
		assert.ok(!html.includes('class="view-switch"'), 'no Tree view CSS');
	});

	test('the document CSS is one editor surface with the quiet-source tokens', () => {
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
		assert.ok(/--sel-bg:\s*color-mix\([^;]*--vscode-list-inactiveSelectionBackground/.test(style));
		assert.ok(/--sel-bg-focus:\s*color-mix\([^;]*--vscode-list-activeSelectionBackground/.test(style));
		assert.ok(/--rail:\s*var\(--vscode-focusBorder/.test(style));

		assert.ok(/body\[data-view="document"\] #tree\s*\{[^}]*position:\s*relative/.test(style));
		assert.ok(/body\[data-view="document"\] #tree\s*\{[^}]*font-family:\s*var\(--vscode-editor-font-family/.test(style));
		assert.ok(/body\[data-view="document"\] #tree\s*\{[^}]*font-size:\s*var\(--ecuc-fs\)/.test(style));
		assert.ok(/body\[data-view="document"\] #tree\s*\{[^}]*line-height:\s*var\(--ecuc-lh\)/.test(style));
		assert.ok(/body\[data-view="document"\] #tree\s*\{[^}]*white-space:\s*pre/.test(style));
		assert.ok(/\.row\s*\{[^}]*display:\s*flex/.test(style));
		assert.ok(/\.row\s*\{[^}]*gap:\s*1ch/.test(style));
		assert.ok(/\.row\s*\{[^}]*padding:\s*0 0 0 var\(--content-pad\)/.test(style));
		assert.ok(/body\[data-view\]\s*\{[^}]*--doc-pad:\s*3ch/.test(style));
		assert.ok(/body\[data-view\]\s*\{[^}]*--indent:\s*4ch/.test(style));
		assert.ok(/body\[data-view\]\s*\{[^}]*--fold-gutter:\s*26px/.test(style));
		assert.ok(
			/body\[data-view\]\s*\{[^}]*--content-pad:\s*calc\(var\(--fold-gutter\) \+ var\(--doc-pad\)\)/.test(style)
		);
		assert.ok(
			/body\[data-view="document"\] \.row\[data-level="3"\]\s*\{[^}]*padding-left:\s*calc\(var\(--content-pad\) \+ var\(--indent\) \* 2\)/.test(
				style
			)
		);
		assert.ok(
			!/body\[data-view="document"\] \.brace \.row\[data-level="3"\]/.test(style),
			'brace rows use the same indentation as labels'
		);
		assert.ok(!/--ln-w|--ln-digits|--gut/.test(style), 'no line-number/gutter variables');
		assert.ok(!/row::before\s*\{[^}]*attr\(data-line\)/.test(style), 'no line-number pseudo-element');
		assert.ok(!/repeating-linear-gradient/.test(style), 'no continuous indent guides');
		assert.ok(/\.guide\s*\{[^}]*opacity:\s*0\.28/.test(style), 'bracket guides start faded');
		assert.ok(/\.guide\.guide-active\s*\{[^}]*opacity:\s*0\.85/.test(style), 'hover makes the guide clearer');
		assert.ok(
			/body\[data-view="document"\] \.guide\[data-level="3"\]\s*\{[^}]*left:\s*calc\(var\(--content-pad\) \+ var\(--indent\) \* 2 \+ 0\.5ch\)/.test(
				style
			)
		);
		assert.ok(/@media \(max-width: 720px\)[\s\S]*?--doc-pad:\s*2\.5ch/.test(style));
		assert.ok(
			/body\[data-view="document"\] \.meta\s*\{[^}]*padding:[^;]*var\(--content-pad\)/.test(style),
			'the header aligns with the post-gutter content edge'
		);
		assert.ok(
			/body\[data-view="document"\] \.empty\s*\{[^}]*padding:[^;]*var\(--content-pad\)/.test(style),
			'the empty state aligns with the post-gutter content edge'
		);
		assert.ok(
			/body\[data-view="document"\] \.node\[data-gap="true"\]\s*\{[^}]*padding-top:\s*var\(--ecuc-lh\)/.test(style)
		);
		assert.ok(/body\[data-view="document"\] \.meta\s*\{[^}]*margin-bottom:\s*calc\(var\(--ecuc-lh\) \* 0\.5\)/.test(style));
		assert.ok(/body\[data-view="document"\] \.condition,[\s\S]*?border:\s*0/.test(style));
		assert.ok(/body\[data-view="document"\] \.annotation::before\s*\{[^}]*content:\s*"\/\*/.test(style));
		assert.ok(/body\[data-view="document"\] \.row\.k-module \.label::before\s*\{[^}]*content:\s*"module /.test(style));
		assert.ok(!/body\[data-view="document"\] \.row-meta\s*\{[^}]*display:\s*none/.test(style), 'metadata is not hidden');
		assert.ok(!/body\[data-view="tree"\]/.test(style), 'no Tree scoped CSS');
	});

	test('the review fixes keep the dark-only contrast tiers', () => {
		const style = styleOf(page());
		assert.ok(/@supports \(color: color-mix\(in srgb, currentColor 50%, transparent\)\)/.test(style));
		assert.ok(/body\[data-view\]\s*\{[^}]*--sel-bg: color-mix\([^;]*14%/.test(style));
		assert.ok(/body\[data-view\]\s*\{[^}]*--subtree-bg: color-mix\([^;]*18%/.test(style));
		assert.ok(!/body\.vscode-light/.test(style), 'light theme is not supported');
	});

	test('rows carry no display-only source positions or line-number width', () => {
		const rows = payload().rows;
		for (const row of rows) {
			assert.ok(!('sourceLine' in row), 'no source line');
			assert.ok(!('line' in row), 'no 0-based line');
			assert.ok(!('column' in row), 'no column');
			assert.ok(!('endLine' in row), 'no end line');
			assert.ok(!('endColumn' in row), 'no end column');
		}
		assert.ok(!('digits' in payload()), 'no gutter width');
		const build = functionSource(page(), 'buildNodeRow');
		assert.ok(!build.includes('dataset.line'), 'the row has no line-number data');
		const brace = functionSource(page(), 'buildBraceRow');
		assert.ok(!brace.includes('dataset.line'), 'braces stay unnumbered');
	});

	test('document labels and reference values use the dark semantic accents', () => {
		const style = styleOf(page());
		assert.ok(/body\[data-view="document"\] \.label\s*\{[^}]*color:\s*var\(--vscode-editor-foreground\)/.test(style));
		assert.ok(!/body\[data-view="document"\] \.row\.k-module \.label\s*\{/.test(style), 'no module-path label colour');
		assert.ok(
			/body\[data-view="document"\] \.node\[data-kind="container"\] > \.row > \.label\s*\{[^}]*color:\s*var\(--container-accent\)/.test(
				style
			),
			'a container is green like a type'
		);
		assert.ok(/--container-accent:\s*#4EC9B0/.test(style), 'the dark container accent is fixed green');
		assert.ok(
			/body\[data-view="document"\] \.node\[data-kind="reference"\] > \.row > \.value \.value-text\s*\{[^}]*--vscode-symbolIcon-functionForeground[^}]*font-style:\s*italic/.test(
				style
			),
			'a reference value is yellow and italic'
		);
		assert.ok(!/body\[data-view="document"\] \.row\.k-parameter \.label,[\s\S]*?--vscode-symbolIcon-variableForeground/.test(style));
		assert.ok(/body\[data-view="document"\] \.node\[data-kind="parameter"\] > \.row > \.label,[\s\S]*?--tok-key/.test(style));
		assert.ok(/body\[data-view="document"\] \.meta \.keyword\s*\{[^}]*--tok-keyword/.test(style));
		assert.ok(/body\[data-view="document"\] \.row\.k-module \.label::before\s*\{[^}]*--tok-keyword/.test(style));
		assert.ok(/body\[data-view="document"\] \.variant,[\s\S]*?--tok-meta/.test(style));
		assert.ok(!/body\[data-view="document"\] \.hex\s*\{/.test(style), 'the Document has no hex meta style');
		assert.ok(!/body\[data-view="document"\] \.target\s*\{/.test(style), 'reference targets have no Document link style');
		assert.ok(!/\.target:hover \.value-text/.test(style), 'reference targets have no hover underline');
	});

	test('quiet selection, focus rail and read-only values', () => {
		const style = styleOf(page());
		assert.ok(/body\[data-view="document"\] \.node\[data-selected="true"\] > \.row\s*\{[^}]*background-color:\s*var\(--sel-bg-focus\)/.test(style));
		assert.ok(/body\[data-view="document"\] \.node\[data-selected="true"\] > \.row\s*\{[^}]*box-shadow:\s*inset 2px 0 0 var\(--rail\)/.test(style));
		assert.ok(
			/body\[data-view="document"\] #tree:focus-within \.node\[data-selected="true"\] > \.row\s*\{[^}]*background-color:\s*var\(--sel-bg-focus\)/.test(
				style
			)
		);
		assert.ok(/body\[data-view="document"\] \.node:focus-visible > \.row\s*\{[^}]*box-shadow:\s*inset 2px 0 0 var\(--rail\)/.test(style));
		assert.ok(!style.includes('--ecuc-selection-fg'), 'selection never recolours syntax');
		assert.ok(!/body\[data-view="document"\] \.row\.k-parameter > \.value\s*\{[^}]*border-bottom/.test(style), 'no edit underline');
		assert.ok(!style.includes('.value-edit'), 'no inline document editor');
		assert.ok(
			/body\[data-view="document"\] \.node\[data-kind="parameter"\] > \.row > \.value > \.value-text\s*\{[^}]*cursor:\s*pointer/.test(
				style
			)
		);
		assert.ok(
			/body\[data-view="document"\] \.node\[data-subtree="true"\] > \.row,/.test(style),
			'a selected container tints its subtree'
		);
		assert.ok(/--sel-container-bg: color-mix\([^;]*45%/.test(style), 'the selected container uses the visible neutral fill');
		assert.ok(
			/body\[data-view="document"\] \.node\[data-kind="container"\]\[data-selected="true"\] > \.row,[\s\S]*?background-color:\s*var\(--sel-container-bg\)/.test(
				style
			),
			'a selected container keeps the visible fill'
		);
		assert.ok(
			/body\[data-view="document"\] #tree:focus-within \.node\[data-kind="container"\]\[data-selected="true"\] > \.row,[\s\S]*?background-color:\s*var\(--sel-container-bg\)/.test(
				style
			),
			'the focused container keeps the visible fill'
		);
		assert.ok(
			/body\[data-view="document"\] \.node\[data-kind="parameter"\]\[data-selected="true"\] > \.row\s*\{[^}]*background-color:\s*var\(--sel-bg-focus\)[^}]*--sel-outline/.test(
				style
			),
			'a selected parameter has a stronger outline'
		);
	});

	test('the strip is compact and flat', () => {
		const style = styleOf(page());
		assert.ok(/\.toolbar\s*\{[^}]*height:\s*26px/.test(style));
		assert.ok(/\.toolbar\s*\{[^}]*padding:\s*0 8px/.test(style));
		assert.ok(/\.toolbar\s*\{[^}]*flex-wrap:\s*nowrap/.test(style));
		assert.ok(/\.filter-wrap\s*\{[^}]*flex:\s*0 1 28ch/.test(style));
		assert.ok(/\.filter:not\(:placeholder-shown\)\s*\{[^}]*var\(--vscode-input-background\)/.test(style));
		assert.ok(/\.tool\s*\{[^}]*background:\s*transparent[^}]*border:\s*0/.test(style));
		assert.ok(!style.includes('.view-switch'), 'no view switch');
	});

	test('the strip keeps the collapse/expand and details controls', () => {
		const html = page();
		assert.ok(/id="collapse-all"[^>]*aria-label="Collapse every container"[^>]*>[\s\S]*?<span class="lbl">Collapse<\/span>/.test(html));
		assert.ok(/id="expand-all"[^>]*aria-label="Expand every container"[^>]*>[\s\S]*?<span class="lbl">Expand<\/span>/.test(html));
		assert.ok(/\.icon-tool\s*\{[^}]*min-width:\s*28px[^}]*padding:\s*0 8px/.test(styleOf(html)));
		assert.ok(/\.twisty\s*\{[^}]*opacity:\s*0;/.test(styleOf(html)), 'expanded folds start hidden');
		assert.ok(/\.twisty\s*\{[^}]*left:\s*2px/.test(styleOf(html)), 'the chevron is inset 2px into the gutter');
		assert.ok(/\.twisty\s*\{[^}]*width:\s*16px/.test(styleOf(html)), 'the chevron is 16px wide');
		assert.ok(/\.twisty\s*\{[^}]*top:\s*0[^}]*bottom:\s*0/.test(styleOf(html)), 'the hit area spans the full row height');
		assert.ok(
			/body\[data-view="document"\] #tree:hover \.node\[aria-expanded="true"\] > \.row > \.twisty/.test(styleOf(html)),
			'expanded folds appear on tree hover'
		);
		assert.ok(
			/body\[data-view="document"\] \.node\[aria-expanded="false"\] > \.row > \.twisty\s*\{[^}]*opacity:\s*1/.test(
				styleOf(html)
			),
			'collapsed folds stay visible'
		);
		assert.ok(
			/body\[data-view="document"\] \.node\[data-kind="container"\]\[data-empty="true"\] > \.row::after\s*\{[^}]*content:\s*" \{ \}"/.test(
				styleOf(html)
			),
			'an empty container is marked at rest'
		);
		assert.ok(functionSource(html, 'buildNodeRow').includes("node.dataset.empty = 'true'"), 'the marker is data-driven');
		assert.ok(/\.guide\.guide-active\s*\{[^}]*opacity:\s*0\.85/.test(styleOf(html)));
		assert.ok(/id="details-toggle"[^>]*aria-label="Hide node details"[^>]*><svg/.test(html));
		assert.ok(!html.includes('id="view-toggle"'));
	});

	test('the document keeps every parent §6 field and the direct .value', () => {
		const rows = payload().rows;
		const contA = rows.find((row) => row.label === 'ContA')!;
		assert.ok(contA.meta.some((part) => part.cls === 'short' && part.text === '"ContA"'));
		const module = rows.find((row) => row.kind === 'module')!;
		assert.ok(module.meta.some((part) => part.cls === 'variant'));
		const ini = rows.find((row) => row.label === 'IniValue')!;
		assert.ok(!ini.meta.some((part) => part.text.indexOf('(= 0x') === 0), 'no hex meta in the Document');
		assert.strictEqual(ini.parameterType, 'Integer');
		assert.deepStrictEqual(ini.formats, [
			{ label: 'Decimal', value: '63' },
			{ label: 'Hexadecimal', value: '0x3F' },
			{ label: 'Binary', value: '0b00111111' },
		]);
		const peer = rows.find((row) => row.label === 'PeerIref')!;
		assert.ok(peer.meta.some((part) => part.cls === 'context'));
		assert.ok(module.meta.some((part) => part.cls === 'condition'));
		assert.ok(module.meta.some((part) => part.cls === 'annotation'));

		const script = functionSource(page(), 'buildNodeRow');
		assert.ok(script.includes('appendHighlighted(label, row.label)'), 'the label');
		assert.ok(script.includes('valueSpan(row)'), 'the value');
		assert.ok(script.includes('metaSpan(row)'), 'the metadata line');
		assert.ok(script.includes('rowElement.appendChild(valueSpan(row))'), 'the value stays a direct row child');
	});

	test('the value separator is muted punctuation and stays out of the value token', () => {
		const script = page();
		const value = functionSource(script, 'valueSpan');
		assert.ok(value.includes("punct.className = 'punct'"));
		assert.ok(value.includes("punct.textContent = '='"));
		assert.ok(value.includes("text.className = 'value-text'"));
		const style = styleOf(script);
		assert.ok(/\.punct\s*\{[^}]*--tok-punct/.test(style));
		assert.ok(/body\[data-view="document"\] \.value\s*\{[^}]*flex:\s*0 0 auto/.test(style));
	});

	test('the details width and narrow layout are specified', () => {
		const style = styleOf(page());
		assert.ok(/#inspector\s*\{[^}]*flex:\s*0 0 clamp\(260px, 30%, 340px\)/.test(style));
		assert.ok(/@media \(max-width: 720px\)[\s\S]*?\.details-toggle \.lbl[\s\S]*?display:\s*none/.test(style));
		assert.ok(/@media \(max-width: 720px\)[\s\S]*?\.grow[\s\S]*?display:\s*none/.test(style));
		assert.ok(/\.inspector-code\s*\{[^}]*white-space:\s*normal/.test(style));
		assert.ok(/@media \(max-width: 720px\)[\s\S]*?#inspector\s*\{[^}]*max-height:\s*45vh/.test(style));
		assert.ok(/#main\s*\{[^}]*scroll-padding-left:\s*var\(--content-pad\)/.test(style));
		assert.ok(/@media \(max-width: 720px\)[\s\S]*?--doc-pad:\s*2\.5ch/.test(style));
		assert.ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?steps\(1, end\)/.test(style));
		assert.ok(/@media \(forced-colors: active\)[\s\S]*?body\[data-view\] mark/.test(style));
		assert.ok(/body\.vscode-high-contrast\[data-view\] \.node\.flash/.test(style));
		assert.ok(
			/body\.vscode-high-contrast\[data-view\] \.node\[data-subtree="true"\] > \.row[\s\S]*?background:\s*transparent/.test(style),
			'high contrast uses an outline, not the subtree fill'
		);
		assert.ok(
			/body\.vscode-high-contrast\[data-view\] \.node\[data-kind="container"\] > \.row > \.label[\s\S]*?color:\s*var\(--vscode-editor-foreground\)/.test(style),
			'high contrast keeps the container name readable instead of forcing the dark green'
		);
		assert.ok(
			/@media \(forced-colors: active\)[\s\S]*?data-subtree="true"[\s\S]*?outline:/.test(style),
			'forced colors also replaces the subtree fill'
		);
	});

	test('an invalid edit keeps the text and adds a details comment reason', () => {
		const html = page();
		assert.ok(html.includes('details-value'));
		assert.ok(html.includes('details-value-error'));
		assert.ok(html.includes("error.textContent = '/* ' + reason + ' */'"));
		assert.ok(html.includes("'aria-invalid', 'true'"));
		assert.ok(html.includes('edit.input.focus()'));
		const style = styleOf(html);
		assert.ok(/\.details-value-error\s*\{[^}]*--vscode-errorForeground/.test(style));
		assert.ok(/\.details-value\[aria-invalid="true"\]\s*\{[^}]*--vscode-inputValidation-errorBorder/.test(style));
	});

	test('the page details visibility drives the stubs', () => {
		const html = page();
		const inspector = { hidden: false };
		const details = {
			attrs: {} as Record<string, string>,
			title: '',
			setAttribute(name: string, value: string) {
				this.attrs[name] = value;
			},
		};
		const applyInspector = new Function(
			'uiState',
			'inspector',
			'detailsToggle',
			`${functionSource(html, 'applyInspectorVisibility')}\napplyInspectorVisibility();`
		) as (state: unknown, panel: unknown, toggle: unknown) => void;
		applyInspector({ inspectorHidden: true }, inspector, details);
		assert.strictEqual(inspector.hidden, true);
		assert.strictEqual(details.attrs['aria-pressed'], 'false');
		assert.strictEqual(details.attrs['aria-label'], 'Show node details');
		assert.strictEqual(details.title, 'Show node details');
		applyInspector({ inspectorHidden: false }, inspector, details);
		assert.strictEqual(inspector.hidden, false);
		assert.strictEqual(details.attrs['aria-pressed'], 'true');
		assert.strictEqual(details.attrs['aria-label'], 'Hide node details');
		assert.strictEqual(details.title, 'Hide node details');
	});

	test('the defaults and persistence path are present', () => {
		const script = page();
		assert.ok(script.includes('let uiState = { inspectorHidden: false }'), 'details starts visible');
		assert.ok(script.includes("uiState.inspectorHidden = !uiState.inspectorHidden"));
		assert.ok(script.includes('vscode.getState()'));
		assert.ok(script.includes('vscode.setState(uiState)'));
		assert.ok(!script.includes('uiState.view'));
		assert.ok(!script.includes('viewToggle'));
	});

	test('AC8: a saved hide is honoured and an invalid state falls back to visible', () => {
		const html = page();
		const start = html.indexOf('const savedState = vscode.getState();');
		const assignment = html.indexOf('uiState.inspectorHidden = savedState.inspectorHidden;', start);
		const close = html.indexOf('}', assignment);
		assert.ok(start !== -1 && assignment !== -1 && close !== -1, 'the saved-state branch is inlined');
		const snippet = html.slice(start, close + 1);
		const read = new Function('vscode', `${snippet}\nreturn uiState;`) as (vscode: unknown) => {
			inspectorHidden: boolean;
		};
		const state = (saved: unknown): boolean => read({ getState: () => saved }).inspectorHidden;

		assert.strictEqual(state(undefined), false, 'no saved state shows the panel');
		assert.strictEqual(state(null), false);
		assert.strictEqual(state({}), false, 'a missing key shows the panel');
		assert.strictEqual(state({ inspectorHidden: 'yes' }), false, 'an invalid type is ignored');
		assert.strictEqual(state([]), false, 'an array is not a state object');
		assert.strictEqual(state({ inspectorHidden: true }), true, 'an explicit hide is honoured');
		assert.strictEqual(state({ inspectorHidden: false }), false, 'an explicit show is honoured');
	});

	test('R7: Collapse and Expand have different, semantically opposite glyphs', () => {
		const html = page();
		const details = /<button id="collapse-all"[\s\S]*?<\/button>/.exec(html);
		const expand = /<button id="expand-all"[\s\S]*?<\/button>/.exec(html);
		assert.ok(details && expand, 'both toolbar controls exist');

		const collapsePath = /<path d="([^"]+)"/.exec(details[0])?.[1];
		const expandPath = /<path d="([^"]+)"/.exec(expand[0])?.[1];
		assert.ok(collapsePath && expandPath, 'both carry an inline SVG path');
		assert.notStrictEqual(collapsePath, expandPath, 'the two controls do not look the same');

		// Expand spreads outward: a chevron whose apex is above the top edge and one whose
		// apex is below the bottom edge. Collapse squeezes inward: apexes point at the centre.
		assert.ok(expandPath!.startsWith('M4 6.25 8 2.25l4 4'), 'the upper chevron points up and away');
		assert.ok(expandPath!.includes('M4 9.75l4 4 4-4'), 'the lower chevron points down and away');
		assert.ok(collapsePath!.startsWith('M4 2.25l4 4 4-4'), 'the upper chevron points down toward the centre');
		assert.ok(collapsePath!.includes('M4 13.75l4-4 4 4'), 'the lower chevron points up toward the centre');

		assert.ok(/id="collapse-all"[^>]*title="Collapse every container"/.test(html));
		assert.ok(/id="expand-all"[^>]*title="Expand every container"/.test(html));
		assert.ok(/id="collapse-all"[^>]*aria-label="Collapse every container"/.test(html));
		assert.ok(/id="expand-all"[^>]*aria-label="Expand every container"/.test(html));
		assert.ok(html.includes('<span class="lbl">Collapse</span>'));
		assert.ok(html.includes('<span class="lbl">Expand</span>'));
		assert.ok(/id="collapse-all"[^>]*><svg[^>]*stroke-linejoin="round"/.test(html));
		assert.ok(/id="expand-all"[^>]*><svg[^>]*stroke-linejoin="round"/.test(html));
	});
});
