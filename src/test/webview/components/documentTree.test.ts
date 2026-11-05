/**
 * The shared Document window renderer.
 *
 * VirtualScroll owns the scroller and the offsets; this suite pins the window
 * contract: position, slice, horizontal translation and row callbacks.
 */
import * as assert from 'assert';

import { DocumentTreeView } from '../../../webview/components/documentTree/documentTreeView';
import { buildOffsets } from '../../../webview/render/virtualScroll';
import { webviewCss } from '../cssTestUtils';

interface FakeElement {
	name: string;
	className: string;
	textContent: string;
	hidden: boolean;
	tabIndex: number;
	title: string;
	dataset: Record<string, string>;
	style: { values: Record<string, string>; setProperty(name: string, value: string): void; [key: string]: any };
	attributes: Record<string, string>;
	listeners: Record<string, (event: unknown) => void>;
	children: FakeElement[];
	firstChild: FakeElement | undefined;
	lastChild: FakeElement | undefined;
	clientHeight: number;
	clientWidth: number;
	scrollWidth: number;
	classList: { add(): void; toggle(): void };
	appendChild(child: FakeElement): FakeElement;
	insertBefore(child: FakeElement, before: FakeElement): FakeElement;
	removeChild(child: FakeElement): FakeElement;
	setAttribute(name: string, value: string): void;
	addEventListener(type: string, listener: (event: unknown) => void): void;
	querySelector(): undefined;
	contains(): boolean;
}

function element(name = 'div'): FakeElement {
	const node: FakeElement = {
		name,
		className: '',
		textContent: '',
		hidden: false,
		tabIndex: 0,
		title: '',
		dataset: {},
		style: {
			values: {},
			setProperty(property: string, value: string) {
				this.values[property] = value;
			}
		},
		attributes: {},
		listeners: {},
		children: [],
		firstChild: undefined,
		lastChild: undefined,
		clientHeight: 0,
		clientWidth: 0,
		scrollWidth: 0,
		classList: { add() {}, toggle() {} },
		appendChild(child: FakeElement) {
			if (child.name === 'fragment') {
				for (const nested of child.children) {
					this.children.push(nested);
				}
			} else {
				this.children.push(child);
			}
			this.firstChild = this.children[0];
			this.lastChild = this.children[this.children.length - 1];
			return child;
		},
		insertBefore(child: FakeElement, before: FakeElement) {
			const at = this.children.indexOf(before);
			if (at < 0) {
				this.children.push(child);
			} else {
				this.children.splice(at, 0, child);
			}
			this.firstChild = this.children[0];
			this.lastChild = this.children[this.children.length - 1];
			return child;
		},
		removeChild(child: FakeElement) {
			const at = this.children.indexOf(child);
			if (at >= 0) {
				this.children.splice(at, 1);
			}
			this.firstChild = this.children[0];
			this.lastChild = this.children[this.children.length - 1];
			return child;
		},
		setAttribute(property: string, value: string) {
			this.attributes[property] = value;
		},
		addEventListener(type: string, listener: (event: unknown) => void) {
			this.listeners[type] = listener;
		},
		querySelector() {
			return undefined;
		},
		contains() {
			return true;
		}
	};
	return node;
}

interface Harness {
	root: FakeElement;
	view: DocumentTreeView;
	rendered: number[];
	ranges: Array<[number, number]>;
	clicked: number[];
	restore(): void;
}

function harness(rowCount = 1000): Harness {
	const root = element();
	const globals = globalThis as unknown as Record<string, unknown>;
	const saved = { document: globals.document };
	globals.document = {
		querySelector: () => root,
		createElement: () => element(),
		createTextNode: (text: string) => {
			const node = element('text');
			node.textContent = text;
			return node;
		},
		createDocumentFragment: () => element('fragment'),
		activeElement: undefined
	};
	const rendered: number[] = [];
	const ranges: Array<[number, number]> = [];
	const clicked: number[] = [];
	const view = new DocumentTreeView(root, 'document', {
		onRender(range) {
			ranges.push(range);
		},
		onRowClick(index) {
			clicked.push(index);
		}
	});
	view.mount();
	view.setModel({
		rowCount,
		offsets: buildOffsets(rowCount, () => 20),
		renderRow(index) {
			rendered.push(index);
			return element();
		},
		contentWidth: 500
	});
	const restore = () => {
		globals.document = saved.document;
	};
	return { root, view, rendered, ranges, clicked, restore };
}

