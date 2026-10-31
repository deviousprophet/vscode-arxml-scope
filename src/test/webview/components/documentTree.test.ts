/**
 * The shared DocumentTreeView component.
 *
 * The test host has no webview DOM, so this suite drives the class with a tiny
 * fake element tree and the real virtual-scroll math. It pins the contract the
 * editor and the diff both depend on: one owner for the header/scroller/spacers,
 * a bounded window, a render key that skips unchanged slices, native scroll
 * setters and Shift+wheel.
 */
import * as assert from 'assert';

import { DocumentTreeView, documentTreeStyles, documentTreeViewScript } from '../../../webview/components/documentTree/documentTreeView';
import { tokensStyles } from '../../../webview/styles';
import { calcRowOffset, calcTotalHeight, calcVisibleRange } from '../../../webview/render/virtualScroll';

interface FakeElement {
	name: string;
	className: string;
	textContent: string;
	hidden: boolean;
	tabIndex: number;
	title: string;
	dataset: Record<string, string>;
	style: { values: Record<string, string>; setProperty(name: string, value: string): void };
	attributes: Record<string, string>;
	listeners: Record<string, (event: unknown) => void>;
	children: FakeElement[];
	clientHeight: number;
	clientWidth: number;
	scrollHeight: number;
	scrollWidth: number;
	scrollTop: number;
	scrollLeft: number;
	classList: { add(): void; toggle(): void };
	appendChild(child: FakeElement): FakeElement;
	setAttribute(name: string, value: string): void;
	removeAttribute(name: string): void;
	addEventListener(type: string, listener: (event: unknown) => void): void;
	querySelector(): undefined;
	querySelectorAll(): never[];
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
		clientHeight: 0,
		clientWidth: 0,
		scrollHeight: 0,
		scrollWidth: 0,
		scrollTop: 0,
		scrollLeft: 0,
		classList: { add() {}, toggle() {} },
		appendChild(child: FakeElement) {
			this.children.push(child);
			return child;
		},
		setAttribute(property: string, value: string) {
			this.attributes[property] = value;
		},
		removeAttribute(property: string) {
			delete this.attributes[property];
		},
		addEventListener(type: string, listener: (event: unknown) => void) {
			this.listeners[type] = listener;
		},
		querySelector() {
			return undefined;
		},
		querySelectorAll() {
			return [];
		},
		contains() {
			return false;
		}
	};
	return node;
}

interface Harness {
	root: FakeElement;
	view: DocumentTreeView;
	created: number;
	notified: Array<[number, number]>;
	rendered: number;
	restore(): void;
}

function harness(rowCount = 1000): Harness {
	const root = element();
	const globals = globalThis as unknown as Record<string, unknown>;
	const saved = {
		document: globals.document,
		requestAnimationFrame: globals.requestAnimationFrame,
		getComputedStyle: globals.getComputedStyle,
		calcVisibleRange: globals.calcVisibleRange,
		calcTotalHeight: globals.calcTotalHeight,
		calcRowOffset: globals.calcRowOffset
	};
	globals.document = {
		querySelector: () => root,
		createElement: () => element(),
		createDocumentFragment: () => element('fragment'),
		activeElement: undefined
	};
	globals.requestAnimationFrame = (run: () => void) => {
		run();
		return 1;
	};
	globals.getComputedStyle = () => ({ paddingTop: '0px' });
	globals.calcVisibleRange = calcVisibleRange;
	globals.calcTotalHeight = calcTotalHeight;
	globals.calcRowOffset = calcRowOffset;

	const notified: Array<[number, number]> = [];
	const view = new DocumentTreeView('#tree', 'document', {
		onVisibleWindowChange(top: number, left: number) {
			notified.push([top, left]);
		}
	});
	view.mount();
	const scroll = view.scroll as FakeElement;
	scroll.clientHeight = 100;
	scroll.clientWidth = 200;
	let rendered = 0;
	view.setModel({
		rowCount,
		heightFn: () => 20,
		renderRow() {
			rendered++;
			return element();
		}
	});
	const restore = () => {
		globals.document = saved.document;
		globals.requestAnimationFrame = saved.requestAnimationFrame;
		globals.getComputedStyle = saved.getComputedStyle;
		globals.calcVisibleRange = saved.calcVisibleRange;
		globals.calcTotalHeight = saved.calcTotalHeight;
		globals.calcRowOffset = saved.calcRowOffset;
	};
	return {
		root,
		view,
		created: 0,
		notified,
		restore,
		get rendered() {
			return rendered;
		}
	};
}

