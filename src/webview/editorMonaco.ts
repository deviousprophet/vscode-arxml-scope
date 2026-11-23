/**
 * The Monaco ECUC editor page.
 *
 * The host owns scanning, ordering and every write. This page serializes the
 * row store into the synthetic ECUC document, mounts the real VS Code editor on
 * it, and keeps the toolbar, Details/Conditions sidebar and find widget around
 * the editor surface.
 */
import './styles/tokens.css';
import './styles/base.css';
import './monaco/monaco.css';
import type { EcucRow, RowCondition } from '../core/ecuc/renderRows';
import { lastShortName } from '../core/ecuc/model';
import type {
	EditorDocumentHeader,
	EditorProviderToWebview,
	EditorRowPatch,
	MonacoSettings
} from '../webviewProtocol';
import type { FindMatch, FindOptions } from '../core/searchModel';
import {
	buildSyntheticDocument,
	displayForRaw,
	escapeNewlines,
	searchRangeOnLine,
	spanTextForRaw,
	syntheticRowLine,
	type SyntheticDocument,
	type SyntheticLine,
	type FieldSpan
} from './monaco/synthetic';
import {
	compareEditFlushOrder,
	draftKey,
	remapDraftMap,
	remapDraftNodeId,
	remapNodeId,
	resolveRenameIntents,
	type EditField,
	type RenameIntent,
	type RenameResolution
} from '../core/ecuc/editOrder';
import { fieldTextFromWholeLine } from '../core/ecuc/lineEdit';
import { localValueError } from '../core/ecuc/valueValidation';
import { createEcucEditor, defineEcucTheme, ensureMonacoEnvironment, monaco, setModelFolding } from './monaco/setup';
import { installFindBridge, startFindController, type MonacoFindMatch } from './monaco/findBridge';
import { EditorToolbar } from './components/toolbar/toolbar';
import {
	getSidebarState,
	mountSidebarShell,
	setSidebarHidden,
	setSidebarPersistence,
	setSidebarState,
	showSidebarSection,
	showSidebarTab,
	type SidebarUiState
} from './components/sidebar/sidebar';
import { refusalShownInDetails } from './components/sidebar/detailsPanel/detailsPanel';
import type { InspectorFields } from './components/sidebar/detailsPanel/detailsPanel';
import {
	beginDetailsEdit,
	detailsContainerFields,
	detailsEditorHostBase,
	detailsValueInput,
	handleDetailsEditorMessage,
	resetDetailsEditorState,
	setDetailsEditorHost,
	syncDetailsField
} from './components/detailsEditor/detailsEditor';
import { createInspectorRows } from './components/detailsEditor/inspectorRows';
import {
	applyDisabledCount,
	ensureDiscoveredConditionRows,
	mountConditionsPanel,
	renderConditionEntries,
	setConditionRows,
	setConditionsCallback,
	setConditionsErrorReporter,
	setConditionsStatus
} from './components/sidebar/conditionsPanel/conditionsPanel';
import { installConsoleErrors } from './render/pageError';
import { postToHost, readPageState, resetVsCodeApi, writePageState } from './vscodeApi';

let rows: EcucRow[] = [];
let rowById = new Map<string, EcucRow>();
let rowIndexById = new Map<string, number>();
let header: EditorDocumentHeader | undefined;
let documentModel: SyntheticDocument = buildSyntheticDocument([]);
let editor: monaco.editor.IStandaloneCodeEditor | undefined;
let model: monaco.editor.ITextModel | undefined;
let editorToolbar: EditorToolbar | undefined;
let selectedId: string | undefined;
let subtreeIds = new Set<string>();
interface NativeFindQuery {
	query: string;
	options: FindOptions;
}
interface NativeFindState {
	isRevealed: boolean;
	isReplaceRevealed: boolean;
	searchString: string;
	replaceString: string;
	preserveCase: boolean;
	isRegex: boolean;
	wholeWord: boolean;
	matchCase: boolean;
	matchesPosition: number;
	matchesCount: number;
}
interface NativeFindController {
	getState?(): NativeFindState;
	start?(opts: unknown, state?: unknown): Promise<void>;
	replace?(): boolean;
	replaceAll?(): boolean;
}
interface ReplaceTarget {
	rowId: string;
	field: 'label' | 'value' | 'meta';
	start: number;
	end: number;
}
type EditorMessage<T extends EditorProviderToWebview['type']> = Extract<EditorProviderToWebview, { type: T }>;
let nativeFindCache = new Map<string, MonacoFindMatch[]>();
let nativeFindQueries = new Map<string, NativeFindQuery>();
let nativeFindRequested = new Set<string>();
let nativeFindRequests = new Map<number, string>();
let nativeFindRequestId = 0;
let nativeReplaceRequestId = 0;
let applyingModel = false;
/** True while a host document/patch is replacing the model and the selection. */
let restoringView = false;
interface QueuedEdit {
	type: 'edit';
	editId: number;
	nodeId: string;
	field?: EditField;
	/** The host value, after any display-to-raw conversion. */
	value: string;
	/** The text the synthetic field span holds: the value, newlines escaped. */
	display: string;
}
let pendingEdits = new Map<string, QueuedEdit>();
let inflightEdits = new Map<number, QueuedEdit>();
/**
 * Short-name writes whose new path id the row store has not shown yet. The
 * host may answer `editResult` before its re-scan, so this outlives the
 * in-flight entry; `applyRows` resolves it against the next row store.
 */
let renameIntents = new Map<number, RenameIntent>();
/** old id -> new id proved by the rebuild in progress; consumed by that rebuild. */
let resolvedRenames = new Map<string, string>();
/**
 * True after a local undo until a new edit or host refresh. Undoing a draft all
 * the way back to the accepted value drops the pending entry, but redo must
 * still be able to restore the draft from Monaco's model stack.
 */
let localUndoActive = false;
let editSequence = 0;
let hostRevision = 0;
let hostDirty = false;
/** True once the host proves it speaks the revisioned edit protocol. */
let hostAcks = false;
const flushRequests = new Set<number>();
interface InvalidEdit {
	nodeId: string;
	field: EditField;
	message: string;
	display: string;
	editId: number;
}
let invalidEdits = new Map<string, InvalidEdit>();
let saveRequested = false;
let localErrorShown = false;
let errorStrip: HTMLElement | null = null;
let decorationIds: string[] = [];
let detailsBody: HTMLElement | null = null;
let detailsStatus: HTMLElement | null = null;
let reportError: (text: string) => void = function () {};
let mounted = false;
const pendingMessages: EditorProviderToWebview[] = [];

const inspectorRows = createInspectorRows({
	body: function () {
		return detailsBody;
	},
	emptyHint: 'Use the arrow keys to move through the document.',
	containerFields: function (row, data) {
		return detailsContainerFields(row, data, {
			shortName: localValueFor(row.id, 'shortName'),
			definitionRef: localValueFor(row.id, 'definitionRef')
		});
	},
	valueInput: function (row, data) {
		return detailsValueInput(row, data, localValueFor(row.id, 'value'));
	}
});

if (typeof window !== 'undefined') {
	window.addEventListener('message', function (event) {
		const message = event.data as EditorProviderToWebview;
		if (!mounted) {
			pendingMessages.push(message);
			return;
		}
		handleMessage(message);
	});
}

function indexRows(): void {
	rowById = new Map();
	rowIndexById = new Map();
	for (let at = 0; at < rows.length; at += 1) {
		rowById.set(rows[at].id, rows[at]);
		rowIndexById.set(rows[at].id, at);
	}
}

function subtreeRowIdsOf(id: string | undefined): Set<string> {
	if (id === undefined) {
		return new Set();
	}
	const at = rowIndexById.get(id);
	const row = rowById.get(id);
	if (at === undefined || row === undefined) {
		return new Set();
	}
	return rowIdsInRange(at, row.subtreeSize);
}

function rowIdsInRange(at: number, size: number): Set<string> {
	const out = new Set<string>();
	for (let index = at; index <= at + size && index < rows.length; index += 1) {
		out.add(rows[index].id);
	}
	return out;
}

function selectedRow(): EcucRow | undefined {
	return selectedId === undefined ? undefined : rowById.get(selectedId);
}

function lineOf(rowId: string | undefined): number | undefined {
	return rowId === undefined ? undefined : documentModel.rowLine.get(rowId);
}

function rowIdAtLine(line: number): string | undefined {
	return documentModel.lines[line - 1]?.rowId;
}

function setDetailsStatus(message: { message?: string; kind?: string }): void {
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

function clearDetailsStatus(): void {
	if (!detailsStatus) {
		return;
	}
	detailsStatus.textContent = '';
	delete detailsStatus.dataset.kind;
}

interface DetailsFocusAnchor {
	rowId: string;
	field: string;
	start?: number;
	end?: number;
}

/**
 * The Details caret a rebuild could not restore because the row id was waiting
 * for the host's rename pair. The next rebuild that proves a rename consumes it.
 */
let pendingRenameFocus: DetailsFocusAnchor | undefined;

function detailsControl(rowId: string, field: string): HTMLInputElement | HTMLSelectElement | null {
	return detailControls().find(isDetailsControlFor(rowId, field)) ?? null;
}

function detailControls(): Array<HTMLInputElement | HTMLSelectElement> {
	const controls = detailsBody?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]') ?? [];
	return Array.from(controls);
}

function isDetailsControlFor(
	rowId: string,
	field: string
): (control: HTMLInputElement | HTMLSelectElement) => boolean {
	return function (control) {
		return control.dataset.nodeId === rowId && control.dataset.field === field;
	};
}

/** Remember the focused Details control so a rebuild does not drop the caret. */
function captureDetailsFocus(): DetailsFocusAnchor | undefined {
	const active = activeDetailsElement();
	return active === undefined ? undefined : detailsFocusAnchor(active);
}

function activeDetailsElement(): HTMLElement | undefined {
	const active = document.activeElement;
	// Only a control inside the Details body counts; focus in the tree, search or
	// editor must not be moved by an inspector rebuild.
	if (!detailsContainsFocus(active)) {
		return undefined;
	}
	return active instanceof HTMLElement ? active : undefined;
}

function detailsContainsFocus(active: Element | null): boolean {
	return detailsBody !== null && active !== null && detailsBody.contains(active);
}

function detailsFocusAnchor(active: HTMLElement): DetailsFocusAnchor | undefined {
	const rowId = active.dataset.nodeId;
	const field = active.dataset.field;
	if (rowId === undefined || field === undefined) {
		return undefined;
	}
	return { rowId, field, ...detailsCaret(active) };
}

function detailsCaret(active: HTMLElement): { start?: number; end?: number } {
	const control = textControl(active);
	return anchorCaret(caretEdge(control, 'selectionStart'), caretEdge(control, 'selectionEnd'));
}

function textControl(active: HTMLElement): HTMLInputElement | HTMLTextAreaElement | undefined {
	return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : undefined;
}

function caretEdge(
	control: HTMLInputElement | HTMLTextAreaElement | undefined,
	edge: 'selectionStart' | 'selectionEnd'
): number | undefined {
	return control === undefined ? undefined : control[edge] ?? undefined;
}

