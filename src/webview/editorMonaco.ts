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
import type {
	EditorDocumentHeader,
	EditorProviderToWebview,
	EditorRowPatch,
	MonacoSettings
} from '../webviewProtocol';
import type { FindMatch, FindOptions } from '../core/searchModel';
import {
	buildSyntheticDocument,
	rawFieldText,
	searchRangeOnLine,
	syntheticRowLine,
	type SyntheticDocument,
	type SyntheticLine,
	type FieldSpan
} from './monaco/synthetic';
import { createEcucEditor, defineEcucTheme, ensureMonacoEnvironment, monaco, setModelFolding } from './monaco/setup';
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
import {
	definitionRows,
	inspectorFields,
	refusalShownInDetails
} from './components/sidebar/detailsPanel/detailsPanel';
import type { InspectorFields } from './components/sidebar/detailsPanel/detailsPanel';
import {
	beginDetailsEdit,
	detailsContainerFields,
	detailsSelectionChanged,
	detailsValueInput,
	handleDetailsEditorMessage,
	resetDetailsEditorState,
	setDetailsEditorHost,
	syncDetailsField
} from './components/detailsEditor/detailsEditor';
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
import { inspectorElement } from './render/dom';
import { appendConditionTokens } from './render/rowView';
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
type MonacoFindMatch = ReturnType<monaco.editor.ITextModel['findMatches']>[number];
interface NativeFindQuery {
	query: string;
	options: FindOptions;
}
interface NativeFindController {
	getState?(): {
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
	};
	start?(opts: unknown, state?: unknown): Promise<void>;
	replace?(): boolean;
	replaceAll?(): boolean;
}
let nativeFindCache = new Map<string, MonacoFindMatch[]>();
let nativeFindQueries = new Map<string, NativeFindQuery>();
let nativeFindRequested = new Set<string>();
let nativeFindRequests = new Map<number, string>();
let nativeFindRequestId = 0;
let nativeReplaceRequestId = 0;
let applyingModel = false;
interface QueuedEdit {
	type: 'edit';
	editId: number;
	nodeId: string;
	field?: 'value' | 'shortName' | 'definitionRef';
	/** The host value, after the display-to-raw conversion for numeric text. */
	value: string;
	/** The exact text currently shown in the synthetic line. */
	display: string;
}
let pendingEdits = new Map<string, QueuedEdit>();
let inflightEdits = new Map<number, QueuedEdit>();
let editSequence = 0;
let hostRevision = 0;
let hostDirty = false;
/** True once the host proves it speaks the revisioned edit protocol. */
let hostAcks = false;
let editTimer: ReturnType<typeof setTimeout> | undefined;
const EDIT_DEBOUNCE_MS = 160;
const flushRequests = new Set<number>();
interface InvalidEdit {
	nodeId: string;
	field: 'value' | 'shortName' | 'definitionRef';
	message: string;
	display: string;
	editId: number;
}
let invalidEdits = new Map<string, InvalidEdit>();
let saveRequested = false;
let errorStrip: HTMLElement | null = null;
let decorationIds: string[] = [];
let detailsBody: HTMLElement | null = null;
let detailsStatus: HTMLElement | null = null;
let reportError: (text: string) => void = function () {};
let mounted = false;
const pendingMessages: EditorProviderToWebview[] = [];

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
	const out = new Set<string>();
	if (id === undefined) {
		return out;
	}
	const at = rowIndexById.get(id);
	const row = rowById.get(id);
	if (at === undefined || row === undefined) {
		return out;
	}
	for (let index = at; index <= at + row.subtreeSize && index < rows.length; index += 1) {
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

function inspectorRow(key: string, value: string): HTMLElement {
	const row = inspectorElement('div', 'inspector-row');
	row.appendChild(inspectorElement('span', 'inspector-key', key));
	row.appendChild(inspectorElement('div', 'inspector-code', value));
	return row;
}

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

function appendInspectorField(key: string, value: string): void {
	detailsBody?.appendChild(inspectorRow(key, value));
}

function renderEmptyInspector(): void {
	detailsSelectionChanged(undefined);
	const emptyPanel = inspectorElement('div', 'inspector-empty');
	emptyPanel.appendChild(inspectorElement('p', '', 'Select a line to see its details.'));
	emptyPanel.appendChild(inspectorElement('p', 'inspector-hint', 'Use the arrow keys to move through the document.'));
	detailsBody?.appendChild(emptyPanel);
}

function renderIdentityFields(row: EcucRow, data: InspectorFields): void {
	detailsBody?.appendChild(inspectorElement('div', 'inspector-kind', data.kind));
	detailsBody?.appendChild(inspectorElement('div', 'inspector-label', data.label));
	if (row.kind === 'container') {
		if (detailsBody) {
			detailsBody.appendChild(detailsContainerFields(row, data));
		}
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
	if (data.kind === 'parameter' && detailsBody) {
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

function renderCondition(condition: RowCondition): void {
	detailsBody?.appendChild(conditionCodeRow('Condition', condition.text));
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
	if (data.conditions && detailsBody) {
		detailsBody.appendChild(conditionCodeRow('Conditions', data.conditions));
	}
	if (data.annotations) {
		appendInspectorField('Annotations', data.annotations);
	}
}

function renderDefinitionFields(data: InspectorFields): void {
	if (data.definition) {
		for (const field of definitionRows(data.definition)) {
			appendInspectorField(field.label, field.value);
		}
		return;
	}
	if (data.definitionCount !== undefined && data.definitionCount >= 2) {
		appendInspectorField('Definition type', `${data.definitionCount} definitions found`);
	}
}

function isFollowableReference(row: EcucRow): boolean {
	return row.kind === 'reference' && row.followable === true;
}

function appendJumpAction(actions: HTMLElement, row: EcucRow): void {
	if (!isFollowableReference(row)) {
		return;
	}
	const jump = inspectorElement('button', 'sb-btn sb-btn-secondary', 'Jump to target') as HTMLButtonElement;
	jump.type = 'button';
	jump.addEventListener('click', function () {
		postToHost({ type: 'follow', nodeId: row.id });
	});
	actions.appendChild(jump);
}

function appendReferencesAction(actions: HTMLElement, row: EcucRow): void {
	if (row.kind !== 'module' && row.kind !== 'container') {
		return;
	}
	const references = inspectorElement('button', 'sb-btn sb-btn-secondary', 'Find references') as HTMLButtonElement;
	references.type = 'button';
	references.addEventListener('click', function () {
		postToHost({ type: 'references', nodeId: row.id });
	});
	actions.appendChild(references);
}

function appendRevealAction(actions: HTMLElement, row: EcucRow): void {
	const reveal = inspectorElement('button', 'sb-btn sb-btn-secondary', 'Reveal in source') as HTMLButtonElement;
	reveal.type = 'button';
	reveal.addEventListener('click', function () {
		postToHost({ type: 'reveal', nodeId: row.id });
	});
	actions.appendChild(reveal);
}

function renderInspectorActions(row: EcucRow): void {
	if (!detailsBody) {
		return;
	}
	const actions = paneActions(detailsBody);
	appendJumpAction(actions, row);
	appendReferencesAction(actions, row);
	appendRevealAction(actions, row);
}

function updateInspector(): void {
	if (!detailsBody) {
		return;
	}
	detailsBody.textContent = '';
	const row = selectedRow();
	if (row === undefined) {
		renderEmptyInspector();
		return;
	}
	detailsSelectionChanged(row.id);
	const data = inspectorFields(row);
	renderIdentityFields(row, data);
	renderTypeFields(data);
	renderParameterValue(row, data);
	renderReferenceFields(row, data);
	renderConditionFields(row, data);
	renderConditionSummary(data);
	renderDefinitionFields(data);
	renderInspectorActions(row);
}

function applyDecorations(): void {
	if (editor === undefined) {
		return;
	}
	const decorations: monaco.editor.IModelDeltaDecoration[] = [];
	const addWholeLine = (line: number | undefined, className: string, zIndex = 1): void => {
		if (line === undefined) {
			return;
		}
		decorations.push({
			range: new monaco.Range(line, 1, line, 1),
			options: { isWholeLine: true, className, zIndex }
		});
	};
	for (const line of documentModel.lines) {
		if (line.rowId === undefined || !subtreeIds.has(line.rowId)) {
			continue;
		}
		const structural = line.kind === 'brace' || line.kind === 'annotation';
		addWholeLine(line.line, line.rowId === selectedId && !structural ? 'arxml-selected' : 'arxml-subtree');
	}
	for (const row of rows) {
		if (row.disabled) {
			addWholeLine(lineOf(row.id), 'arxml-disabled');
		}
	}
	decorationIds = editor.deltaDecorations(decorationIds, decorations);
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
		return { line: 1, column: 1, selectionEndLine: 1, selectionEndColumn: 1, scrollTop: 0, scrollLeft: 0 };
	}
	const selection = editor.getSelection();
	const startLine = selection?.selectionStartLineNumber ?? position.lineNumber;
	const startColumn = selection?.selectionStartColumn ?? position.column;
	const endLine = selection?.positionLineNumber ?? position.lineNumber;
	const endColumn = selection?.positionColumn ?? position.column;
	return {
		rowId: rowIdAtLine(startLine),
		line: startLine,
		column: startColumn,
		selectionEndRowId: rowIdAtLine(endLine),
		selectionEndLine: endLine,
		selectionEndColumn: endColumn,
		scrollTop: editor.getScrollTop(),
		scrollLeft: editor.getScrollLeft()
	};
}

function restoreCursor(anchor: CursorAnchor): void {
	if (editor === undefined || model === undefined) {
		return;
	}
	const line = anchor.rowId !== undefined ? documentModel.rowLine.get(anchor.rowId) : anchor.line;
	const endLine =
		anchor.selectionEndRowId !== undefined
			? documentModel.rowLine.get(anchor.selectionEndRowId) ?? anchor.selectionEndLine
			: anchor.selectionEndLine;
	if (line === undefined) {
		return;
	}
	const safeLine = Math.min(line, model.getLineCount());
	const safeEndLine = Math.min(endLine, model.getLineCount());
	editor.setSelection(
		new monaco.Selection(
			safeLine,
			Math.min(anchor.column, model.getLineMaxColumn(safeLine)),
			safeEndLine,
			Math.min(anchor.selectionEndColumn, model.getLineMaxColumn(safeEndLine))
		)
	);
	editor.setScrollTop(anchor.scrollTop);
	editor.setScrollLeft(anchor.scrollLeft);
}

function editKey(edit: QueuedEdit): string {
	return `${edit.nodeId}|${edit.field ?? ''}`;
}

function localEditPending(): boolean {
	return pendingEdits.size > 0 || inflightEdits.size > 0 || editTimer !== undefined;
}

function hasPendingEdits(): boolean {
	return localEditPending();
}

function localDraftExists(): boolean {
	return pendingEdits.size > 0 || inflightEdits.size > 0 || editTimer !== undefined || invalidEdits.size > 0;
}

function updateDirtyStatus(): void {
	const first = invalidEdits.values().next().value as InvalidEdit | undefined;
	editorToolbar?.setDirty(localEditPending() || hostDirty, first?.message);
}

function maybeRequestSave(): void {
	if (
		!saveRequested ||
		invalidEdits.size > 0 ||
		pendingEdits.size > 0 ||
		inflightEdits.size > 0 ||
		editTimer !== undefined
	) {
		return;
	}
	saveRequested = false;
	postToHost({ type: 'save' });
}

function requestSave(): void {
	if (invalidEdits.size > 0) {
		saveRequested = false;
		const first = invalidEdits.values().next().value as InvalidEdit;
		setSelection(first.nodeId);
		revealRow(first.nodeId, true);
		updateErrorState();
		return;
	}
	saveRequested = true;
	flushEdits();
	maybeRequestSave();
}

function fieldKey(nodeId: string, field: string): string {
	return `${nodeId}|${field}`;
}

function xmlInvalid(text: string): boolean {
	return /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text);
}

function localValueError(row: EcucRow, field: string, value: string): string | undefined {
	if (xmlInvalid(value)) {
		return 'XML cannot represent this character';
	}
	if (field !== 'value' || row.kind !== 'parameter') {
		return undefined;
	}
	const type = row.parameterType;
	if (type === 'Integer' && !/^[+-]?(?:\d+|0[xX][0-9a-fA-F]+|0[bB][01]+)$/.test(value)) {
		return 'Invalid integer value';
	}
	if (
		type === 'Float' &&
		!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) &&
		!/^[+-]?(?:INF|NaN)$/.test(value)
	) {
		return 'Invalid float value';
	}
	if (type === 'Boolean' && !/^(?:true|false)$/i.test(value)) {
		return 'Invalid boolean value';
	}
	return undefined;
}

function displayForRaw(row: EcucRow, field: string, raw: string): string {
	if (field !== 'value') {
		return raw;
	}
	const shown = row.shownValue ?? row.value ?? '';
	const quoted = shown.length >= 2 && shown.startsWith('"') && shown.endsWith('"');
	return quoted ? `"${raw.replace(/\r\n|\r|\n/g, '\\n')}"` : raw;
}

function markerForInvalid(invalid: InvalidEdit): monaco.editor.IMarkerData | undefined {
	const line = documentModel.rowLine.get(invalid.nodeId);
	const lineText = line === undefined ? undefined : documentModel.lines[line - 1];
	if (line === undefined || lineText === undefined) {
		return undefined;
	}
	const span = lineText.fieldSpans.find((candidate) => candidate.field === invalid.field);
	return {
		severity: monaco.MarkerSeverity.Error,
		message: invalid.message,
		startLineNumber: line,
		startColumn: span?.startColumn ?? 1,
		endLineNumber: line,
		endColumn: span?.endColumn ?? Math.max(lineText.text.length + 1, 2)
	};
}

function updateErrorState(): void {
	const first = invalidEdits.values().next().value as InvalidEdit | undefined;
	if (errorStrip !== null) {
		errorStrip.hidden = first === undefined;
		errorStrip.textContent = first === undefined ? '' : `Invalid value — ${first.message}`;
	}
	if (model !== undefined) {
		const markers = Array.from(invalidEdits.values())
			.map(markerForInvalid)
			.filter((marker): marker is monaco.editor.IMarkerData => marker !== undefined);
		monaco.editor.setModelMarkers(model, 'arxml-ecuc', markers);
	}
	if (first !== undefined) {
		setDetailsStatus({ message: first.message, kind: 'warn' });
	}
	updateDirtyStatus();
}

function replaceSyntheticLine(line: number, row: EcucRow, display: string): void {
	if (model === undefined) {
		return;
	}
	const built = syntheticRowLine({
		...row,
		...(row.kind === 'parameter' ? { value: rawFieldText(row, display), shownValue: display } : {}),
		...(row.kind === 'container' ? { shortName: display } : {})
	});
	const anchor = captureCursor();
	documentModel.lines[line - 1] = {
		line,
		rowId: row.id,
		kind: row.kind,
		text: built.text,
		fieldSpans: built.fieldSpans,
		searchSpans: built.searchSpans
	};
	documentModel.text = documentModel.lines.map((candidate) => candidate.text).join('\n');
	applyingModel = true;
	model.pushEditOperations(
		[],
		[{ range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)), text: built.text }],
		function () {
			return null;
		}
	);
	applyingModel = false;
	restoreCursor(anchor);
}

