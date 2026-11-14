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
import type { DiffCell, DiffDocument, DiffHeader, DiffRow } from '../core/diff/diffModel';
import {
	diffVisibility,
	flattenDiffDocument,
	nextChangeIndex,
	type DiffDisplayRow,
} from '../core/diff/diffModel';
import { diffWords, type WordPair } from '../core/diff/wordDiff';
import { applyDiffPatch } from '../core/diff/diffPatch';
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
import type {
	DocumentTreeHeader,
	DocumentTreeLineInfo,
	DocumentTreeView,
} from './components/documentTree/documentTreeView';
import { DiffToolbar } from './components/toolbar/toolbar';
import type { SearchBar } from './components/searchBar/searchBar';
import { RowSearchEngine } from './render/rowSearch';
import {
	beginSearch,
	finishSearch,
	mountSearchBar,
	renderSearchCount,
	retainedSearchIndex,
} from './render/searchState';
import { appendHighlighted, setHighlightQuery } from './render/rowView';
import { installNoticeErrors } from './render/pageError';
import { postToHost, resetVsCodeApi } from './vscodeApi';
import type { DiffProviderToWebview } from '../diffProtocol';

export type { DiffDocument, DiffProviderToWebview, DiffWebviewToProvider } from '../diffProtocol';

/** The rendered character width of one diff row: indent, label, value and meta. */
function cellChars(row: DiffRow, cell: DiffCell): number {
	let chars = 3 + 4 * (row.level - 1) + cell.label.length;
	chars += kindChars(cell);
	for (const part of cell.meta) {
		chars += part.text.length + 1;
	}
	return chars;
}

/** The extra characters a cell kind adds beyond its label. */
function kindChars(cell: DiffCell): number {
	if (cell.kind === 'module') {
		// `.k-module .label::before` renders "module ".
		return 7;
	}
	if (!isValueCell(cell)) {
		return 0;
	}
	return valueChars(cell);
}

function isValueCell(cell: DiffCell): boolean {
	return cell.kind === 'parameter' || cell.kind === 'reference';
}

function valueChars(cell: DiffCell): number {
	// `valueSpan` always renders "= " before the value, plus one row gap.
	const shown = cell.shownValue === undefined ? 0 : cell.shownValue.length;
	return 3 + shown;
}

