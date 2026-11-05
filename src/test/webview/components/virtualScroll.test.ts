/**
 * VirtualScroll: the one owner of the scroll surface, the offsets and both bars.
 */
import * as assert from 'assert';

import { VirtualScroll } from '../../../webview/components/virtualScroll/virtualScroll';

interface FakeElement {
	name: string;
	id: string;
	className: string;
	textContent: string;
	hidden: boolean;
	dataset: Record<string, string>;
	style: { values: Record<string, string>; setProperty(name: string, value: string): void; [key: string]: any };
	attributes: Record<string, string>;
	listeners: Record<string, (event: unknown) => void>;
	children: FakeElement[];
	firstChild: FakeElement | undefined;
	lastChild: FakeElement | undefined;
	clientHeight: number;
	clientWidth: number;
	scrollTop: number;
	scrollLeft: number;
	scrollWidth: number;
	classList: { add(className: string): void };
	appendChild(child: FakeElement): FakeElement;
	setAttribute(name: string, value: string): void;
	addEventListener(type: string, listener: (event: unknown) => void): void;
}

function element(): FakeElement {
	const node: FakeElement = {
		name: 'div',
		id: '',
		className: '',
		textContent: '',
		hidden: false,
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
		scrollTop: 0,
		scrollLeft: 0,
		scrollWidth: 0,
		classList: {
			add(className: string) {
				const parts = node.className === '' ? [] : node.className.split(' ');
				if (!parts.includes(className)) {
					parts.push(className);
				}
				node.className = parts.join(' ');
			}
		},
		appendChild(child: FakeElement) {
			this.children.push(child);
			this.firstChild = this.children[0];
			this.lastChild = this.children[this.children.length - 1];
			return child;
		},
		setAttribute(name: string, value: string) {
			this.attributes[name] = value;
		},
		addEventListener(type: string, listener: (event: unknown) => void) {
			this.listeners[type] = listener;
		}
	};
	return node;
}

interface Harness {
	root: FakeElement;
	scroll: VirtualScroll;
	frames: Array<() => void>;
	viewports: any[];
	restore(): void;
}

function harness(): Harness {
	const root = element();
	const globals = globalThis as unknown as Record<string, unknown>;
	const saved = { document: globals.document, requestAnimationFrame: globals.requestAnimationFrame };
	const frames: Array<() => void> = [];
	globals.document = {
		querySelector: () => root,
		createElement: () => element()
	};
	globals.requestAnimationFrame = (callback: () => void) => {
		frames.push(callback);
		return frames.length;
	};
	const viewports: any[] = [];
	const scroll = new VirtualScroll(
		'#scroll',
		[
			{ id: 'left', side: 'left' },
			{ id: 'right', side: 'right' }
		],
		{
			onViewportChange(viewport) {
				viewports.push(viewport);
			}
		}
	);
	scroll.mount();
	const restore = () => {
		globals.document = saved.document;
		globals.requestAnimationFrame = saved.requestAnimationFrame;
	};
	return { root, scroll, frames, viewports, restore };
}

suite('VirtualScroll component', () => {
	test('mount owns the scroller, content, horizontal bar and panes', () => {
		const h = harness();
		try {
			assert.strictEqual(h.root.className.includes('virtual-scroll'), true);
			assert.strictEqual(h.scroll.getContentElement().className, 'virtual-scroll-content');
			assert.strictEqual(h.scroll.getPane(0).id, 'left');
			assert.strictEqual(h.scroll.getPane(1).id, 'right');
			assert.ok(h.root.children.some((child) => child.className === 'virtual-scroll-vscroll'));
			assert.ok(h.root.children.some((child) => child.className === 'virtual-scroll-hbars'));
			assert.ok(h.scroll.getHorizontalBar(0), 'left bar');
			assert.ok(h.scroll.getHorizontalBar(1), 'right bar');
			assert.strictEqual(h.scroll.getHorizontalBar(0).dataset.pane, '0');
			assert.strictEqual(h.scroll.getHorizontalBar(1).dataset.pane, '1');
		} finally {
			h.restore();
		}
	});

	test('setContent drives the total height and the visible range', () => {
		const h = harness();
		try {
			h.scroll.scroll.clientHeight = 40;
			h.scroll.setContent({ rowCount: 3, offsets: [0, 20, 40, 60], totalHeight: 60, contentWidth: 500 });
			assert.strictEqual(h.scroll.getContentElement().style.values['height'], '60px');
			assert.strictEqual(h.scroll.hspacer.style.values['width'], '500px');
			assert.strictEqual(h.scroll.hspacers[1].style.values['width'], '500px');
			h.scroll.setScrollTop(20);
			assert.deepStrictEqual(h.scroll.getVisibleRange(), [0, 3]);
		} finally {
			h.restore();
		}
	});

	test('scroll setters report the viewport and scroll a row into view', () => {
		const h = harness();
		try {
			h.scroll.scroll.clientHeight = 40;
			h.scroll.setContent({ rowCount: 3, offsets: [0, 20, 40, 60], totalHeight: 60, contentWidth: 500 });
			h.scroll.setScrollTop(20);
			assert.strictEqual(h.viewports[h.viewports.length - 1].top, 20);
			h.scroll.setScrollLeft(30);
			assert.strictEqual(h.scroll.getScrollLeft(0), 30);
			assert.strictEqual(h.scroll.getScrollLeft(1), 0);
			assert.strictEqual(h.viewports[h.viewports.length - 1].left, 30);
			assert.deepStrictEqual(h.viewports[h.viewports.length - 1].lefts, [30, 0]);
			h.scroll.setPaneScrollLeft(1, 15);
			assert.strictEqual(h.scroll.getScrollLeft(0), 30);
			assert.strictEqual(h.scroll.getScrollLeft(1), 15);
			assert.deepStrictEqual(h.viewports[h.viewports.length - 1].lefts, [30, 15]);
			h.scroll.scrollToIndex(2, 'start');
			assert.strictEqual(h.scroll.getScrollTop(), 40);
		} finally {
			h.restore();
		}
	});

	test('a deferred scroll coalesces into one animation frame', () => {
		const h = harness();
		try {
			h.scroll.scroll.clientHeight = 40;
			h.scroll.setContent({ rowCount: 3, offsets: [0, 20, 40, 60], totalHeight: 60, contentWidth: 500 });
			h.frames.length = 0;
			h.viewports.length = 0;
			h.scroll.frame = 0;
			h.scroll.setScrollTop(20, true);
			h.scroll.setScrollTop(40, true);
			assert.strictEqual(h.frames.length, 1);
			h.frames[0]();
			assert.strictEqual(h.viewports.length, 1);
			assert.strictEqual(h.viewports[0].top, 40);
		} finally {
			h.restore();
		}
	});

	test('setContentWidth grows the horizontal spacer without rebuilding rows', () => {
		const h = harness();
		try {
			h.scroll.setContent({ rowCount: 1, offsets: [0, 20], totalHeight: 20, contentWidth: 100 });
			h.scroll.setContentWidth(240);
			assert.strictEqual(h.scroll.hspacer.style.values['width'], '240px');
			assert.strictEqual(h.scroll.hspacers[1].style.values['width'], '240px');
			assert.strictEqual(h.scroll.offsets.length, 2);
		} finally {
			h.restore();
		}
	});
});