function syncDetails(nodeId: string, field: string, raw: string): void {
	syncDetailsField(nodeId, field, raw);
}

/** The single mutation path for a live field value from Monaco or Details. */
function applyLocalField(
	nodeId: string,
	field: 'value' | 'shortName' | 'definitionRef',
	raw: string,
	display = raw
): void {
	const row = rowById.get(nodeId);
	const line = documentModel.rowLine.get(nodeId);
	if (row === undefined || line === undefined) {
		return;
	}
	const key = fieldKey(nodeId, field);
	const error = localValueError(row, field, raw);
	const shown = displayForRaw(row, field, display);
	replaceSyntheticLine(line, row, shown);
	const detailsValue = field === 'value' ? raw : display;
	syncDetails(nodeId, field, detailsValue);
	if (error !== undefined) {
		// The invalid text stays visible, but it never enters the host document.
		pendingEdits.delete(key);
		invalidEdits.set(key, { nodeId, field, message: error, display: shown, editId: (editSequence += 1) });
		updateErrorState();
		return;
	}
	invalidEdits.delete(key);
	queueEdit({
		nodeId,
		field,
		value: field === 'value' ? rawFieldText(row, raw) : raw,
		display: shown
	});
	updateErrorState();
}

function maybeAcknowledgeFlush(): void {
	if (pendingEdits.size > 0 || inflightEdits.size > 0 || editTimer !== undefined || flushRequests.size === 0) {
		return;
	}
	for (const requestId of flushRequests) {
		postToHost({ type: 'flushed', requestId });
	}
	flushRequests.clear();
}