function anchorCaret(start: number | undefined, end: number | undefined): { start?: number; end?: number } {
	return {
		...(start === undefined ? {} : { start }),
		...(end === undefined ? {} : { end })
	};
}

/** True while a short-name write whose path id will change is unresolved. */
function renameInFlight(): boolean {
	if (renameIntents.size > 0) {
		return true;
	}
	for (const edit of inflightEdits.values()) {
		if (edit.field === 'shortName') {
			return true;
		}
	}
	return false;
}

/**
 * Restore focus/caret after a rebuild. A short-name rename changes the path-based
 * row id, so the host pair proved by this rebuild moves the caret to the new id.
 * A deleted row has no mapping and does not steal focus. Returns true when a
 * control took focus.
 */
function restoreDetailsFocus(anchor: DetailsFocusAnchor | undefined): boolean {
	if (anchor === undefined || detailsBody === null) {
		return false;
	}
	const control = findDetailsControl(anchor);
	if (control === null) {
		return false;
	}
	control.focus();
	selectAnchorRange(control, anchor);
	return true;
}

function findDetailsControl(anchor: DetailsFocusAnchor): HTMLInputElement | HTMLSelectElement | null {
	const direct = detailsControl(anchor.rowId, anchor.field);
	if (direct !== null || resolvedRenames.size === 0) {
		return direct;
	}
	return remappedDetailsControl(anchor);
}

function remappedDetailsControl(anchor: DetailsFocusAnchor): HTMLInputElement | HTMLSelectElement | null {
	for (const [oldId, newId] of resolvedRenames) {
		const mapped = remapNodeId(anchor.rowId, oldId, newId);
		if (mapped === undefined) {
			continue;
		}
		const control = detailsControl(mapped, anchor.field);
		if (control !== null) {
			return control;
		}
	}
	return null;
}

function selectAnchorRange(control: HTMLInputElement | HTMLSelectElement, anchor: DetailsFocusAnchor): void {
	if (!('setSelectionRange' in control)) {
		return;
	}
	if (anchor.start === undefined) {
		return;
	}
	const max = control.value.length;
	control.setSelectionRange(Math.min(anchor.start, max), Math.min(anchor.end ?? anchor.start, max));
}

/** Re-seed every invalid draft's text and inline error after the panel is rebuilt. */
function syncInvalidDetails(): void {
	for (const invalid of invalidEdits.values()) {
		syncDetailsField(invalid.nodeId, invalid.field, invalid.display, invalid.message);
	}
}

function updateInspector(): void {
	if (!detailsBody) {
		return;
	}
	const focus = captureInspectorFocus();
	detailsBody.textContent = '';
	const row = selectedRow();
	if (row === undefined) {
		inspectorRows.renderEmpty();
		deferRenameFocus(focus);
		return;
	}
	inspectorRows.renderSelected(row);
	syncInvalidDetails();
	if (!restoreDetailsFocus(focus)) {
		deferRenameFocus(focus);
	}
}

function captureInspectorFocus(): DetailsFocusAnchor | undefined {
	const active = captureDetailsFocus();
	// A rebuild that proves a rename may restore a caret captured before the host's
	// pair arrived; any other rebuild drops it rather than stealing focus later.
	const focus = active ?? (resolvedRenames.size > 0 ? pendingRenameFocus : undefined);
	pendingRenameFocus = undefined;
	return focus;
}

function deferRenameFocus(focus: DetailsFocusAnchor | undefined): void {
	if (focus !== undefined && renameIntents.size > 0) {
		// The row id is waiting for the rename acknowledgement; the rebuild that
		// consumes the host pair will move this caret to the new id.
		pendingRenameFocus = focus;
	}
}

function applyDecorations(): void {
	if (editor === undefined) {
		return;
	}
	decorationIds = editor.deltaDecorations(decorationIds, buildDecorations());
}

function buildDecorations(): monaco.editor.IModelDeltaDecoration[] {
	const decorations: monaco.editor.IModelDeltaDecoration[] = [];
	appendSubtreeDecorations(decorations);
	appendDisabledDecorations(decorations);
	return decorations;
}

function appendSubtreeDecorations(decorations: monaco.editor.IModelDeltaDecoration[]): void {
	for (const line of documentModel.lines) {
		if (!subtreeLine(line)) {
			continue;
		}
		decorations.push(wholeLineStyle(line.line, lineClassName(line)));
	}
}

function subtreeLine(line: SyntheticLine): boolean {
	return line.rowId !== undefined && subtreeIds.has(line.rowId);
}

function lineClassName(line: SyntheticLine): string {
	const structural = line.kind === 'brace' || line.kind === 'annotation';
	return line.rowId === selectedId && !structural ? 'arxml-selected' : 'arxml-subtree';
}

function appendDisabledDecorations(decorations: monaco.editor.IModelDeltaDecoration[]): void {
	for (const row of rows) {
		const decoration = row.disabled ? wholeLineDecoration(lineOf(row.id), 'arxml-disabled') : undefined;
		if (decoration !== undefined) {
			decorations.push(decoration);
		}
	}
}

function wholeLineDecoration(
	line: number | undefined,
	className: string,
	zIndex = 1
): monaco.editor.IModelDeltaDecoration | undefined {
	if (line === undefined) {
		return undefined;
	}
	return wholeLineStyle(line, className, zIndex);
}

function wholeLineStyle(line: number, className: string, zIndex = 1): monaco.editor.IModelDeltaDecoration {
	return {
		range: new monaco.Range(line, 1, line, 1),
		options: { isWholeLine: true, className, zIndex }
	};
}

function setSelection(id: string | undefined, reveal = false): void {
	selectedId = id;
	subtreeIds = subtreeRowIdsOf(id);
	updateInspector();
	applyDecorations();
	if (reveal) {
		revealRow(id);
	}
}

interface CursorAnchor {
	rowId?: string;
	line: number;
	column: number;
	/** The active end of a non-empty selection; equal to the cursor when collapsed. */
	selectionEndRowId?: string;
	selectionEndLine: number;
	selectionEndColumn: number;
	scrollTop: number;
	scrollLeft: number;
}

/** Capture the text cursor by row id so model rebuilds cannot send it to line 1. */
function captureCursor(): CursorAnchor {
	const position = editor?.getPosition();
	if (editor === undefined || position === undefined || position === null) {
		return emptyCursorAnchor();
	}
	const selection = editor.getSelection();
	const start = selectionStartPoint(selection, position);
	const end = selectionEndPoint(selection, position);
	return {
		rowId: rowIdAtLine(start.line),
		line: start.line,
		column: start.column,
		selectionEndRowId: rowIdAtLine(end.line),
		selectionEndLine: end.line,
		selectionEndColumn: end.column,
		scrollTop: editor.getScrollTop(),
		scrollLeft: editor.getScrollLeft()
	};
}

function emptyCursorAnchor(): CursorAnchor {
	return { line: 1, column: 1, selectionEndLine: 1, selectionEndColumn: 1, scrollTop: 0, scrollLeft: 0 };
}

function selectionStartPoint(
	selection: monaco.Selection | null,
	position: monaco.Position
): { line: number; column: number } {
	return {
		line: pickNumber(selection?.selectionStartLineNumber, position.lineNumber),
		column: pickNumber(selection?.selectionStartColumn, position.column)
	};
}

function selectionEndPoint(
	selection: monaco.Selection | null,
	position: monaco.Position
): { line: number; column: number } {
	return {
		line: pickNumber(selection?.positionLineNumber, position.lineNumber),
		column: pickNumber(selection?.positionColumn, position.column)
	};
}

function pickNumber(value: number | null | undefined, fallback: number): number {
	return value ?? fallback;
}