export function diffRowChars(row: DiffRow): number {
	let widest = 0;
	for (const cell of [row.left, row.right]) {
		if (cell) {
			widest = Math.max(widest, cellChars(row, cell));
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

const LIMITED_NOTICE: Record<'budget' | 'fallback', (count: number, noun: string, was: string) => string> = {
	budget: (count, noun, was) =>
		`${count} ${noun} ${was} left unmatched because the comparison reached its work budget.`,
	fallback: (count, noun) => `${count} ${noun} in a large group could not be matched semantically.`,
};

/** The candidate rows for Search: the active view decides whether unchanged rows count. */
export function searchCandidatesFor(rows: readonly DiffRow[], changesOnly: boolean): DiffRow[] {
	return changesOnly ? rows.filter((row) => row.status !== 'unchanged') : rows.slice();
}

/** The pane headers for the displayed order; a swap follows. */
function orderedPanes(document: DiffDocument, swapped: boolean) {
	const sides: [DiffDocument['left'], DiffDocument['right']] = swapped
		? [document.right, document.left]
		: [document.left, document.right];
	const headers: [DiffHeader, DiffHeader] = swapped
		? [document.rightHeader, document.leftHeader]
		: [document.leftHeader, document.rightHeader];
	return { sides, headers };
}

export function diffPaneHeaders(
	document: DiffDocument,
	swapped: boolean
): { left: DocumentTreeHeader; right: DocumentTreeHeader; labels: string[] } {
	const { sides, headers } = orderedPanes(document, swapped);
	const [left, right] = sides;
	const labels: string[] = swapped ? [document.labels[1], document.labels[0]] : document.labels;
	const leftHeader = headerOf(headers[0]);
	const rightHeader = headerOf(headers[1]);
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
let semanticSkip: HTMLElement | null;
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
/** A fresh empty document; the page starts and reloads from this exact shape. */
function emptyDiffDocument(): DiffDocument {
	return {
		left: { name: '', path: '' },
		right: { name: '', path: '' },
		labels: ['', ''],
		leftHeader: { packages: [] },
		rightHeader: { packages: [] },
		rows: [],
		summary: { changed: 0, added: 0, removed: 0, unchanged: 0, renamed: 0 },
		semanticSkipped: 0
	};
}

let diffDocument: DiffDocument = emptyDiffDocument();
let rows: DiffRow[] = [];
let semanticMatching = true;
/** Unchanged rows kept above and below each change in Show diff. */
const CONTEXT_LINES = 5;
/** Accessible description for a collapsed container with hidden changes. */
const SUBTREE_CHANGED_DESCRIPTION = 'Contains hidden changes';
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
/** Per source row: does its subtree hold a changed row? Recomputed per display rebuild. */
let descendantChanged: boolean[] = [];
let displayIndexByKey = new Map<string, number>();
let navigationVisible: boolean[] = [];
let windowRange: [number, number] = [0, 0];
let renderedByKey = new Map<string, HTMLElement>();
let heights = { row: 20 };
let heightFn: (index: number) => number = function () { return heights.row; };
let offsets: number[] = [0];
let diffContent = 0;
let chWidth = 0;
let headerRowCount = 0;
let headerGapCount = 0;
type HeaderLine = { keyword: string; text: string };
type HeaderRow = { left?: HeaderLine; right?: HeaderLine };
let headerRows: HeaderRow[] = [];
/** Per-pane display line numbers, aligned with the virtual rows. */
let lineNumbers: { left: Array<number | undefined>; right: Array<number | undefined> } = { left: [], right: [] };
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
function contentRowStart(): number {
	return headerRowCount + headerGapCount;
}
function buildHeightFn() {
	const base = heights.row;
	// Diff rows are uniform: the shared module gap is one real display row, so
	// it is exactly one base row high like every other line.
	heightFn = function () {
		return base;
	};
	offsets = buildOffsets(contentRowStart() + displayRows.length, heightFn);
}
function isNodeDisplay(flat: DiffDisplayRow): boolean {
	return flat.left === 'node' || flat.right === 'node';
}

function indexDisplayRows(): void {
	displayIndexByKey = new Map();
	navigationVisible = new Array(rows.length).fill(false);
	for (let at = 0; at < displayRows.length; at++) {
		const flat = displayRows[at];
		if (!isNodeDisplay(flat)) {
			continue;
		}
		const row = rows[flat.rowIndex];
		displayIndexByKey.set(row.key, contentRowStart() + at);
		navigationVisible[flat.rowIndex] = true;
	}
}

function clearEmptyDisplay(): void {
	displayRows = [];
	displayIndexByKey = new Map();
	navigationVisible = new Array(rows.length).fill(false);
}

function rebuildDisplay() {
	descendantChanged = buildDescendantChanged(rows);
	displayRows = flattenDiffDocument(rows, {
		collapsed: collapsed,
		visible: visibility,
		expandedGaps: expandedGaps,
		moduleGaps: true
	});
	indexDisplayRows();
	if (!hasChanges()) {
		// Two files with no semantic differences show the empty state, not a
		// full tree of unchanged rows.
		clearEmptyDisplay();
	}
	buildHeightFn();
}
/** Prefix counts of non-unchanged rows, so a subtree range is one subtraction. */
function changedPrefix(source: readonly DiffRow[]): number[] {
	const prefix: number[] = [0];
	for (const row of source) {
		prefix.push(prefix[prefix.length - 1] + (row.status === 'unchanged' ? 0 : 1));
	}
	return prefix;
}
function subtreeEnd(source: readonly DiffRow[], at: number): number {
	return Math.min(source.length, at + 1 + Math.max(0, source[at].subtreeSize));
}
function subtreeHasChange(prefix: readonly number[], at: number, end: number): boolean {
	return end > at + 1 && prefix[end] > prefix[at + 1];
}
/**
 * Linear over the merged rows: a descendant changed when any row in
 * `(at, at + subtreeSize]` is not `unchanged`. Added, removed, semantically
 * matched and word-changed rows all carry a non-unchanged status, so this one
 * predicate covers every change class.
 */
function buildDescendantChanged(source: readonly DiffRow[]): boolean[] {
	const prefix = changedPrefix(source);
	const flags: boolean[] = new Array(source.length).fill(false);
	for (let at = 0; at < source.length; at++) {
		flags[at] = subtreeHasChange(prefix, at, subtreeEnd(source, at));
	}
	return flags;
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
	headerGapCount = Math.min(1, headerRowCount);
}
function renderHeaders() {
	const headers = diffPaneHeaders(diffDocument, swapped);
	buildHeaderRows();
	if (!views) {
		return;
	}
	views.setHeader(headers);
}
/**
 * Number each pane's own display lines. Headers number per owning side, the
 * blank header gap is a line on both sides, a hidden unchanged run is not a
 * line, and a blank cell on one side leaves that gutter empty.
 */
interface GutterCounts {
	left: number;
	right: number;
}

function bumpLine(numbers: Array<number | undefined>, index: number, current: number): number {
	numbers[index] = current + 1;
	return current + 1;
}

function numberHeaderLine(row: HeaderRow | undefined, index: number, counts: GutterCounts): void {
	if (!row) {
		return;
	}
	if (row.left) {
		counts.left = bumpLine(lineNumbers.left, index, counts.left);
	}
	if (row.right) {
		counts.right = bumpLine(lineNumbers.right, index, counts.right);
	}
}

function numberHeaderLines(counts: GutterCounts): void {
	for (let index = 0; index < headerRowCount; index++) {
		numberHeaderLine(headerRows[index], index, counts);
	}
}

function numberHeaderGap(counts: GutterCounts): void {
	if (headerGapCount <= 0) {
		return;
	}
	const gapIndex = headerRowCount;
	counts.left = bumpLine(lineNumbers.left, gapIndex, counts.left);
	counts.right = bumpLine(lineNumbers.right, gapIndex, counts.right);
}

function numberDisplayLine(
	kind: DiffDisplayRow['left'],
	numbers: Array<number | undefined>,
	index: number,
	current: number
): number {
	if (kind === 'blank' || kind === 'gap') {
		return current;
	}
	return bumpLine(numbers, index, current);
}

function numberDisplayRow(flat: DiffDisplayRow, index: number, counts: GutterCounts): void {
	if (flat.gap) {
		return;
	}
	if (flat.moduleGap) {
		counts.left = bumpLine(lineNumbers.left, index, counts.left);
		counts.right = bumpLine(lineNumbers.right, index, counts.right);
		return;
	}
	counts.left = numberDisplayLine(flatLeft(flat), lineNumbers.left, index, counts.left);
	counts.right = numberDisplayLine(flatRight(flat), lineNumbers.right, index, counts.right);
}

function numberDisplayRows(counts: GutterCounts): void {
	for (let at = 0; at < displayRows.length; at++) {
		numberDisplayRow(displayRows[at], contentRowStart() + at, counts);
	}
}

function buildLineNumbers(): void {
	const total = contentRowStart() + displayRows.length;
	lineNumbers = { left: new Array(total), right: new Array(total) };
	const counts: GutterCounts = { left: 0, right: 0 };
	numberHeaderLines(counts);
	numberHeaderGap(counts);
	numberDisplayRows(counts);
}

/** The gutter state for one virtual row: a number, plus the node's diff tint. */
function gutterFor(pane: string): Array<number | undefined> {
	return pane === 'left' ? lineNumbers.left : lineNumbers.right;
}

function visibleFlatAt(index: number): DiffDisplayRow | undefined {
	if (index < contentRowStart()) {
		return undefined;
	}
	return displayRows[index - contentRowStart()];
}

function lineInfoWithStatus(number: number, index: number, pane: string): DocumentTreeLineInfo {
	const flat = visibleFlatAt(index);
	const kind = flat ? displayKind(flat, pane) : undefined;
	if (!flat || kind !== 'node') {
		return { number };
	}
	return { number, status: displayStatus(rows[flat.rowIndex]) };
}

function lineInfoFor(index: number, pane: string): DocumentTreeLineInfo | undefined {
	const number = gutterFor(pane)[index];
	if (number === undefined) {
		return undefined;
	}
	return lineInfoWithStatus(number, index, pane);
}

function paneModel() {
	return {
		rowCount: contentRowStart() + displayRows.length,
		offsets: offsets,
		renderRow: renderRow,
		contentWidth: diffContent,
		lineInfo: lineInfoFor,
		activeLine: function () {
			return selectedKey === undefined ? undefined : displayIndexByKey.get(selectedKey);
		}
	};
}
/**
 * The window floor for the diff panes. `diffContent` is the text plus fold
 * width; each row also reserves its pane's number column in the content pad, so
 * the floor must add it, exactly like the per-pane horizontal extent. Otherwise
 * the longest row leaving the rendered slice would shrink the selection fill by
 * the gutter width.
 */
function publishContentWidth(): void {
	if (!views) {
		return;
	}
	const chars = views.lineNumberChars();
	views.setContentWidth(diffContent + Math.max(chars[0], chars[1]) * chWidth);
}
function applyModels() {
	if (!views) {
		return;
	}
	buildLineNumbers();
	views.setModel(paneModel());
	const chars = views.lineNumberChars();
	publishContentWidth();
	views.setContent({
		rowCount: contentRowStart() + displayRows.length,
		offsets: offsets,
		totalHeight: totalHeightOf(offsets),
		contentWidth: diffContent,
		contentWidths: [diffContent + chars[0] * chWidth, diffContent + chars[1] * chWidth]
	});
}
function fileLabelName(file: { name: string } | undefined): string {
	return file ? file.name : '';
}

function normalizeLabels(next: DiffDocument): void {
	if (Array.isArray(next.labels) && next.labels.length === 2) {
		return;
	}
	next.labels = [fileLabelName(next.left), fileLabelName(next.right)];
}

function normalizeHeaders(next: DiffDocument): void {
	if (!next.leftHeader) {
		next.leftHeader = { packages: [] };
	}
	if (!next.rightHeader) {
		next.rightHeader = { packages: [] };
	}
}

function semanticSkippedCount(next: DiffDocument): number {
	const skipped = next.semanticSkipped;
	return typeof skipped === 'number' && Number.isFinite(skipped) ? skipped : 0;
}

function semanticReason(reason: string | undefined): 'budget' | 'fallback' | undefined {
	if (reason === 'budget' || reason === 'fallback') {
		return reason;
	}
	return undefined;
}

function semanticNoun(skipped: number): string {
	return `container${skipped === 1 ? '' : 's'}`;
}

function semanticWas(skipped: number): string {
	return skipped === 1 ? 'was' : 'were';
}

function semanticSkipMessage(next: DiffDocument, skipped: number): string {
	if (!(skipped > 0)) {
		return '';
	}
	const reason = semanticReason(next.semanticLimitReason);
	if (reason === undefined) {
		return `${skipped} ${semanticNoun(skipped)} in one group could not be matched semantically.`;
	}
	return LIMITED_NOTICE[reason](skipped, semanticNoun(skipped), semanticWas(skipped));
}

function updateSemanticSkip(next: DiffDocument): void {
	if (semanticSkip === null) {
		return;
	}
	const skipped = semanticSkippedCount(next);
	semanticSkip.hidden = !(skipped > 0);
	semanticSkip.textContent = semanticSkipMessage(next, skipped);
}

function retainCollapsedRows(): void {
	const present = new Set(rows.map(function (row) { return row.key; }));
	collapsed = new Set(Array.from(collapsed).filter(function (key) { return present.has(key); }));
}

function selectedSurvives(): boolean {
	return selectedKey === undefined || rowByKey.has(selectedKey);
}

function focusSurvives(): boolean {
	return focusKey === undefined || rowByKey.has(focusKey);
}

function retainSelection(): void {
	if (!selectedSurvives()) {
		selectedKey = undefined;
	}
	if (!focusSurvives()) {
		focusKey = selectedKey;
	}
}

function resetDocumentState(): void {
	expandedGaps = new Set();
	rowsRevision++;
	subtreeCache = undefined;
	indexRows();
	retainCollapsedRows();
	retainSelection();
}

function layOutDocument(): void {
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
	if (views) {
		views.syncScrollbarWidth();
	}
	updateViewButtons();
}

function restartSearchIfNeeded(): void {
	if (searchQuery.trim() === '') {
		return;
	}
	startSearch(searchQuery, currentMatchKey(), true);
}

function setDocument(next: any): void {
	if (!next || !Array.isArray(next.rows)) {
		return;
	}
	normalizeLabels(next);
	normalizeHeaders(next);
	diffDocument = next;
	rows = next.rows;
	loaded = true;
	updateSemanticSkip(next);
	resetDocumentState();
	layOutDocument();
	restartSearchIfNeeded();
}
function measureRowHeight(): number {
	const measure = document.getElementById('diff-measure');
	const element = measure ? measure.querySelector('.diff-cell') : null;
	const measured = element ? element.getBoundingClientRect().height : 0;
	// The probe lives outside the row list, so a hidden pane still has its last
	// real row height instead of resetting the window math to a fallback.
	return measured > 0 ? measured : heights.row;
}

function measureHeights() {
	const measured = measureRowHeight();
	heights = { row: measured > 0 ? measured : 20 };
	buildHeightFn();
}
/**
 * One content width per rebuild. The row font is monospace, so one font probe
 * plus character counts give the longest row without reading layout per row.
 * Both panes share it so a synchronized horizontal offset cannot clamp early.
 * Header lines take part too: a long package path must not exceed the window
 * minimum, or the selection fill would shrink below the pane.
 */
function probeCharWidth(): number {
	const probe = document.getElementById('diff-ch-probe');
	if (!probe) {
		return 0;
	}
	const width = probe.getBoundingClientRect().width;
	return width > 0 ? width / 100 : 0;
}

function maxRowChars(): number {
	let maxChars = 0;
	for (const row of rows) {
		maxChars = Math.max(maxChars, diffRowChars(row));
	}
	return maxChars;
}

function maxLineChars(line: HeaderLine | undefined, current: number): number {
	if (!line) {
		return current;
	}
	// `keyword ` plus the value, with both row flex gaps.
	const chars = line.keyword.length + 1 + line.text.length + 1;
	return Math.max(current, chars);
}

function maxHeaderChars(): number {
	let maxChars = 0;
	for (const row of headerRows) {
		maxChars = maxLineChars(row.left, maxChars);
		maxChars = maxLineChars(row.right, maxChars);
	}
	return maxChars;
}

function measureDiffWidth() {
	chWidth = probeCharWidth();
	diffContent = diffContentWidth(Math.max(maxRowChars(), maxHeaderChars()), chWidth);
	publishContentWidth();
}
function cachedSubtree(): Set<string> | undefined {
	if (!subtreeCache) {
		return undefined;
	}
	if (subtreeCache.key !== selectedKey) {
		return undefined;
	}
	if (subtreeCache.revision !== rowsRevision) {
		return undefined;
	}
	return subtreeCache.ids;
}

function subtreeIdsFrom(at: number): Set<string> {
	const ids = new Set<string>();
	const end = subtreeEnd(rows, at);
	for (let index = at; index < end; index++) {
		ids.add(rows[index].key);
	}
	return ids;
}

function selectedSubtreeIds(): Set<string> {
	const cached = cachedSubtree();
	if (cached) {
		return cached;
	}
	const at = selectedKey === undefined ? undefined : rowIndexByKey.get(selectedKey);
	const ids = at === undefined ? new Set<string>() : subtreeIdsFrom(at);
	subtreeCache = { key: selectedKey, revision: rowsRevision, ids };
	return ids;
}

function leftGuides(flat: DiffDisplayRow): DiffDisplayRow['guidesLeft'] {
	return swapped ? flat.guidesRight : flat.guidesLeft;
}

function rightGuides(flat: DiffDisplayRow): DiffDisplayRow['guidesRight'] {
	return swapped ? flat.guidesLeft : flat.guidesRight;
}

function displayGuides(flat: DiffDisplayRow, side: 'left' | 'right'): DiffDisplayRow['guidesLeft'] {
	return side === 'left' ? leftGuides(flat) : rightGuides(flat);
}

function expandedIdsFor(flat: DiffDisplayRow): Set<string> {
	return flat.expanded ? new Set([rows[flat.rowIndex].key]) : new Set();
}

function documentOptions(flat: DiffDisplayRow, side: 'left' | 'right') {
	return {
		selectedId: undefined,
		expandedIds: expandedIdsFor(flat),
		searchQuery: searchQuery,
		currentId: currentMatchKey(),
		subtreeIds: selectedSubtreeIds(),
		guides: displayGuides(flat, side)
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
function flatLeft(flat: DiffDisplayRow): DiffDisplayRow['left'] {
	return swapped ? flat.right : flat.left;
}
function flatRight(flat: DiffDisplayRow): DiffDisplayRow['right'] {
	return swapped ? flat.left : flat.right;
}
function displayKind(flat: DiffDisplayRow, pane: string): DiffDisplayRow['left'] {
	return pane === 'left' ? flatLeft(flat) : flatRight(flat);
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

/** Merge mode: arrows are live and rows can be copied to the other pane. */
let mergeMode = false;

function applyMergeMode(enabled: boolean): void {
	mergeMode = enabled;
	const toggle = document.getElementById('diff-merge-toggle');
	if (toggle !== null) {
		toggle.setAttribute('aria-pressed', String(enabled));
		toggle.classList.toggle('is-on', enabled);
	}
	if (views !== undefined) {
		renderWindow(true);
	}
}

function toggleMergeMode(): void {
	applyMergeMode(!mergeMode);
	postToHost({ type: 'mergeMode', enabled: mergeMode });
}

/**
 * The copy arrow on a row's inner edge. It points at the other pane: right on the
 * left pane, left on the right pane, and it follows the displayed side through Swap.
 * A row with a cell on only one side keeps an arrow on the empty side, which deletes
 * the element from the side that has it.
 */
function canCopyRow(row: DiffRow): boolean {
	return row.status !== 'unchanged' && (row.left !== undefined || row.right !== undefined);
}

function arrowLabel(host: 'left' | 'right', own: DiffCell | undefined): string {
	if (own === undefined) {
		return 'Delete this element from the other side';
	}
	return host === 'left' ? 'Copy to the right' : 'Copy to the left';
}

function copyArrowButton(row: DiffRow, side: 'left' | 'right', host: 'left' | 'right'): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'diff-copy-arrow';
	button.dataset.side = side;
	button.textContent = host === 'left' ? '→' : '←';
	button.setAttribute('aria-label', 'Copy to the other side');
	button.title = arrowLabel(host, host === 'left' ? row.left : row.right);
	button.addEventListener('click', function (event) {
		event.stopPropagation();
		selectKey(row.key, true);
		postToHost({ type: 'copy', side: host, key: row.key });
	});
	return button;
}

function appendCopyArrow(element: HTMLElement, flat: DiffDisplayRow, side: 'left' | 'right'): void {
	if (!mergeMode) {
		return;
	}
	const row = rows[flat.rowIndex];
	if (!canCopyRow(row)) {
		return;
	}
	element.appendChild(copyArrowButton(row, side, hostSide(side)));
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
function wordPairs(leftTexts: string[], rightTexts: string[]): WordPair[] {
	const pairs: WordPair[] = [];
	const count = Math.min(leftTexts.length, rightTexts.length);
	for (let at = 0; at < count; at++) {
		pairs.push(diffWords(leftTexts[at], rightTexts[at]));
	}
	return pairs;
}

function metaPairs(left: DiffCell, right: DiffCell): DocumentWordDiff['meta'] {
	const meta: DocumentWordDiff['meta'] = {};
	for (const cls of WORD_DIFF_META_CLASSES) {
		const pairs = wordPairs(metaPartTexts(left, cls), metaPartTexts(right, cls));
		if (pairs.length > 0) {
			meta[cls] = pairs;
		}
	}
	return meta;
}

function displayText(value: string | undefined): string {
	return value || '';
}

function wordDiffForRow(row: DiffRow): DocumentWordDiff | undefined {
	const left = displayLeft(row);
	const right = displayRight(row);
	if (displayStatus(row) !== 'changed') {
		return undefined;
	}
	if (!left || !right) {
		return undefined;
	}
	return {
		label: diffWords(displayText(left.label), displayText(right.label)),
		value: diffWords(displayText(left.shownValue), displayText(right.shownValue)),
		meta: metaPairs(left, right),
	};
}
function paneSide(pane: string): 'left' | 'right' {
	return pane === 'left' ? 'left' : 'right';
}

function headerLineFor(index: number, side: 'left' | 'right'): HeaderLine | undefined {
	const row = headerRows[index];
	if (!row) {
		return undefined;
	}
	return side === 'left' ? row.left : row.right;
}

function keywordSpan(keyword: string): HTMLElement {
	const key = document.createElement('span');
	key.className = 'keyword';
	appendHighlighted(key, keyword, searchQuery);
	return key;
}

function headerLineElement(line: HeaderLine): HTMLElement {
	const row = document.createElement('div');
	row.className = 'row document-tree-header-row';
	row.appendChild(keywordSpan(line.keyword));
	row.appendChild(document.createTextNode(' '));
	const value = document.createElement('span');
	value.className = line.keyword === 'schema' ? 'number' : 'package';
	appendHighlighted(value, line.text, searchQuery);
	row.appendChild(value);
	return row;
}

function fillHeaderCell(cell: HTMLElement, line: HeaderLine, element: HTMLElement): void {
	cell.appendChild(headerLineElement(line));
	if (searchQuery.trim() !== '' && currentMatchKey() === element.dataset.key) {
		element.dataset.searchCurrent = 'true';
	}
}

function headerCell(element: HTMLElement, side: 'left' | 'right', line: HeaderLine | undefined): void {
	const cell = document.createElement('div');
	cell.className = 'diff-cell diff-header-cell';
	cell.dataset.side = side;
	if (line) {
		fillHeaderCell(cell, line, element);
	} else {
		cell.dataset.headerEmpty = 'true';
	}
	element.appendChild(cell);
}

function renderHeaderRow(index: number, pane: string): any {
	const side = paneSide(pane);
	const element = document.createElement('div');
	element.className = 'diff-row diff-header-row';
	element.dataset.side = side;
	element.dataset.key = 'header:' + index;
	element.setAttribute('role', 'presentation');
	element.tabIndex = -1;
	headerCell(element, side, headerLineFor(index, side));
	return element;
}
function renderHeaderGapRow(pane: string): HTMLElement {
	const element = document.createElement('div');
	element.className = 'diff-row diff-header-gap-row';
	element.dataset.side = pane === 'left' ? 'left' : 'right';
	element.setAttribute('role', 'presentation');
	element.setAttribute('aria-hidden', 'true');
	element.tabIndex = -1;
	return element;
}
function isModuleGap(flat: DiffDisplayRow | undefined): boolean {
	if (!flat) {
		return false;
	}
	return flat.moduleGap === true;
}

function renderModuleGapRow(pane: string): HTMLElement {
	const gap = document.createElement('div');
	gap.className = 'diff-row diff-module-gap-row';
	gap.dataset.side = paneSide(pane);
	gap.setAttribute('role', 'presentation');
	gap.setAttribute('aria-hidden', 'true');
	gap.tabIndex = -1;
	return gap;
}

function gapLineLabel(count: number): string {
	return `${count} unchanged line${count === 1 ? '' : 's'}`;
}

function gapAriaLabel(expanded: boolean, label: string): string {
	return `${expanded ? 'Hide' : 'Show'} ${label}`;
}

function gapChevronText(expanded: boolean): string {
	return expanded ? '▾' : '▸';
}

type DiffGapInfo = NonNullable<DiffDisplayRow['gap']>;

function gapToggleButton(gapInfo: DiffGapInfo): HTMLElement {
	const button = document.createElement('button');
	button.className = 'diff-gap-toggle';
	button.type = 'button';
	button.dataset.gapKey = gapInfo.key;
	button.setAttribute('aria-expanded', gapInfo.expanded ? 'true' : 'false');
	const label = gapLineLabel(gapInfo.count);
	button.setAttribute('aria-label', gapAriaLabel(gapInfo.expanded, label));
	const chevron = document.createElement('span');
	chevron.className = 'diff-gap-chevron';
	chevron.setAttribute('aria-hidden', 'true');
	chevron.textContent = gapChevronText(gapInfo.expanded);
	button.appendChild(chevron);
	button.appendChild(document.createTextNode(label));
	return button;
}

function appendGapControl(gap: HTMLElement, gapInfo: DiffGapInfo, side: 'left' | 'right', element: HTMLElement): void {
	if (side === 'left') {
		gap.appendChild(gapToggleButton(gapInfo));
		return;
	}
	element.setAttribute('aria-hidden', 'true');
}

function renderGapRow(
	gapInfo: DiffGapInfo,
	element: HTMLElement,
	cell: HTMLElement,
	side: 'left' | 'right'
): HTMLElement {
	element.classList.add('diff-gap-row');
	element.dataset.gapKey = gapInfo.key;
	const gap = document.createElement('div');
	gap.className = 'diff-gap';
	appendGapControl(gap, gapInfo, side, element);
	const line = document.createElement('span');
	line.className = 'diff-gap-line';
	gap.appendChild(line);
	cell.appendChild(gap);
	element.appendChild(cell);
	return element;
}

function markStructuralRow(element: HTMLElement): void {
	element.classList.add('diff-structural');
	element.setAttribute('aria-hidden', 'true');
}

function subtreeChangeDot(): HTMLElement {
	const dot = document.createElement('span');
	dot.className = 'diff-subtree-change-dot';
	dot.setAttribute('aria-hidden', 'true');
	dot.title = SUBTREE_CHANGED_DESCRIPTION;
	return dot;
}

/** Place the dot in the fold gutter, immediately after the collapsed twisty. */
function appendSubtreeChangeDot(node: Element): void {
	const shell = node.firstElementChild;
	if (!shell) {
		return;
	}
	const twisty = shell.querySelector('.twisty');
	if (twisty) {
		twisty.insertAdjacentElement('afterend', subtreeChangeDot());
		return;
	}
	shell.appendChild(subtreeChangeDot());
}

/**
 * The row is a node row, currently collapsed, and its subtree holds changes.
 * The dot is display-only: `data-status`, the tint, the gutter, search, F7 and
 * selection keep using the row's own status.
 */
function isCollapsedChangedNode(flat: DiffDisplayRow, row: DiffRow): boolean {
	return isNodeDisplay(flat) && row.hasChildren && !flat.expanded && descendantChanged[flat.rowIndex] === true;
}

function markSubtreeChanged(element: HTMLElement): void {
	element.dataset.subtreeChanged = 'true';
	element.setAttribute('aria-description', SUBTREE_CHANGED_DESCRIPTION);
	const node = element.querySelector<HTMLElement>('.node');
	if (!node) {
		return;
	}
	node.dataset.subtreeChanged = 'true';
	appendSubtreeChangeDot(node);
}

function markSelectedRow(element: HTMLElement, key: string): void {
	if (key === selectedKey) {
		element.dataset.selected = 'true';
	}
}

function markSearchCurrent(element: HTMLElement, key: string): void {
	if (searchQuery.trim() !== '' && key === currentMatchKey()) {
		element.dataset.searchCurrent = 'true';
	}
}

function appendStatusBadge(element: HTMLElement, status: string): void {
	const badge = document.createElement('span');
	badge.className = 'sr-only';
	badge.textContent = status;
	element.appendChild(badge);
}

function applyTreeItemState(element: HTMLElement, flat: DiffDisplayRow, row: DiffRow): void {
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

function applyNodeRowState(
	element: HTMLElement,
	flat: DiffDisplayRow,
	side: 'left' | 'right',
	row: DiffRow,
	status: string
): void {
	element.dataset.status = status;
	element.dataset.key = row.key;
	markSelectedRow(element, row.key);
	markSearchCurrent(element, row.key);
	if (status !== 'unchanged') {
		appendStatusBadge(element, status);
	}
	if (side === 'left') {
		applyTreeItemState(element, flat, row);
	}
}

function displaySideRow(row: DiffRow, side: 'left' | 'right'): DiffCell | undefined {
	return side === 'left' ? displayLeft(row) : displayRight(row);
}

function buildNodeRow(cellRow: DiffCell, row: DiffRow, side: 'left' | 'right', options: ReturnType<typeof documentOptions>): HTMLElement {
	return stripDocumentNode(
		buildDocumentNodeRow(
			documentRowForCell(cellRow, row),
			Object.assign(options, {
				selectedId: row.key === selectedKey ? row.key : undefined,
				wordDiff: wordDiffForRow(row),
				wordSide: side
			})
		)
	);
}

function appendNodeCell(
	element: HTMLElement,
	cell: HTMLElement,
	row: DiffRow,
	side: 'left' | 'right',
	options: ReturnType<typeof documentOptions>
): void {
	const cellRow = displaySideRow(row, side);
	if (!cellRow) {
		return;
	}
	const node = buildNodeRow(cellRow, row, side, options);
	element.title = cellRow.definitionRef;
	cell.appendChild(node);
}

function displayCommentLeft(flat: DiffDisplayRow): string {
	return (swapped ? flat.commentRight : flat.commentLeft) || '';
}

function displayCommentRight(flat: DiffDisplayRow): string {
	return (swapped ? flat.commentLeft : flat.commentRight) || '';
}

function commentTextFor(flat: DiffDisplayRow, side: 'left' | 'right'): string {
	return side === 'left' ? displayCommentLeft(flat) : displayCommentRight(flat);
}

function appendCommentCell(
	cell: HTMLElement,
	flat: DiffDisplayRow,
	side: 'left' | 'right',
	row: DiffRow,
	options: ReturnType<typeof documentOptions>
): void {
	cell.appendChild(buildDocumentCommentRow(commentTextFor(flat, side), flat.level, row.key, options));
}

function isBraceKind(kind: DiffDisplayRow['left']): kind is 'brace-open' | 'brace-close' {
	return kind === 'brace-open' || kind === 'brace-close';
}

function appendBraceCell(
	cell: HTMLElement,
	kind: 'brace-open' | 'brace-close',
	flat: DiffDisplayRow,
	row: DiffRow,
	options: ReturnType<typeof documentOptions>
): void {
	cell.appendChild(buildDocumentBraceRow(kind, flat.level, row.key, options));
}

function appendCellContent(
	element: HTMLElement,
	cell: HTMLElement,
	flat: DiffDisplayRow,
	side: 'left' | 'right',
	row: DiffRow,
	kind: DiffDisplayRow['left']
): void {
	const options = documentOptions(flat, side);
	if (kind === 'node') {
		appendNodeCell(element, cell, row, side, options);
		return;
	}
	if (kind === 'comment') {
		appendCommentCell(cell, flat, side, row, options);
		return;
	}
	if (isBraceKind(kind)) {
		appendBraceCell(cell, kind, flat, row, options);
	}
}

function appendKindCell(
	element: HTMLElement,
	cell: HTMLElement,
	flat: DiffDisplayRow,
	side: 'left' | 'right',
	row: DiffRow
): void {
	const kind = displayKind(flat, side);
	if (kind === 'blank') {
		cell.dataset.empty = 'true';
		element.appendChild(cell);
		return;
	}
	appendCellContent(element, cell, flat, side, row, kind);
	element.appendChild(cell);
}

function marksChangedSubtree(flat: DiffDisplayRow, row: DiffRow, side: 'left' | 'right'): boolean {
	return isCollapsedChangedNode(flat, row) && displaySideRow(row, side) !== undefined;
}

function fillContentRow(
	element: HTMLElement,
	cell: HTMLElement,
	flat: DiffDisplayRow,
	side: 'left' | 'right',
	row: DiffRow
): void {
	const nodeRow = isNodeDisplay(flat);
	if (!nodeRow) {
		markStructuralRow(element);
	}
	const status = displayStatus(row);
	if (nodeRow) {
		applyNodeRowState(element, flat, side, row, status);
	}
	appendKindCell(element, cell, flat, side, row);
	if (marksChangedSubtree(flat, row, side)) {
		markSubtreeChanged(element);
	}
}

function renderContentRow(flat: DiffDisplayRow | undefined, pane: string): HTMLElement {
	const element = document.createElement('div');
	element.className = 'diff-row';
	if (!flat) {
		return element;
	}
	const side = paneSide(pane);
	const cell = document.createElement('div');
	cell.className = 'diff-cell';
	cell.dataset.side = side;
	element.dataset.side = side;
	if (flat.gap) {
		return renderGapRow(flat.gap, element, cell, side);
	}
	fillContentRow(element, cell, flat, side, rows[flat.rowIndex]);
	appendCopyArrow(element, flat, side);
	return element;
}

function renderRow(index: number, pane: string): any {
	if (index < headerRowCount) {
		return renderHeaderRow(index, pane);
	}
	if (isHeaderGapAt(index)) {
		return renderHeaderGapRow(pane);
	}
	const flat = displayRows[index - contentRowStart()];
	if (isModuleGap(flat)) {
		return renderModuleGapRow(pane);
	}
	return renderContentRow(flat, pane);
}
function activeElementWithClosest(): Element | null | undefined {
	if (typeof document === 'undefined') {
		return undefined;
	}
	const active = document.activeElement;
	if (!active) {
		return null;
	}
	return active;
}

function focusedKey() {
	const active = activeElementWithClosest();
	if (!active) {
		return undefined;
	}
	const item = active.closest('[data-key]') as HTMLElement | null;
	return item ? item.dataset.key : undefined;
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
function isRendered(key: string | undefined): boolean {
	return key !== undefined && renderedByKey.has(key);
}

function firstRenderedKey(): string | undefined {
	return renderedByKey.size > 0 ? renderedByKey.keys().next().value : undefined;
}

function rovingCandidate(previousFocus: string | undefined): string | undefined {
	if (isRendered(previousFocus)) {
		return previousFocus;
	}
	const preferred = isRendered(focusKey) ? focusKey : selectedKey;
	return isRendered(preferred) ? preferred : firstRenderedKey();
}

function focusRenderedElement(key: string | undefined): void {
	if (key === undefined) {
		return;
	}
	const element = renderedByKey.get(key);
	if (element) {
		element.focus({ preventScroll: true });
	}
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
	applyRoving(rovingCandidate(previousFocus));
	focusRenderedElement(previousFocus);
}
function ensureVisible(displayIndex: number): void {
	if (!views) {
		return;
	}
	views.scrollToIndex(displayIndex);
}
function isHeaderGapAt(index: number): boolean {
	return index === headerRowCount && headerGapCount > 0;
}

function contentKeyAt(index: number): string | undefined {
	const flat = displayRows[index - contentRowStart()];
	return flat ? rows[flat.rowIndex].key : undefined;
}

function virtualKeyAt(index: number): string | undefined {
	if (index < 0) {
		return undefined;
	}
	if (index < headerRowCount) {
		return 'header:' + index;
	}
	if (isHeaderGapAt(index)) {
		return undefined;
	}
	return contentKeyAt(index);
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
function isAnchorSkip(flat: DiffDisplayRow | undefined): boolean {
	if (!flat) {
		return false;
	}
	return flat.gap !== undefined || flat.moduleGap === true;
}

function isInertIndex(index: number): boolean {
	if (index === headerRowCount && headerGapCount > 0) {
		return true;
	}
	const flat = index >= contentRowStart() ? displayRows[index - contentRowStart()] : undefined;
	return isAnchorSkip(flat);
}

function anchorIndexFrom(start: number): number {
	let index = start;
	while (index < contentRowStart() + displayRows.length) {
		if (!isInertIndex(index)) {
			return index;
		}
		index++;
	}
	return index;
}

function captureAnchor() {
	if (!views) {
		return null;
	}
	if (contentRowStart() + displayRows.length === 0) {
		return null;
	}
	const top = views.getScrollTop();
	const index = anchorIndexFrom(views.getVisibleRange()[0]);
	const key = virtualKeyAt(index);
	if (key === undefined) {
		return null;
	}
	return { key: key, delta: top - anchorOffset(index) };
}

function anchorOffset(index: number): number {
	return offsets[index] ?? 0;
}

function restoreAnchor(anchor: ReturnType<typeof captureAnchor>): void {
	if (!anchor || !views) {
		return;
	}
	const index = virtualIndexForKey(anchor.key);
	if (index === undefined) {
		return;
	}
	views.setScrollTop(Math.max(0, anchorOffset(index) + anchor.delta));
}
/**
 * Re-renders around a model swap while keeping the same visible line on top.
 * The swap callback owns only the model/visibility change.
 */
function renderKeepingAnchor(swap: () => void): void {
	const anchor = captureAnchor();
	const scrollTop = views ? views.getScrollTop() : 0;
	swap();
	renderWindow(true);
	restoreViewport(anchor, scrollTop);
	renderWindow(true);
	updateSelection();
	updateEmptyState();
}
/** Restores the captured line, or the raw scroll offset when that line is gone. */
function restoreViewport(anchor: ReturnType<typeof captureAnchor>, scrollTop: number): void {
	if (anchor && virtualIndexForKey(anchor.key) !== undefined) {
		restoreAnchor(anchor);
		return;
	}
	if (views) {
		views.setScrollTop(scrollTop);
	}
}

interface DiffKeyAnchor {
	key: string;
	/** The anchor row's distance from the viewport top when it was captured. */
	delta: number;
}

/** Focused row, else the selected row, else the current search match. */
function diffAnchorKey(): string | undefined {
	return focusedKey() || selectedKey || currentMatchKey();
}

function keyAnchorAt(key: string | undefined): DiffKeyAnchor | undefined {
	if (key === undefined) {
		return undefined;
	}
	const index = virtualIndexForKey(key);
	if (index === undefined) {
		return undefined;
	}
	const top = views ? views.getScrollTop() : 0;
	return { key: key, delta: top - anchorOffset(index) };
}

function anchorIndexOrAncestor(key: string): number | undefined {
	const index = virtualIndexForKey(key);
	return index === undefined ? virtualIndexForKey(visibleAncestorKey(key)) : index;
}

/** Re-show the anchor at its captured viewport offset, using its nearest visible ancestor. */
function restoreKeyAnchor(anchor: DiffKeyAnchor, scrollTop: number): void {
	const index = anchorIndexOrAncestor(anchor.key);
	if (index === undefined) {
		if (views) {
			views.setScrollTop(scrollTop);
		}
		return;
	}
	if (views) {
		views.setScrollTop(Math.max(0, anchorOffset(index) + anchor.delta));
		ensureVisible(index);
	}
}

function setSelectedState(item: HTMLElement, on: boolean): void {
	if (on) {
		item.dataset.selected = 'true';
	} else {
		delete item.dataset.selected;
	}
}

function updateRowSelection(item: HTMLElement): void {
	const on = item.dataset.key === selectedKey;
	if (item.getAttribute('role') === 'treeitem') {
		item.setAttribute('aria-selected', on ? 'true' : 'false');
	}
	setSelectedState(item, on);
}

function updatePaneSelection(view: DocumentTreeView): void {
	const win = view.getWindowElement();
	const items = win.querySelectorAll('[data-key]');
	for (let at = 0; at < items.length; at++) {
		updateRowSelection(items[at]);
	}
}

function updateSelection() {
	if (!views) {
		return;
	}
	updatePaneSelection(views.left);
	updatePaneSelection(views.right);
	views.refreshActiveLine();
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
	renderKeepingAnchor(function () {
		refreshVisibility();
		rebuildDisplay();
		applyModels();
	});
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
	renderSearchCount(searchBar, searchBar.hasText(), searchQuery, searchMatches.length, searchIndex, searchRunning);
}
function headerHaystack(row: HeaderRow): string {
	const parts: string[] = [];
	if (row.left) {
		parts.push(row.left.keyword + ' ' + row.left.text);
	}
	if (row.right) {
		parts.push(row.right.keyword + ' ' + row.right.text);
	}
	return parts.join(' ').toLowerCase();
}

function buildHeaderCandidates(out: DiffSearchCandidate[]): void {
	for (let at = 0; at < headerRowCount; at++) {
		out.push({ key: 'header:' + at, haystack: headerHaystack(headerRows[at]) });
	}
}

function buildDiffSearchCandidates(): DiffSearchCandidate[] {
	const out: DiffSearchCandidate[] = [];
	buildHeaderCandidates(out);
	for (const row of searchCandidatesFor(rows, showChangesOnly)) {
		out.push({ key: row.key, haystack: row.haystack });
	}
	return out;
}

function isHeaderKey(key: string): boolean {
	return key.startsWith('header:');
}

function headerIndexFromKey(key: string): number | undefined {
	const index = Number(key.slice('header:'.length));
	return Number.isFinite(index) ? index : undefined;
}

function focusHeaderAt(headerIndex: number): void {
	const element = views ? views.left.elementAt(headerIndex) : undefined;
	if (!element) {
		return;
	}
	element.tabIndex = 0;
	element.focus({ preventScroll: true });
}

function jumpToHeaderMatch(headerIndex: number): void {
	ensureVisible(headerIndex);
	renderWindow(true);
	focusHeaderAt(headerIndex);
	updateSelection();
	renderSearchUi();
	searchBar.focus();
}

function jumpToHeaderMatchKey(key: string): void {
	const headerIndex = headerIndexFromKey(key);
	if (headerIndex === undefined) {
		return;
	}
	jumpToHeaderMatch(headerIndex);
}

function revealSearchTarget(key: string): void {
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

function jumpToSearchMatch(index: number): void {
	const key = searchMatches[index];
	if (key === undefined) {
		return;
	}
	if (isHeaderKey(key)) {
		jumpToHeaderMatchKey(key);
		return;
	}
	revealSearchTarget(key);
}
function cycleSearch(direction: number): void {
	if (searchMatches.length === 0) {
		return;
	}
	searchIndex = (searchIndex + direction + searchMatches.length) % searchMatches.length;
	jumpToSearchMatch(searchIndex);
}
function startSearch(query: string, previousKey?: string, immediate?: boolean): void {
	const start = beginSearch<string>(searchEngine, query, previousKey, setHighlightQuery);
	if (start === undefined) {
		resetSearchResults();
		return;
	}
	searchQuery = start.query;
	searchMatches = start.matches;
	searchIndex = start.index;
	searchFirstJumpDone = start.firstJumpDone;
	searchCandidates = buildDiffSearchCandidates();
	setSearchBusy(true);
	renderWindow(true);
	searchEngine.search(
		searchCandidates,
		start.query,
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
				searchIndex = retainedSearchIndex(
					wanted,
					searchMatches.length,
					searchIndexOfKey,
					Math.min(Math.max(searchIndex, 0), searchMatches.length - 1)
				);
				renderSearchUi();
				renderWindow(true);
			},
			onComplete: function (indices) {
				const currentKey = currentMatchKey();
				searchMatches = indices.map(function (index) { return searchCandidates[index].key; });
				const wanted = currentKey !== undefined ? currentKey : previousKey;
				searchIndex = retainedSearchIndex(wanted, searchMatches.length, searchIndexOfKey, 0);
				searchFirstJumpDone = true;
				finishSearch(
					searchIndex,
					setSearchBusy,
					renderSearchUi,
					jumpToSearchMatch,
					function () { renderWindow(true); }
				);
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
function firstDisplayedKey(): string | undefined {
	return displayRows.length > 0 ? rows[displayRows[0].rowIndex].key : undefined;
}

function searchFocusKey(): string | undefined {
	const kept = selectedKey !== undefined && displayIndexByKey.has(selectedKey);
	return kept ? selectedKey : firstDisplayedKey();
}

function focusListAfterSearch() {
	const key = searchFocusKey();
	if (key === undefined) {
		return;
	}
	focusKey = key;
	renderWindow(true);
	applyRoving(key);
	focusRenderedElement(key);
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
function applySelectedFocus(key: string, shouldFocus?: boolean): void {
	const element = renderedByKey.get(key);
	if (!element) {
		return;
	}
	applyRoving(key);
	if (shouldFocus) {
		element.focus({ preventScroll: true });
	}
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
	applySelectedFocus(key, shouldFocus);
}

function ancestorStep(row: DiffRow, seen: Set<string>): string | undefined {
	if (row.parentKey === null) {
		return undefined;
	}
	if (seen.has(row.parentKey)) {
		return undefined;
	}
	seen.add(row.parentKey);
	return row.parentKey;
}

function expandAncestors(key: string): boolean {
	let changed = false;
	const seen = new Set([key]);
	let row = rowByKey.get(key);
	while (row) {
		const parent = ancestorStep(row, seen);
		if (parent === undefined) {
			break;
		}
		if (collapsed.delete(parent)) {
			changed = true;
		}
		row = rowByKey.get(parent);
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
	applySelectedFocus(key, true);
}

function selectedRowIndex(): number | undefined {
	return selectedKey === undefined ? undefined : rowIndexByKey.get(selectedKey);
}

function gotoChange(direction: number): void {
	const from = selectedRowIndex();
	const index = nextChangeIndex(
		rows,
		navigationVisible,
		from === undefined ? -1 : from,
		direction === -1 ? -1 : 1
	);
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
function parentRowOf(row: DiffRow): DiffRow | undefined {
	if (row.parentKey === null) {
		return undefined;
	}
	return rowByKey.get(row.parentKey);
}

function visibleAncestorKey(key: string): string | undefined {
	let current = rowByKey.get(key);
	while (current !== undefined) {
		if (displayIndexByKey.has(current.key)) {
			return current.key;
		}
		current = parentRowOf(current);
	}
	return undefined;
}
/** Collapse-all moves a hidden selection to its nearest visible ancestor. */
function reconcileCollapsedSelection(reconcileSelection: boolean): void {
	if (!reconcileSelection || selectedKey === undefined || displayIndexByKey.has(selectedKey)) {
		return;
	}
	const ancestor = visibleAncestorKey(selectedKey);
	selectedKey = ancestor;
	focusKey = ancestor;
}

function collapseChanged(reconcileSelection: boolean): void {
	const anchor = keyAnchorAt(diffAnchorKey());
	const scrollTop = views ? views.getScrollTop() : 0;
	rebuildDisplay();
	reconcileCollapsedSelection(reconcileSelection);
	applyModels();
	renderWindow(true);
	if (anchor !== undefined) {
		restoreKeyAnchor(anchor, scrollTop);
	}
	renderWindow(true);
	updateSelection();
	applyRoving(selectedKey);
}
function collapseAll(): void {
	const next = new Set(collapsed);
	for (const row of rows) {
		if (row.hasChildren) {
			next.add(row.key);
		}
	}
	if (next.size === collapsed.size) {
		return;
	}
	collapsed = next;
	collapseChanged(true);
}
function expandAll(): void {
	if (collapsed.size === 0) {
		return;
	}
	collapsed = new Set();
	collapseChanged(false);
}
function toggleSetEntry(set: Set<string>, key: string): Set<string> {
	const next = new Set(set);
	if (next.has(key)) {
		next.delete(key);
	} else {
		next.add(key);
	}
	return next;
}

function focusedGapButton(key: string): HTMLElement | undefined {
	const buttons = document.querySelectorAll<HTMLElement>('#diff-pane-left .diff-gap-toggle');
	for (const button of buttons) {
		if (button.dataset.gapKey === key) {
			return button;
		}
	}
	return undefined;
}

function toggleGap(key: string): void {
	const scrollTop = views ? views.getScrollTop() : 0;
	expandedGaps = toggleSetEntry(expandedGaps, key);
	rebuildDisplay();
	applyModels();
	if (views) {
		views.setScrollTop(scrollTop);
	}
	renderWindow(true);
	updateSelection();
	const button = focusedGapButton(key);
	if (button) {
		button.focus({ preventScroll: true });
	}
}

function nextNodeIndex(from: number, direction: number): number {
	let at = from + direction;
	while (at >= 0 && at < displayRows.length) {
		if (!isNodeDisplay(displayRows[at])) {
			at += direction;
			continue;
		}
		return at;
	}
	return -1;
}

function selectedDisplayAt(): number | undefined {
	if (selectedKey === undefined) {
		return undefined;
	}
	const virtualAt = displayIndexByKey.get(selectedKey);
	return virtualAt === undefined ? undefined : virtualAt - contentRowStart();
}

function selectionStart(offset: number): number {
	const at = selectedDisplayAt();
	if (at !== undefined) {
		return at;
	}
	return offset > 0 ? -1 : displayRows.length;
}

function stepNode(from: number, offset: number): number {
	const direction = offset >= 0 ? 1 : -1;
	let next = from;
	for (let step = 0; step < Math.abs(offset); step++) {
		const candidate = nextNodeIndex(next, direction);
		if (candidate < 0) {
			break;
		}
		next = candidate;
	}
	return next;
}

function moveSelection(offset: number): void {
	if (displayRows.length === 0) {
		return;
	}
	const at = selectionStart(offset);
	const next = stepNode(at, offset);
	if (next === at) {
		return;
	}
	if (next < 0) {
		return;
	}
	selectKey(rows[displayRows[next].rowIndex].key, true);
}
function selectedParent() {
	const row = selectedKey === undefined ? undefined : rowByKey.get(selectedKey);
	return row && row.parentKey !== null ? row.parentKey : undefined;
}
function selectedChild() {
	const at = selectedDisplayAt();
	if (at === undefined) {
		return undefined;
	}
	const childAt = nextNodeIndex(at, 1);
	if (childAt < 0) {
		return undefined;
	}
	const next = rows[displayRows[childAt].rowIndex];
	const current = rows[displayRows[at].rowIndex];
	return next.level > current.level ? next.key : undefined;
}

interface DiffKeyEvent {
	key: string;
	shiftKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	target: Element;
	preventDefault(): void;
}

function isSearchShortcut(event: DiffKeyEvent): boolean {
	return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f';
}

function handleSearchShortcut(event: DiffKeyEvent): boolean {
	if (!isSearchShortcut(event)) {
		return false;
	}
	event.preventDefault();
	searchBar.focus();
	return true;
}

function handleChangeShortcut(event: DiffKeyEvent): boolean {
	if (event.key !== 'F7') {
		return false;
	}
	if (event.target.closest('#diff-list')) {
		event.preventDefault();
		gotoChange(event.shiftKey ? -1 : 1);
	}
	return true;
}

const COPY_SOURCE: Record<string, 'left' | 'right'> = { ArrowLeft: 'right', ArrowRight: 'left' };

/** The pane a copy shortcut copies *from*, or `undefined` when it is not a copy key. */
function copySourceSide(event: DiffKeyEvent): 'left' | 'right' | undefined {
	if (!mergeMode || !event.altKey) {
		return undefined;
	}
	return COPY_SOURCE[event.key];
}

function handleCopyShortcut(event: DiffKeyEvent): boolean {
	const sourceDisplayed = copySourceSide(event);
	if (sourceDisplayed === undefined) {
		return false;
	}
	const key = focusedKey() ?? selectedKey;
	if (key === undefined) {
		return false;
	}
	event.preventDefault();
	postToHost({ type: 'copy', side: hostSide(sourceDisplayed), key });
	return true;
}

function handleGlobalShortcut(event: DiffKeyEvent): boolean {
	if (handleCopyShortcut(event)) {
		return true;
	}
	if (handleSearchShortcut(event)) {
		return true;
	}
	return handleChangeShortcut(event);
}

function keyboardItem(event: DiffKeyEvent): Element | null {
	return event.target.closest('#diff-list [role="treeitem"]');
}

function keyboardKey(item: Element | null): string | undefined {
	if (!item) {
		return selectedKey;
	}
	const key = item.getAttribute('data-key');
	return key === null ? undefined : key;
}

function fallbackKey(target: EventTarget | null): string | undefined {
	if (selectedKey === undefined) {
		return undefined;
	}
	if (target !== document.body) {
		return undefined;
	}
	return selectedKey;
}

function rowFor(key: string | undefined): { key: string; row: DiffRow } | undefined {
	if (key === undefined) {
		return undefined;
	}
	const row = rowByKey.get(key);
	return row ? { key, row } : undefined;
}

function keyboardRow(item: Element | null, target: EventTarget | null): { key: string; row: DiffRow } | undefined {
	if (item) {
		return rowFor(keyboardKey(item));
	}
	return rowFor(fallbackKey(target));
}

function verticalOffsetFor(key: string): number | undefined {
	if (key === 'ArrowDown') {
		return 1;
	}
	if (key === 'ArrowUp') {
		return -1;
	}
	return undefined;
}

function jumpOffsetFor(key: string): number | undefined {
	if (key === 'Home') {
		return -displayRows.length;
	}
	if (key === 'End') {
		return displayRows.length;
	}
	return undefined;
}

function moveOffsetFor(key: string): number | undefined {
	const vertical = verticalOffsetFor(key);
	return vertical === undefined ? jumpOffsetFor(key) : vertical;
}

function handleMoveKey(event: DiffKeyEvent): boolean {
	const offset = moveOffsetFor(event.key);
	if (offset === undefined) {
		return false;
	}
	event.preventDefault();
	moveSelection(offset);
	return true;
}

function expandOnRight(key: string, row: DiffRow): void {
	if (row.hasChildren && collapsed.has(key)) {
		toggleCollapsed(key);
		return;
	}
	const child = selectedChild();
	if (child !== undefined) {
		selectKey(child, true);
	}
}

function collapseOnLeft(key: string, row: DiffRow): void {
	if (row.hasChildren && !collapsed.has(key)) {
		toggleCollapsed(key);
		return;
	}
	const parent = selectedParent();
	if (parent !== undefined) {
		selectKey(parent, true);
	}
}

function handleHorizontalKey(event: DiffKeyEvent, key: string, row: DiffRow): boolean {
	if (event.key === 'ArrowRight') {
		event.preventDefault();
		expandOnRight(key, row);
		return true;
	}
	if (event.key === 'ArrowLeft') {
		event.preventDefault();
		collapseOnLeft(key, row);
		return true;
	}
	return false;
}

function revealRow(event: DiffKeyEvent, key: string, row: DiffRow): void {
	event.preventDefault();
	const side = displayLeft(row) ? hostSide('left') : hostSide('right');
	postToHost({ type: 'reveal', side: side, key: key });
}

function selectRow(event: DiffKeyEvent, key: string): void {
	event.preventDefault();
	selectKey(key, true);
}

function handleActivationKey(event: DiffKeyEvent, key: string, row: DiffRow): boolean {
	if (event.key === 'Enter') {
		revealRow(event, key, row);
		return true;
	}
	if (event.key === ' ') {
		selectRow(event, key);
		return true;
	}
	return false;
}

function handleRowKey(event: DiffKeyEvent, key: string, row: DiffRow): void {
	if (handleMoveKey(event)) {
		return;
	}
	if (handleHorizontalKey(event, key, row)) {
		return;
	}
	handleActivationKey(event, key, row);
}

function onKeyDown(event: any): void {
	if (!(event.target instanceof Element)) {
		return;
	}
	if (handleGlobalShortcut(event)) {
		return;
	}
	const selection = keyboardRow(keyboardItem(event), event.target);
	if (!selection) {
		return;
	}
	handleRowKey(event, selection.key, selection.row);
}
interface PaneClickTarget {
	closest?(selector: string): HTMLElement | null;
}

interface PaneClickEvent {
	target?: PaneClickTarget;
}

function headerRowFrom(event: PaneClickEvent): HTMLElement | undefined {
	if (!event.target) {
		return undefined;
	}
	if (!event.target.closest) {
		return undefined;
	}
	return event.target.closest('.diff-header-row') ?? undefined;
}

function focusHeaderRow(event: PaneClickEvent): void {
	const header = headerRowFrom(event);
	if (!header) {
		return;
	}
	header.tabIndex = 0;
	header.focus({ preventScroll: true });
}

function paneFlatAt(index: number): DiffDisplayRow | undefined {
	return displayRows[index - contentRowStart()];
}

function handleBlankOrGapRow(flat: DiffDisplayRow | undefined): boolean {
	if (!flat) {
		return true;
	}
	if (flat.moduleGap) {
		// The module gap is decoration: clicking it or its number changes nothing.
		return true;
	}
	if (!flat.gap) {
		return false;
	}
	toggleGap(flat.gap.key);
	return true;
}

function handleSpecialRow(index: number): boolean {
	if (isHeaderGapAt(index)) {
		return true;
	}
	return handleBlankOrGapRow(paneFlatAt(index));
}

function clickedNodeRow(flat: DiffDisplayRow | undefined): DiffRow | undefined {
	if (!flat) {
		return undefined;
	}
	if (!isNodeDisplay(flat)) {
		return undefined;
	}
	return rows[flat.rowIndex];
}

function isTwistyClick(event: PaneClickEvent): boolean {
	if (!event.target) {
		return false;
	}
	if (!event.target.closest) {
		return false;
	}
	return event.target.closest('.twisty') !== null;
}

function clickNodeRow(row: DiffRow, event: PaneClickEvent): void {
	if (isTwistyClick(event)) {
		toggleCollapsed(row.key);
		return;
	}
	selectKey(row.key, true);
}

function onPaneRowClick(index: number, event: any): void {
	if (index < headerRowCount) {
		focusHeaderRow(event);
		return;
	}
	if (handleSpecialRow(index)) {
		return;
	}
	const row = clickedNodeRow(paneFlatAt(index));
	if (!row) {
		return;
	}
	clickNodeRow(row, event);
}
/** Bind the document-level gestures once the page refs exist. */
function mountDiffDomListeners(): void {
document.addEventListener('keydown', onKeyDown);
window.addEventListener('resize', function () {
	measureHeights();
	measureDiffWidth();
	if (views) {
		views.syncScrollbarWidth();
	}
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
		applyDiffDocument(message);
		return;
	}
	if (message.type === 'mergeMode') {
		applyMergeMode(message.enabled === true);
		return;
	}
	if (message.type === 'labels') {
		diffDocument.labels = message.labels;
		renderHeaders();
		return;
	}
	if (message.type === 'documentPatch') {
		renderKeepingAnchor(function () {
			setDocument(applyDiffPatch(diffDocument, message.patch));
		});
		return;
	}
	handleDiffStatusMessage(message);
}

/** Installs a new document without dropping the visible line. */
function applyDiffDocument(message: Extract<DiffProviderToWebview, { type: 'document' }>): void {
	notice.textContent = '';
	delete notice.dataset.kind;
	semanticMatching = message.semantic !== false;
	renderKeepingAnchor(function () { setDocument(message.document); });
}

/** Mode and error updates keep the current document on screen. */
function handleDiffStatusMessage(message: DiffProviderToWebview): void {
	if (message.type === 'matchModeState') {
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
	semanticSkip = document.getElementById('diff-semantic-skip');
	reportError = installNoticeErrors(document, window, {
		noticeId: 'diff-notice',
		label: 'The diff page failed',
	}).report;
	window.addEventListener('message', function (event) {
		handleDiffMessage(event.data as DiffProviderToWebview);
	});
	const mergeToggle = document.createElement('button');
	mergeToggle.id = 'diff-merge-toggle';
	mergeToggle.type = 'button';
	mergeToggle.className = 'diff-merge-toggle';
	mergeToggle.textContent = 'Merge';
	mergeToggle.title = 'Merge mode: copy rows between the panes';
	mergeToggle.setAttribute('aria-pressed', 'false');
	mergeToggle.addEventListener('click', toggleMergeMode);
	const titleStrip = document.getElementById('diff-title-strip');
	if (titleStrip !== null) {
		titleStrip.appendChild(mergeToggle);
	}
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
	onCollapseAll: function () { collapseAll(); },
	onExpandAll: function () { expandAll(); },
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
searchBar = mountSearchBar(
	'diff-',
	() => searchQuery,
	() => searchMatches.length > 0,
	resetSearchResults,
	startSearch,
	cycleSearch,
	renderSearchUi,
	setHighlightQuery,
	true,
	focusListAfterSearch
);
renderWindow(true);
updateSelection();
updateViewButtons();
updateEmptyState();
postToHost({ type: 'ready' });
}

/** A page reload starts from the initial protocol state, exactly like a fresh bundle. */
function resetDiffState(): void {
	diffDocument = emptyDiffDocument();
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
	descendantChanged = [];
	displayIndexByKey = new Map();
	navigationVisible = [];
	windowRange = [0, 0];
	renderedByKey = new Map();
	heights = { row: 20 };
	heightFn = function () { return heights.row; };
	offsets = [0];
	diffContent = 0;
	chWidth = 0;
	headerRowCount = 0;
	headerGapCount = 0;
	headerRows = [];
	lineNumbers = { left: [], right: [] };
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