function clearPendingEdits(): void {
	if (editTimer !== undefined) {
		clearTimeout(editTimer);
		editTimer = undefined;
	}
	pendingEdits.clear();
	inflightEdits.clear();
	updateDirtyStatus();
	maybeAcknowledgeFlush();
}

function flushEdits(): void {
	if (editTimer !== undefined) {
		clearTimeout(editTimer);
		editTimer = undefined;
	}
	for (const [key, edit] of Array.from(pendingEdits)) {
		// One edit per field may be in flight. A newer value waits for its ack so
		// a refusal cannot be confused with the value that superseded it.
		if (inflightEdits.has(edit.editId)) {
			continue;
		}
		const keyBusy = Array.from(inflightEdits.values()).some((candidate) => editKey(candidate) === key);
		if (keyBusy) {
			continue;
		}
		pendingEdits.delete(key);
		inflightEdits.set(edit.editId, edit);
		postToHost({
			type: 'edit',
			editId: edit.editId,
			nodeId: edit.nodeId,
			field: edit.field,
			value: edit.value,
			baseRevision: hostRevision
		});
	}
	updateDirtyStatus();
	maybeAcknowledgeFlush();
}

function queueEdit(edit: { nodeId: string; field?: 'value' | 'shortName' | 'definitionRef'; value: string; display: string }): void {
	// Coalesce a fast typing run into one host write. The local buffer is already
	// authoritative for the keystroke; the host round-trip only persists it.
	const next: QueuedEdit = {
		type: 'edit',
		editId: (editSequence += 1),
		nodeId: edit.nodeId,
		field: edit.field,
		value: edit.value,
		display: edit.display
	};
	pendingEdits.set(editKey(next), next);
	if (editTimer !== undefined) {
		clearTimeout(editTimer);
	}
	editTimer = setTimeout(flushEdits, EDIT_DEBOUNCE_MS);
	updateDirtyStatus();
}

