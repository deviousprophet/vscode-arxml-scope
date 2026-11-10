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

/** The line-number state of one virtual row, or `undefined` for a blank cell. */
export interface DocumentTreeLineInfo {
	number?: number;
	status?: 'changed' | 'added' | 'removed' | 'unchanged';
}

/** What the host supplies: virtual row count, offsets and row markup. */
export interface DocumentTreeViewModel {
	rowCount: number;
	/** Cumulative row offsets, length `rowCount + 1`. */
	offsets: readonly number[];
	/** Build the row for this pane; the host decides header/node/brace/status. */
	renderRow(index: number, pane: string): any;
	contentWidth?: number;
	/** The line number and diff tint for one virtual row; absent leaves the cell blank. */
	lineInfo?(index: number, pane: string): DocumentTreeLineInfo | undefined;
	/** The virtual row whose number is active, or undefined when nothing is selected. */
	activeLine?(pane: string): number | undefined;
}

export interface DocumentTreeViewport {
	top: number;
	left: number;
	/** Per-pane horizontal offsets; `left` mirrors the first pane. */
	lefts?: readonly number[];
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
	linesEl: HTMLElement | undefined;
	lineCells: Array<{ index: number; element: HTMLElement; numbered: boolean }>;
	bufferSize: number;
	revision: number;
	lastKey: string;
	renderedStart: number | undefined;
	renderedEnd: number | undefined;
	renderedRevision: number;
	contentWidth: number;
	lineNumberColumns: number;
	focusedLine: number | undefined;
	lastRange: [number, number];
	lastViewport: DocumentTreeViewport | undefined;

	constructor(rootSelector: any, pane: string, callbacks?: DocumentTreeViewCallbacks) {
		this.root = typeof rootSelector === 'string' ? document.querySelector(rootSelector) : rootSelector;
		this.pane = pane;
		this.callbacks = callbacks || {};
		this.model = undefined;
		this.windowEl = undefined;
		this.linesEl = undefined;
		this.lineCells = [];
		this.bufferSize = 10;
		this.revision = 0;
		this.lastKey = '';
		this.renderedStart = undefined;
		this.renderedEnd = undefined;
		this.renderedRevision = -1;
		this.contentWidth = 0;
		this.lineNumberColumns = 0;
		this.focusedLine = undefined;
		this.lastRange = [0, 0];
		this.lastViewport = undefined;
	}

	/** Create the absolutely positioned window and gutter inside the pane layer. */
	mount(): void {
		if (!this.root) {
			return;
		}
		this.root.textContent = '';
		this.windowEl = document.createElement('div');
		this.windowEl.className = 'document-tree-window';
		this.windowEl.setAttribute('role', 'presentation');
		this.root.appendChild(this.windowEl);
		this.linesEl = document.createElement('div');
		this.linesEl.className = 'document-tree-lines';
		this.linesEl.setAttribute('aria-hidden', 'true');
		this.linesEl.setAttribute('data-side', this.pane);
		this.linesEl.tabIndex = -1;
		this.linesEl.addEventListener('click', (event: any) => this.onLineClick(event));
		this.root.appendChild(this.linesEl);
		this.root.addEventListener('click', (event: any) => this.onClick(event));
		this.root.addEventListener('focusin', (event: any) => this.onFocusIn(event));
		this.root.addEventListener('focusout', () => this.applyFocusedLine(undefined));
		this.revision++;
		this.lastKey = '';
	}

	/** Install or replace the virtual row model. */
	setModel(model: DocumentTreeViewModel): void {
		this.model = model;
		// The model owns the full-content width. A new model may legitimately be
		// narrower (a re-scan to a shorter document), so reset the monotonic
		// measurement floor before applying it.
		this.applyContentWidth(model && typeof model.contentWidth === 'number' ? model.contentWidth : 0);
		this.lineNumberColumns = this.measureLineNumberChars(model);
		this.applyLineNumberWidth();
		this.invalidate();
	}

	/** The number-column width in `ch`: `max(digits(max number), 5)`, 0 when empty. */
	lineNumberChars(): number {
		return this.lineNumberColumns;
	}

	/** Re-apply the active row colour without rebuilding the window. */
	refreshActiveLine(): void {
		this.applyActiveLine();
	}

	/** Write the window's content-width floor; 0 leaves the pane width as the floor. */
	private applyContentWidth(width: number): void {
		const next = Number.isFinite(width) && width > 0 ? width : 0;
		this.contentWidth = next;
		if (this.windowEl && this.windowEl.style && typeof this.windowEl.style.setProperty === 'function') {
			this.windowEl.style.setProperty('--document-tree-content-width', this.contentWidth + 'px');
		}
	}

