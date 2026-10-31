/**
 * DiffView component: two pane roots, two DocumentTree instances and the
 * single-vertical / mirrored-horizontal controller.
 */
import * as assert from 'assert';

import {
	DiffView,
	diffViewStyles,
	renderDiffViewHtml,
} from '../../../webview/components/diffView/diffView';

interface FakeTree {
	root: unknown;
	top: number;
	leftValue: number;
	mounted: number;
	mount(): void;
	setScrollTop(value: number): void;
	getScrollTop(): number;
	setScrollLeft(value: number): void;
	getScrollLeft(): number;
}

function fakeTree(): FakeTree {
	return {
		root: undefined,
		top: 0,
		leftValue: 0,
		mounted: 0,
		mount() {
			this.mounted++;
		},
		setScrollTop(value: number) {
			this.top = value;
		},
		getScrollTop() {
			return this.top;
		},
		setScrollLeft(value: number) {
			this.leftValue = value;
		},
		getScrollLeft() {
			return this.leftValue;
		},
	};
}

function withGlobals<T>(run: () => T): T {
	const globals = globalThis as unknown as Record<string, unknown>;
	const saved = { document: globals.document, tree: globals.DocumentTreeView };
	globals.document = { getElementById: () => undefined };
	globals.DocumentTreeView = function (this: FakeTree) {
		return fakeTree();
	};
	try {
		return run();
	} finally {
		globals.document = saved.document;
		globals.DocumentTreeView = saved.tree;
	}
}

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
		const css = diffViewStyles();
		assert.ok(/#diff-list\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/.test(css));
		assert.ok(/\.diff-pane \+ \.diff-pane\s*\{[^}]*border-left:\s*3px/.test(css));
		assert.ok(/\.diff-cell\s*\{[^}]*padding:\s*0;/.test(css));
		assert.ok(/\.diff-row\[data-status="changed"\] > \.diff-cell/.test(css));
	});

	test('mount creates one component per pane and syncs the follower', () => {
		withGlobals(() => {
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
		});
	});

	test('the serialized class has no host model or message access', () => {
		const source = DiffView.toString();
		assert.ok(source.includes("new DocumentTreeView('#diff-pane-left'"));
		assert.ok(source.includes("new DocumentTreeView('#diff-pane-right'"));
		assert.ok(source.includes('syncPanes('));
		assert.ok(!source.includes('vscode'), 'no provider messages');
		assert.ok(!source.includes('diffDocument'), 'no host diff document');
	});
});
