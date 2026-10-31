/**
 * Toolbar component: the editor and diff strips own their markup, order,
 * accessible names and the button wiring. The actions arrive as callbacks.
 */
import * as assert from 'assert';

import {
	DiffToolbar,
	EditorToolbar,
	renderDiffToolbarHtml,
	renderEditorToolbarHtml,
	toolbarScript,
} from '../../../webview/components/toolbar/toolbar';

suite('Toolbar component', () => {
	test('the editor strip is grow, Collapse, Expand, then the Search slot', () => {
		const html = renderEditorToolbarHtml('<div class="search-box"></div>');
		assert.ok(html.startsWith('<div class="toolbar">'));
		assert.ok(html.indexOf('class="grow"') < html.indexOf('id="collapse-all"'));
		assert.ok(html.indexOf('id="collapse-all"') < html.indexOf('id="expand-all"'));
		assert.ok(html.indexOf('id="expand-all"') < html.indexOf('class="search-box"'));
		assert.ok(/id="collapse-all"[^>]*class="[^"]*sb-btn sb-btn-secondary/.test(html));
		assert.ok(/id="collapse-all"[^>]*aria-label="Collapse every container"/.test(html));
		assert.ok(/id="expand-all"[^>]*aria-label="Expand every container"/.test(html));
		assert.ok(html.includes('<span class="lbl">Collapse</span>'));
		assert.ok(html.includes('<span class="lbl">Expand</span>'));
		assert.ok(!/style="/.test(html), 'no inline styles');
	});

	test('the diff strip is left view/nav, centre Swap, right Search', () => {
		const html = renderDiffToolbarHtml('<div class="search-box"></div>');
		assert.ok(html.indexOf('class="toolbar-left"') < html.indexOf('class="toolbar-center"'));
		assert.ok(html.indexOf('class="toolbar-center"') < html.indexOf('class="toolbar-right"'));
		const left = html.slice(html.indexOf('class="toolbar-left"'), html.indexOf('class="toolbar-center"'));
		assert.ok(left.indexOf('id="diff-view-all"') < left.indexOf('id="diff-view-diff"'));
		assert.ok(left.indexOf('id="diff-view-diff"') < left.indexOf('id="diff-prev"'));
		assert.ok(left.indexOf('id="diff-prev"') < left.indexOf('id="diff-next"'));
		assert.ok(/id="diff-swap"[^>]*aria-label="Swap sides"/.test(html));
		assert.ok(/id="diff-swap"[^>]*aria-pressed="false"/.test(html));
	});

	test('the serialized classes own their mount and pressed-state setters', () => {
		const script = toolbarScript();
		assert.ok(script.includes('const EditorToolbar = ('));
		assert.ok(script.includes('const DiffToolbar = ('));
		for (const name of ['mount()', 'setViewMode(changesOnly)', 'setSwapped(swapped)']) {
			assert.ok(script.includes(name), `${name} is part of the contract`);
		}
		assert.ok(!script.includes('vscode'), 'the component never posts provider messages');
		assert.ok(!script.includes('rowById'), 'the component never reads host row data');
	});

	test('mount reports clicks without owning the actions', () => {
		const savedDocument = (globalThis as unknown as { document?: unknown }).document;
		const savedAdd = (globalThis as unknown as { addEventListener?: unknown }).addEventListener;
		const handlers: Record<string, () => void> = {};
		const button = (id: string) => ({
			addEventListener(_type: string, handler: () => void) {
				handlers[id] = handler;
			},
		});
		(globalThis as unknown as { document: unknown }).document = {
			getElementById: (id: string) => button(id),
		};
		try {
			let collapsed = 0;
			const toolbar = new EditorToolbar({ onCollapseAll: () => collapsed++ });
			toolbar.mount();
			toolbar.mount();
			handlers['collapse-all']();
			assert.strictEqual(collapsed, 1, 'mount is idempotent and reports once');
		} finally {
			(globalThis as unknown as { document?: unknown }).document = savedDocument;
			(globalThis as unknown as { addEventListener?: unknown }).addEventListener = savedAdd;
		}
		const diff = new DiffToolbar();
		assert.strictEqual(diff.mounted, false);
	});
});
