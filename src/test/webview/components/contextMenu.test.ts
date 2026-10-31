/**
 * The page-local row context menu: only containers and parameters open it, its
 * two actions reach the host callback, and the menu closes before the host asks
 * for confirmation. The geometry is real jsdom markup, not a serialized script.
 */
import * as assert from 'assert';

import { mountContextMenu, renderContextMenuHtml, renderContextMenuStyleTag } from '../../../webview/components/contextMenu/contextMenu';
import { webviewCss } from '../cssTestUtils';
import { installMarkup } from '../pageTestUtils';

function menuPage(): string {
	return `<body>
<div id="tree" class="document-tree" role="tree">
<div id="node-a" role="treeitem" data-kind="container" data-node-id="a" tabindex="-1"><span class="label">A</span></div>
<div id="node-b" role="treeitem" data-kind="module" data-node-id="b" tabindex="-1"><span class="label">B</span></div>
</div>
${renderContextMenuHtml()}
${renderContextMenuStyleTag('test-nonce')}
</body>`;
}

suite('editor row context menu', () => {
	test('the shell has one menu with Duplicate and Delete items', () => {
		const html = menuPage();
		assert.strictEqual((html.match(/id="row-menu"/g) ?? []).length, 1, 'exactly one menu');
		assert.ok(/id="row-menu"[^>]*role="menu"[^>]*hidden/.test(html), 'the menu starts hidden');
		assert.ok(/data-action="duplicate"[^>]*>Duplicate</.test(html));
		assert.ok(/data-action="delete"[^>]*>Delete</.test(html));
		assert.strictEqual((html.match(/role="menuitem"/g) ?? []).length, 2);
		assert.ok(html.includes('id="row-menu-style"'), 'per-open coordinates use a nonce stylesheet');
	});

	test('only container and parameter rows open the menu', () => {
		const dom = installMarkup(menuPage());
		try {
			const selected: string[] = [];
			mountContextMenu(dom.document.getElementById('tree'), {
				selectItem: (item: any) => selected.push(item.dataset.nodeId),
				rowElement: () => undefined,
				onAction: () => undefined,
			});
			const moduleRow = dom.document.getElementById('node-b');
			moduleRow.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
			assert.strictEqual(dom.document.getElementById('row-menu').hidden, true, 'a module keeps the native menu');
			const container = dom.document.getElementById('node-a');
			const event = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
			container.dispatchEvent(event);
			assert.strictEqual(event.defaultPrevented, true, 'the row menu replaces the native menu');
			assert.deepStrictEqual(selected, ['a'], 'the right-clicked row becomes the selection');
			assert.strictEqual(dom.document.getElementById('row-menu').hidden, false);
			assert.ok(/left:\d+px;top:\d+px/.test(dom.document.getElementById('row-menu-style').textContent));
		} finally {
			dom.restore();
		}
	});

	test('menu actions report once and close before the host asks', () => {
		const dom = installMarkup(menuPage());
		try {
			const actions: string[] = [];
			mountContextMenu(dom.document.getElementById('tree'), {
				selectItem: () => undefined,
				rowElement: () => undefined,
				onAction: (action: string, nodeId: string) => {
					assert.strictEqual(dom.document.getElementById('row-menu').hidden, true, 'closed first');
					actions.push(`${action}:${nodeId}`);
				},
			});
			dom.document.getElementById('node-a').dispatchEvent(
				new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true })
			);
			(dom.document.querySelector('[data-action="delete"]') as HTMLElement).click();
			assert.deepStrictEqual(actions, ['delete:a']);
		} finally {
			dom.restore();
		}
	});

	test('Escape closes the menu and returns focus to the row', () => {
		const dom = installMarkup(menuPage());
		try {
			let focused = 0;
			mountContextMenu(dom.document.getElementById('tree'), {
				selectItem: () => undefined,
				rowElement: () => ({ focus: () => focused++ }),
				onAction: () => undefined,
			});
			dom.document.getElementById('node-a').dispatchEvent(
				new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true })
			);
			dom.document.getElementById('row-menu').dispatchEvent(
				new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
			);
			assert.strictEqual(dom.document.getElementById('row-menu').hidden, true);
			assert.strictEqual(focused, 1, 'Escape returns focus to the row');
		} finally {
			dom.restore();
		}
	});

	test('the menu uses theme tokens and no colour literal', () => {
		const style = webviewCss('components', 'contextMenu', 'contextMenu.css');
		const block = /\.row-menu \{[\s\S]*?\n\}/.exec(style);
		assert.ok(block);
		assert.ok(block[0].includes('position: fixed'));
		assert.ok(block[0].includes('var(--vscode-menu-background'));
		assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(block[0]), 'no colour literal');
		const item = /\.row-menu-item \{[\s\S]*?\n\}/.exec(style);
		assert.ok(item && item[0].includes('var(--vscode-menu-foreground'));
	});
});
