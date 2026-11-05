/**
 * The shared virtual scroll surface.
 *
 * It owns the vertical scroller, the horizontal scrollbar, the cumulative
 * offsets and the visible range. Content panes are children of the tall
 * content element; each pane renders only the requested window. The docs view
 * never owns a scrollbar.
 */
import './virtualScroll.css';
import {
	rowAtOffsetFromOffsets,
	totalHeightOf,
	visibleRangeFromOffsets,
} from '../../render/virtualScroll';

export interface VirtualScrollPane {
	/** Stable DOM id used by the page and its tests. */
	id: string;
	className?: string;
	role?: string;
	label?: string;
	/** `left` / `right` add the diff split edge classes; `single` is full width. */
	side?: 'left' | 'right' | 'single';
}

export interface VirtualScrollContent {
	rowCount: number;
	offsets: readonly number[];
	totalHeight: number;
	contentWidth: number;
	/** Optional per-pane horizontal extents; falls back to `contentWidth`. */
	contentWidths?: readonly number[];
}

export interface VirtualScrollViewport {
	top: number;
	left: number;
	/** Per-pane horizontal offsets; `left` mirrors pane 0. */
	lefts?: readonly number[];
	height: number;
	width: number;
}

export interface VirtualScrollCallbacks {
	onViewportChange?(viewport: VirtualScrollViewport): void;
}

export class VirtualScroll {
	root: any;
	panes: VirtualScrollPane[];
	callbacks: VirtualScrollCallbacks;
	scroll: any;
	content: any;
	hbars: any;
	hscroll: any;
	hspacer: any;
	hscrolls: any[];
	hspacers: any[];
	paneElements: any[];
	offsets: readonly number[];
	rowCount: number;
	contentWidth: number;
	contentWidths: number[];
	bufferSize: number;
	frame: number;
	mounted: boolean;

	constructor(rootSelector: string, panes: readonly VirtualScrollPane[], callbacks: VirtualScrollCallbacks = {}) {
		this.root = document.querySelector(rootSelector);
		this.panes = [...panes];
		this.callbacks = callbacks;
		this.scroll = undefined;
		this.content = undefined;
		this.hbars = undefined;
		this.hscroll = undefined;
		this.hspacer = undefined;
		this.hscrolls = [];
		this.hspacers = [];
		this.paneElements = [];
		this.offsets = [0];
		this.rowCount = 0;
		this.contentWidth = 0;
		this.contentWidths = [];
		this.bufferSize = 10;
		this.frame = 0;
		this.mounted = false;
	}

	mount(): void {
		if (!this.root || this.mounted) {
			return;
		}
		this.mounted = true;
		this.root.textContent = '';
		if (this.root.classList) {
			this.root.classList.add('virtual-scroll');
		}

		this.scroll = document.createElement('div');
		this.scroll.className = 'virtual-scroll-vscroll';
		this.scroll.setAttribute('role', 'presentation');
		this.content = document.createElement('div');
		this.content.className = 'virtual-scroll-content';
		this.content.setAttribute('role', 'presentation');
		this.scroll.appendChild(this.content);

		this.hbars = document.createElement('div');
		this.hbars.className = 'virtual-scroll-hbars';
		this.hbars.setAttribute('role', 'presentation');
		this.hscrolls = [];
		this.hspacers = [];
		for (let at = 0; at < this.panes.length; at++) {
			const spec = this.panes[at];
			const bar = document.createElement('div');
			bar.className = 'virtual-scroll-hscroll virtual-scroll-hscroll-' + (spec.side ?? 'single');
			bar.setAttribute('role', 'presentation');
			bar.dataset.pane = String(at);
			const spacer = document.createElement('div');
			spacer.className = 'virtual-scroll-hspacer';
			bar.appendChild(spacer);
			bar.addEventListener('scroll', () => this.schedule());
			this.hbars.appendChild(bar);
			this.hscrolls.push(bar);
			this.hspacers.push(spacer);
		}
		this.hscroll = this.hscrolls[0];
		this.hspacer = this.hspacers[0];

		for (const spec of this.panes) {
			const pane = document.createElement('div');
			pane.id = spec.id;
			const side = spec.side ?? 'single';
			pane.className = [
				'virtual-scroll-pane',
				'virtual-scroll-pane-' + side,
				spec.className ?? '',
			]
				.filter((part) => part !== '')
				.join(' ');
			if (spec.role) {
				pane.setAttribute('role', spec.role);
			}
			if (spec.label) {
				pane.setAttribute('aria-label', spec.label);
			}
			this.paneElements.push(pane);
			this.content.appendChild(pane);
		}

		this.scroll.addEventListener('scroll', () => this.schedule());
		this.scroll.addEventListener(
			'wheel',
			(event: any) => this.onWheel(event),
			{ passive: false }
		);

		this.root.appendChild(this.scroll);
		this.root.appendChild(this.hbars);
		this.applyContent();
	}

