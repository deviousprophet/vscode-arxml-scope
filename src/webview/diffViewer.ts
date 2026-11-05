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
import type { DiffCell, DiffDocument, DiffRow } from '../core/diff/diffModel';
import {
	diffVisibility,
	flattenDiffDocument,
	nextChangeIndex,
	type DiffDisplayRow,
} from '../core/diff/diffModel';
import { diffWords, type WordPair } from '../core/diff/wordDiff';
import type { MetaPart } from '../core/ecuc/renderRows';
import { buildOffsets, totalHeightOf } from './render/virtualScroll';
import {
	buildDocumentBraceRow,
	buildDocumentCommentRow,
	buildDocumentNodeRow,
	WORD_DIFF_META_CLASSES,
	type DocumentWordDiff,
} from './components/documentTree/documentRows';
import { DiffView } from './components/diffView/diffView';
import type { DocumentTreeHeader } from './components/documentTree/documentTreeView';
import { DiffToolbar } from './components/toolbar/toolbar';
import { SearchBar } from './components/searchBar/searchBar';
import { RowSearchEngine } from './render/rowSearch';
import { appendHighlighted, setHighlightQuery } from './render/rowView';
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
interface DiffSearchCandidate {
	key: string;
	haystack: string;
}

let searchCandidates: DiffSearchCandidate[] = [];
let showChangesOnly = false;
let swapped = false;
let diffDocument: DiffDocument = {
	left: { name: '', path: '' },
	right: { name: '', path: '' },
	labels: ['', ''],
	leftHeader: { packages: [] },
	rightHeader: { packages: [] },
	rows: [],
	summary: { changed: 0, added: 0, removed: 0, unchanged: 0, renamed: 0 }
};
let rows: DiffRow[] = [];
let semanticMatching = true;
/** Unchanged rows kept above and below each change in Show diff. */
const CONTEXT_LINES = 5;
let contextActive = true;
let expandedGaps = new Set<string>();
let rowByKey = new Map<string, DiffRow>();
let rowIndexByKey = new Map<string, number>();
let collapsed = new Set<string>();
let selectedKey: string | undefined;
let focusKey: string | undefined;
let rowsRevision = 0;
let subtreeCache: { key: string | undefined; revision: number; ids: Set<string> } | undefined;
let visibility: boolean[] = [];
let displayRows: DiffDisplayRow[] = [];
let displayIndexByKey = new Map<string, number>();
let navigationVisible: boolean[] = [];
let windowRange: [number, number] = [0, 0];
let renderedByKey = new Map<string, HTMLElement>();
let heights = { row: 20 };
let heightFn: (index: number) => number = function () { return heights.row; };
let offsets: number[] = [0];
let diffContent = 0;
let headerRowCount = 0;
let headerRows: Array<{ left?: { keyword: string; text: string }; right?: { keyword: string; text: string } }> = [];
let views: DiffView | undefined;
let loaded = false;
function hasChanges() {
	const summary = diffDocument.summary ?? { changed: 0, added: 0, removed: 0, unchanged: 0, renamed: 0 };
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
	visibility = diffVisibility(rows, showChangesOnly, contextActive ? CONTEXT_LINES : 0);
}
function buildHeightFn() {
	const base = heights.row;
	// Diff rows are uniform: the Document-only module gap is not part of the
	// comparison surface, so a module row is exactly one base row high.
	heightFn = function () {
		return base;
	};
	offsets = buildOffsets(headerRowCount + displayRows.length, heightFn);
}
function rebuildDisplay() {
	displayRows = flattenDiffDocument(rows, {
		collapsed: collapsed,
		visible: visibility,
		expandedGaps: expandedGaps
	});
	displayIndexByKey = new Map();
	navigationVisible = new Array(rows.length).fill(false);
	for (let at = 0; at < displayRows.length; at++) {
		const flat = displayRows[at];
		if (flat.left !== 'node' && flat.right !== 'node') {
			continue;
		}
		const row = rows[flat.rowIndex];
		displayIndexByKey.set(row.key, headerRowCount + at);
		navigationVisible[flat.rowIndex] = true;
	}
	if (!hasChanges()) {
		// Two files with no semantic differences show the empty state, not a
		// full tree of unchanged rows.
		displayRows = [];
		displayIndexByKey = new Map();
		navigationVisible = new Array(rows.length).fill(false);
	}
	buildHeightFn();
}
function headerLines(header: any): Array<{ keyword: string; text: string }> {
	const value = headerOf(header);
	const out: Array<{ keyword: string; text: string }> = [];
	if (value.schema) {
		out.push({ keyword: 'schema', text: value.schema });
	}
	for (const pkg of Array.isArray(value.packages) ? value.packages : []) {
		out.push({ keyword: 'package', text: pkg });
	}
	return out;
}
function buildHeaderRows(): void {
	const left = headerLines(swapped ? diffDocument.rightHeader : diffDocument.leftHeader);
	const right = headerLines(swapped ? diffDocument.leftHeader : diffDocument.rightHeader);
	const count = Math.max(left.length, right.length);
	headerRows = [];
	for (let at = 0; at < count; at++) {
		headerRows.push({ left: left[at], right: right[at] });
	}
	headerRowCount = headerRows.length;
}
function renderHeaders() {
	const headers = diffPaneHeaders(diffDocument, swapped);
	buildHeaderRows();
	if (!views) {
		return;
	}
	views.setHeader(headers);
}
function paneModel() {
	return {
		rowCount: headerRowCount + displayRows.length,
		offsets: offsets,
		renderRow: renderRow,
		contentWidth: diffContent
	};
}
function applyModels() {
	if (!views) {
		return;
	}
	views.setModel(paneModel());
	views.setContent({
		rowCount: headerRowCount + displayRows.length,
		offsets: offsets,
		totalHeight: totalHeightOf(offsets),
		contentWidth: diffContent,
		contentWidths: [diffContent, diffContent]
	});
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
	loaded = true;
	expandedGaps = new Set();
	rowsRevision++;
	subtreeCache = undefined;
	indexRows();
	const present = new Set(rows.map(function (row) { return row.key; }));
	collapsed = new Set(Array.from(collapsed).filter(function (key) { return present.has(key); }));
	if (selectedKey !== undefined && !rowByKey.has(selectedKey)) {
		selectedKey = undefined;
	}
	if (focusKey !== undefined && !rowByKey.has(focusKey)) {
		focusKey = selectedKey;
	}
	buildHeaderRows();
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
		views.setContentWidth(diffContent);
	}
}
function selectedSubtreeIds(): Set<string> {
	if (subtreeCache && subtreeCache.key === selectedKey && subtreeCache.revision === rowsRevision) {
		return subtreeCache.ids;
	}
	const ids = new Set<string>();
	const at = selectedKey === undefined ? undefined : rowIndexByKey.get(selectedKey);
	if (at !== undefined) {
		const end = Math.min(rows.length, at + 1 + Math.max(0, rows[at].subtreeSize));
		for (let index = at; index < end; index++) {
			ids.add(rows[index].key);
		}
	}
	subtreeCache = { key: selectedKey, revision: rowsRevision, ids };
	return ids;
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
		subtreeIds: selectedSubtreeIds(),
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
	for (const name of ['role', 'aria-level', 'aria-posinset', 'aria-setsize', 'aria-selected']) {
		node.removeAttribute(name);
	}
	// Keep aria-expanded: the shared document CSS uses it for the live chevron
	// and the collapsed { ... } marker in both panes.
	node.tabIndex = -1;
	return node;
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
/** Every meta part text of one class, in display order. */
function metaPartTexts(cell: DiffCell | undefined, cls: MetaPart['cls']): string[] {
	if (!cell) {
		return [];
	}
	const texts: string[] = [];
	for (const part of cell.meta) {
		if (part.cls === cls) {
			texts.push(part.text);
		}
	}
	return texts;
}
/**
 * The word pairs for the fields a changed row actually shows, on the displayed
 * sides. Meta chips pair by index, so repeated chips of one class stay aligned.
 * Added and removed rows return nothing: their full-cell tint already says the
 * whole line is new or gone, and an unchanged row renders as before.
 */
function wordDiffForRow(row: DiffRow): DocumentWordDiff | undefined {
	if (displayStatus(row) !== 'changed') {
		return undefined;
	}
	const left = displayLeft(row);
	const right = displayRight(row);
	if (!left || !right) {
		return undefined;
	}
	const meta: DocumentWordDiff['meta'] = {};
	for (const cls of WORD_DIFF_META_CLASSES) {
		const leftTexts = metaPartTexts(left, cls);
		const rightTexts = metaPartTexts(right, cls);
		const pairs: WordPair[] = [];
		for (let at = 0; at < Math.min(leftTexts.length, rightTexts.length); at++) {
			pairs.push(diffWords(leftTexts[at], rightTexts[at]));
		}
		if (pairs.length > 0) {
			meta[cls] = pairs;
		}
	}
	return {
		label: diffWords(left.label || '', right.label || ''),
		value: diffWords(left.shownValue || '', right.shownValue || ''),
		meta,
	};
}
function renderHeaderRow(index: number, pane: string): any {
	const side = pane === 'left' ? 'left' : 'right';
	const header = headerRows[index];
	const line = header ? (side === 'left' ? header.left : header.right) : undefined;
	const element = document.createElement('div');
	element.className = 'diff-row diff-header-row';
	element.dataset.side = side;
	element.dataset.key = 'header:' + index;
	element.setAttribute('role', 'presentation');
	element.tabIndex = -1;
	const cell = document.createElement('div');
	cell.className = 'diff-cell diff-header-cell';
	cell.dataset.side = side;
	if (line) {
		const row = document.createElement('div');
		row.className = 'row document-tree-header-row';
		const key = document.createElement('span');
		key.className = 'keyword';
		key.textContent = line.keyword;
		row.appendChild(key);
		row.appendChild(document.createTextNode(' '));
		const value = document.createElement('span');
		value.className = line.keyword === 'schema' ? 'number' : 'package';
		appendHighlighted(value, line.text, searchQuery);
		row.appendChild(value);
		cell.appendChild(row);
		if (searchQuery.trim() !== '' && currentMatchKey() === element.dataset.key) {
			element.dataset.searchCurrent = 'true';
		}
	} else {
		cell.dataset.headerEmpty = 'true';
	}
	element.appendChild(cell);
	return element;
}
function renderRow(index: number, pane: string): any {
	if (index < headerRowCount) {
		return renderHeaderRow(index, pane);
	}
	const flat = displayRows[index - headerRowCount];
	const element = document.createElement('div');
	element.className = 'diff-row';
	if (!flat) {
		return element;
	}
	const side = pane === 'left' ? 'left' : 'right';
	const cell = document.createElement('div');
	cell.className = 'diff-cell';
	cell.dataset.side = side;
	element.dataset.side = side;
	const gapInfo = flat.gap;
	if (gapInfo) {
		element.classList.add('diff-gap-row');
		element.dataset.gapKey = gapInfo.key;
		const gap = document.createElement('div');
		gap.className = 'diff-gap';
		if (side === 'left') {
			const button = document.createElement('button');
			button.className = 'diff-gap-toggle';
			button.type = 'button';
			button.dataset.gapKey = gapInfo.key;
			button.setAttribute('aria-expanded', gapInfo.expanded ? 'true' : 'false');
			const label = `${gapInfo.count} unchanged line${gapInfo.count === 1 ? '' : 's'}`;
			button.setAttribute('aria-label', `${gapInfo.expanded ? 'Hide' : 'Show'} ${label}`);
			const chevron = document.createElement('span');
			chevron.className = 'diff-gap-chevron';
			chevron.setAttribute('aria-hidden', 'true');
			chevron.textContent = gapInfo.expanded ? '▾' : '▸';
			button.appendChild(chevron);
			button.appendChild(document.createTextNode(label));
			gap.appendChild(button);
		} else {
			element.setAttribute('aria-hidden', 'true');
		}
		const line = document.createElement('span');
		line.className = 'diff-gap-line';
		gap.appendChild(line);
		cell.appendChild(gap);
		element.appendChild(cell);
		return element;
	}
	const row = rows[flat.rowIndex];
	// The display list is in comparison-side order. A swap changes which kind
	// belongs to the displayed pane, including braces/comments, so read the
	// displayed side rather than always the comparison left.
	const kind = side === 'left' ? (swapped ? flat.right : flat.left) : swapped ? flat.left : flat.right;
	const leftKind = swapped ? flat.right : flat.left;
	const rightKind = swapped ? flat.left : flat.right;
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
						selectedId: row.key === selectedKey ? row.key : undefined,
						wordDiff: wordDiffForRow(row),
						wordSide: side
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
	} else if (kind === 'brace-open' || kind === 'brace-close') {
		cell.appendChild(buildDocumentBraceRow(kind, flat.level, row.key, options));
	}
	element.appendChild(cell);
	return element;
}
function focusedKey() {
	if (typeof document === 'undefined') {
		return undefined;
	}
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
	if (typeof document === 'undefined') {
		return;
	}
	// Keep the list's layout state in step with the row list before the
	// component measures its scroll region.
	list.hidden = displayRows.length === 0;
	if (!views) {
		return;
	}
	const previousFocus = focusedKey();
	const viewport = views.scroll ? views.scroll.getViewport() : { top: 0, left: 0, height: 0, width: 0 };
	views.render(viewport, force === true);
	windowRange = views.getVisibleRange();
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
	views.scrollToIndex(displayIndex);
}
function virtualKeyAt(index: number): string | undefined {
	if (index < 0) {
		return undefined;
	}
	if (index < headerRowCount) {
		return 'header:' + index;
	}
	const flat = displayRows[index - headerRowCount];
	return flat ? rows[flat.rowIndex].key : undefined;
}
function virtualIndexForKey(key: string | undefined): number | undefined {
	if (key === undefined) {
		return undefined;
	}
	if (key.startsWith('header:')) {
		const index = Number(key.slice('header:'.length));
		return Number.isFinite(index) ? index : undefined;
	}
	return displayIndexByKey.get(key);
}
function captureAnchor() {
	if (!views || headerRowCount + displayRows.length === 0) {
		return null;
	}
	const top = views.getScrollTop();
	const range = views.getVisibleRange();
	let index = range[0];
	while (index < headerRowCount + displayRows.length) {
		if (index >= headerRowCount && displayRows[index - headerRowCount]?.gap) {
			index++;
			continue;
		}
		break;
	}
	const key = virtualKeyAt(index);
	if (key === undefined) {
		return null;
	}
	return { key: key, delta: top - (offsets[index] ?? 0) };
}
function restoreAnchor(anchor: any): void {
	if (!anchor || !views) {
		return;
	}
	const index = virtualIndexForKey(anchor.key);
	if (index === undefined) {
		return;
	}
	views.setScrollTop(Math.max(0, (offsets[index] ?? 0) + anchor.delta));
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
		toolbar.setMatchMode(semanticMatching);
		toolbar.setContext(contextActive);
	}
}
function updateEmptyState() {
	const none = displayRows.length === 0;
	list.hidden = none;
	empty.hidden = !none;
	if (!none) {
		delete empty.dataset.busy;
		empty.removeAttribute('aria-busy');
		return;
	}
	if (!loaded) {
		empty.dataset.busy = 'true';
		empty.setAttribute('aria-busy', 'true');
		emptyText.textContent = 'Loading comparison…';
		return;
	}
	delete empty.dataset.busy;
	empty.removeAttribute('aria-busy');
	emptyText.textContent = hasChanges() ? 'No rows.' : 'No differences';
}
function applyView() {
	const anchor = captureAnchor();
	const scrollTop = views ? views.getScrollTop() : 0;
	refreshVisibility();
	rebuildDisplay();
	applyModels();
	renderWindow(true);
	if (anchor && virtualIndexForKey(anchor.key) !== undefined) {
		restoreAnchor(anchor);
	} else if (views) {
		views.setScrollTop(scrollTop);
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
function buildDiffSearchCandidates(): DiffSearchCandidate[] {
	const out: DiffSearchCandidate[] = [];
	for (let at = 0; at < headerRowCount; at++) {
		const row = headerRows[at];
		const parts: string[] = [];
		if (row.left) {
			parts.push(row.left.keyword + ' ' + row.left.text);
		}
		if (row.right) {
			parts.push(row.right.keyword + ' ' + row.right.text);
		}
		out.push({ key: 'header:' + at, haystack: parts.join(' ').toLowerCase() });
	}
	for (const row of searchCandidatesFor(rows, showChangesOnly)) {
		out.push({ key: row.key, haystack: row.haystack });
	}
	return out;
}
function jumpToSearchMatch(index: number): void {
	const key = searchMatches[index];
	if (key === undefined) {
		return;
	}
	if (key.startsWith('header:')) {
		const headerIndex = Number(key.slice('header:'.length));
		if (!Number.isFinite(headerIndex)) {
			return;
		}
		ensureVisible(headerIndex);
		renderWindow(true);
		const element = views ? views.left.elementAt(headerIndex) : undefined;
		if (element) {
			element.tabIndex = 0;
			element.focus({ preventScroll: true });
		}
		updateSelection();
		renderSearchUi();
		searchBar.focus();
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
	searchCandidates = buildDiffSearchCandidates();
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
function setContext(active: boolean): void {
	if (contextActive === active) {
		toolbar.setContext(active);
		return;
	}
	contextActive = active;
	toolbar.setContext(active);
	applyView();
}
function setSwapped(next: boolean): void {
	swapped = next === true;
	if (views) {
		// Swap resets horizontal only; the vertical position is preserved.
		views.resetHorizontal();
	}
	updateViewButtons();
	renderHeaders();
	applyModels();
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
function toggleGap(key: string): void {
	const scrollTop = views ? views.getScrollTop() : 0;
	const next = new Set(expandedGaps);
	if (next.has(key)) {
		next.delete(key);
	} else {
		next.add(key);
	}
	expandedGaps = next;
	rebuildDisplay();
	applyModels();
	if (views) {
		views.setScrollTop(scrollTop);
	}
	renderWindow(true);
	updateSelection();
	const button = Array.from(document.querySelectorAll('#diff-pane-left .diff-gap-toggle')).find(
		(candidate) => (candidate as HTMLElement).dataset.gapKey === key
	) as HTMLElement | undefined;
	if (button) {
		button.focus({ preventScroll: true });
	}
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
	const virtualAt = selectedKey === undefined ? undefined : displayIndexByKey.get(selectedKey);
	let at = virtualAt === undefined ? undefined : virtualAt - headerRowCount;
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
	const virtualAt = displayIndexByKey.get(selectedKey);
	if (virtualAt === undefined) {
		return undefined;
	}
	const at = virtualAt - headerRowCount;
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
	if (index < headerRowCount) {
		const header = event && event.target && event.target.closest ? event.target.closest('.diff-header-row') : null;
		if (header && typeof header.focus === 'function') {
			header.tabIndex = 0;
			header.focus({ preventScroll: true });
		}
		return;
	}
	const flat = displayRows[index - headerRowCount];
	if (!flat) {
		return;
	}
	if (flat.gap) {
		toggleGap(flat.gap.key);
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
		semanticMatching = message.semantic !== false;
		const anchor = captureAnchor();
		const scrollTop = views ? views.getScrollTop() : 0;
		setDocument(message.document);
		renderWindow(true);
		if (anchor && virtualIndexForKey(anchor.key) !== undefined) {
			restoreAnchor(anchor);
		} else if (views) {
			views.setScrollTop(scrollTop);
		}
		renderWindow(true);
		updateSelection();
		updateEmptyState();
	} else if (message.type === 'matchModeState') {
		semanticMatching = message.semantic !== false;
		updateViewButtons();
	} else if (message.type === 'error') {
		showDiffError(message.message || 'The comparison could not be refreshed.');
		// A failed switch or fallback refresh must not leave the toolbar pending.
		updateViewButtons();
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
	},
	onViewportChange: function () {
		windowRange = views ? views.getVisibleRange() : [0, 0];
		const key = focusedKey();
		if (key !== undefined) {
			applyRoving(key);
		}
	}
});
views.mount();
toolbar = new DiffToolbar({
	onViewAll: function () { setView(false); },
	onViewDiff: function () { setView(true); },
	onPrev: function () { gotoChange(-1); },
	onNext: function () { gotoChange(1); },
	onSwap: function () { setSwapped(!swapped); },
	onMatchMode: function (semantic: boolean) {
		semanticMatching = semantic;
		// Confirm the click before the host has rebuilt anything; the document or
		// matchModeState message clears the pending state.
		toolbar.setMatchMode(semantic, true);
		postToHost({ type: 'matchMode', semantic });
	},
	onContext: function (active: boolean) {
		setContext(active);
	}
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
		summary: { changed: 0, added: 0, removed: 0, unchanged: 0, renamed: 0 }
	};
	rows = [];
	rowByKey = new Map();
	rowIndexByKey = new Map();
	rowsRevision++;
	subtreeCache = undefined;
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
	offsets = [0];
	diffContent = 0;
	headerRowCount = 0;
	headerRows = [];
	views = undefined;
	loaded = false;
	searchQuery = '';
	searchMatches = [];
	searchIndex = -1;
	searchCandidates = [];
	searchRunning = false;
	searchFirstJumpDone = false;
	showChangesOnly = false;
	swapped = false;
	contextActive = true;
	expandedGaps = new Set();
	resetVsCodeApi();
	setHighlightQuery('');
}

if (typeof document !== 'undefined' && document.getElementById('diff-list')) {
	mountDiff();
}