function hasNewerLocalEdit(edit: QueuedEdit): boolean {
	const key = editKey(edit);
	return (
		Array.from(pendingEdits.values()).some((candidate) => editKey(candidate) === key && candidate.editId > edit.editId) ||
		Array.from(inflightEdits.values()).some((candidate) => editKey(candidate) === key && candidate.editId > edit.editId) ||
		(invalidEdits.get(key)?.editId ?? 0) > edit.editId
	);
}

/** Put the host-accepted row text back after a refusal with no newer local edit. */
function handleEditResult(message: { editId: number; ok: boolean; reason?: string; revision: number }): void {
	if (typeof message.editId !== 'number' || typeof message.revision !== 'number' || typeof message.ok !== 'boolean') {
		return;
	}
	const edit = inflightEdits.get(message.editId);
	if (edit === undefined) {
		return;
	}
	inflightEdits.delete(message.editId);
	hostAcks = true;
	hostRevision = Math.max(hostRevision, message.revision);
	if (message.ok) {
		hostDirty = true;
		const invalid = invalidEdits.get(editKey(edit));
		if (invalid === undefined || invalid.editId <= edit.editId) {
			invalidEdits.delete(editKey(edit));
		}
	} else if (!hasNewerLocalEdit(edit)) {
		// Keep the refused text visible and marked instead of silently restoring the
		// old value; Ctrl+S stays blocked until the user corrects or reverts it.
		saveRequested = false;
		invalidEdits.set(editKey(edit), {
			nodeId: edit.nodeId,
			field: edit.field ?? 'value',
			message: message.reason ?? 'the edit was refused',
			display: edit.display,
			editId: edit.editId
		});
		if (message.reason !== undefined && message.reason !== '') {
			setDetailsStatus({ message: message.reason, kind: 'warn' });
		}
		updateErrorState();
	}
	updateDirtyStatus();
	if (pendingEdits.size > 0) {
		flushEdits();
	} else {
		maybeAcknowledgeFlush();
	}
	maybeRequestSave();
}

function revealRow(id: string | undefined, focus = false, column = 1): void {
	if (editor === undefined || id === undefined) {
		return;
	}
	const line = lineOf(id);
	if (line === undefined) {
		return;
	}
	editor.revealLineInCenter(line);
	const maxColumn = editor.getModel()?.getLineMaxColumn(line) ?? 1;
	editor.setPosition({ lineNumber: line, column: Math.min(column, maxColumn) });
	if (focus) {
		editor.focus();
	}
}

function latestLocalEdits(): QueuedEdit[] {
	const latest = new Map<string, QueuedEdit>();
	for (const edit of inflightEdits.values()) {
		latest.set(editKey(edit), edit);
	}
	for (const edit of pendingEdits.values()) {
		const current = latest.get(editKey(edit));
		if (current === undefined || edit.editId > current.editId) {
			latest.set(editKey(edit), edit);
		}
	}
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
	return Array.from(latest.values());
}

/** Paint an optimistic field value over a line built from host-accepted rows. */
function overlayLocalOnLine(line: SyntheticLine, local: readonly QueuedEdit[] = latestLocalEdits()): void {
	for (const edit of local) {
		if (line.rowId !== edit.nodeId) {
			continue;
		}
		const field = edit.field ?? 'value';
		const span = line.fieldSpans.find((candidate) => candidate.field === field);
		if (span === undefined) {
			continue;
		}
		const before = line.text.slice(0, span.startColumn - 1);
		const after = line.text.slice(span.endColumn - 1);
		line.text = before + edit.display + after;
		span.text = edit.display;
		span.endColumn = span.startColumn + edit.display.length;
	}
}

