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
import { rowSearchScript } from '../editor/rowSearch';
import { rowViewScript } from '../editor/rowView';
import { virtualScrollScript } from '../editor/virtualScroll';
import { DiffCell, DiffDocument, DiffRow, diffVisibility, flattenDiffRows, nextChangeIndex } from './diffModel';

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
	const left = escapeHtml(diff.labels[0]);
	const right = escapeHtml(diff.labels[1]);
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
<span class="toolbar-slot" aria-hidden="true"></span>
<div class="toolbar-center">
<button id="diff-swap" class="tool icon-tool" type="button" title="Swap the displayed sides" aria-label="Swap sides" aria-pressed="false"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h9m0 0-2.5-2.5M12 5 9.5 7.5M13 11H4m0 0 2.5-2.5M4 11l2.5 2.5"/></svg><span class="lbl">Swap sides</span></button>
</div>
<div class="toolbar-right">
<div class="view-switch" role="group" aria-label="Diff view">
<button id="diff-view-all" class="tool view-tool" type="button" aria-pressed="true">Show all</button>
<button id="diff-view-diff" class="tool view-tool" type="button" aria-pressed="false">Show diff only</button>
</div>
<button id="diff-prev" class="tool icon-tool" type="button" title="Previous difference (Shift+F7)" aria-label="Previous difference"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg><span class="lbl">Prev diff</span></button>
<button id="diff-next" class="tool icon-tool" type="button" title="Next difference (F7)" aria-label="Next difference"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg><span class="lbl">Next diff</span></button>
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
<div id="diff-scroll">
<div class="pane-headers" role="presentation">
<div id="diff-left-header" class="pane-header" title="${leftPath}"><span id="diff-left-label">${left}</span></div>
<div id="diff-right-header" class="pane-header" title="${rightPath}"><span id="diff-right-label">${right}</span></div>
</div>
<div id="diff-list" role="tree" aria-label="Semantic ECUC diff">
<div id="diff-measure" aria-hidden="true"><span id="diff-ch-probe" class="ch-probe">${'0'.repeat(100)}</span><div class="diff-row probe"><div class="diff-cell"><span class="row"><span class="label">x</span></span></div><div class="diff-cell"><span class="row"><span class="label">x</span></span></div></div></div>
<div id="diff-top" class="v-spacer" role="presentation" aria-hidden="true"></div>
<div id="diff-window" role="presentation"></div>
<div id="diff-bottom" class="v-spacer" role="presentation" aria-hidden="true"></div>
</div>
<div id="diff-empty" class="empty" hidden><p id="diff-empty-text"></p></div>
</div>
<div id="diff-detail" class="detail" role="region" aria-label="Selected row changes"></div>
<script type="application/json" id="diff-document" nonce="${nonce}">${payload}</script>
<script nonce="${nonce}">
${DIFF_PAGE_ERROR_SCRIPT}
${diffPageScript()}
</script>
</body>
</html>`;
}

/**
 * The rail label for a compared field, in the Details vocabulary.
 *
 * Serialized into the page with `toString()`: keep the body self-contained.
 */
export function diffFieldLabel(field: string): string {
	switch (field) {
		case 'definition ref':
			return 'Definition';
		case 'definition dest':
			return 'Definition DEST';
		case 'short name':
			return 'Short name';
		case 'variant':
			return 'Variant';
		case 'value':
		case 'shown value':
			return 'Value';
		case 'target':
			return 'Target';
		case 'context':
			return 'Context';
		case 'condition':
			return 'Condition';
		case 'annotation':
			return 'Annotations';
		default:
			return field;
	}
}

/**
 * The canonical position of a field in the strip, so the same field always sits
 * in the same place. Unknown fields sort last instead of disappearing.
 *
 * Serialized into the page with `toString()`: keep the body self-contained.
 */
export function diffFieldRank(field: string): number {
	switch (field) {
		case 'definition ref':
			return 0;
		case 'definition dest':
			return 1;
		case 'short name':
			return 2;
		case 'variant':
			return 3;
		case 'value':
		case 'shown value':
			return 4;
		case 'target':
			return 5;
		case 'context':
			return 6;
		case 'condition':
			return 7;
		case 'annotation':
			return 8;
		default:
			return 99;
	}
}

/**
 * The fields an added or removed row shows: everything present on the one side
 * that survives, in canonical order. Empty fields are dropped, so a bare
 * container lists only what it actually carries.
 *
 * Serialized into the page with `toString()`: keep the body self-contained.
 */
export function diffCellFields(cell: DiffCell): { field: string; text: string }[] {
	const out: { field: string; text: string }[] = [];
	if (!cell) {
		return out;
	}
	const push = function (field: string, text: string): void {
		if (text !== '') {
			out.push({ field: field, text: text });
		}
	};
	const metaOf = function (cls: string): string {
		const parts: string[] = [];
		for (const part of cell.meta) {
			if (part.cls === cls) {
				parts.push(part.text);
			}
		}
		return parts.join('\n');
	};
	let context = '';
	if (cell.contextPaths && cell.contextPaths.length > 0) {
		context = cell.contextPaths.join(', ');
	} else {
		for (const part of cell.meta) {
			if (part.cls === 'context') {
				context = part.text.indexOf('context ') === 0 ? part.text.slice('context '.length) : part.text;
				break;
			}
		}
	}
	push('definition ref', cell.definitionRef);
	push('definition dest', cell.definitionDest === undefined ? '' : cell.definitionDest);
	push('short name', cell.shortName === undefined ? '' : cell.shortName);
	push('variant', metaOf('variant'));
	push('value', cell.shownValue === undefined ? (cell.value === undefined ? '' : cell.value) : cell.shownValue);
	push('target', cell.target === undefined ? '' : cell.target);
	push('context', context);
	push('condition', metaOf('condition'));
	push('annotation', metaOf('annotation'));
	return out;
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
		let chars = 2 * row.level + cell.label.length;
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
 * One column width: never narrower than half the viewport, wide enough for the
 * longest row, and capped so a pathological line cannot create an unusable
 * scroll range. 20px covers the cell padding, 8px the twisty and gaps.
 *
 * Serialized into the page with `toString()`: keep the body self-contained.
 */
export function diffColumnWidth(maxChars: number, chWidth: number, half: number, cap: number): number {
	const safeChars = maxChars > 0 ? maxChars : 0;
	const safeChar = chWidth > 0 ? chWidth : 0;
	const safeHalf = half > 0 ? half : 0;
	const need = Math.ceil(safeChars * safeChar) + 20 + 8;
	return Math.min(Math.max(safeHalf, need), cap);
}

/** The page script: the shared primitives plus the diff DOM glue. */
export function diffPageScript(): string {
	return `
