/**
 * The reusable Document tree surface.
 *
 * One `DocumentTreeView` owns the schema/package header, the native vertical and
 * horizontal scroller, the virtual spacers and the rendered window. The header
 * is the scroller's first content element, so it scrolls away with the rows.
 * The host owns the row model, selection and search: `renderRow(index, pane)`
 * builds one row and the component only decides which rows are on screen and
 * where the scroll is.
 *
 * The editor mounts one instance, the diff mounts one per pane. Both pages import
 * the same class and the same virtual-scroll math; nothing is serialized into a
 * page template.
 *
 * The component never writes a style attribute with model text. The only CSSOM
 * writes are its own geometry custom properties (`--document-tree-*`), the same
 * technique the sidebar uses, which the nonce CSP allows.
 */
import './documentTree.css';
import { calcRowOffset, calcTotalHeight, calcVisibleRange } from '../../render/virtualScroll';

/** One schema/package header line, in Document order. */
export interface DocumentTreeHeader {
	/** File label shown above the meta lines; the editor omits it. */
	title?: string;
	/** Tooltip for the title (the full path in the diff). */
	titleTitle?: string;
	schema?: string;
	packages?: readonly string[];
	/**
	 * Minimum meta-line count. A shorter header is padded so two panes that sit
	 * side by side start their rows at the same y.
	 */
	lines?: number;
}

/** What the host supplies: row count, deterministic heights and row markup. */
export interface DocumentTreeViewModel {
	rowCount: number;
	heightFn(index: number): number;
	/** Build the row for this pane; the host decides node/brace/comment/status. */
	renderRow(index: number, pane: string): any;
	/**
	 * Stable horizontal content width in pixels. When present the window gets a
	 * min-width so the native horizontal scrollbar covers the longest line even
	 * when the current virtual window is narrower.
	 */
	contentWidth?: number;
}

export interface DocumentTreeViewCallbacks {
	onVisibleWindowChange?(top: number, left: number): void;
	onRowClick?(index: number, event: any): void;
	/** Called after a window render with the slice that was rendered. */
	onRender?(range: [number, number]): void;
}

/** The default overscan; small and fixed so one frame stays O(viewport). */

export class DocumentTreeView {
	root: any;
	pane: string;
	callbacks: DocumentTreeViewCallbacks;
	model: DocumentTreeViewModel | undefined;
	header: any;
	title: any;
	meta: any;
	scroll: any;
	topSpacer: any;
	windowEl: any;
	bottomSpacer: any;
	bufferSize: number;
	frame: number;
	revision: number;
	lastKey: string;
	renderedStart: number | undefined;
	renderedEnd: number | undefined;
	renderedRevision: number;
	contentWidth: number;
	padTop: number;
	headerH: number;
	expectedTop: number | undefined;
	expectedLeft: number | undefined;
	pendingNotify: boolean;

	constructor(rootSelector: string, pane: string, callbacks?: DocumentTreeViewCallbacks) {
		this.root = document.querySelector(rootSelector);
		this.pane = pane;
		this.callbacks = callbacks || {};
		this.model = undefined;
		this.header = undefined;
		this.title = undefined;
		this.meta = undefined;
		this.scroll = undefined;
		this.topSpacer = undefined;
		this.windowEl = undefined;
		this.bottomSpacer = undefined;
		this.bufferSize = 10;
		this.frame = 0;
		this.revision = 0;
		this.lastKey = '';
		this.renderedStart = undefined;
		this.renderedEnd = undefined;
		this.renderedRevision = -1;
		this.contentWidth = 0;
		this.padTop = -1;
		this.headerH = -1;
		this.expectedTop = undefined;
		this.expectedLeft = undefined;
		this.pendingNotify = false;
	}