function overlayLocalEdits(doc: SyntheticDocument): void {
	const local = latestLocalEdits();
	for (const line of doc.lines) {
		overlayLocalOnLine(line, local);
	}
	doc.text = doc.lines.map((line) => line.text).join('\n');
}

function applyRows(nextRows: EcucRow[], nextHeader?: EditorDocumentHeader, nextSelectedId?: string): void {
	const anchor = captureCursor();
	const viewState = editor?.saveViewState();
	rows = Array.isArray(nextRows) ? nextRows : [];
	indexRows();
	if (nextHeader !== undefined) {
		header = nextHeader;
	}
	documentModel = buildSyntheticDocument(rows, header);
	overlayLocalEdits(documentModel);
	if (model !== undefined) {
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
	if (nextSelectedId !== undefined) {
		selectedId = nextSelectedId;
	}
	if (selectedId !== undefined && !rowById.has(selectedId)) {
		selectedId = undefined;
	}
	subtreeIds = subtreeRowIdsOf(selectedId);
	setConditionRows(rows);
	ensureDiscoveredConditionRows();
	applyDisabledCount();
	updateInspector();
	applyDecorations();
	restoreCursor(anchor);
	invalidateNativeFind();
}

function applyPatch(patch: EditorRowPatch, nextHeader?: EditorDocumentHeader, nextSelectedId?: string): void {
	if (!patch.structural && patch.remove === 1 && patch.rows.length === 1) {
		const existing = rows[patch.at];
		const incoming = patch.rows[0];
		if (existing !== undefined && incoming !== undefined && existing.id === incoming.id) {
			const anchor = captureCursor();
			const row = { ...existing, ...incoming };
			rows[patch.at] = row;
			indexRows();
			const line = documentModel.rowLine.get(row.id);
			if (line !== undefined && model !== undefined) {
				const built = syntheticRowLine(row);
				const nextLine: SyntheticLine = {
					line,
					rowId: row.id,
					kind: row.kind,
					text: built.text,
					fieldSpans: built.fieldSpans,
					searchSpans: built.searchSpans
				};
				documentModel.lines[line - 1] = nextLine;
				overlayLocalOnLine(nextLine);
				documentModel.text = documentModel.lines.map((candidate) => candidate.text).join('\n');
				applyingModel = true;
				model.pushEditOperations(
					[],
					[{ range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)), text: nextLine.text }],
					function () {
						return null;
					}
				);
				applyingModel = false;
			}
			if (nextHeader !== undefined) {
				header = nextHeader;
			}
			if (nextSelectedId !== undefined) {
				selectedId = nextSelectedId;
			}
			subtreeIds = subtreeRowIdsOf(selectedId);
			applyDisabledCount();
			updateInspector();
			applyDecorations();
			restoreCursor(anchor);
			invalidateNativeFind();
			return;
		}
	}
	const next = rows.slice();
	next.splice(patch.at, patch.remove, ...patch.rows);
	applyRows(next, nextHeader, nextSelectedId);
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
		const line = documentModel.rowLine.get(match.rowId);
		const lineText = line === undefined ? undefined : documentModel.lines[line - 1];
		if (line === undefined || lineText === undefined) {
			continue;
		}
		const range = searchRangeOnLine(lineText, match);
		if (range === undefined) {
			continue;
		}
		const key = `${line}:${range.startColumn}:${range.endColumn}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push({
			range: new monaco.Range(line, range.startColumn, line, range.endColumn),
			matches: [lineText.text.slice(range.startColumn - 1, range.endColumn - 1)]
		} as unknown as MonacoFindMatch);
	}
	out.sort((left, right) => monaco.Range.compareRangesUsingStarts(left.range, right.range));
	return out;
}

function nativeFindController(): NativeFindController | null {
	return (editor?.getContribution('editor.contrib.findController') as NativeFindController | null) ?? null;
}

function refreshNativeFind(query: string, options: FindOptions): void {
	if (query === '') {
		return;
	}
	const controller = nativeFindController();
	const state = controller?.getState?.();
	if (controller?.start === undefined || state === undefined || !state.isRevealed) {
		return;
	}
	// A faster keystroke may already have moved the widget past the result that
	// just arrived; never replace the newer query with a stale result set.
	if (
		state.searchString !== query ||
		state.isRegex !== options.regex ||
		state.wholeWord !== options.wholeWord ||
		state.matchCase !== options.caseSensitive
	) {
		return;
	}
	void controller.start(
		{
			forceRevealReplace: false,
			seedSearchStringFromSelection: 'none',
			seedSearchStringFromNonEmptySelection: false,
			seedSearchStringFromGlobalClipboard: false,
			shouldFocus: 0,
			shouldAnimate: false,
			updateSearchScope: false,
			loop: true
		},
		{
			searchString: query,
			isRegex: options.regex,
			matchCase: options.caseSensitive,
			wholeWord: options.wholeWord,
			replaceString: state.replaceString,
			preserveCase: state.preserveCase,
			isReplaceRevealed: state.isReplaceRevealed
		}
	);
}

function applyNativeFindResult(requestId: number, result: { matches: FindMatch[] }, error?: string): void {
	const key = nativeFindRequests.get(requestId);
	if (key === undefined) {
		return;
	}
	nativeFindRequests.delete(requestId);
	nativeFindRequested.delete(key);
	const query = nativeFindQueries.get(key);
	if (query === undefined) {
		return;
	}
	if (error !== undefined) {
		setDetailsStatus({ message: error, kind: 'warn' });
	}
	nativeFindCache.set(key, error === undefined ? mapNativeMatches(result) : []);
	refreshNativeFind(query.query, query.options);
}

function invalidateNativeFind(): void {
	nativeFindCache.clear();
	nativeFindQueries.clear();
	nativeFindRequested.clear();
	nativeFindRequests.clear();
	const state = nativeFindController()?.getState?.();
	if (state?.isRevealed === true && state.searchString !== '') {
		refreshNativeFind(state.searchString, {
			caseSensitive: state.matchCase,
			wholeWord: state.wholeWord,
			regex: state.isRegex
		});
	}
}

/** The row field under one find match, in the offsets the engine compares. */
function nativeTargetForRange(
	range: monaco.Range
): { rowId: string; field: 'label' | 'value' | 'meta'; start: number; end: number } | undefined {
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

function nativeReplaceTarget(): { rowId: string; field: 'label' | 'value' | 'meta'; start: number; end: number } | undefined {
	const state = nativeFindController()?.getState?.();
	if (state !== undefined) {
		const options: FindOptions = {
			caseSensitive: state.matchCase,
			wholeWord: state.wholeWord,
			regex: state.isRegex
		};
		const matches = nativeFindCache.get(nativeFindKey(state.searchString, options)) ?? [];
		const at = state.matchesPosition - 1;
		const match = at >= 0 && at < matches.length ? matches[at] : undefined;
		if (match !== undefined) {
			const target = nativeTargetForRange(match.range);
			if (target !== undefined) {
				return target;
			}
		}
	}
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
	const state = nativeFindController()?.getState?.();
	if (state === undefined || !state.isRevealed || state.searchString.trim() === '') {
		return false;
	}
	const options: FindOptions = {
		caseSensitive: state.matchCase,
		wholeWord: state.wholeWord,
		regex: state.isRegex
	};
	const target = all ? undefined : nativeReplaceTarget();
	if (!all && target === undefined) {
		// Container labels, values and numeric spans can carry a Rust plan. If
		// no span matches, consume the action instead of letting Monaco edit the
		// synthetic text behind the host.
		setDetailsStatus({ message: 'This match is search-only', kind: 'warn' });
		return true;
	}
	const requestId = (nativeReplaceRequestId += 1);
	postToHost({
		type: 'replace',
		requestId,
		query: state.searchString,
		options,
		replacement: state.replaceString,
		preserveCase: state.preserveCase,
		all,
		match: target
	});
	return true;
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
	const patched = target as unknown as {
		findMatches(
			searchString: string,
			searchOnlyEditableRange: monaco.Range[] | null,
			isRegex: boolean,
			matchCase: boolean,
			wordSeparators: string | null,
			captureMatches: boolean,
			limitResultCount: number
		): MonacoFindMatch[];
		findNextMatch(
			searchString: string,
			searchStart: monaco.Position,
			isRegex: boolean,
			matchCase: boolean,
			wordSeparators: string | null,
			captureMatches: boolean
		): MonacoFindMatch | null;
		findPreviousMatch(
			searchString: string,
			searchStart: monaco.Position,
			isRegex: boolean,
			matchCase: boolean,
			wordSeparators: string | null,
			captureMatches: boolean
		): MonacoFindMatch | null;
	};
	patched.findMatches = function (
		searchString,
		_searchOnlyEditableRange,
		isRegex,
		matchCase,
		wordSeparators,
		_captureMatches,
		limitResultCount
	) {
		const options = nativeFindOptions(isRegex, matchCase, wordSeparators);
		const matches = nativeMatchesFor(searchString, options);
		if (matches.length === 0) {
			requestNativeFind(searchString, options);
		}
		return Number.isFinite(limitResultCount) ? matches.slice(0, limitResultCount) : matches.slice();
	};
	patched.findNextMatch = function (
		searchString,
		searchStart,
		isRegex,
		matchCase,
		wordSeparators,
		_captureMatches
	) {
		const options = nativeFindOptions(isRegex, matchCase, wordSeparators);
		const matches = nativeMatchesFor(searchString, options);
		if (matches.length === 0) {
			requestNativeFind(searchString, options);
			return null;
		}
		return matches.find((match) => monaco.Range.compareRangesUsingStarts(match.range, new monaco.Range(searchStart.lineNumber, searchStart.column, searchStart.lineNumber, searchStart.column)) >= 0) ?? matches[0];
	};
	patched.findPreviousMatch = function (
		searchString,
		searchStart,
		isRegex,
		matchCase,
		wordSeparators,
		_captureMatches
	) {
		const options = nativeFindOptions(isRegex, matchCase, wordSeparators);
		const matches = nativeMatchesFor(searchString, options);
		if (matches.length === 0) {
			requestNativeFind(searchString, options);
			return null;
		}
		for (let at = matches.length - 1; at >= 0; at -= 1) {
			const end = matches[at].range.getEndPosition();
			if (
				end.lineNumber < searchStart.lineNumber ||
				(end.lineNumber === searchStart.lineNumber && end.column <= searchStart.column)
			) {
				return matches[at];
			}
		}
		return matches[matches.length - 1];
	};
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

function handleMultiChange(event: monaco.editor.IModelContentChangedEvent): void {
	if (model === undefined) {
		return;
	}
	const seenLines = new Set<number>();
	const edits: { span: FieldSpan; lineText: SyntheticLine; text: string; row: EcucRow }[] = [];
	for (const change of event.changes) {
		if (change.range.startLineNumber !== change.range.endLineNumber || /[\r\n]/.test(change.text)) {
			rebuildModel();
			return;
		}
		const line = change.range.startLineNumber;
		if (seenLines.has(line)) {
			// Two edits on one line cannot be mapped to independent fields safely.
			rebuildModel();
			return;
		}
		seenLines.add(line);
		const spans = documentModel.lines[line - 1]?.fieldSpans ?? [];
		const span = spans.find(
			(candidate) =>
				change.range.startColumn >= candidate.startColumn &&
				change.range.endColumn <= candidate.endColumn
		);
		const lineText = documentModel.lines[line - 1];
		if (span === undefined || lineText === undefined) {
			rebuildModel();
			return;
		}
		const current = model.getLineContent(line);
		const suffix = lineText.text.slice(span.endColumn - 1);
		const text = current.slice(span.startColumn - 1, current.length - suffix.length);
		const row = rowById.get(span.nodeId);
		if (text === '' || /[\r\n]/.test(text) || row === undefined) {
			rebuildModel();
			return;
		}
		edits.push({ span, lineText, text, row });
	}
	if (edits.length === 0) {
		return;
	}
	for (const edit of edits) {
		applyLocalField(
			edit.span.nodeId,
			edit.span.field,
			edit.span.field === 'value' ? rawFieldText(edit.row, edit.text) : edit.text,
			edit.text
		);
	}
}

function handleEdit(event: monaco.editor.IModelContentChangedEvent): void {
	if (applyingModel || model === undefined) {
		return;
	}
	if (event.changes.length > 1) {
		handleMultiChange(event);
		return;
	}
	const change = event.changes[0];
	if (change.range.startLineNumber !== change.range.endLineNumber || /[\r\n]/.test(change.text)) {
		rebuildModel();
		return;
	}
	const line = change.range.startLineNumber;
	const restored = (): void => {
		const text = documentModel.lines[line - 1]?.text;
		if (text === undefined || model === undefined) {
			return;
		}
		const anchor = captureCursor();
		applyingModel = true;
		model.pushEditOperations(
			[],
			[{ range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)), text }],
			function () {
				return null;
			}
		);
		applyingModel = false;
		restoreCursor(anchor);
	};
	const spans = documentModel.lines[line - 1]?.fieldSpans ?? [];
	const span = spans.find(
		(candidate) =>
			change.range.startColumn >= candidate.startColumn &&
			change.range.endColumn <= candidate.endColumn
	);
	if (span === undefined || model === undefined) {
		restored();
		return;
	}
	const lineText = documentModel.lines[line - 1];
	if (lineText === undefined) {
		return;
	}
	const current = model.getLineContent(line);
	const suffix = lineText.text.slice(span.endColumn - 1);
	const text = current.slice(span.startColumn - 1, current.length - suffix.length);
	if (text === '' || /[\r\n]/.test(text)) {
		restored();
		return;
	}
	const row = rowById.get(span.nodeId);
	if (row === undefined) {
		restored();
		return;
	}
	// Keep the local map in sync while the host round-trip is in flight.
	applyLocalField(span.nodeId, span.field, span.field === 'value' ? rawFieldText(row, text) : text, text);
}

function revertToAccepted(): void {
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

function installShortcuts(): void {
	if (editor === undefined) {
		return;
	}
	editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, function () {
		if (localDraftExists()) {
			editor?.trigger('api', 'undo', null);
			return;
		}
		postToHost({ type: 'undo' });
	});
	editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ, function () {
		if (localDraftExists()) {
			editor?.trigger('api', 'redo', null);
			return;
		}
		postToHost({ type: 'redo' });
	});
	editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, function () {
		if (localDraftExists()) {
			editor?.trigger('api', 'redo', null);
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
			postToHost({ type: 'undo' });
		}
	});
	editor.addAction({
		id: 'redo',
		label: 'Redo',
		run: function () {
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

function handleMessage(message: EditorProviderToWebview): void {
	if (!message || typeof message.type !== 'string') {
		return;
	}
	handleDetailsEditorMessage(message);
	if (message.type === 'document') {
		const revision = typeof message.document.revision === 'number' ? message.document.revision : undefined;
		if (revision !== undefined && revision < hostRevision) {
			return;
		}
		if (revision !== undefined) {
			hostRevision = revision;
			hostAcks = true;
		}
		if (typeof message.document.dirty === 'boolean') {
			hostDirty = message.document.dirty;
		}
		applySettings(message.document.settings);
		applyRows(message.document.rows, message.document.header, message.document.selectedId);
		updateErrorState();
		return;
	}
	if (message.type === 'documentPatch') {
		const revision = typeof message.revision === 'number' ? message.revision : undefined;
		if (revision !== undefined && revision < hostRevision) {
			return;
		}
		if (revision !== undefined) {
			hostRevision = revision;
			hostAcks = true;
		}
		if (typeof message.dirty === 'boolean') {
			hostDirty = message.dirty;
		}
		applyPatch(message.patch, message.header, message.selectedId);
		updateErrorState();
		return;
	}
	if (message.type === 'editResult') {
		handleEditResult(message);
		return;
	}
	if (message.type === 'dirty') {
		if (typeof message.revision !== 'number' || typeof message.dirty !== 'boolean') {
			return;
		}
		hostAcks = true;
		hostRevision = Math.max(hostRevision, message.revision);
		hostDirty = message.dirty;
		updateDirtyStatus();
		return;
	}
	if (message.type === 'flushEdits') {
		if (typeof message.requestId !== 'number') {
			return;
		}
		flushRequests.add(message.requestId);
		flushEdits();
		maybeAcknowledgeFlush();
		return;
	}
	if (message.type === 'settings') {
		applySettings(message.settings);
		return;
	}
	if (message.type === 'theme') {
		defineEcucTheme();
		monaco.editor.setTheme('arxml-ecuc-theme');
		return;
	}
	if (message.type === 'conditions') {
		renderConditionEntries(message.entries);
		return;
	}
	if (message.type === 'select') {
		if (rowById.has(message.nodeId)) {
			setSelection(message.nodeId, true);
		}
		return;
	}
	if (message.type === 'findResult') {
		applyNativeFindResult(message.requestId, message.result, message.error);
		return;
	}
	if (message.type === 'replaceResult') {
		if (!message.result.ok) {
			if (message.result.reason !== undefined) {
				setDetailsStatus({ message: message.result.reason, kind: 'warn' });
			}
			return;
		}
		// The host applied the Rust plan. Re-run the open query against the new
		// document instead of the synthetic text Monaco replaced locally.
		invalidateNativeFind();
		return;
	}
	if (message.type === 'notice') {
		if (message.scope === 'conditions') {
			setConditionsStatus(message.message || '');
			return;
		}
		// A revisioned host answers every field edit with an `editResult`, which
		// restores exactly the refused field and keeps newer edits. The blanket
		// restore here is only for a host that predates that acknowledgement.
		if (hasPendingEdits() && !hostAcks && message.kind === 'warn') {
			revertToAccepted();
		}
		if (!refusalShownInDetails(message, getSidebarState().tab !== 'details')) {
			setDetailsStatus(message);
		}
		return;
	}
	if (message.type === 'error') {
		setDetailsStatus({ message: message.message, kind: 'warn' });
	}
}

function applySettings(settings: MonacoSettings | undefined): void {
	if (editor === undefined || settings === undefined) {
		return;
	}
	editor.updateOptions({
		...(settings.fontFamily !== undefined ? { fontFamily: settings.fontFamily } : {}),
		...(settings.fontSize !== undefined ? { fontSize: settings.fontSize } : {}),
		...(settings.lineHeight !== undefined && settings.lineHeight > 0 ? { lineHeight: settings.lineHeight } : {}),
		...(settings.fontWeight !== undefined ? { fontWeight: settings.fontWeight } : {}),
		...(settings.wordWrap !== undefined ? { wordWrap: settings.wordWrap } : {}),
		...(settings.wordWrapColumn !== undefined ? { wordWrapColumn: settings.wordWrapColumn } : {}),
		...(settings.minimap !== undefined ? { minimap: { enabled: settings.minimap } } : {}),
		...(settings.stickyScroll !== undefined
			? { stickyScroll: { enabled: settings.stickyScroll, defaultModel: 'foldingProviderModel' } }
			: {}),
		...(settings.indentationGuides !== undefined || settings.bracketPairGuides !== undefined
			? {
				guides: {
					indentation: settings.indentationGuides ?? true,
					bracketPairs: settings.bracketPairGuides ?? false
				}
			}
			: {}),
		...(settings.cursorStyle !== undefined ? { cursorStyle: settings.cursorStyle } : {}),
		...(settings.cursorBlinking !== undefined ? { cursorBlinking: settings.cursorBlinking } : {}),
		...(settings.smoothScrolling !== undefined ? { smoothScrolling: settings.smoothScrolling } : {}),
		...(settings.renderWhitespace !== undefined ? { renderWhitespace: settings.renderWhitespace } : {})
	});
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
		getRow: function (id) {
			return rowById.get(id);
		},
		getSelectedId: function () {
			return selectedId;
		},
		isDetailsTab: function () {
			return getSidebarState().tab === 'details';
		},
		showSidebar: function () {
			applySidebarVisibility(false);
		},
		showTab: showSidebarTab,
		showSection: showSidebarSection,
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
			applyLocalField(message.nodeId, (message.field ?? 'value') as 'value' | 'shortName' | 'definitionRef', message.value);
		},
		commitEdit: function (message) {
			postToHost(message);
		},
		focusAdjacentParameter
	});
}

export async function mountEditor(): Promise<void> {
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
	installNativeReplaceBridge();
	if ((window as unknown as { __PREVIEW__?: unknown }).__PREVIEW__ !== undefined) {
		(window as unknown as { __ARXML_EDITOR__?: unknown }).__ARXML_EDITOR__ = editor;
	}
	editor.onDidChangeModelContent(handleEdit);
	editor.onDidBlurEditorText(function () {
		flushEdits();
	});
	window.addEventListener('pagehide', flushEdits);
	window.addEventListener('beforeunload', function (event) {
		if (localDraftExists()) {
			event.preventDefault();
			event.returnValue = '';
		}
	});
	editor.onDidChangeCursorPosition(function (event) {
		const id = rowIdAtLine(event.position.lineNumber);
		if (id !== undefined && id !== selectedId) {
			setSelection(id);
			postToHost({ type: 'select', nodeId: id });
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
	document.addEventListener(
		'keydown',
		function (event) {
			const command = event.ctrlKey || event.metaKey;
			if (command && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') {
				event.preventDefault();
				event.stopPropagation();
				requestSave();
			}
		},
		true
	);
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

function handleThemeChanges(): void {
	const observer = new MutationObserver(function () {
		defineEcucTheme();
		monaco.editor.setTheme('arxml-ecuc-theme');
	});
	observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

export { handleMessage };

if (typeof document !== 'undefined' && document.getElementById('tree')) {
	void mountEditor();
}
