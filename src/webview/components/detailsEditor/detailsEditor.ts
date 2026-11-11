/**
 * Details field editor: the value/name/definition controls of the Details panel.
 *
 * The component owns the single draft per field, its inline refusal text and the
 * Enter/Escape/Tab behaviour. The composition root owns row data, selection and
 * the actual write: every commit is reported through `host.commitEdit`.
 */
import './detailsEditor.css';
import { inspectorElement } from '../../render/dom';
import type { EditorProviderToWebview } from '../../../webviewProtocol';

/**
 * True when `data` contains only characters the details control may accept for
 * this type. This blocks obviously wrong characters at insertion time without
 * rewriting text the user already typed; full grammar validation still happens
 * on commit in the host.
 */
export function detailsInputAllowed(type: string, data: string): boolean {
	if (!data) {
		return true;
	}
	if (type === 'Integer') {
		return !/[^0-9a-fA-FxXbB+-]/.test(data);
	}
	if (type === 'Float') {
		return !/[^0-9eE+\-.]/.test(data);
	}
	return true;
}

export interface DetailsEditorHost {
	getRow(id: string): any;
	getSelectedId(): string | undefined;
	isDetailsTab(): boolean;
	showTab(name: string): void;
	showSection(id: string): void;
	renderedItem(id: string): any;
	selectItem(item: any): void;
	setSelection(id: string): void;
	postSelect(id: string): void;
	focusRow(id: string): boolean;
	updateInspector(): void;
	commitEdit(message: { type: 'edit'; nodeId: string; value: string; field?: string }): void;
	focusAdjacentParameter(fromId: string, direction: string): string | undefined;
}

interface DetailsEdit {
	rowId: string;
	field: string;
	input: any;
	error: any;
	pending: boolean;
	type?: string;
	original: string;
}

interface PendingMove {
	dir: 'prev' | 'next';
	from: string;
}

interface PendingFieldFocus {
	rowId: string;
	field: string;
	dir: 'prev' | 'next';
}

/** The fields the container edit target reads. */
interface DetailsRowFields {
	id: string;
	kind?: string;
	shortName?: string;
	definitionRef?: string;
}

/** The key event the inline controls forward. */
interface DetailsKeyEvent {
	key?: string;
	shiftKey?: boolean;
	preventDefault(): void;
	stopPropagation(): void;
}

type DetailsNotice = Extract<EditorProviderToWebview, { type: 'notice' }>;

let detailsEdits: Record<string, DetailsEdit> = {};
let pendingMove: PendingMove | null = null;
let pendingFieldFocus: PendingFieldFocus | null = null;
let flashId: string | null = null;
let detailsEditorHost: DetailsEditorHost = {
	getRow: function () { return undefined; },
	getSelectedId: function () { return undefined; },
	isDetailsTab: function () { return true; },
	showTab: function () {},
	showSection: function () {},
	renderedItem: function () { return undefined; },
	selectItem: function () {},
	setSelection: function () {},
	postSelect: function () {},
	focusRow: function () { return false; },
	updateInspector: function () {},
	commitEdit: function () {},
	focusAdjacentParameter: function () { return undefined; }
};

export function setDetailsEditorHost(host: DetailsEditorHost): void {
	detailsEditorHost = host || detailsEditorHost;
}

function clearDetailsError(edit: DetailsEdit | null): void {
	if (!edit) {
		return;
	}
	edit.input.removeAttribute('aria-invalid');
	if (edit.error) {
		edit.error.textContent = '';
	}
}

function setDetailsError(edit: DetailsEdit | null, reason: string): void {
	if (!edit) {
		return;
	}
	edit.input.setAttribute('aria-invalid', 'true');
	if (!edit.error) {
		edit.error = document.createElement('span');
		edit.error.className = 'details-value-error';
		edit.error.setAttribute('role', 'status');
		edit.error.setAttribute('aria-live', 'polite');
		edit.input.after(edit.error);
	}
	edit.error.textContent = '/* ' + reason + ' */';
}

function detailsSelectionChanged(rowId: string | undefined): void {
	for (const field of Object.keys(detailsEdits)) {
		if (detailsEdits[field].rowId !== rowId) {
			detailsEdits = {};
			return;
		}
	}
}

