/**
 * Conditions panel: the SW-SYSCOND constant values, one editable draft at a
 * time, discovered rows from the current document and manual workspace rows.
 *
 * Owns its markup, its draft/edit state and its input behaviour. The composition
 * root supplies the row list and receives the committed entries; persistence is
 * the host's job.
 */
import conditionsPanelCss from './conditionsPanel.css';

export function conditionsPanelStyles(): string {
	return conditionsPanelCss;
}

/** The one validation rule for a row name, shared by Save and the tests. */
export function conditionEntryError(name: string, others: readonly string[] = []): string {
	const trimmed = typeof name === 'string' ? name.trim() : '';
	if (trimmed === '') {
		return 'Enter a constant name before saving.';
	}
	if (!conditionNameValid(trimmed)) {
		return 'Invalid name: use a constant name or path (letters, digits, _ . - /).';
	}
	if (others && others.indexOf(trimmed) >= 0) {
		return `A condition value named ${trimmed} already exists.`;
	}
	return '';
}

export function conditionNameValid(name: string): boolean {
	return /^\/?[A-Za-z_][A-Za-z0-9_./-]*$/.test(name);
}

/** The Conditions tab panel: one section, one list and its actions. */
export function renderConditionsPanelHtml(): string {
	return `<div id="sbp-conditions" class="sb-tab-panel" role="tabpanel" aria-labelledby="stab-conditions" hidden>
<div class="sb-pane-view">
<section class="sb-section sb-pane" id="sb-conditions-values" data-pane-id="sb-conditions-values">
<div class="sb-section-head" role="button" tabindex="0" aria-expanded="true" aria-controls="sb-conditions-values-body" aria-label="Condition values">
<span class="sb-section-chevron" aria-hidden="true"></span>
<h3 class="sb-section-title" id="sb-conditions-values-title"><span class="sb-section-label">Condition values</span><span id="sb-conditions-values-badge" class="sb-section-badge" hidden></span></h3>
</div>
<div class="sb-body" id="sb-conditions-values-body" role="region" aria-labelledby="sb-conditions-values-title">
<div id="conditions-panel" class="conditions-panel">
<div class="conditions-head">
<span id="conditions-count" class="conditions-count" hidden></span>
<span class="grow"></span>
</div>
<div id="conditions-empty" class="conditions-empty" hidden>
<p>No condition values yet.</p>
<p class="conditions-hint">Add a constant used by <code>SW-SYSCOND</code>, for example <code>CANIPCORETYPE_SC = 1</code>.</p>
</div>
<div id="conditions-list" class="conditions-list"></div>
<div class="conditions-actions">
<button id="conditions-add" class="sb-btn sb-btn-add" type="button" title="Add a condition value" aria-label="Add condition value"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg><span>Add value</span></button>
<span class="grow"></span>
<button id="conditions-clear" class="sb-btn sb-btn-secondary sb-btn-danger" type="button" title="Remove every entered condition value" aria-label="Clear all condition values" disabled><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8M7 7v3.5M9 7v3.5"/></svg><span>Clear values</span></button>
</div>
<div id="conditions-status" class="conditions-status" role="status" aria-live="polite"></div>
</div>
</div>
</section>
</div>
</div>`;
}

/**
 * The page half of the Conditions panel. The composition root calls
 * `mountConditionsPanel()` after the shell exists, then feeds rows with
 * `setConditionRows` and receives committed entries through `setConditionsCallback`.
 */
