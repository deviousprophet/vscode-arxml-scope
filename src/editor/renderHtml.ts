/**
 * Webview HTML for the virtualised ECUC views (task design §3, §5, §6).
 *
 * The host no longer builds one DOM node per entity. `renderHtml` embeds a
 * compact row document (`buildRows`) as escaped JSON, plus a static shell: the
 * toolbar, the schema/package header, the `role="tree"` container with its
 * virtual spacers, the empty state and the details inspector. The inlined page
 * script flattens the rows (collapse/filter), asks the pure virtual-scroll math
 * for a viewport window and builds only those rows with DOM APIs. The same
 * script survives a re-scan: the host sends a new row array and the page keeps
 * its selection, collapsed set, query, view and scroll where it can.
 *
 * Everything is inlined — no asset files, no remote loads — because the CSP
 * forbids them and `esbuild.js` has no asset-copy step. Every colour is a
 * `--vscode-*` custom property (or a fallback inside one). The page never uses
 * a style attribute: row depth is `data-level` CSS and the virtual spacer
 * heights come from a nonce-carrying stylesheet whose text is updated.
 *
 * The pure helpers that decide re-scan state, the inspector and focus are
 * defined here as real functions and serialized into the page with
 * `toString()`, so the page and the tests share one definition.
 */
import { randomBytes } from 'crypto';
import { EcucDocumentModel, SortMode } from '../core/ecuc/model';
import { LineIndex } from '../core/text/offsets';
import { buildFilterIndex, createFilterDebouncer, filterRows, flattenRows, matchRanges } from './filter';
import { EcucRow, MetaPart, buildRows } from './renderRows';
import { virtualScrollScript } from './virtualScroll';
import { valueEditorScript } from './ecucValueEditor';

export interface RenderOptions {
	/** Inline-script nonce; generated when absent. */
	nonce?: string;
	sort?: SortMode;
	sortExcept?: readonly string[];
	/** Node to select on load (child design §2.4, source → editor). */
	selectedId?: string;
	/**
	 * The current document text's line index. When present, every row carries
	 * its source position; the details inspector adds one for display. The
	 * renderer never guesses a position from the displayed order.
	 */
	lineIndex?: LineIndex;
}

/** The initial row payload the page parses before its first render. */
export interface RowPayload {
	rows: EcucRow[];
	digits: number;
	selectedId?: string;
}

/**
 * Serialises the row document for a `<script type="application/json">` block.
 * `<` is escaped so model text can never close the script element; the page
 * calls `JSON.parse` and never evaluates it.
 */
export function encodeRowDocument(payload: RowPayload): string {
	return JSON.stringify(payload)
		.replace(/</g, '\\u003c')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
}

/** The state a re-scan keeps, pruned to the rows that still exist. */
export interface RowState {
	selectedId?: string;
	collapsed: string[];
	query: string;
	view: 'document' | 'tree';
}

/**
 * Keeps the selection when its row survived, prunes collapse ids that are gone,
 * and leaves the query/view alone. This is the whole re-scan policy, in one
 * place the page serialises and the tests drive.
 */
export function reconcileRowState(state: RowState, rows: readonly { id: string }[]): RowState {
	const present = new Set(rows.map((row) => row.id));
	const selectedId =
		state.selectedId !== undefined && present.has(state.selectedId) ? state.selectedId : undefined;
	return {
		selectedId,
		collapsed: pruneCollapsed(state.collapsed, rows.map((row) => row.id)),
		query: state.query,
		view: state.view,
	};
}

/**
 * The roving/focused row after a window update: keep the previous focus if it
 * is still rendered, else the selected row if it is, else the first rendered
 * row. `undefined` only when nothing is rendered.
 */
export function resolveFocusId(
	previousFocusId: string | undefined,
	renderedIds: readonly string[],
	preferredId?: string
): string | undefined {
	if (previousFocusId !== undefined && renderedIds.includes(previousFocusId)) {
		return previousFocusId;
	}
	if (preferredId !== undefined && renderedIds.includes(preferredId)) {
		return preferredId;
	}
	return renderedIds.length > 0 ? renderedIds[0] : undefined;
}

/** The fields the details panel shows, read from a row (not from a DOM node). */
export interface InspectorFields {
	kind: string;
	label: string;
	definitionRef: string;
	shortName: string;
	variant: string;
	value: string;
	hex: string;
	target: string;
	context: string;
	conditions: string;
	annotations: string;
	source?: { line: number; column: number; endLine: number; endColumn: number };
}

/**
 * Reads the inspector's fields from the row data. The panel therefore works
 * for a selected row that is outside the rendered window; it never queries the
 * tree DOM. Serialized into the page so the test and the panel share one
 * definition.
 */
export function inspectorFields(row: EcucRow): InspectorFields {
	const parts = (cls: MetaPart['cls']): string[] =>
		row.meta.filter((part) => part.cls === cls).map((part) => part.text);
	const contextText = parts('context')[0] ?? '';
	const context =
		row.contextPaths && row.contextPaths.length > 0
			? row.contextPaths.join(', ')
			: contextText.startsWith('context ')
				? contextText.slice('context '.length)
				: contextText;
	return {
		kind: row.kind,
		label: row.label,
		definitionRef: row.definitionRef,
		shortName: row.shortName ?? '',
		variant: parts('variant')[0] ?? '',
		value: row.value ?? '',
		hex: parts('hex')[0] ?? '',
		target: row.target ?? '',
		context,
		conditions: parts('condition').join('\n'),
		annotations: parts('annotation').join('\n'),
		source:
			row.sourceLine > 0
				? { line: row.line, column: row.column, endLine: row.endLine, endColumn: row.endColumn }
				: undefined,
	};
}