suite('DocumentTreeView component', () => {
	test('mount creates the window inside the pane layer', () => {
		const h = harness();
		try {
			assert.strictEqual(h.root.children.length, 1);
			assert.strictEqual(h.root.children[0].className, 'document-tree-window');
			assert.ok(h.root.listeners['click'], 'the pane owns the click listener');
			assert.strictEqual(
				h.view.getWindowElement().style.values['--document-tree-content-width'],
				'500px'
			);
		} finally {
			h.restore();
		}
	});

	test('render positions the window at the first row offset and renders the slice', () => {
		const h = harness();
		try {
			h.view.render({ top: 500, left: 0, height: 100, width: 800 });
			const windowEl = h.view.getWindowElement();
			assert.strictEqual(windowEl.style.top, '300px', 'the first buffered row starts at 300px');
			assert.strictEqual(windowEl.style.height, '500px', 'the window spans the rendered rows');
			assert.deepStrictEqual(h.view.getVisibleRange(), [15, 40]);
			assert.strictEqual(h.rendered.length, 25);
			assert.strictEqual(h.rendered[0], 15);
			assert.strictEqual(h.rendered[h.rendered.length - 1], 39);
			assert.deepStrictEqual(h.ranges[h.ranges.length - 1], [15, 40]);
		} finally {
			h.restore();
		}
	});

	test('the shared horizontal offset translates the window', () => {
		const h = harness();
		try {
			h.view.render({ top: 0, left: 40, height: 100, width: 800 });
			assert.strictEqual(h.view.getWindowElement().style.transform, 'translateX(-40px)');
		} finally {
			h.restore();
		}
	});

	test('an unchanged viewport skips the DOM render and a move forces a new slice', () => {
		const h = harness(1000);
		try {
			h.view.render({ top: 500, left: 0, height: 100, width: 800 });
			const before = h.rendered.length;
			h.view.render({ top: 500, left: 0, height: 100, width: 800 });
			assert.strictEqual(h.rendered.length, before, 'same viewport is a no-op');
			h.view.render({ top: 520, left: 0, height: 100, width: 800 });
			assert.ok(h.rendered.length > before, 'a moved viewport renders a new slice');
		} finally {
			h.restore();
		}
	});

	test('clicking a row reports its virtual index', () => {
		const h = harness();
		try {
			const row = element();
			row.dataset.documentIndex = '3';
			h.view.onClick({ target: { closest: () => row } });
			assert.deepStrictEqual(h.clicked, [3]);
		} finally {
			h.restore();
		}
	});

	test('an empty model clears the window', () => {
		const h = harness(0);
		try {
			h.view.render({ top: 0, left: 0, height: 100, width: 800 });
			assert.strictEqual(h.view.getWindowElement().style.top, '0px');
			assert.strictEqual(h.view.getWindowElement().style.height, '0px');
			assert.deepStrictEqual(h.view.getVisibleRange(), [0, 0]);
		} finally {
			h.restore();
		}
	});

	test('the stylesheet owns the absolute window, not a scroller or pinned header', () => {
		const css = webviewCss('components', 'documentTree', 'documentTree.css');
		assert.ok(/\.document-tree-window\s*\{[^}]*position:\s*absolute/.test(css));
		assert.ok(/\.document-tree-header-row\s*\{/.test(css));
		assert.ok(!/\.document-tree-scroll\s*\{/.test(css));
		assert.ok(!/\.document-tree-title-bar\s*\{/.test(css));
	});
});
