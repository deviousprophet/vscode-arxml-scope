/**
 * Webview HTML for the virtualised ECUC views (task design §3, §5, §6).
 *
 * The host no longer builds one DOM node per entity. `renderHtml` embeds a
 * compact row document (`buildRows`) as escaped JSON, plus a static shell: the
 * toolbar, the schema/package header, the `role="tree"` container with its
 * virtual spacers and the details inspector. The inlined page script flattens the
 * rows (collapse/braces), asks the pure virtual-scroll math for a viewport window
 * and builds only those rows with DOM APIs. The same script survives a re-scan:
 * the host sends a new row array and the page keeps its selection, collapsed set,
 * search, sidebar layout and scroll where it can.
 *
 * Everything is inlined — no asset files, no remote loads — because the CSP
 * forbids them and `esbuild.js` has no asset-copy step. Every colour is a
 * `--vscode-*` custom property (or a fallback inside one). The page never writes
 * a model-derived style attribute: row depth is `data-level` CSS and the virtual
 * spacer heights come from a nonce-carrying stylesheet whose text is updated.
 * The sidebar writes only its own two geometry custom properties
 * (`--sidebar-w`, `--sb-pane-h`) through CSSOM, which the nonce CSP allows.
 *
 * The pure helpers that decide re-scan state, the inspector and focus are
 * defined here as real functions and serialized into the page with
 * `toString()`, so the page and the tests share one definition.
 */
import { randomBytes } from 'crypto';
import { EcucDocumentModel, SortMode } from '../core/ecuc/model';
import type { ConditionValue } from '../core/ecuc/syscond';
import type { ConditionEntry } from './conditionValues';
import { FlatRow, ancestorIds, carriesGroupGap, flattenRows, matchRangesScript, stepMatch } from './treeQuery';
import { buildDocumentBraceRow, buildDocumentCommentRow, buildDocumentNodeRow, documentRowsScript } from './documentRows';
import { DocumentTreeHeader, documentTreeStyles, documentTreeViewScript } from './documentTreeView';
import { encodeJsonForScript } from './jsonScript';
import { consoleErrorScript } from './pageError';
import { EcucRow, MetaPart, ParameterFormat, RowCondition, buildRows } from './renderRows';
import { rowSearchScript } from './rowSearch';
import { rowViewScript } from './rowView';
import { sidebarShellScript } from './sidebarShell';
import { virtualScrollScript } from './virtualScroll';

export { encodeJsonForScript };

import { detailsEditorScript } from './ecucDetailsEditor';

export interface RenderOptions {
	/** Inline-script nonce; generated when absent. */
	nonce?: string;
	sort?: SortMode;
	sortExcept?: readonly string[];
	/** Node to select on load (child design §2.4, source → editor). */
	selectedId?: string;
	/** SW system-constant values, evaluated once per row build. */
	conditions?: ReadonlyMap<string, ConditionValue>;
	/** The host's normalized entries, embedded for the Conditions panel. */
	conditionEntries?: readonly ConditionEntry[];
}

/** The initial row payload the page parses before its first render. */
export interface RowPayload {
	rows: EcucRow[];
	selectedId?: string;
	/** Schema/packages shown by the component header. */
	header?: DocumentTreeHeader;
}

/**
 * The schema/packages the component header shows. One owner, so the initial page
 * and a later `{ type: 'model' }` push cannot disagree.
 */
export function documentHeader(model: EcucDocumentModel): DocumentTreeHeader {
	return {
		...(model.schema ? { schema: model.schema.release } : {}),
		packages: model.packages.map((pkg) => pkg.path.join('.')),
	};
}

/**
 * Serialises the row document for a `<script type="application/json">` block.
 * The shared encoder escapes the characters that could close the element; the
 * page calls `JSON.parse` and never evaluates it.
 */
export function encodeRowDocument(payload: RowPayload): string {
	return encodeJsonForScript(payload);
}

/** The state a re-scan keeps, pruned to the rows that still exist. */
export interface RowState {
	selectedId?: string;
	collapsed: string[];
}

/**
 * Keeps the selection when its row survived and prunes collapse ids that are gone.
 * This is the whole re-scan policy, in one place the page serialises and the
 * tests drive.
 */
export function reconcileRowState(state: RowState, rows: readonly { id: string }[]): RowState {
	const present = new Set(rows.map((row) => row.id));
	const selectedId =
		state.selectedId !== undefined && present.has(state.selectedId) ? state.selectedId : undefined;
	return {
		selectedId,
		collapsed: pruneCollapsed(state.collapsed, rows.map((row) => row.id)),
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
			const at = open.map((segment) => segment.level).lastIndexOf(flat.level);
			if (at >= 0) {
				open.splice(at, 1);
			}
			guides.push(open.slice());
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
	condition?: RowCondition;
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
	const ownCondition = row.condition === undefined ? undefined : `[${row.condition.text}]`;
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
		// The own syscond has its own Condition rows; this one keeps the post-build
		// conditions so the same text is never shown twice.
		conditions: parts('condition')
			.filter((text) => text !== ownCondition)
			.join('\n'),
		annotations: parts('annotation').join('\n'),
		...(row.condition === undefined ? {} : { condition: row.condition }),
	};
}