/** Builds the whole page. */
export function renderHtml(model: EcucDocumentModel, options: RenderOptions = {}): string {
	const nonce = options.nonce ?? randomBytes(16).toString('base64');
	const document = buildRows(model, {
		sort: options.sort,
		sortExcept: options.sortExcept,
		lineIndex: options.lineIndex,
	});
	const payload = encodeRowDocument({
		rows: document.rows,
		digits: document.digits,
		selectedId: options.selectedId,
	});
	const meta = headerHtml(model);
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">${STYLE}</style>
<style id="virtual-style" nonce="${nonce}">#tree-top{height:0px}#tree-bottom{height:0px}</style>
</head>
<body data-view="document">
<div class="toolbar">
<div class="filter-wrap">
<input id="filter" class="filter" type="search" placeholder="Filter" aria-label="Filter the ECUC tree">
<button id="filter-clear" class="filter-clear" type="button" title="Clear the filter" aria-label="Clear the filter" hidden><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
</div>
<span id="count" class="count" role="status" aria-live="polite" data-state="none"></span>
<span class="grow"></span>
<button id="collapse-all" class="tool icon-tool" type="button" title="Collapse every container" aria-label="Collapse every container"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3 6h4V2M3 6l4-4M13 10H9v4M13 10l-4 4"/></svg></button>
<button id="expand-all" class="tool icon-tool" type="button" title="Expand every container" aria-label="Expand every container"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M7 2v4H3M7 2L3 6M9 14v-4h4M9 14l4-4"/></svg></button>
<button id="view-toggle" class="tool view-switch" type="button" aria-pressed="true" title="Switch to tree view"><span class="view-document">Document</span><span class="view-sep" aria-hidden="true">|</span><span class="view-tree">Tree</span></button>
<button id="details-toggle" class="tool details-toggle" type="button" aria-pressed="false" aria-controls="inspector" title="Show node details" aria-label="Show node details"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6 3v10"/></svg><span class="lbl">Details</span></button>
</div>
<div id="notice" class="notice" role="status" aria-live="polite"></div>
<div id="content">
<div id="main">
<div class="document">
<div class="meta">${meta}</div>
<div id="tree-measure" aria-hidden="true"><div class="node probe-doc"><span class="row k-parameter has-value"><span class="spacer"></span><span class="glyph"></span><span class="label">x</span><span class="value"><span class="punct">=</span> <span class="value-text">0</span></span></span></div><div class="node probe-tree-short"><span class="row k-parameter has-value"><span class="spacer"></span><span class="glyph"></span><span class="label">x</span><span class="value"><span class="punct">=</span> <span class="value-text">0</span></span></span></div><div class="node has-meta probe-tree-tall"><span class="row k-parameter has-value"><span class="spacer"></span><span class="glyph"></span><span class="label">x</span><span class="value"><span class="punct">=</span> <span class="value-text">0</span></span><span class="row-meta"><span class="hex">(= 0x0)</span></span></span></div></div>
<div id="tree" class="tree" role="tree" aria-label="ECUC values" data-ln-digits="${document.digits}"><div id="tree-top" class="v-spacer" role="presentation" aria-hidden="true"></div><div id="tree-window" role="presentation"></div><div id="tree-bottom" class="v-spacer" role="presentation" aria-hidden="true"></div></div>
<div id="empty" class="empty" hidden><p id="empty-text"></p><button id="empty-clear" class="tool" type="button">Clear filter</button></div>
</div>
</div>
<aside id="inspector" class="inspector" role="region" aria-label="Node details" hidden>
<div class="inspector-empty">
<p>Select a line to see its details.</p>
<p class="inspector-hint">Click a line or press Space.</p>
</div>
</aside>
</div>
<script type="application/json" id="ecuc-rows" nonce="${nonce}">${payload}</script>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
${valueEditorScript()}
${TREE_SCRIPT}
</script>
</body>
</html>`;
}

/** The small schema/package header that aligns with the gutter. */
function headerHtml(model: EcucDocumentModel): string {
	const meta: string[] = [];
	if (model.schema) {
		meta.push(
			`<div class="schema"><span class="keyword">schema</span> <span class="number">${escapeHtml(
				model.schema.release
			)}</span></div>`
		);
	}
	for (const pkg of model.packages) {
		meta.push(`<div class="package"><span class="keyword">package</span> ${escapeHtml(pkg.path.join('.'))}</div>`);
	}
	return meta.join('');
}

/** Text-content escaping; quotes are safe in text. */
function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ---------------------------------------------------------------------------------
 * Re-scan state (design §8). Serialized into the page with `toString()` so the
 * webview and the tests run the same code.
 * ------------------------------------------------------------------------------- */

/** Drops the ids that no longer exist, leaving the rest of the set alone. */
export function pruneCollapsed(collapsed: readonly string[], present: readonly string[]): string[] {
	const alive = new Set(present);
	return collapsed.filter((id) => alive.has(id));
}

/** Adds or removes `id`; a node without children can never be collapsed. */
export function toggleCollapsed(collapsed: readonly string[], id: string, hasChildren: boolean): string[] {
	if (!hasChildren) {
		return collapsed.slice();
	}
	return collapsed.includes(id) ? collapsed.filter((other) => other !== id) : collapsed.concat([id]);
}

/** Collapse-all: every node that has something to hide. */
export function collapsedIdsFor(items: readonly { id: string; hasChildren: boolean }[]): string[] {
	return items.filter((item) => item.hasChildren).map((item) => item.id);
}

/**
 * The index a movement key moves focus to, or `undefined` when the key is not a
 * move (UX child design §8). `page` is how many rows fit in the viewport, so
 * PageUp/PageDown move by a screen rather than a fixed count.
 */
export function moveTarget(key: string, from: number, count: number, page: number): number | undefined {
	if (count === 0) {
		return undefined;
	}
	if (key === 'ArrowDown') {
		return Math.min(from + 1, count - 1);
	}
	if (key === 'ArrowUp') {
		return Math.max(from - 1, 0);
	}
	if (key === 'Home') {
		return 0;
	}
	if (key === 'End') {
		return count - 1;
	}
	if (key === 'PageUp') {
		return Math.max(from - page, 0);
	}
	if (key === 'PageDown') {
		return Math.min(from + page, count - 1);
	}
	return undefined;
}

const DOCUMENT_LEVEL_RULES = Array.from({ length: 24 }, (_, at) => {
	const level = at + 1;
	// The row itself stays anchored at the gutter edge so its tint/rail cover the
	// gutter; depth is padding, not a parent margin (the flat list has no wrappers).
	const indent = level === 1 ? 'var(--gut)' : `calc(var(--gut) + var(--indent) * ${level - 1})`;
	const guideWidth = level === 1 ? '0' : `calc(var(--indent) * ${level - 1} + 1px)`;
	return `body[data-view="document"] .row[data-level="${level}"] { margin-left: calc(-1 * var(--gut)); padding-left: ${indent}; background-size: ${guideWidth} 100%; }`;
}).join('\n');

const STYLE = `
html, body {
	height: 100%;
}
body {
	font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif);
	font-size: var(--vscode-font-size, 13px);
	line-height: 1.4;
	color: var(--vscode-foreground);
	background: var(--vscode-editor-background);
	margin: 0;
	display: flex;
	flex-direction: column;
	overflow: hidden;
}
/* Quiet-source tokens: one definition for both views. Plain declarations first are
 * the fallback for hosts without color-mix; the second declaration refines them. */
body[data-view] {
	--ecuc-fs: var(--vscode-editor-font-size, 13px);
	--ecuc-lh: calc(var(--ecuc-fs) * 1.55);
	--tree-row-h: calc(var(--ecuc-lh) + 5px);
	--tree-row-h-meta: calc(var(--ecuc-lh) * 2 + 5px);
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
	--rail: var(--vscode-focusBorder, var(--vscode-editorCursor-foreground, var(--vscode-editor-foreground)));
}
@supports (color: color-mix(in srgb, currentColor 50%, transparent)) {
	body[data-view] {
		--tok-comment: color-mix(in srgb, var(--vscode-charts-green, var(--vscode-editor-foreground)) 85%, var(--vscode-editor-background));
		--tok-punct: color-mix(in srgb, var(--vscode-editor-foreground) 70%, var(--vscode-editor-background));
		--tok-dim: color-mix(in srgb, var(--vscode-editor-foreground) 55%, var(--vscode-editor-background));
		/* A 10% dark / 2% fallback tint preserves token contrast; the light
		 * theme has no fill (below). The active line number and 2px rail
		 * carry the selection meaning. */
		--sel-bg: color-mix(in srgb, var(--vscode-list-inactiveSelectionBackground, var(--vscode-editor-background)) 2%, var(--vscode-editor-background));
		--sel-bg-focus: color-mix(in srgb, var(--vscode-list-activeSelectionBackground, var(--vscode-list-inactiveSelectionBackground, var(--vscode-editor-background))) 2%, var(--vscode-editor-background));
	}
	body.vscode-dark[data-view] {
		--sel-bg: color-mix(in srgb, var(--vscode-list-inactiveSelectionBackground, var(--vscode-editor-background)) 10%, var(--vscode-editor-background));
		--sel-bg-focus: color-mix(in srgb, var(--vscode-list-activeSelectionBackground, var(--vscode-list-inactiveSelectionBackground, var(--vscode-editor-background))) 10%, var(--vscode-editor-background));
	}
	body.vscode-light[data-view] {
		/* The light key accent is 4.51:1 on white; any fill would drop it below
		 * 4.5:1, so the light selection is the active line number + rail only. */
		--sel-bg: var(--vscode-editor-background);
		--sel-bg-focus: var(--vscode-editor-background);
	}
}
.toolbar {
	display: flex;
	flex-wrap: nowrap;
	gap: 6px;
	align-items: center;
	height: 26px;
	padding: 0 8px;
	flex: none;
	font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif);
	font-size: 12px;
	color: var(--tok-dim);
	background: var(--vscode-editor-background);
	border-bottom: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
}
.grow {
	flex: 1 1 auto;
}
.filter-wrap {
	position: relative;
	display: flex;
	flex: 0 1 28ch;
	min-width: 0;
	max-width: none;
}
.filter {
	width: 100%;
	min-width: 0;
	height: 20px;
	padding: 0 22px 0 6px;
	font: inherit;
	color: var(--vscode-editor-foreground);
	background: transparent;
	border: 1px solid transparent;
	border-radius: 2px;
}
.filter:not(:placeholder-shown) {
	color: var(--vscode-input-foreground, var(--vscode-editor-foreground));
	background: var(--vscode-input-background);
}
.filter:focus-visible {
	outline: 1px solid var(--vscode-focusBorder, var(--vscode-contrastActiveBorder, transparent));
	outline-offset: -1px;
}
.filter-clear {
	position: absolute;
	right: 3px;
	top: 50%;
	transform: translateY(-50%);
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 18px;
	height: 18px;
	padding: 0;
	font: inherit;
	line-height: 1;
	cursor: pointer;
	color: var(--tok-dim);
	background: transparent;
	border: 0;
	border-radius: 2px;
}
.filter-clear[hidden] {
	display: none;
}
.filter-clear:hover {
	color: var(--vscode-foreground);
	background: var(--vscode-toolbar-hoverBackground, transparent);
}
.count {
	padding: 0;
	border: 0;
	white-space: nowrap;
	color: var(--tok-dim);
	background: transparent;
	font-size: 12px;
}
.count[data-state="none"] {
	padding: 0;
	background: transparent;
}
.count[data-state="empty"] {
	color: var(--tok-dim);
	background: transparent;
	border-color: transparent;
}
.tool {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 4px;
	height: 20px;
	padding: 0 6px;
	cursor: pointer;
	color: var(--tok-dim);
	background: transparent;
	border: 0;
	border-radius: 2px;
	font: inherit;
}
.tool:hover {
	color: var(--vscode-foreground);
	background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
}
.tool:focus-visible {
	outline: 1px solid var(--vscode-focusBorder, var(--vscode-contrastActiveBorder, transparent));
	outline-offset: 1px;
}
.tool svg {
	flex: none;
}
.icon-tool {
	width: 20px;
	padding: 0;
}
.view-switch {
	gap: 0;
	padding: 0 6px;
}
.view-switch .view-sep {
	color: var(--tok-dim);
	padding: 0 3px;
}
.view-switch .view-document,
.view-switch .view-tree {
	color: var(--tok-dim);
}
.view-switch[aria-pressed="true"] .view-document,
.view-switch[aria-pressed="false"] .view-tree {
	color: var(--vscode-foreground);
}
.details-toggle .lbl {
	white-space: nowrap;
}

