/**
 * The in-tree value editor (child design §9: shows the current value, Enter commits,
 * Escape cancels, the model's secondary hex stays visible beside it).
 *
 * The webview half only: the host owns validation and the write, so this widget shows the
 * value, posts `{ type: 'edit', nodeId, value }` and gets out of the way. It never
 * re-derives the value — `data-value` is what `renderHtml` rendered — so the two sides
 * cannot disagree about what is being edited.
 *
 * It is emitted into the same script as the tree, which is why it can use `vscode` and
 * `focusItem`, and why its listeners are registered first: the tree's own click and key
 * handlers must not also fire for an interaction the widget has claimed.
 */
export function valueEditorScript(): string {
	return `
let valueEdit = null;

function beginValueEdit(item) {
	if (!item || item.dataset.kind !== 'parameter' || valueEdit) {
		return false;
	}
	const span = item.querySelector(':scope > .row > .value');
	if (!span) {
		return false;
	}
	const input = document.createElement('input');
	input.type = 'text';
	input.className = 'value-edit';
	input.value = item.dataset.value ?? '';
	input.setAttribute('aria-label', 'Value of ' + item.dataset.nodeId);
	span.style.display = 'none';
	span.after(input);
	focusItem(item);
	input.focus();
	input.select();
	valueEdit = { item, span, input };
	return true;
}

function endValueEdit(commit) {
	if (!valueEdit) {
		return;
	}
	const { item, span, input } = valueEdit;
	valueEdit = null;
	const value = input.value;
	input.remove();
	span.style.display = '';
	if (commit) {
		vscode.postMessage({ type: 'edit', nodeId: item.dataset.nodeId, value });
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
		endValueEdit(false);
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
			endValueEdit(event.key === 'Enter');
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

// A re-scan swaps the tree whole, so the input is gone with it; drop the stale state too.
window.addEventListener('message', (event) => {
	if (event.data && event.data.type === 'model') {
		valueEdit = null;
	}
});
`;
}
