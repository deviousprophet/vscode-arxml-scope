/**
 * The in-tree value editor (child design §9; UX child design §6): shows the current
 * value, Enter commits, Escape cancels, the model's secondary hex stays visible beside
 * it, and a refused write keeps what the user typed.
 *
 * The webview half only: the host owns validation and the write, so this widget shows the
 * value, posts `{ type: 'edit', nodeId, value }` and gets out of the way. It never
 * re-derives the value — `data-value` is what `renderHtml` rendered — so the two sides
 * cannot disagree about what is being edited.
 *
 * It is emitted into the same script as the tree, which is why it can use `vscode` and
 * `focusItem`, and why its listeners are registered first: the tree's own click and key
 * handlers must not also fire for an interaction the widget has claimed. That ordering is
 * load-bearing and must not be changed.
 *
 * A refusal no longer discards the typed text (UX child design §6): the host answers a
 * refused write with a `notice`, and the open input is marked invalid instead of being
 * removed. Only Escape, a click outside, a successful commit (the re-scan swaps the tree),
 * a `Tab` move, or the edited row leaving the virtual window closes it. A window rebuild
 * with the row still visible moves the input to the rebuilt row.
 */
export function valueEditorScript(): string {
	return `
let valueEdit = null;
let pendingMove = null;
let flashId = null;

function beginValueEdit(item) {
	if (!item || item.dataset.kind !== 'parameter' || valueEdit) {
		return false;
	}
	const span = item.querySelector(':scope > .row > .value');
	if (!span) {
		return false;
	}
	const text = span.querySelector('.value-text') ?? span;
	const input = document.createElement('input');
	input.type = 'text';
	input.className = 'value-edit';
	input.value = item.dataset.value ?? '';
	input.setAttribute('aria-label', 'Value of ' + item.dataset.nodeId);
	text.style.display = 'none';
	text.after(input);
	focusItem(item);
	input.focus();
	input.select();
	valueEdit = { item, span, text, input, pending: false };
	return true;
}

/** Closes the editor and drops the typed text: Escape, a click outside, a Tab move. */
function closeValueEdit() {
	if (!valueEdit) {
		return;
	}
	const { text, input } = valueEdit;
	if (valueEdit.error) {
		valueEdit.error.remove();
	}
	valueEdit = null;
	input.remove();
	text.style.display = '';
}

/**
 * The window renderer replaces the rows it renders. Before it clears the old
 * window, take the open input (and its typed text, pending state, error and
 * caret) out of the old row; reattachValueEdit puts it into the rebuilt row
 * when the same node is still in the window. Without this a scroll could leave
 * Enter committing a detached, invisible field.
 */
function detachValueEdit() {
	if (!valueEdit) {
		return null;
	}
	const { item, text, input } = valueEdit;
	const state = {
		id: item.dataset.nodeId,
		value: input.value,
		pending: valueEdit.pending,
		error: valueEdit.error ? valueEdit.error.textContent : null,
		focused: document.activeElement === input,
		selectionStart: input.selectionStart,
		selectionEnd: input.selectionEnd,
	};
	if (valueEdit.error) {
		valueEdit.error.remove();
	}
	input.remove();
	text.style.display = '';
	valueEdit = null;
	return state;
}

function reattachValueEdit(item, state) {
	if (!item || !state || valueEdit) {
		return false;
	}
	const span = item.querySelector(':scope > .row > .value');
	if (!span) {
		return false;
	}
	const text = span.querySelector('.value-text') ?? span;
	const input = document.createElement('input');
	input.type = 'text';
	input.className = 'value-edit';
	input.value = state.value;
	input.setAttribute('aria-label', 'Value of ' + item.dataset.nodeId);
	text.style.display = 'none';
	text.after(input);
	let error = null;
	if (state.error) {
		error = document.createElement('span');
		error.className = 'value-error';
		error.textContent = state.error;
		input.after(error);
	}
	valueEdit = { item, span, text, input, pending: state.pending, error };
	if (state.focused) {
		input.focus({ preventScroll: true });
		const start = state.selectionStart === null ? input.value.length : state.selectionStart;
		const end = state.selectionEnd === null ? start : state.selectionEnd;
		input.setSelectionRange(start, end);
	}
	return true;
}

/** Posts the edit but keeps the input open until the host answers (design §6). */
function commitValueEdit() {
	if (!valueEdit || valueEdit.pending) {
		return;
	}
	const { item, input } = valueEdit;
	valueEdit.pending = true;
	if (valueEdit.error) {
		valueEdit.error.remove();
		valueEdit.error = null;
	}
	input.removeAttribute('aria-invalid');
	flashId = item.dataset.nodeId;
	vscode.postMessage({ type: 'edit', nodeId: item.dataset.nodeId, value: input.value });
}

/** Briefly highlights the row the host re-rendered after a successful write (design §6). */
function flashRow(nodeId) {
	const item = renderedItemFor(nodeId);
	if (!item) {
		return;
	}
	item.classList.add('flash');
	setTimeout(() => item.classList.remove('flash'), 1000);
}

/** Tab / Shift+Tab: the next or previous parameter's value, after a successful commit. */
function beginAdjacentValueEdit(move) {
	// The row window only holds the viewport, so the page's row order (not the DOM)
	// chooses the neighbour; the page renders it before the editor starts.
	const id = focusAdjacentParameter(move.from, move.dir);
	const item = id ? renderedItemFor(id) : undefined;
	if (item) {
		beginValueEdit(item);
	}
}

document.addEventListener('click', (event) => {
	if (!(event.target instanceof Element)) {
		return;
	}
	if (valueEdit) {
		if (valueEdit.item.contains(event.target)) {
			// A click inside the open editor is the caret, not a reveal.
			event.stopImmediatePropagation();
			return;
		}
		closeValueEdit();
	}
	const span = event.target.closest('#tree .value');
	if (span && beginValueEdit(span.closest('[role="treeitem"]'))) {
		event.stopImmediatePropagation();
	}
});

document.addEventListener('keydown', (event) => {
	if (valueEdit) {
		if (event.key === 'Enter' || event.key === 'Escape') {
			event.preventDefault();
			if (event.key === 'Enter') {
				commitValueEdit();
			} else {
				closeValueEdit();
			}
		} else if (event.key === 'Tab') {
			// Commit and move to the neighbouring value — but only once the host has
			// accepted the commit, so a refusal cannot lose the typed text.
			event.preventDefault();
			pendingMove = { dir: event.shiftKey ? 'prev' : 'next', from: valueEdit.item.dataset.nodeId };
			commitValueEdit();
		}
		// The input already saw the key; the tree must not also act on it.
		event.stopImmediatePropagation();
		return;
	}
	if (event.key === 'F2' && event.target instanceof Element) {
		const item = event.target.closest('#tree [role="treeitem"]');
		if (item && beginValueEdit(item)) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	}
});

// A re-scan swaps the tree whole, so the input is gone with it; drop the stale state too,
// and only then follow up on the outcome of a commit.
window.addEventListener('message', (event) => {
	const message = event.data;
	if (!message) {
		return;
	}
	if (message.type === 'model') {
		const flash = flashId;
		const move = pendingMove;
		flashId = null;
		pendingMove = null;
		valueEdit = null;
		if (flash) {
			setTimeout(() => flashRow(flash), 0);
		}
		if (move) {
			setTimeout(() => beginAdjacentValueEdit(move), 0);
		}
	} else if (message.type === 'notice') {
		if (valueEdit && valueEdit.pending && message.kind === 'warn') {
			// The write was refused: keep the text, say so beside the field, and let the user fix it.
			valueEdit.pending = false;
			pendingMove = null;
			flashId = null;
			valueEdit.input.setAttribute('aria-invalid', 'true');
			const reason = typeof message.message === 'string' && message.message !== ''
				? message.message
				: 'The value was refused.';
			let error = valueEdit.error;
			if (!error) {
				error = document.createElement('span');
				error.className = 'value-error';
				valueEdit.error = error;
				valueEdit.input.after(error);
			}
			error.textContent = '/* ' + reason + ' */';
		}
	}
});
`;
}
