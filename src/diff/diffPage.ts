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
import { escapeHtml } from '../editor/html';
import { encodeJsonForScript } from '../editor/jsonScript';
import { pageErrorScript } from '../editor/pageError';
import { rowViewScript } from '../editor/rowView';
import { virtualScrollScript } from '../editor/virtualScroll';
import { DiffDocument, diffVisibility, flattenDiffRows, nextChangeIndex } from './diffModel';

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
	const left = escapeHtml(diff.left.name);
	const right = escapeHtml(diff.right.name);
	const leftPath = escapeHtml(diff.left.path);
	const rightPath = escapeHtml(diff.right.path);
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">${DIFF_STYLE}</style>
<style id="virtual-style" nonce="${nonce}">#diff-top{height:0px}#diff-bottom{height:0px}</style>
</head>
<body>
<div class="toolbar">
<div class="filter-wrap">
<input id="diff-filter" class="filter" type="text" placeholder="Filter" aria-label="Filter the diff">
<button id="diff-filter-clear" class="filter-clear" type="button" title="Clear the filter" aria-label="Clear the filter" hidden><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
</div>
<label class="toggle"><input id="diff-changes" type="checkbox"> <span>Changes only</span></label>
<span id="diff-summary" class="summary" role="status" aria-live="polite"></span>
<span class="grow"></span>
<button id="diff-prev" class="tool icon-tool" type="button" title="Previous change (Shift+F7)" aria-label="Previous change"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg><span class="lbl">Previous</span></button>
<button id="diff-next" class="tool icon-tool" type="button" title="Next change (F7)" aria-label="Next change"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg><span class="lbl">Next</span></button>
<button id="diff-collapse" class="tool icon-tool" type="button" title="Collapse every container" aria-label="Collapse every container"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2.25l4 4 4-4M4 13.75l4-4 4 4"/></svg><span class="lbl">Collapse</span></button>
<button id="diff-expand" class="tool icon-tool" type="button" title="Expand every container" aria-label="Expand every container"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.25 8 2.25l4 4M4 9.75l4 4 4-4"/></svg><span class="lbl">Expand</span></button>
</div>
<div id="diff-notice" class="notice" role="status" aria-live="polite"></div>
<div id="diff-scroll">
<div class="pane-headers" role="presentation">
<div class="pane-header" title="${leftPath}">${left}</div>
<div class="pane-header" title="${rightPath}">${right}</div>
</div>
<div id="diff-list" role="tree" aria-label="Semantic ECUC diff">
<div id="diff-measure" aria-hidden="true"><div class="diff-row probe"><div class="diff-cell"><span class="row"><span class="label">x</span></span></div><div class="diff-cell"><span class="row"><span class="label">x</span></span></div></div></div>
<div id="diff-top" class="v-spacer" role="presentation" aria-hidden="true"></div>
<div id="diff-window" role="presentation"></div>
<div id="diff-bottom" class="v-spacer" role="presentation" aria-hidden="true"></div>
</div>
<div id="diff-empty" class="empty" hidden><p id="diff-empty-text"></p></div>
</div>
<div id="diff-detail" class="detail" role="region" aria-label="Selected row details"></div>
<script type="application/json" id="diff-document" nonce="${nonce}">${payload}</script>
<script nonce="${nonce}">
${DIFF_PAGE_ERROR_SCRIPT}
${diffPageScript()}
</script>
</body>
</html>`;
}

/** The page script: the shared primitives plus the diff DOM glue. */
export function diffPageScript(): string {
	return `
diffInstallErrorSurface();
const vscode = acquireVsCodeApi();
${rowViewScript()}
${virtualScrollScript()}
${matchRangesScript()}
${diffVisibility.toString()}
${flattenDiffRows.toString()}
${nextChangeIndex.toString()}

