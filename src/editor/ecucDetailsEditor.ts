/**
 * The details-panel value editor (the Document surface is read-only).
 *
 * The host still owns validation and the write: this script shows the selected
 * parameter's value in the details panel, posts `{ type: 'edit', nodeId, value }`
 * and leaves the row data alone until the host re-scans. A refused write keeps
 * the typed text in the details input and shows the reason beside it.
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
let detailsEdit = null;
let pendingMove = null;
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
	if (detailsEdit && detailsEdit.rowId !== rowId) {
		detailsEdit = null;
	}
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
	const previous = detailsEdit && detailsEdit.rowId === row.id ? detailsEdit : null;
	if (previous) {
		input.value = previous.input.value;
	}
	const error = document.createElement('span');
	error.className = 'details-value-error';
	error.setAttribute('role', 'status');
	error.setAttribute('aria-live', 'polite');
	rowElement.appendChild(input);
	rowElement.appendChild(error);
	const edit = { rowId: row.id, input, error, pending: previous ? previous.pending : false, type, original };
	detailsEdit = edit;
	if (previous && previous.error && previous.error.textContent) {
		edit.error.textContent = previous.error.textContent;
		edit.input.setAttribute('aria-invalid', 'true');
	}
	input.addEventListener('keydown', function (event) {
		if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			commitDetailsEdit();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			cancelDetailsEdit();
		} else if (event.key === 'Tab') {
			event.preventDefault();
			event.stopPropagation();
			if (detailsEdit && !detailsEdit.pending) {
				pendingMove = { dir: event.shiftKey ? 'prev' : 'next', from: detailsEdit.rowId };
				commitDetailsEdit();
			}
		}
	});
	input.addEventListener('beforeinput', function (event) {
		if (event.data && !detailsInputAllowed(type, event.data)) {
			event.preventDefault();
		}
	});
	input.addEventListener('input', function () {
		clearDetailsError(edit);
	});
	input.addEventListener('change', function () {
		clearDetailsError(edit);
	});
	return rowElement;
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

function beginDetailsEdit(rowId) {
	const row = rowById.get(rowId);
	if (!row || row.kind !== 'parameter') {
		return false;
	}
	if (uiState.inspectorHidden === true) {
		uiState.inspectorHidden = false;
		applyInspectorVisibility();
		vscode.setState(uiState);
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
	return focusDetailsInput();
}

function cancelDetailsEdit() {
	if (!detailsEdit || detailsEdit.pending) {
		return;
	}
	detailsEdit.input.value = detailsEdit.original;
	clearDetailsError(detailsEdit);
	detailsEdit.input.focus();
}

function commitDetailsEdit() {
	if (!detailsEdit || detailsEdit.pending) {
		return;
	}
	const edit = detailsEdit;
	edit.pending = true;
	clearDetailsError(edit);
	flashId = edit.rowId;
	vscode.postMessage({ type: 'edit', nodeId: edit.rowId, value: edit.input.value });
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

window.addEventListener('message', function (event) {
	const message = event.data;
	if (!message) {
		return;
	}
	if (message.type === 'model') {
		const flash = flashId;
		const move = pendingMove;
		flashId = null;
		pendingMove = null;
		detailsEdit = null;
		if (flash) {
			setTimeout(() => flashRow(flash), 0);
		}
		if (move) {
			setTimeout(() => beginAdjacentDetailsEdit(move), 0);
		}
	} else if (message.type === 'notice') {
		if (detailsEdit && detailsEdit.pending && message.kind === 'warn') {
			detailsEdit.pending = false;
			pendingMove = null;
			flashId = null;
			const reason =
				typeof message.message === 'string' && message.message !== ''
					? message.message
					: 'The value was refused.';
			setDetailsError(detailsEdit, reason);
			detailsEdit.input.focus();
		}
	}
});
`;
}