function detailsFieldId(field: string): string {
	if (field === 'shortName') {
		return 'details-short-name';
	}
	if (field === 'definitionRef') {
		return 'details-definition-ref';
	}
	return 'details-value';
}

function detailsStoredEdit(row: any, field: string): DetailsEdit | null {
	const previous = detailsEdits[field];
	return previous && previous.rowId === row.id ? previous : null;
}

function detailsErrorSpan(): any {
	const error = document.createElement('span');
	error.className = 'details-value-error';
	error.setAttribute('role', 'status');
	error.setAttribute('aria-live', 'polite');
	return error;
}

/** The two container fields in Tab order. */
const detailsFieldOrder = ['shortName', 'definitionRef'];

/** The container field a Tab moves to, or undefined at either end of the pair. */
function detailsFieldSibling(field: string, dir: string): string | undefined {
	const at = detailsFieldOrder.indexOf(field);
	if (at < 0) {
		return undefined;
	}
	return dir === 'prev' ? detailsFieldOrder[at - 1] : detailsFieldOrder[at + 1];
}

function detailsRegisterKeydown(input: any, edit: DetailsEdit): void {
	input.addEventListener('keydown', function (event: any) {
		detailsKeydown(edit, event);
	});
	input.addEventListener('input', function () {
		clearDetailsError(edit);
	});
	input.addEventListener('change', function () {
		clearDetailsError(edit);
	});
}

function detailsKeydown(edit: DetailsEdit, event: DetailsKeyEvent): void {
	if (event.key === 'Enter') {
		detailsCommitKey(edit, event);
	} else if (event.key === 'Escape') {
		detailsCancelKey(edit, event);
	} else if (event.key === 'Tab') {
		detailsTabKey(edit, event);
	}
}

function detailsCommitKey(edit: DetailsEdit, event: DetailsKeyEvent): void {
	event.preventDefault();
	event.stopPropagation();
	commitDetailsEdit(edit.field);
}

function detailsCancelKey(edit: DetailsEdit, event: DetailsKeyEvent): void {
	event.preventDefault();
	event.stopPropagation();
	cancelDetailsEdit(edit.field);
}

function detailsTabKey(edit: DetailsEdit, event: DetailsKeyEvent): void {
	const current = detailsEdits[edit.field];
	if (!isPendingDetailsEdit(current)) {
		return;
	}
	const dir = event.shiftKey ? 'prev' : 'next';
	const sibling = detailsTabSibling(edit.field, dir);
	if (detailsTabLeavesPanel(edit, sibling)) {
		// There is no other container field to move to. Commit, but let Tab move
		// focus out of the panel instead of trapping it in a control the re-scan
		// is about to replace.
		commitDetailsEdit(edit.field);
		return;
	}
	event.preventDefault();
	event.stopPropagation();
	detailsQueueTabMove(edit, dir);
	commitDetailsEdit(edit.field);
}

function isPendingDetailsEdit(edit: DetailsEdit | undefined): edit is DetailsEdit {
	return !!edit && !edit.pending;
}

function detailsTabSibling(field: string, dir: 'prev' | 'next'): string | undefined {
	return field === 'value' ? undefined : detailsFieldSibling(field, dir);
}

function detailsTabLeavesPanel(edit: DetailsEdit, sibling: string | undefined): boolean {
	if (edit.field === 'value') {
		return false;
	}
	return !sibling || !document.getElementById(detailsFieldId(sibling));
}

function detailsQueueTabMove(edit: DetailsEdit, dir: 'prev' | 'next'): void {
	if (edit.field === 'value') {
		pendingMove = { dir: dir, from: edit.rowId };
	} else {
		pendingFieldFocus = { rowId: edit.rowId, field: edit.field, dir: dir };
	}
}

/** A page reload starts from a clean draft state. */
export function resetDetailsEditorState(): void {
	detailsEdits = {};
	pendingMove = null;
	pendingFieldFocus = null;
	flashId = null;
}

/**
 * Stores one field's draft, restores a draft that survived a re-scan, and wires
 * the shared key handling.
 */