const scroll = document.getElementById('diff-scroll');
const list = document.getElementById('diff-list');
const listWindow = document.getElementById('diff-window');
const virtualStyle = document.getElementById('virtual-style');
const notice = document.getElementById('diff-notice');
const filterInput = document.getElementById('diff-filter');
const clearButton = document.getElementById('diff-filter-clear');
const countLabel = document.getElementById('diff-summary');
const changesInput = document.getElementById('diff-changes');
const empty = document.getElementById('diff-empty');
const emptyText = document.getElementById('diff-empty-text');
const detail = document.getElementById('diff-detail');
const bufferRows = 10;
let filterQuery = '';
let highlightQuery = '';
let changesOnly = false;
let diffDocument = {
	left: { name: '', path: '' },
	right: { name: '', path: '' },
	rows: [],
	summary: { changed: 0, added: 0, removed: 0, unchanged: 0 }
};
let rows = [];
let rowByKey = new Map();
let rowIndexByKey = new Map();
let collapsed = new Set();
let selectedKey;
let focusKey;
let filterResult = { visible: [], matchCount: 0, visibleCount: 0 };
let displayRows = [];
let displayIndexByKey = new Map();
let navigationVisible = [];
let windowRange = [0, 0];
let renderedByKey = new Map();
let renderedDataVersion = -1;
let dataVersion = 0;
let heights = { row: 20 };
let heightFn = function () { return heights.row; };
let heightVersion = 0;
let scrollFrame = 0;

