/**
 * DiffView component: two pane roots, two DocumentTree instances and the
 * single-vertical / mirrored-horizontal controller.
 */
import * as assert from 'assert';

import { DiffView, renderDiffViewHtml } from '../../../webview/components/diffView/diffView';
import { webviewCss } from '../cssTestUtils';
import { installMarkup } from '../pageTestUtils';

suite('DiffView component', () => {
	test('the body owns two DocumentTree roots, a probe and the empty state', () => {
		const html = renderDiffViewHtml();
		assert.strictEqual((html.match(/class="document-tree diff-pane"/g) ?? []).length, 2);
		assert.ok(/id="diff-pane-left"[^>]*role="tree"/.test(html));
		assert.ok(/id="diff-pane-right"[^>]*role="group"/.test(html));
		assert.ok(html.includes('id="diff-measure"') && html.includes('id="diff-ch-probe"'));
		assert.ok(html.includes('id="diff-empty"') && html.includes('id="diff-empty-text"'));
		assert.ok(!/hscroll/.test(html), 'no proxy scrollbar');
	});

	test('the pane grid and split are component CSS', () => {
		const css = webviewCss('components', 'diffView', 'diffView.css') + webviewCss('components', 'documentTree', 'documentTree.css');
		assert.ok(/#diff-list\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/.test(css));
		assert.ok(/\.diff-pane \+ \.diff-pane\s*\{[^}]*border-left:\s*3px/.test(css));
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
		assert.ok(
			/\.diff-row \.word-changed\[data-word-side="left"\]\s*\{[^}]*outline:\s*1px solid var\(--diff-removed-edge\)/.test(css),
			'a changed word keeps its removed edge'
		);
		assert.ok(
			/\.diff-row \.word-changed\[data-word-side="right"\]\s*\{[^}]*outline:\s*1px solid var\(--diff-added-edge\)/.test(css),
			'a changed word keeps its added edge'
		);
		assert.ok(
			/\.diff-row mark\s*\{[^}]*background:\s*var\(--match-bg\)/.test(css),
			'a search mark keeps its background inside a changed word'
		);
		assert.ok(!/\.diff-row\[data-gap/.test(css), 'the diff has no module gap row');
	});

	test('mount creates one component per pane and mirrors the follower', () => {
		const dom = installMarkup(`<body>${renderDiffViewHtml()}</body>`);
		try {
			const view = new DiffView();
			view.mount();
			view.mount();
			assert.ok(view.left && view.right, 'both panes exist');
			assert.notStrictEqual(view.left, view.right, 'independent scrollers');
			view.syncPanes('left', 120, 30);
			assert.strictEqual(view.right.getScrollTop(), 120, 'vertical follows the driver');
			assert.strictEqual(view.right.getScrollLeft(), 30, 'horizontal mirrors');
			view.syncPanes('right', 240, 40);
			assert.strictEqual(view.left.getScrollTop(), 240);
			assert.strictEqual(view.left.getScrollLeft(), 40);
			view.resetHorizontal();
			assert.strictEqual(view.left.getScrollLeft(), 0);
			assert.strictEqual(view.right.getScrollLeft(), 0);
		} finally {
			dom.restore();
		}
	});

	test('the component owns no host model or message access', () => {
		const source = DiffView.toString();
		assert.ok(source.includes("'#diff-pane-left'"));
		assert.ok(source.includes("'#diff-pane-right'"));
		assert.ok(source.includes('syncPanes('));
		assert.ok(!source.includes('vscode'), 'no provider messages');
		assert.ok(!source.includes('diffDocument'), 'no host diff document');
	});
});
