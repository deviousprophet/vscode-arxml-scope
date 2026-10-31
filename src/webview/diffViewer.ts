/**
 * The semantic-diff webview entrypoint.
 *
 * The host writes a static shell and posts the complete `DiffDocument`; the
 * page builds every row with `document.createElement` and `textContent`. Row
 * primitives and window math are imported from their one owner, so the editor
 * and the diff cannot disagree about a label, a value or a spacer.
 */
import './styles/tokens.css';
import './styles/base.css';
import type { DiffDocument, DiffRow } from '../core/diff/diffModel';
import {
	diffVisibility,
	flattenDiffDocument,
	nextChangeIndex,
	type DiffDisplayRow,
} from '../core/diff/diffModel';
import { calcRowOffset, calcVisibleRange } from './render/virtualScroll';
import {
	buildDocumentBraceRow,
	buildDocumentCommentRow,
	buildDocumentNodeRow,
} from './components/documentTree/documentRows';
import { DiffView } from './components/diffView/diffView';
import type { DocumentTreeHeader } from './components/documentTree/documentTreeView';
import { DiffToolbar } from './components/toolbar/toolbar';
import { SearchBar } from './components/searchBar/searchBar';
import { RowSearchEngine } from './render/rowSearch';
import { setHighlightQuery } from './render/rowView';
import { installNoticeErrors } from './render/pageError';
import { postToHost, resetVsCodeApi } from './vscodeApi';
import type { DiffProviderToWebview } from '../diffProtocol';

export type { DiffDocument, DiffProviderToWebview, DiffWebviewToProvider } from '../diffProtocol';

/** The rendered character width of one diff row: indent, label, value and meta. */
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

/** The rendered width of the longest row: monospace characters plus padding/slack. */
export function diffContentWidth(maxChars: number, chWidth: number): number {
	const safeChars = maxChars > 0 ? maxChars : 0;
	const safeChar = chWidth > 0 ? chWidth : 0;
	return Math.ceil(safeChars * safeChar) + 26 + 8;
}

/** The candidate rows for Search: the active view decides whether unchanged rows count. */
export function searchCandidatesFor(rows: readonly DiffRow[], changesOnly: boolean): DiffRow[] {
	return changesOnly ? rows.filter((row) => row.status !== 'unchanged') : rows.slice();
}

/** The pane headers for the displayed order; a swap follows. */
export function diffPaneHeaders(
	document: DiffDocument,
	swapped: boolean
): { left: DocumentTreeHeader; right: DocumentTreeHeader; labels: string[] } {
	const left = swapped ? document.right : document.left;
	const right = swapped ? document.left : document.right;
	const labels = swapped ? [document.labels[1], document.labels[0]] : document.labels;
	const leftHeader = headerOf(swapped ? document.rightHeader : document.leftHeader);
	const rightHeader = headerOf(swapped ? document.leftHeader : document.rightHeader);
	const lines = Math.max(headerLineCountOf(leftHeader), headerLineCountOf(rightHeader));
	return {
		left: { title: labels[0], titleTitle: left.path, schema: leftHeader.schema, packages: leftHeader.packages, lines },
		right: { title: labels[1], titleTitle: right.path, schema: rightHeader.schema, packages: rightHeader.packages, lines },
		labels,
	};
}


let list: any;
let notice: any;
let searchBar: SearchBar;
let toolbar: DiffToolbar;
let empty: any;
let emptyText: any;
let reportError: (text: string) => void = function () {};
const searchEngine = new RowSearchEngine();
let searchQuery = '';