	getContentElement(): any {
		return this.content;
	}

	getPane(index: number): any {
		return this.paneElements[index];
	}

	getPaneById(id: string): any {
		return this.paneElements.find((pane) => pane.id === id);
	}

	setContent(content: VirtualScrollContent): void {
		this.offsets = content.offsets && content.offsets.length > 0 ? content.offsets : [0];
		this.rowCount = Math.max(0, Math.floor(content.rowCount || 0));
		const fallback = Number.isFinite(content.contentWidth) && content.contentWidth > 0 ? content.contentWidth : 0;
		const widths =
			content.contentWidths && content.contentWidths.length > 0 ? content.contentWidths : this.panes.map(() => fallback);
		this.contentWidths = this.panes.map((_, at) => {
			const value = widths[at] ?? fallback;
			return Number.isFinite(value) && value > 0 ? value : 0;
		});
		this.contentWidth = this.contentWidths[0] ?? 0;
		this.applyContent();
		this.schedule();
	}

	/** Grow every horizontal extent without rebuilding the row offsets. */
	setContentWidth(width: number): void {
		const next = Number.isFinite(width) && width > 0 ? width : 0;
		let changed = false;
		for (let at = 0; at < this.contentWidths.length; at++) {
			if (next > this.contentWidths[at]) {
				this.contentWidths[at] = next;
				changed = true;
			}
		}
		if (!changed) {
			return;
		}
		this.contentWidth = this.contentWidths[0] ?? 0;
		this.applyContent();
	}

	/** Set one pane's horizontal extent. */
	setPaneContentWidth(index: number, width: number): void {
		if (index < 0 || index >= this.contentWidths.length) {
			return;
		}
		const next = Number.isFinite(width) && width > 0 ? width : 0;
		if (next <= this.contentWidths[index]) {
			return;
		}
		this.contentWidths[index] = next;
		if (index === 0) {
			this.contentWidth = next;
		}
		this.applyContent();
	}

	getViewport(): VirtualScrollViewport {
		return this.getViewportFor(0);
	}

	getViewportFor(index: number): VirtualScrollViewport {
		const safe = Math.max(0, Math.min(index, Math.max(0, this.panes.length - 1)));
		const lefts = this.panes.map((_, at) => this.getScrollLeft(at));
		return {
			top: this.getScrollTop(),
			left: lefts[safe] ?? 0,
			lefts: lefts,
			height: this.clientHeight(),
			width: this.clientWidth(),
		};
	}

	getHorizontalBar(index: number): any {
		return this.hscrolls[index];
	}

	getVisibleRange(): [number, number] {
		return visibleRangeFromOffsets(
			this.offsets,
			this.getScrollTop(),
			this.clientHeight(),
			this.bufferSize
		);
	}

	setScrollTop(top: number, defer = false): void {
		if (!this.scroll) {
			return;
		}
		const next = Number.isFinite(top) ? Math.max(0, top) : 0;
		this.scroll.scrollTop = next;
		if (defer) {
			this.schedule();
		} else {
			this.emit();
		}
	}

