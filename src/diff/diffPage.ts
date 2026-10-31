/**
 * The semantic diff page (task design §3).
 *
 * The shell is static and the initial `DiffDocument` is escaped JSON; the page
 * builds every row with `document.createElement` and `textContent`. The row
 * primitives come from `rowView.ts` and the window math from `virtualScroll.ts`,
 * so the editor and the diff cannot disagree about a label, a value or a spacer.
 *
 * The pure helpers (`diffVisibility`, `flattenDiffRows`, `nextChangeIndex`) are
 * serialized with `toString()` and driven by the unit tests, so the page has no
 * second implementation of a view rule. Every colour is a `--vscode-*` variable
 * (a literal may only appear as a fallback inside `var(...)`).
 */
import { randomBytes } from 'crypto';
import { matchRangesScript } from '../editor/treeQuery';
import { encodeJsonForScript } from '../editor/jsonScript';
import { pageErrorScript } from '../editor/pageError';
import { rowSearchScript } from '../editor/rowSearch';
import { rowViewScript } from '../editor/rowView';
import { virtualScrollScript } from '../editor/virtualScroll';
import { buildDocumentBraceRow, buildDocumentCommentRow, buildDocumentNodeRow, documentRowsScript } from '../editor/documentRows';
import { documentTreeStyles, documentTreeViewScript } from '../editor/documentTreeView';
import { DiffDocument, DiffRow, diffVisibility, flattenDiffDocument, nextChangeIndex } from './diffModel';

export interface DiffRenderOptions {
	/** Inline-script nonce; generated when absent. */
	nonce?: string;
}

/**
 * Serialises the diff document for a `<script type="application/json">` block.
 * The shared encoder escapes the characters that could close the element; the
 * page calls `JSON.parse` and never evaluates it.
 */
export function encodeDiffDocument(document: DiffDocument): string {
	return encodeJsonForScript(document);
}