function readInitialDocument() {
	const script = document.getElementById('diff-document');
	if (!script) {
		window.diffReportError('The diff data is missing from this page.');
		return {
			left: { name: '', path: '' },
			right: { name: '', path: '' },
			rows: [],
			summary: { changed: 0, added: 0, removed: 0, unchanged: 0 }
		};
	}
	try {
		const parsed = JSON.parse(script.textContent || '{}');
		return parsed && Array.isArray(parsed.rows) ? parsed : {
			left: { name: '', path: '' },
			right: { name: '', path: '' },
			rows: [],
			summary: { changed: 0, added: 0, removed: 0, unchanged: 0 }
		};
	} catch (error) {
		window.diffReportError('The diff data could not be read: ' + error.message);
		return {
			left: { name: '', path: '' },
			right: { name: '', path: '' },
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

function indexRows() {
	rowByKey = new Map();
	rowIndexByKey = new Map();
	for (let at = 0; at < rows.length; at++) {
		rowByKey.set(rows[at].key, rows[at]);
		rowIndexByKey.set(rows[at].key, at);
	}
}

function refreshFilter() {
	filterResult = diffVisibility(rows, filterQuery, changesOnly);
}

function filterActive() {
	return filterQuery.trim() !== '' || changesOnly;
}

function buildHeightFn() {
	const base = heights.row;
	heightFn = function (index) {
		const flat = displayRows[index];
		const row = flat ? rows[flat.rowIndex] : undefined;
		const gap = row && row.kind === 'module' && index > 0;
		return base + (gap ? base : 0);
	};
	heightVersion++;
}

function rebuildDisplay() {
	displayRows = flattenDiffRows(rows, {
		collapsed: collapsed,
		visible: filterResult.visible,
		filterActive: filterActive()
	});
	displayIndexByKey = new Map();
	navigationVisible = new Array(rows.length).fill(false);
	for (let at = 0; at < displayRows.length; at++) {
		const flat = displayRows[at];
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

function setDocument(next) {
	if (!next || !Array.isArray(next.rows)) {
		return;
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
	refreshFilter();
	rebuildDisplay();
	// The probe lives inside #diff-list; a still-hidden list measures 0. Update the
	// empty/rows layout before measuring so a refresh that introduces the first rows
	// gets the real row height instead of the fallback.
	list.hidden = displayRows.length === 0;
	measureHeights();
	dataVersion++;
}

function measureHeights() {
	const measure = document.getElementById('diff-measure');
	const element = measure ? measure.querySelector('.diff-cell') : null;
	const measured = element ? element.getBoundingClientRect().height : 0;
	// A hidden list measures 0; keep the last real height rather than resetting
	// the window math to the fallback.
	heights = { row: measured > 0 ? measured : heights.row > 0 ? heights.row : 20 };
	buildHeightFn();
}

function listWindowTop() {
	// The list starts below the sticky pane headers; its position is stable while
	// the window swaps spacer heights, unlike #diff-window's own position.
	const scrollRect = scroll.getBoundingClientRect();
	const listRect = list.getBoundingClientRect();
	const padding = parseFloat(getComputedStyle(list).paddingTop) || 0;
	return listRect.top - scrollRect.top + scroll.scrollTop + padding;
}

function virtualState() {
	return {
		rowCount: displayRows.length,
		rowHeight: heightFn,
		containerHeight: scroll.clientHeight,
		scrollTop: Math.max(0, scroll.scrollTop - listWindowTop()),
		bufferSize: bufferRows,
		heightVersion: heightVersion
	};
}

function setSpacers(top, bottom) {
	virtualStyle.textContent =
		'#diff-top{height:' + Math.max(0, top) + 'px}' +
		'#diff-bottom{height:' + Math.max(0, bottom) + 'px}';
}

function buildDiffCell(cell, side, row) {
	const wrapper = document.createElement('div');
	wrapper.className = 'diff-cell';
	wrapper.dataset.side = side;
	const line = document.createElement('span');
	line.className = 'row k-' + cell.kind + (cell.shownValue !== undefined ? ' has-value' : ' no-value');
	line.dataset.level = String(row.level);
	const twisty = document.createElement('span');
	twisty.className = 'twisty';
	twisty.setAttribute('aria-hidden', 'true');
	if (row.hasChildren && (cell.kind === 'container' || cell.kind === 'module')) {
		twisty.appendChild(twistyIcon());
	}
	line.appendChild(twisty);
	const label = document.createElement('span');
	label.className = 'label';
	appendHighlighted(label, cell.label, filterQuery);
	line.appendChild(label);
	if (cell.kind === 'parameter' || cell.kind === 'reference') {
		line.appendChild(valueSpan(cell, true, filterQuery));
	}
	if (cell.meta && cell.meta.length > 0) {
		line.appendChild(metaSpan(cell, filterQuery));
	}
	wrapper.appendChild(line);
	return wrapper;
}

function emptyCell(side) {
	const wrapper = document.createElement('div');
	wrapper.className = 'diff-cell';
	wrapper.dataset.side = side;
	wrapper.dataset.empty = 'true';
	return wrapper;
}

function buildDiffRow(row, displayIndex) {
	const element = document.createElement('div');
	element.className = 'node diff-row';
	element.setAttribute('role', 'treeitem');
	element.setAttribute('aria-level', String(row.level));
	element.setAttribute('aria-posinset', String(row.posinset));
	element.setAttribute('aria-setsize', String(row.setsize));
	element.setAttribute('aria-selected', row.key === selectedKey ? 'true' : 'false');
	if (row.hasChildren) {
		element.setAttribute('aria-expanded', displayRows[displayIndex] && displayRows[displayIndex].expanded ? 'true' : 'false');
	}
	element.tabIndex = -1;
	element.dataset.key = row.key;
	element.dataset.status = row.status;
	if (row.key === selectedKey) {
		element.dataset.selected = 'true';
	}
	if (row.kind === 'module' && displayIndex > 0) {
		element.dataset.gap = 'true';
	}
	const owner = row.left || row.right;
	if (owner) {
		element.title = owner.definitionRef;
	}
	if (row.status !== 'unchanged') {
		const status = document.createElement('span');
		status.className = 'sr-only';
		status.textContent = row.status;
		element.appendChild(status);
	}
	element.appendChild(row.left ? buildDiffCell(row.left, 'left', row) : emptyCell('left'));
	element.appendChild(row.right ? buildDiffCell(row.right, 'right', row) : emptyCell('right'));
	return element;
}

function focusedKey() {
	const active = document.activeElement;
	if (active && active.closest) {
		const item = active.closest('#diff-list [role="treeitem"]');
		if (item) {
			return item.dataset.key;
		}
	}
	return undefined;
}

function applyRoving(key) {
	for (const [renderedKey, element] of renderedByKey) {
		element.tabIndex = renderedKey === key ? 0 : -1;
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
	// Keep the list's layout state in step with the row list before measuring the
	// scroll region; a refresh can turn the empty state into rows or vice versa.
	list.hidden = displayRows.length === 0;
	const state = virtualState();
	const range = calcVisibleRange(state);
	const start = range[0];
	const end = range[1];
	if (!force && start === windowRange[0] && end === windowRange[1] && renderedDataVersion === dataVersion) {
		return;
	}
	const previousFocus = focusedKey();
	windowRange = [start, end];
	renderedDataVersion = dataVersion;
	const total = calcTotalHeight(state);
	setSpacers(calcRowOffset(start, state), Math.max(0, total - calcRowOffset(end, state)));
	const fragment = document.createDocumentFragment();
	renderedByKey = new Map();
	for (let at = start; at < end; at++) {
		const flat = displayRows[at];
		if (!flat) {
			continue;
		}
		const row = rows[flat.rowIndex];
		const element = buildDiffRow(row, at);
		renderedByKey.set(row.key, element);
		fragment.appendChild(element);
	}
	listWindow.textContent = '';
	listWindow.appendChild(fragment);
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
	const state = virtualState();
	const offset = calcRowOffset(displayIndex, state);
	const height = heightFn(displayIndex);
	const top = listWindowTop();
	const viewTop = scroll.scrollTop - top;
	const viewBottom = viewTop + scroll.clientHeight;
	if (offset < viewTop) {
		scroll.scrollTop = top + offset;
	} else if (offset + height > viewBottom) {
		scroll.scrollTop = top + offset + height - scroll.clientHeight;
	}
}

function captureAnchor() {
	if (displayRows.length === 0) {
		return null;
	}
	const state = virtualState();
	const anchorScroll = Math.max(0, scroll.scrollTop - listWindowTop());
	for (let at = windowRange[0]; at < windowRange[1]; at++) {
		const flat = displayRows[at];
		if (flat) {
			return { key: rows[flat.rowIndex].key, delta: anchorScroll - calcRowOffset(at, state) };
		}
	}
	return null;
}

function restoreAnchor(anchor) {
	if (!anchor || !displayIndexByKey.has(anchor.key)) {
		return;
	}
	const index = displayIndexByKey.get(anchor.key);
	const state = virtualState();
	scroll.scrollTop = listWindowTop() + Math.max(0, calcRowOffset(index, state) + anchor.delta);
}

function updateSelection() {
	for (const [key, element] of renderedByKey) {
		const on = key === selectedKey;
		element.setAttribute('aria-selected', on ? 'true' : 'false');
		if (on) {
			element.dataset.selected = 'true';
		} else {
			delete element.dataset.selected;
		}
	}
}

function detailElement(tag, className, text) {
	const element = document.createElement(tag);
	if (className) {
		element.className = className;
	}
	if (text !== undefined) {
		element.textContent = text;
	}
	return element;
}

function revealButton(side, row) {
	const button = detailElement('button', 'tool', side === 'left' ? 'Open left in source' : 'Open right in source');
	button.type = 'button';
	button.addEventListener('click', function () {
		vscode.postMessage({ type: 'reveal', side: side, key: row.key });
	});
	return button;
}

function updateDetail() {
	detail.textContent = '';
	const row = selectedKey === undefined ? undefined : rowByKey.get(selectedKey);
	if (!row) {
		detail.appendChild(detailElement('p', 'detail-hint', 'Select a row to see the changed fields.'));
		return;
	}
	const owner = row.left || row.right;
	const head = detailElement('div', 'detail-head');
	head.appendChild(detailElement('span', 'detail-kind', row.kind));
	head.appendChild(detailElement('span', 'detail-label', owner ? owner.label : row.key));
	head.appendChild(detailElement('span', 'detail-status status-' + row.status, row.status));
	detail.appendChild(head);
	if (owner) {
		detail.appendChild(detailElement('div', 'detail-definition', owner.definitionRef));
	}
	if (row.status === 'changed') {
		const table = detailElement('div', 'detail-changes');
		for (const change of row.changes) {
			const line = detailElement('div', 'detail-change');
			line.appendChild(detailElement('span', 'detail-field', change.field));
			line.appendChild(detailElement('span', 'detail-side detail-left', change.left));
			line.appendChild(detailElement('span', 'detail-side detail-right', change.right));
			table.appendChild(line);
		}
		detail.appendChild(table);
	} else if (row.status === 'added') {
		detail.appendChild(detailElement('p', 'detail-note', 'Only in the right file.'));
	} else if (row.status === 'removed') {
		detail.appendChild(detailElement('p', 'detail-note', 'Only in the left file.'));
	} else {
		detail.appendChild(detailElement('p', 'detail-note', 'No differences for this row.'));
	}
	const actions = detailElement('div', 'detail-actions');
	if (row.left) {
		actions.appendChild(revealButton('left', row));
	}
	if (row.right) {
		actions.appendChild(revealButton('right', row));
	}
	if (actions.childNodes.length > 0) {
		detail.appendChild(actions);
	}
}

function updateSummary() {
	const summary = summaryOf(diffDocument);
	countLabel.textContent =
		summary.changed + ' changed · ' + summary.added + ' added · ' + summary.removed + ' removed';
}

function updateEmptyState() {
	const none = displayRows.length === 0;
	list.hidden = none;
	empty.hidden = !none;
	if (!none) {
		return;
	}
	if (!hasChanges()) {
		emptyText.textContent = 'No differences';
	} else if (filterActive()) {
		const query = filterInput ? filterInput.value.trim() : filterQuery.trim();
		emptyText.textContent = query === '' ? 'No rows match.' : 'No rows match "' + query + '".';
	} else {
		emptyText.textContent = 'No rows.';
	}
}

function applyFilter() {
	const anchor = captureAnchor();
	const scrollTop = scroll.scrollTop;
	refreshFilter();
	rebuildDisplay();
	renderWindow(true);
	if (anchor && displayIndexByKey.has(anchor.key)) {
		restoreAnchor(anchor);
	} else {
		scroll.scrollTop = scrollTop;
	}
	renderWindow(true);
	updateSelection();
	updateSummary();
	updateEmptyState();
	updateDetail();
}

function clearFilter(focusInput) {
	if (filterInput) {
		filterInput.value = '';
	}
	if (clearButton) {
		clearButton.hidden = true;
	}
	filterQuery = '';
	applyFilter();
	if (focusInput && filterInput) {
		filterInput.focus();
	}
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
	updateDetail();
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
	updateDetail();
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
	renderWindow(true);
	updateSelection();
	refocus(focused);
}

function collapseAll() {
	const focused = focusedKey();
	collapsed = new Set(rows.filter(function (row) { return row.hasChildren; }).map(function (row) { return row.key; }));
	rebuildDisplay();
	renderWindow(true);
	updateSelection();
	refocus(focused);
}

function expandAll() {
	const focused = focusedKey();
	collapsed = new Set();
	rebuildDisplay();
	renderWindow(true);
	updateSelection();
	refocus(focused);
}

function moveSelection(offset) {
	if (displayRows.length === 0) {
		return;
	}
	let at = selectedKey === undefined ? undefined : displayIndexByKey.get(selectedKey);
	if (at === undefined) {
		at = offset > 0 ? -1 : displayRows.length;
	}
	const next = Math.max(0, Math.min(displayRows.length - 1, at + offset));
	selectKey(rows[displayRows[next].rowIndex].key, true);
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
	if (at === undefined || at + 1 >= displayRows.length) {
		return undefined;
	}
	const next = rows[displayRows[at + 1].rowIndex];
	return next.level > rows[displayRows[at].rowIndex].level ? next.key : undefined;
}

function onKeyDown(event) {
	if (!(event.target instanceof Element)) {
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
	if (!item) {
		return;
	}
	const key = item.dataset.key;
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
		vscode.postMessage({ type: 'reveal', side: row.left ? 'left' : 'right', key: key });
	} else if (event.key === ' ') {
		event.preventDefault();
		selectKey(key, true);
	}
}

list.addEventListener('click', function (event) {
	if (!(event.target instanceof Element)) {
		return;
	}
	const item = event.target.closest('#diff-list [role="treeitem"]');
	if (!item) {
		return;
	}
	const key = item.dataset.key;
	if (event.target.closest('.twisty')) {
		toggleCollapsed(key);
		return;
	}
	selectKey(key, true);
});
document.addEventListener('keydown', onKeyDown);
scroll.addEventListener('scroll', function () {
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

document.getElementById('diff-prev').addEventListener('click', function () { gotoChange(-1); });
document.getElementById('diff-next').addEventListener('click', function () { gotoChange(1); });
document.getElementById('diff-collapse').addEventListener('click', collapseAll);
document.getElementById('diff-expand').addEventListener('click', expandAll);

if (filterInput) {
	filterInput.addEventListener('input', function () {
		if (clearButton) {
			clearButton.hidden = filterInput.value.trim() === '';
		}
		filterQuery = filterInput.value;
		applyFilter();
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
if (changesInput) {
	changesInput.addEventListener('change', function () {
		changesOnly = changesInput.checked === true;
		applyFilter();
	});
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
		const scrollTop = scroll.scrollTop;
		setDocument(message.document);
		renderWindow(true);
		if (anchor && displayIndexByKey.has(anchor.key)) {
			restoreAnchor(anchor);
		} else {
			scroll.scrollTop = scrollTop;
		}
		renderWindow(true);
		updateSelection();
		updateSummary();
		updateEmptyState();
		updateDetail();
	} else if (message.type === 'error') {
		notice.textContent = message.message || 'The comparison could not be refreshed.';
		notice.dataset.kind = 'warn';
	}
});

setDocument(readInitialDocument());
renderWindow(true);
updateSelection();
updateSummary();
updateEmptyState();
updateDetail();
vscode.postMessage({ type: 'ready' });
`;
}

const DIFF_LEVEL_RULES = Array.from({ length: 24 }, (_, at) => {
	const level = at + 1;
	return `.diff-cell > .row[data-level="${level}"] { padding-left: calc(var(--indent) * ${at}); }`;
}).join('\n');

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
	--ecuc-fs: var(--vscode-editor-font-size, 13px);
	--ecuc-lh: calc(var(--ecuc-fs) * 1.55);
	--tok-keyword: var(--vscode-debugTokenExpression-boolean, var(--vscode-editor-foreground));
	--tok-string: var(--vscode-debugTokenExpression-string, var(--vscode-editor-foreground));
	--tok-number: var(--vscode-debugTokenExpression-number, var(--vscode-editor-foreground));
	--tok-meta: var(--vscode-debugTokenExpression-name, var(--vscode-editor-foreground));
	--tok-comment: var(--vscode-charts-green, var(--vscode-editor-foreground));
	--tok-key: var(--vscode-symbolIcon-variableForeground, var(--vscode-editor-foreground));
	--tok-punct: var(--vscode-editor-foreground);
	--tok-dim: var(--vscode-descriptionForeground, var(--vscode-editor-foreground));
	--container-accent: var(--vscode-symbolIcon-classForeground, var(--vscode-editor-foreground));
	--diff-added-bg: var(--vscode-diffEditor-insertedLineBackground, var(--vscode-diffEditor-insertedTextBackground, transparent));
	--diff-removed-bg: var(--vscode-diffEditor-removedLineBackground, var(--vscode-diffEditor-removedTextBackground, transparent));
	--diff-changed-bg: var(--vscode-diffEditor-modifiedTextBackground, var(--vscode-editor-findMatchHighlightBackground, transparent));
	--diff-added-edge: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-editorInfo-foreground, currentColor));
	--diff-removed-edge: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-editorError-foreground, currentColor));
	--diff-changed-edge: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-editorWarning-foreground, currentColor));
	--hover-bg: var(--vscode-list-hoverBackground, transparent);
	--sel-bg: var(--vscode-editor-selectionHighlightBackground, transparent);
	--rail: var(--vscode-focusBorder, var(--vscode-editorCursor-foreground, var(--vscode-editor-foreground)));
	--indent: 2ch;
}
.toolbar {
	display: flex;
	flex-wrap: nowrap;
	gap: 6px;
	align-items: center;
	height: 30px;
	padding: 0 8px;
	flex: none;
	font-size: 12px;
	color: var(--tok-dim);
	border-bottom: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
}
.grow {
	flex: 1 1 auto;
}
.filter-wrap {
	position: relative;
	display: flex;
	flex: 0 1 26ch;
	min-width: 0;
}
.filter {
	width: 100%;
	min-width: 0;
	height: 22px;
	padding: 0 22px 0 6px;
	font: inherit;
	color: var(--vscode-input-foreground, var(--vscode-editor-foreground));
	background: var(--vscode-input-background, transparent);
	border: 1px solid var(--vscode-input-border, transparent);
	border-radius: 2px;
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
.toggle {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	white-space: nowrap;
	color: var(--tok-dim);
	cursor: pointer;
}
.toggle input {
	margin: 0;
}
.summary {
	white-space: nowrap;
	color: var(--tok-dim);
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
#diff-scroll {
	flex: 1 1 auto;
	min-height: 0;
	overflow: auto;
	overflow-anchor: none;
}
.pane-headers {
	position: sticky;
	top: 0;
	z-index: 2;
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	background: var(--vscode-editor-background);
	border-bottom: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
}
.pane-header {
	min-width: 0;
	padding: 3px 10px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: 600;
	color: var(--vscode-foreground);
}
.pane-header + .pane-header {
	border-left: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
}
#diff-list {
	position: relative;
	padding: 4px 0 12px;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	font-weight: var(--vscode-editor-font-weight, normal);
	line-height: var(--ecuc-lh);
	font-variant-ligatures: none;
	tab-size: 4;
}
#diff-list[hidden] {
	display: none;
}
#diff-window {
	display: flow-root;
}
.v-spacer {
	pointer-events: none;
}
#diff-measure {
	position: absolute;
	left: -10000px;
	top: 0;
	width: 240px;
	visibility: hidden;
	pointer-events: none;
}
.diff-row, .probe {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	align-items: stretch;
	outline: none;
}
.diff-row {
	position: relative;
}
.diff-row[data-gap="true"] {
	padding-top: var(--ecuc-lh);
}
.diff-cell {
	display: flex;
	align-items: baseline;
	min-width: 0;
	height: var(--ecuc-lh);
	padding: 0 10px;
	overflow: hidden;
	box-sizing: border-box;
}
.diff-cell[data-side="right"] {
	border-left: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
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
.diff-cell > .row {
	display: flex;
	flex-wrap: nowrap;
	gap: 1ch;
	align-items: baseline;
	min-width: 0;
	width: 100%;
	white-space: pre;
}
${DIFF_LEVEL_RULES}
.twisty {
	flex: 0 0 16px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	align-self: stretch;
	color: var(--vscode-icon-foreground, var(--vscode-foreground));
	opacity: 0.55;
	cursor: pointer;
}
.twisty svg {
	transition: transform 120ms ease;
}
.diff-row[aria-expanded="true"] > .diff-cell > .row > .twisty svg {
	transform: rotate(90deg);
}
.label {
	flex: 0 0 auto;
	white-space: pre;
	font-weight: 400;
	color: var(--vscode-editor-foreground);
}
.row.k-module .label::before {
	content: "module ";
	color: var(--tok-keyword);
}
.row.k-parameter > .label,
.row.k-reference > .label {
	color: var(--tok-key);
}
.row.k-container > .label {
	color: var(--container-accent);
}
.value {
	flex: 0 0 auto;
	min-width: 0;
	margin: 0;
	white-space: pre;
	color: var(--vscode-foreground);
}
.value .punct {
	color: var(--tok-punct);
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
.row.k-reference > .value .value-text {
	color: var(--vscode-symbolIcon-functionForeground, var(--tok-meta));
	font-style: italic;
}
.row-meta {
	display: flex;
	flex: 0 0 auto;
	flex-wrap: nowrap;
	gap: 1ch;
	min-width: 0;
	color: var(--vscode-editor-foreground);
	white-space: pre;
}
.row-meta > span {
	max-width: none;
	overflow: visible;
	white-space: pre;
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
	color: var(--tok-meta);
}
.annotation {
	color: var(--tok-comment);
	font-style: italic;
}
.context {
	color: var(--vscode-editor-foreground);
}
mark {
	color: var(--vscode-editor-findMatchForeground, var(--vscode-foreground));
	background: var(--vscode-editor-findMatchHighlightBackground, var(--vscode-list-hoverBackground, transparent));
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
#diff-detail {
	flex: none;
	max-height: 32vh;
	overflow: auto;
	padding: 6px 10px;
	border-top: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
	background: var(--vscode-editor-background);
}
.detail-hint,
.detail-note {
	margin: 2px 0;
	color: var(--tok-dim);
	font-style: italic;
}
.detail-head {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	align-items: baseline;
}
.detail-kind {
	font-size: 11px;
	color: var(--tok-dim);
}
.detail-label {
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-weight: 600;
}
.detail-status {
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.04em;
}
.detail-status.status-changed {
	color: var(--diff-changed-edge);
}
.detail-status.status-added {
	color: var(--diff-added-edge);
}
.detail-status.status-removed {
	color: var(--diff-removed-edge);
}
.detail-definition {
	margin: 2px 0 6px;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: 0.9em;
	color: var(--tok-dim);
	overflow-wrap: anywhere;
}
.detail-changes {
	display: flex;
	flex-direction: column;
	gap: 2px;
}
.detail-change {
	display: grid;
	grid-template-columns: 14ch minmax(0, 1fr) minmax(0, 1fr);
	gap: 8px;
	align-items: baseline;
}
.detail-field {
	color: var(--tok-dim);
}
.detail-side {
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
.detail-left {
	color: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-editorError-foreground, var(--vscode-foreground)));
}
.detail-right {
	color: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-editorInfo-foreground, var(--vscode-foreground)));
}
.detail-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	margin-top: 8px;
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
	.filter-wrap {
		flex: 1 1 0;
	}
	.summary,
	.notice,
	.grow,
	.icon-tool .lbl {
		display: none;
	}
	.tool {
		padding: 0 4px;
	}
	.detail-change {
		grid-template-columns: minmax(0, 1fr);
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