function stringOrUndefined(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function restoreCursor(anchor: CursorAnchor): void {
	if (editor === undefined || model === undefined) {
		return;
	}
	const line = anchorLine(anchor.rowId, anchor.line);
	if (line === undefined) {
		return;
	}
	const endLine = resolvedEndLine(anchor);
	const safeLine = Math.min(line, model.getLineCount());
	const safeEndLine = Math.min(endLine, model.getLineCount());
	editor.setSelection(
		new monaco.Selection(
			safeLine,
			clampColumn(safeLine, anchor.column),
			safeEndLine,
			clampColumn(safeEndLine, anchor.selectionEndColumn)
		)
	);
	editor.setScrollTop(anchor.scrollTop);
	editor.setScrollLeft(anchor.scrollLeft);
}

function anchorLine(rowId: string | undefined, fallback: number): number | undefined {
	return rowId === undefined ? fallback : documentModel.rowLine.get(rowId);
}

function resolvedEndLine(anchor: CursorAnchor): number {
	return anchorLine(anchor.selectionEndRowId, anchor.selectionEndLine) ?? anchor.selectionEndLine;
}

function clampColumn(line: number, column: number): number {
	return Math.min(column, model?.getLineMaxColumn(line) ?? column);
}

function localEditPending(): boolean {
	return pendingEdits.size > 0 || inflightEdits.size > 0;
}

function hasPendingEdits(): boolean {
	return localEditPending();
}

function localDraftExists(): boolean {
	return pendingEdits.size > 0 || inflightEdits.size > 0 || invalidEdits.size > 0;
}

function updateDirtyStatus(): void {
	const first = invalidEdits.values().next().value as InvalidEdit | undefined;
	editorToolbar?.setDirty(localEditPending() || hostDirty, first?.message);
}

function maybeRequestSave(): void {
	if (!saveRequested || hasBlockingLocalEdits()) {
		return;
	}
	saveRequested = false;
	postToHost({ type: 'save' });
}

function hasBlockingLocalEdits(): boolean {
	return invalidEdits.size > 0 || localEditPending();
}

function requestSave(): void {
	localUndoActive = false;
	if (invalidEdits.size > 0) {
		saveRequested = false;
		const first = invalidEdits.values().next().value as InvalidEdit;
		setSelection(first.nodeId);
		revealRow(first.nodeId, true);
		updateErrorState();
		return;
	}
	saveRequested = true;
	// A draft whose row is gone cannot be written; the save stops here instead of
	// posting `save` over work the host never received.
	if (flushEdits()) {
		saveRequested = false;
		updateDirtyStatus();
		return;
	}
	maybeRequestSave();
}

function markerForInvalid(invalid: InvalidEdit): monaco.editor.IMarkerData | undefined {
	const line = documentModel.rowLine.get(invalid.nodeId);
	const lineText = syntheticLineAt(line);
	if (line === undefined || lineText === undefined) {
		return undefined;
	}
	const span = fieldSpanAt(lineText, invalid.field);
	return {
		severity: monaco.MarkerSeverity.Error,
		message: invalid.message,
		startLineNumber: line,
		startColumn: spanStartColumn(span),
		endLineNumber: line,
		endColumn: spanEndColumn(span, lineText)
	};
}

function syntheticLineAt(line: number | undefined): SyntheticLine | undefined {
	return line === undefined ? undefined : documentModel.lines[line - 1];
}

function fieldSpanAt(lineText: SyntheticLine, field: EditField): FieldSpan | undefined {
	return lineText.fieldSpans.find((candidate) => candidate.field === field);
}

function spanStartColumn(span: FieldSpan | undefined): number {
	return span?.startColumn ?? 1;
}

function spanEndColumn(span: FieldSpan | undefined, lineText: SyntheticLine): number {
	return span?.endColumn ?? Math.max(lineText.text.length + 1, 2);
}

function updateErrorState(): void {
	const first = firstInvalidEdit();
	renderErrorStrip(first);
	applyErrorMarkers();
	updateDetailsError(first);
	updateDirtyStatus();
}

function firstInvalidEdit(): InvalidEdit | undefined {
	return invalidEdits.values().next().value as InvalidEdit | undefined;
}

function renderErrorStrip(first: InvalidEdit | undefined): void {
	if (errorStrip === null) {
		return;
	}
	errorStrip.hidden = first === undefined;
	errorStrip.textContent = first === undefined ? '' : `Invalid value — ${first.message}`;
}

function applyErrorMarkers(): void {
	if (model === undefined) {
		return;
	}
	monaco.editor.setModelMarkers(model, 'arxml-ecuc', errorMarkers());
}

function errorMarkers(): monaco.editor.IMarkerData[] {
	return Array.from(invalidEdits.values())
		.map(markerForInvalid)
		.filter(isMarker);
}

function isMarker(marker: monaco.editor.IMarkerData | undefined): marker is monaco.editor.IMarkerData {
	return marker !== undefined;
}

function updateDetailsError(first: InvalidEdit | undefined): void {
	if (first !== undefined) {
		setDetailsStatus({ message: first.message, kind: 'warn' });
		localErrorShown = true;
		return;
	}
	if (localErrorShown) {
		clearDetailsStatus();
		localErrorShown = false;
	}
}

function replaceSyntheticLine(
	line: number,
	row: EcucRow,
	field: EditField,
	raw: string,
	display: string
): void {
	if (model === undefined) {
		return;
	}
	const built = buildFieldLine(row, field, raw, display);
	documentModel.lines[line - 1] = syntheticLineOf(line, row, built);
	syncDocumentText();
	if (model.getLineContent(line) === built.text) {
		// Direct typing already produced the rendered line. Re-pushing it would add
		// a second undo entry and can interrupt an IME composition; only the span
		// metadata needs the new value.
		return;
	}
	pushLineText(line, built.text);
}

/**
 * The line a row renders with one field replaced by the local draft. The patched
 * row is the one but last source of the line; the host row stays untouched until
 * its re-scan accepts the draft.
 */
function buildFieldLine(
	row: EcucRow,
	field: EditField,
	raw: string,
	display: string
): ReturnType<typeof syntheticRowLine> {
	return syntheticRowLine({
		...row,
		...(field === 'value' ? { value: raw, shownValue: display } : {}),
		...(field === 'shortName' ? { shortName: raw } : {}),
		// A container's line label is its definition-ref tail, so a Details edit
		// must repaint it now instead of waiting for the host's re-scan.
		...(field === 'definitionRef' ? { definitionRef: raw, label: lastShortName(raw) } : {})
	});
}

function syntheticLineOf(
	line: number,
	row: EcucRow,
	built: ReturnType<typeof syntheticRowLine>
): SyntheticLine {
	return {
		line,
		rowId: row.id,
		kind: row.kind,
		text: built.text,
		fieldSpans: built.fieldSpans,
		searchSpans: built.searchSpans
	};
}

function syncDocumentText(): void {
	documentModel.text = documentModel.lines.map((candidate) => candidate.text).join('\n');
}

function pushLineText(line: number, text: string): void {
	const anchor = captureCursor();
	pushModelLine(line, text);
	restoreCursor(anchor);
}

function pushModelLine(line: number, text: string): void {
	if (model === undefined) {
		return;
	}
	applyingModel = true;
	model.pushEditOperations(
		[],
		[{ range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)), text }],
		function () {
			return null;
		}
	);
	applyingModel = false;
}

/** The host-accepted raw value for one field, matching the edit payload's `value`. */
function acceptedFieldValue(row: EcucRow, field: EditField): string | undefined {
	if (field === 'value') {
		return row.value;
	}
	return field === 'shortName' ? row.shortName : row.definitionRef;
}

/** The newest pending/in-flight edit for one field key, or undefined. */
function newestLocalEdit(key: string): QueuedEdit | undefined {
	let newest = pendingEdits.get(key);
	for (const edit of inflightEdits.values()) {
		if (isNewerForKey(edit, key, newest)) {
			newest = edit;
		}
	}
	return newest;
}

function isNewerForKey(edit: QueuedEdit, key: string, newest: QueuedEdit | undefined): boolean {
	return draftKey(edit.nodeId, edit.field) === key && (newest === undefined || edit.editId > newest.editId);
}

function inflightFor(key: string): QueuedEdit | undefined {
	for (const edit of inflightEdits.values()) {
		if (draftKey(edit.nodeId, edit.field) === key) {
			return edit;
		}
	}
	return undefined;
}

/**
 * True when the requested value needs no host write: it is already the queued
 * value, or it is the accepted value and no acknowledgement can overwrite it.
 * The host refuses an unchanged value, so sending one would mark an untouched
 * field invalid and block Ctrl+S.
 */
function isRedundantEdit(key: string, value: string, accepted: string | undefined): boolean {
	const newest = newestLocalEdit(key);
	if (queuedValueMatches(newest, value)) {
		return true;
	}
	if (value !== accepted || inflightFor(key) !== undefined) {
		return false;
	}
	// The host already holds this value, so drop a queued revert instead of
	// writing it and dirtying the document for nothing.
	pendingEdits.delete(key);
	return true;
}

function queuedValueMatches(newest: QueuedEdit | undefined, value: string): boolean {
	return newest !== undefined && newest.value === value;
}

/** The single mutation path for a live field value from Monaco or Details. */
function applyLocalField(
	nodeId: string,
	field: EditField,
	raw: string
): void {
	localUndoActive = false;
	const row = rowById.get(nodeId);
	const line = documentModel.rowLine.get(nodeId);
	if (row === undefined || line === undefined) {
		return;
	}
	updateFieldDraft(nodeId, field, raw, row, line);
}

function updateFieldDraft(
	nodeId: string,
	field: EditField,
	raw: string,
	row: EcucRow,
	line: number
): void {
	const key = draftKey(nodeId, field);
	const error = localValueError(row, field, raw);
	const display = displayForRaw(row, field, raw);
	const spanText = spanTextForRaw(row, field, raw);
	replaceSyntheticLine(line, row, field, raw, display);
	syncDetailsField(nodeId, field, spanText, error);
	if (error !== undefined) {
		// The invalid text stays visible, but it never enters the host document.
		storeInvalidDraft(key, nodeId, field, error, spanText);
		return;
	}
	invalidEdits.delete(key);
	queueValidDraft(key, nodeId, field, raw, spanText, row);
}

function storeInvalidDraft(
	key: string,
	nodeId: string,
	field: EditField,
	error: string,
	spanText: string
): void {
	pendingEdits.delete(key);
	invalidEdits.set(key, { nodeId, field, message: error, display: spanText, editId: (editSequence += 1) });
	updateErrorState();
}

function queueValidDraft(
	key: string,
	nodeId: string,
	field: EditField,
	raw: string,
	spanText: string,
	row: EcucRow
): void {
	if (isRedundantEdit(key, raw, acceptedFieldValue(row, field))) {
		updateErrorState();
		return;
	}
	queueEdit({ nodeId, field, value: raw, display: spanText });
	updateErrorState();
}

/** The text a Details control shows: invalid draft first, then the newest local raw value. */
function localValueFor(nodeId: string, field: EditField): string | undefined {
	const key = draftKey(nodeId, field);
	const invalid = invalidEdits.get(key);
	if (invalid !== undefined) {
		return invalid.display;
	}
	return newestLocalEdit(key)?.value;
}

function maybeAcknowledgeFlush(): void {
	if (flushBlocked()) {
		return;
	}
	for (const requestId of flushRequests) {
		postToHost({ type: 'flushed', requestId });
	}
	flushRequests.clear();
}

function flushBlocked(): boolean {
	return pendingEdits.size > 0 || inflightEdits.size > 0 || flushRequests.size === 0;
}

function clearPendingEdits(): void {
	pendingEdits.clear();
	inflightEdits.clear();
	renameIntents.clear();
	resolvedRenames.clear();
	pendingRenameFocus = undefined;
	localUndoActive = false;
	updateDirtyStatus();
	maybeAcknowledgeFlush();
}

/** Drop local no-ops so Ctrl+S never sends a value the host already holds. */
function pruneRedundantPending(): void {
	for (const [key, edit] of Array.from(pendingEdits)) {
		if (isRedundantPending(key, edit)) {
			pendingEdits.delete(key);
		}
	}
	updateDirtyStatus();
}

function isRedundantPending(key: string, edit: QueuedEdit): boolean {
	const row = rowById.get(edit.nodeId);
	if (row === undefined || inflightFor(key) !== undefined) {
		return false;
	}
	const field = edit.field ?? 'value';
	return edit.value === acceptedFieldValue(row, field);
}

/**
 * Send every local draft: values first, then short names deepest container first.
 *
 * Returns true when a draft had to be left behind because its row is no longer in
 * the latest row store. Such a draft stays queued (the row may come back, and its
 * text must not be lost) but a save must not proceed over it.
 */
function flushEdits(): boolean {
	pruneRedundantPending();
	if (renameInFlight()) {
		// The re-scan that follows a rename re-keys the rows. Sending a draft under
		// the pre-rename id would earn a refusal, so it waits for that document (or
		// for the edit result) and is flushed under the host-provided id afterwards.
		updateDirtyStatus();
		maybeAcknowledgeFlush();
		return false;
	}
	const stale = flushPendingEdits();
	if (stale) {
		// A stale draft makes any outstanding host flush unsatisfiable; that save
		// times out and the host writes the document as it stands. Drop the request
		// so it cannot act as a standing commit trigger for drafts queued later.
		flushRequests.clear();
	}
	updateDirtyStatus();
	maybeAcknowledgeFlush();
	return stale;
}

function flushPendingEdits(): boolean {
	let stale = false;
	for (const [key, edit] of pendingFlushOrder()) {
		stale = flushOneEdit(key, edit) || stale;
	}
	return stale;
}

function flushOneEdit(key: string, edit: QueuedEdit): boolean {
	const row = rowById.get(edit.nodeId);
	if (row === undefined) {
		// A previous re-scan removed the row; sending it would only earn a refusal.
		// Keep the draft and report it, so the status explains the blocked save and
		// the draft can still be submitted if the row returns.
		setDetailsStatus({ message: 'The node is no longer in the file.', kind: 'warn' });
		return true;
	}
	// One edit per field may be in flight. A newer value waits for its ack so
	// a refusal cannot be confused with the value that superseded it.
	if (inflightFor(key) === undefined) {
		sendPendingEdit(key, edit);
	}
	return false;
}

