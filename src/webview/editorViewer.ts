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
import type { EcucRow } from '../core/ecuc/renderRows';
import {
	FlatRow,
	ancestorIds,
	carriesGroupGap,
	flattenRows,
	stepMatch,
} from './render/treeQuery';
import {
	buildDocumentBraceRow,
	buildDocumentCommentRow,
	buildDocumentNodeRow,
} from './components/documentTree/documentRows';
import { DocumentTreeView, DocumentTreeHeader } from './components/documentTree/documentTreeView';
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
	getSidebarState,
	mountSidebarShell,
	setSidebarPersistence,
	setSidebarState,
	showSidebarSection,
	showSidebarTab,
	SidebarUiState,
} from './components/sidebar/sidebar';
import { inspectorFields, refusalShownInDetails } from './components/sidebar/detailsPanel/detailsPanel';
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
import { SearchBar } from './components/searchBar/searchBar';
import { hideRowMenu, mountContextMenu } from './components/contextMenu/contextMenu';
import { appendConditionTokens, setHighlightQuery } from './render/rowView';
import { installConsoleErrors } from './render/pageError';
import { postToHost, readPageState, resetVsCodeApi, writePageState } from './vscodeApi';
import type { EditorDocumentHeader, EditorProviderToWebview } from '../webviewProtocol';

export type { EditorDocumentHeader, EditorDocumentPayload, EditorProviderToWebview } from '../webviewProtocol';
export { documentHeader } from '../webviewProtocol';


let tree: any;
let inspector: any;
let detailsStatus: any;
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
let heightFn: (index: number) => number = function () { return heights.document; };
let typeAhead = { text: '', at: 0 };
// The one Document surface. It owns the header, the native scroller, the
// spacers and the rendered window; this page owns the row model and state.
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

function setRows(nextRows: any, nextSelectedId?: string, nextHeader?: DocumentTreeHeader): void {
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
	setConditionRows(rows);
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
		setHighlightQuery('');
		setSearchBusy(false);
		renderSearchUi();
	}
}

function applyHeader(header: DocumentTreeHeader | undefined): void {
	if (!treeView) {
		return;
	}
	treeView.setHeader({
		schema: header && header.schema ? header.schema : undefined,
		packages: header && Array.isArray(header.packages) ? header.packages : []
	});
}