.notice {
	padding: 0 8px;
	min-height: 18px;
	font-size: 12px;
	line-height: 18px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--tok-dim);
}
.notice:empty {
	display: none;
}
.notice[data-kind="warn"] {
	color: var(--vscode-editorWarning-foreground, var(--tok-dim));
}
#content {
	display: flex;
	flex: 1 1 auto;
	min-height: 0;
}
#main {
	flex: 1 1 auto;
	min-width: 0;
	overflow: auto;
	scroll-padding-left: 9ch;
	/* The window swaps spacer heights; browser scroll anchoring would fight the
	 * virtual range and snap the viewport back to the top. */
	overflow-anchor: none;
}
#inspector {
	flex: 0 0 clamp(260px, 30%, 340px);
	min-width: 0;
	overflow: auto;
	padding: 8px 10px 16px;
	border-left: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
	background: var(--vscode-editor-background);
}
#inspector[hidden] {
	display: none;
}
.document {
	position: relative;
}
.meta {
	padding: 6px 10px;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	color: var(--vscode-editor-foreground);
}
.schema, .package {
	font-family: inherit;
}
.meta .keyword {
	color: var(--tok-keyword);
}
.meta .number {
	color: var(--tok-number);
}
.number {
	color: var(--tok-number);
}
.tree {
	padding: 4px 0 12px;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
}
#tree[data-empty="true"] {
	padding-top: 0;
	padding-bottom: 0;
}
#tree-window {
	display: flow-root;
}
.v-spacer {
	pointer-events: none;
}
#tree-measure {
	position: absolute;
	left: -10000px;
	top: 0;
	width: 240px;
	visibility: hidden;
	pointer-events: none;
}
.node {
	outline: none;
}
.row {
	display: grid;
	grid-template-columns: 12px 12px 26ch minmax(0, 1fr);
	column-gap: 6px;
	row-gap: 1px;
	align-items: center;
	box-sizing: border-box;
	padding: 2px 8px 2px 4px;
	position: relative;
}
.row:hover {
	background-color: var(--hover-bg);
}
body[data-view="tree"] .node {
	height: var(--tree-row-h);
}
body[data-view="tree"] .node.has-meta {
	height: var(--tree-row-h-meta);
}
body[data-view="tree"] .row {
	height: 100%;
}
.twisty {
	grid-column: 1;
	grid-row: 1;
	width: 12px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	color: var(--vscode-icon-foreground, var(--vscode-foreground));
}
.spacer {
	grid-column: 1;
	grid-row: 1;
	width: 12px;
}
.twisty svg {
	transition: transform 120ms ease;
}
.node[aria-expanded="true"] > .row > .twisty svg {
	transform: rotate(90deg);
}
.glyph {
	grid-column: 2;
	grid-row: 1;
	width: 12px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	color: var(--vscode-icon-foreground, var(--vscode-foreground));
}
.label {
	grid-column: 3;
	grid-row: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: 600;
}
.row.no-value .label {
	grid-column: 3 / -1;
}
.value {
	grid-column: 4;
	grid-row: 1;
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
	grid-column: 3 / -1;
	grid-row: 2;
	display: flex;
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
.row.k-module {
	border-left: 2px solid var(--vscode-symbolIcon-moduleForeground, var(--vscode-symbolIcon-classForeground, var(--vscode-foreground)));
}
.row.k-container {
	border-left: 2px solid var(--vscode-symbolIcon-namespaceForeground, var(--vscode-symbolIcon-classForeground, var(--vscode-foreground)));
}
.row.k-parameter {
	border-left: 2px solid var(--vscode-symbolIcon-fieldForeground, var(--vscode-foreground));
}
.row.k-reference {
	border-left: 2px solid var(--vscode-symbolIcon-referenceForeground, var(--vscode-foreground));
}
.glyph .g-module {
	color: var(--vscode-symbolIcon-moduleForeground, var(--vscode-symbolIcon-classForeground, var(--vscode-icon-foreground)));
}
.glyph .g-container {
	color: var(--vscode-symbolIcon-namespaceForeground, var(--vscode-symbolIcon-classForeground, var(--vscode-icon-foreground)));
}
.glyph .g-parameter {
	color: var(--vscode-symbolIcon-fieldForeground, var(--vscode-icon-foreground));
}
.glyph .g-reference {
	color: var(--vscode-symbolIcon-referenceForeground, var(--vscode-icon-foreground));
}
.node:focus-visible > .row {
	box-shadow: inset 2px 0 0 var(--rail);
}
.node[data-selected="true"] > .row {
	background-color: var(--sel-bg);
	box-shadow: inset 2px 0 0 var(--rail);
}
#tree:focus-within .node[data-selected="true"] > .row {
	background-color: var(--sel-bg-focus);
	box-shadow: inset 2px 0 0 var(--rail);
}
/* Selection never recolours syntax; the tint, active line number and rail carry the state. */
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
	border: 1px solid var(--vscode-panel-border, transparent);
	border-radius: 3px;
	color: var(--tok-meta);
}
.annotation {
	padding: 0 4px;
	border: 1px solid var(--vscode-panel-border, transparent);
	border-radius: 3px;
	color: var(--tok-comment);
	font-style: italic;
}
.row.k-parameter > .value {
	cursor: text;
	border-bottom: 1px dotted var(--vscode-descriptionForeground);
}
.row.k-parameter:hover > .value::after {
	content: "\\270E";
	margin-left: 4px;
	color: var(--vscode-descriptionForeground);
}
.value-edit {
	min-width: 12ch;
	padding: 0 2px;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: inherit;
	line-height: inherit;
	vertical-align: baseline;
	color: var(--vscode-input-foreground);
	background: var(--vscode-input-background);
	border: 1px solid var(--vscode-focusBorder);
}
.value-edit[aria-invalid="true"] {
	border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground, var(--vscode-errorForeground)));
}
.value-error {
	margin-left: 1ch;
	color: var(--vscode-errorForeground);
	font-style: italic;
	white-space: pre-wrap;
}
.punct {
	color: var(--tok-punct);
}
.target {
	color: var(--vscode-editor-foreground);
	text-decoration: none;
	cursor: pointer;
}
.target:hover .value-text {
	text-decoration: underline;
	text-decoration-color: var(--vscode-textLink-foreground, var(--vscode-symbolIcon-referenceForeground, var(--vscode-foreground)));
	text-underline-offset: 3px;
}
.context {
	color: var(--vscode-editor-foreground);
}
.context .keyword {
	color: var(--tok-keyword);
}
.hex {
	color: var(--tok-number);
}
mark {
	color: var(--vscode-editor-findMatchForeground, var(--vscode-foreground));
	background: var(--vscode-editor-findMatchHighlightBackground, var(--vscode-list-hoverBackground));
}
.empty {
	padding: 0;
	text-align: left;
	color: var(--tok-comment);
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	line-height: var(--ecuc-lh);
	font-style: italic;
}
.empty[hidden] {
	display: none;
}
.empty p {
	margin: 0;
}
.empty .tool {
	margin-left: 1ch;
	font-style: normal;
}
.inspector-empty {
	padding: 6px 0;
	color: var(--tok-dim);
}
.inspector-empty p {
	margin: 0 0 6px;
}
.inspector-hint {
	font-size: 0.9em;
}
.inspector-kind {
	font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif);
	font-size: 11px;
	letter-spacing: 0;
	text-transform: none;
	color: var(--tok-dim);
}
.inspector-label {
	margin: 2px 0 10px;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	font-weight: 600;
	word-break: break-word;
}
.inspector-row {
	margin: 0 0 9px;
}
.inspector-key {
	display: block;
	margin-bottom: 2px;
	font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif);
	font-size: 11px;
	letter-spacing: 0;
	text-transform: none;
	color: var(--tok-dim);
}
.inspector-code {
	margin: 0;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	line-height: 1.4;
	white-space: normal;
	overflow-wrap: anywhere;
}
.inspector-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	margin-top: 12px;
}
/* Document view: quiet source. One editor surface, a real source-line gutter,
 * and hover/focus affordances. Tree view keeps its grid; document selectors are
 * scoped. See docs/ECUC_EDITOR_DESIGN_SPEC.md. */