function sendPendingEdit(key: string, edit: QueuedEdit): void {
	pendingEdits.delete(key);
	inflightEdits.set(edit.editId, edit);
	if (edit.field === 'shortName') {
		// The re-scan may arrive before or after `editResult`; keep this intent
		// until the host pair proves the renamed container, so a draft cannot be
		// addressed at the dead id in between.
		renameIntents.set(edit.editId, { editId: edit.editId, nodeId: edit.nodeId, shortName: edit.value });
	}
	hostAcks = true;
	postToHost({
		type: 'edit',
		editId: edit.editId,
		nodeId: edit.nodeId,
		field: edit.field,
		value: edit.value,
		baseRevision: hostRevision
	});
}

function pendingFlushOrder(): Array<[string, QueuedEdit]> {
	return Array.from(pendingEdits.entries()).sort((left, right) =>
		compareEditFlushOrder(left[1], right[1], levelOfRow)
	);
}

function levelOfRow(nodeId: string): number | undefined {
	return rowById.get(nodeId)?.level;
}

function queueEdit(edit: { nodeId: string; field?: EditField; value: string; display: string }): void {
	// The local buffer is authoritative for the keystroke. A newer keystroke
	// replaces it; Ctrl+S is the only path that turns it into a host write.
	const next: QueuedEdit = {
		type: 'edit',
		editId: (editSequence += 1),
		nodeId: edit.nodeId,
		field: edit.field,
		value: edit.value,
		display: edit.display
	};
	pendingEdits.set(draftKey(next.nodeId, next.field), next);
	updateDirtyStatus();
}

function hasNewerLocalEdit(edit: QueuedEdit): boolean {
	const key = draftKey(edit.nodeId, edit.field);
	return hasNewerPending(key, edit.editId) || hasNewerInflight(key, edit.editId) || hasNewerInvalid(key, edit.editId);
}

function hasNewerPending(key: string, editId: number): boolean {
	return Array.from(pendingEdits.values()).some((candidate) => isNewerFor(candidate, key, editId));
}

function hasNewerInflight(key: string, editId: number): boolean {
	return Array.from(inflightEdits.values()).some((candidate) => isNewerFor(candidate, key, editId));
}

function isNewerFor(candidate: QueuedEdit, key: string, editId: number): boolean {
	return draftKey(candidate.nodeId, candidate.field) === key && candidate.editId > editId;
}

function hasNewerInvalid(key: string, editId: number): boolean {
	return (invalidEdits.get(key)?.editId ?? 0) > editId;
}

/** Put the host-accepted row text back after a refusal with no newer local edit. */
function handleEditResult(message: EditorMessage<'editResult'>): void {
	if (!isEditResultMessage(message)) {
		return;
	}
	const edit = inflightEdits.get(message.editId);
	if (edit === undefined) {
		return;
	}
	inflightEdits.delete(message.editId);
	settleRenameIntent(message, stringOrUndefined(message.nextNodeId));
	hostAcks = true;
	hostRevision = Math.max(hostRevision, message.revision);
	const superseded = hasNewerLocalEdit(edit);
	recordEditOutcome(message, edit, superseded);
	updateDirtyStatus();
	followUpAfterResult(message, superseded);
	maybeRequestSave();
}

function isEditResultMessage(message: EditorMessage<'editResult'>): boolean {
	return (
		typeof message.editId === 'number' &&
		typeof message.revision === 'number' &&
		typeof message.ok === 'boolean'
	);
}

function settleRenameIntent(message: EditorMessage<'editResult'>, nextNodeId: string | undefined): void {
	if (!message.ok) {
		// The rename never happened, so its intent is not waiting for a re-scan.
		// The pre-rename draft stays under its old id and remains editable.
		renameIntents.delete(message.editId);
		return;
	}
	const intent = renameIntents.get(message.editId);
	if (intent === undefined) {
		return;
	}
	if (nextNodeId === undefined) {
		forgetRenameIntent(message.editId);
		return;
	}
	confirmRenameIntent(message.editId, intent, nextNodeId);
}

function forgetRenameIntent(editId: number): void {
	// A host that predates the pair cannot prove the new id. Drop the intent so a
	// flush is not deferred forever; its drafts are then reported stale instead of
	// being sent to an id the page no longer knows.
	renameIntents.delete(editId);
	remapDraftsAfterRename();
}

function confirmRenameIntent(editId: number, intent: RenameIntent, nextNodeId: string): void {
	// The host owns the id grammar: record its pair so the next row store can
	// prove the rename even when it arrived before this acknowledgement.
	renameIntents.set(editId, { ...intent, nextNodeId });
	remapDraftsAfterRename();
	if (resolvedRenames.size > 0) {
		// The re-scan landed before this ack: rebuild from the remapped drafts so
		// the renamed row shows the post-flush keystroke and keeps the Details focus.
		applyRows(rows, header, selectedId);
	}
}

function recordEditOutcome(
	message: EditorMessage<'editResult'>,
	edit: QueuedEdit,
	superseded: boolean
): void {
	if (message.ok) {
		hostDirty = true;
		clearSettledInvalid(edit);
		return;
	}
	if (!superseded) {
		recordRefusal(message, edit);
	}
}

function clearSettledInvalid(edit: QueuedEdit): void {
	const key = draftKey(edit.nodeId, edit.field);
	const invalid = invalidEdits.get(key);
	if (invalid === undefined || invalid.editId <= edit.editId) {
		invalidEdits.delete(key);
	}
}

function recordRefusal(message: EditorMessage<'editResult'>, edit: QueuedEdit): void {
	// Keep the refused text visible and marked instead of silently restoring the
	// old value; Ctrl+S stays blocked until the user corrects or reverts it.
	saveRequested = false;
	storeRefusal(message, edit);
	updateErrorState();
}

function storeRefusal(message: EditorMessage<'editResult'>, edit: QueuedEdit): void {
	const reason = message.reason ?? 'the edit was refused';
	invalidEdits.set(draftKey(edit.nodeId, edit.field), {
		nodeId: edit.nodeId,
		field: edit.field ?? 'value',
		message: reason,
		display: edit.display,
		editId: edit.editId
	});
	showRefusalStatus(message);
	syncDetailsField(edit.nodeId, edit.field ?? 'value', edit.display, reason);
}

function showRefusalStatus(message: EditorMessage<'editResult'>): void {
	if (message.reason !== undefined && message.reason !== '') {
		setDetailsStatus({ message: message.reason, kind: 'warn' });
	}
}

function followUpAfterResult(message: EditorMessage<'editResult'>, superseded: boolean): void {
	// A refusal ends the save attempt. A superseded refusal does not: the newer
	// draft still has to reach the host under the same Ctrl+S.
	if (!message.ok && !superseded) {
		maybeAcknowledgeFlush();
		return;
	}
	if (hasQueuedFlush()) {
		flushForSave();
		return;
	}
	maybeAcknowledgeFlush();
}

function hasQueuedFlush(): boolean {
	return pendingEdits.size > 0 && (saveRequested || flushRequests.size > 0);
}

function flushForSave(): void {
	if (flushEdits()) {
		saveRequested = false;
		updateDirtyStatus();
	}
}

function revealRow(id: string | undefined, focus = false, column = 1): void {
	const target = revealTarget(id);
	if (target === undefined) {
		return;
	}
	const line = lineOf(target.id);
	if (line === undefined) {
		return;
	}
	target.editor.revealLineInCenter(line);
	target.editor.setPosition({ lineNumber: line, column: Math.min(column, lineMaxColumn(line)) });
	if (focus) {
		target.editor.focus();
	}
}

function revealTarget(
	id: string | undefined
): { id: string; editor: monaco.editor.IStandaloneCodeEditor } | undefined {
	if (editor === undefined || id === undefined) {
		return undefined;
	}
	return { id, editor };
}

function lineMaxColumn(line: number): number {
	return editor?.getModel()?.getLineMaxColumn(line) ?? 1;
}

function latestLocalEdits(): QueuedEdit[] {
	const latest = new Map<string, QueuedEdit>();
	recordInflightEdits(latest);
	recordLatest(pendingEdits.values(), latest);
	recordInvalidEdits(latest);
	return Array.from(latest.values());
}

function recordInflightEdits(latest: Map<string, QueuedEdit>): void {
	for (const edit of inflightEdits.values()) {
		latest.set(draftKey(edit.nodeId, edit.field), edit);
	}
}

function recordLatest(edits: Iterable<QueuedEdit>, latest: Map<string, QueuedEdit>): void {
	for (const edit of edits) {
		const key = draftKey(edit.nodeId, edit.field);
		const current = latest.get(key);
		if (current === undefined || edit.editId > current.editId) {
			latest.set(key, edit);
		}
	}
}

function recordInvalidEdits(latest: Map<string, QueuedEdit>): void {
	for (const [key, invalid] of invalidEdits) {
		latest.set(key, {
			type: 'edit',
			editId: Number.MAX_SAFE_INTEGER,
			nodeId: invalid.nodeId,
			field: invalid.field,
			value: invalid.display,
			display: invalid.display
		});
	}
}

/** Paint an optimistic field value over a line built from host-accepted rows. */
function overlayLocalOnLine(line: SyntheticLine, local: readonly QueuedEdit[] = latestLocalEdits()): void {
	for (const edit of local) {
		if (line.rowId !== edit.nodeId) {
			continue;
		}
		overlayEditOnLine(line, edit);
	}
}

function overlayEditOnLine(line: SyntheticLine, edit: QueuedEdit): void {
	const field = edit.field ?? 'value';
	const span = line.fieldSpans.find((candidate) => candidate.field === field);
	if (span === undefined) {
		return;
	}
	const before = line.text.slice(0, span.startColumn - 1);
	const after = line.text.slice(span.endColumn - 1);
	line.text = before + edit.display + after;
	span.text = edit.display;
	span.endColumn = span.startColumn + edit.display.length;
}

function overlayLocalEdits(doc: SyntheticDocument): void {
	const local = latestLocalEdits();
	for (const line of doc.lines) {
		overlayLocalOnLine(line, local);
	}
	doc.text = doc.lines.map((line) => line.text).join('\n');
}

/**
 * Apply the rename intents the rebuilt row store proves.
 *
 * A short-name write gets a durable intent when it is flushed, because the host
 * can answer `editResult` before its re-scan. The intent is proved by the host's
 * own pair (`nextNodeId` from `editResult`) together with a row store where the
 * old row is gone and that container exists. Every pending/invalid draft and
 * every in-flight entry's `nodeId` addressed at the old id (or its subtree) moves
 * to the host id, the mapping is exposed for focus/selection, and the resolved
 * intent is cleared. A refused intent is cleared by `handleEditResult`; an intent
 * whose row vanished without the host's row is dropped, which marks its drafts
 * stale by leaving them at the dead id and cancels a pending save.
 */
