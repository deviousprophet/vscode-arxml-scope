/**
 * The ECUC editor webview entrypoint.
 *
 * The host writes a static shell and posts an `EditorDocumentPayload`; this
 * module mounts the toolbar, Document tree, sidebar and row menu, and owns the
 * row store, selection, search, the provider bridge and the page-level DOM
 * effects. Every reusable unit lives under `components/` and owns its markup,
 * CSS and input behaviour.
 */
import './styles/tokens.css';
import './styles/base.css';
import type { EcucRow, RowCondition } from '../core/ecuc/renderRows';
import {
	FlatRow,
	ancestorIds,
	flattenRows,
	stepMatch,
} from './render/treeQuery';
import {
	buildDocumentBraceRow,
	buildDocumentCommentRow,
	buildDocumentNodeRow,
} from './components/documentTree/documentRows';
import { DocumentTreeView, DocumentTreeHeader } from './components/documentTree/documentTreeView';
import { VirtualScroll } from './components/virtualScroll/virtualScroll';
import { buildOffsets, totalHeightOf } from './render/virtualScroll';
import {
	GuideSegment,
	collapsedIdsFor,
	guidesFor,
	moveTarget,
	reconcileRowState,
	resolveFocusId,
	subtreeRowIds,
	toggleCollapsed,
} from './components/documentTree/documentTreeState';
import { RowSearchEngine } from './render/rowSearch';
import {
	beginSearch,
	finishSearch,
	mountSearchBar,
	renderSearchCount,
	retainedSearchIndex,
} from './render/searchState';
import { inspectorElement } from './render/dom';
import {
	getSidebarState,
	mountSidebarShell,
	setSidebarHidden,
	setSidebarPersistence,
	setSidebarState,
	showSidebarSection,
	showSidebarTab,
	SidebarUiState,
} from './components/sidebar/sidebar';
import { inspectorFields, refusalShownInDetails, definitionRows } from './components/sidebar/detailsPanel/detailsPanel';
import type { InspectorFields } from './components/sidebar/detailsPanel/detailsPanel';
import {
	applyDisabledCount,
	ensureDiscoveredConditionRows,
	mountConditionsPanel,
	renderConditionEntries,
	setConditionRows,
	setConditionsCallback,
	setConditionsErrorReporter,
	setConditionsStatus,
} from './components/sidebar/conditionsPanel/conditionsPanel';
import {
	beginDetailsEdit,
	detailsContainerFields,
	detailsSelectionChanged,
	detailsValueInput,
	handleDetailsEditorMessage,
	resetDetailsEditorState,
	setDetailsEditorHost,
} from './components/detailsEditor/detailsEditor';
import { EditorToolbar } from './components/toolbar/toolbar';
import type { SearchBar } from './components/searchBar/searchBar';
import { hideRowMenu, mountContextMenu } from './components/contextMenu/contextMenu';
import { appendConditionTokens, appendHighlighted, setHighlightQuery } from './render/rowView';
import { installConsoleErrors } from './render/pageError';
import { postToHost, readPageState, resetVsCodeApi, writePageState } from './vscodeApi';
import type { EditorDocumentHeader, EditorProviderToWebview } from '../webviewProtocol';

export type { EditorDocumentHeader, EditorDocumentPayload, EditorProviderToWebview } from '../webviewProtocol';
export { documentHeader } from '../webviewProtocol';


let tree: any;
let inspector: any;
let detailsStatus: any;
let editorToolbar: EditorToolbar | undefined;
let detailsBody: any;

let rows: EcucRow[] = [];
let rowById = new Map<string, EcucRow>();
let rowIndexById = new Map<string, number>();
let displayRows: FlatRow[] = [];
let displayIndexById = new Map<string, number>();
let visibleNodeIds: string[] = [];
let expandedIds = new Set<string>();
let collapsed = new Set<string>();
let selectedId: string | undefined;
let subtreeIds = new Set<string>();
let guideLevels: GuideSegment[][] = [];
let hoveredGuideId: string | undefined;
let focusId: string | undefined;

interface EditorHeaderRow {
	id: string;
	keyword: 'schema' | 'package';
	text: string;
	haystack: string;
}

interface EditorSearchCandidate {
	id: string;
	haystack: string;
	headerIndex?: number;
}

let headerRows: EditorHeaderRow[] = [];
let headerRowCount = 0;
let headerGapCount = 0;
let offsets: number[] = [0];
let contentWidth = 0;
let searchCandidates: EditorSearchCandidate[] = [];
// Search is a jump control, not a visibility control: the whole row store is the
// candidate set, and the collapsed set never removes a candidate. The query is
// mirrored into the row primitives for the mark text.
let searchQuery = '';
let searchMatches: number[] = [];
let searchIndex = -1;

const searchEngine = new RowSearchEngine();
let searchRunning = false;
let searchFirstJumpDone = false;
// Discovery derives row names from the current document; manual rows are the
// only removable ones, so there is no dismissal set any more.
let windowRange: [number, number] = [0, 0];
let renderedById = new Map<string, HTMLElement>();
let heights = { document: 20 };
let chWidth = 0;
let heightFn: (index: number) => number = function () { return heights.document; };
let typeAhead = { text: '', at: 0 };
// VirtualScroll owns the scroll surface; this page owns the row model and state.
let virtualScroll: VirtualScroll | undefined;
let treeView: DocumentTreeView | undefined;
let searchBar: SearchBar;
let reportError: (text: string) => void = function () {};

function indexRows() {
	rowById = new Map();
	rowIndexById = new Map();
	for (let at = 0; at < rows.length; at++) {
		rowById.set(rows[at].id, rows[at]);
		rowIndexById.set(rows[at].id, at);
	}
}

function contentRowStart(): number {
	return headerRowCount + headerGapCount;
}

function buildHeightFn() {
	const base = heights.document;
	// Every display row is one base row high, including the header and module gaps.
	heightFn = function () {
		return base;
	};
	offsets = buildOffsets(contentRowStart() + displayRows.length, heightFn);
	contentWidth = Math.max(contentWidth, estimateContentWidth());
	syncTreeModel();
}

function indentChars(level: number): number {
	return Math.max(0, level - 1) * 4;
}

/** The base label width of one row, including the `module ` prefix. */
function rowLabelChars(row: EcucRow): number {
	const chars = indentChars(row.level) + row.label.length;
	return row.kind === 'module' ? chars + 7 : chars;
}

/** The `= ` plus value/reference target width of one row, or 0. */
function rowValueText(row: EcucRow): string {
	return row.shownValue !== undefined ? row.shownValue : row.target || '';
}

function rowValueChars(row: EcucRow): number {
	if (row.kind !== 'parameter' && row.kind !== 'reference') {
		return 0;
	}
	return 3 + rowValueText(row).length;
}

/** The inline meta text widths of one row. */
function rowMetaChars(row: EcucRow): number {
	let chars = 0;
	for (const part of row.meta) {
		chars += part.text.length + 1;
	}
	return chars;
}