/** The host half of the component: the rows for one display index. */
function documentRowOptions(displayIndex: number): any {
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

function buildNodeRow(row: EcucRow, displayIndex: number): any {
	return buildDocumentNodeRow(row, documentRowOptions(displayIndex));
}

function buildBraceRow(flat: any, displayIndex: number): any {
	return buildDocumentBraceRow(flat.type, flat.level, rows[flat.rowIndex].id, documentRowOptions(displayIndex));
}

function buildCommentRow(flat: any, displayIndex: number): any {
	return buildDocumentCommentRow(flat.text, flat.level, rows[flat.rowIndex].id, documentRowOptions(displayIndex));
}

function buildDisplayRow(flat: any, displayIndex: number): any {
	if (flat.type === 'comment') {
		return buildCommentRow(flat, displayIndex);
	}
	return flat.type === 'node'
		? buildNodeRow(rows[flat.rowIndex], displayIndex)
		: buildBraceRow(flat, displayIndex);
}

function renderRow(index: number): any {
	const flat = displayRows[index];
	return flat ? buildDisplayRow(flat, index) : document.createElement('div');
}

function focusedNodeId() {
	const active = document.activeElement;
	if (active && active.closest) {
		const item = active.closest('#tree [role="treeitem"]') as HTMLElement | null;
		if (item) {
			return item.dataset.nodeId;
		}
	}
	return undefined;
}

function applyRoving(id: string | undefined): void {
	for (const [renderedId, element] of renderedById) {
		element.tabIndex = renderedId === id ? 0 : -1;
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

function renderWindow(force?: boolean): void {
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
	if (treeView) {
		treeView.scrollToIndex(displayIndex);
	}
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

function setSelection(id: string | undefined): void {
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
	for (const structural of (treeView ? treeView.getWindowElement() : tree).querySelectorAll('.brace, .comment')) {
		if (structural.dataset.rowId !== undefined && subtreeIds.has(structural.dataset.rowId)) {
			structural.dataset.subtree = 'true';
		} else {
			delete structural.dataset.subtree;
		}
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

function revealItem(item: any): void {
	const id = typeof item === 'string' ? item : item && item.dataset ? item.dataset.nodeId : undefined;
	if (id) {
		postToHost({ type: 'reveal', nodeId: id });
	}
}

function followItem(item: any): void {
	const id = typeof item === 'string' ? item : item && item.dataset ? item.dataset.nodeId : undefined;
	if (id) {
		postToHost({ type: 'follow', nodeId: id });
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

function typeAheadJump(character: string): void {
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

function onRowClick(event: any): void {
	if (!(event.target instanceof Element)) {
		return;
	}
	const item = event.target.closest('#tree [role="treeitem"]');
	if (!item) {
		// Annotation rows are aria-hidden decoration: clicking one changes nothing.
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

function onRowDoubleClick(event: any): void {
	if (!(event.target instanceof Element)) {
		return;
	}
	const item = event.target.closest('#tree [role="treeitem"]');
	if (!item || event.target.closest('.twisty')) {
		return;
	}
	revealItem(item);
}

function onTreeKeydown(event: any): void {
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
	const page = Math.max(1, Math.floor((treeView ? treeView.clientHeight() : 0) / Math.max(1, heightFn(displayIndex === undefined ? 0 : displayIndex))));
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

function focusAdjacentParameter(fromId: string, direction: string): string | undefined {
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

function renderedItemFor(id: string): HTMLElement | undefined {
	return renderedById.get(id);
}

/** The row id at the current search position, or undefined when nothing is current. */
function currentMatchId() {
	const rowIndex = searchMatches[searchIndex];
	const row = rowIndex === undefined ? undefined : rows[rowIndex];
	return row ? row.id : undefined;
}

/** The index of a row id in the current match list, or -1. */
function searchIndexOfId(id: string | undefined): number {
	if (id === undefined) {
		return -1;
	}
	const rowIndex = rowIndexById.get(id);
	return rowIndex === undefined ? -1 : searchMatches.indexOf(rowIndex);
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

/** Move to one match: expand ancestors, rebuild, scroll, select, keep focus in Search. */
function jumpToSearchMatch(index: number): void {
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
	postToHost({ type: 'select', nodeId: id });
	renderWindow(true);
	renderSearchUi();
	searchBar.focus();
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

/** Enter: start a changed query, or move through the current result set. */
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

/** Clear the search and its highlight; optionally return focus to it. */
function clearSearch(focusInput: boolean): void {
	searchBar.setValue('');
	resetSearchResults();
	if (focusInput) {
		searchBar.focus();
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
function syncSearchToSelection(id: string): void {
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

function inspectorElement(tag: string, className?: string, text?: string): HTMLElement {
	const element = document.createElement(tag);
	if (className) {
		element.className = className;
	}
	if (text !== undefined) {
		element.textContent = text;
	}
	return element;
}

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
		const jump = inspectorElement('button', 'sb-btn sb-btn-secondary', 'Jump to target') as HTMLButtonElement;
		jump.type = 'button';
		jump.addEventListener('click', function () { followItem(row.id); });
		actions.appendChild(jump);
	}
	const reveal = inspectorElement('button', 'sb-btn sb-btn-secondary', 'Reveal in source') as HTMLButtonElement;
	reveal.type = 'button';
	reveal.addEventListener('click', function () { revealItem(row.id); });
	actions.appendChild(reveal);
}

function onTreeHover(event: any): void {
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
// Ctrl/Cmd+F is the find shortcut; F3/Shift+F3 cycle while a search query is
// active. Both are document-level so they work from the tree and the input.
document.addEventListener('keydown', function (event) {
	if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
		event.preventDefault();
		searchBar.focus();
	} else if (event.key === 'F3' && searchQuery.trim() !== '') {
		event.preventDefault();
		cycleSearch(event.shiftKey ? -1 : 1);
	}
});

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

/** One host protocol message. The Details editor sees it first so a re-scan clears drafts. */
export function handleEditorMessage(message: EditorProviderToWebview): void {
	if (!message) {
		return;
	}
	handleDetailsEditorMessage(message);
	if (message.type === 'conditions') {
		renderConditionEntries(message.entries);
		return;
	}
	if (message.type === 'document') {
		clearDetailsStatus();
		const scrollTop = treeView ? treeView.getScrollTop() : 0;
		const previousFocus = focusedNodeId() || focusId;
		setRows(message.document.rows, message.document.selectedId, message.document.header);
		renderWindow(true);
		if (treeView) {
			treeView.setScrollTop(scrollTop);
		}
		if (selectedId !== undefined && displayIndexById.has(selectedId)) {
			focusId = selectedId;
			const index = displayIndexById.get(selectedId);
			if (index !== undefined && (index < windowRange[0] || index >= windowRange[1])) {
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
	} else if (message.type === 'error') {
		setDetailsStatus({ message: message.message, kind: 'warn' } as any);
	}
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
const editorToolbar = new EditorToolbar({ onCollapseAll: collapseAll, onExpandAll: expandAll });
editorToolbar.mount();
searchBar = new SearchBar('', {
	onExecute: function (direction) { executeSearch(direction); },
	onCycle: function (direction) { cycleSearch(direction); },
	onClear: function () { resetSearchResults(); },
	onEscape: function () { clearSearch(false); focusTreeAfterSearch(); },
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
treeView = new DocumentTreeView('#tree', 'document', {
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
	searchQuery = '';
	searchMatches = [];
	searchIndex = -1;
	searchRunning = false;
	searchFirstJumpDone = false;
	windowRange = [0, 0];
	renderedById = new Map();
	heights = { document: 20 };
	heightFn = function () { return heights.document; };
	typeAhead = { text: '', at: 0 };
	treeView = undefined;
	resetVsCodeApi();
	resetDetailsEditorState();
	setHighlightQuery('');
}

if (typeof document !== 'undefined' && document.getElementById('tree')) {
	mountEditor();
}