function remapDraftsAfterRename(): void {
	// Pairs proved earlier in the same turn are kept: an acknowledgement can resolve
	// a rename after its document already rebuilt the rows, and the rebuild that
	// follows that acknowledgement still needs the mapping for caret and selection.
	const plan = resolveRenameIntents(Array.from(renameIntents.values()), rowLookup);
	for (const pair of plan.resolved) {
		applyRenamePair(pair);
	}
	if (plan.dropped.length > 0) {
		// The rename did not land where the host said. Its drafts cannot be addressed
		// anywhere safe, so the next flush reports them stale and this save stops.
		saveRequested = false;
		setDetailsStatus({ message: 'The node is no longer in the file.', kind: 'warn' });
	}
	renameIntents = new Map();
	for (const intent of plan.kept) {
		renameIntents.set(intent.editId, intent);
	}
}

function rowLookup(id: string): EcucRow | undefined {
	return rowById.get(id);
}

function applyRenamePair(pair: RenameResolution): void {
	remapDraftMap(pendingEdits, pair.oldId, pair.newId);
	remapDraftMap(invalidEdits, pair.oldId, pair.newId);
	remapInflightDrafts(pair);
	resolvedRenames.set(pair.oldId, pair.newId);
}

function remapInflightDrafts(pair: RenameResolution): void {
	for (const [editId, edit] of Array.from(inflightEdits)) {
		const next = remapDraftNodeId(edit, pair.oldId, pair.newId);
		if (next !== undefined) {
			// A refusal that arrives after this rebuild must be recorded at the new
			// id; the Details selection never targets the dead one.
			inflightEdits.set(editId, next);
		}
	}
}


function applyRows(nextRows: EcucRow[], nextHeader?: EditorDocumentHeader, nextSelectedId?: string): void {
	localUndoActive = false;
	restoringView = true;
	try {
		rebuildRows(nextRows, nextHeader, nextSelectedId);
	} finally {
		restoringView = false;
	}
	flushAfterRows();
}

function rebuildRows(nextRows: EcucRow[], nextHeader?: EditorDocumentHeader, nextSelectedId?: string): void {
	const anchor = captureCursor();
	const viewState = currentViewState();
	rows = Array.isArray(nextRows) ? nextRows : [];
	indexRows();
	remapDraftsAfterRename();
	if (nextHeader !== undefined) {
		header = nextHeader;
	}
	documentModel = buildSyntheticDocument(rows, header);
	overlayLocalEdits(documentModel);
	replaceModelText(viewState);
	applySelection(nextSelectedId);
	refreshRows();
	resolvedRenames = new Map();
	applyDecorations();
	restoreCursor(anchor);
	invalidateNativeFind();
}

function currentViewState(): ReturnType<monaco.editor.IStandaloneCodeEditor['saveViewState']> | undefined {
	return editor?.saveViewState();
}

function replaceModelText(viewState: ReturnType<monaco.editor.IStandaloneCodeEditor['saveViewState']> | undefined): void {
	if (model === undefined) {
		return;
	}
	applyingModel = true;
	// Monaco sticky scroll converts a folding end to `end + 1`; a document that
	// ends on its closing brace would make the outermost scope invalid and
	// drop every sticky candidate. A real editor document ends with a newline.
	model.setValue(`${documentModel.text}\n`);
	applyingModel = false;
	if (viewState !== undefined && viewState !== null) {
		editor?.restoreViewState(viewState);
	}
	setModelFolding(model, documentModel.foldingRanges);
}

function applySelection(nextSelectedId: string | undefined): void {
	if (nextSelectedId !== undefined) {
		selectedId = nextSelectedId;
	}
	if (selectedId !== undefined && !rowById.has(selectedId)) {
		// A patch without a selection still follows a rename the re-scan proved, so
		// the Details panel never targets a dead id (the renamed container or any
		// draft-bearing row under it).
		selectedId = renamedSelection(selectedId);
	}
}

function renamedSelection(id: string): string | undefined {
	let mapped = resolvedRenames.get(id);
	for (const [oldId, newId] of resolvedRenames) {
		mapped = mapped ?? remapNodeId(id, oldId, newId);
	}
	return existingRowId(mapped);
}

function existingRowId(id: string | undefined): string | undefined {
	return id !== undefined && rowById.has(id) ? id : undefined;
}

function refreshRows(): void {
	subtreeIds = subtreeRowIdsOf(selectedId);
	setConditionRows(rows);
	ensureDiscoveredConditionRows();
	applyDisabledCount();
	updateInspector();
}

function refreshPatchedRows(): void {
	subtreeIds = subtreeRowIdsOf(selectedId);
	applyDisabledCount();
	updateInspector();
}

function flushAfterRows(): void {
	// A Ctrl+S that was waiting on the rename (or on a host flush) now owns the
	// remapped drafts: submit them under the new ids and let the save follow the
	// acknowledgements. A draft whose row did not come back stops the save instead.
	if (!saveRequested && flushRequests.size === 0) {
		return;
	}
	if (flushEdits()) {
		saveRequested = false;
		updateDirtyStatus();
		return;
	}
	maybeRequestSave();
}

function applyPatch(patch: EditorRowPatch, nextHeader?: EditorDocumentHeader, nextSelectedId?: string): void {
	localUndoActive = false;
	if (tryApplyInPlacePatch(patch, nextHeader, nextSelectedId)) {
		return;
	}
	const next = rows.slice();
	next.splice(patch.at, patch.remove, ...patch.rows);
	applyRows(next, nextHeader, nextSelectedId);
}

function tryApplyInPlacePatch(
	patch: EditorRowPatch,
	nextHeader?: EditorDocumentHeader,
	nextSelectedId?: string
): boolean {
	if (!isInPlacePatch(patch)) {
		return false;
	}
	const pair = inPlaceRow(patch);
	if (pair === undefined) {
		return false;
	}
	applyInPlacePatch(pair, patch.at, nextHeader, nextSelectedId);
	return true;
}

function isInPlacePatch(patch: EditorRowPatch): boolean {
	return !patch.structural && patch.remove === 1 && patch.rows.length === 1;
}

function inPlaceRow(patch: EditorRowPatch): { existing: EcucRow; incoming: EcucRow } | undefined {
	const existing = rows[patch.at];
	const incoming = patch.rows[0];
	if (existing === undefined || incoming === undefined || existing.id !== incoming.id) {
		return undefined;
	}
	return { existing, incoming };
}

function applyInPlacePatch(
	pair: { existing: EcucRow; incoming: EcucRow },
	at: number,
	nextHeader?: EditorDocumentHeader,
	nextSelectedId?: string
): void {
	const anchor = captureCursor();
	const row = { ...pair.existing, ...pair.incoming };
	rows[at] = row;
	indexRows();
	repaintRowLine(row);
	if (nextHeader !== undefined) {
		header = nextHeader;
	}
	if (nextSelectedId !== undefined) {
		selectedId = nextSelectedId;
	}
	refreshPatchedRows();
	applyDecorations();
	restoreCursor(anchor);
	invalidateNativeFind();
}

function repaintRowLine(row: EcucRow): void {
	const line = documentModel.rowLine.get(row.id);
	if (line === undefined) {
		return;
	}
	repaintLine(line, row);
}

function repaintLine(line: number, row: EcucRow): void {
	if (model === undefined) {
		return;
	}
	const nextLine = syntheticLineOf(line, row, syntheticRowLine(row));
	documentModel.lines[line - 1] = nextLine;
	overlayLocalOnLine(nextLine);
	syncDocumentText();
	pushModelLine(line, nextLine.text);
}

function nativeFindKey(query: string, options: FindOptions): string {
	return `${options.caseSensitive ? 1 : 0}|${options.wholeWord ? 1 : 0}|${options.regex ? 1 : 0}|${query}`;
}

function nativeFindOptions(isRegex: boolean, matchCase: boolean, wordSeparators: string | null): FindOptions {
	return {
		caseSensitive: matchCase,
		wholeWord: wordSeparators !== null && wordSeparators !== undefined,
		regex: isRegex
	};
}

function requestNativeFind(query: string, options: FindOptions): void {
	if (query === '') {
		return;
	}
	const key = nativeFindKey(query, options);
	if (nativeFindCache.has(key) || nativeFindRequested.has(key)) {
		return;
	}
	nativeFindRequested.add(key);
	nativeFindQueries.set(key, { query, options });
	const requestId = (nativeFindRequestId += 1);
	nativeFindRequests.set(requestId, key);
	postToHost({ type: 'find', requestId, query, options });
}

function nativeMatchesFor(query: string, options: FindOptions): MonacoFindMatch[] {
	return nativeFindCache.get(nativeFindKey(query, options)) ?? [];
}

function mapNativeMatches(result: { matches: FindMatch[] }): MonacoFindMatch[] {
	const out: MonacoFindMatch[] = [];
	const seen = new Set<string>();
	for (const match of result.matches) {
		const found = nativeMatchRange(match);
		if (found === undefined || seen.has(found.key)) {
			continue;
		}
		seen.add(found.key);
		out.push(found.match);
	}
	out.sort((left, right) => monaco.Range.compareRangesUsingStarts(left.range, right.range));
	return out;
}

function nativeMatchRange(match: FindMatch): { key: string; match: MonacoFindMatch } | undefined {
	const line = documentModel.rowLine.get(match.rowId);
	const lineText = lineAt(line);
	if (line === undefined || lineText === undefined) {
		return undefined;
	}
	const range = searchRangeOnLine(lineText, match);
	if (range === undefined) {
		return undefined;
	}
	return {
		key: `${line}:${range.startColumn}:${range.endColumn}`,
		match: {
			range: new monaco.Range(line, range.startColumn, line, range.endColumn),
			matches: [lineText.text.slice(range.startColumn - 1, range.endColumn - 1)]
		} as unknown as MonacoFindMatch
	};
}

function lineAt(line: number | undefined): SyntheticLine | undefined {
	return line === undefined ? undefined : documentModel.lines[line - 1];
}

function nativeFindController(): NativeFindController | null {
	return (editor?.getContribution('editor.contrib.findController') as NativeFindController | null) ?? null;
}

function refreshNativeFind(query: string, options: FindOptions): void {
	if (query === '') {
		return;
	}
	const controller = nativeFindController();
	const state = readFindState(controller);
	if (!revealedFindState(state)) {
		return;
	}
	// A faster keystroke may already have moved the widget past the result that
	// just arrived; never replace the newer query with a stale result set.
	if (!findStateMatches(state, query, options)) {
		return;
	}
	startNativeFind(controller, state, query, options);
}

function readFindState(controller: NativeFindController | null): NativeFindState | undefined {
	return controller?.getState?.();
}

function revealedFindState(state: NativeFindState | undefined): state is NativeFindState {
	return state !== undefined && state.isRevealed;
}

function findStateMatches(state: NativeFindState, query: string, options: FindOptions): boolean {
	return (
		state.searchString === query &&
		state.isRegex === options.regex &&
		state.wholeWord === options.wholeWord &&
		state.matchCase === options.caseSensitive
	);
}

function startNativeFind(
	controller: NativeFindController | null,
	state: NativeFindState,
	query: string,
	options: FindOptions
): void {
	startFindController(controller, state, query, options);
}

