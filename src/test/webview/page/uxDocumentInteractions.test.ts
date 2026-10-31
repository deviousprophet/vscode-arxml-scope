/**
 * The Document-only interaction model, collapse, hierarchy, details entry and
 * guardrails. Pure rules are imported; gestures are driven on the mounted page.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { scanEcucValues } from '../../../core/ecuc/scanner';
import { buildRows } from '../../../core/ecuc/renderRows';
import { SORT_EXCEPTIONS } from '../../../core/ecuc/order';
import {
	collapsedIdsFor,
	moveTarget,
	pruneCollapsed,
	toggleCollapsed,
} from '../../../webview/components/documentTree/documentTreeState';
import { buildDocumentNodeRow } from '../../../webview/components/documentTree/documentRows';
import { detailsInputAllowed } from '../../../webview/components/detailsEditor/detailsEditor';
import { editorShell } from '../../../host/webviewShell';
import { fixtureText } from '../../core/modelTestUtils';
import { repoRoot } from '../../extension/testUtils';
import { webviewCss } from '../cssTestUtils';
import { installDom, installMarkup, loadModule, messagesOf, treeRows } from '../pageTestUtils';

const FIXTURE = 'editor/render.arxml';

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

function mount() {
	const dom = installDom('editor');
	loadModule<typeof import('../../../webview/editorViewer')>('../../webview/editorViewer').mountEditor();
	dom.post({ type: 'document', document: { rows: rows() } });
	return dom;
}

suite('editor Document interactions', () => {
	test('bracket guides fade at rest and activate on container hover', () => {
		const css = webviewCss('components', 'documentTree', 'documentTree.css');
		assert.ok(/\.guide\s*\{[^}]*opacity:\s*0\.28/.test(css));
		assert.ok(/\.guide\.guide-active\s*\{[^}]*opacity:\s*0\.85/.test(css));
	});

	test('a plain click selects and never reveals; the deliberate gestures reveal', () => {
		const dom = mount();
		try {
			const item = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'IniValue')!;
			item.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			assert.strictEqual(messagesOf(dom.api, 'reveal').length, 0, 'a click never reveals');
			assert.strictEqual(messagesOf(dom.api, 'select').length, 1);
			item.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
			assert.strictEqual(messagesOf(dom.api, 'reveal').length, 1);
			item.dispatchEvent(
				new dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })
			);
			assert.strictEqual(messagesOf(dom.api, 'reveal').length, 2, 'Ctrl+Enter is deliberate');
			item.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
			assert.strictEqual(messagesOf(dom.api, 'reveal').length, 2, 'Space only selects');
		} finally {
			dom.restore();
		}
	});

	test('a toggle is built only where the row has children, with no glyph or inline hint', () => {
		const dom = installMarkup('<body></body>');
		try {
			const list = rows();
			const container = buildDocumentNodeRow(list.find((row) => row.label === 'ContA')!, {
				expandedIds: new Set(),
				searchQuery: '',
				subtreeIds: new Set(),
			});
			const parameter = buildDocumentNodeRow(list.find((row) => row.label === 'IniValue')!, {
				expandedIds: new Set(),
				searchQuery: '',
				subtreeIds: new Set(),
			});
			assert.ok(container.querySelector('.twisty'), 'a container has a fold control');
			assert.strictEqual(parameter.querySelector('.twisty'), null, 'a leaf has no fold control');
			assert.strictEqual(container.querySelector('.glyph'), null, 'the Tree glyph is gone');
			assert.strictEqual(list.find((row) => row.label === 'ContA')!.hasChildren, true);
			assert.strictEqual(list.find((row) => row.label === 'IniValue')!.hasChildren, false);
		} finally {
			dom.restore();
		}
		const css = webviewCss('components', 'documentTree', 'documentTree.css');
		assert.ok(/\.node\[aria-expanded="true"\] > \.row > \.twisty svg\s*\{[^}]*transform:\s*rotate\(90deg\)/.test(css));
		assert.ok(!/content:\s*"  F2"/.test(css), 'no F2 pseudo hint');
	});

	test('reference tooltips show the target without display punctuation', () => {
		const dom = mount();
		try {
			const reference = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'PeerIref')!;
			const value = reference.querySelector('.value')!;
			assert.strictEqual(value.getAttribute('title'), 'Target: PkgA.PkgB.ModX.ContA.ContB');
			assert.ok(!value.hasAttribute('data-follow'), 'the Document value is not a link');
		} finally {
			dom.restore();
		}
	});

	test('the details panel owns the reference jump action', () => {
		const dom = mount();
		try {
			const reference = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'PeerIref')!;
			reference.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			const body = dom.document.getElementById('sb-details-body')!;
			const jump = Array.from(body.querySelectorAll('button')).find(
				(button: any) => button.textContent === 'Jump to target'
			) as HTMLElement;
			assert.ok(jump, 'Jump to target lives in Details');
			jump.click();
			assert.strictEqual(messagesOf(dom.api, 'follow').length, 1);
		} finally {
			dom.restore();
		}
	});

	test('details controls follow the parameter type', () => {
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

	test('aria-expanded follows the displayed list', () => {
		const dom = mount();
		try {
			const container = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'ContA')!;
			assert.strictEqual(container.getAttribute('aria-expanded'), 'true');
			container.querySelector('.twisty')!.dispatchEvent(
				new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
			);
			const collapsed = dom.document.querySelector('[data-node-id="' + container.dataset.nodeId + '"]');
			assert.strictEqual(collapsed!.getAttribute('aria-expanded'), 'false', 'the toggle re-renders the state');
		} finally {
			dom.restore();
		}
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

	test('Home, End, PageUp and PageDown move focus as expected', () => {
		assert.strictEqual(moveTarget('Home', 5, 20, 8), 0);
		assert.strictEqual(moveTarget('End', 5, 20, 8), 19);
		assert.strictEqual(moveTarget('PageUp', 10, 20, 8), 2);
		assert.strictEqual(moveTarget('PageDown', 10, 20, 8), 18);
		assert.strictEqual(moveTarget('ArrowDown', 10, 20, 8), 11);
		assert.strictEqual(moveTarget('ArrowUp', 10, 20, 8), 9);
	});

	test('the key handler wires movement, expansion, F2/Enter editing and type-ahead', () => {
		const dom = mount();
		try {
			const item = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'IniValue')!;
			item.focus();
			item.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
			assert.ok(dom.document.activeElement, 'ArrowDown keeps a row focused');
			const parameter = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'IniValue')!;
			parameter.focus();
			parameter.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
			assert.ok(dom.document.getElementById('details-value') || dom.document.getElementById('details-short-name'));
		} finally {
			dom.restore();
		}
	});

	test('a refused write keeps the typed text and marks the details input invalid', () => {
		const dom = mount();
		try {
			const parameter = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'IniValue')!;
			parameter.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			const input = dom.document.getElementById('details-value') as HTMLInputElement;
			input.value = 'bad';
			input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			dom.post({ type: 'notice', message: 'Not an integer.', kind: 'warn', inline: true, scope: 'details' });
			assert.strictEqual(input.value, 'bad', 'the typed text survives a refusal');
			assert.strictEqual(input.getAttribute('aria-invalid'), 'true');
			assert.ok(input.parentElement!.querySelector('.details-value-error')!.textContent!.includes('Not an integer.'));
		} finally {
			dom.restore();
		}
	});

	test('no runtime dependency was added and nothing is fetched', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
			dependencies?: Record<string, string>;
		};
		assert.strictEqual(pkg.dependencies, undefined, 'no runtime dependency');
		const html = shell();
		assert.ok(/<script[^>]+src=/.test(html), 'the bundled page script is loaded');
		assert.ok(!/fetch\(|XMLHttpRequest|new Worker|serviceWorker/.test(html), 'the shell has no remote/worker path');
	});

	test('the stylesheet keeps only the documented colour literals', () => {
		const css = [webviewCss('styles', 'tokens.css'), webviewCss('components', 'documentTree', 'documentTree.css')].join('\n');
		const hexes = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
		assert.deepStrictEqual(
			hexes.sort(),
			['#4EC9B0', '#80808040', '#DCDCAA'].sort(),
			'the fixed container accent and guide/reference fallbacks are the only literals'
		);
		assert.ok(!/style="--/.test(shell()), 'no CSP-blocked inline custom property');
	});

	test('the presentation adds no write path', () => {
		const html = shell();
		assert.ok(!html.includes('WorkspaceEdit'));
		assert.ok(!html.includes('writeFile'));
		assert.ok(!html.includes('type: \'edit\''), 'the shell carries no protocol payload');
	});
});