suite('DocumentTreeView component', () => {
	test('the component owns root > header + scroll > spacers + window', () => {
		const h = harness();
		try {
			assert.strictEqual(h.root.children.length, 2, 'header and scroll');
			const header = h.root.children[0];
			assert.strictEqual(header.className, 'document-tree-header');
			assert.strictEqual(header.children.length, 2, 'title and meta slots');
			const scroll = h.root.children[1];
			assert.strictEqual(scroll.className, 'document-tree-scroll');
			assert.strictEqual(scroll.children.length, 3, 'top spacer, window, bottom spacer');
			assert.ok(scroll.children[0].className.includes('document-tree-top'));
			assert.strictEqual(scroll.children[1].className, 'document-tree-window');
			assert.ok(scroll.children[2].className.includes('document-tree-bottom'));
		} finally {
			h.restore();
		}
	});

	test('the render key skips an unchanged slice and invalidate forces a rebuild', () => {
		const h = harness();
		try {
			h.view.render(true);
			const first = h.rendered;
			assert.ok(first > 0 && first < 50, `only the viewport window is built (${first})`);
			h.view.render(false);
			assert.strictEqual(h.rendered, first, 'an unchanged slice does no DOM work');
			h.view.invalidate();
			h.view.render(false);
			assert.strictEqual(h.rendered, first * 2, 'invalidate rebuilds the same slice once');
		} finally {
			h.restore();
		}
	});

	test('the spacers preserve the full scroll height for a large row list', () => {
		const h = harness(10000);
		try {
			h.view.render(true);
			const scroll = h.view.scroll as FakeElement;
			const state = {
				rowCount: 10000,
				rowHeight: () => 20,
				containerHeight: 100,
				scrollTop: 0,
				bufferSize: 10,
				heightVersion: 0
			};
			const [start, end] = calcVisibleRange(state);
			assert.strictEqual(scroll.style.values['--document-tree-top'], Math.max(0, calcRowOffset(start, state)) + 'px');
			assert.strictEqual(
				scroll.style.values['--document-tree-bottom'],
				Math.max(0, calcRowOffset(10000, state) - calcRowOffset(end, state)) + 'px'
			);
			assert.ok(h.rendered < 50, 'a 10k-row document renders only the visible window');
		} finally {
			h.restore();
		}
	});

	test('scroll setters use the native offsets and report the visible window', () => {
		const h = harness();
		try {
			h.view.setScrollTop(300);
			assert.strictEqual(h.view.getScrollTop(), 300);
			h.view.setScrollLeft(40);
			assert.strictEqual(h.view.getScrollLeft(), 40);
			h.view.scrollToIndex(500, 'start');
			assert.strictEqual(h.view.getScrollTop(), 500 * 20, 'scrollToIndex aligns the row at the top');
		} finally {
			h.restore();
		}
	});

	test('Shift+wheel drives the native horizontal offset and reports it', () => {
		const h = harness();
		try {
			const scroll = h.view.scroll as FakeElement;
			scroll.scrollWidth = 2000;
			scroll.clientWidth = 200;
			let prevented = false;
			h.view.onWheel({
				shiftKey: true,
				deltaY: 120,
				deltaX: 0,
				preventDefault() {
					prevented = true;
				}
			});
			assert.ok(prevented, 'Shift+wheel is claimed by the horizontal scroller');
			assert.strictEqual(scroll.scrollLeft, 120);
			assert.deepStrictEqual(h.notified[h.notified.length - 1], [0, 120], 'the host sees the new offset');
			h.view.onWheel({ shiftKey: false, deltaY: 120, deltaX: 0, preventDefault() {} });
			assert.strictEqual(scroll.scrollLeft, 120, 'a plain wheel stays vertical');
		} finally {
			h.restore();
		}
	});

	test('the stylesheet and serialized class are the one shared surface', () => {
		const styles = documentTreeStyles();
		assert.ok(/\.document-tree-scroll\s*\{[^}]*overflow:\s*auto/.test(styles), 'native two-axis scroller');
		assert.ok(/\.document-tree-scroll\s*\{[^}]*scrollbar-gutter:\s*stable/.test(styles), 'native bar keeps its height');
		assert.ok(/\.document-tree-window\s*\{[^}]*min-width:\s*var\(--document-tree-content-width/.test(styles));
		assert.ok(!/\.hscroll/.test(styles), 'no proxy scrollbar');
		assert.ok(!/height:\s*12px/.test(styles), 'no clipped scrollbar strip');
		assert.ok(tokensStyles().includes('--container-accent: #4EC9B0'), 'shared tokens live in styles/');
		assert.ok(styles.includes('body[data-view="document"] .row[data-level="3"]'));
		const script = documentTreeViewScript();
		assert.ok(script.includes('const DocumentTreeView = ('), 'the page gets one stable binding');
		assert.ok(script.includes('class'), 'the class source is inlined');
		assert.ok(script.includes('setScrollTop'));
		assert.ok(script.includes('onWheel'));
	});
});