/** The widest row, including its comment lines. */
function maxRowChars(): number {
	let maxChars = 0;
	for (const row of rows) {
		maxChars = Math.max(maxChars, rowLabelChars(row) + rowValueChars(row) + rowMetaChars(row));
		for (const comment of row.comments ?? []) {
			// Indent plus `/* ` + text + ` */`, with the row's flex gap.
			maxChars = Math.max(maxChars, indentChars(row.level) + 7 + comment.length + 1);
		}
	}
	return maxChars;
}

/** The widest schema/package line. */
function maxHeaderChars(): number {
	let maxChars = 0;
	for (const header of headerRows) {
		// `schema ` / `package ` plus the value, with both row flex gaps.
		maxChars = Math.max(maxChars, header.keyword.length + 1 + header.text.length + 2);
	}
	return maxChars;
}

/**
 * A deterministic full-document width estimate. It covers every row in the
 * document, not the rendered slice: the header lines, indentation, the
 * `module ` label prefix, comments, values and meta. A long row scrolling in
 * or out therefore cannot change the window's minimum width.
 */
function estimateContentWidth(): number {
	if (chWidth <= 0) {
		return 0;
	}
	const maxChars = Math.max(maxRowChars(), maxHeaderChars());
	const lineChars = treeView ? treeView.lineNumberChars() : 0;
	// Fold gutter plus slack, the number column and the document padding.
	return 26 + 8 + Math.ceil((maxChars + lineChars + 3) * chWidth);
}

function appendSchemaHeader(header: DocumentTreeHeader): void {
	if (!header.schema) {
		return;
	}
	headerRows.push({
		id: 'header:schema',
		keyword: 'schema',
		text: header.schema,
		haystack: 'schema ' + header.schema
	});
}

function appendPackageHeaders(packages: DocumentTreeHeader['packages']): void {
	const list = Array.isArray(packages) ? packages : [];
	for (let at = 0; at < list.length; at++) {
		headerRows.push({
			id: 'header:package:' + at,
			keyword: 'package',
			text: list[at],
			haystack: 'package ' + list[at]
		});
	}
}

function setHeaderRows(header: DocumentTreeHeader | undefined): void {
	headerRows = [];
	if (!header) {
		headerRowCount = 0;
		headerGapCount = 0;
		return;
	}
	appendSchemaHeader(header);
	appendPackageHeaders(header.packages);
	headerRowCount = headerRows.length;
	headerGapCount = Math.min(1, headerRowCount);
}

function buildSearchCandidates(): void {
	searchCandidates = [];
	for (let at = 0; at < headerRows.length; at++) {
		searchCandidates.push({
			id: headerRows[at].id,
			haystack: headerRows[at].haystack.toLowerCase(),
			headerIndex: at
		});
	}
	for (const row of rows) {
		searchCandidates.push({ id: row.id, haystack: row.haystack });
	}
}

function measuredRowHeight(measure: HTMLElement): number {
	const element = measure.querySelector('.probe-doc > .row');
	const measured = element ? element.getBoundingClientRect().height : 0;
	return measured > 0 ? measured : 20;
}

function measuredCharWidth(measure: HTMLElement): number {
	const probe = measure.querySelector('#tree-ch-probe');
	const probeWidth = probe ? probe.getBoundingClientRect().width : 0;
	return probeWidth > 0 ? probeWidth / 100 : chWidth;
}

function measureHeights() {
	const measure = document.getElementById('tree-measure');
	if (!measure) {
		buildHeightFn();
		return;
	}
	heights = { document: measuredRowHeight(measure) };
	chWidth = measuredCharWidth(measure);
	buildHeightFn();
}

function rebuildDisplay() {
	displayRows = flattenRows(rows, {
		collapsed: collapsed,
		braces: true,
		moduleGaps: true
	});
	guideLevels = guidesFor(displayRows, rows);
	displayIndexById = new Map();
	visibleNodeIds = [];
	expandedIds = new Set();
	for (let at = 0; at < displayRows.length; at++) {
		const flat = displayRows[at];
		if (flat.type === 'node') {
			const row = rows[flat.rowIndex];
			displayIndexById.set(row.id, contentRowStart() + at);
			visibleNodeIds.push(row.id);
			// Expansion is the display list's decision, carried on the row; the page
			// must not re-derive it from neighbouring rows (see treeQuery.ts).
			if (flat.expanded) {
				expandedIds.add(row.id);
			}
		}
	}
	buildSearchCandidates();
	buildHeightFn();
}

function reconcileFocusAfterRows(): void {
	if (focusId !== undefined && !rowById.has(focusId)) {
		focusId = selectedId;
	}
}

function applyReconciledRows(incoming: EcucRow[], nextSelectedId?: string): void {
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
}

function refreshSearchAfterRows(previousMatchId: string | undefined): void {
	// A re-scan keeps the search and, when the row survived, the current match; the
	// matches themselves are recomputed against the new row indices.
	if (searchQuery.trim() !== '') {
		startSearch(searchQuery, previousMatchId, true);
		return;
	}
	searchMatches = [];
	searchIndex = -1;
	setHighlightQuery('');
	setSearchBusy(false);
	renderSearchUi();
}

function setRows(nextRows: any, nextSelectedId?: string, nextHeader?: DocumentTreeHeader): void {
	hideRowMenu(false);
	const incoming = Array.isArray(nextRows) ? nextRows : [];
	const previousMatchId = currentMatchId();
	applyReconciledRows(incoming, nextSelectedId);
	indexRows();
	setConditionRows(rows);
	ensureDiscoveredConditionRows();
	reconcileFocusAfterRows();
	subtreeIds = new Set(subtreeRowIds(selectedId, rows));
	if (nextHeader !== undefined) {
		setHeaderRows(nextHeader);
	}
	contentWidth = 0;
	rebuildDisplay();
	measureHeights();
	refreshSearchAfterRows(previousMatchId);
}

/** The host half of the component: the rows for one display index. */
function documentRowOptions(displayIndex: number): any {
	return {
		selectedId: selectedId,
		expandedIds: expandedIds,
		searchQuery: searchQuery,
		currentId: currentMatchId(),
		subtreeIds: subtreeIds,
		guides: guideLevels[displayIndex] || []
	};
}

function treeModel() {
	return {
		rowCount: contentRowStart() + displayRows.length,
		offsets: offsets,
		contentWidth: contentWidth,
		renderRow: renderRow,
		lineInfo: function (index: number) {
			return { number: index + 1 };
		},
		activeLine: function () {
			return selectedId === undefined ? undefined : displayIndexById.get(selectedId);
		}
	};
}

function syncTreeModel() {
	if (treeView) {
		treeView.setModel(treeModel());
	}
	if (virtualScroll) {
		virtualScroll.setContent({
			rowCount: contentRowStart() + displayRows.length,
			offsets: offsets,
			totalHeight: totalHeightOf(offsets),
			contentWidth: contentWidth
		});
	}
}