function applyNativeFindResult(requestId: number, result: { matches: FindMatch[] }, error?: string): void {
	const query = takeNativeFindQuery(requestId);
	if (query === undefined) {
		return;
	}
	if (error !== undefined) {
		setDetailsStatus({ message: error, kind: 'warn' });
	}
	nativeFindCache.set(nativeFindKey(query.query, query.options), nativeFindMatches(result, error));
	refreshNativeFind(query.query, query.options);
}

function takeNativeFindQuery(requestId: number): NativeFindQuery | undefined {
	const key = nativeFindRequests.get(requestId);
	if (key === undefined) {
		return undefined;
	}
	nativeFindRequests.delete(requestId);
	nativeFindRequested.delete(key);
	return nativeFindQueries.get(key);
}

function nativeFindMatches(result: { matches: FindMatch[] }, error: string | undefined): MonacoFindMatch[] {
	return error === undefined ? mapNativeMatches(result) : [];
}

function invalidateNativeFind(): void {
	nativeFindCache.clear();
	nativeFindQueries.clear();
	nativeFindRequested.clear();
	nativeFindRequests.clear();
	refreshRevealedFind();
}

function refreshRevealedFind(): void {
	const state = readFindState(nativeFindController());
	if (state?.isRevealed === true && state.searchString !== '') {
		refreshNativeFind(state.searchString, findOptionsFromState(state));
	}
}

function findOptionsFromState(state: NativeFindState): FindOptions {
	return {
		caseSensitive: state.matchCase,
		wholeWord: state.wholeWord,
		regex: state.isRegex
	};
}

/** The row field under one find match, in the offsets the engine compares. */
function nativeTargetForRange(range: monaco.Range): ReplaceTarget | undefined {
	const line = documentModel.lines[range.startLineNumber - 1];
	if (line === undefined) {
		return undefined;
	}
	const span = line.searchSpans.find(
		(candidate) =>
			range.startColumn >= candidate.startColumn && range.endColumn <= candidate.endColumn
	);
	if (span === undefined || line.rowId === undefined) {
		return undefined;
	}
	return {
		rowId: line.rowId,
		field: span.field,
		start: range.startColumn - span.startColumn,
		end: range.endColumn - span.startColumn
	};
}

function nativeReplaceTarget(): ReplaceTarget | undefined {
	const state = readFindState(nativeFindController());
	const fromState = state === undefined ? undefined : replaceTargetAtCurrentMatch(state);
	return fromState ?? selectionReplaceTarget();
}

function replaceTargetAtCurrentMatch(state: NativeFindState): ReplaceTarget | undefined {
	const matches = nativeFindCache.get(nativeFindKey(state.searchString, findOptionsFromState(state))) ?? [];
	const match = matchAtPosition(matches, state.matchesPosition - 1);
	return match === undefined ? undefined : nativeTargetForRange(match.range);
}

function matchAtPosition(matches: readonly MonacoFindMatch[], at: number): MonacoFindMatch | undefined {
	return at >= 0 && at < matches.length ? matches[at] : undefined;
}

function selectionReplaceTarget(): ReplaceTarget | undefined {
	const selection = editor?.getSelection();
	if (selection === undefined || selection === null || selection.isEmpty()) {
		return undefined;
	}
	return nativeTargetForRange(
		new monaco.Range(
			selection.startLineNumber,
			selection.startColumn,
			selection.endLineNumber,
			selection.endColumn
		)
	);
}

/** Route the native widget's Replace/Replace All through the Rust replace planner. */
function requestNativeReplace(all: boolean): boolean {
	const state = readFindState(nativeFindController());
	if (!canReplaceFind(state)) {
		return false;
	}
	const target = all ? undefined : nativeReplaceTarget();
	if (isSearchOnlyTarget(all, target)) {
		// Container labels, values and numeric spans can carry a Rust plan. If
		// no span matches, consume the action instead of letting Monaco edit the
		// synthetic text behind the host.
		setDetailsStatus({ message: 'This match is search-only', kind: 'warn' });
		return true;
	}
	postReplaceRequest(state, all, target);
	return true;
}

function isSearchOnlyTarget(all: boolean, target: ReplaceTarget | undefined): boolean {
	return !all && target === undefined;
}

function canReplaceFind(state: NativeFindState | undefined): state is NativeFindState {
	return state !== undefined && state.isRevealed && state.searchString.trim() !== '';
}

function postReplaceRequest(state: NativeFindState, all: boolean, target: ReplaceTarget | undefined): void {
	const requestId = (nativeReplaceRequestId += 1);
	postToHost({
		type: 'replace',
		requestId,
		query: state.searchString,
		options: findOptionsFromState(state),
		replacement: state.replaceString,
		preserveCase: state.preserveCase,
		all,
		match: target
	});
}

function installNativeReplaceBridge(): void {
	const controller = nativeFindController();
	if (controller?.replace === undefined || controller.replaceAll === undefined) {
		return;
	}
	const nativeReplace = controller.replace.bind(controller);
	const nativeReplaceAll = controller.replaceAll.bind(controller);
	controller.replace = function () {
		return requestNativeReplace(false) || nativeReplace();
	};
	controller.replaceAll = function () {
		return requestNativeReplace(true) || nativeReplaceAll();
	};
}

function installNativeFindBridge(target: monaco.editor.ITextModel): void {
	installFindBridge(target, {
		options: nativeFindOptions,
		matches: nativeMatchesFor,
		request: requestNativeFind
	});
}

function applySidebarVisibility(hidden: boolean): void {
	setSidebarHidden(hidden);
	editorToolbar?.setSidebarHidden(hidden);
}

function foldAll(): void {
	editor?.trigger('toolbar', 'editor.foldAll', null);
}

function unfoldAll(): void {
	editor?.trigger('toolbar', 'editor.unfoldAll', null);
}

function focusAdjacentParameter(fromId: string, direction: string): string | undefined {
	const parameters = rows.filter((row) => row.kind === 'parameter');
	const at = parameters.findIndex((row) => row.id === fromId);
	if (at < 0) {
		return undefined;
	}
	const next = parameters[direction === 'next' ? at + 1 : at - 1];
	if (next === undefined) {
		return undefined;
	}
	revealRow(next.id);
	return next.id;
}

interface MultiEdit {
	span: FieldSpan;
	lineText: SyntheticLine;
	text: string;
	row: EcucRow;
}

function handleMultiChange(event: monaco.editor.IModelContentChangedEvent): void {
	if (model === undefined) {
		return;
	}
	const edits = multiChangeEdits(event, model);
	if (edits === null) {
		rebuildModel();
		return;
	}
	for (const edit of edits) {
		applyLocalField(edit.span.nodeId, edit.span.field, edit.text);
	}
}

function multiChangeEdits(
	event: monaco.editor.IModelContentChangedEvent,
	target: monaco.editor.ITextModel
): MultiEdit[] | null {
	const seenLines = new Set<number>();
	const edits: MultiEdit[] = [];
	for (const change of event.changes) {
		const edit = multiChangeEdit(change, seenLines, target);
		if (edit === null) {
			return null;
		}
		appendEdit(edits, edit);
	}
	return edits;
}

function appendEdit(edits: MultiEdit[], edit: MultiEdit | undefined): void {
	if (edit !== undefined) {
		edits.push(edit);
	}
}

function multiChangeEdit(
	change: monaco.editor.IModelContentChange,
	seenLines: Set<number>,
	target: monaco.editor.ITextModel
): MultiEdit | null | undefined {
	if (!isSingleLineChange(change)) {
		return null;
	}
	const line = change.range.startLineNumber;
	if (seenLines.has(line)) {
		// Two edits on one line cannot be mapped to independent fields safely.
		return null;
	}
	seenLines.add(line);
	return lineEdit(line, change.range, target);
}

function isSingleLineChange(change: monaco.editor.IModelContentChange): boolean {
	return change.range.startLineNumber === change.range.endLineNumber && !isMultiline(change.text);
}

function lineEdit(line: number, range: monaco.IRange, target: monaco.editor.ITextModel): MultiEdit | null | undefined {
	const field = lineFieldEdit(line, range, target);
	if (field === undefined) {
		return null;
	}
	const row = rowById.get(field.span.nodeId);
	if (row === undefined || isMultiline(field.text)) {
		return null;
	}
	return { ...field, row };
}

function lineFieldEdit(
	line: number,
	range: monaco.IRange,
	target: monaco.editor.ITextModel
): { span: FieldSpan; lineText: SyntheticLine; text: string } | undefined {
	const lineText = documentModel.lines[line - 1];
	if (lineText === undefined) {
		return undefined;
	}
	const span = spanForRange(lineText, range);
	if (span === undefined) {
		return undefined;
	}
	return { span, lineText, text: fieldText(target.getLineContent(line), lineText, span) };
}

function spanForRange(lineText: SyntheticLine, range: monaco.IRange): FieldSpan | undefined {
	return lineText.fieldSpans.find(
		(candidate) => range.startColumn >= candidate.startColumn && range.endColumn <= candidate.endColumn
	);
}

function fieldText(current: string, lineText: SyntheticLine, span: FieldSpan): string {
	const suffix = lineText.text.slice(span.endColumn - 1);
	return current.slice(span.startColumn - 1, current.length - suffix.length);
}

function isMultiline(text: string): boolean {
	return /[\r\n]/.test(text);
}

/**
 * Attribute a whole-line replacement to the row's single editable span.
 *
 * A Details edit repaints through `pushEditOperations`, so its undo arrives as a
 * full-line change that starts outside the value span. When the unchanged prefix
 * and suffix still surround that span, the replacement is the field's new text
 * and can flow through the same draft path as direct typing. Anything else (a
 * deleted quote, a moved prefix) is a syntax edit and must be restored.
 */
function wholeLineFieldText(line: number, lineText: SyntheticLine): { span: FieldSpan; text: string } | undefined {
	const span = singleFieldSpan(lineText);
	if (span === undefined) {
		return undefined;
	}
	const current = model?.getLineContent(line);
	if (current === undefined) {
		return undefined;
	}
	return wholeLineSpanText(lineText, span, current);
}

function singleFieldSpan(lineText: SyntheticLine): FieldSpan | undefined {
	return lineText.fieldSpans.length === 1 ? lineText.fieldSpans[0] : undefined;
}

function wholeLineSpanText(
	lineText: SyntheticLine,
	span: FieldSpan,
	current: string
): { span: FieldSpan; text: string } | undefined {
	const text = fieldTextFromWholeLine(lineText.text, lineText.fieldSpans, current);
	return text === undefined ? undefined : { span, text };
}

/**
 * Insert a clipboard paste that contains a line break as one escaped line.
 *
 * A synthetic row is one model line, so a raw multi-line insertion would make the
 * model diverge from the row document and be reverted. Intercepting in the capture
 * phase keeps the field draft on the normal single-line path: the text is escaped
 * exactly as the synthetic display escapes it (`\\n`) and the restored caret lands
 * after the inserted span. A single-line paste and a cut are untouched.
 */
function installMultilinePasteGuard(container: HTMLElement): void {
	container.addEventListener('paste', handleMultilinePaste, true);
}