	/** Create `root > scroll > header + top/window/bottom`. Idempotent. */
	mount(): void {
		if (!this.root) {
			return;
		}
		this.root.textContent = '';
		if (this.root.classList) {
			this.root.classList.add('document-tree');
		}
		this.header = document.createElement('div');
		this.header.className = 'document-tree-header';
		this.header.setAttribute('role', 'presentation');
		this.title = document.createElement('div');
		this.title.className = 'document-tree-title';
		this.title.hidden = true;
		this.meta = document.createElement('div');
		this.meta.className = 'document-tree-meta';
		this.header.appendChild(this.title);
		this.header.appendChild(this.meta);

		this.scroll = document.createElement('div');
		this.scroll.className = 'document-tree-scroll';
		this.scroll.setAttribute('role', 'presentation');
		this.topSpacer = this.spacer('document-tree-top');
		this.windowEl = document.createElement('div');
		this.windowEl.className = 'document-tree-window';
		this.windowEl.setAttribute('role', 'presentation');
		this.bottomSpacer = this.spacer('document-tree-bottom');
		// The header is content, not a pinned strip: it scrolls away with the
		// rows, so it lives inside the scroller before the top spacer.
		this.scroll.appendChild(this.header);
		this.scroll.appendChild(this.topSpacer);
		this.scroll.appendChild(this.windowEl);
		this.scroll.appendChild(this.bottomSpacer);

		this.root.appendChild(this.scroll);

		this.scroll.addEventListener('scroll', () => this.onScroll());
		this.scroll.addEventListener('wheel', (event: any) => this.onWheel(event), { passive: false });
		this.scroll.addEventListener('click', (event: any) => this.onClick(event));
		this.padTop = -1;
		this.headerH = -1;
		this.setEmpty(false);
	}

	/** Replace the schema/package header (and optional file label). */
	setHeader(header?: DocumentTreeHeader): void {
		this.headerH = -1;
		if (!this.meta || !this.title) {
			return;
		}
		this.meta.textContent = '';
		const title = header && header.title ? header.title : '';
		this.title.textContent = title;
		this.title.title = header && header.titleTitle ? header.titleTitle : title;
		this.title.hidden = title === '';
		if (!header) {
			return;
		}
		let used = 0;
		if (header.schema) {
			this.meta.appendChild(this.headerLine('schema', 'number', header.schema));
			used++;
		}
		for (const pkg of header.packages || []) {
			this.meta.appendChild(this.headerLine('package', '', pkg));
			used++;
		}
		const wanted = typeof header.lines === 'number' && header.lines > used ? Math.floor(header.lines) : used;
		while (used < wanted) {
			// Pad with a blank line so a shorter pane's rows start at the same y.
			const blank = document.createElement('div');
			blank.className = 'package';
			blank.appendChild(document.createTextNode('\u00a0'));
			this.meta.appendChild(blank);
			used++;
		}
	}

	/** Install or replace the row model. */
	setModel(model: DocumentTreeViewModel): void {
		this.model = model;
		this.padTop = -1;
		this.setContentWidth(model && typeof model.contentWidth === 'number' ? model.contentWidth : 0);
		this.invalidate();
	}

	/** The horizontal content width; 0 leaves the natural width alone. */
	setContentWidth(width: number): void {
		this.contentWidth = Number.isFinite(width) && width > 0 ? width : 0;
		if (this.windowEl && this.windowEl.style && typeof this.windowEl.style.setProperty === 'function') {
			this.windowEl.style.setProperty('--document-tree-content-width', this.contentWidth + 'px');
		}
	}

	/** Force the next render to rebuild even when the slice key matches. */
	invalidate(): void {
		this.revision++;
		this.lastKey = '';
	}