/** Builds the whole page. */
export function renderHtml(model: EcucDocumentModel, options: RenderOptions = {}): string {
	const nonce = options.nonce ?? randomBytes(16).toString('base64');
	const document = buildRows(model, {
		sort: options.sort,
		sortExcept: options.sortExcept,
		conditions: options.conditions,
	});
	const payload = encodeRowDocument({
		rows: document.rows,
		selectedId: options.selectedId,
		header: documentHeader(model),
	});
	const conditionPayload = encodeJsonForScript(options.conditionEntries ?? []);
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">${STYLE}${documentTreeStyles()}</style>
<style id="row-menu-style" nonce="${nonce}">#row-menu{left:0;top:0}</style>
</head>
<body data-view="document">
<div class="toolbar">
<span class="grow"></span>
<button id="collapse-all" class="sb-btn sb-btn-secondary icon-tool" type="button" title="Collapse every container" aria-label="Collapse every container"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2.25l4 4 4-4M4 13.75l4-4 4 4"/></svg><span class="lbl">Collapse</span></button>
<button id="expand-all" class="sb-btn sb-btn-secondary icon-tool" type="button" title="Expand every container" aria-label="Expand every container"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.25 8 2.25l4 4M4 9.75l4 4 4-4"/></svg><span class="lbl">Expand</span></button>
<div class="search-box">
<div class="search-field">
<span class="search-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4"/><path d="M9.5 9.5l3.5 3.5"/></svg></span>
<input id="search-input" class="search-input" type="search" placeholder="Search" aria-label="Search the ECUC tree" autocomplete="off" spellcheck="false">
<button id="search-clear" class="nav-btn search-clear" type="button" title="Clear search" aria-label="Clear search" hidden><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
</div>
<button id="search-prev" class="nav-btn search-nav" type="button" title="Previous match (Shift+F3)" aria-label="Previous match" disabled><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.75l4-4 4 4"/></svg></button>
<button id="search-next" class="nav-btn search-nav" type="button" title="Next match (F3)" aria-label="Next match" disabled><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.25l4 4 4-4"/></svg></button>
<span id="search-count" class="search-count" role="status" aria-live="polite"></span>
<span id="search-busy" class="search-progress" role="status" aria-label="Searching" data-busy="false"></span>
</div>
</div>
<div id="content">
<div id="main">
<div id="tree-measure" aria-hidden="true"><div class="probe-doc"><span class="row k-parameter has-value"><span class="label">x</span><span class="value"><span class="punct">=</span> <span class="value-text">0</span></span></span></div></div>
<div id="tree" class="document-tree" role="tree" aria-label="ECUC values"></div>
</div>
<div id="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" title="Drag to resize sidebar" tabindex="0"></div>
<aside id="sidebar" aria-label="ECUC sidebar">
<div id="sbp-details" class="sb-tab-panel active" role="tabpanel" aria-labelledby="stab-details">
<div id="inspector" class="inspector sb-pane-view" role="region" aria-label="Node details">
<section class="sb-section sb-pane" id="sb-details" data-pane-id="sb-details">
<div class="sb-section-head" role="button" tabindex="0" aria-expanded="true" aria-controls="sb-details-body" aria-label="Details">
<span class="sb-section-chevron" aria-hidden="true"></span>
<h3 class="sb-section-title" id="sb-details-title"><span class="sb-section-label">Details</span></h3>
</div>
<div class="sb-body" id="sb-details-body" role="region" aria-labelledby="sb-details-title">
<div class="inspector-empty"><p>Select a line to see its details.</p><p class="inspector-hint">Click a line or press Space.</p></div>
</div>
</section>
</div>
<div id="details-status" class="details-status" role="status" aria-live="polite"></div>
</div>
<div id="sbp-conditions" class="sb-tab-panel" role="tabpanel" aria-labelledby="stab-conditions" hidden>
<div class="sb-pane-view">
<section class="sb-section sb-pane" id="sb-conditions-values" data-pane-id="sb-conditions-values">
<div class="sb-section-head" role="button" tabindex="0" aria-expanded="true" aria-controls="sb-conditions-values-body" aria-label="Condition values">
<span class="sb-section-chevron" aria-hidden="true"></span>
<h3 class="sb-section-title" id="sb-conditions-values-title"><span class="sb-section-label">Condition values</span><span id="sb-conditions-values-badge" class="sb-section-badge" hidden></span></h3>
</div>
<div class="sb-body" id="sb-conditions-values-body" role="region" aria-labelledby="sb-conditions-values-title">
<div id="conditions-panel" class="conditions-panel">
<div class="conditions-head">
<span id="conditions-count" class="conditions-count" hidden></span>
<span class="grow"></span>
</div>
<div id="conditions-empty" class="conditions-empty" hidden>
<p>No condition values yet.</p>
<p class="conditions-hint">Add a constant used by <code>SW-SYSCOND</code>, for example <code>CANIPCORETYPE_SC = 1</code>.</p>
</div>
<div id="conditions-list" class="conditions-list"></div>
<div class="conditions-actions">
<button id="conditions-add" class="sb-btn sb-btn-add" type="button" title="Add a condition value" aria-label="Add condition value"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg><span>Add value</span></button>
<span class="grow"></span>
<button id="conditions-clear" class="sb-btn sb-btn-secondary sb-btn-danger" type="button" title="Remove every entered condition value" aria-label="Clear all condition values" disabled><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8M7 7v3.5M9 7v3.5"/></svg><span>Clear values</span></button>
</div>
<div id="conditions-status" class="conditions-status" role="status" aria-live="polite"></div>
</div>
</div>
</section>
</div>
</div>
</aside>
<div id="side-tabs" role="tablist" aria-label="Editor sidebar" aria-orientation="vertical">
<button id="stab-details" class="stab active" type="button" role="tab" aria-selected="true" aria-controls="sbp-details">Details</button>
<button id="stab-conditions" class="stab" type="button" role="tab" aria-selected="false" aria-controls="sbp-conditions" tabindex="-1">Conditions</button>
</div>
</div>
<div id="row-menu" class="row-menu" role="menu" aria-label="Row actions" hidden>
<button class="row-menu-item" type="button" role="menuitem" data-action="duplicate">Duplicate</button>
<button class="row-menu-item" type="button" role="menuitem" data-action="delete">Delete</button>
</div>
<script type="application/json" id="ecuc-rows" nonce="${nonce}">${payload}</script>
<script type="application/json" id="ecuc-conditions" nonce="${nonce}">${conditionPayload}</script>
<script nonce="${nonce}">
${CONSOLE_ERROR_SCRIPT}
const vscode = acquireVsCodeApi();
${detailsEditorScript()}
${rowViewScript()}
${sidebarShellScript()}
${TREE_SCRIPT}
</script>
</body>
</html>`;
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

/**
 * Whether a field refusal is already shown beside the field in the details panel.
 *
 * Field edits are answered inline by `ecucDetailsEditor`; the page must not also
 * write a second, stale copy elsewhere. A refusal for another tab or a reference
 * that cannot be followed goes to the Details status line.
 */
export function refusalShownInDetails(message: { inline?: boolean }, detailsHidden: boolean): boolean {
	return message.inline === true && detailsHidden === false;
}

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
/* Shared button/field primitives. The editor, the details panel and the later
 * Conditions/Search children all use these classes; every colour is a theme
 * token. A control that is missing its semantic token falls back to the panel
 * border rather than a literal colour. */
.sb-btn {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	border-radius: 3px;
	font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif);
	font-size: 10px;
	font-weight: 600;
	padding: 2px 8px;
	cursor: pointer;
	white-space: nowrap;
	user-select: none;
}
.sb-btn-primary {
	background: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
	border: 1px solid transparent;
}
.sb-btn-primary:hover {
	background: var(--vscode-button-hoverBackground);
}
.sb-btn-secondary {
	background: transparent;
	color: var(--vscode-descriptionForeground);
	border: 1px solid var(--vscode-panel-border, var(--vscode-editorGroup-border));
}
.sb-btn-secondary:hover {
	color: var(--vscode-foreground);
	border-color: currentColor;
}
.sb-btn-add {
	background: transparent;
	color: var(--vscode-textLink-foreground);
	border: 1px dashed var(--vscode-panel-border, var(--vscode-editorGroup-border));
}
.sb-btn-add:hover {
	background: var(--vscode-list-hoverBackground);
	border-style: solid;
}
.sb-btn-danger {
	background: transparent;
	color: var(--vscode-errorForeground);
	border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
}
.sb-btn-danger:hover {
	background: var(--vscode-inputValidation-errorBackground, var(--vscode-list-hoverBackground));
	border-color: var(--vscode-errorForeground);
}
.sb-btn:disabled {
	opacity: 0.35;
	cursor: not-allowed;
}
.sb-btn:focus-visible,
.nav-btn:focus-visible,
.act-btn:focus-visible {
	outline: 1px solid var(--vscode-focusBorder);
	outline-offset: 1px;
}
.nav-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	padding: 0;
	background: transparent;
	color: var(--vscode-foreground);
	border: 1px solid transparent;
	border-radius: 4px;
	cursor: pointer;
}
.nav-btn:hover {
	background: var(--vscode-list-hoverBackground);
	border-color: var(--vscode-panel-border, transparent);
}
.act-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 18px;
	height: 18px;
	padding: 0;
	opacity: 0;
	background: transparent;
	color: var(--vscode-descriptionForeground);
	border: 0;
	border-radius: 2px;
	cursor: pointer;
}
.parent:hover .act-btn,
.parent:focus-within .act-btn,
.act-btn:focus-visible {
	opacity: 1;
}
.act-btn:hover {
	color: var(--vscode-foreground);
	background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
}
.search-input {
	box-sizing: border-box;
	height: 26px;
	min-width: 70px;
	width: 180px;
	padding: 0 7px;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: 12px;
	color: var(--vscode-input-foreground);
	background: var(--vscode-input-background);
	border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
	border-radius: 3px;
}
.search-input:focus {
	border-color: var(--vscode-focusBorder);
	outline: 1px solid var(--vscode-focusBorder);
	outline-offset: -1px;
}
/* The Search field keeps one custom clear X; Chromium's native cancel button
 * would paint a second one, so it is suppressed. */
input[type="search"]::-webkit-search-cancel-button,
input[type="search"]::-webkit-search-decoration {
	-webkit-appearance: none;
	appearance: none;
	display: none;
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
.search-clear {
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
.search-clear[hidden] {
	display: none;
}
.search-clear:hover {
	color: var(--vscode-foreground);
	background: var(--vscode-toolbar-hoverBackground, transparent);
}
.search-box {
	display: flex;
	align-items: center;
	gap: 3px;
	flex: 0 1 auto;
	min-width: 0;
}
.search-field {
	position: relative;
	display: flex;
	align-items: center;
	flex: 0 1 180px;
	min-width: 0;
}
.search-field .search-input {
	width: 100%;
	min-width: 0;
	padding: 0 22px 0 25px;
}
.search-icon {
	position: absolute;
	left: 7px;
	top: 50%;
	transform: translateY(-50%);
	display: inline-flex;
	color: var(--vscode-descriptionForeground, var(--tok-dim));
	pointer-events: none;
}
.search-box .search-nav {
	width: 28px;
	height: 26px;
	flex: none;
}
.search-count {
	width: 14ch;
	flex: none;
	overflow: hidden;
	text-align: right;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 11px;
	font-variant-numeric: tabular-nums;
	color: var(--vscode-descriptionForeground, var(--tok-dim));
}
/* The count and the busy spinner keep their boxes at all times: reserving the
 * space is what stops the Search field from moving when a run starts or ends. */
.search-progress {
	width: 16px;
	height: 16px;
	flex: none;
	display: inline-flex;
	align-items: center;
	justify-content: center;
}
.search-progress[data-busy="false"] {
	visibility: hidden;
}
.search-progress::before {
	content: '';
	width: 11px;
	height: 11px;
	border: 2px solid var(--vscode-input-border, var(--vscode-panel-border));
	border-top-color: var(--vscode-progressBar-background, var(--vscode-focusBorder));
	border-radius: 50%;
	animation: ecuc-search-spin 0.8s linear infinite;
}
@keyframes ecuc-search-spin {
	from { transform: rotate(0deg); }
	to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
	.search-progress::before {
		animation: none;
	}
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
	min-width: 28px;
	gap: 4px;
}
.icon-tool .lbl {
	white-space: nowrap;
}

.conditions-panel {
	flex: none;
	padding: 0;
	font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif);
	font-size: 12px;
	color: var(--vscode-editor-foreground);
	background: transparent;
}
.conditions-panel[hidden] {
	display: none;
}
.conditions-head {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	align-items: center;
	margin-bottom: 6px;
}
.conditions-count {
	white-space: nowrap;
	color: var(--vscode-descriptionForeground);
}
.conditions-count[hidden] {
	display: none;
}
.conditions-empty {
	padding: 4px 0 10px;
	color: var(--vscode-descriptionForeground);
}
.conditions-empty p {
	margin: 0 0 4px;
}
.conditions-empty p:last-child {
	margin-bottom: 0;
}
.conditions-empty .conditions-hint {
	margin: 0;
}
.conditions-actions {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-top: 8px;
	padding-top: 8px;
	border-top: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
}
.sb-section-badge {
	flex: 0 0 auto;
	padding: 0 6px;
	border: 1px solid var(--vscode-panel-border, var(--vscode-editorGroup-border));
	border-radius: 8px;
	font-size: 10px;
	font-weight: 600;
	line-height: 16px;
	letter-spacing: 0;
	text-transform: none;
	white-space: nowrap;
	color: var(--vscode-descriptionForeground);
}
.sb-section-badge[hidden] {
	display: none;
}
.conditions-list {
	display: flex;
	flex-direction: column;
	gap: 4px;
}
.condition-row {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
}
/* Reserve one stable action column so the name, equals and value columns do not
 * move when a row enters edit mode and swaps the state/Edit/Remove group for
 * Save/Cancel. */
.condition-actions {
	display: flex;
	align-items: center;
	gap: 4px;
	flex: 0 0 100px;
	min-width: 0;
}
.condition-name,
.condition-value {
	box-sizing: border-box;
	min-width: 0;
	height: 20px;
	padding: 0 4px;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: 12px;
	color: var(--vscode-input-foreground);
	background: var(--vscode-input-background);
	border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
	border-radius: 2px;
}
.condition-name {
	flex: 0 1 26ch;
}
.condition-value {
	flex: 0 1 18ch;
}
.condition-name-text,
.condition-value-text {
	flex: 0 1 auto;
	min-width: 0;
	box-sizing: border-box;
	height: 20px;
	padding: 0 4px;
	border: 1px solid transparent;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: 12px;
	color: var(--vscode-editor-foreground);
}
.condition-name-text {
	flex-basis: 26ch;
}
.condition-value-text {
	flex-basis: 18ch;
}
.condition-state {
	flex: none;
	padding: 0 5px;
	border: 1px dashed var(--vscode-descriptionForeground);
	border-radius: 3px;
	color: var(--vscode-descriptionForeground);
	font-size: 11px;
	line-height: 18px;
}
.condition-state[hidden] {
	display: none;
}
.condition-name:focus,
.condition-value:focus {
	outline: 1px solid var(--vscode-focusBorder);
	outline-offset: -1px;
}
.condition-name[aria-invalid="true"] {
	border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
}
.condition-edit,
.condition-remove,
.condition-save,
.condition-cancel {
	flex: none;
}
.condition-save,
.condition-cancel {
	opacity: 1;
}
.conditions-hint {
	margin: 6px 0 0;
	color: var(--vscode-descriptionForeground);
}
.conditions-hint code {
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
}
.conditions-status {
	min-height: 0;
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
}
.conditions-status:empty {
	display: none;
}
.details-status {
	flex: none;
	padding: 4px 8px;
	border-top: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
	font-size: 11px;
	color: var(--vscode-editorWarning-foreground, var(--vscode-descriptionForeground));
}
.details-status:empty {
	display: none;
}
.sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
}
.row-menu {
	position: fixed;
	z-index: 40;
	min-width: 150px;
	padding: 4px;
	border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border, transparent));
	border-radius: 5px;
	background: var(--vscode-menu-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
	box-shadow: 0 4px 14px var(--vscode-widget-shadow, transparent);
}
.row-menu[hidden] {
	display: none;
}
.row-menu-item {
	display: block;
	box-sizing: border-box;
	width: 100%;
	padding: 4px 10px;
	border: 0;
	border-radius: 3px;
	background: transparent;
	color: var(--vscode-menu-foreground, var(--vscode-foreground));
	font: inherit;
	text-align: left;
	cursor: pointer;
}
.row-menu-item:hover,
.row-menu-item:focus-visible {
	background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
	color: var(--vscode-menu-selectionForeground, var(--vscode-foreground));
	outline: none;
}
.row-menu-item[data-action="delete"] {
	color: var(--vscode-errorForeground, var(--vscode-menu-foreground, var(--vscode-foreground)));
}

#content {
	display: flex;
	flex: 1 1 auto;
	min-height: 0;
}
#main {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-width: 0;
	min-height: 0;
	overflow: hidden;
	position: relative;
}
#inspector {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-width: 0;
	min-height: 0;
	overflow: hidden;
	padding: 0;
	background: var(--vscode-sideBar-background, var(--vscode-editor-background));
}
/* ── Sidebar shell: resizer, tab strip, tab panels ─────────────────────── */
#sidebar {
	display: flex;
	flex-direction: column;
	flex: 0 0 auto;
	width: var(--sidebar-w, 360px);
	min-width: var(--sidebar-w, 360px);
	max-width: var(--sidebar-w, 360px);
	overflow: hidden;
	background: var(--vscode-sideBar-background, var(--vscode-editor-background));
	border-left: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
}
#sidebar-resizer {
	width: 6px;
	flex: 0 0 6px;
	box-sizing: border-box;
	cursor: col-resize;
	background: transparent;
	border-left: 1px solid transparent;
	border-right: 1px solid transparent;
	transition: background 0.12s ease, border-color 0.12s ease;
}
#sidebar-resizer:hover,
#sidebar-resizer.dragging {
	background: var(--vscode-list-hoverBackground);
	border-left-color: var(--vscode-focusBorder);
	border-right-color: var(--vscode-focusBorder);
}
#sidebar-resizer:focus-visible {
	outline: 1px solid var(--vscode-focusBorder);
	outline-offset: -1px;
}
body.sb-col-resizing {
	cursor: col-resize;
	user-select: none;
}
body.sb-row-resizing {
	cursor: row-resize;
	user-select: none;
}
#side-tabs {
	display: flex;
	flex-direction: column;
	align-items: center;
	width: 28px;
	flex: 0 0 28px;
	gap: 2px;
	padding: 6px 0;
	overflow: hidden;
	background: var(--vscode-sideBar-background, var(--vscode-editor-background));
	border-left: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
}
.stab {
	writing-mode: vertical-rl;
	transform: none;
	padding: 10px 5px;
	font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif);
	font-size: 10px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.12em;
	white-space: nowrap;
	color: var(--vscode-descriptionForeground);
	background: transparent;
	border: 0;
	border-right: 3px solid transparent;
	cursor: pointer;
	transition: color 0.12s, background-color 0.12s, border-color 0.12s;
}
.stab:hover {
	color: var(--vscode-foreground);
	background: var(--vscode-list-hoverBackground);
}
.stab.active {
	color: var(--vscode-textLink-foreground);
	border-right-color: var(--vscode-textLink-foreground);
	background: var(--vscode-list-inactiveSelectionBackground, transparent);
}
.stab:focus-visible {
	outline: 1px solid var(--vscode-focusBorder);
	outline-offset: -1px;
}
.sb-tab-panel {
	display: none;
	flex: 1 1 auto;
	flex-direction: column;
	min-height: 0;
}
.sb-tab-panel.active {
	display: flex;
}
.sb-tab-panel > div {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	box-sizing: border-box;
}
/* ── Section panes: 22px header, independently scrolling body, drag sash ── */
.sb-pane-view {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
}
.sb-pane {
	display: flex;
	flex-direction: column;
	flex: 0 0 auto;
	flex-basis: var(--sb-pane-h, auto);
	min-height: 0;
	overflow: hidden;
	box-sizing: border-box;
	transition: flex-basis 0.15s ease-out;
}
/* A sash drag must track the pointer exactly; collapse/expand is the only
 * layout change that animates (150ms). */
.sb-pane-view.dragging .sb-pane,
.sb-pane-view.no-transition .sb-pane {
	transition: none;
}
.sb-section-head {
	display: flex;
	align-items: center;
	gap: 6px;
	height: 22px;
	line-height: 22px;
	overflow: hidden;
	flex: 0 0 22px;
	box-sizing: border-box;
	padding-left: 8px;
}
.sb-section-head[role="button"] {
	cursor: pointer;
	user-select: none;
}
.sb-section-head[role="button"]:hover {
	background: var(--vscode-list-hoverBackground, transparent);
}
.sb-section-head:focus-visible {
	outline: 1px solid var(--vscode-focusBorder);
	outline-offset: -1px;
}
.sb-section-title {
	display: flex;
	align-items: center;
	gap: 6px;
	flex: 1 1 auto;
	min-width: 0;
	margin: 0;
	font: inherit;
	color: inherit;
}
.sb-section-label {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	min-width: 3ch;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 11px;
	font-weight: 700;
	text-transform: uppercase;
	color: var(--vscode-descriptionForeground);
}
/* Decorative chevron: points right at rest, rotates down when expanded. */
.sb-section-chevron {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 14px;
	height: 14px;
	flex: 0 0 14px;
	font-size: 14px;
	line-height: 1;
	color: var(--vscode-descriptionForeground);
	transition: transform 0.15s ease-out;
}
.sb-section-chevron::before {
	content: '\\203A';
}
.sb-section-head[aria-expanded="true"] .sb-section-chevron {
	transform: rotate(90deg);
}
.sb-section-actions {
	display: flex;
	align-items: center;
	gap: 4px;
	flex: 0 0 auto;
	margin-left: auto;
	margin-right: 8px;
}
.sb-section-actions .sb-section-action {
	max-height: 22px;
	padding: 2px 8px;
	font-size: 10px;
	line-height: 1.2;
	white-space: nowrap;
}
.sb-pane .sb-body {
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
	overflow-x: hidden;
	padding: 8px 10px 12px;
	box-sizing: border-box;
}
.sb-pane-sash {
	height: 6px;
	flex: 0 0 6px;
	box-sizing: border-box;
	cursor: row-resize;
	user-select: none;
	border-top: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
	transition: background 0.12s ease, border-color 0.12s ease;
}
.sb-pane-sash:hover,
.sb-pane-sash.dragging {
	background: var(--vscode-list-hoverBackground);
	border-top-color: var(--vscode-focusBorder);
}
.sb-pane-sash.disabled {
	cursor: default;
	opacity: 0.4;
}
.sb-pane-sash:focus-visible {
	outline: 1px solid var(--vscode-focusBorder);
	outline-offset: -1px;
}
@media (prefers-reduced-motion: reduce) {
	.sb-pane,
	.sb-section-chevron {
		transition-duration: 0s;
	}
}
#tree-measure {
	position: absolute;
	left: -10000px;
	top: 0;
	width: 240px;
	visibility: hidden;
	pointer-events: none;
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
.condition-code {
	white-space: pre-wrap;
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
@media (max-width: 720px) {
	.toolbar {
		padding: 0 4px;
		gap: 3px;
	}
	.search-box {
		flex: 1 1 0;
	}
	.grow,
	.icon-tool .lbl {
		display: none;
	}
	.tool {
		padding: 0 4px;
	}
	#content {
		flex-direction: column;
	}
	#sidebar {
		width: auto;
		min-width: 0;
		max-width: none;
		max-height: 45vh;
		flex: 0 0 auto;
		border-left: 0;
		border-top: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
	}
	#sidebar-resizer {
		display: none;
	}
	#side-tabs {
		flex-direction: row;
		width: auto;
		flex: 0 0 28px;
		height: 28px;
		padding: 0 6px;
		border-left: 0;
		border-top: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
	}
	.stab {
		writing-mode: horizontal-tb;
		height: 28px;
		padding: 0 8px;
		border-right: 0;
		border-bottom: 3px solid transparent;
	}
	.stab.active {
		border-right-color: transparent;
		border-bottom-color: var(--vscode-textLink-foreground);
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
 * Install the console-only reporter before anything that can throw. Errors are
 * visible in the webview devtools console; the page never paints a banner.
 */
const CONSOLE_ERROR_SCRIPT = consoleErrorScript({
	installerName: 'ecucInstallConsoleErrors',
	reporterName: 'ecucReportError',
	label: 'ECUC editor',
	install: true,
});

/**
 * The page: the row store, flatten/collapse, the virtual window, row
 * building, selection/focus, the inspector and the message bridge. The value
 * widget's script is emitted before this one and its document listeners claim
 * their events first; nothing here runs for an interaction it owns.
 */
/**
 * The Document row stylesheet lives in `documentTreeView.ts` now; the editor and
 * every diff pane inject that one string.
 */
const TREE_SCRIPT = `
const tree = document.getElementById('tree');
const inspector = document.getElementById('inspector');
const detailsStatus = document.getElementById('details-status');
const detailsBody = document.getElementById('sb-details-body');
const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');
const searchPrev = document.getElementById('search-prev');
const searchNext = document.getElementById('search-next');
const searchCount = document.getElementById('search-count');
const searchBusy = document.getElementById('search-busy');
const rowMenu = document.getElementById('row-menu');
const rowMenuStyle = document.getElementById('row-menu-style');
const conditionsPanel = document.getElementById('conditions-panel');
const conditionsList = document.getElementById('conditions-list');
const conditionsAdd = document.getElementById('conditions-add');
const conditionsClear = document.getElementById('conditions-clear');
const conditionsEmpty = document.getElementById('conditions-empty');
const conditionsCount = document.getElementById('conditions-count');
const conditionsValuesBadge = document.getElementById('sb-conditions-values-badge');
const conditionsStatus = document.getElementById('conditions-status');
const conditionsScript = document.getElementById('ecuc-conditions');
const svgNamespace = 'http://www.w3.org/2000/svg';
const savedState = vscode.getState();
// Tab, sidebar width, pane heights and collapsed sections are the whole
// persisted layout. A legacy inspectorHidden flag is ignored (and not written back).
let uiState = loadUiState(savedState);

function persistUiState() {
	vscode.setState(uiState);
}

${pruneCollapsed.toString()}
${toggleCollapsed.toString()}
${collapsedIdsFor.toString()}
${moveTarget.toString()}
${virtualScrollScript()}
${documentTreeViewScript()}
${matchRangesScript()}
${rowSearchScript()}
${stepMatch.toString()}
${flattenRows.toString()}
${carriesGroupGap.toString()}
${documentRowsScript()}
${ancestorIds.toString()}
${inspectorFields.toString()}
${subtreeRowIds.toString()}
${guidesFor.toString()}
${resolveFocusId.toString()}
${reconcileRowState.toString()}
${refusalShownInDetails.toString()}

let rows = [];
let rowById = new Map();
let rowIndexById = new Map();
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
let menuNodeId;
// Search is a jump control, not a visibility control: the whole row store is the
// candidate set, and the collapsed set never removes a candidate. highlightQuery
// carries the current query into the row primitives as the page's mark text.
let searchQuery = '';
let searchMatches = [];
let searchIndex = -1;
let highlightQuery = '';
const searchEngine = new RowSearchEngine();
let searchRunning = false;
let searchFirstJumpDone = false;
// Discovery derives row names from the current document; manual rows are the
// only removable ones, so there is no dismissal set any more.
let editingRow = null;
let windowRange = [0, 0];
let renderedById = new Map();
let heights = { document: 20 };
let heightFn = function () { return heights.document; };
let typeAhead = { text: '', at: 0 };
// The one Document surface. It owns the header, the native scroller, the
// spacers and the rendered window; this page owns the row model and state.
let treeView;

function readInitialRows() {
	const script = document.getElementById('ecuc-rows');
	if (!script) {
		window.ecucReportError('The row data is missing from this page.');
		return { rows: [] };
	}
	try {
		return JSON.parse(script.textContent || '{}');
	} catch (error) {
		window.ecucReportError('The row data could not be read: ' + error.message);
		return { rows: [] };
	}
}

function indexRows() {
	rowById = new Map();
	rowIndexById = new Map();
	for (let at = 0; at < rows.length; at++) {
		rowById.set(rows[at].id, rows[at]);
		rowIndexById.set(rows[at].id, at);
	}
}

function buildHeightFn() {
	const base = heights.document;
	heightFn = function (index) {
		return base + (carriesGroupGap(rows, displayRows, index) ? base : 0);
	};
	syncTreeModel();
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
	displayRows = flattenRows(rows, {
		collapsed: collapsed,
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
			// Expansion is the display list's decision, carried on the row; the page
			// must not re-derive it from neighbouring rows (see treeQuery.ts).
			if (flat.expanded) {
				expandedIds.add(row.id);
			}
		}
	}
	buildHeightFn();
}

function setRows(nextRows, nextSelectedId, nextHeader) {
	hideRowMenu(false);
	const incoming = Array.isArray(nextRows) ? nextRows : [];
	const previousMatchId = currentMatchId();
	const state = reconcileRowState(
		{
			selectedId: nextSelectedId !== undefined ? nextSelectedId : selectedId,
			collapsed: Array.from(collapsed)
		},
		incoming
	);
	rows = incoming;
	collapsed = new Set(state.collapsed);
	selectedId = state.selectedId;
	indexRows();
	ensureDiscoveredConditionRows();
	if (focusId !== undefined && !rowById.has(focusId)) {
		focusId = selectedId;
	}
	subtreeIds = new Set(subtreeRowIds(selectedId, rows));
	rebuildDisplay();
	measureHeights();
	if (nextHeader !== undefined) {
		applyHeader(nextHeader);
	}
	// A re-scan keeps the search and, when the row survived, the current match; the
	// matches themselves are recomputed against the new row indices.
	if (searchQuery.trim() !== '') {
		startSearch(searchQuery, previousMatchId, true);
	} else {
		searchMatches = [];
		searchIndex = -1;
		highlightQuery = '';
		setSearchBusy(false);
		renderSearchUi();
	}
}

function applyHeader(header) {
	if (!treeView) {
		return;
	}
	treeView.setHeader({
		schema: header && header.schema ? header.schema : undefined,
		packages: header && Array.isArray(header.packages) ? header.packages : []
	});
}

/** The host half of the component: the rows for one display index. */
function documentRowOptions(displayIndex) {
	const flat = displayRows[displayIndex];
	return {
		selectedId: selectedId,
		expandedIds: expandedIds,
		searchQuery: searchQuery,
		currentId: currentMatchId(),
		subtreeIds: subtreeIds,
		gap: flat ? carriesGroupGap(rows, displayRows, displayIndex) : false,
		guides: guideLevels[displayIndex] || []
	};
}

function treeModel() {
	return {
		rowCount: displayRows.length,
		heightFn: heightFn,
		renderRow: renderRow
	};
}

function syncTreeModel() {
	if (treeView) {
		treeView.setModel(treeModel());
	}
}

function buildNodeRow(row, displayIndex) {
	return buildDocumentNodeRow(row, documentRowOptions(displayIndex));
}

function buildBraceRow(flat, displayIndex) {
	return buildDocumentBraceRow(flat.type, flat.level, rows[flat.rowIndex].id, documentRowOptions(displayIndex));
}

function buildCommentRow(flat, displayIndex) {
	return buildDocumentCommentRow(flat.text, flat.level, rows[flat.rowIndex].id, documentRowOptions(displayIndex));
}

function buildDisplayRow(flat, displayIndex) {
	if (flat.type === 'comment') {
		return buildCommentRow(flat, displayIndex);
	}
	return flat.type === 'node'
		? buildNodeRow(rows[flat.rowIndex], displayIndex)
		: buildBraceRow(flat, displayIndex);
}

function renderRow(index) {
	const flat = displayRows[index];
	return flat ? buildDisplayRow(flat, index) : document.createElement('div');
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

function hideRowMenu(restoreFocus) {
	if (!rowMenu || rowMenu.hidden) {
		return;
	}
	rowMenu.hidden = true;
	const id = menuNodeId;
	menuNodeId = undefined;
	if (restoreFocus && id !== undefined) {
		const element = renderedById.get(id);
		if (element) {
			element.focus({ preventScroll: true });
		}
	}
}

function showRowMenu(item, left, top) {
	if (!rowMenu || !rowMenuStyle) {
		return;
	}
	const kind = item.dataset.kind;
	if (kind !== 'container' && kind !== 'parameter') {
		return;
	}
	selectItem(item);
	menuNodeId = item.dataset.nodeId;
	rowMenu.hidden = false;
	const bounds = rowMenu.getBoundingClientRect();
	const x = Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8));
	const y = Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8));
	rowMenuStyle.textContent = '#row-menu{left:' + x + 'px;top:' + y + 'px}';
	const first = rowMenu.querySelector('.row-menu-item');
	if (first) {
		first.focus({ preventScroll: true });
	}
}

