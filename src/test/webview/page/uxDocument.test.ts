/**
 * The Document-only quiet-source surface: one editor view, the sidebar shell,
 * the tokens and the row data. The bundled page is exercised in
 * `render.test.ts`; this suite pins the stylesheet and data contracts.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../../core/ecuc/scanner';
import { buildRows } from '../../../core/ecuc/renderRows';
import { SORT_EXCEPTIONS } from '../../../core/ecuc/order';
import { flattenRows } from '../../../webview/render/treeQuery';
import { buildDocumentNodeRow } from '../../../webview/components/documentTree/documentRows';
import { conditionTokens } from '../../../webview/render/rowView';
import { refusalShownInDetails } from '../../../webview/components/sidebar/detailsPanel/detailsPanel';
import { loadUiState } from '../../../webview/components/sidebar/sidebar';
import { editorShell } from '../../../host/webviewShell';
import { fixtureText } from '../../core/modelTestUtils';
import { webviewCss } from '../cssTestUtils';
import { installMarkup } from '../pageTestUtils';

const FIXTURE = 'editor/render.arxml';

function style(): string {
	return [
		webviewCss('styles', 'tokens.css'),
		webviewCss('styles', 'base.css'),
		webviewCss('components', 'documentTree', 'documentTree.css'),
		webviewCss('components', 'toolbar', 'toolbar.css'),
		webviewCss('components', 'sidebar', 'sidebar.css'),
	].join('\n');
}

function shell(): string {
	return editorShell({
		cspSource: 'https://webview.test',
		scriptUri: 'https://webview.test/editorViewer.js',
		styleUri: 'https://webview.test/editorViewer.css',
		nonce: 'test-nonce',
	});
}

function rows() {
	return buildRows(scanEcucValues(fixtureText(FIXTURE)), { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows;
}

suite('editor document view', () => {
	test('Document is the only view; the sidebar shell and details exist', () => {
		const html = shell();
		assert.ok(html.includes('<body data-view="document">'));
		assert.ok(!html.includes('id="view-toggle"'), 'the Tree view toggle is gone');
		assert.ok(!html.includes('view-document') && !html.includes('view-tree'), 'no view switch labels');
		assert.ok(html.includes('<div id="sidebar-resizer" role="separator"'), 'the sidebar is resizable');
		assert.ok(html.includes('<aside id="sidebar" aria-label="ECUC sidebar">'));
		assert.ok(html.includes('id="side-tabs"'));
		assert.ok(html.includes('id="stab-details"'));
		assert.ok(html.includes('id="stab-conditions"'));
		assert.ok(!html.includes('id="details-toggle"'), 'the details toggle is replaced by the tab strip');
		assert.ok(!html.includes('id="conditions-toggle"'), 'the conditions toolbar toggle is gone');
		assert.ok(html.includes('<div id="inspector" class="inspector sb-pane-view" role="region" aria-label="Node details">'));
		assert.ok(html.includes('id="sb-details-body"'), 'the Details tab has one section body');
		assert.ok(!/class="sb-pane-sash"/.test(html), 'there are no pane sashes in the sidebar');
		assert.ok(html.includes('Select a line to see its details.'));
		assert.ok(html.includes('Click a line or press Space.'));
		assert.ok(!html.includes('id="notice"'), 'there is no notice banner under Search');
		assert.ok(!html.includes('data-line='), 'no source-line display data');
		assert.ok(!html.includes('class="glyph"'), 'no Tree glyph column');
		assert.ok(!html.includes('class="view-switch"'), 'no Tree view CSS');
	});

	test('the document CSS is one editor surface with the quiet-source tokens', () => {
		const css = style();
		assert.ok(/body\[data-view\]\s*\{[^}]*--ecuc-fs:\s*var\(--vscode-editor-font-size, 13px\)/.test(css));
		assert.ok(/body\[data-view\]\s*\{[^}]*--ecuc-lh:\s*calc\(var\(--ecuc-fs\) \* 1\.55\)/.test(css));
		assert.ok(/--tok-keyword:\s*var\(--vscode-debugTokenExpression-boolean/.test(css));
		assert.ok(/--tok-string:\s*var\(--vscode-debugTokenExpression-string/.test(css));
		assert.ok(/--tok-number:\s*var\(--vscode-debugTokenExpression-number/.test(css));
		assert.ok(/--tok-meta:\s*var\(--vscode-debugTokenExpression-name/.test(css));
		assert.ok(/--tok-comment:\s*color-mix/.test(css));
		assert.ok(/--tok-key:\s*var\(--vscode-symbolIcon-variableForeground/.test(css));
		assert.ok(/--tok-punct:\s*color-mix/.test(css));
		assert.ok(/--tok-dim:\s*color-mix/.test(css));
		assert.ok(/--hover-bg:\s*var\(--vscode-list-hoverBackground/.test(css));
		assert.ok(/--sel-bg:\s*color-mix\([^;]*--vscode-list-inactiveSelectionBackground/.test(css));
		assert.ok(/--sel-bg-focus:\s*color-mix\([^;]*--vscode-list-activeSelectionBackground/.test(css));
		assert.ok(/--rail:\s*var\(--vscode-focusBorder/.test(css));

		assert.ok(/.document-tree-scroll\s*{[^}]*position:\s*relative/.test(css));
		assert.ok(/.document-tree-scroll\s*{[^}]*font-family:\s*var\(--vscode-editor-font-family/.test(css));
		assert.ok(/.document-tree-scroll\s*{[^}]*font-size:\s*var\(--ecuc-fs\)/.test(css));
		assert.ok(/.document-tree-scroll\s*{[^}]*line-height:\s*var\(--ecuc-lh\)/.test(css));
		assert.ok(/.document-tree-scroll\s*{[^}]*white-space:\s*pre/.test(css));
		assert.ok(/\.row\s*\{[^}]*display:\s*flex/.test(css));
		assert.ok(/\.row\s*\{[^}]*gap:\s*1ch/.test(css));
		assert.ok(/\.row\s*\{[^}]*padding:\s*0 0 0 var\(--content-pad\)/.test(css));
		assert.ok(/body\[data-view\]\s*\{[^}]*--doc-pad:\s*3ch/.test(css));
		assert.ok(/body\[data-view\]\s*\{[^}]*--indent:\s*4ch/.test(css));
		assert.ok(/body\[data-view\]\s*\{[^}]*--fold-gutter:\s*26px/.test(css));
		assert.ok(
			/body\[data-view\]\s*\{[^}]*--content-pad:\s*calc\(var\(--fold-gutter\) \+ var\(--doc-pad\)\)/.test(css)
		);
		assert.ok(
			/body\[data-view="document"\] \.row\[data-level="3"\]\s*\{[^}]*padding-left:\s*calc\(var\(--content-pad\) \+ var\(--indent\) \* 2\)/.test(
				css
			)
		);
		assert.ok(!/--ln-w|--ln-digits|--gut/.test(css), 'no line-number/gutter variables');
		assert.ok(/\.guide\s*\{[^}]*opacity:\s*0\.28/.test(css), 'bracket guides start faded');
		assert.ok(/\.guide\.guide-active\s*\{[^}]*opacity:\s*0\.85/.test(css), 'hover makes the guide clearer');
		assert.ok(
			/body\[data-view="document"\] \.guide\[data-level="3"\]\s*\{[^}]*left:\s*calc\(var\(--content-pad\) \+ var\(--indent\) \* 2 \+ 0\.5ch\)/.test(
				css
			)
		);
		assert.ok(/@media \(max-width: 720px\)[\s\S]*?--doc-pad:\s*2\.5ch/.test(css));
		assert.ok(/body\[data-view="document"\] \.comment\[data-gap="true"\]\s*\{[^}]*height:\s*calc\(var\(--ecuc-lh\) \* 2\)/.test(css));
		assert.ok(/body\[data-view="document"\] \.row\.k-module \.label::before\s*\{[^}]*content:\s*"module /.test(css));
		assert.ok(!/body\[data-view="tree"\]/.test(css), 'no Tree scoped CSS');
	});

	test('rows carry no display-only source positions or line-number width', () => {
		for (const row of rows()) {
			for (const key of ['sourceLine', 'line', 'column', 'endLine', 'endColumn']) {
				assert.ok(!(key in row), `no ${key}`);
			}
		}
	});

	test('document labels and reference values use the dark semantic accents', () => {
		const css = style();
		assert.ok(/body\[data-view="document"\] \.label\s*\{[^}]*color:\s*var\(--vscode-editor-foreground\)/.test(css));
		assert.ok(/--container-accent:\s*#4EC9B0/.test(css), 'the dark container accent is fixed green');
		assert.ok(
			/body\[data-view="document"\] \.node\[data-kind="container"\] > \.row > \.label\s*\{[^}]*color:\s*var\(--container-accent\)/.test(
				css
			)
		);
		assert.ok(
			/body\[data-view="document"\] \.node\[data-kind="reference"\] > \.row > \.value \.value-text\s*\{[^}]*--vscode-symbolIcon-functionForeground[^}]*font-style:\s*italic/.test(
				css
			)
		);
		assert.ok(/body\[data-view="document"\] \.node\[data-kind="parameter"\] > \.row > \.label,[\s\S]*?--tok-key/.test(css));
		assert.ok(/body\[data-view="document"\] \.document-tree-meta \.keyword\s*\{[^}]*--tok-keyword/.test(css));
		assert.ok(!/body\[data-view="document"\] \.hex\s*\{/.test(css), 'the Document has no hex meta style');
		assert.ok(!/body\[data-view="document"\] \.target\s*\{/.test(css), 'reference targets have no Document link style');
	});

	test('quiet selection, focus rail and read-only values', () => {
		const css = style();
		assert.ok(/body\[data-view="document"\] \.node\[data-selected="true"\] > \.row\s*\{[^}]*background-color:\s*var\(--sel-bg-focus\)/.test(css));
		assert.ok(/body\[data-view="document"\] \.node\[data-selected="true"\] > \.row\s*\{[^}]*box-shadow:\s*inset 2px 0 0 var\(--rail\)/.test(css));
		assert.ok(
			/body\[data-view="document"\] .document-tree:focus-within \.node\[data-selected="true"\] > \.row\s*\{[^}]*background-color:\s*var\(--sel-bg-focus\)/.test(
				css
			)
		);
		assert.ok(/body\[data-view="document"\] \.node:focus-visible > \.row\s*\{[^}]*box-shadow:\s*inset 2px 0 0 var\(--rail\)/.test(css));
		assert.ok(!css.includes('--ecuc-selection-fg'), 'selection never recolours syntax');
		assert.ok(!css.includes('.value-edit'), 'no inline document editor');
		assert.ok(/--sel-container-bg: color-mix\([^;]*45%/.test(css));
		assert.ok(
			/body\[data-view="document"\] \.node\[data-kind="parameter"\]\[data-selected="true"\] > \.row\s*\{[^}]*background-color:\s*var\(--sel-bg-focus\)[^}]*--sel-outline/.test(
				css
			)
		);
	});

	test('the strip is compact and keeps Collapse/Expand with opposite glyphs', () => {
		const html = shell();
		const css = style();
		assert.ok(/\.toolbar\s*\{[^}]*height:\s*26px/.test(css));
		assert.ok(/\.toolbar\s*\{[^}]*padding:\s*0 8px/.test(css));
		assert.ok(/\.toolbar\s*\{[^}]*flex-wrap:\s*nowrap/.test(css));
		assert.ok(/\.tool\s*\{[^}]*background:\s*transparent[^}]*border:\s*0/.test(css));
		assert.ok(!css.includes('.view-switch'), 'no view switch');
		assert.ok(/id="collapse-all"[^>]*aria-label="Collapse every container"/.test(html));
		assert.ok(/id="expand-all"[^>]*aria-label="Expand every container"/.test(html));
		assert.ok(/\.icon-tool\s*\{[^}]*min-width:\s*28px/.test(css));
		assert.ok(/\.twisty\s*\{[^}]*opacity:\s*0;/.test(css), 'expanded folds start hidden');
		assert.ok(/\.twisty\s*\{[^}]*left:\s*2px/.test(css), 'the chevron is inset into the gutter');
		assert.ok(
			/body\[data-view="document"\] \.node\[aria-expanded="false"\] > \.row > \.twisty\s*\{[^}]*opacity:\s*1/.test(css),
			'collapsed folds stay visible'
		);
		assert.ok(
			/body\[data-view="document"\] \.node\[data-kind="container"\]\[data-empty="true"\] > \.row::after\s*\{[^}]*content:\s*" \{ \}"/.test(
				css
			),
			'an empty container is marked at rest'
		);
		assert.ok(/\.guide\.guide-active\s*\{[^}]*opacity:\s*0\.85/.test(css));
		const collapse = html.match(/id="collapse-all"[\s\S]*?<\/svg>/)?.[0] ?? '';
		const expand = html.match(/id="expand-all"[\s\S]*?<\/svg>/)?.[0] ?? '';
		assert.ok(collapse.includes('M4 2.25l4 4 4-4'), 'Collapse points inward');
		assert.ok(expand.includes('M4 6.25 8 2.25l4 4'), 'Expand points outward');
	});

	test('the document keeps every parent §6 field and the direct .value', () => {
		const list = rows();
		const contA = list.find((row) => row.label === 'ContA')!;
		assert.ok(contA.meta.some((part) => part.cls === 'short' && part.text === '"ContA"'));
		const module = list.find((row) => row.kind === 'module')!;
		assert.ok(module.meta.some((part) => part.cls === 'variant'));
		assert.ok(module.meta.some((part) => part.cls === 'condition'));
		assert.ok(module.meta.some((part) => part.cls === 'annotation'));
		const ini = list.find((row) => row.label === 'IniValue')!;
		assert.ok(!ini.meta.some((part) => part.text.indexOf('(= 0x') === 0), 'no hex meta in the Document');
		assert.strictEqual(ini.parameterType, 'Integer');
		const peer = list.find((row) => row.label === 'PeerIref')!;
		assert.ok(peer.meta.some((part) => part.cls === 'context'));

		const dom = installMarkup('<body></body>');
		try {
			const node = buildDocumentNodeRow(ini, {
				expandedIds: new Set(),
				searchQuery: '',
				subtreeIds: new Set(),
			});
			assert.strictEqual(node.querySelector('.row > .label')?.textContent, 'IniValue');
			assert.ok(node.querySelector('.row > .value > .value-text'), 'the value stays a direct row child');
		} finally {
			dom.restore();
		}
	});

	test('the value separator is muted punctuation and stays out of the value token', () => {
		const dom = installMarkup('<body></body>');
		try {
			const node = buildDocumentNodeRow(rows().find((row) => row.label === 'IniValue')!, {
				expandedIds: new Set(),
				searchQuery: '',
				subtreeIds: new Set(),
			});
			const punct = node.querySelector('.value > .punct')!;
			assert.strictEqual(punct.textContent, '=');
			assert.strictEqual(node.querySelector('.value > .value-text')!.textContent, '63');
			assert.ok(!node.querySelector('.value-text')!.textContent!.includes('='));
		} finally {
			dom.restore();
		}
		const tokens = conditionTokens('A == 1 && B != "x"');
		assert.strictEqual(tokens.map((token) => 'A == 1 && B != "x"'.slice(token.start, token.end)).join(''), 'A == 1 && B != "x"');
		assert.ok(tokens.some((token) => token.cls === 'syscond-name'));
		assert.ok(tokens.some((token) => token.cls === 'syscond-number'));
		assert.ok(tokens.some((token) => token.cls === 'syscond-string'));
		assert.ok(tokens.some((token) => token.cls === 'syscond-operator'));
	});

	test('annotations render above their node and the sidebar width is specified', () => {
		const display = flattenRows(
			[
				{ id: 'm', parentId: null, level: 1, subtreeSize: 1, hasChildren: true, haystack: 'm', comments: ['[Note] above'] },
				{ id: 'p', parentId: 'm', level: 2, subtreeSize: 0, hasChildren: false, haystack: 'p' },
			],
			{ braces: true }
		);
		assert.deepStrictEqual(display.map((row) => row.type).slice(0, 2), ['comment', 'node']);
		const css = webviewCss('components', 'sidebar', 'sidebar.css');
		assert.ok(/--sidebar-w/.test(css));
		assert.ok(/@media \(max-width: 720px\)/.test(css));
	});

	test('a field refusal is left to the details panel', () => {
		assert.strictEqual(refusalShownInDetails({ inline: true }, false), true);
		assert.strictEqual(refusalShownInDetails({ inline: true }, true), false);
		assert.strictEqual(refusalShownInDetails({}, false), false);
	});

	test('the layout state defaults and persistence path are present', () => {
		assert.deepStrictEqual(loadUiState(undefined), {
			tab: 'details',
			sidebarWidth: 360,
			panes: {},
			collapsed: [],
		});
		assert.deepStrictEqual(loadUiState({ inspectorHidden: true }), {
			tab: 'details',
			sidebarWidth: 360,
			panes: {},
			collapsed: [],
		});
	});
});
