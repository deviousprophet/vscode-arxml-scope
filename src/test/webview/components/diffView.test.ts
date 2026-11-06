/**
 * DiffView: fixed file-name chrome plus one shared VirtualScroll surface.
 */
import * as assert from 'assert';

import { DiffView, renderDiffViewHtml } from '../../../webview/components/diffView/diffView';
import { webviewCss } from '../cssTestUtils';
import { installMarkup } from '../pageTestUtils';

suite('DiffView component', () => {
	test('the shell owns the fixed title strip, shared scroll root, probe and empty state', () => {
		const html = renderDiffViewHtml();
		assert.ok(html.includes('id="diff-title-strip"'));
		assert.ok(html.includes('id="diff-title-left"') && html.includes('id="diff-title-right"'));
		assert.ok(html.includes('id="diff-list"'));
		assert.ok(html.includes('id="diff-measure"') && html.includes('id="diff-ch-probe"'));
		assert.ok(html.includes('id="diff-empty"') && html.includes('id="diff-empty-text"'));
		assert.ok(html.includes('id="diff-semantic-skip"'));
		assert.ok(!/id="diff-pane-left"/.test(html), 'the pane layers are created by VirtualScroll');
	});

	test('the shared surface and fixed title strip are component CSS', () => {
		const css =
			webviewCss('components', 'diffView', 'diffView.css') +
			webviewCss('components', 'documentTree', 'documentTree.css') +
			webviewCss('components', 'virtualScroll', 'virtualScroll.css');
		assert.ok(/\.diff-title-strip\s*\{[^}]*display:\s*grid/.test(css));
		assert.ok(/\.diff-title-strip\s*\{[^}]*width:\s*calc\(100% - var\(--diff-scrollbar-width/.test(css));
		assert.ok(/\.diff-title-strip::after\s*\{[^}]*left:\s*50%/.test(css));
		assert.ok(/\.diff-title-strip::after\s*\{[^}]*width:\s*3px/.test(css));
		assert.ok(/\.diff-semantic-skip\s*\{[^}]*color:\s*var\(--vscode-descriptionForeground\)/.test(css));
		assert.ok(/\.virtual-scroll-pane-right\s*\{[^}]*border-left:\s*3px/.test(css));
		assert.ok(/\.virtual-scroll-vscroll\s*\{[^}]*overflow-y:\s*auto/.test(css));
		assert.ok(/\.virtual-scroll-hbars\s*\{/.test(css));
		assert.ok(/\.virtual-scroll-hscroll-right\s*\{[^}]*left:\s*calc\(50% \+ 3px\)/.test(css));
		assert.ok(/\.diff-cell\s*\{[^}]*padding:\s*0;/.test(css));
		assert.ok(/\.diff-row\[data-status="changed"\] > \.diff-cell/.test(css));
		assert.ok(
			/\.diff-row \.word-changed\[data-word-side="left"\]\s*\{[^}]*var\(--vscode-diffEditor-removedTextBackground/.test(css),
			'changed words on the displayed left use the removed text background'
		);
		assert.ok(
			/\.diff-row \.word-changed\[data-word-side="right"\]\s*\{[^}]*var\(--vscode-diffEditor-insertedTextBackground/.test(css),
			'changed words on the displayed right use the inserted text background'
		);
		assert.ok(!/\.diff-row\[data-gap/.test(css), 'the diff has no module gap row');
	});

	test('mount creates one shared scroll surface and two window panes', () => {
		const dom = installMarkup(`<body>${renderDiffViewHtml()}</body>`);
		try {
			const view = new DiffView();
			view.mount();
			view.mount();
			assert.ok(view.left && view.right, 'both pane windows exist');
			assert.notStrictEqual(view.left, view.right, 'independent window renderers');
			assert.ok(view.scroll, 'one VirtualScroll surface');
			assert.strictEqual(view.scroll.getPaneById('diff-pane-left').id, 'diff-pane-left');
			assert.strictEqual(view.scroll.getPaneById('diff-pane-right').id, 'diff-pane-right');
			view.setContent({
				rowCount: 3,
				offsets: [0, 20, 40, 60],
				totalHeight: 60,
				contentWidth: 400
			});
			view.setHeader({
				left: { title: 'left.arxml', titleTitle: '/work/left.arxml' },
				right: { title: 'right.arxml', titleTitle: '/work/right.arxml' }
			});
			assert.strictEqual(dom.document.getElementById('diff-title-left').textContent, 'left.arxml');
			assert.strictEqual(dom.document.getElementById('diff-title-right').textContent, 'right.arxml');
			assert.strictEqual(dom.document.getElementById('diff-title-left').title, '/work/left.arxml');
			view.setScrollTop(20);
			assert.strictEqual(view.getScrollTop(), 20);
			view.setScrollLeft(30);
			assert.strictEqual(view.getScrollLeft(0), 30);
			assert.strictEqual(view.getScrollLeft(1), 0);
			view.scroll?.setPaneScrollLeft(1, 15);
			assert.strictEqual(view.getScrollLeft(0), 30);
			assert.strictEqual(view.getScrollLeft(1), 15);
			view.resetHorizontal();
			assert.strictEqual(view.getScrollLeft(0), 0);
			assert.strictEqual(view.getScrollLeft(1), 0);
			Object.defineProperty(view.scroll.scroll, 'offsetWidth', { value: 900, configurable: true });
			Object.defineProperty(view.scroll.scroll, 'clientWidth', { value: 885, configurable: true });
			view.syncScrollbarWidth();
			assert.strictEqual(
				(dom.document.getElementById('diff-body') as HTMLElement).style.getPropertyValue('--diff-scrollbar-width'),
				'15px'
			);
		} finally {
			dom.restore();
		}
	});

	test('the component owns no host model or message access', () => {
		const source = DiffView.toString();
		assert.ok(source.includes("'#diff-list'"));
		assert.ok(source.includes('VirtualScroll'));
		assert.ok(!source.includes('syncPanes('));
		assert.ok(!source.includes('vscode'), 'no provider messages');
		assert.ok(!source.includes('diffDocument'), 'no host diff document');
	});
});