function onTreeContextMenu(event) {
	if (!(event.target instanceof Element)) {
		return;
	}
	const item = event.target.closest('#tree [role="treeitem"]');
	if (!item) {
		return;
	}
	const kind = item.dataset.kind;
	if (kind !== 'container' && kind !== 'parameter') {
		return;
	}
	event.preventDefault();
	showRowMenu(item, event.clientX, event.clientY);
}

function onRowMenuKeydown(event) {
	if (!rowMenu || rowMenu.hidden) {
		return;
	}
	const items = Array.from(rowMenu.querySelectorAll('.row-menu-item'));
	if (event.key === 'Escape') {
		event.preventDefault();
		hideRowMenu(true);
		return;
	}
	if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
		return;
	}
	event.preventDefault();
	const at = items.indexOf(document.activeElement);
	const step = event.key === 'ArrowDown' ? 1 : -1;
	const next = items[(at + step + items.length) % items.length];
	if (next) {
		next.focus();
	}
}

function applyGuideHover() {
	const win = treeView ? treeView.getWindowElement() : undefined;
	if (!win) {
		return;
	}
	for (const guide of win.querySelectorAll('.guide')) {
		guide.classList.toggle(
			'guide-active',
			hoveredGuideId !== undefined && guide.dataset.containerId === hoveredGuideId
		);
	}
}