body[data-view="document"] .document {
	--ln-digits: 4;
	--ln-w: calc(var(--ln-digits, 4) * 1ch + 1ch);
	--gut: calc(var(--ln-w) + 4ch);
	--indent: 4ch;
}
body[data-view="document"] .document:has(#tree[data-ln-digits="1"]) { --ln-digits: 1; }
body[data-view="document"] .document:has(#tree[data-ln-digits="2"]) { --ln-digits: 2; }
body[data-view="document"] .document:has(#tree[data-ln-digits="3"]) { --ln-digits: 3; }
body[data-view="document"] .document:has(#tree[data-ln-digits="4"]) { --ln-digits: 4; }
body[data-view="document"] .document:has(#tree[data-ln-digits="5"]) { --ln-digits: 5; }
body[data-view="document"] .document:has(#tree[data-ln-digits="6"]) { --ln-digits: 6; }
body[data-view="document"] .document:has(#tree[data-ln-digits="7"]) { --ln-digits: 7; }
body[data-view="document"] #tree {
	position: relative;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	font-weight: var(--vscode-editor-font-weight, normal);
	line-height: var(--ecuc-lh);
	font-variant-ligatures: none;
	tab-size: 4;
	white-space: pre;
	padding: calc(var(--ecuc-lh) * 0.5) 2ch calc(var(--ecuc-lh) * 3) var(--gut);
}
body[data-view="document"] .meta {
	padding: calc(var(--ecuc-lh) * 0.5) 0 0 var(--gut);
	margin-bottom: calc(var(--ecuc-lh) * 0.5);
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	line-height: var(--ecuc-lh);
	color: var(--vscode-editor-foreground);
}
body[data-view="document"] .schema,
body[data-view="document"] .package {
	font-family: inherit;
}
body[data-view="document"] .meta .keyword {
	color: var(--tok-keyword);
}
body[data-view="document"] .meta .number {
	color: var(--tok-number);
}
body[data-view="document"] .row {
	--indent-guide: var(--vscode-tree-indentGuidesStroke, var(--vscode-panel-border, #80808040));
	display: flex;
	flex-wrap: nowrap;
	gap: 1ch;
	align-items: baseline;
	height: var(--ecuc-lh);
	margin-left: calc(-1 * var(--gut));
	padding: 0 0 0 var(--gut);
	border: 0;
	background-color: transparent;
	/* Indent guides: one hairline every 4ch from the text edge. */
	background-image: repeating-linear-gradient(
		to right,
		transparent 0,
		transparent calc(var(--indent) - 1px),
		var(--indent-guide) calc(var(--indent) - 1px),
		var(--indent-guide) var(--indent)
	);
	background-origin: border-box;
	background-position: var(--gut) 0;
	background-repeat: no-repeat;
	background-size: 0 100%;
}
${DOCUMENT_LEVEL_RULES}
body[data-view="document"] .node[data-gap="true"] {
	padding-top: var(--ecuc-lh);
}
body[data-view="document"] .brace {
	height: var(--ecuc-lh);
}
body[data-view="document"] .brace .row {
	color: var(--tok-punct);
}
body[data-view="document"] .row::before {
	content: attr(data-line);
	position: absolute;
	left: 0;
	width: var(--ln-w);
	text-align: right;
	color: var(--vscode-editorLineNumber-foreground, var(--tok-dim));
	font-variant-numeric: tabular-nums;
	pointer-events: none;
}
body[data-view="document"] .node[data-selected="true"] > .row::before,
body[data-view="document"] .node:focus-visible > .row::before {
	color: var(--vscode-editorLineNumber-activeForeground, var(--tok-keyword));
}
body[data-view="document"] .node:hover > .row {
	background-color: var(--hover-bg);
}
body[data-view="document"] .row.k-module,
body[data-view="document"] .row.k-container,
body[data-view="document"] .row.k-parameter,
body[data-view="document"] .row.k-reference {
	border-left: 0;
}
body[data-view="document"] .glyph {
	display: none;
}
/* The twisty lives in the fold column of the gutter, not in the text flow. */
body[data-view="document"] .twisty,
body[data-view="document"] .spacer {
	position: absolute;
	left: calc(var(--ln-w) + 1ch);
	width: 2ch;
	height: var(--ecuc-lh);
	display: inline-flex;
	align-items: center;
	justify-content: center;
	margin: 0;
	padding: 0;
}
body[data-view="document"] .twisty svg {
	width: 10px;
	height: 10px;
}
body[data-view="document"] #tree:not(:hover):not(:focus-within) .node[aria-expanded="true"] > .row > .twisty {
	opacity: 0;
}
body[data-view="document"] .node[aria-expanded="false"] > .row > .twisty {
	opacity: 1;
}
body[data-view="document"] .node[aria-expanded="false"] > .row::after {
	content: " { … }";
	color: var(--tok-punct);
}
body[data-view="document"] .node[data-kind="parameter"][data-selected="true"] > .row::after {
	content: "  F2";
	color: var(--tok-dim);
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
body[data-view="document"] .value {
	flex: 0 0 auto;
	margin: 0;
	max-width: none;
	overflow: visible;
	text-overflow: clip;
	white-space: pre;
}
body[data-view="document"] .node[data-kind="parameter"] > .row > .value:hover {
	background-color: var(--vscode-toolbar-hoverBackground, var(--hover-bg));
	border-radius: 2px;
	cursor: text;
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
body[data-view="document"] .hex {
	color: var(--tok-number);
}
body[data-view="document"] .context {
	color: var(--vscode-editor-foreground);
}
body[data-view="document"] .target {
	color: var(--vscode-editor-foreground);
	text-decoration: none;
}
body[data-view="document"] .target:hover .value-text {
	text-decoration: underline;
	text-decoration-color: var(--vscode-textLink-foreground, var(--vscode-symbolIcon-referenceForeground, var(--vscode-foreground)));
	text-underline-offset: 3px;
}
body[data-view="document"] .condition,
body[data-view="document"] .annotation {
	padding: 0;
	border: 0;
	border-radius: 0;
}
body[data-view="document"] .annotation::before {
	content: "/* ";
}
body[data-view="document"] .annotation::after {
	content: " */";
}
body[data-view="document"] .row.k-module .label::before {
	content: "module ";
	color: var(--tok-keyword);
}
body[data-view="document"] .node[data-selected="true"] > .row {
	background-color: var(--sel-bg);
	box-shadow: inset 2px 0 0 var(--rail);
}
body[data-view="document"] #tree:focus-within .node[data-selected="true"] > .row {
	background-color: var(--sel-bg-focus);
	box-shadow: inset 2px 0 0 var(--rail);
}
body[data-view="document"] .node:focus-visible > .row {
	box-shadow: inset 2px 0 0 var(--rail);
}
body[data-view="document"] .row.k-parameter > .value {
	border-bottom: 0;
}
body[data-view="document"] .row.k-parameter:hover > .value::after {
	content: none;
}
body[data-view="document"] .value-edit {
	padding: 0 0.5ch;
	font-size: inherit;
	line-height: inherit;
	vertical-align: baseline;
}
body[data-view="document"] .empty {
	padding: 0 2ch 0 var(--gut);
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	line-height: var(--ecuc-lh);
	color: var(--tok-comment);
	font-style: italic;
}
body[data-view="document"] .empty p {
	margin: 0;
}
body[data-view="document"] .empty .tool {
	margin-left: 1ch;
	font-style: normal;
}
body[data-view="document"] #tree[data-empty="true"] {
	padding-top: 0;
	padding-bottom: 0;
}
@media (forced-colors: active) {
	body[data-view] .node[data-selected="true"] > .row,
	body[data-view] #tree:focus-within .node[data-selected="true"] > .row {
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
body.vscode-high-contrast[data-view] .node[data-selected="true"] > .row,
body.vscode-high-contrast[data-view] #tree:focus-within .node[data-selected="true"] > .row {
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
	body[data-view="document"] .document {
		--ln-w: 0ch;
		--gut: 3ch;
		--indent: 3ch;
	}
	body[data-view="document"] .row::before {
		display: none;
	}
	body[data-view="document"] .twisty,
	body[data-view="document"] .spacer {
		left: 0;
	}
	.toolbar {
		padding: 0 4px;
		gap: 3px;
	}
	.filter-wrap {
		flex: 1 1 0;
	}
	.count,
	.notice,
	.grow,
	.details-toggle .lbl {
		display: none;
	}
	.tool {
		padding: 0 4px;
	}
	#content {
		flex-direction: column;
	}
	#main {
		scroll-padding-left: 3ch;
	}
	#inspector {
		flex: 0 0 auto;
		min-width: 0;
		max-height: 45vh;
		border-left: 0;
		border-top: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
	}
}
@media (prefers-reduced-motion: reduce) {
	.twisty svg {
		transition: none;
	}
	.node.flash > .row {
		animation: ecuc-flash 1s steps(1, end);
	}
}
`;

/**
 * The page: the row store, flatten/collapse/filter, the virtual window, row
 * building, selection/focus, the inspector and the message bridge. The value
 * widget's script is emitted before this one and its document listeners claim
 * their events first; nothing here runs for an interaction it owns.
 */
const TREE_SCRIPT = `
const main = document.getElementById('main');
const tree = document.getElementById('tree');
const treeWindow = document.getElementById('tree-window');
const virtualStyle = document.getElementById('virtual-style');
const notice = document.getElementById('notice');
const inspector = document.getElementById('inspector');
const detailsToggle = document.getElementById('details-toggle');
const viewToggle = document.getElementById('view-toggle');
const filterInput = document.getElementById('filter');
const countLabel = document.getElementById('count');
const clearButton = document.getElementById('filter-clear');
const empty = document.getElementById('empty');
const emptyText = document.getElementById('empty-text');
const svgNamespace = 'http://www.w3.org/2000/svg';
const bufferRows = 10;
const savedState = vscode.getState();
// Only the object shape this page writes is accepted; anything else starts clean.
let viewState =
	savedState && typeof savedState === 'object' && !Array.isArray(savedState) ? savedState : {};
if (viewState.view !== 'tree' && viewState.view !== 'document') {
	viewState.view = 'document';
}
if (typeof viewState.inspectorHidden !== 'boolean') {
	viewState.inspectorHidden = true;
}

${pruneCollapsed.toString()}
${toggleCollapsed.toString()}
${collapsedIdsFor.toString()}
${moveTarget.toString()}
${virtualScrollScript()}
${matchRanges.toString()}
${buildFilterIndex.toString()}
${filterRows.toString()}
${flattenRows.toString()}
${createFilterDebouncer.toString()}
${inspectorFields.toString()}
${resolveFocusId.toString()}
${reconcileRowState.toString()}

let rows = [];
let rowById = new Map();
let displayRows = [];
let displayIndexById = new Map();
let visibleNodeIds = [];
let expandedIds = new Set();
let collapsed = new Set();
let selectedId;
let focusId;
let filterQuery = '';
let filterResult = null;
let filterIndex = { haystacks: [] };
let filterDebouncer = createFilterDebouncer(120);
let windowRange = [0, 0];
let renderedDataVersion = -1;
let dataVersion = 0;
let renderedById = new Map();
let heights = { document: 20, treeShort: 20, treeTall: 42 };
let heightFn = function () { return heights.document; };
let heightVersion = 0;
let scrollFrame = 0;
let typeAhead = { text: '', at: 0 };

function readInitialRows() {
	const script = document.getElementById('ecuc-rows');
	if (!script) {
		return { rows: [], digits: 1 };
	}
	try {
		return JSON.parse(script.textContent || '{}');
	} catch (error) {
		return { rows: [], digits: 1 };
	}
}

function indexRows() {
	rowById = new Map();
	for (let at = 0; at < rows.length; at++) {
		rowById.set(rows[at].id, rows[at]);
	}
	filterIndex = buildFilterIndex(rows);
}

function refreshFilter() {
	const query = filterQuery.trim();
	filterResult = query === '' ? null : filterRows(rows, query, filterIndex);
}

function buildHeightFn() {
	if (viewState.view === 'document') {
		const base = heights.document;
		heightFn = function (index) {
			const flat = displayRows[index];
			const row = flat && flat.type === 'node' ? rows[flat.rowIndex] : undefined;
			const gap = row && row.kind === 'module' && index > 0;
			return base + (gap ? base : 0);
		};
	} else {
		const short = heights.treeShort;
		const tall = heights.treeTall;
		heightFn = function (index) {
			const flat = displayRows[index];
			const row = flat && flat.type === 'node' ? rows[flat.rowIndex] : undefined;
			return row && row.meta.length > 0 ? tall : short;
		};
	}
	heightVersion++;
}

function measureHeights() {
	const measure = document.getElementById('tree-measure');
	if (!measure) {
		buildHeightFn();
		return;
	}
	const read = function (selector, fallback) {
		const element = measure.querySelector(selector);
		if (!element) {
			return fallback;
		}
		const height = element.getBoundingClientRect().height;
		return height > 0 ? height : fallback;
	};
	heights = {
		document: read('.probe-doc > .row', 20),
		treeShort: read('.probe-tree-short > .row', 20),
		treeTall: read('.probe-tree-tall > .row', 42)
	};
	buildHeightFn();
}

function rebuildDisplay() {
	const active = filterQuery.trim() !== '';
	displayRows = flattenRows(rows, {
		collapsed: collapsed,
		visible: active && filterResult ? filterResult.visible : undefined,
		filterActive: active,
		braces: viewState.view === 'document'
	});
	displayIndexById = new Map();
	visibleNodeIds = [];
	expandedIds = new Set();
	for (let at = 0; at < displayRows.length; at++) {
		const flat = displayRows[at];
		if (flat.type === 'node') {
			const row = rows[flat.rowIndex];
			displayIndexById.set(row.id, at);
			visibleNodeIds.push(row.id);
			// Expansion follows the displayed list: a row is expanded only when the
			// next displayed entry is its child/brace. This matches flattenRows,
			// including the filter force-expand of an ancestor with a visible
			// descendant, and never reports an expanded row with no children.
			const next = displayRows[at + 1];
			const descendantShown =
				!!next &&
				((next.type === 'brace-open' && next.rowIndex === flat.rowIndex) ||
					(next.type === 'node' && next.level > flat.level));
			if (row.hasChildren && descendantShown) {
				expandedIds.add(row.id);
			}
		}
	}
	buildHeightFn();
	tree.dataset.empty = displayRows.length === 0 ? 'true' : 'false';
}

function setRows(nextRows, nextDigits, nextSelectedId) {
	const incoming = Array.isArray(nextRows) ? nextRows : [];
	const state = reconcileRowState(
		{
			selectedId: nextSelectedId !== undefined ? nextSelectedId : selectedId,
			collapsed: Array.from(collapsed),
			query: filterQuery,
			view: viewState.view
		},
		incoming
	);
	rows = incoming;
	collapsed = new Set(state.collapsed);
	selectedId = state.selectedId;
	filterQuery = state.query;
	indexRows();
	if (focusId !== undefined && !rowById.has(focusId)) {
		focusId = selectedId;
	}
	refreshFilter();
	rebuildDisplay();
	tree.dataset.lnDigits = String(Number.isFinite(nextDigits) && nextDigits > 0 ? nextDigits : 1);
	measureHeights();
	dataVersion++;
}

function treeWindowTop() {
	// The rows region starts at #tree's content edge, before the top spacer. Using
	// the window element's own position would move with that spacer, so a window
	// update would look like a scroll back to the top; this offset is stable.
	const mainRect = main.getBoundingClientRect();
	const treeRect = tree.getBoundingClientRect();
	const padding = parseFloat(getComputedStyle(tree).paddingTop) || 0;
	return treeRect.top - mainRect.top + main.scrollTop + padding;
}

function virtualState() {
	return {
		rowCount: displayRows.length,
		rowHeight: heightFn,
		containerHeight: main.clientHeight,
		scrollTop: Math.max(0, main.scrollTop - treeWindowTop()),
		bufferSize: bufferRows,
		heightVersion: heightVersion
	};
}

function setSpacers(top, bottom) {
	virtualStyle.textContent =
		'#tree-top{height:' + Math.max(0, top) + 'px}' +
		'#tree-bottom{height:' + Math.max(0, bottom) + 'px}';
}

function svgIcon(kind) {
	const svg = document.createElementNS(svgNamespace, 'svg');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('width', '10');
	svg.setAttribute('height', '10');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('class', 'g-' + kind);
	if (kind === 'module') {
		svg.setAttribute('fill', 'currentColor');
		const rect = document.createElementNS(svgNamespace, 'rect');
		rect.setAttribute('x', '3');
		rect.setAttribute('y', '3');
		rect.setAttribute('width', '10');
		rect.setAttribute('height', '10');
		svg.appendChild(rect);
	} else if (kind === 'container') {
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '1.5');
		const rect = document.createElementNS(svgNamespace, 'rect');
		rect.setAttribute('x', '3.5');
		rect.setAttribute('y', '3.5');
		rect.setAttribute('width', '9');
		rect.setAttribute('height', '9');
		svg.appendChild(rect);
	} else if (kind === 'parameter') {
		svg.setAttribute('fill', 'currentColor');
		const circle = document.createElementNS(svgNamespace, 'circle');
		circle.setAttribute('cx', '8');
		circle.setAttribute('cy', '8');
		circle.setAttribute('r', '3');
		svg.appendChild(circle);
	} else if (kind === 'reference') {
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '1.5');
		const path = document.createElementNS(svgNamespace, 'path');
		path.setAttribute('d', 'M2.5 8h8M8 5l3 3-3 3');
		svg.appendChild(path);
	} else {
		svg.setAttribute('fill', 'currentColor');
		const path = document.createElementNS(svgNamespace, 'path');
		path.setAttribute('d', 'M6 4l4 4-4 4z');
		svg.appendChild(path);
	}
	return svg;
}

function twistySpan() {
	const span = document.createElement('span');
	span.className = 'twisty';
	span.setAttribute('aria-hidden', 'true');
	span.appendChild(svgIcon('twisty'));
	return span;
}

function spacerSpan() {
	const span = document.createElement('span');
	span.className = 'spacer';
	span.setAttribute('aria-hidden', 'true');
	return span;
}

function glyphSpan(kind) {
	const span = document.createElement('span');
	span.className = 'glyph';
	span.setAttribute('aria-hidden', 'true');
	span.appendChild(svgIcon(kind));
	return span;
}

function appendHighlighted(parent, text, query) {
	const needle = query === undefined ? filterQuery : query;
	const ranges = needle.trim() === '' ? [] : matchRanges(text, needle);
	if (ranges.length === 0) {
		parent.appendChild(document.createTextNode(text));
		return;
	}
	let at = 0;
	for (const range of ranges) {
		if (range.start > at) {
			parent.appendChild(document.createTextNode(text.slice(at, range.start)));
		}
		const mark = document.createElement('mark');
		mark.textContent = text.slice(range.start, range.end);
		parent.appendChild(mark);
		at = range.end;
	}
	if (at < text.length) {
		parent.appendChild(document.createTextNode(text.slice(at)));
	}
}

function valueSpan(row) {
	const value = document.createElement('span');
	value.className = row.kind === 'reference' ? 'value target' : 'value';
	if (row.kind === 'parameter') {
		value.dataset.valueKind = row.valueKind || 'textual';
		value.title = 'Click to edit, or press F2: = ' + (row.shownValue || '');
	} else {
		value.dataset.follow = 'true';
		value.title = 'Follow to the target: = ' + (row.shownValue || '');
	}
	const punct = document.createElement('span');
	punct.className = 'punct';
	punct.textContent = '=';
	value.appendChild(punct);
	value.appendChild(document.createTextNode(' '));
	const text = document.createElement('span');
	text.className = 'value-text';
	appendHighlighted(text, row.shownValue || '');
	value.appendChild(text);
	return value;
}

function metaSpan(row) {
	const meta = document.createElement('span');
	meta.className = 'row-meta';
	for (const part of row.meta) {
		const span = document.createElement('span');
		span.className = part.cls;
		span.title = part.title;
		if (part.cls === 'context' && part.text.indexOf('context ') === 0) {
			const keyword = document.createElement('span');
			keyword.className = 'keyword';
			keyword.textContent = 'context';
			span.appendChild(keyword);
			span.appendChild(document.createTextNode(' ' + part.text.slice('context '.length)));
		} else if (part.cls === 'short') {
			appendHighlighted(span, part.text);
		} else {
			span.textContent = part.text;
		}
		meta.appendChild(span);
	}
	return meta;
}

function buildNodeRow(row, displayIndex) {
	const node = document.createElement('div');
	node.className = row.meta.length > 0 ? 'node has-meta' : 'node';
	node.setAttribute('role', 'treeitem');
	node.setAttribute('aria-level', String(row.level));
	node.setAttribute('aria-posinset', String(row.posinset));
	node.setAttribute('aria-setsize', String(row.setsize));
	node.setAttribute('aria-selected', row.id === selectedId ? 'true' : 'false');
	if (row.hasChildren) {
		node.setAttribute('aria-expanded', expandedIds.has(row.id) ? 'true' : 'false');
	}
	node.tabIndex = -1;
	node.dataset.nodeId = row.id;
	node.dataset.kind = row.kind;
	node.dataset.definitionRef = row.definitionRef;
	node.dataset.shortName = row.shortName || '';
	if (row.kind === 'parameter') {
		node.dataset.value = row.value || '';
	}
	if (row.kind === 'reference') {
		node.dataset.target = row.target || '';
	}
	if (row.sourceLine > 0) {
		node.dataset.line = String(row.line);
		node.dataset.column = String(row.column);
		node.dataset.endLine = String(row.endLine);
		node.dataset.endColumn = String(row.endColumn);
	}
	if (row.id === selectedId) {
		node.dataset.selected = 'true';
	}
	if (viewState.view === 'document' && row.kind === 'module' && displayIndex > 0) {
		node.dataset.gap = 'true';
	}
	node.title = row.title;

	const rowElement = document.createElement('span');
	rowElement.className =
		'row k-' + row.kind + (row.shownValue !== undefined ? ' has-value' : ' no-value');
	rowElement.dataset.level = String(row.level);
	if (row.sourceLine > 0) {
		rowElement.dataset.line = String(row.sourceLine);
	}
	rowElement.appendChild(row.hasChildren ? twistySpan() : spacerSpan());
	rowElement.appendChild(glyphSpan(row.kind));
	const label = document.createElement('span');
	label.className = 'label';
	appendHighlighted(label, row.label);
	rowElement.appendChild(label);
	if (row.kind === 'parameter' || row.kind === 'reference') {
		rowElement.appendChild(valueSpan(row));
	}
	if (row.meta.length > 0) {
		rowElement.appendChild(metaSpan(row));
	}
	node.appendChild(rowElement);
	return node;
}

function buildBraceRow(flat) {
	const node = document.createElement('div');
	node.className = 'brace';
	node.setAttribute('aria-hidden', 'true');
	const rowElement = document.createElement('span');
	rowElement.className = 'row brace-row';
	rowElement.dataset.level = String(flat.level);
	const mark = document.createElement('span');
	mark.className = 'punct brace-mark';
	mark.textContent = flat.type === 'brace-open' ? '{' : '}';
	rowElement.appendChild(mark);
	node.appendChild(rowElement);
	return node;
}

function buildDisplayRow(flat, displayIndex) {
	return flat.type === 'node' ? buildNodeRow(rows[flat.rowIndex], displayIndex) : buildBraceRow(flat);
}

function focusedNodeId() {
	const active = document.activeElement;
	if (active && active.closest) {
		const item = active.closest('#tree [role="treeitem"]');
		if (item) {
			return item.dataset.nodeId;
		}
	}
	return undefined;
}

function applyRoving(id) {
	for (const [renderedId, element] of renderedById) {
		element.tabIndex = renderedId === id ? 0 : -1;
	}
}

function renderWindow(force) {
	const state = virtualState();
	const range = calcVisibleRange(state);
	const start = range[0];
	const end = range[1];
	if (!force && start === windowRange[0] && end === windowRange[1] && renderedDataVersion === dataVersion) {
		return;
	}
	const previousFocus = focusedNodeId();
	windowRange = [start, end];
	renderedDataVersion = dataVersion;
	const total = calcTotalHeight(state);
	setSpacers(calcRowOffset(start, state), Math.max(0, total - calcRowOffset(end, state)));
	const fragment = document.createDocumentFragment();
	renderedById = new Map();
	for (let at = start; at < end; at++) {
		const flat = displayRows[at];
		if (!flat) {
			continue;
		}
		const element = buildDisplayRow(flat, at);
		if (flat.type === 'node') {
			renderedById.set(rows[flat.rowIndex].id, element);
		}
		fragment.appendChild(element);
	}
	const editing = typeof detachValueEdit === 'function' ? detachValueEdit() : null;
	treeWindow.textContent = '';
	treeWindow.appendChild(fragment);
	const rovingId = resolveFocusId(
		previousFocus,
		Array.from(renderedById.keys()),
		focusId !== undefined ? focusId : selectedId
	);
	applyRoving(rovingId);
	if (previousFocus !== undefined) {
		const element = renderedById.get(previousFocus);
		if (element) {
			element.focus({ preventScroll: true });
		}
	}
	// A window rebuild replaces the row the inline editor lived in. Move the
	// open editor to the rebuilt row (same id) so scrolling cannot leave a
	// detached input that later commits a hidden value; if the row left the
	// window, the edit is dropped with its input.
	if (editing && typeof reattachValueEdit === 'function') {
		const item = renderedById.get(editing.id);
		if (item) {
			reattachValueEdit(item, editing);
		}
	}
}

function expandAncestors(id) {
	let changed = false;
	let current = rowById.get(id);
	while (current && current.parentId !== null) {
		if (collapsed.delete(current.parentId)) {
			changed = true;
		}
		current = rowById.get(current.parentId);
	}
	return changed;
}

function ensureVisible(displayIndex) {
	const state = virtualState();
	const offset = calcRowOffset(displayIndex, state);
	const height = heightFn(displayIndex);
	const top = treeWindowTop();
	const viewTop = main.scrollTop - top;
	const viewBottom = viewTop + main.clientHeight;
	if (offset < viewTop) {
		main.scrollTop = top + offset;
	} else if (offset + height > viewBottom) {
		main.scrollTop = top + offset + height - main.clientHeight;
	}
}

function captureWindowAnchor() {
	if (displayRows.length === 0) {
		return null;
	}
	const state = virtualState();
	const scroll = Math.max(0, main.scrollTop - treeWindowTop());
	for (let at = windowRange[0]; at < windowRange[1]; at++) {
		const flat = displayRows[at];
		if (flat && flat.type === 'node') {
			return { id: rows[flat.rowIndex].id, delta: scroll - calcRowOffset(at, state) };
		}
	}
	return null;
}

function restoreWindowAnchor(anchor) {
	if (!anchor) {
		renderWindow(true);
		return;
	}
	const index = displayIndexById.get(anchor.id);
	if (index === undefined) {
		renderWindow(true);
		return;
	}
	const state = virtualState();
	main.scrollTop = treeWindowTop() + Math.max(0, calcRowOffset(index, state) + anchor.delta);
	renderWindow(true);
}

function focusRow(id) {
	const displayIndex = displayIndexById.get(id);
	if (displayIndex === undefined) {
		return false;
	}
	focusId = id;
	ensureVisible(displayIndex);
	renderWindow(true);
	const element = renderedById.get(id);
	if (!element) {
		return false;
	}
	applyRoving(id);
	element.focus({ preventScroll: true });
	return true;
}

/**
 * The value widget's focus seam. A rendered element is focused in place — the widget
 * has already inserted its input into that row, so a re-render here would detach it —
 * and an offscreen id is rendered (with its ancestors expanded) first.
 */
function focusItem(item) {
	if (!item) {
		return;
	}
	const id = item.dataset ? item.dataset.nodeId : undefined;
	if (!id) {
		item.focus({ preventScroll: true });
		return;
	}
	focusId = id;
	if (renderedById.get(id) === item) {
		applyRoving(id);
		item.focus({ preventScroll: true });
		return;
	}
	focusRow(id);
}

function setSelection(id) {
	selectedId = id;
	for (const [renderedId, element] of renderedById) {
		const on = renderedId === id;
		element.setAttribute('aria-selected', on ? 'true' : 'false');
		if (on) {
			element.dataset.selected = 'true';
		} else {
			delete element.dataset.selected;
		}
	}
	updateInspector();
}

function selectItem(item) {
	if (!item) {
		return;
	}
	const id = item.dataset.nodeId;
	if (!id) {
		return;
	}
	focusId = id;
	applyRoving(id);
	item.focus({ preventScroll: true });
	setSelection(id);
	vscode.postMessage({ type: 'select', nodeId: id });
}

function revealItem(item) {
	const id = typeof item === 'string' ? item : item && item.dataset ? item.dataset.nodeId : undefined;
	if (id) {
		vscode.postMessage({ type: 'reveal', nodeId: id });
	}
}

function followItem(item) {
	const id = typeof item === 'string' ? item : item && item.dataset ? item.dataset.nodeId : undefined;
	if (id) {
		vscode.postMessage({ type: 'follow', nodeId: id });
	}
}

function flipCollapsed(id, keepFocusId) {
	const row = rowById.get(id);
	if (!row || !row.hasChildren) {
		return;
	}
	collapsed = new Set(toggleCollapsed(Array.from(collapsed), id, true));
	rebuildDisplay();
	renderWindow(true);
	if (keepFocusId && displayIndexById.has(keepFocusId)) {
		focusId = keepFocusId;
		const element = renderedById.get(keepFocusId);
		if (element) {
			applyRoving(keepFocusId);
			element.focus({ preventScroll: true });
		}
	}
}

function prepareFocus() {
	if (selectedId !== undefined && rowById.has(selectedId)) {
		// A host selection can point inside a collapsed subtree; expand its
		// ancestors before deciding whether the row is displayable, then let the
		// refreshed spacers take the new total height before scrolling to it.
		if (expandAncestors(selectedId)) {
			rebuildDisplay();
			renderWindow(true);
		}
		if (displayIndexById.has(selectedId)) {
			focusRow(selectedId);
			return;
		}
	}
	const first = visibleNodeIds.length > 0 ? visibleNodeIds[0] : undefined;
	if (first !== undefined) {
		focusId = first;
		const element = renderedById.get(first);
		if (element) {
			applyRoving(first);
		}
	}
}

function typeAheadJump(character) {
	const now = Date.now();
	typeAhead.text = (now - typeAhead.at > 2000 ? '' : typeAhead.text) + character.toLowerCase();
	typeAhead.at = now;
	const start = focusId !== undefined ? visibleNodeIds.indexOf(focusId) : -1;
	for (let step = 1; step <= visibleNodeIds.length; step++) {
		const id = visibleNodeIds[(start + step + visibleNodeIds.length) % visibleNodeIds.length];
		const row = rowById.get(id);
		if (row && row.label.toLowerCase().indexOf(typeAhead.text) === 0) {
			focusRow(id);
			return;
		}
	}
}

function onRowClick(event) {
	if (!(event.target instanceof Element)) {
		return;
	}
	if (event.target.closest('#empty-clear')) {
		clearFilter(true);
		return;
	}
	const item = event.target.closest('#tree [role="treeitem"]');
	if (!item) {
		return;
	}
	// One interaction, one effect: the twisty toggles without moving the selection,
	// the target follows, everything else selects.
	if (event.target.closest('.twisty')) {
		flipCollapsed(item.dataset.nodeId);
		return;
	}
	if (event.target.closest('[data-follow]')) {
		followItem(item);
		return;
	}
	selectItem(item);
}

function onRowDoubleClick(event) {
	if (!(event.target instanceof Element)) {
		return;
	}
	const item = event.target.closest('#tree [role="treeitem"]');
	if (!item || event.target.closest('.twisty') || event.target.closest('[data-follow]')) {
		return;
	}
	revealItem(item);
}

function onTreeKeydown(event) {
	if (!(event.target instanceof Element)) {
		return;
	}
	const item = event.target.closest('#tree [role="treeitem"]');
	if (!item) {
		return;
	}
	const id = item.dataset.nodeId;
	const row = rowById.get(id);
	if (!row) {
		return;
	}
	const at = visibleNodeIds.indexOf(id);
	const displayIndex = displayIndexById.get(id);
	const page = Math.max(1, Math.floor(main.clientHeight / Math.max(1, heightFn(displayIndex === undefined ? 0 : displayIndex))));
	const moved = moveTarget(event.key, at, visibleNodeIds.length, page);
	if (moved !== undefined) {
		event.preventDefault();
		const nextId = visibleNodeIds[moved];
		if (nextId) {
			focusRow(nextId);
		}
		return;
	}
	if (event.key === 'ArrowRight') {
		event.preventDefault();
		if (row.hasChildren && collapsed.has(id)) {
			flipCollapsed(id, id);
		} else if (row.hasChildren) {
			const child = visibleNodeIds[at + 1];
			if (child) {
				focusRow(child);
			}
		}
	} else if (event.key === 'ArrowLeft') {
		event.preventDefault();
		if (row.hasChildren && !collapsed.has(id)) {
			flipCollapsed(id, id);
		} else if (row.parentId !== null) {
			focusRow(row.parentId);
		}
	} else if (event.key === 'Enter') {
		event.preventDefault();
		// A leaf has nothing to toggle, so revealing it is the only useful action; a
		// container is revealed with Ctrl/Alt+Enter or a double click (design §2).
		if (event.ctrlKey || event.altKey) {
			revealItem(id);
		} else if (row.hasChildren) {
			flipCollapsed(id, id);
		} else {
			revealItem(id);
		}
	} else if (event.key === ' ') {
		event.preventDefault();
		selectItem(item);
	} else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
		typeAheadJump(event.key);
	}
}

function collapseAll() {
	collapsed = new Set(collapsedIdsFor(rows));
	rebuildDisplay();
	renderWindow(true);
}

function expandAll() {
	collapsed = new Set();
	rebuildDisplay();
	renderWindow(true);
}

function focusAdjacentParameter(fromId, direction) {
	const parameters = visibleNodeIds.filter(function (id) {
		const row = rowById.get(id);
		return row && row.kind === 'parameter';
	});
	const at = parameters.indexOf(fromId);
	if (at === -1) {
		return undefined;
	}
	const nextId = parameters[direction === 'next' ? at + 1 : at - 1];
	if (!nextId) {
		return undefined;
	}
	return focusRow(nextId) ? nextId : undefined;
}

function renderedItemFor(id) {
	return renderedById.get(id);
}

function updateFilterUi() {
	if (clearButton) {
		clearButton.hidden = filterInput.value.trim() === '';
	}
	if (!countLabel) {
		return;
	}
	const active = filterQuery.trim() !== '';
	if (!active) {
		countLabel.textContent = '';
		countLabel.dataset.state = 'none';
		if (empty) {
			empty.hidden = true;
		}
		return;
	}
	if (!filterResult || filterResult.matchCount === 0) {
		countLabel.textContent = 'No matches';
		countLabel.dataset.state = 'empty';
		if (empty) {
			empty.hidden = false;
		}
		if (emptyText) {
			emptyText.textContent = '/* No entities match "' + filterInput.value.trim() + '". */';
		}
		return;
	}
	countLabel.textContent = filterResult.visibleCount + ' of ' + rows.length;
	countLabel.dataset.state = 'filtered';
	if (empty) {
		empty.hidden = true;
	}
}

function applyFilterQuery(query) {
	const anchor = captureWindowAnchor();
	const scrollTop = main.scrollTop;
	filterQuery = query;
	refreshFilter();
	rebuildDisplay();
	renderWindow(true);
	if (anchor && displayIndexById.has(anchor.id)) {
		restoreWindowAnchor(anchor);
	} else {
		main.scrollTop = scrollTop;
		renderWindow(true);
	}
	updateFilterUi();
}

function clearFilter(focusInput) {
	filterDebouncer.cancel();
	if (filterInput) {
		filterInput.value = '';
	}
	applyFilterQuery('');
	if (focusInput && filterInput) {
		filterInput.focus();
	}
}

function inspectorElement(tag, className, text) {
	const element = document.createElement(tag);
	if (className) {
		element.className = className;
	}
	if (text !== undefined) {
		element.textContent = text;
	}
	return element;
}

function inspectorRow(key, value) {
	const row = inspectorElement('div', 'inspector-row');
	row.appendChild(inspectorElement('span', 'inspector-key', key));
	row.appendChild(inspectorElement('div', 'inspector-code', value));
	return row;
}

/**
 * Rebuilds the details panel from the selected row's data. The selected row can
 * be outside the rendered window; nothing here queries the tree DOM.
 */
function updateInspector() {
	if (!inspector || inspector.hidden) {
		return;
	}
	inspector.textContent = '';
	const row = selectedId === undefined ? undefined : rowById.get(selectedId);
	if (!row) {
		const emptyPanel = inspectorElement('div', 'inspector-empty');
		emptyPanel.appendChild(inspectorElement('p', '', 'Select a line to see its details.'));
		emptyPanel.appendChild(inspectorElement('p', 'inspector-hint', 'Click a line or press Space.'));
		inspector.appendChild(emptyPanel);
		return;
	}
	const data = inspectorFields(row);
	inspector.appendChild(inspectorElement('div', 'inspector-kind', data.kind));
	inspector.appendChild(inspectorElement('div', 'inspector-label', data.label));
	if (data.definitionRef) {
		inspector.appendChild(inspectorRow('Definition', data.definitionRef));
	}
	if (data.shortName) {
		inspector.appendChild(inspectorRow('Short name', data.shortName));
	}
	if (data.variant) {
		inspector.appendChild(inspectorRow('Variant', data.variant));
	}
	if (data.kind === 'parameter') {
		inspector.appendChild(inspectorRow('Value', data.value === '' ? '(empty)' : data.value));
	}
	if (data.hex) {
		inspector.appendChild(inspectorRow('Hexadecimal', data.hex));
	}
	if (data.target) {
		inspector.appendChild(inspectorRow('Target', data.target));
	}
	if (data.context) {
		inspector.appendChild(inspectorRow('Context', data.context));
	}
	if (data.conditions) {
		inspector.appendChild(inspectorRow('Conditions', data.conditions));
	}
	if (data.annotations) {
		inspector.appendChild(inspectorRow('Annotations', data.annotations));
	}
	if (data.source) {
		inspector.appendChild(
			inspectorRow(
				'Source',
				'L' + (data.source.line + 1) + ':' + (data.source.column + 1) +
					' - L' + (data.source.endLine + 1) + ':' + (data.source.endColumn + 1)
			)
		);
	}

	const actions = inspectorElement('div', 'inspector-actions');
	const reveal = inspectorElement('button', 'tool', 'Reveal in source');
	reveal.type = 'button';
	reveal.addEventListener('click', function () { revealItem(row.id); });
	actions.appendChild(reveal);
	const path = data.definitionRef || data.label;
	if (path) {
		const copyPath = inspectorElement('button', 'tool', 'Copy path');
		copyPath.type = 'button';
		copyPath.addEventListener('click', function () { vscode.postMessage({ type: 'copy', text: path }); });
		actions.appendChild(copyPath);
	}
	const valueText = data.target || data.value;
	if (valueText) {
		const copyValue = inspectorElement('button', 'tool', data.target ? 'Copy target' : 'Copy value');
		copyValue.type = 'button';
		copyValue.addEventListener('click', function () { vscode.postMessage({ type: 'copy', text: valueText }); });
		actions.appendChild(copyValue);
	}
	inspector.appendChild(actions);
}

function applyView() {
	document.body.dataset.view = viewState.view;
	if (!viewToggle) {
		return;
	}
	const isDocument = viewState.view === 'document';
	viewToggle.setAttribute('aria-pressed', isDocument ? 'true' : 'false');
	viewToggle.title = isDocument ? 'Switch to tree view' : 'Switch to document view';
}

function applyInspectorVisibility() {
	if (!inspector || !detailsToggle) {
		return;
	}
	inspector.hidden = viewState.inspectorHidden === true;
	detailsToggle.setAttribute('aria-pressed', inspector.hidden ? 'false' : 'true');
	detailsToggle.title = inspector.hidden ? 'Show node details' : 'Hide node details';
	detailsToggle.setAttribute('aria-label', inspector.hidden ? 'Show node details' : 'Hide node details');
}

function toggleView() {
	const anchor = captureWindowAnchor();
	viewState.view = viewState.view === 'document' ? 'tree' : 'document';
	applyView();
	measureHeights();
	rebuildDisplay();
	renderWindow(true);
	restoreWindowAnchor(anchor);
	vscode.setState(viewState);
}

document.addEventListener('click', onRowClick);
document.addEventListener('dblclick', onRowDoubleClick);
document.addEventListener('keydown', onTreeKeydown);
document.addEventListener('focusin', function (event) {
	if (!(event.target instanceof Element)) {
		return;
	}
	const item = event.target.closest('#tree [role="treeitem"]');
	if (item) {
		focusId = item.dataset.nodeId;
		applyRoving(focusId);
	}
});
document.getElementById('collapse-all').addEventListener('click', collapseAll);
document.getElementById('expand-all').addEventListener('click', expandAll);

if (viewToggle) {
	viewToggle.addEventListener('click', toggleView);
}

if (detailsToggle && inspector) {
	detailsToggle.addEventListener('click', function () {
		viewState.inspectorHidden = !viewState.inspectorHidden;
		applyInspectorVisibility();
		vscode.setState(viewState);
		if (!viewState.inspectorHidden) {
			updateInspector();
		}
	});
}

if (filterInput) {
	filterInput.addEventListener('input', function () {
		if (clearButton) {
			clearButton.hidden = filterInput.value.trim() === '';
		}
		filterDebouncer.schedule(filterInput.value, function (query, generation) {
			if (!filterDebouncer.isCurrent(generation)) {
				return;
			}
			applyFilterQuery(query);
		});
	});
	filterInput.addEventListener('keydown', function (event) {
		if (event.key === 'Escape') {
			event.preventDefault();
			clearFilter(true);
		}
	});
}
if (clearButton) {
	clearButton.addEventListener('click', function () {
		clearFilter(true);
	});
}

main.addEventListener('scroll', function () {
	if (scrollFrame !== 0) {
		return;
	}
	scrollFrame = requestAnimationFrame(function () {
		scrollFrame = 0;
		renderWindow(false);
	});
});
window.addEventListener('resize', function () {
	measureHeights();
	renderWindow(true);
});

window.addEventListener('message', function (event) {
	const message = event.data;
	if (!message) {
		return;
	}
	if (message.type === 'model') {
		const scrollTop = main.scrollTop;
		const previousFocus = focusedNodeId() || focusId;
		setRows(message.rows, message.digits, message.selectedId);
		renderWindow(true);
		main.scrollTop = scrollTop;
		if (selectedId !== undefined && displayIndexById.has(selectedId)) {
			focusId = selectedId;
			const index = displayIndexById.get(selectedId);
			if (index < windowRange[0] || index >= windowRange[1]) {
				ensureVisible(index);
			}
		} else if (previousFocus !== undefined && displayIndexById.has(previousFocus)) {
			focusId = previousFocus;
		}
		renderWindow(true);
		updateInspector();
		updateFilterUi();
	} else if (message.type === 'select') {
		if (typeof message.nodeId !== 'string' || !rowById.has(message.nodeId)) {
			return;
		}
		if (expandAncestors(message.nodeId)) {
			rebuildDisplay();
			renderWindow(true);
		}
		focusRow(message.nodeId);
		setSelection(message.nodeId);
	} else if (message.type === 'notice') {
		notice.textContent = message.message;
		if (message.kind) {
			notice.dataset.kind = message.kind;
		} else {
			delete notice.dataset.kind;
		}
	}
});

// The view and panel preferences survive a re-scan (the shell is not swapped) and a
// full webview reload (the host state); the harness persists the same state in
// localStorage so the browser loop can exercise it.
applyView();
applyInspectorVisibility();
const initial = readInitialRows();
setRows(initial.rows, initial.digits, initial.selectedId);
renderWindow(true);
prepareFocus();
updateFilterUi();
updateInspector();
`;
