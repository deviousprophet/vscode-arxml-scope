/**
 * The details panel, the Document surface and the state/toggle wiring after the
 * Document-only UI polish. DOM behavior lives in the editor page suite; this
 * suite pins the projection and the stylesheet.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { scanEcucValues } from '../../../core/ecuc/scanner';
import { buildRows } from '../../../core/ecuc/renderRows';
import { SORT_EXCEPTIONS } from '../../../core/ecuc/order';
import { inspectorFields } from '../../../webview/components/sidebar/detailsPanel/detailsPanel';
import { editorShell } from '../../../host/webviewShell';
import { fixtureText } from '../../core/modelTestUtils';
import { repoRoot } from '../../extension/testUtils';
import { webviewCss } from '../cssTestUtils';

const FIXTURE = 'editor/render.arxml';

function html(): string {
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

function style(): string {
	return [
		webviewCss('styles', 'tokens.css'),
		webviewCss('styles', 'base.css'),
		webviewCss('components', 'documentTree', 'documentTree.css'),
		webviewCss('components', 'sidebar', 'sidebar.css'),
	].join('\n');
}

suite('editor visual polish', () => {
	test('the details inspector is outside the virtual tree region and has no view toggle', () => {
		const shell = html();
		assert.ok(shell.includes('<div id="inspector" class="inspector sb-pane-view" role="region" aria-label="Node details">'));
		assert.ok(shell.includes('id="side-tabs"'));
		assert.ok(!shell.includes('id="details-toggle"'), 'the details toggle is replaced by the tab strip');
		assert.ok(!shell.includes('id="view-toggle"'));
		assert.ok(shell.includes('Select a line to see its details.'));
		assert.ok(shell.includes('id="tree" class="document-tree"'), 'the tree region is the shared component');
		assert.ok(!shell.includes('class="document-tree-window"'), 'the window is created at runtime');
		const mainAt = shell.indexOf('<div id="main">');
		const resizerAt = shell.indexOf('<div id="sidebar-resizer"');
		assert.ok(mainAt >= 0 && resizerAt > mainAt, 'the sidebar follows the scroll container');
		assert.ok(!shell.slice(mainAt, resizerAt).includes('id="inspector"'), 'the details panel survives a re-scan');
	});

	test('every row carries the definition path, short name and value the panel needs', () => {
		const list = rows();
		const contA = list.find((row) => row.definitionRef === '/PkgA/PkgB/ModDefs/ModX/ContA')!;
		assert.strictEqual(contA.shortName, 'ContA');
		const ini = list.find((row) => row.label === 'IniValue')!;
		assert.strictEqual(ini.value, '63');
		const peer = list.find((row) => row.label === 'PeerRef')!;
		assert.strictEqual(peer.target, '/PkgA/PkgB/ModX/ContA/ContB');
	});

	test('the inspector reads row data and edits in details', () => {
		const list = rows();
		const parameter = list.find((row) => row.label === 'IniValue')!;
		const fields = inspectorFields(parameter);
		assert.strictEqual(fields.definitionRef, '/PkgA/PkgB/ModDefs/ModX/ContA/IniValue');
		assert.strictEqual(fields.value, '63');
		assert.strictEqual(fields.type, 'Integer');
		assert.deepStrictEqual(fields.formats, [
			{ label: 'Decimal', value: '63' },
			{ label: 'Hexadecimal', value: '0x3F' },
			{ label: 'Binary', value: '0b00111111' },
		]);
		assert.strictEqual(inspectorFields(list.find((row) => row.label === 'Title')!).type, 'String');
		const reference = list.find((row) => row.label === 'PeerIref')!;
		assert.deepStrictEqual(reference.contextPaths, ['PkgA.PkgB.ModX.ContA']);
		assert.strictEqual(inspectorFields(reference).context, 'PkgA.PkgB.ModX.ContA');
	});

	test('rows are flat flex rows and .value stays a direct child of .row', () => {
		const css = style();
		assert.ok(/\.row\s*\{[^}]*display:\s*flex/.test(css));
		assert.ok(!css.includes('grid-template-columns'), 'the Tree grid is removed');
		assert.ok(/\.label\s*\{[^}]*text-overflow:\s*ellipsis/.test(css));
		assert.ok(/\.value\s*\{[^}]*text-overflow:\s*ellipsis/.test(css));
	});

	test('selection uses a quiet tint and keeps token colours', () => {
		const css = style();
		assert.ok(/--sel-bg:\s*color-mix\([^;]*--vscode-list-inactiveSelectionBackground/.test(css));
		assert.ok(/--sel-bg-focus:\s*color-mix\([^;]*--vscode-list-activeSelectionBackground/.test(css));
		assert.ok(/\.node\[data-selected="true"\] > \.row\s*\{[^}]*background-color:\s*var\(--sel-bg-focus\)/.test(css));
		assert.ok(
			/\.document-tree:focus-within \.node\[data-selected="true"\] > \.row\s*\{[^}]*background-color:\s*var\(--sel-bg-focus\)/.test(
				css
			)
		);
		assert.ok(!css.includes('--ecuc-selection-fg'), 'selection never recolours syntax');
	});

	test('fonts have usable fallbacks and no colour literal was introduced', () => {
		const css = style();
		assert.ok(css.includes('font-family: var(--vscode-font-family,'));
		assert.ok(css.includes('font-family: var(--vscode-editor-font-family,'));
		const hexes = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
		assert.deepStrictEqual(
			hexes.sort(),
			['#4EC9B0', '#80808040', '#DCDCAA'].sort(),
			'the semantic guide/colour fallbacks are the only literals'
		);
		const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
			dependencies?: Record<string, string>;
		};
		assert.strictEqual(pkg.dependencies, undefined, 'no runtime dependency');
	});
});
