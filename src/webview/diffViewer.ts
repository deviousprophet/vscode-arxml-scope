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
import { matchRangesScript } from './render/treeQuery';
import { encodeJsonForScript } from './render/jsonScript';
import { pageErrorScript } from './render/pageError';
import { rowSearchScript } from './render/rowSearch';
import { rowViewScript } from './render/rowView';
import { virtualScrollScript } from './render/virtualScroll';
import { buildDocumentBraceRow, buildDocumentCommentRow, buildDocumentNodeRow, documentRowsScript } from './components/documentTree/documentRows';
import { documentTreeStyles, documentTreeViewScript } from './components/documentTree/documentTreeView';
import { DiffDocument, DiffRow, diffVisibility, flattenDiffDocument, nextChangeIndex } from '../core/diff/diffModel';
import { diffViewScript, diffViewStyles, renderDiffViewHtml } from './components/diffView/diffView';
import { renderDiffToolbarHtml, toolbarScript, toolbarStyles } from './components/toolbar/toolbar';
import { renderSearchBarHtml, searchBarScript, searchBarStyles } from './components/searchBar/searchBar';
import { sharedStyles } from './styles';
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
	const style = [
		sharedStyles(),
		documentTreeStyles(),
		toolbarStyles(),
		searchBarStyles(),
		diffViewStyles(),
	].join('\n');
	const searchHtml = renderSearchBarHtml('diff-', 'Search the diff');
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">${style}</style>
</head>
<body data-view="document" data-page="diff">
${renderDiffToolbarHtml(searchHtml)}
<div id="diff-notice" class="notice" role="status" aria-live="polite"></div>
${renderDiffViewHtml()}
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
${diffViewScript()}
${toolbarScript()}
${searchBarScript()}
${matchRangesScript()}
${rowSearchScript()}
${diffVisibility.toString()}
${flattenDiffDocument.toString()}
${nextChangeIndex.toString()}
${diffRowChars.toString()}
${diffContentWidth.toString()}
const list = document.getElementById('diff-list');
const notice = document.getElementById('diff-notice');
let searchBar;
let toolbar;
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
	if (toolbar) {
		toolbar.setViewMode(showChangesOnly);
		toolbar.setSwapped(swapped);
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
	const hasText = searchBar.hasText();
	const active = searchQuery.trim() !== '';
	const hasMatches = searchMatches.length > 0;
	searchBar.setBusy(searchRunning);
	searchBar.setClearVisible(hasText);
	searchBar.setNavigationEnabled(hasMatches);
	if (!active) {
		searchBar.setCount('');
	} else if (!hasMatches) {
		searchBar.setCount('0 / 0');
	} else {
		searchBar.setCount((searchIndex + 1) + ' / ' + searchMatches.length);
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
	searchBar.focus();
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
	const query = searchBar.value();
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
	searchBar.setValue('');
	resetSearchResults();
	if (focusInput) {
		searchBar.focus();
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
		searchBar.focus();
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
	if (views) {
		views.syncPanes(pane, top, left);
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
views = new DiffView({
	onRender: function (pane) {
		if (pane === 'left') {
			collectRendered();
		}
	},
	onRowClick: function (pane, index, event) {
		onPaneRowClick(index, event);
	}
});
views.mount();
toolbar = new DiffToolbar({
	onViewAll: function () { setView(false); },
	onViewDiff: function () { setView(true); },
	onPrev: function () { gotoChange(-1); },
	onNext: function () { gotoChange(1); },
	onSwap: function () { setSwapped(!swapped); }
});
toolbar.mount();
searchBar = new SearchBar('diff-', {
	onExecute: function (direction) { executeSearch(direction); },
	onCycle: function (direction) { cycleSearch(direction); },
	onClear: function () { resetSearchResults(); },
	onEscape: function () { clearSearch(true); focusListAfterSearch(); },
	onInput: function (value) {
		if (value === searchQuery) {
			renderSearchUi();
			return;
		}
		if (searchQuery === '' && searchMatches.length === 0) {
			renderSearchUi();
			return;
		}
		resetSearchResults();
	}
});
searchBar.mount();
setDocument(readInitialDocument());
renderWindow(true);
updateSelection();
updateViewButtons();
updateEmptyState();
vscode.postMessage({ type: 'ready' });
`;
}
/** Boot error surface; shared with the editor page and pointed at the diff notice. */
const DIFF_PAGE_ERROR_SCRIPT = pageErrorScript({
	installerName: 'diffInstallErrorSurface',
	reporterName: 'diffReportError',
	noticeId: 'diff-notice',
	label: 'The diff page failed',
});