function detailsDraft(
	row: { id: string },
	field: string,
	input: HTMLInputElement | HTMLSelectElement,
	error: HTMLSpanElement,
	original: string,
	type?: string
): DetailsEdit {
	const previous = detailsStoredEdit(row, field);
	if (previous) {
		input.value = previous.input.value;
	}
	const restored = restoredDetailsDraft(previous, original);
	const edit: DetailsEdit = {
		rowId: row.id,
		field: field,
		input: input,
		error: error,
		pending: restored.pending,
		...(type === undefined ? {} : { type }),
		original: restored.original
	};
	detailsEdits[field] = edit;
	restoreDetailsError(edit, previous);
	detailsRegisterKeydown(input, edit);
	return edit;
}

/** The draft fields a re-scan keeps from the previous control. */
function restoredDetailsDraft(
	previous: DetailsEdit | null,
	original: string
): { pending: boolean; original: string } {
	if (previous === null) {
		return { pending: false, original };
	}
	return { pending: previous.pending, original: previous.original };
}

/** Carries a refusal that survived the re-scan onto the new control. */
function restoreDetailsError(edit: DetailsEdit, previous: DetailsEdit | null): void {
	if (previous === null || !previous.error || !previous.error.textContent) {
		return;
	}
	edit.error.textContent = previous.error.textContent;
	edit.input.setAttribute('aria-invalid', 'true');
}

/** The details value control for one parameter row (input or Boolean select). */
export function detailsValueInput(row: any, data: any): any {
	const rowElement = document.createElement('div');
	rowElement.className = 'inspector-row';
	rowElement.appendChild(inspectorElement('span', 'inspector-key', 'Value'));
	const type = detailsValueType(row, data);
	const boolean = isBooleanValueInput(type, row.value);
	const input: any = document.createElement(boolean ? 'select' : 'input');
	detailsValueAttributes(input, row, data, type);
	const original = detailsValueOriginal(row.value, boolean);
	if (boolean) {
		appendBooleanOptions(input);
	} else {
		applyValueInputMode(input, type);
	}
	input.value = original;
	const error = detailsErrorSpan();
	rowElement.appendChild(input);
	rowElement.appendChild(error);
	detailsDraft(row, 'value', input, error, original, type);
	input.addEventListener('beforeinput', function (event: any) {
		if (event.data && !detailsInputAllowed(type, event.data)) {
			event.preventDefault();
		}
	});
	return rowElement;
}

function isBooleanValueInput(type: string, value: string | undefined): boolean {
	return type === 'Boolean' && /^(true|false)$/i.test(String(value ?? ''));
}

function detailsValueType(row: { parameterType?: string }, data: { type?: string }): string {
	return row.parameterType || data.type || '';
}

function detailsValueAttributes(
	input: HTMLInputElement | HTMLSelectElement,
	row: { id: string; valueKind?: string; label?: string },
	data: { label?: string },
	type: string
): void {
	input.id = 'details-value';
	input.className = 'details-value';
	input.setAttribute('data-node-id', row.id);
	input.setAttribute('data-field', 'value');
	input.setAttribute('data-value-type', detailsValueTypeName(type, row));
	input.setAttribute('aria-label', 'Value of ' + detailsValueLabel(row, data));
}

function detailsValueTypeName(type: string, row: { valueKind?: string }): string {
	return type || row.valueKind || '';
}

function detailsValueLabel(row: { label?: string }, data: { label?: string }): string {
	return row.label || data.label || 'parameter';
}

function detailsValueOriginal(value: string | undefined, boolean: boolean): string {
	const text = value ?? '';
	return boolean ? booleanText(String(text)) : text;
}

function booleanText(text: string): string {
	return text.toLowerCase() === 'false' ? 'false' : 'true';
}

function appendBooleanOptions(input: HTMLSelectElement): void {
	for (const option of ['true', 'false']) {
		const element = document.createElement('option');
		element.value = option;
		element.textContent = option;
		input.appendChild(element);
	}
}

function applyValueInputMode(input: HTMLInputElement, type: string): void {
	input.type = 'text';
	input.spellcheck = false;
	input.inputMode = type === 'Integer' ? 'numeric' : type === 'Float' ? 'decimal' : 'text';
}

