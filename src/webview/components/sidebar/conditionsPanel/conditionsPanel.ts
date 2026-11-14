/**
 * Conditions panel: the SW-SYSCOND constant values, one editable draft at a
 * time, discovered rows from the current document and manual workspace rows.
 *
 * Owns its markup, its draft/edit state and its input behaviour. The composition
 * root supplies the row list and receives the committed entries; persistence is
 * the host's job.
 */
import './conditionsPanel.css';
import type { ConditionEntry } from '../../../../core/ecuc/conditionEntry';


/** The one validation rule for a row name, shared by Save and the tests. */
export function conditionEntryError(name: string, others: readonly string[] = []): string {
	const trimmed = trimmedConditionName(name);
	if (trimmed === '') {
		return 'Enter a constant name before saving.';
	}
	if (!conditionNameValid(trimmed)) {
		return 'Invalid name: use a constant name or path (letters, digits, _ . - /).';
	}
	if (duplicateConditionName(trimmed, others)) {
		return `A condition value named ${trimmed} already exists.`;
	}
	return '';
}

function trimmedConditionName(name: string): string {
	return typeof name === 'string' ? name.trim() : '';
}

function duplicateConditionName(name: string, others: readonly string[]): boolean {
	return others ? others.indexOf(name) >= 0 : false;
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

let conditionsPanel: any;
let conditionsList: any;
let conditionsAdd: any;
let conditionsClear: any;
let conditionsEmpty: any;
let conditionsCount: any;
let conditionsValuesBadge: any;
let conditionsStatus: any;
let conditionsRows: any[] = [];
let editingConditionRow: any = null;
let onConditionsChange: (entries: ConditionEntry[]) => void = function () {};
let reportConditionsError: (text: string) => void = function () {};

export function setConditionRows(next: unknown): void {
	conditionsRows = Array.isArray(next) ? next : [];
}

export function setConditionsCallback(callback: (entries: ConditionEntry[]) => void): void {
	onConditionsChange = callback;
}

export function setConditionsErrorReporter(reporter: (text: string) => void): void {
	reportConditionsError = reporter;
}


function conditionIconButton(className: string, label: string, title: string, pathData: string): any {
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
function renderConditionRow(row: any): void {
	if (!row) {
		return;
	}
	const editing = row.dataset.editing === 'true';
	const isNew = row.dataset.new === 'true';
	const auto = row.dataset.auto === 'true';
	const name = conditionRowNameAttribute(row);
	const value = conditionRowValueAttribute(row);
	row.textContent = '';
	appendConditionName(row, editing, isNew, name);
	appendConditionEquals(row);
	if (editing) {
		appendConditionEdit(row, value, name);
		return;
	}
	appendConditionValueText(row, value);
	appendConditionViewActions(row, name, auto);
	updateConditionRowState(row);
}

function conditionRowNameAttribute(row: HTMLElement): string {
	return row.dataset.name || '';
}

function conditionRowValueAttribute(row: HTMLElement): string {
	return row.dataset.value || '';
}

function conditionNameInput(name: string): HTMLInputElement {
	const nameInput = document.createElement('input');
	nameInput.className = 'condition-name';
	nameInput.type = 'text';
	nameInput.placeholder = 'CONSTANT_NAME';
	nameInput.setAttribute('aria-label', 'Constant name');
	nameInput.setAttribute('aria-invalid', 'false');
	nameInput.value = name;
	return nameInput;
}

function conditionNameText(name: string): HTMLSpanElement {
	const nameText = document.createElement('span');
	nameText.className = 'condition-name-text';
	nameText.textContent = name;
	nameText.title = name;
	return nameText;
}

function appendConditionName(row: HTMLElement, editing: boolean, isNew: boolean, name: string): void {
	if (editing && isNew) {
		row.appendChild(conditionNameInput(name));
		return;
	}
	row.appendChild(conditionNameText(name));
}

function appendConditionEquals(row: HTMLElement): void {
	const equals = document.createElement('span');
	equals.className = 'punct';
	equals.textContent = '=';
	row.appendChild(equals);
}

function appendConditionEdit(row: HTMLElement, value: string, name: string): void {
	const valueInput = document.createElement('input');
	valueInput.className = 'condition-value';
	valueInput.type = 'text';
	valueInput.placeholder = 'value';
	valueInput.setAttribute('aria-label', 'Constant value');
	valueInput.value = value;
	row.appendChild(valueInput);
	const actions = document.createElement('div');
	actions.className = 'condition-actions';
	actions.appendChild(
		conditionIconButton(
			'condition-save',
			'Save ' + (name || 'condition value'),
			'Save this condition value',
			'M3 8.5l3 3 7-7'
		)
	);
	actions.appendChild(
		conditionIconButton(
			'condition-cancel',
			'Cancel ' + (name || 'new condition value'),
			'Discard this change',
			'M4 4l8 8M12 4l-8 8'
		)
	);
	row.appendChild(actions);
}

function appendConditionValueText(row: HTMLElement, value: string): void {
	if (value.trim() === '') {
		return;
	}
	const valueText = document.createElement('span');
	valueText.className = 'condition-value-text';
	valueText.textContent = value;
	valueText.title = 'Value: ' + value;
	row.appendChild(valueText);
}

function appendConditionViewActions(row: HTMLElement, name: string, auto: boolean): void {
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
}

interface ConditionRowOptions {
	auto?: boolean;
	editing?: boolean;
	isNew?: boolean;
}

/** Creates a row from an entry and its committed flags, then renders it. */
function conditionRowElement(entry: Partial<ConditionEntry> | null | undefined, options?: ConditionRowOptions): HTMLElement {
	const row = document.createElement('div');
	row.className = 'condition-row parent';
	row.dataset.name = conditionEntryName(entry);
	row.dataset.value = conditionEntryValue(entry);
	row.dataset.auto = conditionAutoAttribute(options);
	row.dataset.editing = conditionEditingAttribute(options);
	row.dataset.new = conditionNewAttribute(options);
	renderConditionRow(row);
	return row;
}

function conditionEntryName(entry: Partial<ConditionEntry> | null | undefined): string {
	return entry && typeof entry.name === 'string' ? entry.name.trim() : '';
}

function conditionEntryValue(entry: Partial<ConditionEntry> | null | undefined): string {
	return entry && typeof entry.value === 'string' ? entry.value : '';
}

function conditionAutoAttribute(options?: ConditionRowOptions): string {
	return options && options.auto === false ? 'false' : 'true';
}

function conditionEditingAttribute(options?: ConditionRowOptions): string {
	return options && options.editing === true ? 'true' : 'false';
}

function conditionNewAttribute(options?: ConditionRowOptions): string {
	return options && options.isNew === true ? 'true' : 'false';
}

/**
 * The badge means "no committed value". A draft never shows it, and the draft
 * input is never read here; data-value is the only source.
 */
function updateConditionRowState(row: any): void {
	if (!row) {
		return;
	}
	const state = row.querySelector('.condition-state');
	if (!state) {
		return;
	}
	state.hidden = conditionStateHidden(row);
}

function conditionStateHidden(row: HTMLElement): boolean {
	const editing = row.dataset.editing === 'true';
	const value = (row.dataset.value || '').trim();
	return editing || value !== '';
}

function discoveredConditionSymbols(): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (let at = 0; at < conditionsRows.length; at++) {
		collectConditionSymbols(conditionRowSymbolsAt(at), seen, out);
	}
	return out;
}

function conditionRowSymbolsAt(at: number): readonly unknown[] {
	const row = conditionsRows[at];
	const condition = row ? row.condition : undefined;
	return condition && Array.isArray(condition.symbols) ? condition.symbols : [];
}

function isNewConditionSymbol(name: unknown, seen: Set<string>): name is string {
	return typeof name === 'string' && name !== '' && !seen.has(name);
}

function collectConditionSymbols(symbols: readonly unknown[], seen: Set<string>, out: string[]): void {
	for (let symbol = 0; symbol < symbols.length; symbol++) {
		const name = symbols[symbol];
		if (isNewConditionSymbol(name, seen)) {
			seen.add(name);
			out.push(name);
		}
	}
}

function rowConditionName(row: HTMLElement): string {
	return row.dataset ? (row.dataset.name || '').trim() : '';
}

function addNameWhenPresent(names: Set<string>, name: string): void {
	if (name !== '') {
		names.add(name);
	}
}

function existingConditionNames(): Set<string> {
	const names = new Set<string>();
	if (!conditionsList) {
		return names;
	}
	const list = conditionsList.querySelectorAll('.condition-row');
	for (let at = 0; at < list.length; at++) {
		addNameWhenPresent(names, rowConditionName(list[at]));
	}
	return names;
}

/** The committed names of every other row, for duplicate validation. */
function conditionOtherNames(row: any): string[] {
	const names: string[] = [];
	if (!conditionsList) {
		return names;
	}
	const list = conditionsList.querySelectorAll('.condition-row');
	for (let at = 0; at < list.length; at++) {
		if (list[at] !== row) {
			pushNameWhenPresent(names, rowConditionName(list[at]));
		}
	}
	return names;
}

function pushNameWhenPresent(names: string[], name: string): void {
	if (name !== '') {
		names.push(name);
	}
}

/**
 * Marks every row scanned (data-auto="true") when the current document
 * references its name, and manual otherwise. A manual row that becomes scanned
 * loses its Remove action but keeps its committed value; an editing row is
 * never rebuilt, so a draft survives a re-scan.
 */
function syncConditionRowAutoFlags(): void {
	if (!conditionsList) {
		return;
	}
	const discovered = new Set(discoveredConditionSymbols());
	const list = conditionsList.querySelectorAll('.condition-row');
	for (let at = 0; at < list.length; at++) {
		syncConditionRowAutoFlag(list[at], discovered);
	}
}

function syncConditionRowAutoFlag(row: HTMLElement, discovered: Set<string>): void {
	const auto = conditionRowIsAuto(row, discovered);
	row.dataset.auto = auto ? 'true' : 'false';
	if (row.dataset.editing === 'true') {
		return;
	}
	ensureConditionRemoveAction(row, auto);
}

function conditionRowIsAuto(row: HTMLElement, discovered: Set<string>): boolean {
	return discovered.has((row.dataset.name || '').trim());
}

function ensureConditionRemoveAction(row: HTMLElement, auto: boolean): void {
	const hasRemove = row.querySelector('.condition-remove') !== null;
	const needsRemove = auto !== true;
	if (hasRemove !== needsRemove) {
		// Scanned rows must have no Remove, manual rows must have it.
		renderConditionRow(row);
	}
}

export function ensureDiscoveredConditionRows(): void {
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
function readConditionEntries(): ConditionEntry[] {
	const entries: ConditionEntry[] = [];
	if (!conditionsList) {
		return entries;
	}
	const rows = conditionsList.querySelectorAll('.condition-row');
	for (let at = 0; at < rows.length; at++) {
		const entry = committedConditionEntry(rows[at]);
		if (entry) {
			entries.push(entry);
		}
	}
	return entries;
}

function committedConditionEntry(row: HTMLElement): ConditionEntry | null {
	if (row.dataset.new === 'true') {
		return null;
	}
	const name = committedConditionName(row);
	if (!conditionNameValid(name)) {
		return null;
	}
	if (conditionRowOmittedFromEntries(row)) {
		return null;
	}
	return { name: name, value: committedConditionValue(row) };
}

function committedConditionName(row: HTMLElement): string {
	return (row.dataset.name || '').trim();
}

function committedConditionValue(row: HTMLElement): string {
	return row.dataset.value || '';
}

function conditionRowOmittedFromEntries(row: HTMLElement): boolean {
	// A discovered constant with no saved value is regenerated from the document;
	// persisting it would turn it into a manual row in other files.
	return row.dataset.auto === 'true' && committedConditionValue(row) === '';
}

interface ConditionChromeCounts {
	count: number;
	missing: number;
	total: number;
}

function conditionChromeCounts(): ConditionChromeCounts {
	const counts: ConditionChromeCounts = { count: 0, missing: 0, total: 0 };
	if (!conditionsList) {
		return counts;
	}
	const list = conditionsList.querySelectorAll('.condition-row');
	counts.total = list.length;
	for (let at = 0; at < list.length; at++) {
		countCommittedConditionRow(list[at], counts);
	}
	return counts;
}

function countCommittedConditionRow(row: HTMLElement, counts: ConditionChromeCounts): void {
	const data = row.dataset;
	if (!isCommittedConditionRow(data)) {
		// An unsaved Add draft is not a committed constant yet.
		return;
	}
	counts.count++;
	if (conditionValueMissing(data)) {
		counts.missing++;
	}
}

function isCommittedConditionRow(data: DOMStringMap | undefined): data is DOMStringMap {
	return !!data && data.new !== 'true';
}

function conditionValueMissing(data: DOMStringMap): boolean {
	return (data.value || '').trim() === '';
}

function conditionBadgeText(counts: ConditionChromeCounts): string {
	const label = counts.count + (counts.count === 1 ? ' constant' : ' constants');
	return label + (counts.missing > 0 ? ' · ' + counts.missing + ' missing' : '');
}

function updateConditionsChrome(): void {
	const counts = conditionChromeCounts();
	if (conditionsEmpty) {
		conditionsEmpty.hidden = counts.total !== 0;
	}
	if (conditionsClear) {
		conditionsClear.disabled = counts.count === 0;
	}
	if (conditionsValuesBadge) {
		conditionsValuesBadge.textContent = conditionBadgeText(counts);
		conditionsValuesBadge.hidden = counts.count === 0;
	}
}

export function renderConditionEntries(entries: unknown): void {
	if (!canReplaceConditionRows()) {
		// A host entries push cannot replace a local draft; Save/Cancel owns it.
		return;
	}
	conditionsList.textContent = '';
	appendConditionEntries(entries);
	ensureDiscoveredConditionRows();
	updateConditionsChrome();
}

function canReplaceConditionRows(): boolean {
	return !!conditionsList && !editingConditionRow;
}

function appendConditionEntries(entries: unknown): void {
	const list = Array.isArray(entries) ? entries : [];
	for (let at = 0; at < list.length; at++) {
		conditionsList.appendChild(conditionRowElement(list[at], { auto: false }));
	}
}

function sendConditions(): void {
	onConditionsChange(readConditionEntries());
}

function conditionEditorInput(row: HTMLElement): HTMLInputElement | null {
	return row.dataset.new === 'true'
		? row.querySelector<HTMLInputElement>('.condition-name')
		: row.querySelector<HTMLInputElement>('.condition-value');
}

function focusConditionEditor(row: any): void {
	if (!row) {
		return;
	}
	focusAndSelect(conditionEditorInput(row));
}

function focusAndSelect(input: HTMLInputElement | null): void {
	if (input && input.focus) {
		input.focus();
		if (input.select) {
			input.select();
		}
	}
}

function isEditingConditionRow(row: HTMLElement): boolean {
	return editingConditionRow === row && row.dataset.editing === 'true';
}

function cancelOtherConditionEdit(row: HTMLElement): void {
	// One draft at a time: cancel the previous row before opening this one.
	if (editingConditionRow && editingConditionRow !== row) {
		cancelConditionEdit(editingConditionRow);
	}
}

function openConditionEdit(row: HTMLElement): void {
	editingConditionRow = row;
	row.dataset.editing = 'true';
	renderConditionRow(row);
	focusConditionEditor(row);
	updateConditionsChrome();
}

function beginConditionEdit(row: any): void {
	if (!row) {
		return;
	}
	if (isEditingConditionRow(row)) {
		focusConditionEditor(row);
		return;
	}
	cancelOtherConditionEdit(row);
	openConditionEdit(row);
}

function conditionNameDraftInput(row: HTMLElement, isNew: boolean): HTMLInputElement | null {
	return isNew ? row.querySelector<HTMLInputElement>('.condition-name') : null;
}

function conditionDraftName(row: HTMLElement, isNew: boolean, nameInput: HTMLInputElement | null): string {
	if (!isNew) {
		return (row.dataset.name || '').trim();
	}
	return nameInput ? nameInput.value.trim() : '';
}

function conditionDraftValue(row: HTMLElement, valueInput: HTMLInputElement | null): string {
	return valueInput ? valueInput.value : row.dataset.value || '';
}

function conditionDraftError(row: HTMLElement, isNew: boolean, name: string): string {
	return isNew ? conditionEntryError(name, conditionOtherNames(row)) : '';
}

function showConditionsStatus(text: string): void {
	if (conditionsStatus) {
		conditionsStatus.textContent = text;
	}
}

function showConditionEditError(error: string, nameInput: HTMLInputElement | null): void {
	if (nameInput) {
		nameInput.setAttribute('aria-invalid', 'true');
	}
	showConditionsStatus(error);
}

function focusConditionEditAction(row: HTMLElement): void {
	const edit = row.querySelector<HTMLElement>('.condition-edit');
	if (edit && edit.focus) {
		edit.focus();
	}
}

function commitConditionEdit(row: HTMLElement, name: string, value: string): void {
	row.dataset.name = name;
	row.dataset.value = value;
	row.dataset.new = 'false';
	row.dataset.editing = 'false';
	editingConditionRow = null;
	showConditionsStatus('');
	renderConditionRow(row);
	focusConditionEditAction(row);
	syncConditionRowAutoFlags();
	updateConditionsChrome();
	sendConditions();
}

function saveConditionEdit(row: any): void {
	if (!row) {
		return;
	}
	const isNew = row.dataset.new === 'true';
	const nameInput = conditionNameDraftInput(row, isNew);
	const name = conditionDraftName(row, isNew, nameInput);
	const value = conditionDraftValue(row, row.querySelector('.condition-value'));
	const error = conditionDraftError(row, isNew, name);
	if (error !== '') {
		showConditionEditError(error, nameInput);
		return;
	}
	commitConditionEdit(row, name, value);
}

function detachConditionRow(row: HTMLElement): void {
	if (row.parentNode) {
		row.parentNode.removeChild(row);
	}
}

function restoreConditionRow(row: HTMLElement): void {
	row.dataset.editing = 'false';
	renderConditionRow(row);
	focusConditionEditAction(row);
}

function cancelConditionEdit(row: any): void {
	if (!row) {
		return;
	}
	if (editingConditionRow === row) {
		editingConditionRow = null;
	}
	if (row.dataset.new === 'true') {
		detachConditionRow(row);
	} else {
		restoreConditionRow(row);
	}
	showConditionsStatus('');
	updateConditionsChrome();
}

function focusExistingConditionDraft(): boolean {
	if (!editingConditionRow) {
		return false;
	}
	if (editingConditionRow.dataset.new === 'true') {
		focusConditionEditor(editingConditionRow);
		return true;
	}
	cancelConditionEdit(editingConditionRow);
	return false;
}

function openNewConditionRow(): void {
	const row = conditionRowElement({ name: '', value: '' }, { auto: false, isNew: true, editing: true });
	conditionsList.appendChild(row);
	showConditionsStatus('');
	beginConditionEdit(row);
	updateConditionsChrome();
}

/** Mirrors the host's `ENTRY_LIMIT`: the 201st row would be dropped silently. */
const MAX_CONDITION_ROWS = 200;

function addConditionEntry(): void {
	if (!conditionsList) {
		return;
	}
	if (focusExistingConditionDraft()) {
		return;
	}
	if (conditionsList.querySelectorAll('.condition-row').length >= MAX_CONDITION_ROWS) {
		showConditionsStatus(`At most ${MAX_CONDITION_ROWS} condition values can be added.`);
		return;
	}
	openNewConditionRow();
}

function removeConditionRow(row: any): void {
	if (!row || row.dataset.auto === 'true') {
		// Scanned rows are owned by the document and have no Remove control.
		return;
	}
	if (editingConditionRow === row) {
		editingConditionRow = null;
	}
	detachConditionRow(row);
	showConditionsStatus('');
	updateConditionsChrome();
	sendConditions();
}

function clearConditionEntries(): void {
	if (conditionsList) {
		const list = conditionsList.querySelectorAll('.condition-row');
		for (let at = 0; at < list.length; at++) {
			// An open draft is not a committed value: clearing keeps its typed text.
			if (list[at] === editingConditionRow) {
				continue;
			}
			list[at].dataset.value = '';
			renderConditionRow(list[at]);
		}
	}
	updateConditionsChrome();
	sendConditions();
}

export function setConditionsStatus(message: string): void {
	if (conditionsStatus) {
		conditionsStatus.textContent = message || '';
	}
}

function countDisabledConditionRows(): number {
	let disabled = 0;
	for (let at = 0; at < conditionsRows.length; at++) {
		if (conditionsRows[at].disabled) {
			disabled++;
		}
	}
	return disabled;
}

export function applyDisabledCount(): void {
	if (!conditionsCount) {
		return;
	}
	const disabled = countDisabledConditionRows();
	conditionsCount.textContent = disabled > 0 ? disabled + ' disabled' : '';
	conditionsCount.hidden = disabled === 0;
}

function handleConditionPanelClick(event: MouseEvent): void {
	if (!(event.target instanceof Element)) {
		return;
	}
	const row = event.target.closest('.condition-row');
	if (!(row instanceof HTMLElement)) {
		return;
	}
	dispatchConditionRowAction(event.target, row);
}

function dispatchConditionRowAction(target: Element, row: HTMLElement): void {
	if (dispatchConditionEditAction(target, row)) {
		return;
	}
	dispatchConditionRemoveAction(target, row);
}

function dispatchConditionEditAction(target: Element, row: HTMLElement): boolean {
	if (target.closest('.condition-edit')) {
		beginConditionEdit(row);
		return true;
	}
	if (target.closest('.condition-save')) {
		saveConditionEdit(row);
		return true;
	}
	return false;
}

function dispatchConditionRemoveAction(target: Element, row: HTMLElement): void {
	if (target.closest('.condition-cancel')) {
		cancelConditionEdit(row);
	} else if (target.closest('.condition-remove')) {
		removeConditionRow(row);
	}
}

function isConditionNameInput(target: EventTarget | null): target is Element {
	return target instanceof Element && target.classList.contains('condition-name');
}

function handleConditionPanelInput(event: Event): void {
	const target = event.target;
	if (!isConditionNameInput(target)) {
		return;
	}
	target.setAttribute('aria-invalid', 'false');
	showConditionsStatus('');
}

function conditionEditorRow(target: Element): HTMLElement | null {
	const row = target.closest('.condition-row');
	if (!(row instanceof HTMLElement)) {
		return null;
	}
	return row.dataset.editing === 'true' ? row : null;
}

function handleConditionEditorKey(event: KeyboardEvent, row: HTMLElement): void {
	if (event.key === 'Enter') {
		event.preventDefault();
		event.stopPropagation();
		saveConditionEdit(row);
	} else if (event.key === 'Escape') {
		event.preventDefault();
		event.stopPropagation();
		cancelConditionEdit(row);
	}
}

function handleConditionPanelKeydown(event: KeyboardEvent): void {
	const target = event.target;
	if (!(target instanceof Element) || target.tagName !== 'INPUT') {
		return;
	}
	const row = conditionEditorRow(target);
	if (!row) {
		return;
	}
	handleConditionEditorKey(event, row);
}

export function mountConditionsPanel(): void {
	editingConditionRow = null;
	conditionsRows = [];
	conditionsPanel = document.getElementById('conditions-panel');
	conditionsList = document.getElementById('conditions-list');
	conditionsAdd = document.getElementById('conditions-add');
	conditionsClear = document.getElementById('conditions-clear');
	conditionsEmpty = document.getElementById('conditions-empty');
	conditionsCount = document.getElementById('conditions-count');
	conditionsValuesBadge = document.getElementById('sb-conditions-values-badge');
	conditionsStatus = document.getElementById('conditions-status');
	if (conditionsAdd) {
		conditionsAdd.addEventListener('click', addConditionEntry);
	}
	if (conditionsClear) {
		conditionsClear.addEventListener('click', clearConditionEntries);
	}
	if (conditionsPanel) {
		conditionsPanel.addEventListener('click', handleConditionPanelClick);
		conditionsPanel.addEventListener('input', handleConditionPanelInput);
		conditionsPanel.addEventListener('keydown', handleConditionPanelKeydown);
	}
	renderConditionEntries([]);
}
