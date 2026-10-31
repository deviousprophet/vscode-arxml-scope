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
} from '../../../webview/components/toolbar/toolbar';
import { installMarkup } from '../pageTestUtils';

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

	test('mount is idempotent and reports one action per click', () => {
		const dom = installMarkup(`<body>${renderEditorToolbarHtml('<div class="search-box"></div>')}</body>`);
		try {
			let collapsed = 0;
			let expanded = 0;
			const toolbar = new EditorToolbar({ onCollapseAll: () => collapsed++, onExpandAll: () => expanded++ });
			toolbar.mount();
			toolbar.mount();
			dom.document.getElementById('collapse-all').click();
			dom.document.getElementById('expand-all').click();
			assert.strictEqual(collapsed, 1);
			assert.strictEqual(expanded, 1);
		} finally {
			dom.restore();
		}
		assert.strictEqual(new DiffToolbar().mounted, false);
	});

	test('the diff toolbar reports view, navigation and swap, and paints pressed state', () => {
		const dom = installMarkup(`<body>${renderDiffToolbarHtml('<div class="search-box"></div>')}</body>`);
		try {
			const calls: string[] = [];
			const toolbar = new DiffToolbar({
				onViewAll: () => calls.push('all'),
				onViewDiff: () => calls.push('diff'),
				onPrev: () => calls.push('prev'),
				onNext: () => calls.push('next'),
				onSwap: () => calls.push('swap'),
			});
			toolbar.mount();
			dom.document.getElementById('diff-view-all').click();
			dom.document.getElementById('diff-view-diff').click();
			dom.document.getElementById('diff-prev').click();
			dom.document.getElementById('diff-next').click();
			dom.document.getElementById('diff-swap').click();
			assert.deepStrictEqual(calls, ['all', 'diff', 'prev', 'next', 'swap']);
			toolbar.setViewMode(true);
			assert.strictEqual(dom.document.getElementById('diff-view-diff').getAttribute('aria-pressed'), 'true');
			toolbar.setSwapped(true);
			assert.strictEqual(dom.document.getElementById('diff-swap').getAttribute('aria-pressed'), 'true');
		} finally {
			dom.restore();
		}
	});
});
