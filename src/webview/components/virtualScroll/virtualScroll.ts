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
	/** Mirror every horizontal bar to the bar that moved (diff mode). */
	syncHorizontal?: boolean;
}

/** The wheel event the scroller forwards; DOM and test events both satisfy it. */
interface WheelEventLike {
	shiftKey: boolean;
	deltaX: number;
	deltaY: number;
	target?: { closest?(selector: string): unknown } | null;
	preventDefault?(): void;
}

/** A spacer whose inline width is written only when a style sink exists. */
interface WidthSink {
	style?: { setProperty?(name: string, value: string): void } | null;
}

/** A horizontal bar that disappears when its pane has no horizontal extent. */
interface HideableBar {
	hidden?: boolean;
}

/** A wheel target: the bar it scrolls and the pane index its width comes from. */
interface WheelTarget {
	bar: HTMLElement;
	index: number;
}

/** A width accepted by the surface; every other value is zero. */
function normalizedWidth(value: number): number {
	return Number.isFinite(value) && value > 0 ? value : 0;
}

/** The dominant wheel delta; horizontal intent was already decided. */
function wheelDelta(event: WheelEventLike): number {
	return Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
}

/** Whether auto alignment pulls a row up to the viewport start. */
function isScrollStart(align: string | undefined, offset: number, viewTop: number): boolean {
	return align === 'start' || (align !== 'end' && offset < viewTop);
}