function buildNodeRow(row: EcucRow, displayIndex: number): any {
	return buildDocumentNodeRow(row, documentRowOptions(displayIndex));
}

function buildBraceRow(flat: any, displayIndex: number): any {
	return buildDocumentBraceRow(flat.type, flat.level, rows[flat.rowIndex].id, documentRowOptions(displayIndex));
}

function buildCommentRow(flat: any, displayIndex: number): any {
	return buildDocumentCommentRow(flat.text, flat.level, rows[flat.rowIndex].id, documentRowOptions(displayIndex));
}

function buildModuleGapRow(): HTMLElement {
	const row = document.createElement('div');
	row.className = 'document-tree-module-gap';
	row.setAttribute('role', 'presentation');
	row.setAttribute('aria-hidden', 'true');
	row.tabIndex = -1;
	return row;
}

function buildDisplayRow(flat: any, displayIndex: number): any {
	if (flat.type === 'module-gap') {
		return buildModuleGapRow();
	}
	if (flat.type === 'comment') {
		return buildCommentRow(flat, displayIndex);
	}
	return flat.type === 'node'
		? buildNodeRow(rows[flat.rowIndex], displayIndex)
		: buildBraceRow(flat, displayIndex);
}

function buildHeaderRow(header: EditorHeaderRow, virtualIndex: number): any {
	const row = document.createElement('div');
	row.className = 'row document-tree-header-row';
	row.setAttribute('role', 'presentation');
	row.setAttribute('data-header-id', header.id);
	row.tabIndex = -1;
	if (searchQuery.trim() !== '' && header.id === currentMatchId()) {
		row.dataset.searchCurrent = 'true';
	}
	const key = document.createElement('span');
	key.className = 'keyword';
	appendHighlighted(key, header.keyword, searchQuery);
	row.appendChild(key);
	row.appendChild(document.createTextNode(' '));
	const value = document.createElement('span');
	value.className = header.keyword === 'schema' ? 'number' : 'package';
	appendHighlighted(value, header.text, searchQuery);
	row.appendChild(value);
	row.setAttribute('data-document-index', String(virtualIndex));
	return row;
}

function buildHeaderGapRow(): HTMLElement {
	const row = document.createElement('div');
	row.className = 'document-tree-header-gap';
	row.setAttribute('role', 'presentation');
	row.setAttribute('aria-hidden', 'true');
	row.tabIndex = -1;
	return row;
}

function buildHeaderRowAt(index: number): HTMLElement | undefined {
	if (index >= headerRowCount) {
		return undefined;
	}
	const header = headerRows[index];
	return header ? buildHeaderRow(header, index) : document.createElement('div');
}

function isHeaderGapRow(index: number): boolean {
	return index === headerRowCount && headerGapCount > 0;
}

function buildDisplayRowAt(displayIndex: number): HTMLElement {
	const flat = displayRows[displayIndex];
	return flat ? buildDisplayRow(flat, displayIndex) : document.createElement('div');
}

function renderRow(index: number): any {
	const header = buildHeaderRowAt(index);
	if (header !== undefined) {
		return header;
	}
	if (isHeaderGapRow(index)) {
		return buildHeaderGapRow();
	}
	return buildDisplayRowAt(index - contentRowStart());
}

function treeItemNodeId(active: Element | null): string | undefined {
	if (!active || !active.closest) {
		return undefined;
	}
	const item = active.closest('#tree [role="treeitem"]');
	return item ? datasetId(item, 'nodeId') : undefined;
}

function focusedNodeId() {
	if (typeof document === 'undefined') {
		return undefined;
	}
	return treeItemNodeId(document.activeElement);
}

function applyRoving(id: string | undefined): void {
	for (const [renderedId, element] of renderedById) {
		element.tabIndex = renderedId === id ? 0 : -1;
	}
}

function toggleGuideActive(guide: Element): void {
	guide.classList.toggle(
		'guide-active',
		hoveredGuideId !== undefined && guide.getAttribute('data-container-id') === hoveredGuideId
	);
}

