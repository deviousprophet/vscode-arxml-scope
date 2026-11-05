/**
 * The reusable Document window renderer.
 *
 * `VirtualScroll` owns the scroll surface and the offsets. This component owns
 * the rendered row window, row markup delivery, focus and click handling. It
 * never creates a scroller, a pinned header or a spacer.
 *
 * The host supplies a virtual row model: the row count, the precomputed
 * cumulative offsets and `renderRow(index, pane)`. Header rows are ordinary
 * indices in that model; the host decides their markup and interaction.
 */
import './documentTree.css';
import { visibleRangeFromOffsets } from '../../render/virtualScroll';

/** One schema/package header line, in Document order. */
export interface DocumentTreeHeader {
	/** File label shown by the diff chrome; the docs view omits it. */
	title?: string;
	/** Tooltip for the title (the full path in the diff). */
	titleTitle?: string;
	schema?: string;
	packages?: readonly string[];
	/** Minimum meta-line count for diff parity. */
	lines?: number;
}

/** What the host supplies: virtual row count, offsets and row markup. */
export interface DocumentTreeViewModel {
	rowCount: number;
	/** Cumulative row offsets, length `rowCount + 1`. */
	offsets: readonly number[];
	/** Build the row for this pane; the host decides header/node/brace/status. */
	renderRow(index: number, pane: string): any;
	contentWidth?: number;
}

export interface DocumentTreeViewport {
	top: number;
	left: number;
	height: number;
	width: number;
}

export interface DocumentTreeViewCallbacks {
	onRowClick?(index: number, event: any): void;
	/** Called after a window render with the slice that was rendered. */
	onRender?(range: [number, number]): void;
}

export class DocumentTreeView {
	root: any;
	pane: string;
	callbacks: DocumentTreeViewCallbacks;
	model: DocumentTreeViewModel | undefined;
	windowEl: any;
	bufferSize: number;
	revision: number;
	lastKey: string;
	renderedStart: number | undefined;
	renderedEnd: number | undefined;
	renderedRevision: number;
	contentWidth: number;
	lastRange: [number, number];
	lastViewport: DocumentTreeViewport | undefined;

	constructor(rootSelector: any, pane: string, callbacks?: DocumentTreeViewCallbacks) {
		this.root = typeof rootSelector === 'string' ? document.querySelector(rootSelector) : rootSelector;
		this.pane = pane;
		this.callbacks = callbacks || {};
		this.model = undefined;
		this.windowEl = undefined;
		this.bufferSize = 10;
		this.revision = 0;
		this.lastKey = '';
		this.renderedStart = undefined;
		this.renderedEnd = undefined;
		this.renderedRevision = -1;
		this.contentWidth = 0;
		this.lastRange = [0, 0];
		this.lastViewport = undefined;
	}

	/** Create the absolutely positioned window inside the pane layer. */
	mount(): void {
		if (!this.root) {
			return;
		}
		this.root.textContent = '';
		this.windowEl = document.createElement('div');
		this.windowEl.className = 'document-tree-window';
		this.windowEl.setAttribute('role', 'presentation');
		this.root.appendChild(this.windowEl);
		this.root.addEventListener('click', (event: any) => this.onClick(event));
		this.revision++;
		this.lastKey = '';
	}

	/** Install or replace the virtual row model. */
	setModel(model: DocumentTreeViewModel): void {
		this.model = model;
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
	 * Render the visible slice plus the fixed overscan. The window is positioned
	 * at the first row's offset and translated by the shared horizontal offset.
	 */
	render(viewport: DocumentTreeViewport, force?: boolean): void {
		if (!this.windowEl) {
			return;
		}
		this.lastViewport = viewport;
		const model = this.model;
		const rowCount = model ? Math.max(0, Math.floor(model.rowCount || 0)) : 0;
		if (!model || rowCount === 0) {
			this.windowEl.textContent = '';
			this.windowEl.style.top = '0px';
			this.windowEl.style.height = '0px';
			this.windowEl.style.transform = 'translateX(0px)';
			this.lastKey = '';
			this.renderedStart = undefined;
			this.renderedEnd = undefined;
			this.renderedRevision = -1;
			this.lastRange = [0, 0];
			if (this.callbacks.onRender) {
				this.callbacks.onRender([0, 0]);
			}
			return;
		}
		const offsets = model.offsets;
		const range = visibleRangeFromOffsets(offsets, viewport.top, viewport.height, this.bufferSize);
		const start = range[0];
		const end = range[1];
		const total = offsets.length > 0 ? offsets[offsets.length - 1] : 0;
		const key =
			start +
			':' +
			end +
			':' +
			total +
			':' +
			viewport.height +
			':' +
			viewport.width +
			':' +
			this.revision;
		if (!force && key === this.lastKey) {
			this.lastRange = [start, end];
			return;
		}
		this.lastKey = key;
		this.lastRange = [start, end];
		this.windowEl.style.top = (offsets[start] ?? 0) + 'px';
		this.windowEl.style.height = Math.max(0, (offsets[end] ?? total) - (offsets[start] ?? 0)) + 'px';
		this.windowEl.style.transform = 'translateX(' + -viewport.left + 'px)';

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

	/** The window element, for a host that needs to inspect the rendered rows. */
	getWindowElement(): any {
		return this.windowEl;
	}

	/** The row range currently rendered, including overscan. */
	getVisibleRange(): [number, number] {
		return this.lastRange;
	}

	clientHeight(): number {
		return this.lastViewport ? this.lastViewport.height : 0;
	}

	clientWidth(): number {
		return this.lastViewport ? this.lastViewport.width : 0;
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

	destroy(): void {
		this.model = undefined;
	}
}