/** Builds the whole diff page. */
export function renderDiffHtml(diff: DiffDocument, options: DiffRenderOptions = {}): string {
	const nonce = options.nonce ?? randomBytes(16).toString('base64');
	const payload = encodeDiffDocument(diff);
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">${DIFF_STYLE}${documentTreeStyles()}</style>
</head>
<body data-view="document">
<div class="toolbar">
<div class="toolbar-left">
<div class="view-switch" role="group" aria-label="Diff view">
<button id="diff-view-all" class="tool view-tool" type="button" aria-pressed="true">Show all</button>
<button id="diff-view-diff" class="tool view-tool" type="button" aria-pressed="false">Show diff only</button>
</div>
<button id="diff-prev" class="tool icon-tool" type="button" title="Previous difference (Shift+F7)" aria-label="Previous difference"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg><span class="lbl">Prev diff</span></button>
<button id="diff-next" class="tool icon-tool" type="button" title="Next difference (F7)" aria-label="Next difference"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg><span class="lbl">Next diff</span></button>
</div>
<div class="toolbar-center">
<button id="diff-swap" class="tool icon-tool" type="button" title="Swap the displayed sides" aria-label="Swap sides" aria-pressed="false"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h9m0 0-2.5-2.5M12 5 9.5 7.5M13 11H4m0 0 2.5-2.5M4 11l2.5 2.5"/></svg><span class="lbl">Swap sides</span></button>
</div>
<div class="toolbar-right">
<div class="search-box">
<div class="search-field">
<span class="search-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4"/><path d="M9.5 9.5l3.5 3.5"/></svg></span>
<input id="diff-search-input" class="search-input" type="search" placeholder="Search" aria-label="Search the diff" autocomplete="off" spellcheck="false">
<button id="diff-search-clear" class="nav-btn search-clear" type="button" title="Clear search" aria-label="Clear search" hidden><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
</div>
<button id="diff-search-prev" class="nav-btn search-nav" type="button" title="Previous match (Shift+F3)" aria-label="Previous match" disabled><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.75l4-4 4 4"/></svg></button>
<button id="diff-search-next" class="nav-btn search-nav" type="button" title="Next match (F3)" aria-label="Next match" disabled><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.25l4 4 4-4"/></svg></button>
<span id="diff-search-count" class="search-count" role="status" aria-live="polite"></span>
<span id="diff-search-busy" class="search-progress" role="status" aria-label="Searching" data-busy="false"></span>
</div>
</div>
</div>
<div id="diff-notice" class="notice" role="status" aria-live="polite"></div>
<div id="diff-body">
<div id="diff-list" class="diff-panes" role="presentation">
<div id="diff-pane-left" class="document-tree diff-pane" role="tree" aria-label="Semantic ECUC diff, left side"></div>
<div id="diff-pane-right" class="document-tree diff-pane" role="group" aria-label="Semantic ECUC diff, right side"></div>
</div>
<div id="diff-measure" aria-hidden="true"><span id="diff-ch-probe" class="ch-probe">${'0'.repeat(100)}</span><div class="diff-row probe"><div class="diff-cell"><span class="row"><span class="label">x</span></span></div></div></div>
<div id="diff-empty" class="empty" hidden><p id="diff-empty-text"></p></div>
</div>
<script type="application/json" id="diff-document" nonce="${nonce}">${payload}</script>
<script nonce="${nonce}">
${DIFF_PAGE_ERROR_SCRIPT}
${diffPageScript()}
</script>
</body>
</html>`;
}

/**
 * The rendered character width of one diff row: indent, label, value and meta.
 * The row font is monospace and meta fragments render at the same size, so a
 * character count is a faithful width model; the wider side wins.
 *
 * Serialized into the page with `toString()`: keep the body self-contained.
 */
export function diffRowChars(row: DiffRow): number {
	let widest = 0;
	const sides = [row.left, row.right];
	for (const cell of sides) {
		if (!cell) {
			continue;
		}
		let chars = 3 + 4 * (row.level - 1) + cell.label.length;
		if (cell.kind === 'module') {
			// `.k-module .label::before` renders "module ".
			chars += 7;
		}
		if (cell.kind === 'parameter' || cell.kind === 'reference') {
			// `valueSpan` always renders "= " before the value, plus one row gap.
			chars += 3 + (cell.shownValue === undefined ? 0 : cell.shownValue.length);
		}
		for (const part of cell.meta) {
			chars += part.text.length + 1;
		}
		if (chars > widest) {
			widest = chars;
		}
	}
	return widest;
}

/**
 * The rendered width of the longest row: monospace character count plus cell
 * padding and a little twisty/gap slack. No cap, so scrolling can reach the end
 * of the longest line.
 *
 * Serialized into the page with `toString()`: keep the body self-contained.
 */
export function diffContentWidth(maxChars: number, chWidth: number): number {
	const safeChars = maxChars > 0 ? maxChars : 0;
	const safeChar = chWidth > 0 ? chWidth : 0;
	return Math.ceil(safeChars * safeChar) + 26 + 8;
}

/** The page script: the shared primitives plus the diff DOM glue. */
/** The page script: the shared primitives plus the diff DOM glue. */
export function diffPageScript(): string {
	return `
diffInstallErrorSurface();
const vscode = acquireVsCodeApi();
${rowViewScript()}
${documentRowsScript()}
${virtualScrollScript()}
${documentTreeViewScript()}
${matchRangesScript()}
${rowSearchScript()}
${diffVisibility.toString()}
${flattenDiffDocument.toString()}
${nextChangeIndex.toString()}
${diffRowChars.toString()}
${diffContentWidth.toString()}

const list = document.getElementById('diff-list');
const notice = document.getElementById('diff-notice');
const searchInput = document.getElementById('diff-search-input');
const searchClear = document.getElementById('diff-search-clear');
const searchPrev = document.getElementById('diff-search-prev');
const searchNext = document.getElementById('diff-search-next');
const searchCount = document.getElementById('diff-search-count');
const searchBusy = document.getElementById('diff-search-busy');
const viewAll = document.getElementById('diff-view-all');
const viewDiff = document.getElementById('diff-view-diff');
const swapButton = document.getElementById('diff-swap');
const empty = document.getElementById('diff-empty');
const emptyText = document.getElementById('diff-empty-text');
const searchEngine = new RowSearchEngine();
let searchQuery = '';
let highlightQuery = '';
let searchMatches = [];
let searchIndex = -1;
let searchRunning = false;
let searchFirstJumpDone = false;
let searchCandidates = [];
let showChangesOnly = false;
let swapped = false;
let diffDocument = {
	left: { name: '', path: '' },
	right: { name: '', path: '' },
	leftHeader: { packages: [] },
	rightHeader: { packages: [] },
	rows: [],
	summary: { changed: 0, added: 0, removed: 0, unchanged: 0 }
};
let rows = [];
let rowByKey = new Map();
let rowIndexByKey = new Map();
let collapsed = new Set();
let selectedKey;
let focusKey;
let visibility = [];
let displayRows = [];
let displayIndexByKey = new Map();
let navigationVisible = [];
let windowRange = [0, 0];
let renderedByKey = new Map();
let heights = { row: 20 };
let heightFn = function () { return heights.row; };
let diffContent = 0;
let headerLineCount = 0;
let views;

function readInitialDocument() {
	const script = document.getElementById('diff-document');
	if (!script) {
		window.diffReportError('The diff data is missing from this page.');
		return {
			left: { name: '', path: '' },
			right: { name: '', path: '' },
			labels: ['', ''],
			leftHeader: { packages: [] },
			rightHeader: { packages: [] },
			rows: [],
			summary: { changed: 0, added: 0, removed: 0, unchanged: 0 }
		};
	}
	try {
		const parsed = JSON.parse(script.textContent || '{}');
		return parsed && Array.isArray(parsed.rows) ? parsed : {
			left: { name: '', path: '' },
			right: { name: '', path: '' },
			labels: ['', ''],
			leftHeader: { packages: [] },
			rightHeader: { packages: [] },
			rows: [],
			summary: { changed: 0, added: 0, removed: 0, unchanged: 0 }
		};
	} catch (error) {
		window.diffReportError('The diff data could not be read: ' + error.message);
		return {
			left: { name: '', path: '' },
			right: { name: '', path: '' },
			labels: ['', ''],
			leftHeader: { packages: [] },
			rightHeader: { packages: [] },
			rows: [],
			summary: { changed: 0, added: 0, removed: 0, unchanged: 0 }
		};
	}
}

function summaryOf(next) {
	return next && next.summary ? next.summary : { changed: 0, added: 0, removed: 0, unchanged: 0 };
}

function hasChanges() {
	const summary = summaryOf(diffDocument);
	return summary.changed + summary.added + summary.removed > 0;
}

function headerOf(header) {
	return header || { packages: [] };
}

function headerLineCountOf(header) {
	const value = headerOf(header);
	let count = value.schema ? 1 : 0;
	return count + (Array.isArray(value.packages) ? value.packages.length : 0);
}

function indexRows() {
	rowByKey = new Map();
	rowIndexByKey = new Map();
	for (let at = 0; at < rows.length; at++) {
		rowByKey.set(rows[at].key, rows[at]);
		rowIndexByKey.set(rows[at].key, at);
	}
}

function refreshVisibility() {
	visibility = diffVisibility(rows, showChangesOnly);
}

function buildHeightFn() {
	const base = heights.row;
	heightFn = function (index) {
		const flat = displayRows[index];
		const row = flat ? rows[flat.rowIndex] : undefined;
		const previous = index > 0 ? displayRows[index - 1] : undefined;
		const gap =
			row &&
			row.kind === 'module' &&
			index > 0 &&
			(!previous || previous.rowIndex !== flat.rowIndex);
		return base + (gap ? base : 0);
	};
}

function rebuildDisplay() {
	displayRows = flattenDiffDocument(rows, {
		collapsed: collapsed,
		visible: visibility
	});
	displayIndexByKey = new Map();
	navigationVisible = new Array(rows.length).fill(false);
	for (let at = 0; at < displayRows.length; at++) {
		const flat = displayRows[at];
		if (flat.left !== 'node' && flat.right !== 'node') {
			continue;
		}
		const row = rows[flat.rowIndex];
		displayIndexByKey.set(row.key, at);
		navigationVisible[flat.rowIndex] = true;
	}
	if (!hasChanges()) {
		// Two files with no semantic differences show the empty state, not a
		// full tree of unchanged rows (AC2).
		displayRows = [];
		displayIndexByKey = new Map();
		navigationVisible = new Array(rows.length).fill(false);
	}
	buildHeightFn();
}

function renderHeaders() {
	const left = swapped ? diffDocument.right : diffDocument.left;
	const right = swapped ? diffDocument.left : diffDocument.right;
	const labels = swapped
		? [diffDocument.labels[1], diffDocument.labels[0]]
		: diffDocument.labels;
	const leftHeader = headerOf(swapped ? diffDocument.rightHeader : diffDocument.leftHeader);
	const rightHeader = headerOf(swapped ? diffDocument.leftHeader : diffDocument.rightHeader);
	headerLineCount = Math.max(headerLineCountOf(leftHeader), headerLineCountOf(rightHeader));
	if (!views) {
		return;
	}
	views.left.setHeader({
		title: labels[0],
		titleTitle: left.path,
		schema: leftHeader.schema,
		packages: leftHeader.packages,
		lines: headerLineCount
	});
	views.right.setHeader({
		title: labels[1],
		titleTitle: right.path,
		schema: rightHeader.schema,
		packages: rightHeader.packages,
		lines: headerLineCount
	});
}

function paneModel() {
	return {
		rowCount: displayRows.length,
		heightFn: heightFn,
		renderRow: renderRow,
		contentWidth: diffContent
	};
}

function applyModels() {
	if (!views) {
		return;
	}
	views.left.setModel(paneModel());
	views.right.setModel(paneModel());
}

function setDocument(next) {
	if (!next || !Array.isArray(next.rows)) {
		return;
	}
	if (!Array.isArray(next.labels) || next.labels.length !== 2) {
		next.labels = [next.left ? next.left.name : '', next.right ? next.right.name : ''];
	}
	if (!next.leftHeader) {
		next.leftHeader = { packages: [] };
	}
	if (!next.rightHeader) {
		next.rightHeader = { packages: [] };
	}
	diffDocument = next;
	rows = next.rows;
	indexRows();
	const present = new Set(rows.map(function (row) { return row.key; }));
	collapsed = new Set(Array.from(collapsed).filter(function (key) { return present.has(key); }));
	if (selectedKey !== undefined && !rowByKey.has(selectedKey)) {
		selectedKey = undefined;
	}
	if (focusKey !== undefined && !rowByKey.has(focusKey)) {
		focusKey = selectedKey;
	}
	refreshVisibility();
	rebuildDisplay();
	// The empty/rows layout has to be in step before measuring; a still-hidden
	// list would not be measured, and the probe lives outside the list anyway.
	list.hidden = displayRows.length === 0;
	measureHeights();
	measureDiffWidth();
	applyModels();
	renderHeaders();
	updateViewButtons();
	if (searchQuery.trim() !== '') {
		startSearch(searchQuery, currentMatchKey(), true);
	}
}

function measureHeights() {
	const measure = document.getElementById('diff-measure');
	const element = measure ? measure.querySelector('.diff-cell') : null;
	const measured = element ? element.getBoundingClientRect().height : 0;
	// The probe lives outside the row list, so a hidden pane still has its last
	// real row height instead of resetting the window math to a fallback.
	heights = { row: measured > 0 ? measured : heights.row > 0 ? heights.row : 20 };
	buildHeightFn();
}

/**
 * One content width per rebuild. The row font is monospace, so one font probe
 * plus character counts give the longest row without reading layout per row.
 * Both panes share it so a synchronized horizontal offset cannot clamp early.
 */
function measureDiffWidth() {
	const probe = document.getElementById('diff-ch-probe');
	let chWidth = 0;
	if (probe) {
		const rect = probe.getBoundingClientRect();
		chWidth = rect.width > 0 ? rect.width / 100 : 0;
	}
	let maxChars = 0;
	for (const row of rows) {
		const chars = diffRowChars(row);
		if (chars > maxChars) {
			maxChars = chars;
		}
	}
	diffContent = diffContentWidth(maxChars, chWidth);
	if (views) {
		views.left.setContentWidth(diffContent);
		views.right.setContentWidth(diffContent);
	}
}

function documentOptions(flat, side) {
	const guides =
		side === 'left'
			? swapped
				? flat.guidesRight
				: flat.guidesLeft
			: swapped
				? flat.guidesLeft
				: flat.guidesRight;
	return {
		selectedId: undefined,
		expandedIds: flat.expanded ? new Set([rows[flat.rowIndex].key]) : new Set(),
		searchQuery: searchQuery,
		currentId: currentMatchKey(),
		subtreeIds: new Set(),
		guides: guides
	};
}

function documentRowForCell(cell, row) {
	return {
		kind: cell.kind,
		label: cell.label,
		shortName: cell.shortName,
		definitionRef: cell.definitionRef,
		definitionDest: cell.definitionDest,
		shownValue: cell.shownValue,
		valueKind: cell.valueKind,
		value: cell.value,
		target: cell.target,
		contextPaths: cell.contextPaths,
		comments: cell.comments,
		meta: cell.meta,
		range: cell.range,
		id: row.key,
		level: row.level,
		posinset: row.posinset,
		setsize: row.setsize,
		hasChildren: row.hasChildren,
		title: cell.definitionRef,
		empty: cell.kind === 'container' && !row.hasChildren,
		disabled: false
	};
}

function stripDocumentNode(node) {
	for (const name of ['role', 'aria-level', 'aria-posinset', 'aria-setsize', 'aria-selected', 'aria-expanded']) {
		node.removeAttribute(name);
	}
	node.tabIndex = -1;
	return node;
}

function carriesDiffGap(flat, displayIndex) {
	const row = flat ? rows[flat.rowIndex] : undefined;
	const previous = displayIndex > 0 ? displayRows[displayIndex - 1] : undefined;
	return (
		row &&
		row.kind === 'module' &&
		displayIndex > 0 &&
		(!previous || previous.rowIndex !== flat.rowIndex)
	);
}

function displayLeft(row) {
	return swapped ? row.right : row.left;
}

function displayRight(row) {
	return swapped ? row.left : row.right;
}

function displayStatus(row) {
	if (!swapped) {
		return row.status;
	}
	return row.status === 'added' ? 'removed' : row.status === 'removed' ? 'added' : row.status;
}

function hostSide(side) {
	return swapped ? (side === 'left' ? 'right' : 'left') : side;
}

function renderRow(index, pane) {
	const flat = displayRows[index];
	const element = document.createElement('div');
	element.className = 'diff-row';
	if (!flat) {
		return element;
	}
	const row = rows[flat.rowIndex];
	const side = pane === 'left' ? 'left' : 'right';
	// The display list is in comparison-side order. A swap changes which kind
	// belongs to the displayed pane, including braces/comments, so read the
	// displayed side rather than always the comparison left.
	const kind = side === 'left' ? (swapped ? flat.right : flat.left) : swapped ? flat.left : flat.right;
	const leftKind = swapped ? flat.right : flat.left;
	const rightKind = swapped ? flat.left : flat.right;
	const cell = document.createElement('div');
	cell.className = 'diff-cell';
	cell.dataset.side = side;
	element.dataset.side = side;
	const nodeRow = leftKind === 'node' || rightKind === 'node';
	const structural = !nodeRow;
	if (structural) {
		element.classList.add('diff-structural');
		element.setAttribute('aria-hidden', 'true');
	}
	const status = displayStatus(row);
	if (nodeRow) {
		element.dataset.status = status;
		element.dataset.key = row.key;
		if (row.key === selectedKey) {
			element.dataset.selected = 'true';
		}
		if (searchQuery.trim() !== '' && row.key === currentMatchKey()) {
			element.dataset.searchCurrent = 'true';
		}
		if (status !== 'unchanged') {
			const badge = document.createElement('span');
			badge.className = 'sr-only';
			badge.textContent = status;
			element.appendChild(badge);
		}
		if (side === 'left') {
			// One focusable tree row per display line: an added row's blank left
			// cell is still its treeitem, so keyboard navigation reaches it.
			element.setAttribute('role', 'treeitem');
			element.setAttribute('aria-level', String(row.level));
			element.setAttribute('aria-posinset', String(row.posinset));
			element.setAttribute('aria-setsize', String(row.setsize));
			element.setAttribute('aria-selected', row.key === selectedKey ? 'true' : 'false');
			if (row.hasChildren) {
				element.setAttribute('aria-expanded', flat.expanded ? 'true' : 'false');
			}
			element.tabIndex = -1;
		}
	}
	if (carriesDiffGap(flat, index)) {
		element.dataset.gap = 'true';
	}
	if (kind === 'blank') {
		cell.dataset.empty = 'true';
		element.appendChild(cell);
		return element;
	}
	const options = documentOptions(flat, side);
	if (kind === 'node') {
		const cellRow = side === 'left' ? displayLeft(row) : displayRight(row);
		if (cellRow) {
			const node = stripDocumentNode(
				buildDocumentNodeRow(
					documentRowForCell(cellRow, row),
					Object.assign(options, {
						selectedId: row.key === selectedKey ? row.key : undefined
					})
				)
			);
			element.title = cellRow.definitionRef;
			cell.appendChild(node);
		}
	} else if (kind === 'comment') {
		cell.appendChild(
			buildDocumentCommentRow(
				side === 'left'
					? (swapped ? flat.commentRight : flat.commentLeft) || ''
					: (swapped ? flat.commentLeft : flat.commentRight) || '',
				flat.level,
				row.key,
				options
			)
		);
	} else {
		cell.appendChild(buildDocumentBraceRow(kind, flat.level, row.key, options));
	}
	element.appendChild(cell);
	return element;
}

function focusedKey() {
	const active = document.activeElement;
	if (active && active.closest) {
		const item = active.closest('[data-key]');
		if (item) {
			return item.dataset.key;
		}
	}
	return undefined;
}

function applyRoving(key) {
	if (!views) {
		return;
	}
	const win = views.left.getWindowElement();
	const items = win.querySelectorAll('[role="treeitem"]');
	for (let at = 0; at < items.length; at++) {
		items[at].tabIndex = items[at].dataset.key === key ? 0 : -1;
	}
}

/** Rebuild the key -> left row map from the component's current window. */
function collectRendered() {
	renderedByKey = new Map();
	if (!views) {
		return;
	}
	const win = views.left.getWindowElement();
	const items = win.querySelectorAll('[data-key]');
	for (let at = 0; at < items.length; at++) {
		renderedByKey.set(items[at].dataset.key, items[at]);
	}
}

/** Restores focus to a row that survived a rebuild; a removed row is left alone. */
function refocus(key) {
	if (key === undefined) {
		return;
	}
	const element = renderedByKey.get(key);
	if (!element) {
		return;
	}
	focusKey = key;
	applyRoving(key);
	element.focus({ preventScroll: true });
}

function renderWindow(force) {
	// Keep the list's layout state in step with the row list before the
	// component measures its scroll region.
	list.hidden = displayRows.length === 0;
	if (!views) {
		return;
	}
	const previousFocus = focusedKey();
	views.left.render(force === true);
	views.right.render(force === true);
	windowRange = views.left.getVisibleRange();
	let rovingKey = previousFocus;
	if (rovingKey === undefined || !renderedByKey.has(rovingKey)) {
		rovingKey = focusKey !== undefined && renderedByKey.has(focusKey) ? focusKey : selectedKey;
	}
	if (rovingKey === undefined || !renderedByKey.has(rovingKey)) {
		rovingKey = renderedByKey.size > 0 ? renderedByKey.keys().next().value : undefined;
	}
	applyRoving(rovingKey);
	if (previousFocus !== undefined) {
		const element = renderedByKey.get(previousFocus);
		if (element) {
			element.focus({ preventScroll: true });
		}
	}
}

function ensureVisible(displayIndex) {
	if (!views) {
		return;
	}
	views.left.scrollToIndex(displayIndex);
	// The sync callback runs on the next scroll event; copy now so a focus or
	// reveal shows the same window in both panes immediately.
	views.right.setScrollTop(views.left.getScrollTop());
}

function anchorState(scrollTop) {
	return {
		rowCount: displayRows.length,
		rowHeight: heightFn,
		containerHeight: views.left.clientHeight(),
		scrollTop: scrollTop,
		bufferSize: 0,
		heightVersion: 1
	};
}

function captureAnchor() {
	if (!views || displayRows.length === 0) {
		return null;
	}
	const top = views.left.getRowsScrollTop();
	const state = anchorState(top);
	const range = calcVisibleRange(state);
	const index = range[0];
	const flat = displayRows[index];
	if (!flat) {
		return null;
	}
	return { key: rows[flat.rowIndex].key, delta: top - calcRowOffset(index, state) };
}

function restoreAnchor(anchor) {
	if (!anchor || !views || !displayIndexByKey.has(anchor.key)) {
		return;
	}
	const index = displayIndexByKey.get(anchor.key);
	const state = anchorState(0);
	views.left.setRowsScrollTop(Math.max(0, calcRowOffset(index, state) + anchor.delta));
	views.right.setScrollTop(views.left.getScrollTop());
}

function updateSelection() {
	if (!views) {
		return;
	}
	for (const view of [views.left, views.right]) {
		const win = view.getWindowElement();
		const items = win.querySelectorAll('[data-key]');
		for (let at = 0; at < items.length; at++) {
			const on = items[at].dataset.key === selectedKey;
			if (items[at].getAttribute('role') === 'treeitem') {
				items[at].setAttribute('aria-selected', on ? 'true' : 'false');
			}
			if (on) {
				items[at].dataset.selected = 'true';
			} else {
				delete items[at].dataset.selected;
			}
		}
	}
}

function updateViewButtons() {
	if (viewAll) {
		viewAll.setAttribute('aria-pressed', showChangesOnly ? 'false' : 'true');
	}
	if (viewDiff) {
		viewDiff.setAttribute('aria-pressed', showChangesOnly ? 'true' : 'false');
	}
	if (swapButton) {
		swapButton.setAttribute('aria-pressed', swapped ? 'true' : 'false');
	}
}

function updateEmptyState() {
	const none = displayRows.length === 0;
	list.hidden = none;
	empty.hidden = !none;
	if (!none) {
		return;
	}
	emptyText.textContent = hasChanges() ? 'No rows.' : 'No differences';
}

function applyView() {
	const anchor = captureAnchor();
	const scrollTop = views ? views.left.getScrollTop() : 0;
	refreshVisibility();
	rebuildDisplay();
	applyModels();
	renderWindow(true);
	if (anchor && displayIndexByKey.has(anchor.key)) {
		restoreAnchor(anchor);
	} else if (views) {
		views.left.setScrollTop(scrollTop);
		views.right.setScrollTop(views.left.getScrollTop());
	}
	renderWindow(true);
	updateSelection();
	updateEmptyState();
	if (searchQuery.trim() !== '') {
		startSearch(searchQuery, currentMatchKey(), true);
	}
}

function currentMatchKey() {
	return searchIndex >= 0 && searchIndex < searchMatches.length ? searchMatches[searchIndex] : undefined;
}

function setSearchBusy(busy) {
	searchRunning = busy === true;
	renderSearchUi();
}

function searchIndexOfKey(key) {
	return key === undefined ? -1 : searchMatches.indexOf(key);
}

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

function jumpToSearchMatch(index) {
	const key = searchMatches[index];
	if (key === undefined) {
		return;
	}
	if (expandAncestors(key)) {
		rebuildDisplay();
		applyModels();
	}
	const displayIndex = displayIndexByKey.get(key);
	if (displayIndex === undefined) {
		renderSearchUi();
		return;
	}
	ensureVisible(displayIndex);
	selectedKey = key;
	focusKey = key;
	renderWindow(true);
	updateSelection();
	renderSearchUi();
	if (searchInput) {
		searchInput.focus({ preventScroll: true });
	}
}

function cycleSearch(direction) {
	if (searchMatches.length === 0) {
		return;
	}
	searchIndex = (searchIndex + direction + searchMatches.length) % searchMatches.length;
	jumpToSearchMatch(searchIndex);
}

function startSearch(query, previousKey, immediate) {
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
	searchFirstJumpDone = previousKey !== undefined;
	searchCandidates = showChangesOnly
		? rows.filter(function (row) { return row.status !== 'unchanged'; })
		: rows;
	setSearchBusy(true);
	renderWindow(true);
	searchEngine.search(
		searchCandidates,
		text,
		{
			onProgressUpdate: function (indices) {
				const currentKey = currentMatchKey();
				searchMatches = indices.map(function (index) { return searchCandidates[index].key; });
				if (!searchFirstJumpDone && searchMatches.length > 0) {
					searchIndex = 0;
					searchFirstJumpDone = true;
					renderSearchUi();
					jumpToSearchMatch(0);
					return;
				}
				const wanted = currentKey !== undefined ? currentKey : previousKey;
				const kept = searchIndexOfKey(wanted);
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
			onComplete: function (indices) {
				const currentKey = currentMatchKey();
				searchMatches = indices.map(function (index) { return searchCandidates[index].key; });
				const wanted = currentKey !== undefined ? currentKey : previousKey;
				const kept = searchIndexOfKey(wanted);
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

function resetSearchResults() {
	searchEngine.clear();
	searchQuery = '';
	searchMatches = [];
	searchIndex = -1;
	searchCandidates = [];
	highlightQuery = '';
	searchFirstJumpDone = false;
	setSearchBusy(false);
	renderWindow(true);
}

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

function clearSearch(focusInput) {
	if (searchInput) {
		searchInput.value = '';
	}
	resetSearchResults();
	if (focusInput && searchInput) {
		searchInput.focus({ preventScroll: true });
	}
}

function focusListAfterSearch() {
	const key =
		selectedKey !== undefined && displayIndexByKey.has(selectedKey)
			? selectedKey
			: displayRows.length > 0
				? rows[displayRows[0].rowIndex].key
				: undefined;
	if (key === undefined) {
		return;
	}
	focusKey = key;
	renderWindow(true);
	applyRoving(key);
	const element = renderedByKey.get(key);
	if (element) {
		element.focus({ preventScroll: true });
	}
}

function setView(changesOnly) {
	if (showChangesOnly === changesOnly) {
		return;
	}
	showChangesOnly = changesOnly;
	updateViewButtons();
	applyView();
}

function setSwapped(next) {
	swapped = next === true;
	if (views) {
		// Swap resets horizontal only; the vertical position is preserved.
		views.left.setScrollLeft(0);
		views.right.setScrollLeft(0);
	}
	updateViewButtons();
	renderHeaders();
	renderWindow(true);
	updateSelection();
}

function selectKey(key, shouldFocus) {
	if (!rowByKey.has(key)) {
		return;
	}
	selectedKey = key;
	focusKey = key;
	const displayIndex = displayIndexByKey.get(key);
	if (displayIndex !== undefined) {
		ensureVisible(displayIndex);
	}
	renderWindow(true);
	updateSelection();
	const element = renderedByKey.get(key);
	if (element) {
		applyRoving(key);
		if (shouldFocus) {
			element.focus({ preventScroll: true });
		}
	}
}

function expandAncestors(key) {
	let changed = false;
	let row = rowByKey.get(key);
	const seen = new Set([key]);
	while (row && row.parentKey !== null) {
		if (seen.has(row.parentKey)) {
			break;
		}
		seen.add(row.parentKey);
		if (collapsed.delete(row.parentKey)) {
			changed = true;
		}
		row = rowByKey.get(row.parentKey);
	}
	return changed;
}

function revealKey(key) {
	if (!rowByKey.has(key)) {
		return;
	}
	if (expandAncestors(key)) {
		rebuildDisplay();
		applyModels();
		renderWindow(true);
	}
	const displayIndex = displayIndexByKey.get(key);
	if (displayIndex === undefined) {
		return;
	}
	selectedKey = key;
	focusKey = key;
	ensureVisible(displayIndex);
	renderWindow(true);
	updateSelection();
	const element = renderedByKey.get(key);
	if (element) {
		applyRoving(key);
		element.focus({ preventScroll: true });
	}
}

function gotoChange(direction) {
	const from = selectedKey === undefined ? undefined : rowIndexByKey.get(selectedKey);
	const index = nextChangeIndex(rows, navigationVisible, from === undefined ? -1 : from, direction);
	if (index < 0) {
		return;
	}
	revealKey(rows[index].key);
}

function toggleCollapsed(key) {
	const row = rowByKey.get(key);
	if (!row || !row.hasChildren) {
		return;
	}
	const focused = focusedKey();
	const next = new Set(collapsed);
	if (next.has(key)) {
		next.delete(key);
	} else {
		next.add(key);
	}
	collapsed = next;
	rebuildDisplay();
	applyModels();
	renderWindow(true);
	updateSelection();
	refocus(focused);
}

function nextNodeIndex(from, direction) {
	let at = from + direction;
	while (at >= 0 && at < displayRows.length) {
		const flat = displayRows[at];
		if (flat.left === 'node' || flat.right === 'node') {
			return at;
		}
		at += direction;
	}
	return -1;
}

function moveSelection(offset) {
	if (displayRows.length === 0) {
		return;
	}
	let at = selectedKey === undefined ? undefined : displayIndexByKey.get(selectedKey);
	if (at === undefined) {
		at = offset > 0 ? -1 : displayRows.length;
	}
	const direction = offset >= 0 ? 1 : -1;
	let next = at;
	for (let step = 0; step < Math.abs(offset); step++) {
		const candidate = nextNodeIndex(next, direction);
		if (candidate < 0) {
			break;
		}
		next = candidate;
	}
	if (next !== at && next >= 0) {
		selectKey(rows[displayRows[next].rowIndex].key, true);
	}
}

function selectedParent() {
	const row = selectedKey === undefined ? undefined : rowByKey.get(selectedKey);
	return row && row.parentKey !== null ? row.parentKey : undefined;
}

function selectedChild() {
	if (selectedKey === undefined) {
		return undefined;
	}
	const at = displayIndexByKey.get(selectedKey);
	if (at === undefined) {
		return undefined;
	}
	const childAt = nextNodeIndex(at, 1);
	if (childAt < 0) {
		return undefined;
	}
	const next = rows[displayRows[childAt].rowIndex];
	return next.level > rows[displayRows[at].rowIndex].level ? next.key : undefined;
}

function onKeyDown(event) {
	if (!(event.target instanceof Element)) {
		return;
	}
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
		event.preventDefault();
		if (searchInput) {
			searchInput.focus();
			searchInput.select();
		}
		return;
	}
	if (event.key === 'F7') {
		if (!event.target.closest('#diff-list')) {
			return;
		}
		event.preventDefault();
		gotoChange(event.shiftKey ? -1 : 1);
		return;
	}
	const item = event.target.closest('#diff-list [role="treeitem"]');
	const fallback = !item && selectedKey !== undefined && event.target === document.body;
	if (!item && !fallback) {
		return;
	}
	const key = item ? item.dataset.key : selectedKey;
	const row = rowByKey.get(key);
	if (!row) {
		return;
	}
	if (event.key === 'ArrowDown') {
		event.preventDefault();
		moveSelection(1);
	} else if (event.key === 'ArrowUp') {
		event.preventDefault();
		moveSelection(-1);
	} else if (event.key === 'Home') {
		event.preventDefault();
		moveSelection(-displayRows.length);
	} else if (event.key === 'End') {
		event.preventDefault();
		moveSelection(displayRows.length);
	} else if (event.key === 'ArrowRight') {
		event.preventDefault();
		if (row.hasChildren && collapsed.has(key)) {
			toggleCollapsed(key);
		} else {
			const child = selectedChild();
			if (child !== undefined) {
				selectKey(child, true);
			}
		}
	} else if (event.key === 'ArrowLeft') {
		event.preventDefault();
		if (row.hasChildren && !collapsed.has(key)) {
			toggleCollapsed(key);
		} else {
			const parent = selectedParent();
			if (parent !== undefined) {
				selectKey(parent, true);
			}
		}
	} else if (event.key === 'Enter') {
		event.preventDefault();
		const side = displayLeft(row) ? hostSide('left') : hostSide('right');
		vscode.postMessage({ type: 'reveal', side: side, key: key });
	} else if (event.key === ' ') {
		event.preventDefault();
		selectKey(key, true);
	}
}

function onPaneRowClick(index, event) {
	const flat = displayRows[index];
	if (!flat) {
		return;
	}
	const row = rows[flat.rowIndex];
	if (!row) {
		return;
	}
	if (flat.left !== 'node' && flat.right !== 'node') {
		return;
	}
	if (event && event.target && event.target.closest && event.target.closest('.twisty')) {
		toggleCollapsed(row.key);
		return;
	}
	selectKey(row.key, true);
}

function syncPanes(pane, top, left) {
	if (!views) {
		return;
	}
	const driver = pane === 'left' ? views.left : views.right;
	const follower = pane === 'left' ? views.right : views.left;
	if (Math.abs(follower.getScrollTop() - top) >= 1) {
		follower.setScrollTop(top);
	}
	if (Math.abs(follower.getScrollLeft() - left) >= 1) {
		follower.setScrollLeft(left);
	}
	if (Math.abs(driver.getScrollLeft() - left) >= 1) {
		driver.setScrollLeft(left);
	}
}

document.addEventListener('keydown', onKeyDown);
window.addEventListener('resize', function () {
	measureHeights();
	measureDiffWidth();
	applyModels();
	renderWindow(true);
});
if (typeof ResizeObserver === 'function') {
	new ResizeObserver(function () {
		measureDiffWidth();
	}).observe(list);
}

document.getElementById('diff-prev').addEventListener('click', function () { gotoChange(-1); });
document.getElementById('diff-next').addEventListener('click', function () { gotoChange(1); });
if (swapButton) {
	swapButton.addEventListener('click', function () { setSwapped(!swapped); });
}
if (viewAll) {
	viewAll.addEventListener('click', function () { setView(false); });
}
if (viewDiff) {
	viewDiff.addEventListener('click', function () { setView(true); });
}

if (searchInput) {
	searchInput.addEventListener('input', function () {
		if (searchInput.value === searchQuery) {
			renderSearchUi();
			return;
		}
		if (searchQuery === '' && searchMatches.length === 0) {
			renderSearchUi();
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
			clearSearch(true);
			focusListAfterSearch();
		} else if (event.key === 'F3') {
			event.preventDefault();
			executeSearch(event.shiftKey ? -1 : 1);
		}
	});
}
if (searchClear) {
	searchClear.addEventListener('click', function () { clearSearch(true); });
}
if (searchPrev) {
	searchPrev.addEventListener('click', function () { cycleSearch(-1); });
}
if (searchNext) {
	searchNext.addEventListener('click', function () { cycleSearch(1); });
}

window.addEventListener('message', function (event) {
	const message = event.data;
	if (!message) {
		return;
	}
	if (message.type === 'diff') {
		notice.textContent = '';
		delete notice.dataset.kind;
		const anchor = captureAnchor();
		const scrollTop = views ? views.left.getScrollTop() : 0;
		setDocument(message.document);
		renderWindow(true);
		if (anchor && displayIndexByKey.has(anchor.key)) {
			restoreAnchor(anchor);
		} else if (views) {
			views.left.setScrollTop(scrollTop);
			views.right.setScrollTop(views.left.getScrollTop());
		}
		renderWindow(true);
		updateSelection();
		updateEmptyState();
	} else if (message.type === 'error') {
		notice.textContent = message.message || 'The comparison could not be refreshed.';
		notice.dataset.kind = 'warn';
	}
});

views = {
	left: new DocumentTreeView('#diff-pane-left', 'left', {
		onVisibleWindowChange: function (top, left) { syncPanes('left', top, left); },
		onRender: collectRendered,
		onRowClick: onPaneRowClick
	}),
	right: new DocumentTreeView('#diff-pane-right', 'right', {
		onVisibleWindowChange: function (top, left) { syncPanes('right', top, left); },
		onRowClick: onPaneRowClick
	})
};
views.left.mount();
views.right.mount();
setDocument(readInitialDocument());
renderWindow(true);
updateSelection();
updateViewButtons();
updateEmptyState();
vscode.postMessage({ type: 'ready' });
`;
}

const DIFF_STYLE = `
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
body {
	--diff-added-bg: var(--vscode-diffEditor-insertedLineBackground, var(--vscode-diffEditor-insertedTextBackground, transparent));
	--diff-removed-bg: var(--vscode-diffEditor-removedLineBackground, var(--vscode-diffEditor-removedTextBackground, transparent));
	--diff-changed-bg: var(--vscode-diffEditor-modifiedTextBackground, var(--vscode-editor-findMatchHighlightBackground, transparent));
	--diff-added-edge: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-editorInfo-foreground, currentColor));
	--diff-removed-edge: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-editorError-foreground, currentColor));
	--diff-changed-edge: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-editorWarning-foreground, currentColor));
}
.toolbar {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
	align-items: center;
	gap: 6px;
	height: 26px;
	padding: 0 8px;
	flex: none;
	font-size: 12px;
	color: var(--tok-dim);
	border-bottom: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
}
.toolbar-left {
	display: flex;
	align-items: center;
	justify-content: flex-start;
	gap: 6px;
	min-width: 0;
}
.toolbar-center {
	display: flex;
	align-items: center;
	justify-content: center;
	min-width: 0;
}
.toolbar-right {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 6px;
	min-width: 0;
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
.search-input {
	box-sizing: border-box;
	height: 22px;
	min-width: 70px;
	width: 180px;
	padding: 0 7px;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: 12px;
	color: var(--vscode-input-foreground, var(--vscode-foreground));
	background: var(--vscode-input-background, transparent);
	border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, transparent));
	border-radius: 3px;
}
.search-input:focus {
	border-color: var(--vscode-focusBorder);
	outline: 1px solid var(--vscode-focusBorder);
	outline-offset: -1px;
}
input[type="search"]::-webkit-search-cancel-button,
input[type="search"]::-webkit-search-decoration {
	-webkit-appearance: none;
	appearance: none;
	display: none;
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
	color: var(--tok-dim);
	pointer-events: none;
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
.nav-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 22px;
	padding: 0;
	color: var(--tok-dim);
	background: transparent;
	border: 1px solid transparent;
	border-radius: 3px;
	cursor: pointer;
}
.nav-btn:hover {
	color: var(--vscode-foreground);
	background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground, transparent));
	border-color: var(--vscode-panel-border, transparent);
}
.nav-btn:focus-visible {
	outline: 1px solid var(--vscode-focusBorder);
	outline-offset: 1px;
}
.nav-btn:disabled {
	opacity: 0.4;
	cursor: default;
}
.search-box .search-nav {
	width: 28px;
	height: 22px;
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
	color: var(--tok-dim);
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
	animation: diff-search-spin 0.8s linear infinite;
}
@keyframes diff-search-spin {
	from { transform: rotate(0deg); }
	to { transform: rotate(360deg); }
}
.view-switch {
	display: flex;
	flex: none;
	gap: 2px;
}
.view-tool[aria-pressed="true"],
.icon-tool[aria-pressed="true"] {
	color: var(--vscode-inputOption-activeForeground, var(--vscode-foreground));
	background: var(--vscode-inputOption-activeBackground, var(--vscode-toolbar-hoverBackground, transparent));
}
.tool {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 4px;
	height: 22px;
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
	background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground, transparent));
}
.tool:focus-visible {
	outline: 1px solid var(--vscode-focusBorder, var(--vscode-contrastActiveBorder, transparent));
	outline-offset: 1px;
}
.tool svg {
	flex: none;
}
.icon-tool .lbl {
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
#diff-body {
	position: relative;
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-width: 0;
	min-height: 0;
}
#diff-list {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	grid-auto-rows: minmax(0, 1fr);
	flex: 1 1 auto;
	min-width: 0;
	min-height: 0;
}
#diff-list[hidden] {
	display: none;
}
.diff-pane {
	border-top: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
}
.diff-pane + .diff-pane {
	border-left: 0;
	box-shadow: inset 1px 0 0 var(--vscode-editorGroup-border, var(--vscode-panel-border));
}
.diff-pane .document-tree-header {
	border-bottom: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
}
#diff-measure {
	position: absolute;
	left: -10000px;
	top: 0;
	width: 240px;
	visibility: hidden;
	pointer-events: none;
}
.ch-probe {
	position: absolute;
	left: 0;
	top: 0;
	white-space: pre;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	font-weight: var(--vscode-editor-font-weight, normal);
}
.diff-row {
	position: relative;
	display: flex;
	align-items: stretch;
	outline: none;
}
.diff-row[data-gap="true"] {
	padding-top: var(--ecuc-lh);
}
.diff-cell {
	flex: 1 1 auto;
	min-width: 0;
	height: var(--ecuc-lh);
	padding: 0;
	box-sizing: border-box;
}
.diff-row:hover > .diff-cell {
	background-color: var(--hover-bg);
}
.diff-row[data-status="changed"] > .diff-cell {
	background-color: var(--diff-changed-bg);
}
.diff-row[data-status="added"] > .diff-cell[data-side="right"] {
	background-color: var(--diff-added-bg);
}
.diff-row[data-status="removed"] > .diff-cell[data-side="left"] {
	background-color: var(--diff-removed-bg);
}
.diff-row[data-status="changed"] > .diff-cell[data-side="left"] {
	box-shadow: inset 3px 0 0 var(--diff-changed-edge);
}
.diff-row[data-status="changed"] > .diff-cell[data-side="right"] {
	box-shadow: inset -3px 0 0 var(--diff-changed-edge);
}
.diff-row[data-status="added"] > .diff-cell[data-side="right"] {
	box-shadow: inset -3px 0 0 var(--diff-added-edge);
}
.diff-row[data-status="removed"] > .diff-cell[data-side="left"] {
	box-shadow: inset 3px 0 0 var(--diff-removed-edge);
}
.diff-row[data-selected="true"] > .diff-cell {
	background-color: var(--sel-bg);
	outline: 1px solid var(--rail);
	outline-offset: -1px;
}
.diff-row:focus-visible > .diff-cell {
	outline: 2px solid var(--rail);
	outline-offset: -2px;
}
.diff-cell[data-empty="true"] {
	background-image: repeating-linear-gradient(135deg, transparent 0 6px, var(--vscode-editorGroup-border, transparent) 6px 7px);
}
.diff-row[data-search-current="true"] .diff-cell mark {
	background: var(--match-hi);
}
.sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0 0 0 0);
	white-space: nowrap;
	border: 0;
}
.empty {
	padding: 6px 10px;
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
@media (forced-colors: active) {
	.diff-row[data-status="changed"] > .diff-cell,
	.diff-row[data-status="added"] > .diff-cell[data-side="right"],
	.diff-row[data-status="removed"] > .diff-cell[data-side="left"] {
		background: transparent;
		outline: 1px dotted var(--vscode-contrastBorder, var(--vscode-focusBorder));
		outline-offset: -1px;
	}
	.diff-row[data-selected="true"] > .diff-cell {
		background: transparent;
		outline: 1px solid var(--vscode-contrastActiveBorder, var(--vscode-contrastBorder, var(--vscode-focusBorder)));
		outline-offset: -1px;
	}
	.diff-row:hover > .diff-cell {
		background: transparent;
		outline: 1px dashed var(--vscode-contrastBorder, var(--vscode-focusBorder));
		outline-offset: -1px;
	}
}
body.vscode-high-contrast .diff-row[data-status="changed"] > .diff-cell,
body.vscode-high-contrast .diff-row[data-status="added"] > .diff-cell[data-side="right"],
body.vscode-high-contrast .diff-row[data-status="removed"] > .diff-cell[data-side="left"] {
	background: transparent;
	outline: 1px dotted var(--vscode-contrastBorder, var(--vscode-focusBorder));
	outline-offset: -1px;
}
body.vscode-high-contrast .diff-row[data-selected="true"] > .diff-cell {
	background: transparent;
	outline: 1px solid var(--vscode-contrastActiveBorder, var(--vscode-contrastBorder, var(--vscode-focusBorder)));
	outline-offset: -1px;
}
body.vscode-high-contrast .diff-row:hover > .diff-cell {
	background: transparent;
	outline: 1px dashed var(--vscode-contrastBorder, var(--vscode-focusBorder));
	outline-offset: -1px;
}
@media (max-width: 720px) {
	.toolbar {
		padding: 0 4px;
		gap: 3px;
	}
	.search-field {
		flex: 1 1 0;
	}
	.notice,
	.icon-tool .lbl {
		display: none;
	}
	.tool {
		padding: 0 4px;
	}
}
@media (prefers-reduced-motion: reduce) {
	.twisty svg {
		transition: none;
	}
}
`;

/** Boot error surface; shared with the editor page and pointed at the diff notice. */
const DIFF_PAGE_ERROR_SCRIPT = pageErrorScript({
	installerName: 'diffInstallErrorSurface',
	reporterName: 'diffReportError',
	noticeId: 'diff-notice',
	label: 'The diff page failed',
});
