/**
 * DiffView: fixed file-name chrome plus one shared VirtualScroll surface.
 */
import * as assert from 'assert';

import { DiffView, renderDiffViewHtml } from '../../../webview/components/diffView/diffView';
import { buildOffsets } from '../../../webview/render/virtualScroll';
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
		assert.ok(
			/\.diff-module-gap-row\s*\{[^}]*height:\s*var\(--ecuc-lh\)/.test(css),
			'the shared module gap is one base row high'
		);
		assert.ok(
			/\.diff-module-gap-row\s*\{[^}]*background:\s*var\(--vscode-editor-background\)/.test(css),
			'the module gap carries no status tint'
		);
		assert.ok(!/\.diff-module-gap-row\s*\{[^}]*border/.test(css), 'the module gap has no border or rail');
		assert.ok(!/\.diff-row\[data-gap/.test(css), 'the old Document-only padding marker is gone');
		assert.ok(
			/\.document-tree-window\s*\{[^}]*min-width:\s*max\(100%, var\(--document-tree-content-width, 0px\)\)/.test(
				css
			),
			'both diff panes fill at least the pane or the content width'
		);
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

	test('both panes mount a gutter with independent widths and ranges', () => {
		const dom = installMarkup(`<body>${renderDiffViewHtml()}</body>`);
		try {
			const view = new DiffView();
			view.mount();
			const rowCount = 120000;
			view.setModel({
				rowCount,
				offsets: buildOffsets(rowCount, () => 20),
				renderRow: () => document.createElement('div'),
				lineInfo(index: number, pane: string) {
					if (pane === 'left') {
						return { number: index + 1 };
					}
					return index % 2 === 0 ? { number: index / 2 + 1 } : undefined;
				},
				activeLine: () => 2
			});
			view.render({ top: 0, left: 0, height: 100, width: 800 }, true);
			const left = dom.document.querySelector('#diff-pane-left .document-tree-lines') as HTMLElement;
			const right = dom.document.querySelector('#diff-pane-right .document-tree-lines') as HTMLElement;
			assert.ok(left && right, 'each pane owns a gutter');
			assert.strictEqual(left.getAttribute('aria-hidden'), 'true');
			assert.strictEqual(left.getAttribute('data-side'), 'left');
			assert.strictEqual(right.getAttribute('data-side'), 'right');
			assert.strictEqual(
				(dom.document.getElementById('diff-pane-left') as HTMLElement).style.getPropertyValue('--line-numbers-width'),
				'6ch',
				'the left digit count sets its own column'
			);
			assert.strictEqual(
				(dom.document.getElementById('diff-pane-right') as HTMLElement).style.getPropertyValue('--line-numbers-width'),
				'5ch',
				'the right pane keeps an independent width'
			);
			const leftCells = left.querySelectorAll('.document-tree-line-number');
			const rightCells = right.querySelectorAll('.document-tree-line-number');
			assert.strictEqual(leftCells.length, 15);
			assert.strictEqual(rightCells.length, 15);
			assert.strictEqual(leftCells[0].textContent, '1');
			assert.strictEqual(leftCells[14].textContent, '15');
			assert.strictEqual(rightCells[0].textContent, '1');
			assert.strictEqual(rightCells[1].textContent, '', 'the missing side stays blank');
			assert.strictEqual(rightCells[2].textContent, '2');
			assert.strictEqual((leftCells[2] as HTMLElement).getAttribute('data-active'), 'true');
			assert.strictEqual((rightCells[1] as HTMLElement).hasAttribute('data-active'), false);
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

	test('render mirrors the single left offset to both panes and reports the viewport', () => {
		const dom = installMarkup(`<body>${renderDiffViewHtml()}</body>`);
		try {
			const seen: unknown[] = [];
			const view = new DiffView({ onViewportChange: (viewport) => seen.push(viewport) });
			view.mount();
			const rendered: unknown[][] = [];
			view.left.render = (pane: any, force: boolean) => rendered.push(['left', pane.top, pane.left, force]);
			view.right.render = (pane: any, force: boolean) => rendered.push(['right', pane.top, pane.left, force]);
			const viewport = { top: 5, left: 9, height: 40, width: 80 };
			view.render(viewport, true);
			assert.deepStrictEqual(rendered, [
				['left', 5, 9, true],
				['right', 5, 9, true],
			]);
			assert.strictEqual(seen[0], viewport, 'the host receives the same viewport object');
			view.render({ top: 1, left: 2, height: 3, width: 4, lefts: [7, 6] }, false);
			assert.deepStrictEqual(rendered.slice(2), [
				['left', 1, 7, false],
				['right', 1, 6, false],
			]);
		} finally {
			dom.restore();
		}
	});

	test('an empty title hides its strip and the tooltip falls back to the text', () => {
		const dom = installMarkup(`<body>${renderDiffViewHtml()}</body>`);
		try {
			const view = new DiffView();
			view.mount();
			const left = dom.document.getElementById('diff-title-left');
			const right = dom.document.getElementById('diff-title-right');
			view.setHeader({ left: {}, right: { title: 'right.arxml' } });
			assert.strictEqual(left.textContent, '');
			assert.strictEqual(left.title, '');
			assert.strictEqual(left.hidden, true);
			assert.strictEqual(right.textContent, 'right.arxml');
			assert.strictEqual(right.title, 'right.arxml');
			assert.strictEqual(right.hidden, false);
			view.setHeader({ left: { title: 'left.arxml' }, right: { title: 'right.arxml', titleTitle: '/r.arxml' } });
			assert.strictEqual(left.title, 'left.arxml', 'the title text is its own tooltip');
			assert.strictEqual(right.title, '/r.arxml');
		} finally {
			dom.restore();
		}
	});

	test('an unmounted view still publishes a zero scrollbar gutter', () => {
		const dom = installMarkup(`<body>${renderDiffViewHtml()}</body>`);
		try {
			const view = new DiffView();
			view.syncScrollbarWidth();
			assert.strictEqual(
				(dom.document.getElementById('diff-body') as HTMLElement).style.getPropertyValue('--diff-scrollbar-width'),
				'0px'
			);
		} finally {
			dom.restore();
		}
	});
});
