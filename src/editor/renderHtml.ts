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
 * its selection, collapsed set, query, inspector visibility and scroll where it can.
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
import { FlatRow, buildFilterIndex, createFilterDebouncer, filterRows, flattenRows, matchRanges } from './filter';
import { EcucRow, MetaPart, ParameterFormat, buildRows } from './renderRows';
import { virtualScrollScript } from './virtualScroll';
import { detailsEditorScript } from './ecucDetailsEditor';

export interface RenderOptions {
	/** Inline-script nonce; generated when absent. */
	nonce?: string;
	sort?: SortMode;
	sortExcept?: readonly string[];
	/** Node to select on load (child design §2.4, source → editor). */
	selectedId?: string;
}

/** The initial row payload the page parses before its first render. */
export interface RowPayload {
	rows: EcucRow[];
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
}

/**
 * Keeps the selection when its row survived, prunes collapse ids that are gone,
 * and leaves the query alone. This is the whole re-scan policy, in one place
 * the page serialises and the tests drive.
 */
export function reconcileRowState(state: RowState, rows: readonly { id: string }[]): RowState {
	const present = new Set(rows.map((row) => row.id));
	const selectedId =
		state.selectedId !== undefined && present.has(state.selectedId) ? state.selectedId : undefined;
	return {
		selectedId,
		collapsed: pruneCollapsed(state.collapsed, rows.map((row) => row.id)),
		query: state.query,
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

/** The selected row plus every descendant, in display order. */
export function subtreeRowIds(
	selectedId: string | undefined,
	rows: readonly { id: string; subtreeSize: number }[]
): string[] {
	if (selectedId === undefined) {
		return [];
	}
	const start = rows.findIndex((row) => row.id === selectedId);
	if (start < 0) {
		return [];
	}
	const end = Math.min(rows.length, start + 1 + Math.max(0, rows[start].subtreeSize));
	return rows.slice(start, end).map((row) => row.id);
}

/** One open container guide at a display row: its level and owning row id. */
export interface GuideSegment {
	level: number;
	id: string;
}

/**
 * The bracket guides for each display row. A container's opening brace starts a
 * guide for its body; its closing brace ends it. Nested containers add their own
 * segment, so a row inside both carries both guides. Header rows and the opening
 * brace itself carry only the outer guides.
 */
export function guidesFor(
	displayRows: readonly FlatRow[],
	rows: readonly { id: string }[]
): GuideSegment[][] {
	const guides: GuideSegment[][] = [];
	const open: GuideSegment[] = [];
	for (const flat of displayRows) {
		if (flat.type === 'brace-close') {
			guides.push(open.slice());
			const at = open.map((segment) => segment.level).lastIndexOf(flat.level);
			if (at >= 0) {
				open.splice(at, 1);
			}
		} else if (flat.type === 'brace-open') {
			guides.push(open.slice());
			open.push({ level: flat.level, id: rows[flat.rowIndex].id });
		} else {
			guides.push(open.slice());
		}
	}
	return guides;
}

/** The fields the details panel shows, read from a row (not from a DOM node). */
export interface InspectorFields {
	kind: string;
	label: string;
	definitionRef: string;
	shortName: string;
	variant: string;
	type: string;
	value: string;
	formats: ParameterFormat[];
	target: string;
	context: string;
	conditions: string;
	annotations: string;
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
		type: row.parameterType ?? '',
		value: row.value ?? '',
		formats: row.formats ?? [],
		target: row.target ?? '',
		context,
		conditions: parts('condition').join('\n'),
		annotations: parts('annotation').join('\n'),
	};
}

/** Builds the whole page. */
export function renderHtml(model: EcucDocumentModel, options: RenderOptions = {}): string {
	const nonce = options.nonce ?? randomBytes(16).toString('base64');
	const document = buildRows(model, {
		sort: options.sort,
		sortExcept: options.sortExcept,
	});
	const payload = encodeRowDocument({
		rows: document.rows,
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
<button id="collapse-all" class="tool icon-tool" type="button" title="Collapse every container" aria-label="Collapse every container"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3 6h4V2M3 6l4-4M13 10H9v4M13 10l-4 4"/></svg><span class="lbl">Collapse</span></button>
<button id="expand-all" class="tool icon-tool" type="button" title="Expand every container" aria-label="Expand every container"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M7 2v4H3M7 2L3 6M9 14v-4h4M9 14l4-4"/></svg><span class="lbl">Expand</span></button>
<button id="details-toggle" class="tool details-toggle" type="button" aria-pressed="false" aria-controls="inspector" title="Show node details" aria-label="Show node details"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6 3v10"/></svg><span class="lbl">Details</span></button>
</div>
<div id="notice" class="notice" role="status" aria-live="polite"></div>
<div id="content">
<div id="main">
<div class="document">
<div class="meta">${meta}</div>
<div id="tree-measure" aria-hidden="true"><div class="node probe-doc"><span class="row k-parameter has-value"><span class="label">x</span><span class="value"><span class="punct">=</span> <span class="value-text">0</span></span></span></div></div>
<div id="tree" class="tree" role="tree" aria-label="ECUC values"><div id="tree-top" class="v-spacer" role="presentation" aria-hidden="true"></div><div id="tree-window" role="presentation"></div><div id="tree-bottom" class="v-spacer" role="presentation" aria-hidden="true"></div></div>
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
${detailsEditorScript()}
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
	const indent = level === 1 ? 'var(--content-pad)' : `calc(var(--content-pad) + var(--indent) * ${level - 1})`;
	return `body[data-view="document"] .row[data-level="${level}"] { padding-left: ${indent}; }`;
}).join('\n');

const GUIDE_LEVEL_RULES = Array.from({ length: 24 }, (_, at) => {
	const level = at + 1;
	return `body[data-view="document"] .guide[data-level="${level}"] { left: calc(var(--content-pad) + var(--indent) * ${level - 1} + 0.5ch); }`;
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
/* Quiet-source tokens: one definition for the Document surface. Plain declarations first are
 * the fallback for hosts without color-mix; the second declaration refines them. */
body[data-view] {
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
	width: auto;
	min-width: 28px;
	padding: 0 8px;
	gap: 4px;
}
.icon-tool .lbl {
	white-space: nowrap;
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
	scroll-padding-left: var(--content-pad);
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
.node[data-selected="true"] > .row {
	background-color: var(--sel-bg);
	box-shadow: inset 2px 0 0 var(--rail);
}
#tree:focus-within .node[data-selected="true"] > .row {
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
.punct {
	color: var(--tok-punct);
}
.context {
	color: var(--vscode-editor-foreground);
}
.context .keyword {
	color: var(--tok-keyword);
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
.details-value {
	box-sizing: border-box;
	width: 100%;
	min-width: 0;
	padding: 2px 4px;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	line-height: 1.4;
	color: var(--vscode-input-foreground);
	background: var(--vscode-input-background);
	border: 1px solid var(--vscode-input-border, var(--vscode-focusBorder));
}
.details-value:focus {
	outline: 1px solid var(--vscode-focusBorder);
	outline-offset: -1px;
}
.details-value[aria-invalid="true"] {
	border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground, var(--vscode-errorForeground)));
}
.details-value-error {
	display: block;
	margin-top: 3px;
	color: var(--vscode-errorForeground);
	font-style: italic;
	white-space: pre-wrap;
}
.details-value-error:empty {
	display: none;
}
.inspector-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	margin-top: 12px;
}
/* Document view: quiet source. One editor surface, a fixed fold gutter and
 * hover/focus affordances. Layout variables live on body[data-view] so #main's
 * scroll padding sees them. */
body[data-view="document"] #tree {
	position: relative;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	font-weight: var(--vscode-editor-font-weight, normal);
	line-height: var(--ecuc-lh);
	font-variant-ligatures: none;
	tab-size: 4;
	white-space: pre;
	padding: calc(var(--ecuc-lh) * 0.5) 2ch calc(var(--ecuc-lh) * 3) 0;
}
body[data-view="document"] .meta {
	padding: calc(var(--ecuc-lh) * 0.5) 0 0 var(--content-pad);
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
body[data-view="document"] #tree:hover .node[aria-expanded="true"] > .row > .twisty,
body[data-view="document"] #tree:focus-within .node[aria-expanded="true"] > .row > .twisty,
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
body[data-view="document"] #tree:focus-within .node[data-selected="true"] > .row {
	background-color: var(--sel-bg-focus);
	box-shadow:
		inset 2px 0 0 var(--rail),
		inset 0 0 0 1px var(--sel-outline, transparent);
}
body[data-view="document"] #tree:focus-within .node[data-kind="container"][data-selected="true"] > .row,
body[data-view="document"] #tree:focus-within .node[data-kind="module"][data-selected="true"] > .row {
	background-color: var(--sel-container-bg);
}
body[data-view="document"] #tree:focus-within .node[data-kind="parameter"][data-selected="true"] > .row {
	box-shadow:
		inset 2px 0 0 var(--rail),
		inset 0 0 0 1px var(--sel-outline, transparent);
}
body[data-view="document"] .node:focus-visible > .row {
	box-shadow: inset 2px 0 0 var(--rail);
}
body[data-view="document"] .empty {
	padding: 0 2ch 0 var(--content-pad);
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
	body[data-view="document"] {
		--doc-pad: 2.5ch;
		--indent: 3ch;
		--content-pad: calc(var(--fold-gutter) + var(--doc-pad));
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
	.icon-tool .lbl,
	.details-toggle .lbl {
		display: none;
	}
	.tool {
		padding: 0 4px;
	}
	#content {
		flex-direction: column;
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
	.twisty,
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
const filterInput = document.getElementById('filter');
const countLabel = document.getElementById('count');
const clearButton = document.getElementById('filter-clear');
const empty = document.getElementById('empty');
const emptyText = document.getElementById('empty-text');
const svgNamespace = 'http://www.w3.org/2000/svg';
const bufferRows = 10;
const savedState = vscode.getState();
// Only the details visibility is persisted; an older saved view is ignored and never written back.
let uiState = { inspectorHidden: true };
if (
	savedState &&
	typeof savedState === 'object' &&
	!Array.isArray(savedState) &&
	typeof savedState.inspectorHidden === 'boolean'
) {
	uiState.inspectorHidden = savedState.inspectorHidden;
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
${subtreeRowIds.toString()}
${guidesFor.toString()}
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
let subtreeIds = new Set();
let guideLevels = [];
let hoveredGuideId;
let focusId;
let filterQuery = '';
let filterResult = null;
let filterIndex = { haystacks: [] };
let filterDebouncer = createFilterDebouncer(120);
let windowRange = [0, 0];
let renderedDataVersion = -1;
let dataVersion = 0;
let renderedById = new Map();
let heights = { document: 20 };
let heightFn = function () { return heights.document; };
let heightVersion = 0;
let scrollFrame = 0;
let typeAhead = { text: '', at: 0 };

function readInitialRows() {
	const script = document.getElementById('ecuc-rows');
	if (!script) {
		return { rows: [] };
	}
	try {
		return JSON.parse(script.textContent || '{}');
	} catch (error) {
		return { rows: [] };
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
	const base = heights.document;
	heightFn = function (index) {
		const flat = displayRows[index];
		const row = flat && flat.type === 'node' ? rows[flat.rowIndex] : undefined;
		const gap = row && row.kind === 'module' && index > 0;
		return base + (gap ? base : 0);
	};
	heightVersion++;
}

function measureHeights() {
	const measure = document.getElementById('tree-measure');
	if (!measure) {
		buildHeightFn();
		return;
	}
	const element = measure.querySelector('.probe-doc > .row');
	const measured = element ? element.getBoundingClientRect().height : 0;
	heights = { document: measured > 0 ? measured : 20 };
	buildHeightFn();
}

function rebuildDisplay() {
	const active = filterQuery.trim() !== '';
	displayRows = flattenRows(rows, {
		collapsed: collapsed,
		visible: active && filterResult ? filterResult.visible : undefined,
		filterActive: active,
		braces: true
	});
	guideLevels = guidesFor(displayRows, rows);
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

function setRows(nextRows, nextSelectedId) {
	const incoming = Array.isArray(nextRows) ? nextRows : [];
	const state = reconcileRowState(
		{
			selectedId: nextSelectedId !== undefined ? nextSelectedId : selectedId,
			collapsed: Array.from(collapsed),
			query: filterQuery
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
	subtreeIds = new Set(subtreeRowIds(selectedId, rows));
	refreshFilter();
	rebuildDisplay();
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

function twistyIcon() {
	const svg = document.createElementNS(svgNamespace, 'svg');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('width', '16');
	svg.setAttribute('height', '16');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('class', 'g-twisty');
	svg.setAttribute('fill', 'currentColor');
	const path = document.createElementNS(svgNamespace, 'path');
	// Codicon chevron-right (MIT, microsoft/vscode-codicons).
	path.setAttribute('d', 'M6.14601 3.14579C5.95101 3.34079 5.95101 3.65779 6.14601 3.85279L10.292 7.99879L6.14601 12.1448C5.95101 12.3398 5.95101 12.6568 6.14601 12.8518C6.34101 13.0468 6.65801 13.0468 6.85301 12.8518L11.353 8.35179C11.548 8.15679 11.548 7.83979 11.353 7.64478L6.85301 3.14479C6.65801 2.94979 6.34101 2.95079 6.14601 3.14579Z');
	svg.appendChild(path);
	return svg;
}

function twistySpan() {
	const span = document.createElement('span');
	span.className = 'twisty';
	span.setAttribute('aria-hidden', 'true');
	span.appendChild(twistyIcon());
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
	value.className = 'value';
	if (row.kind === 'parameter') {
		value.dataset.valueKind = row.valueKind || 'textual';
		value.title = 'Value: ' + (row.shownValue || '') + ' - edit in Details';
	} else {
		value.title = 'Target: ' + (row.shownValue || '');
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
	if (row.id === selectedId) {
		node.dataset.selected = 'true';
	}
	if (subtreeIds.has(row.id) && row.id !== selectedId) {
		node.dataset.subtree = 'true';
	}
	if (row.kind === 'module' && displayIndex > 0) {
		node.dataset.gap = 'true';
	}
	if (row.empty) {
		node.dataset.empty = 'true';
	}
	node.title = row.title;

	const rowElement = document.createElement('span');
	rowElement.className =
		'row k-' + row.kind + (row.shownValue !== undefined ? ' has-value' : ' no-value');
	rowElement.dataset.level = String(row.level);
	if (row.hasChildren) {
		rowElement.appendChild(twistySpan());
	}
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
	appendGuides(rowElement, displayIndex);
	node.appendChild(rowElement);
	return node;
}

function appendGuides(rowElement, displayIndex) {
	const guides = guideLevels[displayIndex] || [];
	for (const segment of guides) {
		const guide = document.createElement('span');
		guide.className = 'guide';
		guide.dataset.level = String(segment.level);
		guide.dataset.containerId = segment.id;
		guide.setAttribute('aria-hidden', 'true');
		rowElement.appendChild(guide);
	}
}

function buildBraceRow(flat, displayIndex) {
	const node = document.createElement('div');
	node.className = 'brace';
	node.setAttribute('aria-hidden', 'true');
	if (subtreeIds.has(rows[flat.rowIndex].id)) {
		node.dataset.subtree = 'true';
	}
	node.dataset.rowId = rows[flat.rowIndex].id;
	const rowElement = document.createElement('span');
	rowElement.className = 'row brace-row';
	rowElement.dataset.level = String(flat.level);
	const mark = document.createElement('span');
	mark.className = 'punct brace-mark';
	mark.textContent = flat.type === 'brace-open' ? '{' : '}';
	rowElement.appendChild(mark);
	appendGuides(rowElement, displayIndex);
	node.appendChild(rowElement);
	return node;
}

function buildDisplayRow(flat, displayIndex) {
	return flat.type === 'node'
		? buildNodeRow(rows[flat.rowIndex], displayIndex)
		: buildBraceRow(flat, displayIndex);
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

function applyGuideHover() {
	for (const guide of treeWindow.querySelectorAll('.guide')) {
		guide.classList.toggle(
			'guide-active',
			hoveredGuideId !== undefined && guide.dataset.containerId === hoveredGuideId
		);
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
	applyGuideHover();
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

function setSelection(id) {
	selectedId = id;
	subtreeIds = new Set(subtreeRowIds(id, rows));
	for (const [renderedId, element] of renderedById) {
		const on = renderedId === id;
		element.setAttribute('aria-selected', on ? 'true' : 'false');
		if (on) {
			element.dataset.selected = 'true';
		} else {
			delete element.dataset.selected;
		}
		if (subtreeIds.has(renderedId) && !on) {
			element.dataset.subtree = 'true';
		} else {
			delete element.dataset.subtree;
		}
	}
	for (const brace of treeWindow.querySelectorAll('.brace')) {
		if (brace.dataset.rowId !== undefined && subtreeIds.has(brace.dataset.rowId)) {
			brace.dataset.subtree = 'true';
		} else {
			delete brace.dataset.subtree;
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
	// everything else selects.
	if (event.target.closest('.twisty')) {
		flipCollapsed(item.dataset.nodeId);
		return;
	}
	selectItem(item);
	if (event.target.closest('.value-text') && item.dataset.kind === 'parameter') {
		beginDetailsEdit(item.dataset.nodeId);
	}
}

function onRowDoubleClick(event) {
	if (!(event.target instanceof Element)) {
		return;
	}
	const item = event.target.closest('#tree [role="treeitem"]');
	if (!item || event.target.closest('.twisty')) {
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
	} else if (event.key === 'F2') {
		event.preventDefault();
		if (row.kind === 'parameter') {
			beginDetailsEdit(id);
		}
	} else if (event.key === 'Enter') {
		event.preventDefault();
		// Ctrl/Alt+Enter always reveals; a parameter opens its details editor,
		// a container toggles, and a leaf/reference reveals.
		if (event.ctrlKey || event.altKey) {
			revealItem(id);
		} else if (row.kind === 'parameter') {
			beginDetailsEdit(id);
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
		detailsSelectionChanged(undefined);
		const emptyPanel = inspectorElement('div', 'inspector-empty');
		emptyPanel.appendChild(inspectorElement('p', '', 'Select a line to see its details.'));
		emptyPanel.appendChild(inspectorElement('p', 'inspector-hint', 'Click a line or press Space.'));
		inspector.appendChild(emptyPanel);
		return;
	}
	detailsSelectionChanged(row.id);
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
	if (data.type) {
		inspector.appendChild(inspectorRow('Type', data.type));
	}
	if (data.kind === 'parameter') {
		inspector.appendChild(detailsValueInput(row, data));
	}
	for (const format of data.formats) {
		inspector.appendChild(inspectorRow(format.label, format.value));
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

	const actions = inspectorElement('div', 'inspector-actions');
	if (row.kind === 'reference' && row.followable === true) {
		const jump = inspectorElement('button', 'tool', 'Jump to target');
		jump.type = 'button';
		jump.addEventListener('click', function () { followItem(row.id); });
		actions.appendChild(jump);
	}
	const reveal = inspectorElement('button', 'tool', 'Reveal in source');
	reveal.type = 'button';
	reveal.addEventListener('click', function () { revealItem(row.id); });
	actions.appendChild(reveal);
	inspector.appendChild(actions);
}

function applyInspectorVisibility() {
	if (!inspector || !detailsToggle) {
		return;
	}
	inspector.hidden = uiState.inspectorHidden === true;
	detailsToggle.setAttribute('aria-pressed', inspector.hidden ? 'false' : 'true');
	detailsToggle.title = inspector.hidden ? 'Show node details' : 'Hide node details';
	detailsToggle.setAttribute('aria-label', inspector.hidden ? 'Show node details' : 'Hide node details');
}

function onTreeHover(event) {
	if (!(event.target instanceof Element)) {
		return;
	}
	const item = event.target.closest('#tree [role="treeitem"]');
	const brace = item ? null : event.target.closest('#tree .brace[data-row-id]');
	if (!item && !brace) {
		if (hoveredGuideId !== undefined) {
			hoveredGuideId = undefined;
			applyGuideHover();
		}
		return;
	}
	let row = item ? rowById.get(item.dataset.nodeId) : rowById.get(brace.dataset.rowId);
	while (row && !row.hasChildren) {
		row = row.parentId === null ? undefined : rowById.get(row.parentId);
	}
	const id = row ? row.id : undefined;
	if (id !== hoveredGuideId) {
		hoveredGuideId = id;
		applyGuideHover();
	}
}

document.addEventListener('click', onRowClick);
document.addEventListener('dblclick', onRowDoubleClick);
document.addEventListener('keydown', onTreeKeydown);
tree.addEventListener('mouseover', onTreeHover);
tree.addEventListener('mouseleave', function () {
	if (hoveredGuideId !== undefined) {
		hoveredGuideId = undefined;
		applyGuideHover();
	}
});
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

if (detailsToggle && inspector) {
	detailsToggle.addEventListener('click', function () {
		uiState.inspectorHidden = !uiState.inspectorHidden;
		applyInspectorVisibility();
		vscode.setState(uiState);
		if (!uiState.inspectorHidden) {
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
		setRows(message.rows, message.selectedId);
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

// The details preference survives a re-scan (the shell is not swapped) and a
// full webview reload (the host state); the harness persists the same state in
// localStorage so the browser loop can exercise it.
applyInspectorVisibility();
const initial = readInitialRows();
setRows(initial.rows, initial.selectedId);
renderWindow(true);
prepareFocus();
updateFilterUi();
updateInspector();
`;