function handleMultilinePaste(event: ClipboardEvent): void {
	const text = pasteText(event);
	if (!shouldEscapePaste(text)) {
		return;
	}
	const selection = editor?.getSelection();
	if (!isSingleLineSelection(selection)) {
		return;
	}
	const span = selectionSpan(selection);
	if (span === undefined) {
		// Outside a field span the paste is not a value edit; let Monaco decide.
		return;
	}
	event.preventDefault();
	event.stopPropagation();
	insertEscapedPaste(selection, text);
}

function pasteText(event: ClipboardEvent): string {
	return event.clipboardData?.getData('text/plain') ?? '';
}

function shouldEscapePaste(text: string): boolean {
	return text !== '' && isMultiline(text) && editor !== undefined && model !== undefined;
}

function isSingleLineSelection(selection: monaco.Selection | null | undefined): selection is monaco.Selection {
	return selection !== undefined && selection !== null && selection.startLineNumber === selection.endLineNumber;
}

function selectionSpan(selection: monaco.Selection): FieldSpan | undefined {
	const lineText = documentModel.lines[selection.startLineNumber - 1];
	return lineText?.fieldSpans.find(
		(candidate) =>
			selection.startColumn >= candidate.startColumn && selection.endColumn <= candidate.endColumn
	);
}

function insertEscapedPaste(selection: monaco.Selection, text: string): void {
	editor?.executeEdits('paste', [
		{ range: selection, text: escapeNewlines(text), forceMoveMarkers: true }
	]);
}

function handleEdit(event: monaco.editor.IModelContentChangedEvent): void {
	if (isApplyingEdit()) {
		return;
	}
	if (event.changes.length > 1) {
		handleMultiChange(event);
		return;
	}
	const change = event.changes[0];
	if (!isSingleLineChange(change)) {
		rebuildModel();
		return;
	}
	applyChange(change);
}

function isApplyingEdit(): boolean {
	return applyingModel || model === undefined;
}

function applyChange(change: monaco.editor.IModelContentChange): void {
	const line = change.range.startLineNumber;
	const lineText = documentModel.lines[line - 1];
	const span = lineText === undefined ? undefined : spanForRange(lineText, change.range);
	if (lineText === undefined || span === undefined) {
		recoverWholeLine(line, change);
		return;
	}
	applyTypedField(line, lineText, span);
}

function recoverWholeLine(line: number, change: monaco.editor.IModelContentChange): void {
	const lineText = documentModel.lines[line - 1];
	if (lineText === undefined || !isFullLineChange(lineText, change)) {
		// Only a whole-line replacement can be the undo of a programmatic repaint;
		// a one-character change outside the span (a deleted quote) stays a syntax
		// edit, because quotes and value characters are indistinguishable there.
		restoreModelLine(line);
		return;
	}
	const recovered = wholeLineFieldText(line, lineText);
	if (!canRecover(recovered)) {
		restoreModelLine(line);
		return;
	}
	applyLocalField(recovered.span.nodeId, recovered.span.field, recovered.text);
}

function isFullLineChange(lineText: SyntheticLine, change: monaco.editor.IModelContentChange): boolean {
	return change.range.startColumn === 1 && change.range.endColumn === lineText.text.length + 1;
}

function canRecover(
	recovered: { span: FieldSpan; text: string } | undefined
): recovered is { span: FieldSpan; text: string } {
	return recovered !== undefined && rowById.has(recovered.span.nodeId);
}

function applyTypedField(line: number, lineText: SyntheticLine, span: FieldSpan): void {
	const text = typedFieldText(line, lineText, span);
	if (isMultiline(text)) {
		restoreModelLine(line);
		return;
	}
	const row = rowById.get(span.nodeId);
	if (row === undefined) {
		restoreModelLine(line);
		return;
	}
	// Keep the local map in sync while the host round-trip is in flight.
	applyLocalField(span.nodeId, span.field, text);
}

function typedFieldText(line: number, lineText: SyntheticLine, span: FieldSpan): string {
	const current = model?.getLineContent(line) ?? '';
	return fieldText(current, lineText, span);
}

function restoreModelLine(line: number): void {
	const text = documentModel.lines[line - 1]?.text;
	if (text === undefined) {
		return;
	}
	pushLineText(line, text);
}

function revertToAccepted(): void {
	for (const invalid of invalidEdits.values()) {
		syncDetailsField(invalid.nodeId, invalid.field, invalid.display);
	}
	clearPendingEdits();
	invalidEdits.clear();
	saveRequested = false;
	documentModel = buildSyntheticDocument(rows, header);
	rebuildModel();
	updateInspector();
	applyDecorations();
	updateErrorState();
}

function rebuildModel(): void {
	if (model === undefined) {
		return;
	}
	const anchor = captureCursor();
	const viewState = editor?.saveViewState();
	documentModel.text = documentModel.lines.map((line) => line.text).join('\n');
	applyingModel = true;
	model.setValue(`${documentModel.text}\n`);
	applyingModel = false;
	if (viewState !== undefined && viewState !== null) {
		editor?.restoreViewState(viewState);
	}
	restoreCursor(anchor);
	invalidateNativeFind();
}

/** Undo the local draft stack; true keeps the host undo command out of the way. */
function localUndo(): boolean {
	if (!hasLocalDraftStack()) {
		return false;
	}
	undoModel();
	localUndoActive = true;
	return true;
}

/** Redo the local draft stack; true keeps the host redo command out of the way. */
function localRedo(): boolean {
	if (!hasLocalDraftStack()) {
		return false;
	}
	redoModel();
	localUndoActive = true;
	return true;
}

function undoModel(): void {
	const current = editor?.getModel();
	if (current !== undefined && current !== null && current.canUndo()) {
		// The model stack owns keystrokes and the programmatic Details repaint.
		// `editor.trigger('undo')` would hit the host-undo action registered below.
		current.undo();
	}
}

function redoModel(): void {
	const current = editor?.getModel();
	if (current !== undefined && current !== null && current.canRedo()) {
		current.redo();
	}
}

function hasLocalDraftStack(): boolean {
	return localDraftExists() || localUndoActive;
}

function installShortcuts(): void {
	if (editor === undefined) {
		return;
	}
	editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, function () {
		if (localUndo()) {
			return;
		}
		postToHost({ type: 'undo' });
	});
	editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ, function () {
		if (localRedo()) {
			return;
		}
		postToHost({ type: 'redo' });
	});
	editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, function () {
		if (localRedo()) {
			return;
		}
		postToHost({ type: 'redo' });
	});
	editor.addCommand(monaco.KeyCode.F2, function () {
		if (selectedId !== undefined) {
			beginDetailsEdit(selectedId);
		}
	});
	editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, function () {
		if (selectedId !== undefined) {
			postToHost({ type: 'reveal', nodeId: selectedId });
		}
	});
	editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.Enter, function () {
		if (selectedId !== undefined) {
			postToHost({ type: 'reveal', nodeId: selectedId });
		}
	});
	editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyZ, function () {
		const current = editor?.getOption(monaco.editor.EditorOption.wordWrap);
		editor?.updateOptions({ wordWrap: current === 'off' ? 'on' : 'off' });
	});
}

function registerEditorActions(): void {
	if (editor === undefined) {
		return;
	}
	editor.addAction({
		id: 'undo',
		label: 'Undo',
		run: function () {
			if (localUndo()) {
				return;
			}
			postToHost({ type: 'undo' });
		}
	});
	editor.addAction({
		id: 'redo',
		label: 'Redo',
		run: function () {
			if (localRedo()) {
				return;
			}
			postToHost({ type: 'redo' });
		}
	});
	editor.addAction({
		id: 'arxml.duplicateElement',
		label: 'Duplicate ECUC element',
		contextMenuGroupId: 'arxml',
		run: function () {
			if (selectedId !== undefined) {
				postToHost({ type: 'duplicate', nodeId: selectedId });
			}
		}
	});
	editor.addAction({
		id: 'arxml.deleteElement',
		label: 'Delete ECUC element',
		contextMenuGroupId: 'arxml',
		run: function () {
			if (selectedId !== undefined) {
				postToHost({ type: 'delete', nodeId: selectedId });
			}
		}
	});
}

type MessageHandler = (message: EditorProviderToWebview) => void;

const messageHandlers: Readonly<Record<EditorProviderToWebview['type'], MessageHandler>> = {
	document: asMessageHandler(handleDocumentMessage),
	documentPatch: asMessageHandler(handleDocumentPatchMessage),
	editResult: asMessageHandler(handleEditResult),
	dirty: asMessageHandler(handleDirtyMessage),
	flushEdits: asMessageHandler(handleFlushEditsMessage),
	conditions: asMessageHandler(handleConditionsMessage),
	select: asMessageHandler(handleSelectMessage),
	notice: asMessageHandler(handleNoticeMessage),
	error: asMessageHandler(handleErrorMessage),
	findResult: asMessageHandler(handleFindResultMessage),
	replaceResult: asMessageHandler(handleReplaceResultMessage),
	settings: asMessageHandler(handleSettingsMessage),
	theme: asMessageHandler(handleThemeMessage)
};

/**
 * Each entry is typed for its own union member; the dispatcher has already read
 * the discriminator, so the narrow handler is safe to call with the payload.
 */
function asMessageHandler<T>(handler: (message: T) => void): MessageHandler {
	return handler as unknown as MessageHandler;
}

function handleMessage(message: EditorProviderToWebview): void {
	if (!message || typeof message.type !== 'string') {
		return;
	}
	handleDetailsEditorMessage(message);
	messageHandlers[message.type]?.(message);
}

function acceptRevision(revision: unknown): boolean {
	if (typeof revision !== 'number') {
		return true;
	}
	if (revision < hostRevision) {
		return false;
	}
	hostRevision = revision;
	hostAcks = true;
	return true;
}

function applyHostDirty(dirty: unknown): void {
	if (typeof dirty === 'boolean') {
		hostDirty = dirty;
	}
}

function handleDocumentMessage(message: EditorMessage<'document'>): void {
	if (!acceptRevision(message.document.revision)) {
		return;
	}
	applyHostDirty(message.document.dirty);
	applySettings(message.document.settings);
	applyRows(message.document.rows, message.document.header, message.document.selectedId);
	updateErrorState();
}

function handleDocumentPatchMessage(message: EditorMessage<'documentPatch'>): void {
	if (!acceptRevision(message.revision)) {
		return;
	}
	applyHostDirty(message.dirty);
	applyPatch(message.patch, message.header, message.selectedId);
	updateErrorState();
}

function handleDirtyMessage(message: EditorMessage<'dirty'>): void {
	if (typeof message.revision !== 'number' || typeof message.dirty !== 'boolean') {
		return;
	}
	hostAcks = true;
	hostRevision = Math.max(hostRevision, message.revision);
	hostDirty = message.dirty;
	updateDirtyStatus();
}