function applyGuideHover() {
	const win = treeView ? treeView.getWindowElement() : undefined;
	if (!win) {
		return;
	}
	for (const guide of win.querySelectorAll('.guide')) {
		toggleGuideActive(guide);
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

function restoreRenderedFocus(previousFocus: string | undefined): void {
	if (previousFocus === undefined) {
		return;
	}
	const element = renderedById.get(previousFocus);
	if (element) {
		element.focus({ preventScroll: true });
	}
}

function renderTreeWindow(force?: boolean): void {
	if (!treeView || !virtualScroll) {
		return;
	}
	treeView.render(virtualScroll.getViewport(), force === true);
	windowRange = virtualScroll.getVisibleRange();
	if (force === true) {
		syncContentWidth();
	}
}

function editorWindowReady(): boolean {
	return typeof document !== 'undefined' && treeView !== undefined && virtualScroll !== undefined;
}

function renderWindow(force?: boolean): void {
	if (!editorWindowReady()) {
		return;
	}
	hideRowMenu(false);
	const previousFocus = focusedNodeId();
	renderTreeWindow(force);
	const rovingId = resolveFocusId(
		previousFocus,
		Array.from(renderedById.keys()),
		focusId !== undefined ? focusId : selectedId
	);
	applyRoving(rovingId);
	restoreRenderedFocus(previousFocus);
	applyGuideHover();
}

function expandAncestors(id: string): boolean {
	let changed = false;
	for (const ancestorId of ancestorIds(rows, id)) {
		if (collapsed.delete(ancestorId)) {
			changed = true;
		}
	}
	return changed;
}

function ensureVisible(displayIndex: number): void {
	if (virtualScroll) {
		virtualScroll.scrollToIndex(displayIndex);
	}
}

function measuredWindowWidth(): number {
	const win = treeView ? treeView.getWindowElement() : undefined;
	return win && Number.isFinite(win.scrollWidth) ? win.scrollWidth : 0;
}

function shouldAdoptContentWidth(measured: number, paneWidth: number): boolean {
	return measured > contentWidth && (paneWidth <= 0 || measured > paneWidth);
}

function writeContentWidth(width: number): void {
	if (treeView) {
		treeView.setContentWidth(width);
	}
	if (virtualScroll) {
		virtualScroll.setContentWidth(width);
	}
}

function syncContentWidth(): void {
	const measured = measuredWindowWidth();
	const paneWidth = treeView ? treeView.clientWidth() : 0;
	// The window is at least the pane wide (`min-width: max(100%, …)`), so
	// `scrollWidth` equals the pane when the content is shorter. That pane width
	// must not become the content width, or resizing wider would ratchet the
	// selection fill and leave a horizontal scrollbar behind.
	if (!shouldAdoptContentWidth(measured, paneWidth)) {
		return;
	}
	contentWidth = measured;
	writeContentWidth(measured);
}

function focusRow(id: string): boolean {
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

function setDatasetFlag(element: HTMLElement, name: 'selected' | 'subtree', on: boolean): void {
	if (on) {
		element.dataset[name] = 'true';
	} else {
		delete element.dataset[name];
	}
}

function applySelectedRowState(element: HTMLElement, selected: boolean): void {
	element.setAttribute('aria-selected', selected ? 'true' : 'false');
	setDatasetFlag(element, 'selected', selected);
}

function applyRenderedSelection(id: string | undefined): void {
	for (const [renderedId, element] of renderedById) {
		applySelectedRowState(element, renderedId === id);
		setDatasetFlag(element, 'subtree', subtreeIds.has(renderedId) && renderedId !== id);
	}
}

function applyStructuralSubtree(): void {
	const scope = treeView ? treeView.getWindowElement() : tree;
	for (const structural of scope.querySelectorAll('.brace, .comment')) {
		const rowId = structural.dataset.rowId;
		setDatasetFlag(structural, 'subtree', rowId !== undefined && subtreeIds.has(rowId));
	}
}

function setSelection(id: string | undefined): void {
	selectedId = id;
	subtreeIds = new Set(subtreeRowIds(id, rows));
	applyRenderedSelection(id);
	applyStructuralSubtree();
	if (treeView) {
		treeView.refreshActiveLine();
	}
	updateInspector();
}

function selectItem(item: any): void {
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
	postToHost({ type: 'select', nodeId: id });
}

function rowIdOfTarget(item: string | { dataset?: { nodeId?: string } } | null | undefined): string | undefined {
	if (typeof item === 'string') {
		return item;
	}
	return item && item.dataset ? item.dataset.nodeId : undefined;
}

function revealItem(item: any): void {
	const id = rowIdOfTarget(item);
	if (id) {
		postToHost({ type: 'reveal', nodeId: id });
	}
}

function followItem(item: any): void {
	const id = rowIdOfTarget(item);
	if (id) {
		postToHost({ type: 'follow', nodeId: id });
	}
}

function restoreKeptFocus(keepFocusId: string): void {
	if (!displayIndexById.has(keepFocusId)) {
		return;
	}
	focusId = keepFocusId;
	const element = renderedById.get(keepFocusId);
	if (element) {
		applyRoving(keepFocusId);
		element.focus({ preventScroll: true });
	}
}

function flipCollapsed(id: string, keepFocusId?: string): void {
	const row = rowById.get(id);
	if (!row || !row.hasChildren) {
		return;
	}
	collapsed = new Set(toggleCollapsed(Array.from(collapsed), id, true));
	rebuildDisplay();
	renderWindow(true);
	if (keepFocusId) {
		restoreKeptFocus(keepFocusId);
	}
}

function expandSelectedForDisplay(id: string): void {
	// A host selection can point inside a collapsed subtree; expand its
	// ancestors before deciding whether the row is displayable, then let the
	// refreshed spacers take the new total height before scrolling to it.
	if (expandAncestors(id)) {
		rebuildDisplay();
		renderWindow(true);
	}
}

function focusSelectedRow(): boolean {
	const id = selectedId;
	if (id === undefined || !rowById.has(id)) {
		return false;
	}
	expandSelectedForDisplay(id);
	if (!displayIndexById.has(id)) {
		return false;
	}
	focusRow(id);
	return true;
}

function focusFirstVisibleRow(): void {
	const first = visibleNodeIds.length > 0 ? visibleNodeIds[0] : undefined;
	if (first !== undefined) {
		focusId = first;
		const element = renderedById.get(first);
		if (element) {
			applyRoving(first);
		}
	}
}

function prepareFocus() {
	if (focusSelectedRow()) {
		return;
	}
	focusFirstVisibleRow();
}

function appendTypeAhead(character: string): void {
	const now = Date.now();
	typeAhead.text = (now - typeAhead.at > 2000 ? '' : typeAhead.text) + character.toLowerCase();
	typeAhead.at = now;
}

function isTypeAheadMatch(id: string): boolean {
	const row = rowById.get(id);
	return !!row && row.label.toLowerCase().indexOf(typeAhead.text) === 0;
}

function typeAheadMatch(): string | undefined {
	const start = focusId !== undefined ? visibleNodeIds.indexOf(focusId) : -1;
	for (let step = 1; step <= visibleNodeIds.length; step++) {
		const id = visibleNodeIds[(start + step + visibleNodeIds.length) % visibleNodeIds.length];
		if (isTypeAheadMatch(id)) {
			return id;
		}
	}
	return undefined;
}

function typeAheadJump(character: string): void {
	appendTypeAhead(character);
	const match = typeAheadMatch();
	if (match !== undefined) {
		focusRow(match);
	}
}

function focusHeaderRow(target: Element): void {
	const header = target.closest('.document-tree-header-row');
	if (!(header instanceof HTMLElement)) {
		return;
	}
	header.tabIndex = 0;
	header.focus({ preventScroll: true });
}

function handleTreeTargetAction(target: Element, item: HTMLElement, id: string): void {
	// One interaction, one effect: the twisty toggles without moving the selection,
	// everything else selects.
	if (target.closest('.twisty')) {
		flipCollapsed(id);
		return;
	}
	selectItem(item);
	syncSearchToSelection(id);
	if (target.closest('.value-text') && item.dataset.kind === 'parameter') {
		beginDetailsEdit(id);
	}
}

function activateTreeTarget(target: Element, item: HTMLElement): void {
	const id = item.dataset.nodeId;
	if (id === undefined) {
		return;
	}
	handleTreeTargetAction(target, item, id);
}

function closestTreeItem(target: Element): HTMLElement | undefined {
	const item = target.closest('#tree [role="treeitem"]');
	return item instanceof HTMLElement ? item : undefined;
}

function onRowClick(event: MouseEvent): void {
	if (!(event.target instanceof Element)) {
		return;
	}
	const item = closestTreeItem(event.target);
	if (!item) {
		// Header rows are text lines: focus them, but never select or open Details.
		focusHeaderRow(event.target);
		// Annotation rows are aria-hidden decoration: clicking one changes nothing.
		return;
	}
	activateTreeTarget(event.target, item);
}

function onRowDoubleClick(event: MouseEvent): void {
	if (!(event.target instanceof Element)) {
		return;
	}
	const item = closestTreeItem(event.target);
	if (!item || event.target.closest('.twisty')) {
		return;
	}
	revealItem(item);
}

interface TreeKeyTarget {
	item: HTMLElement;
	row: EcucRow;
	id: string;
	at: number;
}

function treeItemId(item: HTMLElement): string {
	return item.dataset.nodeId ?? '';
}

function treeKeyTarget(event: KeyboardEvent): TreeKeyTarget | undefined {
	if (!(event.target instanceof Element)) {
		return undefined;
	}
	const item = closestTreeItem(event.target);
	if (!item) {
		return undefined;
	}
	const id = treeItemId(item);
	const row = rowById.get(id);
	if (!row) {
		return undefined;
	}
	return { item, row, id, at: visibleNodeIds.indexOf(id) };
}

function displayPageSize(displayIndex: number | undefined): number {
	const height = heightFn(displayIndex === undefined ? 0 : displayIndex);
	return Math.max(1, Math.floor((treeView ? treeView.clientHeight() : 0) / Math.max(1, height)));
}

function moveTreeFocus(event: KeyboardEvent, target: TreeKeyTarget): boolean {
	const page = displayPageSize(displayIndexById.get(target.id));
	const moved = moveTarget(event.key, target.at, visibleNodeIds.length, page);
	if (moved === undefined) {
		return false;
	}
	event.preventDefault();
	const nextId = visibleNodeIds[moved];
	if (nextId) {
		focusRow(nextId);
	}
	return true;
}

function focusFirstChild(target: TreeKeyTarget): void {
	const child = visibleNodeIds[target.at + 1];
	if (child) {
		focusRow(child);
	}
}

function handleArrowRight(event: KeyboardEvent, target: TreeKeyTarget): void {
	event.preventDefault();
	if (!target.row.hasChildren) {
		return;
	}
	if (collapsed.has(target.id)) {
		flipCollapsed(target.id, target.id);
		return;
	}
	focusFirstChild(target);
}

function handleArrowLeft(event: KeyboardEvent, target: TreeKeyTarget): void {
	event.preventDefault();
	if (target.row.hasChildren && !collapsed.has(target.id)) {
		flipCollapsed(target.id, target.id);
		return;
	}
	if (target.row.parentId !== null) {
		focusRow(target.row.parentId);
	}
}

function isRevealModifier(event: KeyboardEvent): boolean {
	return event.ctrlKey || event.altKey;
}

function handleEnter(event: KeyboardEvent, target: TreeKeyTarget): void {
	event.preventDefault();
	// Ctrl/Alt+Enter always reveals; a parameter opens its details editor,
	// a container toggles, and a leaf/reference reveals.
	if (isRevealModifier(event)) {
		revealItem(target.id);
		return;
	}
	if (target.row.kind === 'parameter') {
		beginDetailsEdit(target.id);
		return;
	}
	if (target.row.hasChildren) {
		flipCollapsed(target.id, target.id);
		return;
	}
	revealItem(target.id);
}

function handleFunctionKey(event: KeyboardEvent, target: TreeKeyTarget): void {
	event.preventDefault();
	if (target.row.kind === 'parameter') {
		beginDetailsEdit(target.id);
	}
}

function handleSelectKey(event: KeyboardEvent, target: TreeKeyTarget): void {
	event.preventDefault();
	selectItem(target.item);
}

function hasCommandModifier(event: KeyboardEvent): boolean {
	return event.ctrlKey || event.altKey || event.metaKey;
}

function isTypeAheadKey(event: KeyboardEvent): boolean {
	return event.key.length === 1 && !hasCommandModifier(event);
}

const TREE_ACTION_KEYS = new Map<string, (event: KeyboardEvent, target: TreeKeyTarget) => void>([
	['ArrowRight', handleArrowRight],
	['ArrowLeft', handleArrowLeft],
	['F2', handleFunctionKey],
	['Enter', handleEnter],
	[' ', handleSelectKey]
]);

function dispatchTreeAction(event: KeyboardEvent, target: TreeKeyTarget): boolean {
	const action = TREE_ACTION_KEYS.get(event.key);
	if (action) {
		action(event, target);
		return true;
	}
	if (isTypeAheadKey(event)) {
		typeAheadJump(event.key);
		return true;
	}
	return false;
}

function onTreeKeydown(event: KeyboardEvent): void {
	const target = treeKeyTarget(event);
	if (!target) {
		return;
	}
	if (moveTreeFocus(event, target)) {
		return;
	}
	dispatchTreeAction(event, target);
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

/** The toolbar toggle: flip the shell visibility; state values stay untouched. */
function toggleSidebar(): void {
	const hidden = !getSidebarState().hidden;
	setSidebarHidden(hidden);
	if (editorToolbar) {
		editorToolbar.setSidebarHidden(hidden);
	}
}

/** The one-shot Details action: show the sidebar on its Details tab. */
function showDetails(): void {
	setSidebarHidden(false);
	showSidebarTab('details');
	if (editorToolbar) {
		editorToolbar.setSidebarHidden(false);
	}
}

function isParameterRowId(id: string): boolean {
	const row = rowById.get(id);
	return !!row && row.kind === 'parameter';
}

function parameterIds(): string[] {
	return visibleNodeIds.filter(isParameterRowId);
}

function focusAdjacentFrom(parameters: string[], at: number, direction: string): string | undefined {
	const nextId = parameters[direction === 'next' ? at + 1 : at - 1];
	if (!nextId) {
		return undefined;
	}
	return focusRow(nextId) ? nextId : undefined;
}

function focusAdjacentParameter(fromId: string, direction: string): string | undefined {
	const parameters = parameterIds();
	const at = parameters.indexOf(fromId);
	if (at === -1) {
		return undefined;
	}
	return focusAdjacentFrom(parameters, at, direction);
}

function renderedItemFor(id: string): HTMLElement | undefined {
	return renderedById.get(id);
}

/** The row id at the current search position, or undefined when nothing is current. */
function currentMatchId() {
	const candidate = searchCandidates[searchMatches[searchIndex]];
	return candidate ? candidate.id : undefined;
}

/** The index of a row id in the current match list, or -1. */
function searchIndexOfId(id: string | undefined): number {
	if (id === undefined) {
		return -1;
	}
	const candidateIndex = searchCandidates.findIndex(function (candidate) {
		return candidate.id === id;
	});
	return candidateIndex < 0 ? -1 : searchMatches.indexOf(candidateIndex);
}

function setSearchBusy(busy: boolean): void {
	searchRunning = busy === true;
	renderSearchUi();
}

/**
 * Start a chunked search. previousId is preserved across progress/completion
 * and a re-scan; immediate skips the 120 ms debounce for a re-scan.
 */
function startSearch(query: string, previousId?: string, immediate?: boolean): void {
	const start = beginSearch<number>(searchEngine, query, previousId, setHighlightQuery);
	if (start === undefined) {
		resetSearchResults();
		return;
	}
	searchQuery = start.query;
	searchMatches = start.matches;
	searchIndex = start.index;
	searchFirstJumpDone = start.firstJumpDone;
	setSearchBusy(true);
	renderSearchUi();
	renderWindow(true);
	searchEngine.search(
		searchCandidates,
		start.query,
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
				searchIndex = retainedSearchIndex(
					wanted,
					searchMatches.length,
					searchIndexOfId,
					Math.min(Math.max(searchIndex, 0), searchMatches.length - 1)
				);
				renderSearchUi();
				renderWindow(true);
			},
			onComplete: function (matches) {
				const currentId = currentMatchId();
				searchMatches = matches;
				const wanted = currentId !== undefined ? currentId : previousId;
				searchIndex = retainedSearchIndex(wanted, searchMatches.length, searchIndexOfId, 0);
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

/** The count and control state: '1 / N', '0 / 0', or empty for a blank query. */
function renderSearchUi() {
	renderSearchCount(searchBar, searchBar.hasText(), searchQuery, searchMatches.length, searchIndex, searchRunning);
}

function jumpToHeader(candidate: EditorSearchCandidate): void {
	const index = candidate.headerIndex;
	if (index === undefined) {
		return;
	}
	ensureVisible(index);
	renderWindow(true);
	const element = treeView ? treeView.elementAt(index) : undefined;
	if (element) {
		element.tabIndex = 0;
		element.focus({ preventScroll: true });
	}
	renderSearchUi();
	searchBar.focus();
}

function jumpToNode(id: string): void {
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
	postToHost({ type: 'select', nodeId: id });
	renderWindow(true);
	renderSearchUi();
	searchBar.focus();
}

/** Move to one match: expand ancestors, rebuild, scroll, select, keep focus in Search. */
function jumpToSearchMatch(index: number): void {
	const candidate = searchCandidates[searchMatches[index]];
	if (!candidate) {
		return;
	}
	if (candidate.headerIndex !== undefined) {
		jumpToHeader(candidate);
		return;
	}
	jumpToNode(candidate.id);
}

/** Cycle matches with wrapping; no-op when the query has no candidates. */
function cycleSearch(direction: number): void {
	if (searchMatches.length === 0) {
		return;
	}
	searchIndex = stepMatch(searchMatches, searchIndex, direction === -1 ? -1 : 1);
	jumpToSearchMatch(searchIndex);
}

/** Drop the active result set without touching the search field text. */
function resetSearchResults() {
	searchEngine.clear();
	searchQuery = '';
	searchMatches = [];
	searchIndex = -1;
	setHighlightQuery('');
	searchFirstJumpDone = false;
	setSearchBusy(false);
	renderSearchUi();
	renderWindow(true);
}

function firstVisibleNodeId(): string | undefined {
	return visibleNodeIds.length > 0 ? visibleNodeIds[0] : undefined;
}

function searchReturnTarget(): string | undefined {
	if (selectedId !== undefined && displayIndexById.has(selectedId)) {
		return selectedId;
	}
	return firstVisibleNodeId();
}

/** Escape returns focus to the tree: the selected row when visible, else the first. */
function focusTreeAfterSearch() {
	const id = searchReturnTarget();
	if (id !== undefined) {
		focusRow(id);
	}
}

/** A row click while search is active makes that row the current match. */
function syncSearchToSelection(id: string): void {
	if (searchQuery.trim() === '') {
		return;
	}
	const candidateIndex = searchCandidates.findIndex(function (candidate) {
		return candidate.id === id;
	});
	if (candidateIndex < 0) {
		return;
	}
	const at = searchMatches.indexOf(candidateIndex);
	if (at >= 0) {
		searchIndex = at;
		renderSearchUi();
		// The stronger current-match mark follows the row flag, so repaint the window.
		renderWindow(true);
	}
}

/** One inspector row: a label span and a code/empty container. */
function inspectorRow(key: string, value: string): HTMLElement {
	const row = inspectorElement('div', 'inspector-row');
	row.appendChild(inspectorElement('span', 'inspector-key', key));
	row.appendChild(inspectorElement('div', 'inspector-code', value));
	return row;
}

/** A Details row whose value is a token-coloured, wrapped condition expression. */
function conditionCodeRow(key: string, text: string): HTMLElement {
	const row = inspectorElement('div', 'inspector-row');
	row.appendChild(inspectorElement('span', 'inspector-key', key));
	const code = inspectorElement('div', 'inspector-code condition-code');
	appendConditionTokens(code, text, '');
	row.appendChild(code);
	return row;
}

function paneActions(body: HTMLElement): HTMLElement {
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

function setDetailsStatus(message: any): void {
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

function appendInspectorField(key: string, value: string): void {
	detailsBody.appendChild(inspectorRow(key, value));
}

function renderEmptyInspector(): void {
	detailsSelectionChanged(undefined);
	const emptyPanel = inspectorElement('div', 'inspector-empty');
	emptyPanel.appendChild(inspectorElement('p', '', 'Select a line to see its details.'));
	emptyPanel.appendChild(inspectorElement('p', 'inspector-hint', 'Click a line or press Space.'));
	detailsBody.appendChild(emptyPanel);
}

function renderIdentityFields(row: EcucRow, data: InspectorFields): void {
	detailsBody.appendChild(inspectorElement('div', 'inspector-kind', data.kind));
	detailsBody.appendChild(inspectorElement('div', 'inspector-label', data.label));
	if (row.kind === 'container') {
		// A container's short name and definition ref are editable here, so the panel
		// never shows the same fact twice.
		detailsBody.appendChild(detailsContainerFields(row, data));
		return;
	}
	if (data.definitionRef) {
		appendInspectorField('Definition', data.definitionRef);
	}
	if (data.shortName) {
		appendInspectorField('Short name', data.shortName);
	}
}

function renderTypeFields(data: InspectorFields): void {
	if (data.variant) {
		appendInspectorField('Variant', data.variant);
	}
	if (data.type) {
		appendInspectorField('Type', data.type);
	}
}

function renderParameterValue(row: EcucRow, data: InspectorFields): void {
	if (data.kind === 'parameter') {
		detailsBody.appendChild(detailsValueInput(row, data));
	}
	for (const format of data.formats) {
		appendInspectorField(format.label, format.value);
	}
}

function renderReferenceFields(row: EcucRow, data: InspectorFields): void {
	if (data.target) {
		appendInspectorField('Target', data.target);
	}
	if (row.followReason !== undefined) {
		appendInspectorField('Target note', row.followReason);
	}
	if (data.context) {
		appendInspectorField('Context', data.context);
	}
}

function renderValueFields(row: EcucRow, data: InspectorFields): void {
	renderParameterValue(row, data);
	renderReferenceFields(row, data);
}

function renderCondition(condition: RowCondition): void {
	detailsBody.appendChild(conditionCodeRow('Condition', condition.text));
	appendInspectorField('Condition state', condition.state);
	if (condition.reason) {
		appendInspectorField('Condition note', condition.reason);
	}
}

function renderConditionFields(row: EcucRow, data: InspectorFields): void {
	if (data.condition) {
		renderCondition(data.condition);
	} else if (row.disabled && row.disabledBy === 'ancestor') {
		appendInspectorField('Disabled', 'Disabled by an ancestor condition.');
	}
}

function renderConditionSummary(data: InspectorFields): void {
	if (data.conditions) {
		detailsBody.appendChild(conditionCodeRow('Conditions', data.conditions));
	}
	if (data.annotations) {
		appendInspectorField('Annotations', data.annotations);
	}
}

function isAmbiguousDefinitionCount(count: number | undefined): boolean {
	return count !== undefined && count >= 2;
}

function renderDefinitionFields(data: InspectorFields): void {
	if (data.definition) {
		for (const field of definitionRows(data.definition)) {
			appendInspectorField(field.label, field.value);
		}
		return;
	}
	if (isAmbiguousDefinitionCount(data.definitionCount)) {
		appendInspectorField('Definition type', `${data.definitionCount} definitions found`);
	}
}

function isFollowableReference(row: EcucRow): boolean {
	return row.kind === 'reference' && row.followable === true;
}

function isReferenceContainer(row: EcucRow): boolean {
	return row.kind === 'module' || row.kind === 'container';
}

function appendJumpAction(actions: HTMLElement, row: EcucRow): void {
	if (!isFollowableReference(row)) {
		return;
	}
	const jump = inspectorElement('button', 'sb-btn sb-btn-secondary', 'Jump to target') as HTMLButtonElement;
	jump.type = 'button';
	jump.addEventListener('click', function () { followItem(row.id); });
	actions.appendChild(jump);
}

function appendReferencesAction(actions: HTMLElement, row: EcucRow): void {
	if (!isReferenceContainer(row)) {
		return;
	}
	const references = inspectorElement('button', 'sb-btn sb-btn-secondary', 'Find references') as HTMLButtonElement;
	references.type = 'button';
	references.addEventListener('click', function () { postToHost({ type: 'references', nodeId: row.id }); });
	actions.appendChild(references);
}

function appendRevealAction(actions: HTMLElement, row: EcucRow): void {
	const reveal = inspectorElement('button', 'sb-btn sb-btn-secondary', 'Reveal in source') as HTMLButtonElement;
	reveal.type = 'button';
	reveal.addEventListener('click', function () { revealItem(row.id); });
	actions.appendChild(reveal);
}

function renderInspectorActions(row: EcucRow): void {
	const actions = paneActions(detailsBody);
	appendJumpAction(actions, row);
	appendReferencesAction(actions, row);
	appendRevealAction(actions, row);
}

function selectedRowForInspector(): EcucRow | undefined {
	return selectedId === undefined ? undefined : rowById.get(selectedId);
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
	const row = selectedRowForInspector();
	if (!row) {
		renderEmptyInspector();
		return;
	}
	detailsSelectionChanged(row.id);
	const data = inspectorFields(row);
	renderIdentityFields(row, data);
	renderTypeFields(data);
	renderValueFields(row, data);
	renderConditionFields(row, data);
	renderConditionSummary(data);
	renderDefinitionFields(data);
	renderInspectorActions(row);
}

function clearGuideHover(): void {
	if (hoveredGuideId === undefined) {
		return;
	}
	hoveredGuideId = undefined;
	applyGuideHover();
}

function datasetId(element: Element, key: string): string | undefined {
	if (element instanceof HTMLElement) {
		return element.dataset[key];
	}
	return element instanceof SVGElement ? element.dataset[key] : undefined;
}

function hoverOwnerId(target: Element): string | undefined {
	const item = target.closest('#tree [role="treeitem"]');
	if (item) {
		return datasetId(item, 'nodeId');
	}
	const brace = target.closest('#tree .brace[data-row-id]');
	if (brace) {
		return datasetId(brace, 'rowId');
	}
	const comment = target.closest('#tree .comment[data-row-id]');
	return comment ? datasetId(comment, 'rowId') : undefined;
}

function parentRow(row: EcucRow): EcucRow | undefined {
	return row.parentId === null ? undefined : rowById.get(row.parentId);
}

function hoveringContainerId(ownerId: string): string | undefined {
	let row = rowById.get(ownerId);
	while (row && !row.hasChildren) {
		row = parentRow(row);
	}
	return row ? row.id : undefined;
}

function onTreeHover(event: MouseEvent): void {
	if (!(event.target instanceof Element)) {
		return;
	}
	const ownerId = hoverOwnerId(event.target);
	if (ownerId === undefined) {
		clearGuideHover();
		return;
	}
	const id = hoveringContainerId(ownerId);
	if (id !== hoveredGuideId) {
		hoveredGuideId = id;
		applyGuideHover();
	}
}

// Ctrl/Cmd+F is the find shortcut; F3/Shift+F3 cycle while a search query is
// active. Both are document-level so they work from the tree and the input.
function isCommandKey(event: KeyboardEvent): boolean {
	return event.ctrlKey || event.metaKey;
}

function isFindShortcut(event: KeyboardEvent): boolean {
	return isCommandKey(event) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f';
}

function isSearchCycleKey(event: KeyboardEvent): boolean {
	return event.key === 'F3' && searchQuery.trim() !== '';
}

function onDocumentKeydown(event: KeyboardEvent): void {
	if (isFindShortcut(event)) {
		event.preventDefault();
		searchBar.focus();
		return;
	}
	if (isSearchCycleKey(event)) {
		event.preventDefault();
		cycleSearch(event.shiftKey ? -1 : 1);
	}
}

/** Bind the document-level gestures once the page refs exist. */
function mountEditorDomListeners(): void {
document.addEventListener('click', onRowClick);
document.addEventListener('dblclick', onRowDoubleClick);
document.addEventListener('keydown', onTreeKeydown);
mountContextMenu(tree, {
	selectItem: selectItem,
	rowElement: renderedItemFor,
	onAction: function (action, nodeId) { postToHost({ type: action, nodeId }); }
});
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
	const item = event.target.closest('#tree [role="treeitem"]') as HTMLElement | null;
	if (item) {
		focusId = item.dataset.nodeId;
		applyRoving(focusId);
	}
});
document.addEventListener('keydown', onDocumentKeydown);

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
}

type EditorDocumentMessage = Extract<EditorProviderToWebview, { type: 'document' }>;
type EditorSelectMessage = Extract<EditorProviderToWebview, { type: 'select' }>;
type EditorNoticeMessage = Extract<EditorProviderToWebview, { type: 'notice' }>;

function storedScrollTop(): number {
	return virtualScroll ? virtualScroll.getScrollTop() : 0;
}

function documentFocusId(): string | undefined {
	return focusedNodeId() || focusId;
}

function isIndexOutsideWindow(index: number): boolean {
	return index < windowRange[0] || index >= windowRange[1];
}

function isCurrentSelectionVisible(): boolean {
	return selectedId !== undefined && displayIndexById.has(selectedId);
}

function ensureSelectedRowVisible(): void {
	if (selectedId === undefined) {
		return;
	}
	const index = displayIndexById.get(selectedId);
	if (index !== undefined && isIndexOutsideWindow(index)) {
		ensureVisible(index);
	}
}

function alignDocumentFocus(previousFocus: string | undefined): void {
	if (isCurrentSelectionVisible()) {
		focusId = selectedId;
		ensureSelectedRowVisible();
		return;
	}
	if (previousFocus !== undefined && displayIndexById.has(previousFocus)) {
		focusId = previousFocus;
	}
}

function applyDocumentMessage(message: EditorDocumentMessage): void {
	clearDetailsStatus();
	const scrollTop = storedScrollTop();
	const previousFocus = documentFocusId();
	setRows(message.document.rows, message.document.selectedId, message.document.header);
	renderWindow(true);
	if (virtualScroll) {
		virtualScroll.setScrollTop(scrollTop, true);
	}
	alignDocumentFocus(previousFocus);
	renderWindow(true);
	updateInspector();
	applyDisabledCount();
}

function applySelectMessage(nodeId: string): void {
	clearDetailsStatus();
	if (expandAncestors(nodeId)) {
		rebuildDisplay();
		renderWindow(true);
	}
	focusRow(nodeId);
	setSelection(nodeId);
}

function handleSelectMessage(message: EditorSelectMessage): void {
	const nodeId = message.nodeId;
	if (typeof nodeId !== 'string' || !rowById.has(nodeId)) {
		return;
	}
	applySelectMessage(nodeId);
}

function applyNoticeMessage(message: EditorNoticeMessage): void {
	if (message.scope === 'conditions') {
		setConditionsStatus(message.message || '');
		return;
	}
	if (refusalShownInDetails(message, getSidebarState().tab !== 'details')) {
		// The details editor answers this field inline; there is no separate banner.
		clearDetailsStatus();
		return;
	}
	// Recoverable warnings belong in the Details tab.
	setDetailsStatus(message);
}

function applyErrorMessage(text: string): void {
	setDetailsStatus({ message: text, kind: 'warn' });
}

function handleDocumentMessage(message: EditorProviderToWebview): boolean {
	if (message.type === 'conditions') {
		renderConditionEntries(message.entries);
		return true;
	}
	if (message.type === 'document') {
		applyDocumentMessage(message);
		return true;
	}
	return false;
}

function handleInteractionMessage(message: EditorProviderToWebview): boolean {
	if (message.type === 'select') {
		handleSelectMessage(message);
		return true;
	}
	if (message.type === 'notice') {
		applyNoticeMessage(message);
		return true;
	}
	if (message.type === 'error') {
		applyErrorMessage(message.message);
		return true;
	}
	return false;
}

/** One host protocol message. The Details editor sees it first so a re-scan clears drafts. */
export function handleEditorMessage(message: EditorProviderToWebview): void {
	if (!message) {
		return;
	}
	handleDetailsEditorMessage(message);
	if (handleDocumentMessage(message)) {
		return;
	}
	handleInteractionMessage(message);
}


// The host warns when this never arrives: a page whose script is blocked cannot
// report its own failure, so the absence of this message is the only signal.
export function mountEditor(): void {
	resetEditorState();
	tree = document.getElementById('tree');
	inspector = document.getElementById('inspector');
	detailsStatus = document.getElementById('details-status');
	detailsBody = document.getElementById('sb-details-body');
	reportError = installConsoleErrors(window, console, 'ECUC editor').report;
	window.addEventListener('message', function (event) {
		handleEditorMessage(event.data as EditorProviderToWebview);
	});
	mountEditorDomListeners();
// Components are mounted once; the shell (tab, width, pane heights, collapsed
// sections) survives a re-scan because it lives outside the rows.
setSidebarState(readPageState<SidebarUiState>());
setSidebarPersistence(function () { writePageState(getSidebarState()); });
setConditionRows([]);
setConditionsCallback(function (entries) { postToHost({ type: 'conditions', entries }); });
setConditionsErrorReporter(reportError);
setDetailsEditorHost({
	getRow: function (id) { return rowById.get(id); },
	getSelectedId: function () { return selectedId; },
	isDetailsTab: function () { return getSidebarState().tab === 'details'; },
	showTab: showSidebarTab,
	showSection: showSidebarSection,
	renderedItem: renderedItemFor,
	selectItem: selectItem,
	setSelection: setSelection,
	postSelect: function (id) { postToHost({ type: 'select', nodeId: id }); },
	focusRow: focusRow,
	updateInspector: updateInspector,
	commitEdit: function (message) { postToHost(message); },
	focusAdjacentParameter: focusAdjacentParameter
});
mountConditionsPanel();
mountSidebarShell();
const toolbar = new EditorToolbar({
	onCollapseAll: collapseAll,
	onExpandAll: expandAll,
	onToggleSidebar: toggleSidebar,
	onDetails: showDetails,
});
editorToolbar = toolbar;
toolbar.mount();
toolbar.setSidebarHidden(getSidebarState().hidden);
searchBar = mountSearchBar(
	'',
	() => searchQuery,
	() => searchMatches.length > 0,
	resetSearchResults,
	startSearch,
	cycleSearch,
	renderSearchUi,
	setHighlightQuery,
	false,
	focusTreeAfterSearch
);
virtualScroll = new VirtualScroll(
	'#tree',
	[{ id: 'tree-pane', className: 'document-tree-pane document-tree', role: 'presentation' }],
	{
		onViewportChange: function () {
			renderWindow(false);
		}
	}
);
virtualScroll.mount();
const treePane = virtualScroll.getPane(0);
treeView = new DocumentTreeView(treePane, 'document', {
	onRender: collectRendered
});
treeView.mount();
setRows([], undefined);
renderWindow(true);
prepareFocus();
applyDisabledCount();
updateInspector();
// The host warns when this never arrives: a page whose script is blocked cannot
// report its own failure, so the absence of this message is the only signal.
postToHost({ type: 'ready' });
}

/** A page reload starts from the initial protocol state, exactly like a fresh bundle. */
function resetEditorState(): void {
	rows = [];
	rowById = new Map();
	rowIndexById = new Map();
	displayRows = [];
	displayIndexById = new Map();
	visibleNodeIds = [];
	expandedIds = new Set();
	collapsed = new Set();
	selectedId = undefined;
	subtreeIds = new Set();
	guideLevels = [];
	hoveredGuideId = undefined;
	focusId = undefined;
	headerRows = [];
	headerRowCount = 0;
	headerGapCount = 0;
	offsets = [0];
	contentWidth = 0;
	searchCandidates = [];
	searchQuery = '';
	searchMatches = [];
	searchIndex = -1;
	searchRunning = false;
	searchFirstJumpDone = false;
	windowRange = [0, 0];
	renderedById = new Map();
	heights = { document: 20 };
	chWidth = 0;
	heightFn = function () { return heights.document; };
	typeAhead = { text: '', at: 0 };
	virtualScroll = undefined;
	treeView = undefined;
	resetVsCodeApi();
	resetDetailsEditorState();
	setHighlightQuery('');
}

if (typeof document !== 'undefined' && document.getElementById('tree')) {
	mountEditor();
}
