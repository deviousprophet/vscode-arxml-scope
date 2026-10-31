/**
 * The reusable Document tree surface.
 *
 * One `DocumentTreeView` owns the schema/package header, the native vertical and
 * horizontal scroller, the virtual spacers and the rendered window. The host owns
 * the row model, selection and search: `renderRow(index, pane)` builds one row and
 * the component only decides which rows are on screen and where the scroll is.
 *
 * The class (and its stylesheet) is serialized into both webview pages: the editor
 * mounts one instance, the diff mounts one per pane. A page needs
 * `virtualScrollScript()` for `calcVisibleRange`/`calcTotalHeight`/`calcRowOffset`
 * before it constructs this class.
 *
 * The component never writes a style attribute with model text. The only CSSOM
 * writes are its own geometry custom properties (`--document-tree-*`), the same
 * technique the sidebar uses, which the nonce CSP allows.
 */

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

declare const document: any;
declare const requestAnimationFrame: any;
declare const cancelAnimationFrame: any;
declare function getComputedStyle(element: any): any;
declare function calcVisibleRange(state: any): [number, number];
declare function calcTotalHeight(state: any): number;
declare function calcRowOffset(index: number, state: any): number;

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
		this.expectedTop = undefined;
		this.expectedLeft = undefined;
		this.pendingNotify = false;
	}

	/** Create `root > header + scroll > top/window/bottom`. Idempotent. */
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
		this.scroll.appendChild(this.topSpacer);
		this.scroll.appendChild(this.windowEl);
		this.scroll.appendChild(this.bottomSpacer);

		this.root.appendChild(this.header);
		this.root.appendChild(this.scroll);

		this.scroll.addEventListener('scroll', () => this.onScroll());
		this.scroll.addEventListener('wheel', (event: any) => this.onWheel(event), { passive: false });
		this.scroll.addEventListener('click', (event: any) => this.onClick(event));
		this.padTop = -1;
		this.setEmpty(false);
	}

	/** Replace the schema/package header (and optional file label). */
	setHeader(header?: DocumentTreeHeader): void {
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

	/** The scroll offset of the rows region, excluding the scroller's top padding. */
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

	/** The visible rows' top edge, in the same coordinates as the virtual math. */
	getRowsScrollTop(): number {
		return this.scroll ? Math.max(0, this.scroll.scrollTop - this.padTopHeight()) : 0;
	}

	/** Move the rows region to a logical offset (the top padding is added back). */
	setRowsScrollTop(offset: number): void {
		this.setScrollTop((Number.isFinite(offset) ? Math.max(0, offset) : 0) + this.padTopHeight());
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
		const item = active.closest ? active.closest('[data-document-index]') : null;
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

/**
 * The class source for a webview. A bundler may drop the declaration name or
 * rename it; wrapping the class expression gives the page one stable binding.
 */
export function documentTreeViewScript(): string {
	return `const DocumentTreeView = (${DocumentTreeView.toString()});`;
}

/* Generated depth rules: one padding/guide offset per supported level. */
const DOCUMENT_LEVEL_RULES = Array.from({ length: 24 }, (_, at) => {
	const level = at + 1;
	const indent = level === 1 ? 'var(--content-pad)' : `calc(var(--content-pad) + var(--indent) * ${level - 1})`;
	return `body[data-view="document"] .row[data-level="${level}"] { padding-left: ${indent}; }`;
}).join('\n');

const GUIDE_LEVEL_RULES = Array.from({ length: 24 }, (_, at) => {
	const level = at + 1;
	return `body[data-view="document"] .guide[data-level="${level}"] { left: calc(var(--content-pad) + var(--indent) * ${level - 1} + 0.5ch); }`;
}).join('\n');

/** The Document stylesheet shared byte-for-byte by the editor and the diff. */
export function documentTreeStyles(): string {
	return `body[data-view] {
	--ecuc-fs: var(--vscode-editor-font-size, 13px);
	--ecuc-lh: calc(var(--ecuc-fs) * 1.55);
	--tok-keyword: var(--vscode-debugTokenExpression-boolean, var(--vscode-editor-foreground));
	--tok-string: var(--vscode-debugTokenExpression-string, var(--vscode-editor-foreground));
	--tok-number: var(--vscode-debugTokenExpression-number, var(--vscode-editor-foreground));
	--tok-meta: var(--vscode-debugTokenExpression-name, var(--vscode-editor-foreground));
	--tok-comment: var(--vscode-charts-green, var(--vscode-editor-foreground));
	--tok-key: var(--vscode-symbolIcon-variableForeground, var(--vscode-editor-foreground));
	--tok-punct: var(--vscode-editor-foreground);
	--tok-dim: var(--vscode-editor-foreground);
	--hover-bg: var(--vscode-list-hoverBackground, transparent);
	--sel-bg: var(--vscode-editor-background);
	--sel-bg-focus: var(--vscode-editor-background);
	--subtree-bg: var(--vscode-editor-selectionHighlightBackground, transparent);
	--sel-container-bg: var(--vscode-editor-selectionHighlightBackground, transparent);
	--container-accent: #4EC9B0;
	/* Search match tiers: fixed dark-theme yellow, matching the reference UI. */
	--match-bg: rgba(234, 179, 8, 0.32);
	--match-hi: rgba(234, 179, 8, 0.7);
	--fold-gutter: 26px;
	--doc-pad: 3ch;
	--indent: 4ch;
	--content-pad: calc(var(--fold-gutter) + var(--doc-pad));
	--rail: var(--vscode-focusBorder, var(--vscode-editorCursor-foreground, var(--vscode-editor-foreground)));
}
@supports (color: color-mix(in srgb, currentColor 50%, transparent)) {
	body[data-view] {
		--tok-comment: color-mix(in srgb, var(--vscode-charts-green, var(--vscode-editor-foreground)) 85%, var(--vscode-editor-background));
		--tok-punct: color-mix(in srgb, var(--vscode-editor-foreground) 70%, var(--vscode-editor-background));
		--tok-dim: color-mix(in srgb, var(--vscode-editor-foreground) 55%, var(--vscode-editor-background));
		--sel-bg: color-mix(in srgb, var(--vscode-list-inactiveSelectionBackground, var(--vscode-editor-background)) 14%, var(--vscode-editor-background));
		--sel-bg-focus: color-mix(in srgb, var(--vscode-list-activeSelectionBackground, var(--vscode-list-inactiveSelectionBackground, var(--vscode-editor-background))) 24%, var(--vscode-editor-background));
		--subtree-bg: color-mix(in srgb, var(--vscode-editor-selectionHighlightBackground, var(--vscode-list-inactiveSelectionBackground, var(--vscode-editor-background))) 18%, transparent);
		--sel-container-bg: color-mix(in srgb, var(--vscode-editor-selectionHighlightBackground, var(--vscode-list-inactiveSelectionBackground, var(--vscode-editor-background))) 45%, transparent);
		--sel-outline: color-mix(in srgb, var(--rail) 55%, transparent);
	}
}

.node {
	outline: none;
}
.row {
	display: flex;
	flex-wrap: nowrap;
	gap: 1ch;
	align-items: baseline;
	box-sizing: border-box;
	height: var(--ecuc-lh);
	padding: 0 0 0 var(--content-pad);
	position: relative;
}
.row:hover {
	background-color: var(--hover-bg);
}
.twisty {
	position: absolute;
	left: 2px;
	top: 0;
	bottom: 0;
	width: 16px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	color: var(--vscode-icon-foreground, var(--vscode-foreground));
	opacity: 0;
	transition: opacity 0.5s;
}
.twisty svg {
	transition: transform 120ms ease;
}
.node[aria-expanded="true"] > .row > .twisty svg {
	transform: rotate(90deg);
}
.label {
	flex: 0 0 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: 600;
}
.value {
	flex: 0 0 auto;
	justify-self: start;
	min-width: 0;
	max-width: 100%;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--vscode-foreground);
}
.value[data-value-kind="numeric"] {
	color: var(--tok-number);
}
.value[data-value-kind="textual"] {
	color: var(--tok-string);
}
.value[data-value-kind="boolean"] {
	color: var(--tok-keyword);
}
.row-meta {
	display: flex;
	flex: 0 0 auto;
	flex-wrap: wrap;
	gap: 2px 8px;
	min-width: 0;
	font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif);
	font-size: 0.9em;
	color: var(--vscode-descriptionForeground);
}
.row-meta > span {
	min-width: 0;
	max-width: 100%;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.node:focus-visible > .row {
	box-shadow: inset 2px 0 0 var(--rail);
}
.node[data-disabled="true"] > .row {
	opacity: 0.55;
	color: var(--vscode-disabledForeground);
}
.node[data-selected="true"] > .row {
	background-color: var(--sel-bg);
	box-shadow: inset 2px 0 0 var(--rail);
}
.document-tree:focus-within .node[data-selected="true"] > .row {
	background-color: var(--sel-bg-focus);
	box-shadow: inset 2px 0 0 var(--rail);
}
/* Selection never recolours syntax; the tint and rail carry the state. */
.node.flash > .row {
	animation: ecuc-flash 1s ease-out;
}
@keyframes ecuc-flash {
	from { background-color: var(--vscode-editor-findMatchHighlightBackground, var(--vscode-list-hoverBackground)); }
	to { background-color: transparent; }
}
.short {
	color: var(--tok-string);
}
.keyword {
	color: var(--tok-keyword);
}
.variant {
	color: var(--tok-meta);
}
.condition {
	padding: 0 4px;
	border: 1px solid transparent;
	border-radius: 3px;
	color: var(--tok-meta);
}
/* A false condition is marked by its edge; the tokens keep their own colours. */
.condition[data-state="false"] {
	border-color: var(--vscode-errorForeground);
}
.annotation {
	padding: 0 4px;
	border: 1px solid var(--vscode-panel-border, transparent);
	border-radius: 3px;
	color: var(--tok-comment);
	font-style: italic;
}
.punct {
	color: var(--tok-punct);
}
.syscond-name {
	color: var(--tok-key);
}
.syscond-number {
	color: var(--tok-number);
}
.syscond-string {
	color: var(--tok-string);
}
.syscond-operator {
	color: var(--tok-keyword);
}
.syscond-literal {
	color: var(--tok-keyword);
}
.syscond-punct {
	color: var(--tok-punct);
}
.comment-text {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: pre;
}
.context {
	color: var(--vscode-editor-foreground);
}
.context .keyword {
	color: var(--tok-keyword);
}
mark {
	color: inherit;
	background: var(--match-bg);
}
.node[data-search-current="true"] > .row mark {
	background: var(--match-hi);
}

/* Document view: quiet source. One editor surface, a fixed fold gutter and
 * hover/focus affordances. The component root/scroll own the layout so the
 * editor and each diff pane share one geometry. */
.document-tree {
	position: relative;
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-width: 0;
	min-height: 0;
}
.document-tree-header {
	flex: none;
	padding: calc(var(--ecuc-lh) * 0.5) 0 0;
	margin: 0;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	line-height: var(--ecuc-lh);
	white-space: pre;
	color: var(--vscode-editor-foreground);
}
.document-tree-title {
	padding: 0 10px;
	overflow: hidden;
	text-overflow: ellipsis;
	font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif);
	font-size: 12px;
	font-weight: 600;
	line-height: 18px;
	white-space: nowrap;
}
.document-tree-title[hidden] {
	display: none;
}
.document-tree-meta {
	padding-left: var(--content-pad);
}
.document-tree-meta .keyword {
	color: var(--tok-keyword);
}
.document-tree-meta .number {
	color: var(--tok-number);
}
.document-tree-meta .schema,
.document-tree-meta .package {
	font-family: inherit;
	line-height: var(--ecuc-lh);
}
.document-tree-scroll {
	position: relative;
	flex: 1 1 auto;
	min-width: 0;
	min-height: 0;
	overflow: auto;
	box-sizing: border-box;
	scrollbar-gutter: stable;
	/* The window swaps spacer heights; browser scroll anchoring would fight the
	 * virtual range and snap the viewport back to the top. */
	overflow-anchor: none;
	padding: calc(var(--ecuc-lh) * 0.5) 2ch calc(var(--ecuc-lh) * 3) 0;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	font-weight: var(--vscode-editor-font-weight, normal);
	line-height: var(--ecuc-lh);
	font-variant-ligatures: none;
	tab-size: 4;
	white-space: pre;
}
.document-tree-scroll[data-empty="true"] {
	padding-top: 0;
	padding-bottom: 0;
}
.document-tree-window {
	display: flow-root;
	min-width: var(--document-tree-content-width, 0px);
}
.document-tree-top {
	height: var(--document-tree-top, 0px);
}
.document-tree-bottom {
	height: var(--document-tree-bottom, 0px);
}
.v-spacer {
	pointer-events: none;
}
body[data-view="document"] .document-tree-meta {
	padding: 0 0 0 var(--content-pad);
	margin-bottom: calc(var(--ecuc-lh) * 0.5);
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	line-height: var(--ecuc-lh);
	color: var(--vscode-editor-foreground);
}
body[data-view="document"] .document-tree-meta .schema,
body[data-view="document"] .document-tree-meta .package {
	font-family: inherit;
}
body[data-view="document"] .document-tree-meta .keyword {
	color: var(--tok-keyword);
}
body[data-view="document"] .document-tree-meta .number {
	color: var(--tok-number);
}
body[data-view="document"] .row {
	background-color: transparent;
}
body[data-view="document"] .guide {
	position: absolute;
	top: 0;
	bottom: 0;
	width: 1px;
	background: var(--vscode-tree-indentGuidesStroke, var(--vscode-panel-border, #80808040));
	opacity: 0.28;
	pointer-events: none;
}
body[data-view="document"] .guide.guide-active {
	opacity: 0.85;
}
${DOCUMENT_LEVEL_RULES}
${GUIDE_LEVEL_RULES}
body[data-view="document"] .node[data-gap="true"] {
	padding-top: var(--ecuc-lh);
}
body[data-view="document"] .brace {
	height: var(--ecuc-lh);
}
body[data-view="document"] .brace .row {
	color: var(--tok-punct);
}
body[data-view="document"] .node:hover > .row {
	background-color: var(--hover-bg);
}
body[data-view="document"] .twisty svg {
	width: 16px;
	height: 16px;
}
body[data-view="document"] .document-tree:hover .node[aria-expanded="true"] > .row > .twisty,
body[data-view="document"] .document-tree:focus-within .node[aria-expanded="true"] > .row > .twisty,
body[data-view="document"] .node:hover > .row > .twisty,
body[data-view="document"] .node:focus-within > .row > .twisty {
	opacity: 1;
}
body[data-view="document"] .node[aria-expanded="false"] > .row > .twisty {
	opacity: 1;
}
body[data-view="document"] .node[aria-expanded="false"] > .row::after {
	content: " { … }";
	color: var(--tok-punct);
}
body[data-view="document"] .node[data-kind="container"][data-empty="true"] > .row::after {
	content: " { }";
	color: var(--tok-punct);
}
body[data-view="document"] .label {
	flex: 0 0 auto;
	overflow: visible;
	text-overflow: clip;
	white-space: pre;
	font-weight: 400;
	color: var(--vscode-editor-foreground);
}
body[data-view="document"] .node[data-kind="parameter"] > .row > .label,
body[data-view="document"] .node[data-kind="reference"] > .row > .label {
	color: var(--tok-key);
}
body[data-view="document"] .node[data-kind="container"] > .row > .label {
	color: var(--container-accent);
}
body[data-view="document"] .node[data-kind="reference"] > .row > .value .value-text {
	color: var(--vscode-symbolIcon-functionForeground, #DCDCAA);
	font-style: italic;
}
body[data-view="document"] .value {
	flex: 0 0 auto;
	margin: 0;
	max-width: none;
	overflow: visible;
	text-overflow: clip;
	white-space: pre;
}
body[data-view="document"] .node[data-kind="parameter"] > .row > .value > .value-text {
	cursor: pointer;
}
body[data-view="document"] .node[data-kind="parameter"] > .row > .value > .value-text:hover {
	background-color: var(--vscode-toolbar-hoverBackground, var(--hover-bg));
	border-radius: 2px;
}
body[data-view="document"] .row-meta {
	display: flex;
	flex: 0 0 auto;
	flex-wrap: nowrap;
	gap: 1ch;
	margin: 0;
	font-family: inherit;
	font-size: inherit;
	color: var(--vscode-editor-foreground);
	white-space: pre;
}
body[data-view="document"] .row-meta > span {
	max-width: none;
	overflow: visible;
	white-space: pre;
	margin: 0;
}
body[data-view="document"] .variant,
body[data-view="document"] .condition {
	color: var(--tok-meta);
}
body[data-view="document"] .annotation {
	color: var(--tok-comment);
	font-style: italic;
}
body[data-view="document"] .context {
	color: var(--vscode-editor-foreground);
}
body[data-view="document"] .condition {
	padding: 0 4px;
	border: 1px solid transparent;
	border-radius: 3px;
}
body[data-view="document"] .condition[data-state="false"] {
	border-color: var(--vscode-errorForeground);
}
body[data-view="document"] .row-meta > span.condition {
	flex: 0 1 auto;
	min-width: 0;
	max-width: 56ch;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
body[data-view="document"] .comment {
	height: var(--ecuc-lh);
}
body[data-view="document"] .comment[data-gap="true"] {
	height: calc(var(--ecuc-lh) * 2);
	padding-top: var(--ecuc-lh);
	box-sizing: border-box;
}
body[data-view="document"] .comment > .row {
	color: var(--tok-comment);
	font-style: italic;
}
body[data-view="document"] .row.k-module .label::before {
	content: "module ";
	color: var(--tok-keyword);
}
body[data-view="document"] .node[data-subtree="true"] > .row,
body[data-view="document"] .brace[data-subtree="true"] > .row {
	background-color: var(--subtree-bg);
}
body[data-view="document"] .node[data-kind="parameter"][data-selected="true"] > .row {
	background-color: var(--sel-bg-focus);
	box-shadow:
		inset 2px 0 0 var(--rail),
		inset 0 0 0 1px var(--sel-outline, transparent);
}
body[data-view="document"] .node[data-selected="true"] > .row {
	background-color: var(--sel-bg-focus);
	box-shadow:
		inset 2px 0 0 var(--rail),
		inset 0 0 0 1px var(--sel-outline, transparent);
}
body[data-view="document"] .node[data-kind="container"][data-selected="true"] > .row,
body[data-view="document"] .node[data-kind="module"][data-selected="true"] > .row {
	background-color: var(--sel-container-bg);
}
body[data-view="document"] .document-tree:focus-within .node[data-selected="true"] > .row {
	background-color: var(--sel-bg-focus);
	box-shadow:
		inset 2px 0 0 var(--rail),
		inset 0 0 0 1px var(--sel-outline, transparent);
}
body[data-view="document"] .document-tree:focus-within .node[data-kind="container"][data-selected="true"] > .row,
body[data-view="document"] .document-tree:focus-within .node[data-kind="module"][data-selected="true"] > .row {
	background-color: var(--sel-container-bg);
}
body[data-view="document"] .document-tree:focus-within .node[data-kind="parameter"][data-selected="true"] > .row {
	box-shadow:
		inset 2px 0 0 var(--rail),
		inset 0 0 0 1px var(--sel-outline, transparent);
}
body[data-view="document"] .node:focus-visible > .row {
	box-shadow: inset 2px 0 0 var(--rail);
}
body[data-view="document"] .document-tree-scroll[data-empty="true"] {
	padding-top: 0;
	padding-bottom: 0;
}

@media (forced-colors: active) {
	body[data-view] .node[data-kind="container"] > .row > .label {
		color: var(--vscode-editor-foreground);
	}
	body[data-view] .node[data-subtree="true"] > .row,
	body[data-view] .brace[data-subtree="true"] > .row {
		background: transparent;
		outline: 1px dotted var(--vscode-contrastBorder, var(--vscode-focusBorder));
		outline-offset: -1px;
	}
	body[data-view] .node[data-selected="true"] > .row,
	body[data-view] .document-tree:focus-within .node[data-selected="true"] > .row {
		background: transparent;
		outline: 1px solid var(--vscode-contrastActiveBorder, var(--vscode-contrastBorder, var(--vscode-focusBorder)));
		outline-offset: -1px;
	}
	body[data-view] .node:hover > .row {
		background: transparent;
		outline: 1px dashed var(--vscode-contrastBorder, var(--vscode-focusBorder));
		outline-offset: -1px;
	}
	body[data-view] .node:focus-visible > .row {
		box-shadow: none;
		outline: 2px solid var(--vscode-focusBorder);
		outline-offset: -2px;
	}
	body[data-view] mark {
		color: var(--vscode-editor-foreground);
		background: transparent;
		outline: 1px solid var(--vscode-contrastActiveBorder, var(--vscode-focusBorder));
	}
	body[data-view] .node.flash > .row {
		animation: none;
		outline: 1px solid var(--vscode-contrastActiveBorder, var(--vscode-focusBorder));
	}
}
body.vscode-high-contrast[data-view] .node[data-kind="container"] > .row > .label {
	color: var(--vscode-editor-foreground);
}
body.vscode-high-contrast[data-view] .node[data-subtree="true"] > .row,
body.vscode-high-contrast[data-view] .brace[data-subtree="true"] > .row {
	background: transparent;
	outline: 1px dotted var(--vscode-contrastBorder, var(--vscode-focusBorder));
	outline-offset: -1px;
}
body.vscode-high-contrast[data-view] .node[data-selected="true"] > .row,
body.vscode-high-contrast[data-view] .document-tree:focus-within .node[data-selected="true"] > .row {
	background: transparent;
	outline: 1px solid var(--vscode-contrastActiveBorder, var(--vscode-contrastBorder, var(--vscode-focusBorder)));
	outline-offset: -1px;
}
body.vscode-high-contrast[data-view] .node:hover > .row {
	background: transparent;
	outline: 1px dashed var(--vscode-contrastBorder, var(--vscode-focusBorder));
	outline-offset: -1px;
}
body.vscode-high-contrast[data-view] .node:focus-visible > .row {
	box-shadow: none;
	outline: 2px solid var(--vscode-focusBorder);
	outline-offset: -2px;
}
body.vscode-high-contrast[data-view] mark {
	color: var(--vscode-editor-foreground);
	background: transparent;
	outline: 1px solid var(--vscode-contrastActiveBorder, var(--vscode-focusBorder));
}
body.vscode-high-contrast[data-view] .node.flash > .row {
	animation: none;
	outline: 1px solid var(--vscode-contrastActiveBorder, var(--vscode-focusBorder));
}

@media (max-width: 720px) {
body[data-view="document"] {
		--doc-pad: 2.5ch;
		--indent: 3ch;
		--content-pad: calc(var(--fold-gutter) + var(--doc-pad));
	}
}
`;
}