diffInstallErrorSurface();
const vscode = acquireVsCodeApi();
${rowViewScript()}
${virtualScrollScript()}
${matchRangesScript()}
${rowSearchScript()}
${diffVisibility.toString()}
${flattenDiffRows.toString()}
${nextChangeIndex.toString()}
${diffFieldLabel.toString()}
${diffFieldRank.toString()}
${diffCellFields.toString()}
${diffRowChars.toString()}
${diffColumnWidth.toString()}

const scroll = document.getElementById('diff-scroll');
const list = document.getElementById('diff-list');
const listWindow = document.getElementById('diff-window');
const virtualStyle = document.getElementById('virtual-style');
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
const leftLabel = document.getElementById('diff-left-label');
const rightLabel = document.getElementById('diff-right-label');
const leftHeader = document.getElementById('diff-left-header');
const rightHeader = document.getElementById('diff-right-header');
const empty = document.getElementById('diff-empty');
const emptyText = document.getElementById('diff-empty-text');
const detail = document.getElementById('diff-detail');
const bufferRows = 10;
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
let renderedDataVersion = -1;
let dataVersion = 0;
let heights = { row: 20 };
let heightFn = function () { return heights.row; };
let heightVersion = 0;
let spacerTop = 0;
let spacerBottom = 0;
let diffColumn = 0;
let virtualStyleText = '';
let scrollFrame = 0;