function handleFlushEditsMessage(message: EditorMessage<'flushEdits'>): void {
	if (typeof message.requestId !== 'number') {
		return;
	}
	flushRequests.add(message.requestId);
	// A stale draft leaves `pendingEdits` non-empty, so the flush is never
	// acknowledged and the host save waits rather than writing past it.
	flushEdits();
	maybeAcknowledgeFlush();
}

function handleSettingsMessage(message: EditorMessage<'settings'>): void {
	applySettings(message.settings);
}

function handleThemeMessage(_message: EditorMessage<'theme'>): void {
	defineEcucTheme();
	monaco.editor.setTheme('arxml-ecuc-theme');
}

function handleConditionsMessage(message: EditorMessage<'conditions'>): void {
	renderConditionEntries(message.entries);
}

function handleSelectMessage(message: EditorMessage<'select'>): void {
	if (rowById.has(message.nodeId)) {
		setSelection(message.nodeId, true);
	}
}

function handleFindResultMessage(message: EditorMessage<'findResult'>): void {
	applyNativeFindResult(message.requestId, message.result, message.error);
}

function handleReplaceResultMessage(message: EditorMessage<'replaceResult'>): void {
	if (!message.result.ok) {
		reportReplaceFailure(message.result.reason);
		return;
	}
	// The host applied the Rust plan. Re-run the open query against the new
	// document instead of the synthetic text Monaco replaced locally.
	invalidateNativeFind();
}

function reportReplaceFailure(reason: string | undefined): void {
	if (reason !== undefined) {
		setDetailsStatus({ message: reason, kind: 'warn' });
	}
}

function handleNoticeMessage(message: EditorMessage<'notice'>): void {
	if (message.scope === 'conditions') {
		setConditionsStatus(message.message || '');
		return;
	}
	applyNotice(message);
}

function applyNotice(message: EditorMessage<'notice'>): void {
	revertOnStaleNotice(message);
	showNoticeStatus(message);
}

function revertOnStaleNotice(message: EditorMessage<'notice'>): void {
	// A revisioned host answers every field edit with an `editResult`, which
	// restores exactly the refused field and keeps newer edits. The blanket
	// restore here is only for a host that predates that acknowledgement.
	if (hasPendingEdits() && !hostAcks && message.kind === 'warn') {
		revertToAccepted();
	}
}

function showNoticeStatus(message: EditorMessage<'notice'>): void {
	if (!refusalShownInDetails(message, getSidebarState().tab !== 'details')) {
		setDetailsStatus(message);
	}
}

function handleErrorMessage(message: EditorMessage<'error'>): void {
	setDetailsStatus({ message: message.message, kind: 'warn' });
}

type EditorOptionsUpdate = Parameters<monaco.editor.IStandaloneCodeEditor['updateOptions']>[0];

function applySettings(settings: MonacoSettings | undefined): void {
	if (editor === undefined || settings === undefined) {
		return;
	}
	editor.updateOptions(settingsOptions(settings));
}

function settingsOptions(settings: MonacoSettings): EditorOptionsUpdate {
	return {
		...fontSettings(settings),
		...wrapSettings(settings),
		...guideSettings(settings),
		...cursorSettings(settings),
		...renderSettings(settings)
	};
}

function fontSettings(settings: MonacoSettings): EditorOptionsUpdate {
	return {
		...fontFamilySetting(settings),
		...fontSizeSetting(settings),
		...lineHeightSetting(settings),
		...fontWeightSetting(settings)
	};
}

function fontFamilySetting(settings: MonacoSettings): EditorOptionsUpdate {
	return settings.fontFamily !== undefined ? { fontFamily: settings.fontFamily } : {};
}

function fontSizeSetting(settings: MonacoSettings): EditorOptionsUpdate {
	return settings.fontSize !== undefined ? { fontSize: settings.fontSize } : {};
}

function lineHeightSetting(settings: MonacoSettings): EditorOptionsUpdate {
	return settings.lineHeight !== undefined && settings.lineHeight > 0 ? { lineHeight: settings.lineHeight } : {};
}

function fontWeightSetting(settings: MonacoSettings): EditorOptionsUpdate {
	return settings.fontWeight !== undefined ? { fontWeight: settings.fontWeight } : {};
}

function wrapSettings(settings: MonacoSettings): EditorOptionsUpdate {
	return {
		...(settings.wordWrap !== undefined ? { wordWrap: settings.wordWrap } : {}),
		...(settings.wordWrapColumn !== undefined ? { wordWrapColumn: settings.wordWrapColumn } : {})
	};
}

function guideSettings(settings: MonacoSettings): EditorOptionsUpdate {
	return {
		...(settings.minimap !== undefined ? { minimap: { enabled: settings.minimap } } : {}),
		...stickyScrollSetting(settings),
		...indentationGuideSetting(settings)
	};
}

function stickyScrollSetting(settings: MonacoSettings): EditorOptionsUpdate {
	return settings.stickyScroll !== undefined
		? { stickyScroll: { enabled: settings.stickyScroll, defaultModel: 'foldingProviderModel' } }
		: {};
}

function indentationGuideSetting(settings: MonacoSettings): EditorOptionsUpdate {
	if (!hasGuideSetting(settings)) {
		return {};
	}
	return {
		guides: {
			indentation: indentationGuides(settings),
			bracketPairs: bracketPairGuides(settings)
		}
	};
}

function hasGuideSetting(settings: MonacoSettings): boolean {
	return settings.indentationGuides !== undefined || settings.bracketPairGuides !== undefined;
}

function indentationGuides(settings: MonacoSettings): boolean {
	return settings.indentationGuides ?? true;
}

function bracketPairGuides(settings: MonacoSettings): boolean | 'active' {
	return settings.bracketPairGuides ?? false;
}

function cursorSettings(settings: MonacoSettings): EditorOptionsUpdate {
	return {
		...(settings.cursorStyle !== undefined ? { cursorStyle: settings.cursorStyle } : {}),
		...(settings.cursorBlinking !== undefined ? { cursorBlinking: settings.cursorBlinking } : {}),
		...(settings.smoothScrolling !== undefined ? { smoothScrolling: settings.smoothScrolling } : {})
	};
}

function renderSettings(settings: MonacoSettings): EditorOptionsUpdate {
	return settings.renderWhitespace !== undefined ? { renderWhitespace: settings.renderWhitespace } : {};
}

function mountToolbar(): void {
	editorToolbar = new EditorToolbar({
		onCollapseAll: foldAll,
		onExpandAll: unfoldAll,
		onToggleSidebar: function () {
			applySidebarVisibility(!getSidebarState().hidden);
		}
	});
	editorToolbar.mount();
	editorToolbar.setSidebarHidden(getSidebarState().hidden);
}

function mountDetails(): void {
	detailsBody = document.getElementById('sb-details-body');
	detailsStatus = document.getElementById('details-status');
	setDetailsEditorHost({
		...detailsEditorHostBase(
			function (id) {
				return rowById.get(id);
			},
			function () {
				return selectedId;
			},
			function () {
				applySidebarVisibility(false);
			}
		),
		renderedItem: function () {
			return undefined;
		},
		selectItem: function (item) {
			const id = item && item.dataset ? item.dataset.nodeId : undefined;
			if (typeof id === 'string') {
				setSelection(id, true);
			}
		},
		setSelection: function (id) {
			setSelection(id);
		},
		postSelect: function (id) {
			postToHost({ type: 'select', nodeId: id });
		},
		focusRow: function (id) {
			if (!rowById.has(id)) {
				return false;
			}
			revealRow(id, true);
			return true;
		},
		updateInspector,
		previewEdit: function (message) {
			const field: EditField =
				message.field === 'shortName' || message.field === 'definitionRef' ? message.field : 'value';
			applyLocalField(message.nodeId, field, message.value);
		},
		commitEdit: function (message) {
			postToHost(message);
		},
		focusAdjacentParameter
	});
}

async function mountEditor(): Promise<void> {
	resetVsCodeApi();
	resetDetailsEditorState();
	reportError = installConsoleErrors(window, console, 'ECUC editor').report;
	const container = document.getElementById('tree');
	if (container === null) {
		return;
	}
	container.textContent = '';
	container.className = 'monaco-ecuc-host';
	container.removeAttribute('role');
	container.setAttribute('aria-label', 'ECUC values');

	await ensureMonacoEnvironment();
	defineEcucTheme();
	model = monaco.editor.createModel('', 'arxml-ecuc');
	setModelFolding(model, documentModel.foldingRanges);
	installNativeFindBridge(model);
	editor = createEcucEditor(container, model);
	installMultilinePasteGuard(container);
	installNativeReplaceBridge();
	if ((window as unknown as { __PREVIEW__?: unknown }).__PREVIEW__ !== undefined) {
		(window as unknown as { __ARXML_EDITOR__?: unknown }).__ARXML_EDITOR__ = editor;
	}
	editor.onDidChangeModelContent(handleEdit);
	editor.onDidChangeCursorPosition(handleCursorPosition);
	window.addEventListener('beforeunload', function (event) {
		if (localDraftExists()) {
			event.preventDefault();
			event.returnValue = '';
		}
	});

	setSidebarState(readPageState<SidebarUiState>());
	setSidebarPersistence(function () {
		writePageState(getSidebarState());
	});
	mountSidebarShell();
	mountToolbar();
	mountDetails();
	mountConditionsPanel();
	errorStrip = document.getElementById('editor-error-strip');
	document.addEventListener('keydown', handleSaveShortcut, true);
	setConditionRows([]);
	setConditionsCallback(function (entries) {
		postToHost({ type: 'conditions', entries });
	});
	setConditionsErrorReporter(reportError);

	installShortcuts();
	registerEditorActions();
	handleThemeChanges();
	mounted = true;
	for (const message of pendingMessages) {
		handleMessage(message);
	}
	pendingMessages.length = 0;
	postToHost({ type: 'ready' });
}

function handleCursorPosition(event: monaco.editor.ICursorPositionChangedEvent): void {
	if (applyingModel || restoringView) {
		// A document/patch rebuild resets the cursor before the host's selected
		// row is applied. Treating that as a user move would rebuild the inspector
		// for the wrong row and detach the focused Details control.
		return;
	}
	const id = rowIdAtLine(event.position.lineNumber);
	if (cursorSelectionChanged(id)) {
		setSelection(id);
		postToHost({ type: 'select', nodeId: id });
	}
}

function cursorSelectionChanged(id: string | undefined): id is string {
	return id !== undefined && id !== selectedId;
}

function handleSaveShortcut(event: KeyboardEvent): void {
	if (!isSaveShortcut(event)) {
		return;
	}
	event.preventDefault();
	event.stopPropagation();
	requestSave();
}

function isSaveShortcut(event: KeyboardEvent): boolean {
	return isCommandKey(event) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's';
}

function isCommandKey(event: KeyboardEvent): boolean {
	return event.ctrlKey || event.metaKey;
}

function handleThemeChanges(): void {
	const observer = new MutationObserver(function () {
		defineEcucTheme();
		monaco.editor.setTheme('arxml-ecuc-theme');
	});
	observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

if (typeof document !== 'undefined' && document.getElementById('tree')) {
	void mountEditor();
}