/** Whether auto or end alignment pushes a row down into the viewport. */
function isScrollEnd(
	align: string | undefined,
	offset: number,
	height: number,
	viewTop: number,
	viewHeight: number
): boolean {
	return align === 'end' || offset + height > viewTop + viewHeight;
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
		this.addRootClass();
		this.buildScroller();
		this.buildHorizontalBars();
		this.buildPanes();
		this.bindScrollEvents();
		this.root.appendChild(this.scroll);
		this.root.appendChild(this.hbars);
		this.applyContent();
	}

	private addRootClass(): void {
		if (this.root.classList) {
			this.root.classList.add('virtual-scroll');
		}
	}

	private buildScroller(): void {
		this.scroll = document.createElement('div');
		this.scroll.className = 'virtual-scroll-vscroll';
		this.scroll.setAttribute('role', 'presentation');
		this.content = document.createElement('div');
		this.content.className = 'virtual-scroll-content';
		this.content.setAttribute('role', 'presentation');
		this.scroll.appendChild(this.content);
	}

	private buildHorizontalBars(): void {
		this.hbars = document.createElement('div');
		this.hbars.className = 'virtual-scroll-hbars';
		this.hbars.setAttribute('role', 'presentation');
		this.hscrolls = [];
		this.hspacers = [];
		for (let at = 0; at < this.panes.length; at++) {
			this.appendHorizontalBar(at);
		}
		this.hscroll = this.hscrolls[0];
		this.hspacer = this.hspacers[0];
	}

	private appendHorizontalBar(at: number): void {
		const spec = this.panes[at];
		const bar = document.createElement('div');
		bar.className = 'virtual-scroll-hscroll virtual-scroll-hscroll-' + (spec.side ?? 'single');
		bar.setAttribute('role', 'presentation');
		bar.dataset.pane = String(at);
		const spacer = document.createElement('div');
		spacer.className = 'virtual-scroll-hspacer';
		bar.appendChild(spacer);
		bar.addEventListener('scroll', () => this.onHorizontalBarScroll(at));
		this.hbars.appendChild(bar);
		this.hscrolls.push(bar);
		this.hspacers.push(spacer);
	}

	private buildPanes(): void {
		for (const spec of this.panes) {
			this.appendPane(spec);
		}
	}

	private appendPane(spec: VirtualScrollPane): void {
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
		this.applyPaneAttributes(pane, spec);
		this.paneElements.push(pane);
		this.content.appendChild(pane);
	}

	private applyPaneAttributes(pane: HTMLElement, spec: VirtualScrollPane): void {
		if (spec.role) {
			pane.setAttribute('role', spec.role);
		}
		if (spec.label) {
			pane.setAttribute('aria-label', spec.label);
		}
	}

	private bindScrollEvents(): void {
		this.scroll.addEventListener('scroll', () => this.schedule());
		this.scroll.addEventListener(
			'wheel',
			(event: Event) => this.onWheel(event),
			{ passive: false }
		);
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
		this.setContentOffsets(content);
		this.contentWidths = this.contentWidthsFor(content);
		this.contentWidth = this.contentWidths[0] ?? 0;
		this.applyContent();
		this.schedule();
	}

	private setContentOffsets(content: VirtualScrollContent): void {
		this.offsets = content.offsets && content.offsets.length > 0 ? content.offsets : [0];
		this.rowCount = Math.max(0, Math.floor(content.rowCount || 0));
	}

	private contentWidthsFor(content: VirtualScrollContent): number[] {
		const fallback = normalizedWidth(content.contentWidth);
		const widths =
			content.contentWidths && content.contentWidths.length > 0 ? content.contentWidths : this.panes.map(() => fallback);
		return this.panes.map((_, at) => normalizedWidth(widths[at] ?? fallback));
	}

	/** Grow every horizontal extent without rebuilding the row offsets. */
	setContentWidth(width: number): void {
		const next = normalizedWidth(width);
		if (!this.growContentWidths(next)) {
			return;
		}
		this.contentWidth = this.contentWidths[0] ?? 0;
		this.applyContent();
	}

	private growContentWidths(next: number): boolean {
		let changed = false;
		for (let at = 0; at < this.contentWidths.length; at++) {
			if (next > this.contentWidths[at]) {
				this.contentWidths[at] = next;
				changed = true;
			}
		}
		return changed;
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

	/** The width the vertical scrollbar reserves inside the surface. */
	verticalScrollbarWidth(): number {
		if (!this.scroll) {
			return 0;
		}
		const full = Number.isFinite(this.scroll.offsetWidth) ? this.scroll.offsetWidth : 0;
		const client = Number.isFinite(this.scroll.clientWidth) ? this.scroll.clientWidth : 0;
		return Math.max(0, full - client);
	}

	scrollToIndex(index: number, align?: 'auto' | 'start' | 'end'): void {
		if (this.rowCount <= 0) {
			return;
		}
		this.alignScroll(this.clampedRow(index), align);
	}

	private clampedRow(index: number): number {
		return Math.max(0, Math.min(Math.floor(index), this.rowCount - 1));
	}

	private alignScroll(at: number, align?: 'auto' | 'start' | 'end'): void {
		const offset = this.offsets[at] ?? 0;
		const height = this.rowHeightAt(at, offset);
		const viewTop = this.getScrollTop();
		const viewHeight = this.clientHeight();
		if (isScrollStart(align, offset, viewTop)) {
			this.setScrollTop(offset);
		} else if (isScrollEnd(align, offset, height, viewTop, viewHeight)) {
			this.setScrollTop(offset + height - viewHeight);
		}
	}

	private rowHeightAt(at: number, offset: number): number {
		return Math.max(0, (this.offsets[at + 1] ?? offset) - offset);
	}

	render(): void {
		this.emit();
	}

	private onHorizontalBarScroll(index: number): void {
		this.syncHorizontalBars(index);
		this.schedule();
	}

	private syncHorizontalBars(index: number): void {
		if (!this.callbacks.syncHorizontal) {
			return;
		}
		this.mirrorBarScroll(index, this.getScrollLeft(index));
	}

	private mirrorBarScroll(index: number, left: number): void {
		for (let at = 0; at < this.hscrolls.length; at++) {
			this.mirrorSingleBar(at, index, left);
		}
	}

	private mirrorSingleBar(at: number, index: number, left: number): void {
		if (at !== index && Math.abs(this.hscrolls[at].scrollLeft - left) >= 1) {
			this.hscrolls[at].scrollLeft = left;
		}
	}

	private applyContent(): void {
		if (!this.content) {
			return;
		}
		this.setContentHeight(totalHeightOf(this.offsets));
		this.applySpacerWidths();
		this.applyBarsHidden();
	}

	private setContentHeight(height: number): void {
		if (this.content.style && typeof this.content.style.setProperty === 'function') {
			this.content.style.setProperty('height', height + 'px');
		}
	}

	private applySpacerWidths(): void {
		for (let at = 0; at < this.hspacers.length; at++) {
			this.applySpacerWidth(at);
		}
	}

	private applySpacerWidth(at: number): void {
		const width = this.contentWidths[at] ?? 0;
		this.setSpacerWidth(this.hspacers[at], width);
		this.setBarHidden(this.hscrolls[at], width);
	}

	private setSpacerWidth(spacer: WidthSink, width: number): void {
		if (spacer.style && typeof spacer.style.setProperty === 'function') {
			spacer.style.setProperty('width', width + 'px');
		}
	}

	private setBarHidden(bar: HideableBar | undefined, width: number): void {
		if (bar) {
			bar.hidden = width <= 0;
		}
	}

	private applyBarsHidden(): void {
		if (this.hbars) {
			this.hbars.hidden = this.hspacers.every((_, at) => (this.contentWidths[at] ?? 0) <= 0);
		}
	}

	private onWheel(event: any): void {
		const target = this.wheelTarget(event);
		if (!target) {
			return;
		}
		this.scrollWheelTarget(event, target);
	}

	private wheelTarget(event: WheelEventLike | null | undefined): WheelTarget | undefined {
		if (!this.acceptsHorizontalWheel(event)) {
			return undefined;
		}
		const index = this.wheelPaneIndex(event.target);
		const bar: HTMLElement = this.hscrolls[index] ?? this.hscrolls[0];
		return bar ? { bar, index } : undefined;
	}

	private acceptsHorizontalWheel(event: WheelEventLike | null | undefined): event is WheelEventLike {
		if (!event || this.hscrolls.length === 0) {
			return false;
		}
		return event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
	}

	private wheelPaneIndex(target: WheelEventLike['target']): number {
		const pane = target && target.closest ? target.closest('.virtual-scroll-pane') : null;
		if (!pane) {
			return 0;
		}
		return Math.max(0, this.paneElements.indexOf(pane));
	}

	private scrollWheelTarget(event: WheelEventLike, target: WheelTarget): void {
		const delta = wheelDelta(event);
		if (!delta) {
			return;
		}
		this.preventDefault(event);
		this.scrollBarBy(target, delta);
		this.schedule();
	}

	private preventDefault(event: WheelEventLike): void {
		if (typeof event.preventDefault === 'function') {
			event.preventDefault();
		}
	}

	private scrollBarBy(target: WheelTarget, delta: number): void {
		const max = Math.max(0, (this.contentWidths[target.index] ?? 0) - (target.bar.clientWidth || 0));
		target.bar.scrollLeft = Math.max(0, Math.min(target.bar.scrollLeft + delta, max));
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