	getScrollTop(): number {
		return this.scroll ? this.scroll.scrollTop : 0;
	}

	setScrollLeft(left: number, defer = false): void {
		this.setPaneScrollLeft(0, left, defer);
	}

	setPaneScrollLeft(index: number, left: number, defer = false): void {
		const bar = this.hscrolls[index];
		if (!bar) {
			return;
		}
		const next = Number.isFinite(left) ? Math.max(0, left) : 0;
		bar.scrollLeft = next;
		if (defer) {
			this.schedule();
		} else {
			this.emit();
		}
	}

	getScrollLeft(index = 0): number {
		const bar = this.hscrolls[index];
		return bar ? bar.scrollLeft : 0;
	}

	clientHeight(): number {
		return this.scroll ? this.scroll.clientHeight : 0;
	}

	clientWidth(): number {
		return this.scroll ? this.scroll.clientWidth : 0;
	}

	scrollToIndex(index: number, align?: 'auto' | 'start' | 'end'): void {
		if (this.rowCount <= 0) {
			return;
		}
		const at = Math.max(0, Math.min(Math.floor(index), this.rowCount - 1));
		const offset = this.offsets[at] ?? 0;
		const height = Math.max(0, (this.offsets[at + 1] ?? offset) - offset);
		const viewTop = this.getScrollTop();
		const viewHeight = this.clientHeight();
		if (align === 'start' || (align !== 'end' && offset < viewTop)) {
			this.setScrollTop(offset);
		} else if (align === 'end' || offset + height > viewTop + viewHeight) {
			this.setScrollTop(offset + height - viewHeight);
		}
	}

	render(): void {
		this.emit();
	}

	destroy(): void {
		if (this.frame !== 0 && typeof cancelAnimationFrame === 'function') {
			cancelAnimationFrame(this.frame);
		}
		this.frame = 0;
		this.mounted = false;
	}

	private applyContent(): void {
		if (!this.content) {
			return;
		}
		const height = totalHeightOf(this.offsets);
		if (this.content.style && typeof this.content.style.setProperty === 'function') {
			this.content.style.setProperty('height', height + 'px');
		}
		for (let at = 0; at < this.hspacers.length; at++) {
			const spacer = this.hspacers[at];
			const width = this.contentWidths[at] ?? 0;
			if (spacer.style && typeof spacer.style.setProperty === 'function') {
				spacer.style.setProperty('width', width + 'px');
			}
			if (this.hscrolls[at]) {
				this.hscrolls[at].hidden = width <= 0;
			}
		}
		if (this.hbars) {
			this.hbars.hidden = this.hspacers.every((_, at) => (this.contentWidths[at] ?? 0) <= 0);
		}
	}

	private onWheel(event: any): void {
		if (!event || this.hscrolls.length === 0) {
			return;
		}
		const horizontal = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
		if (!horizontal) {
			return;
		}
		const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
		if (!delta) {
			return;
		}
		const target = event.target;
		const pane = target && target.closest ? target.closest('.virtual-scroll-pane') : null;
		const index = pane ? Math.max(0, this.paneElements.indexOf(pane)) : 0;
		const bar = this.hscrolls[index] ?? this.hscrolls[0];
		if (!bar) {
			return;
		}
		if (typeof event.preventDefault === 'function') {
			event.preventDefault();
		}
		const max = Math.max(0, (this.contentWidths[index] ?? 0) - (bar.clientWidth || 0));
		bar.scrollLeft = Math.max(0, Math.min(bar.scrollLeft + delta, max));
		this.schedule();
	}

	private schedule(): void {
		if (this.frame !== 0) {
			return;
		}
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			this.emit();
		});
	}

	private emit(): void {
		if (this.callbacks.onViewportChange) {
			this.callbacks.onViewportChange(this.getViewport());
		}
	}
}
