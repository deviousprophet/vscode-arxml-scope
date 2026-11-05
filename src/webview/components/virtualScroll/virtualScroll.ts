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
}

export interface VirtualScrollViewport {
	top: number;
	left: number;
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
	hscroll: any;
	hspacer: any;
	paneElements: any[];
	offsets: readonly number[];
	rowCount: number;
	contentWidth: number;
	bufferSize: number;
	frame: number;
	mounted: boolean;

	constructor(rootSelector: string, panes: readonly VirtualScrollPane[], callbacks: VirtualScrollCallbacks = {}) {
		this.root = document.querySelector(rootSelector);
		this.panes = [...panes];
		this.callbacks = callbacks;
		this.scroll = undefined;
		this.content = undefined;
		this.hscroll = undefined;
		this.hspacer = undefined;
		this.paneElements = [];
		this.offsets = [0];
		this.rowCount = 0;
		this.contentWidth = 0;
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

		this.hscroll = document.createElement('div');
		this.hscroll.className = 'virtual-scroll-hscroll';
		this.hscroll.setAttribute('role', 'presentation');
		this.hspacer = document.createElement('div');
		this.hspacer.className = 'virtual-scroll-hspacer';
		this.hscroll.appendChild(this.hspacer);

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
		this.hscroll.addEventListener('scroll', () => this.onHorizontalScroll());

		this.root.appendChild(this.scroll);
		this.root.appendChild(this.hscroll);
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
		this.contentWidth = Number.isFinite(content.contentWidth) && content.contentWidth > 0 ? content.contentWidth : 0;
		this.applyContent();
		this.schedule();
	}

	/** Grow the horizontal extent without rebuilding the row offsets. */
	setContentWidth(width: number): void {
		const next = Number.isFinite(width) && width > 0 ? width : 0;
		if (next <= this.contentWidth) {
			return;
		}
		this.contentWidth = next;
		this.applyContent();
	}

	getViewport(): VirtualScrollViewport {
		return {
			top: this.getScrollTop(),
			left: this.getScrollLeft(),
			height: this.clientHeight(),
			width: this.clientWidth(),
		};
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
		if (!this.hscroll) {
			return;
		}
		const next = Number.isFinite(left) ? Math.max(0, left) : 0;
		this.hscroll.scrollLeft = next;
		if (defer) {
			this.schedule();
		} else {
			this.emit();
		}
	}

	getScrollLeft(): number {
		return this.hscroll ? this.hscroll.scrollLeft : 0;
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
		if (!this.content || !this.hspacer) {
			return;
		}
		const height = totalHeightOf(this.offsets);
		if (this.content.style && typeof this.content.style.setProperty === 'function') {
			this.content.style.setProperty('height', height + 'px');
		}
		if (this.hspacer.style && typeof this.hspacer.style.setProperty === 'function') {
			this.hspacer.style.setProperty('width', this.contentWidth + 'px');
		}
		if (this.hscroll) {
			this.hscroll.hidden = this.contentWidth <= 0;
		}
	}

	private onHorizontalScroll(): void {
		this.schedule();
	}

	private onWheel(event: any): void {
		if (!event || !this.hscroll) {
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
		if (typeof event.preventDefault === 'function') {
			event.preventDefault();
		}
		const max = Math.max(0, this.contentWidth - (this.hscroll.clientWidth || 0));
		this.hscroll.scrollLeft = Math.max(0, Math.min(this.hscroll.scrollLeft + delta, max));
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