function readInitialDocument() {
	const script = document.getElementById('diff-document');
	if (!script) {
		window.diffReportError('The diff data is missing from this page.');
		return {
			left: { name: '', path: '' },
			right: { name: '', path: '' },
			labels: ['', ''],
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
			rows: [],
			summary: { changed: 0, added: 0, removed: 0, unchanged: 0 }
		};
	} catch (error) {
		window.diffReportError('The diff data could not be read: ' + error.message);
		return {
			left: { name: '', path: '' },
			right: { name: '', path: '' },
			labels: ['', ''],
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

function refreshVisibility() {
	visibility = diffVisibility(rows, showChangesOnly);
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
		visible: visibility
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
	if (!Array.isArray(next.labels) || next.labels.length !== 2) {
		next.labels = [next.left ? next.left.name : '', next.right ? next.right.name : ''];
	}
	diffDocument = next;
	rows = next.rows;
	indexRows();
	renderHeaders();
	updateViewButtons();
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
	// The probe lives inside #diff-list; a still-hidden list measures 0. Update the
	// empty/rows layout before measuring so a refresh that introduces the first rows
	// gets the real row height instead of the fallback.
	list.hidden = displayRows.length === 0;
	measureHeights();
	measureColumnWidth();
	dataVersion++;
	if (searchQuery.trim() !== '') {
		startSearch(searchQuery, currentMatchKey(), true);
	}
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

/**
 * One column width per rebuild. The row font is monospace, so one font probe plus
 * character counts give every row's width without reading layout per row.
 */
function measureColumnWidth() {
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
	const next = diffColumnWidth(maxChars, chWidth, scroll.clientWidth / 2, 1600);
	if (next !== diffColumn) {
		diffColumn = next;
		writeVirtualStyle();
	}
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

function writeVirtualStyle() {
	const text =
		'#diff-top{height:' + Math.max(0, spacerTop) + 'px}' +
		'#diff-bottom{height:' + Math.max(0, spacerBottom) + 'px}' +
		(diffColumn > 0 ? '#diff-scroll{--diff-col:' + diffColumn + 'px}' : '');
	if (text === virtualStyleText) {
		return;
	}
	virtualStyleText = text;
	virtualStyle.textContent = text;
}

function setSpacers(top, bottom) {
	spacerTop = top;
	spacerBottom = bottom;
	writeVirtualStyle();
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
	appendHighlighted(label, cell.label, highlightQuery);
	line.appendChild(label);
	if (cell.kind === 'parameter' || cell.kind === 'reference') {
		line.appendChild(valueSpan(cell, true, highlightQuery));
	}
	if (cell.meta && cell.meta.length > 0) {
		line.appendChild(metaSpan(cell, highlightQuery));
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

function buildDiffRow(row, displayIndex) {
	const left = displayLeft(row);
	const right = displayRight(row);
	const status = displayStatus(row);
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
	element.dataset.status = status;
	if (row.key === selectedKey) {
		element.dataset.selected = 'true';
	}
	if (searchQuery.trim() !== '' && row.key === currentMatchKey()) {
		element.dataset.searchCurrent = 'true';
	}
	if (row.kind === 'module' && displayIndex > 0) {
		element.dataset.gap = 'true';
	}
	const owner = left || right;
	if (owner) {
		element.title = owner.definitionRef;
	}
	if (status !== 'unchanged') {
		const badge = document.createElement('span');
		badge.className = 'sr-only';
		badge.textContent = status;
		element.appendChild(badge);
	}
	element.appendChild(left ? buildDiffCell(left, 'left', row) : emptyCell('left'));
	element.appendChild(right ? buildDiffCell(right, 'right', row) : emptyCell('right'));
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
		vscode.postMessage({ type: 'reveal', side: hostSide(side), key: row.key });
	});
	return button;
}

function updateDetail() {
	detail.textContent = '';
	const row = selectedKey === undefined ? undefined : rowByKey.get(selectedKey);
	if (!row) {
		detail.appendChild(detailElement('p', 'detail-hint', 'Select a row to see its changes.'));
		return;
	}
	const left = displayLeft(row);
	const right = displayRight(row);
	const status = displayStatus(row);
	const owner = left || right;
	const head = detailElement('div', 'detail-head');
	head.appendChild(detailElement('span', 'detail-kind', row.kind));
	head.appendChild(detailElement('span', 'detail-label', owner ? owner.label : row.key));
	head.appendChild(detailElement('span', 'detail-status status-' + status, status));
	head.appendChild(detailElement('span', 'detail-spacer'));
	const actions = detailElement('div', 'detail-actions');
	if (left) {
		actions.appendChild(revealButton('left', row));
	}
	if (right) {
		actions.appendChild(revealButton('right', row));
	}
	if (actions.childNodes.length > 0) {
		head.appendChild(actions);
	}
	detail.appendChild(head);

	const fields = [];
	if (status === 'changed') {
		for (const change of row.changes.slice().sort(function (a, b) {
			return diffFieldRank(a.field) - diffFieldRank(b.field);
		})) {
			fields.push(
				swapped
					? { field: change.field, left: change.right, right: change.left }
					: { field: change.field, left: change.left, right: change.right }
			);
		}
	} else if (status === 'added' && right) {
		for (const entry of diffCellFields(right)) {
			fields.push({ field: entry.field, left: '', right: entry.text, missing: 'left' });
		}
	} else if (status === 'removed' && left) {
		for (const entry of diffCellFields(left)) {
			fields.push({ field: entry.field, left: entry.text, right: '', missing: 'right' });
		}
	}
	if (fields.length === 0) {
		const note = status === 'unchanged' ? 'No differences for this row.' : 'No fields to compare for this row.';
		detail.appendChild(detailElement('p', 'detail-note', note));
		return;
	}
	const labels = swapped
		? [diffDocument.labels[1], diffDocument.labels[0]]
		: diffDocument.labels;
	const paths = swapped
		? [diffDocument.right.path, diffDocument.left.path]
		: [diffDocument.left.path, diffDocument.right.path];
	const table = detailElement('div', 'detail-table');
	table.setAttribute('role', 'table');
	table.setAttribute('aria-label', labels[0] + ' versus ' + labels[1]);
	const headings = detailElement('div', 'detail-columns');
	headings.setAttribute('role', 'row');
	const rail = detailElement('span', 'detail-field');
	rail.setAttribute('role', 'columnheader');
	headings.appendChild(rail);
	const leftHead = detailElement('span', 'detail-side-head detail-left', labels[0]);
	leftHead.setAttribute('role', 'columnheader');
	leftHead.title = paths[0];
	headings.appendChild(leftHead);
	const rightHead = detailElement('span', 'detail-side-head detail-right', labels[1]);
	rightHead.setAttribute('role', 'columnheader');
	rightHead.title = paths[1];
	headings.appendChild(rightHead);
	table.appendChild(headings);
	for (const entry of fields) {
		const line = detailElement('div', 'detail-change');
		line.setAttribute('role', 'row');
		const field = detailElement('span', 'detail-field', diffFieldLabel(entry.field));
		field.setAttribute('role', 'rowheader');
		line.appendChild(field);
		line.appendChild(detailSideCell('detail-left', entry.left, entry.field, entry.missing === 'left'));
		line.appendChild(detailSideCell('detail-right', entry.right, entry.field, entry.missing === 'right'));
		table.appendChild(line);
	}
	detail.appendChild(table);
}

function detailSideCell(sideClass, text, field, missing) {
	const cell = detailElement('span', 'detail-side ' + sideClass + (missing ? ' detail-missing' : ''));
	cell.setAttribute('role', 'cell');
	if (missing) {
		cell.textContent = '— not in this file —';
	} else if (field === 'condition') {
		appendConditionTokens(cell, text);
	} else {
		cell.textContent = text;
	}
	return cell;
}

function renderHeaders() {
	const left = swapped ? diffDocument.right : diffDocument.left;
	const right = swapped ? diffDocument.left : diffDocument.right;
	const labels = swapped
		? [diffDocument.labels[1], diffDocument.labels[0]]
		: diffDocument.labels;
	if (leftLabel) {
		leftLabel.textContent = labels[0];
	}
	if (rightLabel) {
		rightLabel.textContent = labels[1];
	}
	if (leftHeader) {
		leftHeader.title = left.path;
	}
	if (rightHeader) {
		rightHeader.title = right.path;
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
	const scrollTop = scroll.scrollTop;
	refreshVisibility();
	rebuildDisplay();
	renderWindow(true);
	if (anchor && displayIndexByKey.has(anchor.key)) {
		restoreAnchor(anchor);
	} else {
		scroll.scrollTop = scrollTop;
	}
	renderWindow(true);
	updateSelection();
	updateEmptyState();
	updateDetail();
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
	updateDetail();
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
	updateViewButtons();
	renderHeaders();
	renderWindow(true);
	updateSelection();
	updateDetail();
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
	const fallback =
		!item &&
		selectedKey !== undefined &&
		(event.target === document.body || event.target.closest('#diff-detail') !== null);
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
	measureColumnWidth();
	renderWindow(true);
});
if (typeof ResizeObserver === 'function') {
	new ResizeObserver(function () {
		measureColumnWidth();
	}).observe(scroll);
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
updateViewButtons();
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
	--match-bg: rgba(234, 179, 8, 0.32);
	--match-hi: rgba(234, 179, 8, 0.7);
	--indent: 2ch;
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
.toolbar-slot {
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
#diff-scroll {
	flex: 1 1 auto;
	min-height: 0;
	overflow: auto;
	overflow-anchor: none;
	/* First paint, before the page measures the longest row. */
	--diff-col: 50vw;
}
.pane-headers {
	position: sticky;
	top: 0;
	z-index: 2;
	display: grid;
	grid-template-columns: var(--diff-col) var(--diff-col);
	width: calc(var(--diff-col) * 2);
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
	width: calc(var(--diff-col) * 2);
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
.ch-probe {
	position: absolute;
	left: 0;
	top: 0;
	white-space: pre;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	font-weight: var(--vscode-editor-font-weight, normal);
}
#diff-measure .diff-row,
#diff-measure .probe {
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.diff-row, .probe {
	display: grid;
	grid-template-columns: var(--diff-col) var(--diff-col);
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
	padding: 0 2px;
	border: 1px solid transparent;
	border-radius: 3px;
	color: var(--tok-meta);
}
.condition[data-state="false"] {
	border-color: var(--vscode-errorForeground, var(--diff-removed-edge));
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
.syscond-operator,
.syscond-literal {
	color: var(--tok-keyword);
}
.syscond-punct {
	color: var(--tok-punct);
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
	background: var(--match-bg);
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
#diff-detail {
	flex: none;
	max-height: 22vh;
	overflow: auto;
	padding: 6px 10px;
	border-top: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
	background: var(--vscode-editor-background);
	user-select: text;
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
.detail-spacer {
	flex: 1 1 auto;
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
.detail-table {
	display: flex;
	flex-direction: column;
	gap: 2px;
	margin-top: 6px;
}
.detail-columns,
.detail-change {
	display: grid;
	grid-template-columns: 14ch minmax(0, 1fr) minmax(0, 1fr);
	gap: 8px;
	align-items: baseline;
}
.detail-columns {
	position: sticky;
	top: 0;
	z-index: 1;
	background: var(--vscode-editor-background);
	padding-bottom: 2px;
}
.detail-side-head {
	font-weight: 600;
	color: var(--tok-dim);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.detail-field {
	color: var(--tok-dim);
}
.detail-side {
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
.detail-missing {
	color: var(--tok-dim);
	font-style: italic;
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
	.detail-columns,
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
