/**
 * The page-local row context menu: only containers and parameters open it, its two
 * actions post host messages, and confirmation/writes live in the provider. There is
 * no webview DOM in the test host, so the menu is asserted on the shell and the
 * serialized functions, with the browser probe covering the rendered geometry.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../../core/ecuc/scanner';
import { renderHtml } from '../../../webview/editorViewer';
import { fixtureText } from '../../core/modelTestUtils';
import { functionSource } from '../scriptTestUtils';

function page(): string {
	return renderHtml(scanEcucValues(fixtureText('editor/render.arxml')), { nonce: 'test-nonce' });
}

function styleOf(html: string): string {
	const match = /<style nonce="test-nonce">([\s\S]*?)<\/style>/.exec(html);
	return match ? match[1] : '';
}

suite('editor row context menu', () => {
	test('the shell has one menu with Duplicate and Delete items', () => {
		const html = page();
		assert.strictEqual((html.match(/id="row-menu"/g) ?? []).length, 1, 'exactly one menu');
		assert.ok(/id="row-menu"[^>]*role="menu"[^>]*hidden/.test(html), 'the menu starts hidden');
		assert.ok(/data-action="duplicate"[^>]*>Duplicate</.test(html));
		assert.ok(/data-action="delete"[^>]*>Delete</.test(html));
		assert.strictEqual((html.match(/role="menuitem"/g) ?? []).length, 2);
		assert.ok(html.includes('id="row-menu-style"'), 'per-open coordinates use a nonce stylesheet');
	});

	test('only container and parameter rows open the menu', () => {
		const handler = functionSource(page(), 'onTreeContextMenu');
		assert.ok(handler.includes('closest(\'#tree [role="treeitem"]\')'));
		assert.ok(handler.includes("kind !== 'container' && kind !== 'parameter'"));
		assert.ok(handler.indexOf('kind !==') < handler.indexOf('event.preventDefault()'), 'other kinds keep the native menu');
		assert.ok(handler.includes('showRowMenu(item, event.clientX, event.clientY)'));
	});

	test('opening selects the row and clamps the menu inside the viewport', () => {
		const script = functionSource(page(), 'showRowMenu');
		assert.ok(script.includes('selectItem(item)'), 'the right-clicked row becomes the selection');
		assert.ok(script.includes('menuNodeId = item.dataset.nodeId'));
		assert.ok(script.includes('rowMenu.getBoundingClientRect()'));
		assert.ok(script.includes('window.innerWidth - bounds.width - 8'));
		assert.ok(script.includes("rowMenuStyle.textContent = '#row-menu{left:'"));
		assert.ok(script.includes("querySelector('.row-menu-item')"), 'focus moves to the first action');
	});

	test('menu actions post one message and close', () => {
		const html = page();
		const body = functionSource(html, 'onTreeContextMenu');
		assert.ok(body.includes('showRowMenu'));
		const click = /rowMenu\.addEventListener\('click'[\s\S]*?\n\t\}\);/.exec(html);
		assert.ok(click, 'the click listener exists');
		assert.ok(click[0].includes("action === 'delete' || action === 'duplicate'"));
		assert.ok(click[0].includes('rowMenuHost.onAction(action, nodeId)'), 'the action is reported through the host callback');
		assert.ok(click[0].indexOf('hideRowMenu(true)') < click[0].indexOf('rowMenuHost.onAction'), 'the menu closes before the host asks');
	});

	test('Escape, outside pointerdown and scroll close the menu', () => {
		const html = page();
		const keys = functionSource(html, 'onRowMenuKeydown');
		assert.ok(keys.includes("event.key === 'Escape'"));
		assert.ok(keys.includes('hideRowMenu(true)'), 'Escape returns focus to the row');
		assert.ok(keys.includes("event.key !== 'ArrowDown' && event.key !== 'ArrowUp'"));
		assert.ok(keys.includes("event.key === 'ArrowDown' ? 1 : -1"));
		assert.ok(html.includes("rowMenu.addEventListener('keydown', onRowMenuKeydown)"));
		assert.ok(html.includes("closest('#row-menu')"));
		assert.ok(html.includes("window.addEventListener('scroll'"));
		assert.ok(html.includes("window.addEventListener('resize'"));
	});

	test('the menu uses theme tokens and no colour literal', () => {
		const html = page();
		const style = styleOf(html);
		const block = /\.row-menu \{[\s\S]*?\n\}/.exec(style);
		assert.ok(block);
		assert.ok(block[0].includes('position: fixed'));
		assert.ok(block[0].includes('var(--vscode-menu-background'));
		assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(block[0]), 'no colour literal');
		const item = /\.row-menu-item \{[\s\S]*?\n\}/.exec(style);
		assert.ok(item && item[0].includes('var(--vscode-menu-foreground'));
	});
});