function detailsFieldInput(row: any, field: string, label: string, value: string): any {
	const rowElement = document.createElement('div');
	rowElement.className = 'inspector-row';
	rowElement.appendChild(inspectorElement('span', 'inspector-key', label));
	const input: any = document.createElement('input');
	input.id = detailsFieldId(field);
	input.className = 'details-value';
	input.type = 'text';
	input.spellcheck = false;
	input.setAttribute('data-node-id', row.id);
	input.setAttribute('data-field', field);
	input.setAttribute('aria-label', label + ' of ' + (row.label || 'container'));
	input.value = value;
	const error = detailsErrorSpan();
	rowElement.appendChild(input);
	rowElement.appendChild(error);
	detailsDraft(row, field, input, error, value);
	return rowElement;
}

export function detailsContainerFields(row: any, data: any): any {
	const fields = document.createElement('div');
	fields.className = 'inspector-fields';
	// An absent element has no text range to write; showing an editor for it would offer
	// an edit the host must refuse (adding an element is out of scope).
	if (data.shortName) {
		fields.appendChild(detailsFieldInput(row, 'shortName', 'Short name', data.shortName));
	}
	if (data.definitionRef) {
		fields.appendChild(detailsFieldInput(row, 'definitionRef', 'Definition', data.definitionRef));
	}
	return fields;
}

function focusDetailsInput(): boolean {
	const input: any = document.getElementById('details-value');
	if (!input) {
		return false;
	}
	input.focus();
	if (typeof input.select === 'function') {
		input.select();
	}
	return true;
}

function focusDetailsField(field: string): boolean {
	const input: any = document.getElementById(detailsFieldId(field));
	if (!input) {
		return false;
	}
	input.focus();
	if (typeof input.select === 'function') {
		input.select();
	}
	return true;
}

function detailsFirstField(row: any): string | undefined {
	if (row.kind === 'container') {
		return detailsFirstContainerField(row);
	}
	return row.kind === 'parameter' ? 'value' : undefined;
}

function detailsFirstContainerField(row: DetailsRowFields): string | undefined {
	if (row.shortName) {
		return 'shortName';
	}
	return row.definitionRef ? 'definitionRef' : undefined;
}

/** Open the first field of a row (or one named field) in the Details panel. */
export function beginDetailsEdit(rowId: string, field?: string): boolean {
	const row = detailsEditorHost.getRow(rowId);
	if (!row) {
		return false;
	}
	const target = detailsEditTarget(row, field);
	if (!target) {
		return false;
	}
	detailsRevealEditor();
	detailsSelectRow(rowId);
	return focusDetailsField(target);
}

function detailsEditTarget(row: DetailsRowFields, field?: string): string | undefined {
	return field || detailsFirstField(row);
}

function detailsRevealEditor(): void {
	if (!detailsEditorHost.isDetailsTab()) {
		// An edit always happens in the Details panel; the Conditions tab must not
		// silently swallow it.
		detailsEditorHost.showTab('details');
	}
	// The Details section may be collapsed; reveal it before focus.
	detailsEditorHost.showSection('sb-details');
}

function detailsSelectRow(rowId: string): void {
	if (detailsEditorHost.getSelectedId() === rowId) {
		detailsEditorHost.updateInspector();
		return;
	}
	detailsSelectUnselectedRow(rowId);
}

function detailsSelectUnselectedRow(rowId: string): void {
	const item = detailsEditorHost.renderedItem(rowId);
	if (item) {
		detailsEditorHost.selectItem(item);
		return;
	}
	detailsEditorHost.setSelection(rowId);
	detailsEditorHost.postSelect(rowId);
	detailsEditorHost.focusRow(rowId);
}

function cancelDetailsEdit(field: string): void {
	const edit = detailsEdits[field];
	if (!edit || edit.pending) {
		return;
	}
	edit.input.value = edit.original;
	clearDetailsError(edit);
	edit.input.focus();
}

function commitDetailsEdit(field: string): void {
	const edit = detailsEdits[field];
	if (!edit || edit.pending) {
		return;
	}
	edit.pending = true;
	clearDetailsError(edit);
	flashId = edit.rowId;
	if (edit.field === 'value') {
		detailsEditorHost.commitEdit({ type: 'edit', nodeId: edit.rowId, value: edit.input.value });
	} else {
		detailsEditorHost.commitEdit({ type: 'edit', nodeId: edit.rowId, field: edit.field, value: edit.input.value });
	}
}

