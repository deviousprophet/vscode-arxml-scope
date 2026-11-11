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

/** The clamped virtual row count of a model. */
function modelRowCount(model: DocumentTreeViewModel): number {
	return Math.max(0, Math.floor(model.rowCount || 0));
}

/** Whether a model supplies at least one virtual row. */
function hasRows(model: DocumentTreeViewModel | undefined): model is DocumentTreeViewModel {
	if (!model) {
		return false;
	}
	return modelRowCount(model) > 0;
}

/** The slice key: any change to the range, viewport or revision forces a new render. */
function renderKey(
	offsets: DocumentTreeViewModel['offsets'],
	range: readonly [number, number],
	viewport: DocumentTreeViewport,
	revision: number
): string {
	const total = offsets.length > 0 ? offsets[offsets.length - 1] : 0;
	return (
		range[0] +
		':' +
		range[1] +
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
		revision
	);
}

function offsetAt(offsets: DocumentTreeViewModel['offsets'], index: number, fallback: number): number {
	return offsets[index] ?? fallback;
}

function positiveWidth(width: number): number {
	return Number.isFinite(width) && width > 0 ? width : 0;
}

function lineInfoAt(
	model: DocumentTreeViewModel,
	at: number,
	pane: string
): DocumentTreeLineInfo | undefined {
	return typeof model.lineInfo === 'function' ? model.lineInfo(at, pane) : undefined;
}

function finiteLineNumber(info: DocumentTreeLineInfo | undefined): number | undefined {
	const number = info?.number;
	return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
}

function lineNumberOf(info: DocumentTreeLineInfo | undefined): number | undefined {
	const number = finiteLineNumber(info);
	return number === undefined ? undefined : Math.floor(number);
}

function maxLineNumber(model: DocumentTreeViewModel, pane: string, rowCount: number): number {
	let max = 0;
	for (let at = 0; at < rowCount; at++) {
		const number = finiteLineNumber(lineInfoAt(model, at, pane));
		if (number !== undefined && number > max) {
			max = number;
		}
	}
	return max;
}

function writeLineStatus(cell: HTMLElement, info: DocumentTreeLineInfo | undefined): void {
	if (info && info.status) {
		cell.dataset.status = info.status;
	}
}

function placeLineCell(cell: HTMLElement, offsets: DocumentTreeViewModel['offsets'], at: number): void {
	const top = offsetAt(offsets, at, 0);
	const next = offsetAt(offsets, at + 1, top);
	cell.style.top = top + 'px';
	cell.style.height = Math.max(0, next - top) + 'px';
}

function cellIsMarked(cell: { index: number; numbered: boolean }, index: number | undefined): boolean {
	return index !== undefined && cell.index === index && cell.numbered;
}

/** The duck-typed event target the pane listeners receive. */
interface PaneEvent {
	target?: PaneItem | null;
}

/** A DOM item the tree looks up by its `data-document-index`. */
interface PaneItem {
	dataset?: { documentIndex?: string };
	closest?(selector: string): PaneItem | null;
}

/** A container that can answer whether it owns an item. */
interface PaneContainer {
	contains?(item: unknown): boolean;
}

function isFocusable(value: unknown): value is { focus(options: { preventScroll: boolean }): void } {
	return hasMethod(value, 'focus');
}

function isClickable(value: unknown): value is { click(): void } {
	return hasMethod(value, 'click');
}

function hasMethod(value: unknown, name: string): boolean {
	const isObject = typeof value === 'object' || typeof value === 'function';
	return isObject && value !== null && typeof Reflect.get(value, name) === 'function';
}

function focusElement(element: unknown): void {
	if (isFocusable(element)) {
		element.focus({ preventScroll: true });
	}
}

function clickElement(element: unknown): void {
	if (isClickable(element)) {
		element.click();
	}
}

function closestFromEvent(event: PaneEvent | null | undefined, selector: string): PaneItem | null {
	const target = event ? event.target : undefined;
	return target && target.closest ? target.closest(selector) : null;
}

function isOwnedItem(item: PaneItem | null | undefined, container: PaneContainer | undefined): boolean {
	if (!item) {
		return false;
	}
	if (!hasContains(container)) {
		return true;
	}
	return container.contains(item);
}

function hasContains(
	container: PaneContainer | undefined
): container is PaneContainer & { contains(item: unknown): boolean } {
	if (!container) {
		return false;
	}
	return typeof container.contains === 'function';
}

function documentIndex(item: PaneItem): number | undefined {
	const index = Number(item.dataset ? item.dataset.documentIndex : NaN);
	return Number.isFinite(index) ? index : undefined;
}

function focusInsideWindow(
	active: PaneItem | null | undefined,
	windowEl: PaneContainer | undefined
): boolean {
	if (!active || active === windowEl) {
		return false;
	}
	if (!hasContains(windowEl)) {
		return true;
	}
	return windowEl.contains(active);
}