let searchMatches: string[] = [];
let searchIndex = -1;
let searchRunning = false;
let searchFirstJumpDone = false;
let searchCandidates: DiffRow[] = [];
let showChangesOnly = false;
let swapped = false;
let diffDocument: DiffDocument = {
	left: { name: '', path: '' },
	right: { name: '', path: '' },
	labels: ['', ''],
	leftHeader: { packages: [] },
	rightHeader: { packages: [] },
	rows: [],
	summary: { changed: 0, added: 0, removed: 0, unchanged: 0 }
};
let rows: DiffRow[] = [];
let rowByKey = new Map<string, DiffRow>();
let rowIndexByKey = new Map<string, number>();
let collapsed = new Set<string>();
let selectedKey: string | undefined;
let focusKey: string | undefined;
let visibility: boolean[] = [];
let displayRows: DiffDisplayRow[] = [];
let displayIndexByKey = new Map<string, number>();
let navigationVisible: boolean[] = [];
let windowRange: [number, number] = [0, 0];
let renderedByKey = new Map<string, HTMLElement>();
let heights = { row: 20 };
let heightFn: (index: number) => number = function () { return heights.row; };
let diffContent = 0;
let headerLineCount = 0;
let views: DiffView | undefined;
function summaryOf(next: any): any {
	return next && next.summary ? next.summary : { changed: 0, added: 0, removed: 0, unchanged: 0 };
}
function hasChanges() {
	const summary = summaryOf(diffDocument);
	return summary.changed + summary.added + summary.removed > 0;
}
function headerOf(header: any): any {
	return header || { packages: [] };
}
function headerLineCountOf(header: any): number {
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
	const headers = diffPaneHeaders(diffDocument, swapped);
	headerLineCount = headers.left.lines ?? 0;
	if (!views) {
		return;
	}
	views.left.setHeader(headers.left);
	views.right.setHeader(headers.right);
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
function setDocument(next: any): void {
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
function documentOptions(flat: any, side: string): any {
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
function documentRowForCell(cell: any, row: any): any {
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
function stripDocumentNode(node: any): any {
	for (const name of ['role', 'aria-level', 'aria-posinset', 'aria-setsize', 'aria-selected', 'aria-expanded']) {
		node.removeAttribute(name);
	}
	node.tabIndex = -1;
	return node;
}
function carriesDiffGap(flat: any, displayIndex: number): boolean {
	const row = flat ? rows[flat.rowIndex] : undefined;
	const previous = displayIndex > 0 ? displayRows[displayIndex - 1] : undefined;
	return (
		!!row &&
		row.kind === 'module' &&
		displayIndex > 0 &&
		(!previous || previous.rowIndex !== flat.rowIndex)
	);
}
function displayLeft(row: any): any {
	return swapped ? row.right : row.left;
}
function displayRight(row: any): any {
	return swapped ? row.left : row.right;
}
function displayStatus(row: any): any {
	if (!swapped) {
		return row.status;
	}
	return row.status === 'added' ? 'removed' : row.status === 'removed' ? 'added' : row.status;
}
function hostSide(side: 'left' | 'right'): 'left' | 'right' {
	return swapped ? (side === 'left' ? 'right' : 'left') : side;
}
function renderRow(index: number, pane: string): any {
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
		const item = active.closest('[data-key]') as HTMLElement | null;
		if (item) {
			return item.dataset.key;
		}
	}
	return undefined;
}
function applyRoving(key: string | undefined): void {
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
function refocus(key: string | undefined): void {
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
function renderWindow(force?: boolean): void {
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
function ensureVisible(displayIndex: number): void {
	if (!views) {
		return;
	}
	views.left.scrollToIndex(displayIndex);
	// The sync callback runs on the next scroll event; copy now so a focus or
	// reveal shows the same window in both panes immediately.
	views.right.setScrollTop(views.left.getScrollTop());
}
function anchorState(scrollTop: number): any {
	return {
		rowCount: displayRows.length,
		rowHeight: heightFn,
		containerHeight: views ? views.left.clientHeight() : 0,
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
function restoreAnchor(anchor: any): void {
	if (!anchor || !views || !displayIndexByKey.has(anchor.key)) {
		return;
	}
	const index = displayIndexByKey.get(anchor.key);
	const state = anchorState(0);
	views.left.setRowsScrollTop(Math.max(0, calcRowOffset(index as number, state) + anchor.delta));
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
function setSearchBusy(busy: boolean): void {
	searchRunning = busy === true;
	renderSearchUi();
}
function searchIndexOfKey(key: string | undefined): number {
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
function jumpToSearchMatch(index: number): void {
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
function cycleSearch(direction: number): void {
	if (searchMatches.length === 0) {
		return;
	}
	searchIndex = (searchIndex + direction + searchMatches.length) % searchMatches.length;
	jumpToSearchMatch(searchIndex);
}
function startSearch(query: string, previousKey?: string, immediate?: boolean): void {
	const text = query || '';
	if (text.trim() === '') {
		resetSearchResults();
		return;
	}
	searchEngine.clear();
	searchQuery = text;
	setHighlightQuery(text);
	searchMatches = [];
	searchIndex = -1;
	searchFirstJumpDone = previousKey !== undefined;
	searchCandidates = searchCandidatesFor(rows, showChangesOnly);
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
	setHighlightQuery('');
	searchMatches = [];
	searchIndex = -1;
	searchCandidates = [];
	searchFirstJumpDone = false;
	setSearchBusy(false);
	renderWindow(true);
}
function executeSearch(direction: number): void {
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
function clearSearch(focusInput: boolean): void {
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
function setView(changesOnly: boolean): void {
	if (showChangesOnly === changesOnly) {
		return;
	}
	showChangesOnly = changesOnly;
	updateViewButtons();
	applyView();
}
function setSwapped(next: boolean): void {
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
function selectKey(key: string, shouldFocus?: boolean): void {
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
function expandAncestors(key: string): boolean {
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
function revealKey(key: string): void {
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
function gotoChange(direction: number): void {
	const from = selectedKey === undefined ? undefined : rowIndexByKey.get(selectedKey);
	const index = nextChangeIndex(rows, navigationVisible, from === undefined ? -1 : from, direction === -1 ? -1 : 1);
	if (index < 0) {
		return;
	}
	revealKey(rows[index].key);
}
function toggleCollapsed(key: string): void {
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
function nextNodeIndex(from: number, direction: number): number {
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
function moveSelection(offset: number): void {
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
function onKeyDown(event: any): void {
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
		postToHost({ type: 'reveal', side: side, key: key });
	} else if (event.key === ' ') {
		event.preventDefault();
		selectKey(key, true);
	}
}
function onPaneRowClick(index: number, event: any): void {
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
function syncPanes(pane: string, top: number, left: number): void {
	if (views) {
		views.syncPanes(pane, top, left);
	}
}
/** Bind the document-level gestures once the page refs exist. */
function mountDiffDomListeners(): void {
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
}
/** One host protocol message. */
export function handleDiffMessage(message: DiffProviderToWebview): void {
	if (!message) {
		return;
	}
	if (message.type === 'document') {
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
		showDiffError(message.message || 'The comparison could not be refreshed.');
	}
}

function showDiffError(message: string): void {
	notice.textContent = message;
	notice.dataset.kind = 'warn';
}

export function mountDiff(): void {
	resetDiffState();
	list = document.getElementById('diff-list');
	notice = document.getElementById('diff-notice');
	empty = document.getElementById('diff-empty');
	emptyText = document.getElementById('diff-empty-text');
	reportError = installNoticeErrors(document, window, {
		noticeId: 'diff-notice',
		label: 'The diff page failed',
	}).report;
	window.addEventListener('message', function (event) {
		handleDiffMessage(event.data as DiffProviderToWebview);
	});
	mountDiffDomListeners();
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
			setHighlightQuery(value);
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
renderWindow(true);
updateSelection();
updateViewButtons();
updateEmptyState();
postToHost({ type: 'ready' });
}

/** A page reload starts from the initial protocol state, exactly like a fresh bundle. */
function resetDiffState(): void {
	diffDocument = {
		left: { name: '', path: '' },
		right: { name: '', path: '' },
		labels: ['', ''],
		leftHeader: { packages: [] },
		rightHeader: { packages: [] },
		rows: [],
		summary: { changed: 0, added: 0, removed: 0, unchanged: 0 }
	};
	rows = [];
	rowByKey = new Map();
	rowIndexByKey = new Map();
	collapsed = new Set();
	selectedKey = undefined;
	focusKey = undefined;
	visibility = [];
	displayRows = [];
	displayIndexByKey = new Map();
	navigationVisible = [];
	windowRange = [0, 0];
	renderedByKey = new Map();
	heights = { row: 20 };
	heightFn = function () { return heights.row; };
	diffContent = 0;
	headerLineCount = 0;
	views = undefined;
	searchQuery = '';
	searchMatches = [];
	searchIndex = -1;
	searchCandidates = [];
	searchRunning = false;
	searchFirstJumpDone = false;
	showChangesOnly = false;
	swapped = false;
	resetVsCodeApi();
	setHighlightQuery('');
}

if (typeof document !== 'undefined' && document.getElementById('diff-list')) {
	mountDiff();
}