function flashRow(nodeId: string | undefined): void {
	const item = nodeId === undefined ? undefined : detailsEditorHost.renderedItem(nodeId);
	if (!item) {
		return;
	}
	item.classList.add('flash');
	setTimeout(() => item.classList.remove('flash'), 1000);
}

function beginAdjacentDetailsEdit(move: PendingMove): void {
	const id = detailsEditorHost.focusAdjacentParameter(move.from, move.dir);
	if (id) {
		beginDetailsEdit(id);
	}
}

function beginFieldDetailsEdit(focus: PendingFieldFocus): void {
	const next = detailsFieldSibling(focus.field, focus.dir);
	if (!next) {
		return;
	}
	const row = detailsFocusRow(focus.rowId);
	if (!detailsContainerHasField(row, next)) {
		return;
	}
	beginDetailsEdit(row.id, next);
}

function detailsFocusRow(fromId: string): DetailsRowFields | undefined {
	// A committed rename renumbers the row, so the row the field was left from may be
	// gone; the host keeps the renamed container selected under its new id.
	const selectedId = detailsEditorHost.getSelectedId();
	const rowId = detailsEditorHost.getRow(fromId) ? fromId : selectedId;
	return rowId === undefined ? undefined : detailsEditorHost.getRow(rowId);
}

function detailsContainerHasField(row: DetailsRowFields | undefined, field: string): row is DetailsRowFields {
	if (!row || row.kind !== 'container') {
		return false;
	}
	return field === 'shortName' ? !!row.shortName : !!row.definitionRef;
}

/**
 * The page's protocol handler for the Details editor. A re-scan clears every
 * draft (the row may have moved or been removed); a pending move/focus runs
 * after the new row store has painted.
 */
export function handleDetailsEditorMessage(message: EditorProviderToWebview): void {
	if (!message) {
		return;
	}
	if (message.type === 'document') {
		applyDetailsDocumentMessage();
	} else if (message.type === 'notice') {
		applyDetailsNotice(message);
	}
}

interface PendingDetailsRun {
	flash: string | null;
	move: PendingMove | null;
	focus: PendingFieldFocus | null;
}

function takePendingDetailsRun(): PendingDetailsRun {
	const flash = flashId;
	const move = pendingMove;
	const focus = pendingFieldFocus;
	flashId = null;
	pendingMove = null;
	pendingFieldFocus = null;
	detailsEdits = {};
	return { flash: flash, move: move, focus: focus };
}

function applyDetailsDocumentMessage(): void {
	const pending = takePendingDetailsRun();
	const flash = pending.flash;
	if (flash) {
		// A renamed container has a new id, so the row to flash follows the selection.
		setTimeout(() => flashRow(detailsEditorHost.getRow(flash) ? flash : detailsEditorHost.getSelectedId()), 0);
	}
	const move = pending.move;
	if (move) {
		setTimeout(() => beginAdjacentDetailsEdit(move), 0);
	}
	const focus = pending.focus;
	if (focus) {
		setTimeout(() => beginFieldDetailsEdit(focus), 0);
	}
}

function applyDetailsNotice(message: DetailsNotice): void {
	if (message.kind !== 'warn') {
		return;
	}
	const edit = pendingDetailsEdit();
	if (!edit) {
		return;
	}
	rejectDetailsEdit(edit, message.message);
}

function pendingDetailsEdit(): DetailsEdit | undefined {
	for (const field of Object.keys(detailsEdits)) {
		const edit = detailsEdits[field];
		if (edit && edit.pending) {
			return edit;
		}
	}
	return undefined;
}

function rejectDetailsEdit(edit: DetailsEdit, messageText: string): void {
	edit.pending = false;
	pendingMove = null;
	pendingFieldFocus = null;
	flashId = null;
	const reason = typeof messageText === 'string' && messageText !== '' ? messageText : 'The value was refused.';
	setDetailsError(edit, reason);
	edit.input.focus();
}

/** Clear the stored draft when the selection moves to another row. */
export { detailsSelectionChanged };