function closestRowItem(active: PaneItem): PaneItem | undefined {
	const item = active.closest ? active.closest('[data-document-index]') : null;
	return item || undefined;
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
		this.contentWidth = positiveWidth(width);
		if (this.hasWindowStyle()) {
			this.windowEl.style.setProperty('--document-tree-content-width', this.contentWidth + 'px');
		}
	}

	private hasWindowStyle(): boolean {
		return Boolean(this.windowEl) && Boolean(this.windowEl.style) && typeof this.windowEl.style.setProperty === 'function';
	}

	/**
	 * Grow the measured content width. Monotonic within one model: a visible-slice
	 * measurement may raise the minimum but never lower it, so a long row leaving
	 * the rendered window cannot shrink the selection fill. `setModel` resets the
	 * floor because the new document may be narrower.
	 */
	setContentWidth(width: number): void {
		const next = positiveWidth(width);
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
		if (!hasRows(model)) {
			this.renderEmpty();
			return;
		}
		const offsets = model.offsets;
		const range = visibleRangeFromOffsets(offsets, viewport.top, viewport.height, this.bufferSize);
		const key = renderKey(offsets, range, viewport, this.revision);
		if (this.shouldSkipRender(force, key)) {
			this.lastRange = range;
			this.applyActiveLine();
			return;
		}
		this.renderSlice(model, offsets, range, viewport, key, force);
	}

	private shouldSkipRender(force: boolean | undefined, key: string): boolean {
		return !force && key === this.lastKey;
	}

	/** Clear the window, gutter and range state for a model with no rows. */
	private renderEmpty(): void {
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
		this.reportRender([0, 0]);
	}

	private renderSlice(
		model: DocumentTreeViewModel,
		offsets: DocumentTreeViewModel['offsets'],
		range: readonly [number, number],
		viewport: DocumentTreeViewport,
		key: string,
		force: boolean | undefined
	): void {
		const start = range[0];
		const end = range[1];
		this.lastKey = key;
		this.lastRange = [start, end];
		this.positionWindow(offsets, start, end, viewport.left);
		const focused = this.focusedIndex();
		this.reconcileWindow(model, start, end, force);
		this.renderedRevision = this.revision;
		this.renderLineNumbers(model, start, end);
		this.restoreFocus(focused);
		this.reportRender([start, end]);
	}

	private positionWindow(
		offsets: DocumentTreeViewModel['offsets'],
		start: number,
		end: number,
		left: number
	): void {
		const total = offsets.length > 0 ? offsets[offsets.length - 1] : 0;
		const top = offsetAt(offsets, start, 0);
		this.windowEl.style.top = top + 'px';
		this.windowEl.style.height = Math.max(0, offsetAt(offsets, end, total) - top) + 'px';
		this.windowEl.style.transform = 'translateX(' + -left + 'px)';
	}

	/** Rebuild the whole window or patch the rows that left and entered the slice. */
	private reconcileWindow(
		model: DocumentTreeViewModel,
		start: number,
		end: number,
		force: boolean | undefined
	): void {
		if (this.needsFullRender(force, start, end)) {
			this.rebuildWindow(model, start, end);
			return;
		}
		this.patchWindow(model, start, end);
	}

	private needsFullRender(force: boolean | undefined, start: number, end: number): boolean {
		if (force === true) {
			return true;
		}
		if (this.renderedRevision !== this.revision) {
			return true;
		}
		return !this.hasOverlap(start, end);
	}

	private hasOverlap(start: number, end: number): boolean {
		if (this.renderedStart === undefined || this.renderedEnd === undefined) {
			return false;
		}
		return start < this.renderedEnd && end > this.renderedStart;
	}

	private rebuildWindow(model: DocumentTreeViewModel, start: number, end: number): void {
		const fragment = document.createDocumentFragment();
		for (let at = start; at < end; at++) {
			fragment.appendChild(this.buildRow(model, at));
		}
		this.windowEl.textContent = '';
		this.windowEl.appendChild(fragment);
		this.renderedStart = start;
		this.renderedEnd = end;
	}

	private patchWindow(model: DocumentTreeViewModel, start: number, end: number): void {
		this.trimBefore(start);
		this.trimAfter(end);
		this.extendBefore(model, start);
		this.extendAfter(model, end);
	}

	private trimBefore(start: number): void {
		const windowEl = this.windowEl;
		while (this.renderedStart !== undefined && this.renderedStart < start) {
			windowEl.removeChild(windowEl.firstChild);
			this.renderedStart++;
		}
	}

	private trimAfter(end: number): void {
		const windowEl = this.windowEl;
		while (this.renderedEnd !== undefined && this.renderedEnd > end) {
			windowEl.removeChild(windowEl.lastChild);
			this.renderedEnd--;
		}
	}

	private extendBefore(model: DocumentTreeViewModel, start: number): void {
		const windowEl = this.windowEl;
		while (this.renderedStart !== undefined && this.renderedStart > start) {
			this.renderedStart--;
			windowEl.insertBefore(this.buildRow(model, this.renderedStart), windowEl.firstChild);
		}
	}

	private extendAfter(model: DocumentTreeViewModel, end: number): void {
		const windowEl = this.windowEl;
		while (this.renderedEnd !== undefined && this.renderedEnd < end) {
			windowEl.appendChild(this.buildRow(model, this.renderedEnd));
			this.renderedEnd++;
		}
	}

	private restoreFocus(index: number | undefined): void {
		if (index === undefined) {
			return;
		}
		focusElement(this.elementAt(index));
	}

	private reportRender(range: [number, number]): void {
		if (this.callbacks.onRender) {
			this.callbacks.onRender(range);
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
		const max = maxLineNumber(model, this.pane, modelRowCount(model));
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
			const cell = this.buildLineCell(model, offsets, at);
			this.linesEl.appendChild(cell.element);
			this.lineCells.push({ index: at, element: cell.element, numbered: cell.numbered });
		}
		this.applyActiveLine();
		this.applyFocusedLine(this.focusedLine);
	}

	private buildLineCell(
		model: DocumentTreeViewModel,
		offsets: DocumentTreeViewModel['offsets'],
		at: number
	): { element: HTMLElement; numbered: boolean } {
		const cell = document.createElement('div');
		cell.className = 'document-tree-line-number';
		cell.dataset.documentIndex = String(at);
		const info = lineInfoAt(model, at, this.pane);
		const number = lineNumberOf(info);
		if (number !== undefined) {
			cell.textContent = String(number);
		}
		writeLineStatus(cell, info);
		placeLineCell(cell, offsets, at);
		return { element: cell, numbered: number !== undefined };
	}

	/** Re-colour the current row's number; blank missing-side cells stay inactive. */
	applyActiveLine(): void {
		this.applyLineMark(this.activeLineIndex(), 'active');
	}

	private activeLineIndex(): number | undefined {
		return this.model && typeof this.model.activeLine === 'function' ? this.model.activeLine(this.pane) : undefined;
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
		const cell = this.eventItem(event, '.document-tree-line-number', this.linesEl);
		if (!cell) {
			return;
		}
		const index = documentIndex(cell);
		if (index === undefined) {
			return;
		}
		clickElement(this.elementAt(index));
	}

	/** Track the focused node row so the gutter can repeat its 2px focus rail. */
	onFocusIn(event: any): void {
		const item = this.eventItem(event, '.node[data-document-index]', this.windowEl);
		this.applyFocusedLine(item ? documentIndex(item) : undefined);
	}

	/** Repeat the Document focus rail on the gutter cell; headers and gaps stay unmarked. */
	applyFocusedLine(index: number | undefined): void {
		this.focusedLine = index;
		this.applyLineMark(index, 'focused');
	}

	private applyLineMark(index: number | undefined, mark: 'active' | 'focused'): void {
		for (const cell of this.lineCells) {
			if (cellIsMarked(cell, index)) {
				cell.element.dataset[mark] = 'true';
			} else {
				delete cell.element.dataset[mark];
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
		const element = this.activeRowElement();
		return element ? documentIndex(element) : undefined;
	}

	private activeRowElement(): PaneItem | undefined {
		if (!this.windowEl) {
			return undefined;
		}
		const active = document.activeElement;
		if (!active || !focusInsideWindow(active, this.windowEl)) {
			return undefined;
		}
		return closestRowItem(active);
	}

	elementAt(index: number): any {
		if (!this.windowEl || typeof this.windowEl.querySelector !== 'function') {
			return undefined;
		}
		return this.windowEl.querySelector('[data-document-index="' + index + '"]');
	}

	onClick(event: any): void {
		const report = this.callbacks.onRowClick;
		if (!report) {
			return;
		}
		const index = this.eventRowIndex(event);
		if (index !== undefined) {
			report(index, event);
		}
	}

	private eventRowIndex(event: PaneEvent | null | undefined): number | undefined {
		if (!this.windowEl) {
			return undefined;
		}
		const item = this.eventItem(event, '[data-document-index]', this.windowEl);
		return item ? documentIndex(item) : undefined;
	}

	private eventItem(
		event: PaneEvent | null | undefined,
		selector: string,
		container: PaneContainer | undefined
	): PaneItem | undefined {
		const item = closestFromEvent(event, selector);
		if (!item || !isOwnedItem(item, container)) {
			return undefined;
		}
		return item;
	}
}
