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

/** The container field a Tab moves to, or undefined at either end of the pair. */
function detailsFieldSibling(field: string, dir: string): string | undefined {
	if (field === 'shortName') {
		return dir === 'prev' ? undefined : 'definitionRef';
	}
	if (field === 'definitionRef') {
		return dir === 'prev' ? 'shortName' : undefined;
	}
	return undefined;
}

function detailsRegisterKeydown(input: any, edit: DetailsEdit): void {
	input.addEventListener('keydown', function (event: any) {
		if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			commitDetailsEdit(edit.field);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			cancelDetailsEdit(edit.field);
		} else if (event.key === 'Tab') {
			const current = detailsEdits[edit.field];
			if (!current || current.pending) {
				return;
			}
			const dir = event.shiftKey ? 'prev' : 'next';
			const sibling = edit.field === 'value' ? undefined : detailsFieldSibling(edit.field, dir);
			if (edit.field !== 'value' && (!sibling || !document.getElementById(detailsFieldId(sibling)))) {
				// There is no other container field to move to. Commit, but let Tab move
				// focus out of the panel instead of trapping it in a control the re-scan
				// is about to replace.
				commitDetailsEdit(edit.field);
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			if (edit.field === 'value') {
				pendingMove = { dir: dir as 'prev' | 'next', from: edit.rowId };
			} else {
				pendingFieldFocus = { rowId: edit.rowId, field: edit.field, dir: dir as 'prev' | 'next' };
			}
			commitDetailsEdit(edit.field);
		}
	});
	input.addEventListener('input', function () {
		clearDetailsError(edit);
	});
	input.addEventListener('change', function () {
		clearDetailsError(edit);
	});
}

/** A page reload starts from a clean draft state. */
export function resetDetailsEditorState(): void {
	detailsEdits = {};
	pendingMove = null;
	pendingFieldFocus = null;
	flashId = null;
}

/** The details value control for one parameter row (input or Boolean select). */
export function detailsValueInput(row: any, data: any): any {
	const rowElement = document.createElement('div');
	rowElement.className = 'inspector-row';
	rowElement.appendChild(inspectorElement('span', 'inspector-key', 'Value'));
	const type = row.parameterType || data.type || '';
	const boolean = type === 'Boolean' && /^(true|false)$/i.test(String(row.value ?? ''));
	const input: any = document.createElement(boolean ? 'select' : 'input');
	input.id = 'details-value';
	input.className = 'details-value';
	input.setAttribute('data-node-id', row.id);
	input.setAttribute('data-field', 'value');
	input.setAttribute('data-value-type', type || row.valueKind || '');
	input.setAttribute('aria-label', 'Value of ' + (row.label || data.label || 'parameter'));
	const original = boolean ? (String(row.value ?? '').toLowerCase() === 'false' ? 'false' : 'true') : row.value ?? '';
	if (boolean) {
		for (const option of ['true', 'false']) {
			const element = document.createElement('option');
			element.value = option;
			element.textContent = option;
			input.appendChild(element);
		}
	} else {
		input.type = 'text';
		input.spellcheck = false;
		input.inputMode = type === 'Integer' ? 'numeric' : type === 'Float' ? 'decimal' : 'text';
	}
	input.value = original;
	const previous = detailsStoredEdit(row, 'value');
	if (previous) {
		input.value = previous.input.value;
	}
	const error = detailsErrorSpan();
	rowElement.appendChild(input);
	rowElement.appendChild(error);
	const edit: DetailsEdit = {
		rowId: row.id,
		field: 'value',
		input: input,
		error: error,
		pending: previous ? previous.pending : false,
		type: type,
		original: previous ? previous.original : original
	};
	detailsEdits.value = edit;
	if (previous && previous.error && previous.error.textContent) {
		edit.error.textContent = previous.error.textContent;
		edit.input.setAttribute('aria-invalid', 'true');
	}
	detailsRegisterKeydown(input, edit);
	input.addEventListener('beforeinput', function (event: any) {
		if (event.data && !detailsInputAllowed(type, event.data)) {
			event.preventDefault();
		}
	});
	return rowElement;
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
	const previous = detailsStoredEdit(row, field);
	if (previous) {
		input.value = previous.input.value;
	}
	const error = detailsErrorSpan();
	rowElement.appendChild(input);
	rowElement.appendChild(error);
	const edit: DetailsEdit = {
		rowId: row.id,
		field: field,
		input: input,
		error: error,
		pending: previous ? previous.pending : false,
		original: previous ? previous.original : value
	};
	detailsEdits[field] = edit;
	if (previous && previous.error && previous.error.textContent) {
		edit.error.textContent = previous.error.textContent;
		edit.input.setAttribute('aria-invalid', 'true');
	}
	detailsRegisterKeydown(input, edit);
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
		if (row.shortName) {
			return 'shortName';
		}
		return row.definitionRef ? 'definitionRef' : undefined;
	}
	if (row.kind === 'parameter') {
		return 'value';
	}
	return undefined;
}

