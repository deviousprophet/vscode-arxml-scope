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

	test('each pane has its own horizontal bar and offsets sync in diff mode', () => {
		const h = harness();
		try {
			h.scroll.callbacks.syncHorizontal = true;
			h.scroll.setContent({
				rowCount: 2,
				offsets: [0, 20, 40],
				totalHeight: 40,
				contentWidth: 500,
				contentWidths: [500, 600]
			});
			assert.strictEqual(h.scroll.hspacer.style.values['width'], '500px');
			assert.strictEqual(h.scroll.hspacers[1].style.values['width'], '600px');
			h.scroll.getHorizontalBar(0).scrollLeft = 40;
			h.scroll.getHorizontalBar(0).listeners['scroll']();
			assert.strictEqual(h.scroll.getScrollLeft(0), 40);
			assert.strictEqual(h.scroll.getScrollLeft(1), 40);
		} finally {
			h.restore();
		}
	});

	test('verticalScrollbarWidth reports the reserved gutter', () => {
		const h = harness();
		try {
			h.scroll.scroll.offsetWidth = 900;
			h.scroll.scroll.clientWidth = 885;
			assert.strictEqual(h.scroll.verticalScrollbarWidth(), 15);
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

	test('setContentWidth never shrinks a pane and ignores an invalid width', () => {
		const h = harness();
		try {
			h.scroll.setContent({ rowCount: 1, offsets: [0, 20], totalHeight: 20, contentWidth: 100, contentWidths: [100, 200] });
			h.scroll.setContentWidth(80);
			h.scroll.setContentWidth(Number.NaN);
			assert.deepStrictEqual(h.scroll.contentWidths, [100, 200]);
			assert.strictEqual(h.scroll.contentWidth, 100);
			assert.strictEqual(h.scroll.hspacer.style.values['width'], '100px');
		} finally {
			h.restore();
		}
	});

	test('setContent normalizes empty offsets, a negative row count and invalid widths', () => {
		const h = harness();
		try {
			h.scroll.setContent({
				rowCount: -3.7,
				offsets: [],
				totalHeight: 999,
				contentWidth: -5,
				contentWidths: [Number.NaN, 0]
			});
			assert.deepStrictEqual(h.scroll.offsets, [0]);
			assert.strictEqual(h.scroll.rowCount, 0);
			assert.deepStrictEqual(h.scroll.contentWidths, [0, 0]);
			assert.strictEqual(h.scroll.contentWidth, 0);
			assert.strictEqual(h.scroll.getContentElement().style.values['height'], '0px');
			assert.strictEqual(h.scroll.getHorizontalBar(0).hidden, true);
			assert.strictEqual(h.scroll.getHorizontalBar(1).hidden, true);
			assert.strictEqual(h.scroll.hbars.hidden, true);
		} finally {
			h.restore();
		}
	});

	test('a horizontal wheel scrolls the pane under the pointer and clamps at the maximum', () => {
		const h = harness();
		try {
			h.scroll.setContent({
				rowCount: 2,
				offsets: [0, 20, 40],
				totalHeight: 40,
				contentWidth: 500,
				contentWidths: [300, 500]
			});
			h.scroll.getHorizontalBar(0).clientWidth = 100;
			h.scroll.getHorizontalBar(1).clientWidth = 100;
			const prevented: number[] = [];
			const wheel = (deltaX: number, deltaY: number, shiftKey: boolean, target: unknown): void => {
				h.scroll.scroll.listeners['wheel']({
					shiftKey,
					deltaX,
					deltaY,
					target,
					preventDefault: () => prevented.push(1)
				});
			};
			const leftPane = h.scroll.getPane(0);
			const rightPane = h.scroll.getPane(1);
			wheel(120, 10, false, { closest: () => rightPane });
			assert.strictEqual(h.scroll.getScrollLeft(1), 120, 'the pane under the pointer moves');
			assert.strictEqual(h.scroll.getScrollLeft(0), 0, 'the other pane stays');
			assert.strictEqual(prevented.length, 1);
			wheel(0, 999, true, { closest: () => rightPane });
			assert.strictEqual(h.scroll.getScrollLeft(1), 400, 'shift+wheel clamps to content minus viewport');
			wheel(200, 10, false, { closest: () => leftPane });
			assert.strictEqual(h.scroll.getScrollLeft(0), 200, 'deltaX wins when it is larger');
			wheel(10, 120, false, { closest: () => leftPane });
			assert.strictEqual(h.scroll.getScrollLeft(0), 200, 'a vertical wheel is untouched');
			wheel(0, 0, true, { closest: () => leftPane });
			assert.strictEqual(prevented.length, 3, 'a zero delta does not prevent the default');
			h.scroll.getHorizontalBar(0).scrollLeft = 100;
			wheel(50, 0, false, null);
			assert.strictEqual(h.scroll.getScrollLeft(0), 150, 'no pane falls back to the first bar');
		} finally {
			h.restore();
		}
	});

	test('a horizontal bar scroll mirrors only when diff sync is on and moves at least one pixel', () => {
		const h = harness();
		try {
			h.scroll.setContent({ rowCount: 2, offsets: [0, 20, 40], totalHeight: 40, contentWidth: 500 });
			h.scroll.getHorizontalBar(0).scrollLeft = 40;
			h.scroll.getHorizontalBar(1).scrollLeft = 40.5;
			h.scroll.getHorizontalBar(0).listeners['scroll']();
			assert.strictEqual(h.scroll.getScrollLeft(1), 40.5, 'sync is off by default');
			h.scroll.callbacks.syncHorizontal = true;
			h.scroll.getHorizontalBar(0).scrollLeft = 41;
			h.scroll.getHorizontalBar(1).scrollLeft = 40.5;
			h.scroll.getHorizontalBar(0).listeners['scroll']();
			assert.strictEqual(h.scroll.getScrollLeft(1), 40.5, 'a sub-pixel difference is left alone');
			h.scroll.getHorizontalBar(0).scrollLeft = 42;
			h.scroll.getHorizontalBar(1).scrollLeft = 40;
			h.scroll.getHorizontalBar(0).listeners['scroll']();
			assert.strictEqual(h.scroll.getScrollLeft(1), 42, 'a whole-pixel difference mirrors');
		} finally {
			h.restore();
		}
	});

	test('scrollToIndex honours start, end and auto alignment and guards an empty model', () => {
		const h = harness();
		try {
			h.scroll.scroll.clientHeight = 40;
			h.scroll.setContent({ rowCount: 5, offsets: [0, 20, 40, 60, 80, 100], totalHeight: 100, contentWidth: 100 });
			h.scroll.setScrollTop(20);
			h.scroll.scrollToIndex(0, 'auto');
			assert.strictEqual(h.scroll.getScrollTop(), 0, 'a row above the viewport scrolls to its top');
			h.scroll.scrollToIndex(1, 'auto');
			assert.strictEqual(h.scroll.getScrollTop(), 0, 'a fully visible row does not move');
			h.scroll.scrollToIndex(4, 'end');
			assert.strictEqual(h.scroll.getScrollTop(), 60, 'end alignment puts the row bottom at the viewport bottom');
			h.scroll.scrollToIndex(0, 'start');
			assert.strictEqual(h.scroll.getScrollTop(), 0);
			h.scroll.scrollToIndex(999, 'start');
			assert.strictEqual(h.scroll.getScrollTop(), 80, 'the index clamps to the last row');
			h.scroll.setContent({ rowCount: 0, offsets: [0], totalHeight: 0, contentWidth: 0 });
			h.scroll.setScrollTop(10);
			h.scroll.scrollToIndex(0, 'start');
			assert.strictEqual(h.scroll.getScrollTop(), 10, 'an empty model is left alone');
		} finally {
			h.restore();
		}
	});
});