/** Rebuild the id -> rendered row map from the component's current window. */
function collectRendered() {
	renderedById = new Map();
	const win = treeView ? treeView.getWindowElement() : undefined;
	if (!win) {
		return;
	}
	const items = win.querySelectorAll('[role="treeitem"][data-node-id]');
	for (let at = 0; at < items.length; at++) {
		renderedById.set(items[at].dataset.nodeId, items[at]);
	}
}

function renderWindow(force) {
	hideRowMenu(false);
	if (!treeView) {
		return;
	}
	const previousFocus = focusedNodeId();
	treeView.render(force === true);
	windowRange = treeView.getVisibleRange();
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
	for (const ancestorId of ancestorIds(rows, id)) {
		if (collapsed.delete(ancestorId)) {
			changed = true;
		}
	}
	return changed;
}

function ensureVisible(displayIndex) {
	if (treeView) {
		treeView.scrollToIndex(displayIndex);
	}
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
	for (const brace of (treeView ? treeView.getWindowElement() : tree).querySelectorAll('.brace')) {
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
	const item = event.target.closest('#tree [role="treeitem"]');
	if (!item) {
		const comment = event.target.closest('#tree .comment[data-row-id]');
		if (comment) {
			const id = comment.dataset.rowId;
			const node = id === undefined ? undefined : renderedById.get(id);
			if (id && node) {
				selectItem(node);
				syncSearchToSelection(id);
			}
		}
		return;
	}
	// One interaction, one effect: the twisty toggles without moving the selection,
	// everything else selects.
	if (event.target.closest('.twisty')) {
		flipCollapsed(item.dataset.nodeId);
		return;
	}
	selectItem(item);
	syncSearchToSelection(item.dataset.nodeId);
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
	const page = Math.max(1, Math.floor(treeView.clientHeight() / Math.max(1, heightFn(displayIndex === undefined ? 0 : displayIndex))));
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

/** The row id at the current search position, or undefined when nothing is current. */
function currentMatchId() {
	const rowIndex = searchMatches[searchIndex];
	const row = rowIndex === undefined ? undefined : rows[rowIndex];
	return row ? row.id : undefined;
}

/** The index of a row id in the current match list, or -1. */
function searchIndexOfId(id) {
	if (id === undefined) {
		return -1;
	}
	const rowIndex = rowIndexById.get(id);
	return rowIndex === undefined ? -1 : searchMatches.indexOf(rowIndex);
}

function setSearchBusy(busy) {
	searchRunning = busy === true;
	renderSearchUi();
}

/**
 * Start a chunked search. previousId is preserved across progress/completion
 * and a re-scan; immediate skips the 120 ms debounce for a re-scan.
 */
function startSearch(query, previousId, immediate) {
	const text = query || '';
	if (text.trim() === '') {
		resetSearchResults();
		return;
	}
	searchEngine.clear();
	searchQuery = text;
	highlightQuery = text;
	searchMatches = [];
	searchIndex = -1;
	searchFirstJumpDone = previousId !== undefined;
	setSearchBusy(true);
	renderSearchUi();
	renderWindow(true);
	searchEngine.search(
		rows,
		text,
		{
			onProgressUpdate: function (matches) {
				const currentId = currentMatchId();
				searchMatches = matches;
				if (!searchFirstJumpDone && searchMatches.length > 0) {
					searchIndex = 0;
					searchFirstJumpDone = true;
					renderSearchUi();
					jumpToSearchMatch(0);
					return;
				}
				const wanted = currentId !== undefined ? currentId : previousId;
				const kept = searchIndexOfId(wanted);
				if (searchMatches.length === 0) {
					searchIndex = -1;
				} else if (kept >= 0) {
					searchIndex = kept;
				} else {
					searchIndex = Math.min(Math.max(searchIndex, 0), searchMatches.length - 1);
				}
				renderSearchUi();
				renderWindow(true);
			},
			onComplete: function (matches) {
				const currentId = currentMatchId();
				searchMatches = matches;
				const wanted = currentId !== undefined ? currentId : previousId;
				const kept = searchIndexOfId(wanted);
				if (searchMatches.length === 0) {
					searchIndex = -1;
				} else if (kept >= 0) {
					searchIndex = kept;
				} else {
					searchIndex = 0;
				}
				searchFirstJumpDone = true;
				setSearchBusy(false);
				renderSearchUi();
				if (searchIndex >= 0) {
					jumpToSearchMatch(searchIndex);
				} else {
					renderWindow(true);
				}
			}
		},
		immediate === true
	);
}

/** The count and control state: '1 / N', '0 / 0', or empty for a blank query. */
function renderSearchUi() {
	const hasText = searchInput ? searchInput.value.trim() !== '' : searchQuery.trim() !== '';
	const active = searchQuery.trim() !== '';
	const hasMatches = searchMatches.length > 0;
	if (searchBusy) {
		searchBusy.dataset.busy = searchRunning ? 'true' : 'false';
	}
	if (searchClear) {
		searchClear.hidden = !hasText;
	}
	if (searchPrev) {
		searchPrev.disabled = !hasMatches;
	}
	if (searchNext) {
		searchNext.disabled = !hasMatches;
	}
	if (!searchCount) {
		return;
	}
	if (!active) {
		searchCount.textContent = '';
	} else if (!hasMatches) {
		searchCount.textContent = '0 / 0';
	} else {
		searchCount.textContent = (searchIndex + 1) + ' / ' + searchMatches.length;
	}
}

/** Move to one match: expand ancestors, rebuild, scroll, select, keep focus in Search. */
function jumpToSearchMatch(index) {
	const rowIndex = searchMatches[index];
	if (rowIndex === undefined) {
		return;
	}
	const id = rows[rowIndex].id;
	if (expandAncestors(id)) {
		rebuildDisplay();
	}
	const displayIndex = displayIndexById.get(id);
	if (displayIndex === undefined) {
		// The row is no longer displayed after a state change; do not select an
		// invisible row or steal focus for a jump that cannot happen. The count
		// still repaints so the current pointer cannot disagree with the control.
		renderSearchUi();
		return;
	}
	ensureVisible(displayIndex);
	setSelection(id);
	vscode.postMessage({ type: 'select', nodeId: id });
	renderWindow(true);
	renderSearchUi();
	if (searchInput) {
		searchInput.focus({ preventScroll: true });
	}
}

/** Cycle matches with wrapping; no-op when the query has no candidates. */
function cycleSearch(direction) {
	if (searchMatches.length === 0) {
		return;
	}
	searchIndex = stepMatch(searchMatches, searchIndex, direction);
	jumpToSearchMatch(searchIndex);
}

/** Drop the active result set without touching the search field text. */
function resetSearchResults() {
	searchEngine.clear();
	searchQuery = '';
	searchMatches = [];
	searchIndex = -1;
	highlightQuery = '';
	searchFirstJumpDone = false;
	setSearchBusy(false);
	renderSearchUi();
	renderWindow(true);
}

/** Enter: start a changed query, or move through the current result set. */
function executeSearch(direction) {
	const query = searchInput ? searchInput.value : searchQuery;
	if (query.trim() === '') {
		resetSearchResults();
		return;
	}
	if (query !== searchQuery) {
		startSearch(query, undefined, false);
		return;
	}
	cycleSearch(direction === -1 ? -1 : 1);
}

/** Clear the search and its highlight; optionally return focus to it. */
function clearSearch(focusInput) {
	if (searchInput) {
		searchInput.value = '';
	}
	resetSearchResults();
	if (focusInput && searchInput) {
		searchInput.focus({ preventScroll: true });
	}
}

/** Escape returns focus to the tree: the selected row when visible, else the first. */
function focusTreeAfterSearch() {
	const id =
		selectedId !== undefined && displayIndexById.has(selectedId)
			? selectedId
			: visibleNodeIds.length > 0
				? visibleNodeIds[0]
				: undefined;
	if (id !== undefined) {
		focusRow(id);
	}
}

/** A row click while search is active makes that row the current match. */
function syncSearchToSelection(id) {
	if (searchQuery.trim() === '') {
		return;
	}
	const rowIndex = rowIndexById.get(id);
	if (rowIndex === undefined) {
		return;
	}
	const at = searchMatches.indexOf(rowIndex);
	if (at >= 0) {
		searchIndex = at;
		renderSearchUi();
		// The stronger current-match mark follows the row flag, so repaint the window.
		renderWindow(true);
	}
}

function conditionNameValid(name) {
	return /^\\/?[A-Za-z_][A-Za-z0-9_./-]*$/.test(name);
}

/** One compact icon action (act-btn) with an accessible name. */
function conditionIconButton(className, label, title, pathData) {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'act-btn ' + className;
	button.title = title;
	button.setAttribute('aria-label', label);
	const svg = document.createElementNS(svgNamespace, 'svg');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('width', '12');
	svg.setAttribute('height', '12');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '1.4');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.setAttribute('aria-hidden', 'true');
	const path = document.createElementNS(svgNamespace, 'path');
	path.setAttribute('d', pathData);
	svg.appendChild(path);
	button.appendChild(svg);
	return button;
}

/**
 * Rebuilds one row from its committed dataset. View mode shows text and the
 * pencil/trash actions; edit mode shows the value input (and the name input for
 * an unsaved new row) with primary Save and secondary Cancel.
 */
function renderConditionRow(row) {
	if (!row) {
		return;
	}
	const editing = row.dataset.editing === 'true';
	const isNew = row.dataset.new === 'true';
	const auto = row.dataset.auto === 'true';
	const name = row.dataset.name || '';
	const value = row.dataset.value || '';
	row.textContent = '';
	if (editing && isNew) {
		const nameInput = document.createElement('input');
		nameInput.className = 'condition-name';
		nameInput.type = 'text';
		nameInput.placeholder = 'CONSTANT_NAME';
		nameInput.setAttribute('aria-label', 'Constant name');
		nameInput.setAttribute('aria-invalid', 'false');
		nameInput.value = name;
		row.appendChild(nameInput);
	} else {
		const nameText = document.createElement('span');
		nameText.className = 'condition-name-text';
		nameText.textContent = name;
		nameText.title = name;
		row.appendChild(nameText);
	}
	const equals = document.createElement('span');
	equals.className = 'punct';
	equals.textContent = '=';
	row.appendChild(equals);
	if (editing) {
		const valueInput = document.createElement('input');
		valueInput.className = 'condition-value';
		valueInput.type = 'text';
		valueInput.placeholder = 'value';
		valueInput.setAttribute('aria-label', 'Constant value');
		valueInput.value = value;
		row.appendChild(valueInput);
		const actions = document.createElement('div');
		actions.className = 'condition-actions';
		const save = conditionIconButton(
			'condition-save',
			'Save ' + (name || 'condition value'),
			'Save this condition value',
			'M3 8.5l3 3 7-7'
		);
		actions.appendChild(save);
		const cancel = conditionIconButton(
			'condition-cancel',
			'Cancel ' + (name || 'new condition value'),
			'Discard this change',
			'M4 4l8 8M12 4l-8 8'
		);
		actions.appendChild(cancel);
		row.appendChild(actions);
		return;
	}
	if (value.trim() !== '') {
		const valueText = document.createElement('span');
		valueText.className = 'condition-value-text';
		valueText.textContent = value;
		valueText.title = 'Value: ' + value;
		row.appendChild(valueText);
	}
	const actions = document.createElement('div');
	actions.className = 'condition-actions';
	const state = document.createElement('span');
	state.className = 'condition-state';
	state.textContent = 'unknown';
	state.title = 'No value yet: conditions using this constant stay unknown';
	actions.appendChild(state);
	actions.appendChild(
		conditionIconButton(
			'condition-edit',
			'Edit ' + (name || 'condition value'),
			'Edit',
			'M11.5 2.5l2 2L5 13H3v-2zM9.5 4.5l2 2'
		)
	);
	if (!auto) {
		actions.appendChild(
			conditionIconButton(
				'condition-remove',
				'Remove ' + (name || 'condition value'),
				'Remove',
				'M2.5 4.5h11M6 4.5V3h4v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v3.5M9.2 7v3.5'
			)
		);
	}
	row.appendChild(actions);
	updateConditionRowState(row);
}

/** Creates a row from an entry and its committed flags, then renders it. */
function conditionRowElement(entry, options) {
	const row = document.createElement('div');
	row.className = 'condition-row parent';
	const name = entry && typeof entry.name === 'string' ? entry.name.trim() : '';
	const value = entry && typeof entry.value === 'string' ? entry.value : '';
	row.dataset.name = name;
	row.dataset.value = value;
	row.dataset.auto = options && options.auto === false ? 'false' : 'true';
	row.dataset.editing = options && options.editing === true ? 'true' : 'false';
	row.dataset.new = options && options.isNew === true ? 'true' : 'false';
	renderConditionRow(row);
	return row;
}

/**
 * The badge means "no committed value". A draft never shows it, and the draft
 * input is never read here; data-value is the only source.
 */
function updateConditionRowState(row) {
	if (!row) {
		return;
	}
	const state = row.querySelector('.condition-state');
	if (!state) {
		return;
	}
	const editing = row.dataset.editing === 'true';
	const value = (row.dataset.value || '').trim();
	state.hidden = editing || value !== '';
}

function discoveredConditionSymbols() {
	const seen = new Set();
	const out = [];
	for (let at = 0; at < rows.length; at++) {
		const condition = rows[at] ? rows[at].condition : undefined;
		const symbols = condition && Array.isArray(condition.symbols) ? condition.symbols : [];
		for (let symbol = 0; symbol < symbols.length; symbol++) {
			const name = symbols[symbol];
			if (typeof name === 'string' && name !== '' && !seen.has(name)) {
				seen.add(name);
				out.push(name);
			}
		}
	}
	return out;
}

function existingConditionNames() {
	const names = new Set();
	if (!conditionsList) {
		return names;
	}
	const list = conditionsList.querySelectorAll('.condition-row');
	for (let at = 0; at < list.length; at++) {
		const name = list[at].dataset ? (list[at].dataset.name || '').trim() : '';
		if (name !== '') {
			names.add(name);
		}
	}
	return names;
}

/** The committed names of every other row, for duplicate validation. */
function conditionOtherNames(row) {
	const names = [];
	if (!conditionsList) {
		return names;
	}
	const list = conditionsList.querySelectorAll('.condition-row');
	for (let at = 0; at < list.length; at++) {
		if (list[at] === row) {
			continue;
		}
		const name = list[at].dataset ? (list[at].dataset.name || '').trim() : '';
		if (name !== '') {
			names.push(name);
		}
	}
	return names;
}

/**
 * Marks every row scanned (data-auto="true") when the current document
 * references its name, and manual otherwise. A manual row that becomes scanned
 * loses its Remove action but keeps its committed value; an editing row is
 * never rebuilt, so a draft survives a re-scan.
 */
function syncConditionRowAutoFlags() {
	if (!conditionsList) {
		return;
	}
	const discovered = new Set(discoveredConditionSymbols());
	const list = conditionsList.querySelectorAll('.condition-row');
	for (let at = 0; at < list.length; at++) {
		const row = list[at];
		const auto = discovered.has((row.dataset.name || '').trim());
		row.dataset.auto = auto ? 'true' : 'false';
		if (row.dataset.editing === 'true') {
			continue;
		}
		const hasRemove = row.querySelector('.condition-remove') !== null;
		const needsRemove = auto !== true;
		if (hasRemove !== needsRemove) {
			// Scanned rows must have no Remove, manual rows must have it.
			renderConditionRow(row);
		}
	}
}

function ensureDiscoveredConditionRows() {
	if (!conditionsList) {
		return;
	}
	const symbols = discoveredConditionSymbols();
	const existing = existingConditionNames();
	for (let at = 0; at < symbols.length; at++) {
		if (existing.has(symbols[at])) {
			continue;
		}
		existing.add(symbols[at]);
		conditionsList.appendChild(conditionRowElement({ name: symbols[at], value: '' }, { auto: true }));
	}
	syncConditionRowAutoFlags();
	updateConditionsChrome();
}

/** The committed entries only; a draft input or an unsaved row is never read. */
function readConditionEntries() {
	const entries = [];
	if (!conditionsList) {
		return entries;
	}
	const rows = conditionsList.querySelectorAll('.condition-row');
	for (let at = 0; at < rows.length; at++) {
		const row = rows[at];
		if (row.dataset.new === 'true') {
			continue;
		}
		const name = (row.dataset.name || '').trim();
		if (!conditionNameValid(name)) {
			continue;
		}
		const value = row.dataset.value || '';
		// A discovered constant with no saved value is regenerated from the document;
		// persisting it would turn it into a manual row in other files.
		if (row.dataset.auto === 'true' && value === '') {
			continue;
		}
		entries.push({ name: name, value: value });
	}
	return entries;
}

function initialConditionEntries() {
	if (!conditionsScript) {
		return [];
	}
	try {
		const parsed = JSON.parse(conditionsScript.textContent || '[]');
		return Array.isArray(parsed) ? parsed : [];
	} catch (error) {
		window.ecucReportError('The condition values could not be read: ' + error.message);
		return [];
	}
}

function updateConditionsChrome() {
	let count = 0;
	let missing = 0;
	let total = 0;
	if (conditionsList) {
		const list = conditionsList.querySelectorAll('.condition-row');
		total = list.length;
		for (let at = 0; at < list.length; at++) {
			const data = list[at].dataset;
			if (!data || data.new === 'true') {
				// An unsaved Add draft is not a committed constant yet.
				continue;
			}
			count++;
			if ((data.value || '').trim() === '') {
				missing++;
			}
		}
	}
	if (conditionsEmpty) {
		conditionsEmpty.hidden = total !== 0;
	}
	if (conditionsClear) {
		conditionsClear.disabled = count === 0;
	}
	if (conditionsValuesBadge) {
		conditionsValuesBadge.textContent =
			count + (count === 1 ? ' constant' : ' constants') + (missing > 0 ? ' · ' + missing + ' missing' : '');
		conditionsValuesBadge.hidden = count === 0;
	}
}

function renderConditionEntries(entries) {
	if (!conditionsList) {
		return;
	}
	if (editingRow) {
		// A host entries push cannot replace a local draft; Save/Cancel owns it.
		return;
	}
	conditionsList.textContent = '';
	const list = Array.isArray(entries) ? entries : [];
	for (let at = 0; at < list.length; at++) {
		conditionsList.appendChild(conditionRowElement(list[at], { auto: false }));
	}
	ensureDiscoveredConditionRows();
	updateConditionsChrome();
}

function sendConditions() {
	vscode.postMessage({ type: 'conditions', entries: readConditionEntries() });
}

/** The one validation rule for a row name, shared by Save and the tests. */
function conditionEntryError(name, others) {
	const trimmed = typeof name === 'string' ? name.trim() : '';
	if (trimmed === '') {
		return 'Enter a constant name before saving.';
	}
	if (!conditionNameValid(trimmed)) {
		return 'Invalid name: use a constant name or path (letters, digits, _ . - /).';
	}
	if (others && others.indexOf(trimmed) >= 0) {
		return 'A condition value named ' + trimmed + ' already exists.';
	}
	return '';
}

function focusConditionEditor(row) {
	if (!row) {
		return;
	}
	const input =
		row.dataset.new === 'true' ? row.querySelector('.condition-name') : row.querySelector('.condition-value');
	if (input && input.focus) {
		input.focus();
		if (input.select) {
			input.select();
		}
	}
}

function beginConditionEdit(row) {
	if (!row) {
		return;
	}
	if (editingRow === row && row.dataset.editing === 'true') {
		focusConditionEditor(row);
		return;
	}
	if (editingRow && editingRow !== row) {
		// One draft at a time: cancel the previous row before opening this one.
		cancelConditionEdit(editingRow);
	}
	editingRow = row;
	row.dataset.editing = 'true';
	renderConditionRow(row);
	focusConditionEditor(row);
	updateConditionsChrome();
}

function saveConditionEdit(row) {
	if (!row) {
		return;
	}
	const isNew = row.dataset.new === 'true';
	const nameInput = isNew ? row.querySelector('.condition-name') : null;
	const valueInput = row.querySelector('.condition-value');
	const name = isNew ? (nameInput ? nameInput.value.trim() : '') : (row.dataset.name || '').trim();
	const value = valueInput ? valueInput.value : row.dataset.value || '';
	const error = isNew ? conditionEntryError(name, conditionOtherNames(row)) : '';
	if (error !== '') {
		if (nameInput) {
			nameInput.setAttribute('aria-invalid', 'true');
		}
		if (conditionsStatus) {
			conditionsStatus.textContent = error;
		}
		return;
	}
	row.dataset.name = name;
	row.dataset.value = value;
	row.dataset.new = 'false';
	row.dataset.editing = 'false';
	editingRow = null;
	if (conditionsStatus) {
		conditionsStatus.textContent = '';
	}
	renderConditionRow(row);
	const edit = row.querySelector('.condition-edit');
	if (edit && edit.focus) {
		edit.focus();
	}
	syncConditionRowAutoFlags();
	updateConditionsChrome();
	sendConditions();
}

function cancelConditionEdit(row) {
	if (!row) {
		return;
	}
	if (editingRow === row) {
		editingRow = null;
	}
	if (row.dataset.new === 'true') {
		if (row.parentNode) {
			row.parentNode.removeChild(row);
		}
	} else {
		row.dataset.editing = 'false';
		renderConditionRow(row);
		const edit = row.querySelector('.condition-edit');
		if (edit && edit.focus) {
			edit.focus();
		}
	}
	if (conditionsStatus) {
		conditionsStatus.textContent = '';
	}
	updateConditionsChrome();
}

function addConditionEntry() {
	if (!conditionsList) {
		return;
	}
	if (editingRow) {
		if (editingRow.dataset.new === 'true') {
			focusConditionEditor(editingRow);
			return;
		}
		cancelConditionEdit(editingRow);
	}
	const row = conditionRowElement({ name: '', value: '' }, { auto: false, isNew: true, editing: true });
	conditionsList.appendChild(row);
	if (conditionsStatus) {
		conditionsStatus.textContent = '';
	}
	beginConditionEdit(row);
	updateConditionsChrome();
}

function removeConditionRow(row) {
	if (!row) {
		return;
	}
	if (row.dataset.auto === 'true') {
		// Scanned rows are owned by the document and have no Remove control.
		return;
	}
	if (editingRow === row) {
		editingRow = null;
	}
	if (row.parentNode) {
		row.parentNode.removeChild(row);
	}
	if (conditionsStatus) {
		conditionsStatus.textContent = '';
	}
	updateConditionsChrome();
	sendConditions();
}

function clearConditionEntries() {
	if (editingRow) {
		cancelConditionEdit(editingRow);
	}
	if (conditionsList) {
		const list = conditionsList.querySelectorAll('.condition-row');
		for (let at = 0; at < list.length; at++) {
			list[at].dataset.value = '';
			renderConditionRow(list[at]);
		}
	}
	updateConditionsChrome();
	sendConditions();
}

function applyDisabledCount() {
	if (!conditionsCount) {
		return;
	}
	let disabled = 0;
	for (let at = 0; at < rows.length; at++) {
		if (rows[at].disabled) {
			disabled++;
		}
	}
	conditionsCount.textContent = disabled > 0 ? disabled + ' disabled' : '';
	conditionsCount.hidden = disabled === 0;
}

/** Applies a host entries refresh (a reloaded page) and reports whether it handled the message. */
function applyConditionsMessage(message) {
	if (!message || message.type !== 'conditions') {
		return false;
	}
	renderConditionEntries(message.entries);
	return true;
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

/** A Details row whose value is a token-coloured, wrapped condition expression. */
function conditionCodeRow(key, text) {
	const row = inspectorElement('div', 'inspector-row');
	row.appendChild(inspectorElement('span', 'inspector-key', key));
	const code = inspectorElement('div', 'inspector-code condition-code');
	appendConditionTokens(code, text, '');
	row.appendChild(code);
	return row;
}

function paneActions(body) {
	const actions = inspectorElement('div', 'inspector-actions');
	body.appendChild(actions);
	return actions;
}

function clearDetailsStatus() {
	if (!detailsStatus) {
		return;
	}
	detailsStatus.textContent = '';
	delete detailsStatus.dataset.kind;
}

function setDetailsStatus(message) {
	if (!detailsStatus) {
		return;
	}
	detailsStatus.textContent = message.message || '';
	if (message.kind) {
		detailsStatus.dataset.kind = message.kind;
	} else {
		delete detailsStatus.dataset.kind;
	}
}

/**
 * Rebuilds the single Details body from the selected row's data. The selected row
 * can be outside the rendered window; nothing here queries the tree DOM. The
 * section shell (header, body) is static, so a re-scan only replaces body content
 * and never resets the pane layout.
 */
function updateInspector() {
	if (!inspector || !detailsBody) {
		return;
	}
	detailsBody.textContent = '';
	const row = selectedId === undefined ? undefined : rowById.get(selectedId);
	if (!row) {
		detailsSelectionChanged(undefined);
		const emptyPanel = inspectorElement('div', 'inspector-empty');
		emptyPanel.appendChild(inspectorElement('p', '', 'Select a line to see its details.'));
		emptyPanel.appendChild(inspectorElement('p', 'inspector-hint', 'Click a line or press Space.'));
		detailsBody.appendChild(emptyPanel);
		return;
	}
	detailsSelectionChanged(row.id);
	const data = inspectorFields(row);

	detailsBody.appendChild(inspectorElement('div', 'inspector-kind', data.kind));
	detailsBody.appendChild(inspectorElement('div', 'inspector-label', data.label));
	if (row.kind === 'container') {
		// A container's short name and definition ref are editable here, so the panel
		// never shows the same fact twice.
		detailsBody.appendChild(detailsContainerFields(row, data));
	} else {
		if (data.definitionRef) {
			detailsBody.appendChild(inspectorRow('Definition', data.definitionRef));
		}
		if (data.shortName) {
			detailsBody.appendChild(inspectorRow('Short name', data.shortName));
		}
	}
	if (data.variant) {
		detailsBody.appendChild(inspectorRow('Variant', data.variant));
	}
	if (data.type) {
		detailsBody.appendChild(inspectorRow('Type', data.type));
	}
	if (data.kind === 'parameter') {
		detailsBody.appendChild(detailsValueInput(row, data));
	}
	for (const format of data.formats) {
		detailsBody.appendChild(inspectorRow(format.label, format.value));
	}
	if (data.target) {
		detailsBody.appendChild(inspectorRow('Target', data.target));
	}
	if (data.context) {
		detailsBody.appendChild(inspectorRow('Context', data.context));
	}
	if (data.condition) {
		detailsBody.appendChild(conditionCodeRow('Condition', data.condition.text));
		detailsBody.appendChild(inspectorRow('Condition state', data.condition.state));
		if (data.condition.reason) {
			detailsBody.appendChild(inspectorRow('Condition note', data.condition.reason));
		}
	} else if (row.disabled && row.disabledBy === 'ancestor') {
		detailsBody.appendChild(inspectorRow('Disabled', 'Disabled by an ancestor condition.'));
	}
	if (data.conditions) {
		detailsBody.appendChild(conditionCodeRow('Conditions', data.conditions));
	}
	if (data.annotations) {
		detailsBody.appendChild(inspectorRow('Annotations', data.annotations));
	}
	const actions = paneActions(detailsBody);
	if (row.kind === 'reference' && row.followable === true) {
		const jump = inspectorElement('button', 'sb-btn sb-btn-secondary', 'Jump to target');
		jump.type = 'button';
		jump.addEventListener('click', function () { followItem(row.id); });
		actions.appendChild(jump);
	}
	const reveal = inspectorElement('button', 'sb-btn sb-btn-secondary', 'Reveal in source');
	reveal.type = 'button';
	reveal.addEventListener('click', function () { revealItem(row.id); });
	actions.appendChild(reveal);
}

function onTreeHover(event) {
	if (!(event.target instanceof Element)) {
		return;
	}
	const item = event.target.closest('#tree [role="treeitem"]');
	const brace = item ? null : event.target.closest('#tree .brace[data-row-id]');
	const comment = item || brace ? null : event.target.closest('#tree .comment[data-row-id]');
	if (!item && !brace && !comment) {
		if (hoveredGuideId !== undefined) {
			hoveredGuideId = undefined;
			applyGuideHover();
		}
		return;
	}
	const owner = item ? item.dataset.nodeId : brace ? brace.dataset.rowId : comment.dataset.rowId;
	let row = owner === undefined ? undefined : rowById.get(owner);
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
tree.addEventListener('contextmenu', onTreeContextMenu);
if (rowMenu) {
	rowMenu.addEventListener('click', function (event) {
		if (!(event.target instanceof Element)) {
			return;
		}
		const item = event.target.closest('.row-menu-item');
		if (!item || menuNodeId === undefined) {
			return;
		}
		const nodeId = menuNodeId;
		const action = item.dataset.action;
		hideRowMenu(true);
		if (action === 'delete' || action === 'duplicate') {
			vscode.postMessage({ type: action, nodeId });
		}
	});
	rowMenu.addEventListener('keydown', onRowMenuKeydown);
	document.addEventListener('pointerdown', function (event) {
		if (rowMenu.hidden) {
			return;
		}
		if (event.target instanceof Element && event.target.closest('#row-menu')) {
			return;
		}
		hideRowMenu(false);
	});
	window.addEventListener('scroll', function () { hideRowMenu(false); }, true);
	window.addEventListener('resize', function () { hideRowMenu(false); });
	window.addEventListener('blur', function () { hideRowMenu(false); });
}
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

if (searchInput) {
	searchInput.addEventListener('input', function () {
		if (searchInput.value === searchQuery) {
			renderSearchUi();
			return;
		}
		if (searchQuery === '' && searchMatches.length === 0) {
			// Nothing has run yet; keep the clear X in step with the typed text.
			if (searchClear) {
				searchClear.hidden = searchInput.value.trim() === '';
			}
			return;
		}
		// Typing after a run invalidates the old marks until Enter runs the new query.
		resetSearchResults();
	});
	searchInput.addEventListener('keydown', function (event) {
		if (event.key === 'Enter') {
			event.preventDefault();
			executeSearch(event.shiftKey ? -1 : 1);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			clearSearch(false);
			focusTreeAfterSearch();
		}
	});
}
if (searchClear) {
	searchClear.addEventListener('click', function () {
		clearSearch(true);
	});
}
if (searchPrev) {
	searchPrev.addEventListener('click', function () {
		cycleSearch(-1);
	});
}
if (searchNext) {
	searchNext.addEventListener('click', function () {
		cycleSearch(1);
	});
}
// Ctrl/Cmd+F is the find shortcut; F3/Shift+F3 cycle while a search query is
// active. Both are document-level so they work from the tree and the input.
document.addEventListener('keydown', function (event) {
	if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
		event.preventDefault();
		if (searchInput) {
			searchInput.focus();
			searchInput.select();
		}
	} else if (event.key === 'F3' && searchQuery.trim() !== '') {
		event.preventDefault();
		cycleSearch(event.shiftKey ? -1 : 1);
	}
});

if (conditionsAdd) {
	conditionsAdd.addEventListener('click', addConditionEntry);
}
if (conditionsClear) {
	conditionsClear.addEventListener('click', clearConditionEntries);
}
if (conditionsPanel) {
	conditionsPanel.addEventListener('click', function (event) {
		if (!(event.target instanceof Element)) {
			return;
		}
		const row = event.target.closest('.condition-row');
		if (!row) {
			return;
		}
		if (event.target.closest('.condition-edit')) {
			beginConditionEdit(row);
		} else if (event.target.closest('.condition-save')) {
			saveConditionEdit(row);
		} else if (event.target.closest('.condition-cancel')) {
			cancelConditionEdit(row);
		} else if (event.target.closest('.condition-remove')) {
			removeConditionRow(row);
		}
	});
	conditionsPanel.addEventListener('input', function (event) {
		const target = event.target;
		if (target && target.classList && target.classList.contains('condition-name')) {
			target.setAttribute('aria-invalid', 'false');
			if (conditionsStatus) {
				conditionsStatus.textContent = '';
			}
		}
	});
	conditionsPanel.addEventListener('keydown', function (event) {
		if (!(event.target instanceof Element) || event.target.tagName !== 'INPUT') {
			return;
		}
		const row = event.target.closest('.condition-row');
		if (!row || row.dataset.editing !== 'true') {
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			saveConditionEdit(row);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			cancelConditionEdit(row);
		}
	});
}

window.addEventListener('resize', function () {
	measureHeights();
	renderWindow(true);
});
// At <=720px the sidebar stacks below #main, so switching tabs or collapsing a
// section changes how many rows fit. Re-run the window only when the sidebar's
// height actually changed; a width-only change (sidebar drag) leaves the row
// count alone. Observing the sidebar rather than the tree avoids a feedback loop
// with the tree's own scrollbars.
const sidebarPanel = document.getElementById('sidebar');
let sidebarViewportHeight = sidebarPanel ? sidebarPanel.clientHeight : 0;
if (sidebarPanel && typeof ResizeObserver !== 'undefined') {
	const sidebarViewportObserver = new ResizeObserver(function () {
		const height = sidebarPanel.clientHeight;
		if (height === sidebarViewportHeight) {
			return;
		}
		sidebarViewportHeight = height;
		renderWindow(true);
	});
	sidebarViewportObserver.observe(sidebarPanel);
}

window.addEventListener('message', function (event) {
	const message = event.data;
	if (!message) {
		return;
	}
	if (applyConditionsMessage(message)) {
		return;
	}
	if (message.type === 'model') {
		clearDetailsStatus();
		const scrollTop = treeView ? treeView.getScrollTop() : 0;
		const previousFocus = focusedNodeId() || focusId;
		setRows(message.rows, message.selectedId, message.header);
		renderWindow(true);
		if (treeView) {
			treeView.setScrollTop(scrollTop);
		}
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
		applyDisabledCount();
	} else if (message.type === 'select') {
		if (typeof message.nodeId !== 'string' || !rowById.has(message.nodeId)) {
			return;
		}
		clearDetailsStatus();
		if (expandAncestors(message.nodeId)) {
			rebuildDisplay();
			renderWindow(true);
		}
		focusRow(message.nodeId);
		setSelection(message.nodeId);
	} else if (message.type === 'notice') {
		if (message.scope === 'conditions') {
			if (conditionsStatus) {
				conditionsStatus.textContent = message.message || '';
			}
			return;
		}
		if (refusalShownInDetails(message, uiState.tab !== 'details')) {
			// The details editor answers this field inline; there is no separate banner.
			clearDetailsStatus();
			return;
		}
		// Recoverable warnings belong in the Details tab.
		setDetailsStatus(message);
	}
});

// The shell (tab, width, pane heights, collapsed sections) survives a re-scan
// because it lives outside the rows; a webview reload restores it from the host
// state. mountSidebarShell binds the static markup once, before the first
// details render, so a re-scan never resets the layout.
renderConditionEntries(initialConditionEntries());
mountSidebarShell();
treeView = new DocumentTreeView('#tree', 'document', {
	onRender: collectRendered
});
treeView.mount();
const initial = readInitialRows();
applyHeader(initial.header);
setRows(initial.rows, initial.selectedId);
renderWindow(true);
prepareFocus();
applyDisabledCount();
updateInspector();
// The host warns when this never arrives: a page whose script is blocked cannot
// report its own failure, so the absence of this message is the only signal.
vscode.postMessage({ type: 'ready' });
`;