	/**
	 * Render the visible slice plus the fixed overscan. A render whose range,
	 * total height, viewport size and revision are unchanged does no DOM work.
	 */
	render(force?: boolean): void {
		this.headerH = -1;
		if (!this.scroll || !this.windowEl) {
			return;
		}
		const model = this.model;
		const rowCount = model ? Math.max(0, Math.floor(model.rowCount || 0)) : 0;
		this.setEmpty(rowCount === 0);
		if (!model || rowCount === 0) {
			this.windowEl.textContent = '';
			this.setSpacers(0, 0);
			this.lastKey = '';
			this.renderedStart = undefined;
			this.renderedEnd = undefined;
			this.renderedRevision = -1;
			if (this.callbacks.onRender) {
				this.callbacks.onRender([0, 0]);
			}
			return;
		}
		const state = this.virtualState();
		const range = calcVisibleRange(state);
		const start = range[0];
		const end = range[1];
		const total = calcTotalHeight(state);
		const key =
			start +
			':' +
			end +
			':' +
			total +
			':' +
			this.scroll.clientHeight +
			':' +
			this.scroll.clientWidth +
			':' +
			this.revision;
		if (!force && key === this.lastKey) {
			return;
		}
		this.lastKey = key;
		const top = calcRowOffset(start, state);
		this.setSpacers(top, Math.max(0, total - calcRowOffset(end, state)));
		const focused = this.focusedIndex();
		const overlap =
			this.renderedStart !== undefined &&
			this.renderedEnd !== undefined &&
			start < this.renderedEnd &&
			end > this.renderedStart;
		const full = force === true || this.renderedRevision !== this.revision || !overlap;
		if (full) {
			const fragment = document.createDocumentFragment();
			for (let at = start; at < end; at++) {
				fragment.appendChild(this.buildRow(model, at));
			}
			this.windowEl.textContent = '';
			this.windowEl.appendChild(fragment);
			this.renderedStart = start;
			this.renderedEnd = end;
		} else {
			const windowEl = this.windowEl;
			while (this.renderedStart !== undefined && this.renderedStart < start) {
				windowEl.removeChild(windowEl.firstChild);
				this.renderedStart++;
			}
			while (this.renderedEnd !== undefined && this.renderedEnd > end) {
				windowEl.removeChild(windowEl.lastChild);
				this.renderedEnd--;
			}
			while (this.renderedStart !== undefined && this.renderedStart > start) {
				this.renderedStart--;
				windowEl.insertBefore(this.buildRow(model, this.renderedStart), windowEl.firstChild);
			}
			while (this.renderedEnd !== undefined && this.renderedEnd < end) {
				windowEl.appendChild(this.buildRow(model, this.renderedEnd));
				this.renderedEnd++;
			}
		}
		this.renderedRevision = this.revision;
		if (focused !== undefined) {
			const element = this.elementAt(focused);
			if (element && typeof element.focus === 'function') {
				element.focus({ preventScroll: true });
			}
		}
		if (this.callbacks.onRender) {
			this.callbacks.onRender([start, end]);
		}
	}

	buildRow(model: DocumentTreeViewModel, index: number): any {
		const element = model.renderRow(index, this.pane);
		if (!element) {
			return document.createTextNode('');
		}
		if (element.dataset) {
			element.dataset.documentIndex = String(index);
		}
		return element;
	}

	/** The scroll offset of the rows region, excluding the top padding. */
	padTopHeight(): number {
		if (this.padTop >= 0) {
			return this.padTop;
		}
		let value = 0;
		if (this.scroll) {
			try {
				const style = getComputedStyle(this.scroll);
				value = parseFloat(style.paddingTop) || 0;
			} catch (error) {
				value = 0;
			}
		}
		this.padTop = value;
		return value;
	}

	/**
	 * The header's measured height. The header is inside the scroller, so every
	 * row offset is shifted by it; `0` means the header is absent or not
	 * measurable yet (jsdom has no layout). Re-measured after `setHeader`,
	 * `render` and the host's resize render.
	 */
	headerHeight(): number {
		if (this.headerH >= 0) {
			return this.headerH;
		}
		let value = 0;
		if (this.header) {
			const measured = this.header.offsetHeight;
			if (typeof measured === 'number' && Number.isFinite(measured) && measured > 0) {
				value = measured;
			}
		}
		this.headerH = value;
		return value;
	}

