/**
 * The details-panel field editor (the Document surface is read-only).
 *
 * The host still owns validation and the write: this script shows the selected
 * parameter's value or the selected container's short name / definition ref, posts
 * `{ type: 'edit', nodeId, value }` (or the same message with a `field`) and leaves the
 * row data alone until the host re-scans. A refused write keeps the typed text in the
 * details input and shows the reason beside it.
 *
 * One edit entry is kept per field, so a rebuild of the inspector restores each draft
 * independently and a refusal can be attached to the field that is waiting for an answer.
 *
 * The script is emitted before the page script in the same classic script, so
 * its functions can be called by `updateInspector`/`onRowClick`/`onTreeKeydown`.
 * The details input is outside `#tree`, so it does not need to pre-empt the
 * Document's click/key listeners; it only stops its own Enter/Escape/Tab keys.
 */
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

export function detailsEditorScript(): string {
	return `
${detailsInputAllowed.toString()}
let detailsEdits = {};
let pendingMove = null;
let pendingFieldFocus = null;
let flashId = null;

function clearDetailsError(edit) {
	if (!edit) {
		return;
	}
	edit.input.removeAttribute('aria-invalid');
	if (edit.error) {
		edit.error.textContent = '';
	}
}

function setDetailsError(edit, reason) {
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

function detailsSelectionChanged(rowId) {
	for (const field of Object.keys(detailsEdits)) {
		if (detailsEdits[field].rowId !== rowId) {
			detailsEdits = {};
			return;
		}
	}
}

function detailsFieldId(field) {
	if (field === 'shortName') {
		return 'details-short-name';
	}
	if (field === 'definitionRef') {
		return 'details-definition-ref';
	}
	return 'details-value';
}

function detailsStoredEdit(row, field) {
	const previous = detailsEdits[field];
	return previous && previous.rowId === row.id ? previous : null;
}

function detailsErrorSpan() {
	const error = document.createElement('span');
	error.className = 'details-value-error';
	error.setAttribute('role', 'status');
	error.setAttribute('aria-live', 'polite');
	return error;
}

/** The container field a Tab moves to, or undefined at either end of the pair. */
function detailsFieldSibling(field, dir) {
	if (field === 'shortName') {
		return dir === 'prev' ? undefined : 'definitionRef';
	}
	if (field === 'definitionRef') {
		return dir === 'prev' ? 'shortName' : undefined;
	}
	return undefined;
}

function detailsRegisterKeydown(input, edit) {
	input.addEventListener('keydown', function (event) {
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
				pendingMove = { dir: dir, from: edit.rowId };
			} else {
				pendingFieldFocus = { rowId: edit.rowId, field: edit.field, dir: dir };
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

function detailsValueInput(row, data) {
	const rowElement = document.createElement('div');
	rowElement.className = 'inspector-row';
	rowElement.appendChild(inspectorElement('span', 'inspector-key', 'Value'));
	const type = row.parameterType || data.type || '';
	const boolean = type === 'Boolean' && /^(true|false)$/i.test(String(row.value ?? ''));
	const input = document.createElement(boolean ? 'select' : 'input');
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
	const edit = {
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
	input.addEventListener('beforeinput', function (event) {
		if (event.data && !detailsInputAllowed(type, event.data)) {
			event.preventDefault();
		}
	});
	return rowElement;
}

function detailsFieldInput(row, field, label, value) {
	const rowElement = document.createElement('div');
	rowElement.className = 'inspector-row';
	rowElement.appendChild(inspectorElement('span', 'inspector-key', label));
	const input = document.createElement('input');
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
	const edit = {
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

function detailsContainerFields(row, data) {
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

function focusDetailsInput() {
	const input = document.getElementById('details-value');
	if (!input) {
		return false;
	}
	input.focus();
	if (typeof input.select === 'function') {
		input.select();
	}
	return true;
}

function focusDetailsField(field) {
	const input = document.getElementById(detailsFieldId(field));
	if (!input) {
		return false;
	}
	input.focus();
	if (typeof input.select === 'function') {
		input.select();
	}
	return true;
}

function detailsFirstField(row) {
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

function beginDetailsEdit(rowId, field) {
	const row = rowById.get(rowId);
	if (!row) {
		return false;
	}
	const target = field || detailsFirstField(row);
	if (!target) {
		return false;
	}
	if (uiState.tab !== 'details') {
		// An edit always happens in the Details panel; the Conditions tab must not
		// silently swallow it.
		showSidebarTab('details');
	}
	if (typeof showSidebarSection === 'function') {
		// The target field's section may be collapsed; reveal it before focus.
		showSidebarSection(target === 'value' ? 'sb-details-value' : 'sb-details-node');
	}
	if (selectedId !== rowId) {
		const item = renderedItemFor(rowId);
		if (item) {
			selectItem(item);
		} else {
			setSelection(rowId);
			vscode.postMessage({ type: 'select', nodeId: rowId });
			focusRow(rowId);
		}
	} else {
		updateInspector();
	}
	return focusDetailsField(target);
}

function cancelDetailsEdit(field) {
	const edit = detailsEdits[field];
	if (!edit || edit.pending) {
		return;
	}
	edit.input.value = edit.original;
	clearDetailsError(edit);
	edit.input.focus();
}

function commitDetailsEdit(field) {
	const edit = detailsEdits[field];
	if (!edit || edit.pending) {
		return;
	}
	edit.pending = true;
	clearDetailsError(edit);
	flashId = edit.rowId;
	if (edit.field === 'value') {
		vscode.postMessage({ type: 'edit', nodeId: edit.rowId, value: edit.input.value });
	} else {
		vscode.postMessage({ type: 'edit', nodeId: edit.rowId, field: edit.field, value: edit.input.value });
	}
}

function flashRow(nodeId) {
	const item = renderedItemFor(nodeId);
	if (!item) {
		return;
	}
	item.classList.add('flash');
	setTimeout(() => item.classList.remove('flash'), 1000);
}

function beginAdjacentDetailsEdit(move) {
	const id = focusAdjacentParameter(move.from, move.dir);
	if (id) {
		beginDetailsEdit(id);
	}
}

function beginFieldDetailsEdit(focus) {
	const next = detailsFieldSibling(focus.field, focus.dir);
	if (!next) {
		return;
	}
	// A committed rename renumbers the row, so the row the field was left from may be
	// gone; the host keeps the renamed container selected under its new id.
	const rowId = rowById.has(focus.rowId) ? focus.rowId : selectedId;
	const row = rowId === undefined ? undefined : rowById.get(rowId);
	if (!row || row.kind !== 'container') {
		return;
	}
	if (next === 'shortName' ? !row.shortName : !row.definitionRef) {
		return;
	}
	beginDetailsEdit(row.id, next);
}

window.addEventListener('message', function (event) {
	const message = event.data;
	if (!message) {
		return;
	}
	if (message.type === 'model') {
		const flash = flashId;
		const move = pendingMove;
		const focus = pendingFieldFocus;
		flashId = null;
		pendingMove = null;
		pendingFieldFocus = null;
		detailsEdits = {};
		if (flash) {
			// A renamed container has a new id, so the row to flash follows the selection.
			setTimeout(() => flashRow(rowById.has(flash) ? flash : selectedId), 0);
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
			const reason =
				typeof message.message === 'string' && message.message !== ''
					? message.message
					: 'The value was refused.';
			setDetailsError(edit, reason);
			edit.input.focus();
			return;
		}
	}
});
`;
}
