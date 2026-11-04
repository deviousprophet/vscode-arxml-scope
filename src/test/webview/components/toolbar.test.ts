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

	test('the diff strip is left view/mode, centre navigation, right status + Search', () => {
		const html = renderDiffToolbarHtml('<div class="search-box"></div>');
		assert.ok(html.indexOf('class="toolbar-left"') < html.indexOf('class="toolbar-center"'));
		assert.ok(html.indexOf('class="toolbar-center"') < html.indexOf('class="toolbar-right"'));
		const left = html.slice(html.indexOf('class="toolbar-left"'), html.indexOf('class="toolbar-center"'));
		assert.ok(left.indexOf('id="diff-view-all"') < left.indexOf('id="diff-view-diff"'));
		assert.ok(left.indexOf('id="diff-view-diff"') < left.indexOf('id="diff-mode-semantic"'));
		assert.ok(left.indexOf('id="diff-mode-semantic"') < left.indexOf('id="diff-mode-strict"'));
		const centre = html.slice(html.indexOf('class="toolbar-center"'), html.indexOf('class="toolbar-right"'));
		assert.ok(centre.indexOf('id="diff-prev"') < centre.indexOf('id="diff-next"'));
		assert.ok(centre.indexOf('id="diff-next"') < centre.indexOf('id="diff-context"'));
		assert.ok(centre.indexOf('id="diff-context"') < centre.indexOf('id="diff-swap"'));
		const right = html.slice(html.indexOf('class="toolbar-right"'));
		assert.ok(right.indexOf('id="diff-match-status"') < right.indexOf('class="search-box"'));
		assert.ok(/id="diff-swap"[^>]*aria-label="Swap sides"/.test(html));
		assert.ok(/id="diff-swap"[^>]*aria-pressed="false"/.test(html));
		assert.ok(!html.includes('diff-summary'), 'the count summary is gone');
	});

	test('every main diff toolbar button has an icon over a label', () => {
		const html = renderDiffToolbarHtml('<div class="search-box"></div>');
		const buttons = html.match(/<button[^>]*class="tool diff-tool"[\s\S]*?<\/button>/g) ?? [];
		assert.strictEqual(buttons.length, 8);
		for (const button of buttons) {
			assert.ok(button.includes('<svg'), `icon missing: ${button}`);
			assert.ok(button.includes('<span class="lbl">'), `label missing: ${button}`);
			assert.ok(button.includes('title='), `title missing: ${button}`);
		}
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

	test('the diff toolbar reports view, mode, navigation, swap and context state', () => {
		const dom = installMarkup(`<body>${renderDiffToolbarHtml('<div class="search-box"></div>')}</body>`);
		try {
			const calls: string[] = [];
			const toolbar = new DiffToolbar({
				onViewAll: () => calls.push('all'),
				onViewDiff: () => calls.push('diff'),
				onPrev: () => calls.push('prev'),
				onNext: () => calls.push('next'),
				onSwap: () => calls.push('swap'),
				onMatchMode: (semantic) => calls.push(semantic ? 'semantic' : 'strict'),
				onContext: (active) => calls.push(`context:${active}`),
			});
			toolbar.mount();
			dom.document.getElementById('diff-view-all').click();
			dom.document.getElementById('diff-view-diff').click();
			toolbar.setViewMode(true);
			dom.document.getElementById('diff-mode-strict').click();
			dom.document.getElementById('diff-mode-semantic').click();
			dom.document.getElementById('diff-prev').click();
			dom.document.getElementById('diff-next').click();
			dom.document.getElementById('diff-swap').click();
			dom.document.getElementById('diff-context').click();
			assert.deepStrictEqual(calls, ['all', 'diff', 'strict', 'semantic', 'prev', 'next', 'swap', 'context:false']);
			assert.strictEqual(dom.document.getElementById('diff-view-diff').getAttribute('aria-pressed'), 'true');
			toolbar.setSwapped(true);
			assert.strictEqual(dom.document.getElementById('diff-swap').getAttribute('aria-pressed'), 'true');

			toolbar.setMatchMode(false, true);
			const semantic = dom.document.getElementById('diff-mode-semantic')!;
			const strict = dom.document.getElementById('diff-mode-strict')!;
			assert.strictEqual(semantic.getAttribute('aria-pressed'), 'false');
			assert.strictEqual(strict.getAttribute('aria-pressed'), 'true');
			assert.strictEqual(strict.getAttribute('aria-busy'), 'true');
			assert.strictEqual(semantic.getAttribute('aria-busy'), 'false');
			assert.strictEqual(
				dom.document.getElementById('diff-match-status')!.textContent,
				'Switching to Strict…'
			);
			toolbar.setMatchMode(true, false);
			assert.strictEqual(semantic.getAttribute('aria-pressed'), 'true');
			assert.strictEqual(strict.getAttribute('aria-pressed'), 'false');
			assert.strictEqual(strict.getAttribute('aria-busy'), 'false');
			assert.strictEqual(dom.document.getElementById('diff-match-status')!.textContent, '');

			toolbar.setContext(false);
			const context = dom.document.getElementById('diff-context')!;
			assert.strictEqual(context.getAttribute('aria-pressed'), 'false');
			toolbar.setContext(true);
			assert.strictEqual(context.getAttribute('aria-pressed'), 'true');

			toolbar.setViewMode(false);
			assert.strictEqual(context.hasAttribute('disabled'), true);
			toolbar.setViewMode(true);
			assert.strictEqual(context.hasAttribute('disabled'), false);
		} finally {
			dom.restore();
		}
	});
});