	/** The visible rows' top edge, in the same coordinates as the virtual math. */
	getRowsScrollTop(): number {
		return this.scroll
			? Math.max(0, this.scroll.scrollTop - this.padTopHeight() - this.headerHeight())
			: 0;
	}

	/** Move the rows region to a logical offset (the header and top padding are added back). */
	setRowsScrollTop(offset: number): void {
		this.setScrollTop(
			(Number.isFinite(offset) ? Math.max(0, offset) : 0) + this.padTopHeight() + this.headerHeight()
		);
	}

	setScrollTop(top: number): void {
		if (!this.scroll) {
			return;
		}
		const next = Number.isFinite(top) ? Math.max(0, top) : 0;
		this.expectedTop = next;
		this.scroll.scrollTop = next;
		this.render(false);
	}

	getScrollTop(): number {
		return this.scroll ? this.scroll.scrollTop : 0;
	}

	setScrollLeft(left: number): void {
		if (!this.scroll) {
			return;
		}
		const next = Number.isFinite(left) ? Math.max(0, left) : 0;
		this.expectedLeft = next;
		this.scroll.scrollLeft = next;
	}

	getScrollLeft(): number {
		return this.scroll ? this.scroll.scrollLeft : 0;
	}

	clientHeight(): number {
		return this.scroll ? this.scroll.clientHeight : 0;
	}

	clientWidth(): number {
		return this.scroll ? this.scroll.clientWidth : 0;
	}

	/** The window element, for a host that needs to inspect the rendered rows. */
	getWindowElement(): any {
		return this.windowEl;
	}

	/** The row range currently rendered, including overscan. */
	getVisibleRange(): [number, number] {
		if (!this.model || !this.scroll) {
			return [0, 0];
		}
		return calcVisibleRange(this.virtualState());
	}

	/**
	 * Scroll `index` into view. `auto` only moves when the row is outside the
	 * viewport; `start`/`end` align it explicitly.
	 */
	scrollToIndex(index: number, align?: 'auto' | 'start' | 'end'): void {
		if (!this.model || !this.scroll) {
			return;
		}
		const rowCount = Math.max(0, Math.floor(this.model.rowCount || 0));
		if (rowCount === 0) {
			return;
		}
		const at = Math.max(0, Math.min(Math.floor(index), rowCount - 1));
		const state = this.virtualState();
		const offset = calcRowOffset(at, state);
		const height = Math.max(0, this.model.heightFn(at));
		const viewTop = this.getRowsScrollTop();
		const viewHeight = this.scroll.clientHeight;
		if (align === 'start' || (align !== 'end' && offset < viewTop)) {
			this.setRowsScrollTop(offset);
		} else if (align === 'end' || offset + height > viewTop + viewHeight) {
			this.setRowsScrollTop(offset + height - viewHeight);
		}
	}

	destroy(): void {
		this.model = undefined;
		if (this.frame !== 0 && typeof cancelAnimationFrame === 'function') {
			cancelAnimationFrame(this.frame);
		}
		this.frame = 0;
	}

	/* -- internals ------------------------------------------------------- */

	virtualState(): any {
		const model = this.model;
		return {
			rowCount: model ? model.rowCount : 0,
			rowHeight: model ? model.heightFn : this.zeroHeight,
			containerHeight: this.scroll ? this.scroll.clientHeight : 0,
			scrollTop: this.getRowsScrollTop(),
			bufferSize: this.bufferSize,
			heightVersion: this.revision,
		};
	}

	zeroHeight(): number {
		return 0;
	}

	spacer(className: string): any {
		const element = document.createElement('div');
		element.className = 'v-spacer ' + className;
		element.setAttribute('role', 'presentation');
		element.setAttribute('aria-hidden', 'true');
		return element;
	}