/** Open the first field of a row (or one named field) in the Details panel. */
export function beginDetailsEdit(rowId: string, field?: string): boolean {
	const row = detailsEditorHost.getRow(rowId);
	if (!row) {
		return false;
	}
	const target = field || detailsFirstField(row);
	if (!target) {
		return false;
	}
	if (!detailsEditorHost.isDetailsTab()) {
		// An edit always happens in the Details panel; the Conditions tab must not
		// silently swallow it.
		detailsEditorHost.showTab('details');
	}
	// The Details section may be collapsed; reveal it before focus.
	detailsEditorHost.showSection('sb-details');
	if (detailsEditorHost.getSelectedId() !== rowId) {
		const item = detailsEditorHost.renderedItem(rowId);
		if (item) {
			detailsEditorHost.selectItem(item);
		} else {
			detailsEditorHost.setSelection(rowId);
			detailsEditorHost.postSelect(rowId);
			detailsEditorHost.focusRow(rowId);
		}
	} else {
		detailsEditorHost.updateInspector();
	}
	return focusDetailsField(target);
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
	// A committed rename renumbers the row, so the row the field was left from may be
	// gone; the host keeps the renamed container selected under its new id.
	const selectedId = detailsEditorHost.getSelectedId();
	const rowId = detailsEditorHost.getRow(focus.rowId) ? focus.rowId : selectedId;
	const row = rowId === undefined ? undefined : detailsEditorHost.getRow(rowId);
	if (!row || row.kind !== 'container') {
		return;
	}
	if (next === 'shortName' ? !row.shortName : !row.definitionRef) {
		return;
	}
	beginDetailsEdit(row.id, next);
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
		const flash = flashId;
		const move = pendingMove;
		const focus = pendingFieldFocus;
		flashId = null;
		pendingMove = null;
		pendingFieldFocus = null;
		detailsEdits = {};
		if (flash) {
			// A renamed container has a new id, so the row to flash follows the selection.
			setTimeout(() => flashRow(detailsEditorHost.getRow(flash) ? flash : detailsEditorHost.getSelectedId()), 0);
		}
		if (move) {
			setTimeout(() => beginAdjacentDetailsEdit(move), 0);
		}
		if (focus) {
			setTimeout(() => beginFieldDetailsEdit(focus), 0);
		}
	} else if (message.type === 'notice') {
		if (message.kind !== 'warn') {
			return;
		}
		for (const field of Object.keys(detailsEdits)) {
			const edit = detailsEdits[field];
			if (!edit || !edit.pending) {
				continue;
			}
			edit.pending = false;
			pendingMove = null;
			pendingFieldFocus = null;
			flashId = null;
			const reason = typeof message.message === 'string' && message.message !== '' ? message.message : 'The value was refused.';
			setDetailsError(edit, reason);
			edit.input.focus();
			return;
		}
	}
}

/** Clear the stored draft when the selection moves to another row. */
export { detailsSelectionChanged };