	/**
	 * Grow the measured content width. Monotonic within one model: a visible-slice
	 * measurement may raise the minimum but never lower it, so a long row leaving
	 * the rendered window cannot shrink the selection fill. `setModel` resets the
	 * floor because the new document may be narrower.
	 */
	setContentWidth(width: number): void {
		const next = Number.isFinite(width) && width > 0 ? width : 0;
		if (next <= this.contentWidth) {
			return;
		}
		this.applyContentWidth(next);
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
			this.clearLineNumbers();
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
			viewport.top +
			':' +
			viewport.left +
			':' +
			viewport.height +
			':' +
			viewport.width +
			':' +
			this.revision;
		if (!force && key === this.lastKey) {
			this.lastRange = [start, end];
			this.applyActiveLine();
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
		this.renderLineNumbers(model, start, end);
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

	/** The cached `max(digits(max number), 5)` column count for this pane. */
	measureLineNumberChars(model: DocumentTreeViewModel | undefined): number {
		if (!model || typeof model.lineInfo !== 'function') {
			return 0;
		}
		const rowCount = Math.max(0, Math.floor(model.rowCount || 0));
		let max = 0;
		for (let at = 0; at < rowCount; at++) {
			const info = model.lineInfo(at, this.pane);
			const number = info && typeof info.number === 'number' && Number.isFinite(info.number) ? info.number : undefined;
			if (number !== undefined && number > max) {
				max = number;
			}
		}
		if (max <= 0) {
			return 0;
		}
		return Math.max(String(Math.floor(max)).length, 5);
	}

	/** Publish the number-column width to the pane's CSS geometry. */
	applyLineNumberWidth(): void {
		if (!this.root || !this.root.style || typeof this.root.style.setProperty !== 'function') {
			return;
		}
		this.root.style.setProperty('--line-numbers-width', this.lineNumberColumns + 'ch');
	}

	/** Rebuild the gutter cells for the slice the window just rendered. */
	renderLineNumbers(model: DocumentTreeViewModel, start: number, end: number): void {
		if (!this.linesEl) {
			return;
		}
		if (this.lineNumberColumns <= 0) {
			this.clearLineNumbers();
			return;
		}
		this.linesEl.textContent = '';
		this.lineCells = [];
		const offsets = model.offsets;
		for (let at = start; at < end; at++) {
			const cell = document.createElement('div');
			cell.className = 'document-tree-line-number';
			cell.dataset.documentIndex = String(at);
			const info = typeof model.lineInfo === 'function' ? model.lineInfo(at, this.pane) : undefined;
			const number =
				info && typeof info.number === 'number' && Number.isFinite(info.number) ? Math.floor(info.number) : undefined;
			if (number !== undefined) {
				cell.textContent = String(number);
			}
			if (info && info.status) {
				cell.dataset.status = info.status;
			}
			const top = offsets[at] ?? 0;
			const next = offsets[at + 1] ?? top;
			cell.style.top = top + 'px';
			cell.style.height = Math.max(0, next - top) + 'px';
			this.linesEl.appendChild(cell);
			this.lineCells.push({ index: at, element: cell, numbered: number !== undefined });
		}
		this.applyActiveLine();
		this.applyFocusedLine(this.focusedLine);
	}

	/** Re-colour the current row's number; blank missing-side cells stay inactive. */
	applyActiveLine(): void {
		const active =
			this.model && typeof this.model.activeLine === 'function' ? this.model.activeLine(this.pane) : undefined;
		for (const cell of this.lineCells) {
			if (active !== undefined && cell.index === active && cell.numbered) {
				cell.element.dataset.active = 'true';
			} else {
				delete cell.element.dataset.active;
			}
		}
	}

	clearLineNumbers(): void {
		if (this.linesEl) {
			this.linesEl.textContent = '';
		}
		this.lineCells = [];
	}

	/** A gutter click reuses the row's own click handler. */
	onLineClick(event: any): void {
		if (!this.linesEl) {
			return;
		}
		const target = event ? event.target : undefined;
		const cell = target && target.closest ? target.closest('.document-tree-line-number') : null;
		if (!cell || (typeof this.linesEl.contains === 'function' && !this.linesEl.contains(cell))) {
			return;
		}
		const index = Number(cell.dataset ? cell.dataset.documentIndex : NaN);
		if (!Number.isFinite(index)) {
			return;
		}
		const element = this.elementAt(index);
		if (element && typeof element.click === 'function') {
			element.click();
		}
	}

	/** Track the focused node row so the gutter can repeat its 2px focus rail. */
	onFocusIn(event: any): void {
		const target = event ? event.target : undefined;
		const item = target && target.closest ? target.closest('.node[data-document-index]') : null;
		if (!item || (this.windowEl && typeof this.windowEl.contains === 'function' && !this.windowEl.contains(item))) {
			this.applyFocusedLine(undefined);
			return;
		}
		const index = Number(item.dataset ? item.dataset.documentIndex : NaN);
		this.applyFocusedLine(Number.isFinite(index) ? index : undefined);
	}

	/** Repeat the Document focus rail on the gutter cell; headers and gaps stay unmarked. */
	applyFocusedLine(index: number | undefined): void {
		this.focusedLine = index;
		for (const cell of this.lineCells) {
			if (index !== undefined && cell.index === index && cell.numbered) {
				cell.element.dataset.focused = 'true';
			} else {
				delete cell.element.dataset.focused;
			}
		}
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
}