export function conditionsPanelScript(): string {
	return `
let conditionsPanel;
let conditionsList;
let conditionsAdd;
let conditionsClear;
let conditionsEmpty;
let conditionsCount;
let conditionsValuesBadge;
let conditionsStatus;
let conditionsScript;
let conditionsRows = [];
let editingConditionRow = null;
let onConditionsChange = function () {};
let reportConditionsError = function () {};

function setConditionRows(next) {
	conditionsRows = Array.isArray(next) ? next : [];
}

function setConditionsCallback(callback) {
	onConditionsChange = callback;
}

function setConditionsErrorReporter(reporter) {
	reportConditionsError = reporter;
}

${conditionNameValid.toString()}
${conditionEntryError.toString()}

function conditionIconButton(className, label, title, pathData) {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'act-btn ' + className;
	button.title = title;
	button.setAttribute('aria-label', label);
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('width', '12');
	svg.setAttribute('height', '12');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '1.4');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.setAttribute('aria-hidden', 'true');
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', pathData);
	svg.appendChild(path);
	button.appendChild(svg);
	return button;
}

/**
 * Rebuilds one row from its committed dataset. View mode shows text and the
 * pencil/trash actions; edit mode shows the value input (and the name input for
 * an unsaved new row) with primary Save and secondary Cancel.
 */
function renderConditionRow(row) {
	if (!row) {
		return;
	}
	const editing = row.dataset.editing === 'true';
	const isNew = row.dataset.new === 'true';
	const auto = row.dataset.auto === 'true';
	const name = row.dataset.name || '';
	const value = row.dataset.value || '';
	row.textContent = '';
	if (editing && isNew) {
		const nameInput = document.createElement('input');
		nameInput.className = 'condition-name';
		nameInput.type = 'text';
		nameInput.placeholder = 'CONSTANT_NAME';
		nameInput.setAttribute('aria-label', 'Constant name');
		nameInput.setAttribute('aria-invalid', 'false');
		nameInput.value = name;
		row.appendChild(nameInput);
	} else {
		const nameText = document.createElement('span');
		nameText.className = 'condition-name-text';
		nameText.textContent = name;
		nameText.title = name;
		row.appendChild(nameText);
	}
	const equals = document.createElement('span');
	equals.className = 'punct';
	equals.textContent = '=';
	row.appendChild(equals);
	if (editing) {
		const valueInput = document.createElement('input');
		valueInput.className = 'condition-value';
		valueInput.type = 'text';
		valueInput.placeholder = 'value';
		valueInput.setAttribute('aria-label', 'Constant value');
		valueInput.value = value;
		row.appendChild(valueInput);
		const actions = document.createElement('div');
		actions.className = 'condition-actions';
		const save = conditionIconButton(
			'condition-save',
			'Save ' + (name || 'condition value'),
			'Save this condition value',
			'M3 8.5l3 3 7-7'
		);
		actions.appendChild(save);
		const cancel = conditionIconButton(
			'condition-cancel',
			'Cancel ' + (name || 'new condition value'),
			'Discard this change',
			'M4 4l8 8M12 4l-8 8'
		);
		actions.appendChild(cancel);
		row.appendChild(actions);
		return;
	}
	if (value.trim() !== '') {
		const valueText = document.createElement('span');
		valueText.className = 'condition-value-text';
		valueText.textContent = value;
		valueText.title = 'Value: ' + value;
		row.appendChild(valueText);
	}
	const actions = document.createElement('div');
	actions.className = 'condition-actions';
	const state = document.createElement('span');
	state.className = 'condition-state';
	state.textContent = 'unknown';
	state.title = 'No value yet: conditions using this constant stay unknown';
	actions.appendChild(state);
	actions.appendChild(
		conditionIconButton(
			'condition-edit',
			'Edit ' + (name || 'condition value'),
			'Edit',
			'M11.5 2.5l2 2L5 13H3v-2zM9.5 4.5l2 2'
		)
	);
	if (!auto) {
		actions.appendChild(
			conditionIconButton(
				'condition-remove',
				'Remove ' + (name || 'condition value'),
				'Remove',
				'M2.5 4.5h11M6 4.5V3h4v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v3.5M9.2 7v3.5'
			)
		);
	}
	row.appendChild(actions);
	updateConditionRowState(row);
}

/** Creates a row from an entry and its committed flags, then renders it. */
function conditionRowElement(entry, options) {
	const row = document.createElement('div');
	row.className = 'condition-row parent';
	const name = entry && typeof entry.name === 'string' ? entry.name.trim() : '';
	const value = entry && typeof entry.value === 'string' ? entry.value : '';
	row.dataset.name = name;
	row.dataset.value = value;
	row.dataset.auto = options && options.auto === false ? 'false' : 'true';
	row.dataset.editing = options && options.editing === true ? 'true' : 'false';
	row.dataset.new = options && options.isNew === true ? 'true' : 'false';
	renderConditionRow(row);
	return row;
}

/**
 * The badge means "no committed value". A draft never shows it, and the draft
 * input is never read here; data-value is the only source.
 */
function updateConditionRowState(row) {
	if (!row) {
		return;
	}
	const state = row.querySelector('.condition-state');
	if (!state) {
		return;
	}
	const editing = row.dataset.editing === 'true';
	const value = (row.dataset.value || '').trim();
	state.hidden = editing || value !== '';
}

function discoveredConditionSymbols() {
	const seen = new Set();
	const out = [];
	for (let at = 0; at < conditionsRows.length; at++) {
		const condition = conditionsRows[at] ? conditionsRows[at].condition : undefined;
		const symbols = condition && Array.isArray(condition.symbols) ? condition.symbols : [];
		for (let symbol = 0; symbol < symbols.length; symbol++) {
			const name = symbols[symbol];
			if (typeof name === 'string' && name !== '' && !seen.has(name)) {
				seen.add(name);
				out.push(name);
			}
		}
	}
	return out;
}

function existingConditionNames() {
	const names = new Set();
	if (!conditionsList) {
		return names;
	}
	const list = conditionsList.querySelectorAll('.condition-row');
	for (let at = 0; at < list.length; at++) {
		const name = list[at].dataset ? (list[at].dataset.name || '').trim() : '';
		if (name !== '') {
			names.add(name);
		}
	}
	return names;
}

/** The committed names of every other row, for duplicate validation. */
function conditionOtherNames(row) {
	const names = [];
	if (!conditionsList) {
		return names;
	}
	const list = conditionsList.querySelectorAll('.condition-row');
	for (let at = 0; at < list.length; at++) {
		if (list[at] === row) {
			continue;
		}
		const name = list[at].dataset ? (list[at].dataset.name || '').trim() : '';
		if (name !== '') {
			names.push(name);
		}
	}
	return names;
}

/**
 * Marks every row scanned (data-auto="true") when the current document
 * references its name, and manual otherwise. A manual row that becomes scanned
 * loses its Remove action but keeps its committed value; an editing row is
 * never rebuilt, so a draft survives a re-scan.
 */
function syncConditionRowAutoFlags() {
	if (!conditionsList) {
		return;
	}
	const discovered = new Set(discoveredConditionSymbols());
	const list = conditionsList.querySelectorAll('.condition-row');
	for (let at = 0; at < list.length; at++) {
		const row = list[at];
		const auto = discovered.has((row.dataset.name || '').trim());
		row.dataset.auto = auto ? 'true' : 'false';
		if (row.dataset.editing === 'true') {
			continue;
		}
		const hasRemove = row.querySelector('.condition-remove') !== null;
		const needsRemove = auto !== true;
		if (hasRemove !== needsRemove) {
			// Scanned rows must have no Remove, manual rows must have it.
			renderConditionRow(row);
		}
	}
}

function ensureDiscoveredConditionRows() {
	if (!conditionsList) {
		return;
	}
	const symbols = discoveredConditionSymbols();
	const existing = existingConditionNames();
	for (let at = 0; at < symbols.length; at++) {
		if (existing.has(symbols[at])) {
			continue;
		}
		existing.add(symbols[at]);
		conditionsList.appendChild(conditionRowElement({ name: symbols[at], value: '' }, { auto: true }));
	}
	syncConditionRowAutoFlags();
	updateConditionsChrome();
}

/** The committed entries only; a draft input or an unsaved row is never read. */
function readConditionEntries() {
	const entries = [];
	if (!conditionsList) {
		return entries;
	}
	const rows = conditionsList.querySelectorAll('.condition-row');
	for (let at = 0; at < rows.length; at++) {
		const row = rows[at];
		if (row.dataset.new === 'true') {
			continue;
		}
		const name = (row.dataset.name || '').trim();
		if (!conditionNameValid(name)) {
			continue;
		}
		const value = row.dataset.value || '';
		// A discovered constant with no saved value is regenerated from the document;
		// persisting it would turn it into a manual row in other files.
		if (row.dataset.auto === 'true' && value === '') {
			continue;
		}
		entries.push({ name: name, value: value });
	}
	return entries;
}

function initialConditionEntries() {
	if (!conditionsScript) {
		return [];
	}
	try {
		const parsed = JSON.parse(conditionsScript.textContent || '[]');
		return Array.isArray(parsed) ? parsed : [];
	} catch (error) {
		reportConditionsError('The condition values could not be read: ' + error.message);
		return [];
	}
}

function updateConditionsChrome() {
	let count = 0;
	let missing = 0;
	let total = 0;
	if (conditionsList) {
		const list = conditionsList.querySelectorAll('.condition-row');
		total = list.length;
		for (let at = 0; at < list.length; at++) {
			const data = list[at].dataset;
			if (!data || data.new === 'true') {
				// An unsaved Add draft is not a committed constant yet.
				continue;
			}
			count++;
			if ((data.value || '').trim() === '') {
				missing++;
			}
		}
	}
	if (conditionsEmpty) {
		conditionsEmpty.hidden = total !== 0;
	}
	if (conditionsClear) {
		conditionsClear.disabled = count === 0;
	}
	if (conditionsValuesBadge) {
		conditionsValuesBadge.textContent =
			count + (count === 1 ? ' constant' : ' constants') + (missing > 0 ? ' · ' + missing + ' missing' : '');
		conditionsValuesBadge.hidden = count === 0;
	}
}

function renderConditionEntries(entries) {
	if (!conditionsList) {
		return;
	}
	if (editingConditionRow) {
		// A host entries push cannot replace a local draft; Save/Cancel owns it.
		return;
	}
	conditionsList.textContent = '';
	const list = Array.isArray(entries) ? entries : [];
	for (let at = 0; at < list.length; at++) {
		conditionsList.appendChild(conditionRowElement(list[at], { auto: false }));
	}
	ensureDiscoveredConditionRows();
	updateConditionsChrome();
}

function sendConditions() {
	onConditionsChange(readConditionEntries());
}

function focusConditionEditor(row) {
	if (!row) {
		return;
	}
	const input =
		row.dataset.new === 'true' ? row.querySelector('.condition-name') : row.querySelector('.condition-value');
	if (input && input.focus) {
		input.focus();
		if (input.select) {
			input.select();
		}
	}
}

function beginConditionEdit(row) {
	if (!row) {
		return;
	}
	if (editingConditionRow === row && row.dataset.editing === 'true') {
		focusConditionEditor(row);
		return;
	}
	if (editingConditionRow && editingConditionRow !== row) {
		// One draft at a time: cancel the previous row before opening this one.
		cancelConditionEdit(editingConditionRow);
	}
	editingConditionRow = row;
	row.dataset.editing = 'true';
	renderConditionRow(row);
	focusConditionEditor(row);
	updateConditionsChrome();
}

function saveConditionEdit(row) {
	if (!row) {
		return;
	}
	const isNew = row.dataset.new === 'true';
	const nameInput = isNew ? row.querySelector('.condition-name') : null;
	const valueInput = row.querySelector('.condition-value');
	const name = isNew ? (nameInput ? nameInput.value.trim() : '') : (row.dataset.name || '').trim();
	const value = valueInput ? valueInput.value : row.dataset.value || '';
	const error = isNew ? conditionEntryError(name, conditionOtherNames(row)) : '';
	if (error !== '') {
		if (nameInput) {
			nameInput.setAttribute('aria-invalid', 'true');
		}
		if (conditionsStatus) {
			conditionsStatus.textContent = error;
		}
		return;
	}
	row.dataset.name = name;
	row.dataset.value = value;
	row.dataset.new = 'false';
	row.dataset.editing = 'false';
	editingConditionRow = null;
	if (conditionsStatus) {
		conditionsStatus.textContent = '';
	}
	renderConditionRow(row);
	const edit = row.querySelector('.condition-edit');
	if (edit && edit.focus) {
		edit.focus();
	}
	syncConditionRowAutoFlags();
	updateConditionsChrome();
	sendConditions();
}

function cancelConditionEdit(row) {
	if (!row) {
		return;
	}
	if (editingConditionRow === row) {
		editingConditionRow = null;
	}
	if (row.dataset.new === 'true') {
		if (row.parentNode) {
			row.parentNode.removeChild(row);
		}
	} else {
		row.dataset.editing = 'false';
		renderConditionRow(row);
		const edit = row.querySelector('.condition-edit');
		if (edit && edit.focus) {
			edit.focus();
		}
	}
	if (conditionsStatus) {
		conditionsStatus.textContent = '';
	}
	updateConditionsChrome();
}

function addConditionEntry() {
	if (!conditionsList) {
		return;
	}
	if (editingConditionRow) {
		if (editingConditionRow.dataset.new === 'true') {
			focusConditionEditor(editingConditionRow);
			return;
		}
		cancelConditionEdit(editingConditionRow);
	}
	const row = conditionRowElement({ name: '', value: '' }, { auto: false, isNew: true, editing: true });
	conditionsList.appendChild(row);
	if (conditionsStatus) {
		conditionsStatus.textContent = '';
	}
	beginConditionEdit(row);
	updateConditionsChrome();
}

function removeConditionRow(row) {
	if (!row) {
		return;
	}
	if (row.dataset.auto === 'true') {
		// Scanned rows are owned by the document and have no Remove control.
		return;
	}
	if (editingConditionRow === row) {
		editingConditionRow = null;
	}
	if (row.parentNode) {
		row.parentNode.removeChild(row);
	}
	if (conditionsStatus) {
		conditionsStatus.textContent = '';
	}
	updateConditionsChrome();
	sendConditions();
}

function clearConditionEntries() {
	if (editingConditionRow) {
		cancelConditionEdit(editingConditionRow);
	}
	if (conditionsList) {
		const list = conditionsList.querySelectorAll('.condition-row');
		for (let at = 0; at < list.length; at++) {
			list[at].dataset.value = '';
			renderConditionRow(list[at]);
		}
	}
	updateConditionsChrome();
	sendConditions();
}

function setConditionsStatus(message) {
	if (conditionsStatus) {
		conditionsStatus.textContent = message || '';
	}
}

function applyDisabledCount() {
	if (!conditionsCount) {
		return;
	}
	let disabled = 0;
	for (let at = 0; at < conditionsRows.length; at++) {
		if (conditionsRows[at].disabled) {
			disabled++;
		}
	}
	conditionsCount.textContent = disabled > 0 ? disabled + ' disabled' : '';
	conditionsCount.hidden = disabled === 0;
}

/** Applies a host entries refresh (a reloaded page) and reports whether it handled the message. */
function applyConditionsMessage(message) {
	if (!message || message.type !== 'conditions') {
		return false;
	}
	renderConditionEntries(message.entries);
	return true;
}

function mountConditionsPanel() {
	conditionsPanel = document.getElementById('conditions-panel');
	conditionsList = document.getElementById('conditions-list');
	conditionsAdd = document.getElementById('conditions-add');
	conditionsClear = document.getElementById('conditions-clear');
	conditionsEmpty = document.getElementById('conditions-empty');
	conditionsCount = document.getElementById('conditions-count');
	conditionsValuesBadge = document.getElementById('sb-conditions-values-badge');
	conditionsStatus = document.getElementById('conditions-status');
	conditionsScript = document.getElementById('ecuc-conditions');
	if (conditionsAdd) {
		conditionsAdd.addEventListener('click', addConditionEntry);
	}
	if (conditionsClear) {
		conditionsClear.addEventListener('click', clearConditionEntries);
	}
	if (conditionsPanel) {
		conditionsPanel.addEventListener('click', function (event) {
			if (!(event.target instanceof Element)) {
				return;
			}
			const row = event.target.closest('.condition-row');
			if (!row) {
				return;
			}
			if (event.target.closest('.condition-edit')) {
				beginConditionEdit(row);
			} else if (event.target.closest('.condition-save')) {
				saveConditionEdit(row);
			} else if (event.target.closest('.condition-cancel')) {
				cancelConditionEdit(row);
			} else if (event.target.closest('.condition-remove')) {
				removeConditionRow(row);
			}
		});
		conditionsPanel.addEventListener('input', function (event) {
			const target = event.target;
			if (target && target.classList && target.classList.contains('condition-name')) {
				target.setAttribute('aria-invalid', 'false');
				if (conditionsStatus) {
					conditionsStatus.textContent = '';
				}
			}
		});
		conditionsPanel.addEventListener('keydown', function (event) {
			if (!(event.target instanceof Element) || event.target.tagName !== 'INPUT') {
				return;
			}
			const row = event.target.closest('.condition-row');
			if (!row || row.dataset.editing !== 'true') {
				return;
			}
			if (event.key === 'Enter') {
				event.preventDefault();
				event.stopPropagation();
				saveConditionEdit(row);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				cancelConditionEdit(row);
			}
		});
	}
	renderConditionEntries(initialConditionEntries());
}
`;
}