	headerLine(keyword: string, valueClass: string, text: string): any {
		const line = document.createElement('div');
		line.className = keyword;
		const key = document.createElement('span');
		key.className = 'keyword';
		key.textContent = keyword;
		line.appendChild(key);
		line.appendChild(document.createTextNode(' '));
		if (valueClass) {
			const value = document.createElement('span');
			value.className = valueClass;
			value.textContent = text;
			line.appendChild(value);
		} else {
			line.appendChild(document.createTextNode(text));
		}
		return line;
	}

	setEmpty(empty: boolean): void {
		if (this.scroll && this.scroll.dataset) {
			this.scroll.dataset.empty = empty ? 'true' : 'false';
		}
	}

	setSpacers(top: number, bottom: number): void {
		if (!this.scroll || !this.scroll.style || typeof this.scroll.style.setProperty !== 'function') {
			return;
		}
		this.scroll.style.setProperty('--document-tree-top', Math.max(0, top) + 'px');
		this.scroll.style.setProperty('--document-tree-bottom', Math.max(0, bottom) + 'px');
	}

	focusedIndex(): number | undefined {
		if (!this.windowEl) {
			return undefined;
		}
		const active = document.activeElement;
		if (!active || active === this.windowEl) {
			return undefined;
		}
		if (typeof this.windowEl.contains === 'function' && !this.windowEl.contains(active)) {
			return undefined;
		}
		const item = active.closest ? (active.closest('[data-document-index]') as HTMLElement | null) : null;
		if (!item || !item.dataset) {
			return undefined;
		}
		const index = Number(item.dataset.documentIndex);
		return Number.isFinite(index) ? index : undefined;
	}

	elementAt(index: number): any {
		if (!this.windowEl || typeof this.windowEl.querySelector !== 'function') {
			return undefined;
		}
		return this.windowEl.querySelector('[data-document-index="' + index + '"]');
	}

	onScroll(): void {
		const topMatched =
			this.expectedTop !== undefined && Math.abs((this.scroll ? this.scroll.scrollTop : 0) - this.expectedTop) < 1;
		const leftMatched =
			this.expectedLeft !== undefined && Math.abs((this.scroll ? this.scroll.scrollLeft : 0) - this.expectedLeft) < 1;
		if (topMatched) {
			this.expectedTop = undefined;
		}
		if (leftMatched) {
			this.expectedLeft = undefined;
		}
		this.schedule(!(topMatched && leftMatched));
	}

	onClick(event: any): void {
		if (!this.callbacks.onRowClick || !this.windowEl) {
			return;
		}
		const target = event ? event.target : undefined;
		const item = target && target.closest ? target.closest('[data-document-index]') : null;
		if (!item || (typeof this.windowEl.contains === 'function' && !this.windowEl.contains(item))) {
			return;
		}
		const index = Number(item.dataset ? item.dataset.documentIndex : NaN);
		if (Number.isFinite(index)) {
			this.callbacks.onRowClick(index, event);
		}
	}

	onWheel(event: any): void {
		if (!event || !event.shiftKey || !this.scroll) {
			return;
		}
		const delta =
			Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
		if (!delta) {
			return;
		}
		if (this.scroll.scrollWidth <= this.scroll.clientWidth) {
			return;
		}
		if (typeof event.preventDefault === 'function') {
			event.preventDefault();
		}
		const max = Math.max(0, this.scroll.scrollWidth - this.scroll.clientWidth);
		this.scroll.scrollLeft = Math.max(0, Math.min(this.scroll.scrollLeft + delta, max));
		this.report();
	}

	schedule(notify: boolean): void {
		this.pendingNotify = this.pendingNotify || notify;
		if (this.frame !== 0) {
			return;
		}
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			const now = this.pendingNotify;
			this.pendingNotify = false;
			this.render(false);
			if (now) {
				this.report();
			}
		});
	}

	report(): void {
		if (this.callbacks.onVisibleWindowChange) {
			this.callbacks.onVisibleWindowChange(this.getScrollTop(), this.getScrollLeft());
		}
	}
}
