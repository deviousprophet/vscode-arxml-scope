/**
 * Browser entry for the preview pages.
 *
 * Mounts the real page, then posts the host messages the state describes. The
 * production shell is server-rendered; this file only drives the protocol, a
 * few DOM gestures (Swap, horizontal pan, F7, a changed-row click), then records
 * a rendered-geometry audit for the screenshot runner. No page code is forked.
 */
// The production entries auto-mount when their page root is present, exactly as
// the extension webview does. Importing them is the whole wiring; calling the
// mount functions again would bind every toolbar action twice.
import '../../../../src/webview/diffMonaco';
import '../../../../src/webview/editorMonaco';
import { paneSnapshot, previewAudit } from './previewAudit';
import type { PaneSnapshot } from './previewAudit';
import type { PreviewStateFields } from './previewStateFields';

interface PreviewPayload extends PreviewStateFields {
	state: string;
	page: 'diff' | 'editor';
	message: unknown;
	renameDocument?: { rows: PreviewRow[]; selectedId?: string };
}

interface PreviewCell {
	label: string;
	value?: string;
	shownValue?: string;
	meta?: Array<{ text: string }>;
}

interface PreviewRow {
	id?: string;
	key?: string;
	label?: string;
	kind?: string;
	valueKind?: string;
	value?: string;
	shownValue?: string;
	meta?: Array<{ text: string }>;
	left?: PreviewCell;
	right?: PreviewCell;
}

interface PreviewFindMatch {
	rowId?: string;
	key?: string;
	side?: 'left' | 'right';
	field: 'label' | 'value' | 'meta';
	part?: number;
	start: number;
	end: number;
	replaceable?: boolean;
}

interface PreviewEdit {
	type?: string;
	editId?: number;
	nodeId?: string;
	value?: string;
}

interface PreviewModel {
	getLineCount(): number;
	getLineContent(line: number): string;
}

interface PreviewEditorHandle {
	focus(): void;
	getModel(): PreviewModel | null;
	setPosition(position: { lineNumber: number; column: number }): void;
	setSelection(selection: {
		startLineNumber: number;
		startColumn: number;
		endLineNumber: number;
		endColumn: number;
	}): void;
	trigger(source: string, id: string, args: unknown): void;
	revealLineInCenter(line: number): void;
}

interface EditTarget {
	editor: PreviewEditorHandle;
	model: PreviewModel;
	line: number;
}

declare global {
	interface Window {
		__PREVIEW__: PreviewPayload;
		__PREVIEW_MESSAGES__: unknown[];
	}
}

const payload = window.__PREVIEW__;
let swapBefore: PaneSnapshot | undefined;

function publishPageError(message: string): void {
	if (message.includes('ResizeObserver loop')) {
		return;
	}
	if (document.getElementById('preview-audit') !== null) {
		return;
	}
	const node = document.createElement('script');
	node.type = 'application/json';
	node.id = 'preview-audit';
	node.textContent = JSON.stringify({
		state: payload.state,
		page: payload.page,
		ready: false,
		violations: [`page error: ${message}`]
	}).replaceAll('<', '\\u003c');
	document.body.appendChild(node);
}

window.addEventListener('error', (event) => publishPageError(event.message));
window.addEventListener('unhandledrejection', (event) => publishPageError(String(event.reason)));

function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A short timer lets the resize observer and the final layout settle. */
function settle(): Promise<void> {
	return delay(200);
}

function click(id: string): void {
	const element = document.getElementById(id);
	if (element) {
		element.click();
	}
}

async function until(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 80; attempt++) {
		if (predicate()) {
			return;
		}
		await tick();
	}
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt++) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

async function jumpToChange(): Promise<void> {
	click('diff-next');
	await tick();
}

async function applyMerge(): Promise<void> {
	if (payload.merge === undefined) {
		return;
	}
	window.postMessage({ type: 'mergeMode', enabled: payload.merge }, '*');
	await tick();
}

async function applySwap(): Promise<void> {
	if (!payload.swap) {
		return;
	}
	swapBefore = paneSnapshot();
	click('diff-swap');
	await tick();
}

async function applyPan(): Promise<void> {
	if (!payload.pan) {
		return;
	}
	const pane = document.querySelector('.monaco-diff-editor .monaco-scrollable-element') as HTMLElement | null;
	if (!pane) {
		return;
	}
	pane.dispatchEvent(
		new WheelEvent('wheel', { deltaX: payload.pan, deltaY: 0, bubbles: true, cancelable: true })
	);
	await tick();
}

async function applyJumps(): Promise<void> {
	for (let press = 0; press < (payload.jump ?? 0); press++) {
		await jumpToChange();
	}
}

function selectRow(): HTMLElement | null {
	if (payload.page === 'editor') {
		return document.querySelector(
			'#tree-pane .node[data-document-index]:not([aria-selected="true"])'
		) as HTMLElement | null;
	}
	return null;
}

async function applySelect(): Promise<void> {
	if (!payload.select) {
		return;
	}
	const row = selectRow();
	row?.click();
	await tick();
}

function publishAudit(): void {
	const audit = previewAudit(
		{
			name: payload.state,
			page: payload.page,
			merge: payload.merge,
			swap: payload.swap,
			wide: payload.wide,
			pan: payload.pan,
			select: payload.select,
			sash: payload.sash,
			detailsEdit: payload.detailsEdit,
			detailsSave: payload.detailsSave,
			detailsUndo: payload.detailsUndo,
			detailsRedo: payload.detailsRedo,
			detailsRename: payload.detailsRename,
			deleteEdit: payload.deleteEdit
		},
		swapBefore
	);
	const node = document.createElement('script');
	node.type = 'application/json';
	node.id = 'preview-audit';
	node.textContent = JSON.stringify(audit).replaceAll('<', '\\u003c');
	document.body.appendChild(node);
}

function findOccurrence(query: string, text: string | undefined): { start: number; end: number } | undefined {
	if (typeof text !== 'string') {
		return undefined;
	}
	const start = text.toLowerCase().indexOf(query.toLowerCase());
	return start < 0 ? undefined : { start, end: start + query.length };
}

/** A payload text field that is present and non-empty. */
function hasText(value: string | undefined): value is string {
	return value !== undefined && value !== '';
}

/** Adds a row match only when the row has an id and the text was found. */
function pushRowMatch(
	out: PreviewFindMatch[],
	row: PreviewRow,
	field: PreviewFindMatch['field'],
	found: { start: number; end: number } | undefined,
	extra: Partial<PreviewFindMatch>
): void {
	if (row.id === undefined || found === undefined) {
		return;
	}
	out.push({ rowId: row.id, field, ...extra, ...found });
}

function partCount(meta: Array<{ text: string }> | undefined): number {
	return meta?.length ?? 0;
}

function pushMetaMatches(out: PreviewFindMatch[], row: PreviewRow, query: string): void {
	for (let part = 0; part < partCount(row.meta); part += 1) {
		pushRowMatch(out, row, 'meta', findOccurrence(query, row.meta?.[part]?.text), { part });
	}
}

function rowMatches(row: PreviewRow, query: string): PreviewFindMatch[] {
	const out: PreviewFindMatch[] = [];
	pushRowMatch(out, row, 'label', findOccurrence(query, row.label), {});
	pushRowMatch(out, row, 'value', findOccurrence(query, row.value), { replaceable: true });
	pushMetaMatches(out, row, query);
	return out;
}

/** Adds a side-cell match only when the text was found. */
function pushCellMatch(
	out: PreviewFindMatch[],
	row: PreviewRow,
	side: 'left' | 'right',
	field: PreviewFindMatch['field'],
	found: { start: number; end: number } | undefined,
	part?: number
): void {
	if (found === undefined) {
		return;
	}
	out.push({ key: row.key, side, field, ...(part === undefined ? {} : { part }), ...found });
}

function shownText(cell: PreviewCell): string | undefined {
	return cell.shownValue ?? cell.value;
}

function cellMetaMatches(
	row: PreviewRow,
	cell: PreviewCell,
	side: 'left' | 'right',
	query: string
): PreviewFindMatch[] {
	const out: PreviewFindMatch[] = [];
	for (let part = 0; part < partCount(cell.meta); part += 1) {
		pushCellMatch(out, row, side, 'meta', findOccurrence(query, cell.meta?.[part]?.text), part);
	}
	return out;
}

function cellMatches(
	row: PreviewRow,
	cell: PreviewCell | undefined,
	side: 'left' | 'right',
	query: string
): PreviewFindMatch[] {
	const out: PreviewFindMatch[] = [];
	if (cell === undefined || row.key === undefined) {
		return out;
	}
	pushCellMatch(out, row, side, 'label', findOccurrence(query, cell.label));
	pushCellMatch(out, row, side, 'value', findOccurrence(query, shownText(cell)));
	out.push(...cellMetaMatches(row, cell, side, query));
	return out;
}

function matchesForRow(row: PreviewRow, page: 'diff' | 'editor', query: string): PreviewFindMatch[] {
	return page === 'editor'
		? rowMatches(row, query)
		: [...cellMatches(row, row.left, 'left', query), ...cellMatches(row, row.right, 'right', query)];
}

function previewFindResult(
	page: 'diff' | 'editor',
	query: string
): { matches: PreviewFindMatch[]; total: number; limited: boolean } {
	const matches = payloadRows().flatMap((row) => matchesForRow(row, page, query));
	return { matches, total: matches.length, limited: false };
}

function findRoot(page: 'diff' | 'editor'): string {
	return page === 'editor' ? '#tree' : '.modified-in-monaco-diff-editor';
}

function openFindWidget(page: 'diff' | 'editor'): void {
	const previewWindow = window as unknown as {
		__ARXML_EDITOR__?: { trigger(source: string, id: string, args: unknown): void };
		__ARXML_DIFF_EDITOR__?: { getModifiedEditor(): { trigger(source: string, id: string, args: unknown): void } };
	};
	if (page === 'editor') {
		previewWindow.__ARXML_EDITOR__?.trigger('preview', 'actions.find', null);
		return;
	}
	previewWindow.__ARXML_DIFF_EDITOR__?.getModifiedEditor().trigger('preview', 'actions.find', null);
}

function seedFindInput(root: string, query: string): HTMLTextAreaElement | null {
	const input = document.querySelector(`${root} .find-widget textarea.input`) as HTMLTextAreaElement | null;
	if (input === null) {
		return null;
	}
	input.focus();
	input.value = query;
	input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: query }));
	return input;
}

function findRequestId(query: string): number | undefined {
	const messages = window.__PREVIEW_MESSAGES__ as Array<{ type?: string; query?: string; requestId?: number }>;
	const request = [...messages].reverse().find((message) => message.type === 'find' && message.query === query);
	return request?.requestId;
}

/** Posts the find result; false when the page made no find request. */
function postFindResult(page: 'diff' | 'editor', query: string): boolean {
	const requestId = findRequestId(query);
	if (requestId === undefined) {
		return false;
	}
	window.postMessage({ type: 'findResult', requestId, result: previewFindResult(page, query) }, '*');
	return true;
}

function clickNextMatch(root: string): void {
	const next = document.querySelector(`${root} .find-widget [aria-label^="Next Match"]`) as HTMLElement | null;
	next?.click();
}

async function runFind(page: 'diff' | 'editor', query: string): Promise<void> {
	const root = findRoot(page);
	openFindWidget(page);
	await tick();
	const input = seedFindInput(root, query);
	if (input === null || !postFindResult(page, query)) {
		return;
	}
	await tick();
	clickNextMatch(root);
	await tick();
	input.focus();
}

async function applyFind(): Promise<void> {
	if (!hasText(payload.find)) {
		return;
	}
	await runFind(payload.page, payload.find);
}

async function applyDirtyEdit(): Promise<void> {
	const edit = payload.edit;
	if (!hasText(edit)) {
		return;
	}
	const target = editTarget('P0000 = ');
	if (target === undefined) {
		return;
	}
	target.editor.focus();
	target.editor.setPosition({ lineNumber: target.line, column: target.model.getLineContent(target.line).length + 1 });
	await typeSlowly(target.editor, edit);
	await delay(250);
	if (payload.trySave === true) {
		dispatchCtrlS();
		await delay(50);
	}
}

/** Types one character at a time, letting the page apply each keystroke. */
async function typeSlowly(editor: PreviewEditorHandle, text: string): Promise<void> {
	for (const character of text) {
		editor.trigger('preview', 'type', { text: character });
		await delay(40);
	}
}

function typeAll(editor: PreviewEditorHandle, text: string): void {
	for (const character of text) {
		editor.trigger('preview', 'type', { text: character });
	}
}

function canTypeIn(input: HTMLInputElement | null): input is HTMLInputElement {
	return input !== null && typeof input.setSelectionRange === 'function';
}

function insertCharacter(input: HTMLInputElement, character: string): void {
	const start = input.selectionStart ?? input.value.length;
	const end = input.selectionEnd ?? start;
	input.value = input.value.slice(0, start) + character + input.value.slice(end);
	input.setSelectionRange(start + character.length, start + character.length);
	input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: character }));
}

async function typeIntoInput(input: HTMLInputElement, text: string): Promise<void> {
	input.focus();
	input.setSelectionRange(input.value.length, input.value.length);
	for (const character of text) {
		insertCharacter(input, character);
		await tick();
	}
}

/** The registered Undo/Redo actions route a local draft to the model stack. */
async function applyDetailsUndo(): Promise<void> {
	const editor = previewEditor();
	editor?.trigger('api', 'undo', null);
	await tick();
	if (payload.detailsRedo === true) {
		editor?.trigger('api', 'redo', null);
		await tick();
	}
}

async function saveDetailsEdits(): Promise<void> {
	if (payload.detailsSave !== true) {
		return;
	}
	dispatchCtrlS();
	await tick();
	const edits = postedEdits();
	await acknowledgeEdits(edits);
	echoAcceptedValue(edits[0], edits.length + 1);
	await tick();
}

/**
 * Types into the Details value control of the selected textual parameter. The
 * draft stays local: no host edit may be posted before Ctrl+S.
 */
async function applyDetailsEdit(): Promise<void> {
	const text = payload.detailsEdit;
	if (!hasText(text)) {
		return;
	}
	await tick();
	const input = document.getElementById('details-value') as HTMLInputElement | null;
	if (!canTypeIn(input)) {
		return;
	}
	await typeIntoInput(input, text);
	if (payload.detailsUndo === true) {
		await applyDetailsUndo();
		return;
	}
	await saveDetailsEdits();
}

/** The fixture document embedded in the state payload. */
function messageDocument(): (Record<string, unknown> & { rows?: PreviewRow[] }) | undefined {
	const message = payload.message as { document?: Record<string, unknown> & { rows?: PreviewRow[] } } | undefined;
	return message?.document;
}

function documentRows(): PreviewRow[] | undefined {
	const rows = messageDocument()?.rows;
	return Array.isArray(rows) ? rows : undefined;
}

function payloadRows(): PreviewRow[] {
	return documentRows() ?? [];
}

function editValue(edit: { value?: string } | undefined): string {
	return typeof edit?.value === 'string' ? edit.value : '';
}

function editNodeId(edit: { nodeId?: string } | undefined): string | undefined {
	return typeof edit?.nodeId === 'string' ? edit.nodeId : undefined;
}

function replaceValue(rows: PreviewRow[], nodeId: string, value: string): PreviewRow[] {
	return rows.map((row) => (row.id === nodeId ? { ...row, value, shownValue: `"${value}"` } : row));
}

/** The re-scan after an accepted edit: the host posts the row with its new value. */
function echoAcceptedValue(edit: { nodeId?: string; value?: string } | undefined, revision: number): void {
	const documentPayload = messageDocument();
	const rows = documentRows();
	const nodeId = editNodeId(edit);
	if (documentPayload === undefined || rows === undefined || nodeId === undefined) {
		return;
	}
	const value = editValue(edit);
	window.postMessage(
		{ type: 'document', document: { ...documentPayload, rows: replaceValue(rows, nodeId, value), revision, dirty: true } },
		'*'
	);
}

function postedEdits(): PreviewEdit[] {
	const messages = window.__PREVIEW_MESSAGES__ as PreviewEdit[];
	return messages.filter((message) => message.type === 'edit');
}

async function acknowledgeEdits(edits: PreviewEdit[]): Promise<void> {
	for (let index = 0; index < edits.length; index += 1) {
		window.postMessage({ type: 'editResult', editId: edits[index].editId, ok: true, revision: index + 1 }, '*');
	}
	await tick();
}

function renameInput(): HTMLInputElement | undefined {
	const input = document.getElementById('details-short-name') as HTMLInputElement | null;
	return canTypeIn(input) ? input : undefined;
}

function typeAtCaret(input: HTMLInputElement, text: string): void {
	const start = input.selectionStart ?? input.value.length;
	input.value = input.value.slice(0, start) + text + input.value.slice(start);
	input.setSelectionRange(start + text.length, start + text.length);
	input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}

function caretAtEnd(input: HTMLInputElement): void {
	input.focus();
	input.setSelectionRange(input.value.length, input.value.length);
}

function acknowledgeRename(first: PreviewEdit | undefined, echo: { selectedId?: string }): void {
	if (first?.editId === undefined) {
		return;
	}
	// The host owns the id: the ack carries the renamed container's new id so the
	// page never re-derives it from the short name.
	window.postMessage(
		{
			type: 'editResult',
			editId: first.editId,
			ok: true,
			revision: 1,
			...(echo.selectedId === undefined ? {} : { nextNodeId: echo.selectedId })
		},
		'*'
	);
}

async function renameFirstSave(input: HTMLInputElement, echo: { selectedId?: string }): Promise<PreviewEdit | undefined> {
	caretAtEnd(input);
	typeAtCaret(input, '2');
	await tick();
	// First Ctrl+S: one rename edit.
	dispatchCtrlS();
	await tick();
	const first = postedEdits()[0];
	// The host normally answers before its re-scan; the late-ack state reverses that
	// to prove the page keeps the caret across a document-first rebuild.
	if (payload.renameLateAck !== true) {
		acknowledgeRename(first, echo);
		await tick();
	}
	return first;
}

async function renameSecondSave(input: HTMLInputElement): Promise<void> {
	// The new id has not arrived yet. Keep typing and save again: this draft must
	// wait for the re-scan instead of being sent at the pre-rename id.
	caretAtEnd(input);
	typeAtCaret(input, '3');
	await tick();
	dispatchCtrlS();
	await tick();
}

async function renameRescan(echo: { selectedId?: string }, first: PreviewEdit | undefined): Promise<void> {
	window.postMessage({ type: 'document', document: { ...echo, revision: 2, dirty: true } }, '*');
	await tick();
	if (payload.renameLateAck === true) {
		acknowledgeRename(first, echo);
		await tick();
	}
}

function postRenameResult(second: PreviewEdit | undefined): void {
	if (second?.editId === undefined) {
		return;
	}
	if (payload.renameRefusal === true) {
		// The host refuses the post-flush rename: the draft is now addressed at the
		// new id, so the refusal and the inline error must be recorded there.
		window.postMessage(
			{
				type: 'editResult',
				editId: second.editId,
				ok: false,
				reason: 'the short name is refused by the test host',
				revision: 3
			},
			'*'
		);
		return;
	}
	window.postMessage({ type: 'editResult', editId: second.editId, ok: true, revision: 3 }, '*');
}

/**
 * Rename the selected container, acknowledge the edit before the re-scan, type
 * one more character and press Ctrl+S while the rename id is still unresolved,
 * then deliver the renamed document as the host would. The second save must
 * defer, and the surviving keystroke must be submitted under the new id.
 */
async function applyDetailsRename(): Promise<void> {
	const echo = payload.renameDocument;
	if (payload.detailsRename !== true || echo === undefined) {
		return;
	}
	await tick();
	const input = renameInput();
	if (input === undefined) {
		return;
	}
	const first = await renameFirstSave(input, echo);
	await renameSecondSave(input);
	await renameRescan(echo, first);
	postRenameResult(postedEdits()[1]);
	await tick();
}

function rawRangeAt(model: PreviewModel, line: number): { start: number; end: number } {
	const text = model.getLineContent(line);
	return { start: text.indexOf('"') + 2, end: text.lastIndexOf('"') + 1 };
}

function replaceRaw(editor: PreviewEditorHandle, model: PreviewModel, line: number): void {
	const range = rawRangeAt(model, line);
	editor.setSelection({
		startLineNumber: line,
		startColumn: range.start,
		endLineNumber: line,
		endColumn: range.end
	});
}

/**
 * Direct-editor delete scenario: type, backspace, word-delete, select-and-replace,
 * clear and retype in the textual value. Everything stays local until Ctrl+S.
 */
async function applyDeleteEdit(): Promise<void> {
	if (payload.deleteEdit !== true) {
		return;
	}
	const target = editTarget('Text = ');
	if (target === undefined) {
		return;
	}
	const { editor, model, line } = target;
	editor.focus();
	placeAtRawEnd(line);
	typeAll(editor, 'XYZ');
	editor.trigger('preview', 'deleteLeft', {});
	editor.trigger('preview', 'deleteWordLeft', {});
	typeAll(editor, 'new');
	await tick();
	replaceRaw(editor, model, line);
	editor.trigger('preview', 'type', { text: 'Q' });
	await tick();
	replaceRaw(editor, model, line);
	editor.trigger('preview', 'deleteLeft', {});
	await tick();
	editor.trigger('preview', 'type', { text: 'R' });
	await tick();
}

function previewEditor(): PreviewEditorHandle | undefined {
	return (window as unknown as { __ARXML_EDITOR__?: PreviewEditorHandle }).__ARXML_EDITOR__;
}

function currentModel(): PreviewModel | undefined {
	return previewEditor()?.getModel() ?? undefined;
}

function lineNumberIn(model: PreviewModel, prefix: string): number {
	for (let line = 1; line <= model.getLineCount(); line += 1) {
		if (model.getLineContent(line).includes(prefix)) {
			return line;
		}
	}
	return 0;
}

function modelLine(prefix: string): { model: PreviewModel; line: number } | undefined {
	const model = currentModel();
	if (model === undefined) {
		return undefined;
	}
	const line = lineNumberIn(model, prefix);
	return line === 0 ? undefined : { model, line };
}

/** The editor, model and first line containing `prefix`, when all exist. */
function editTarget(prefix: string): EditTarget | undefined {
	const editor = previewEditor();
	const at = modelLine(prefix);
	if (editor === undefined || at === undefined) {
		return undefined;
	}
	return { editor, model: at.model, line: at.line };
}

/** Caret at the end of the raw field text, before a closing syntax quote. */
function placeAtRawEnd(line: number): void {
	const editor = previewEditor();
	const model = currentModel();
	if (editor === undefined || model === undefined) {
		return;
	}
	editor.setPosition({ lineNumber: line, column: rawEndColumn(model.getLineContent(line)) });
}

function rawEndColumn(text: string): number {
	const close = text.lastIndexOf('"');
	return close < 0 ? text.length + 1 : close + 1;
}

function dispatchCtrlS(): void {
	document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
}

function editsToValues(edits: Array<{ nodeId?: string; value?: string }>): Map<string, string> {
	const values = new Map<string, string>();
	for (const edit of edits) {
		const nodeId = editNodeId(edit);
		if (nodeId !== undefined) {
			values.set(nodeId, editValue(edit));
		}
	}
	return values;
}

function revalueRow(row: PreviewRow, values: Map<string, string>): PreviewRow {
	const value = row.id === undefined ? undefined : values.get(row.id);
	if (value === undefined) {
		return row;
	}
	return { ...row, value, shownValue: row.valueKind === 'textual' ? `"${value}"` : value };
}

/** The host's re-scan after accepted edits: both rows carry their new values. */
function echoAcceptedEdits(
	edits: Array<{ nodeId?: string; value?: string }>,
	revision: number
): void {
	const documentPayload = messageDocument();
	const rows = documentRows();
	if (documentPayload === undefined || rows === undefined) {
		return;
	}
	const values = editsToValues(edits);
	const revalued = rows.map((row) => revalueRow(row, values));
	window.postMessage(
		{ type: 'document', document: { ...documentPayload, rows: revalued, revision, dirty: true } },
		'*'
	);
}

/**
 * Edit the decimal and textual values, press Ctrl+S once, acknowledge both edits,
 * and deliver the host's re-scan. Two host edits, then one save, both values shown.
 */
async function applyMultiSave(): Promise<void> {
	if (payload.multiSave !== true) {
		return;
	}
	const decimal = editTarget('Decimal = ');
	const text = editTarget('Text = ');
	if (decimal === undefined || text === undefined) {
		return;
	}
	decimal.editor.focus();
	decimal.editor.setPosition({
		lineNumber: decimal.line,
		column: decimal.model.getLineContent(decimal.line).length + 1
	});
	decimal.editor.trigger('preview', 'type', { text: '7' });
	placeAtRawEnd(text.line);
	text.editor.trigger('preview', 'type', { text: '!' });
	await tick();
	dispatchCtrlS();
	await tick();
	const edits = postedEdits();
	await acknowledgeEdits(edits);
	echoAcceptedEdits(edits, edits.length + 1);
	await tick();
}

function pasteEvent(): Event {
	const paste = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(paste, 'clipboardData', {
		value: { getData: (type: string) => (type === 'text/plain' ? '\nsecond' : '') }
	});
	return paste;
}

function dispatchPaste(paste: Event): void {
	const area = document.querySelector('#tree .monaco-editor textarea');
	const target = area ?? document.getElementById('tree');
	target?.dispatchEvent(paste);
}

/**
 * A pasted newline is inserted as one escaped single line. A real clipboard is not
 * available headlessly, so the event carries a `clipboardData`-shaped payload; the
 * page's capture-phase guard reads only `getData`.
 */
async function applyPasteEdit(): Promise<void> {
	if (payload.pasteEdit !== true) {
		return;
	}
	const target = editTarget('Text = ');
	if (target === undefined) {
		return;
	}
	target.editor.focus();
	placeAtRawEnd(target.line);
	await tick();
	dispatchPaste(pasteEvent());
	await tick();
}

function postStaleRescan(): void {
	const documentPayload = messageDocument();
	const rows = documentRows();
	if (documentPayload === undefined || rows === undefined) {
		return;
	}
	// Another client removed the edited parameter; the host re-scan no longer has it.
	const remaining = rows.filter((row) => row.label !== 'Text');
	const selectedId = remaining.find((row) => row.kind === 'container')?.id;
	window.postMessage(
		{ type: 'document', document: { ...documentPayload, rows: remaining, selectedId, revision: 2, dirty: true } },
		'*'
	);
}

/**
 * A draft whose row disappears from the re-scan must block Ctrl+S: the page keeps
 * the draft, says the node is gone and posts no save.
 */
async function applyStaleSave(): Promise<void> {
	if (payload.staleSave !== true) {
		return;
	}
	const target = editTarget('Text = ');
	if (target === undefined) {
		return;
	}
	target.editor.focus();
	placeAtRawEnd(target.line);
	target.editor.trigger('preview', 'type', { text: '!' });
	await tick();
	postStaleRescan();
	await tick();
	dispatchCtrlS();
	await tick();
}

async function applyScroll(): Promise<void> {
	const line = payload.scrollLine;
	if (line === undefined || line <= 0) {
		return;
	}
	revealLine(line);
	// Sticky scroll builds through a 300ms debounce plus the folding model; give
	// it room before the screenshot and audit read the widget.
	await delay(1200);
}

function revealLine(line: number): void {
	const editor = previewEditor();
	if (editor === undefined) {
		return;
	}
	const count = editor.getModel()?.getLineCount();
	if (count === undefined) {
		return;
	}
	editor.revealLineInCenter(Math.min(line, count));
}

function pageRoot(page: 'diff' | 'editor'): string {
	return page === 'diff' ? '.monaco-diff-editor' : '#tree .monaco-editor';
}

async function waitForDiffRender(): Promise<void> {
	await waitFor(
		() =>
			document.querySelector(
				'.monaco-diff-editor .line-insert, .monaco-diff-editor .line-delete, .monaco-diff-editor .char-insert, .monaco-diff-editor .char-delete'
			) !== null
	);
}

async function waitForMergeArrows(): Promise<void> {
	await waitFor(
		() =>
			document.querySelector('.monaco-diff-editor .gutter') !== null ||
			document.querySelector('.monaco-diff-editor .gutterItem') !== null
	);
}interface GutterAvailabilitySnapshot {
	hasItem: boolean;
	hasService: boolean;
	mapping: unknown;
	values: { left: boolean; right: boolean } | null;
	buttons: number;
}

interface GutterProbe {
	present: boolean;
	width: number;
	items: number;
	itemActions: string[][];
	buttons: string[];
	sash: boolean;
	mergeActive: boolean;
	itemDisplay: string;
	currentShowAlways: boolean;
	currentActions: string[];
	clicked: string | null;
	copy: { side?: string; key?: string } | null;
	overflowLabels: string[] | null;
	overflowDebug: string[];
	availability: GutterAvailabilitySnapshot[];
}

function gutterButtonLabel(button: Element): string {
	return (
		button.getAttribute('aria-label') ??
		button.getAttribute('title') ??
		button.textContent?.trim() ??
		button.className
	);
}

function itemActions(item: Element): string[] {
	return Array.from(item.querySelectorAll('.action-label')).map(gutterButtonLabel);
}

async function probeGutter(): Promise<void> {
	if (payload.page !== 'diff') {
		return;
	}
	await waitFor(() => document.querySelector('.monaco-diff-editor .gutterItem') !== null);
	await delay(250);
	const diff = (
		window as unknown as {
			__ARXML_DIFF_EDITOR__?: {
				getLineChanges?(): Array<{
					originalStartLineNumber: number;
					modifiedStartLineNumber: number;
				}> | null;
				getOriginalEditor(): { setPosition(position: { lineNumber: number; column: number }): void };
				getModifiedEditor(): { setPosition(position: { lineNumber: number; column: number }): void };
			};
		}
	).__ARXML_DIFF_EDITOR__;
	const firstChange = diff?.getLineChanges?.()?.[0];
	if (diff !== undefined && firstChange !== undefined) {
		diff.getOriginalEditor().setPosition({
			lineNumber: Math.max(1, firstChange.originalStartLineNumber),
			column: 1
		});
		diff.getModifiedEditor().setPosition({
			lineNumber: Math.max(1, firstChange.modifiedStartLineNumber),
			column: 1
		});
		await delay(200);
	}
	const gutter = document.querySelector<HTMLElement>('.monaco-diff-editor .gutter');
	const items = Array.from(document.querySelectorAll<HTMLElement>('.monaco-diff-editor .gutterItem'));
	const buttons = Array.from(document.querySelectorAll<HTMLElement>('.monaco-diff-editor .gutterItem .action-label'));
	const messages = window.__PREVIEW_MESSAGES__ as Array<{ type?: string; side?: string; key?: string }>;
	const before = messages.length;
	const mergeActive = document.getElementById('diff-monaco')?.getAttribute('data-merge') === 'true';
	const clicked = buttons[0] === undefined ? null : gutterButtonLabel(buttons[0]);
	const current = items[0];
	const currentActions = current === undefined ? [] : itemActions(current);
	let overflowLabels: string[] | null = null;
	let overflowDebug: string[] = [];
	if (mergeActive && clicked === 'More Actions...') {
		buttons[0]?.dispatchEvent(
			new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window })
		);
		buttons[0]?.click();
		await delay(400);
		const menuRoots = Array.from(
			document.querySelectorAll<HTMLElement>(
				'.monaco-menu, .context-view, [role="menu"], .monaco-menu-container'
			)
		);
		const menuButtons = menuRoots.flatMap((root) =>
			Array.from(root.querySelectorAll<HTMLElement>('.action-label, [role="menuitem"], .action-item'))
		);
		overflowLabels = Array.from(
			new Set(menuButtons.map(gutterButtonLabel).filter((label) => label.length > 0))
		);
		overflowDebug = menuRoots.slice(0, 5).map((root) => {
			const text = root.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? '';
			return `${root.tagName}.${root.className}: ${text}`;
		});
		const copyButton = menuButtons.find((button) =>
			/^Copy Block to (Left|Right)$/.test(gutterButtonLabel(button))
		);
		copyButton?.click();
		await tick();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
	} else if (mergeActive) {
		buttons[0]?.click();
		await tick();
	}
	const copy = messages.slice(before).find((message) => message.type === 'copy');
	(window as unknown as { __GUTTER_PROBE__?: GutterProbe }).__GUTTER_PROBE__ = {
		present: gutter !== null,
		width: gutter === null ? 0 : Math.round(gutter.getBoundingClientRect().width),
		items: items.length,
		itemActions: items.map(itemActions),
		buttons: buttons.map(gutterButtonLabel),
		sash: document.querySelector('.monaco-diff-editor .monaco-sash.vertical') !== null,
		mergeActive,
		itemDisplay: current === undefined ? '' : getComputedStyle(current).display,
		currentShowAlways: current?.classList.contains('showAlways') === true,
		currentActions,
		clicked,
		copy: copy === undefined ? null : { side: copy.side, key: copy.key },
		overflowLabels,
		overflowDebug,
		availability: (window as unknown as { __ARXML_GUTTER_PROBE__?: GutterAvailabilitySnapshot[] })
			.__ARXML_GUTTER_PROBE__ ?? []
	};
}

interface FoldingProbe {
	originalBefore: number;
	originalCollapsed: number;
	originalExpanded: number;
	modifiedBefore: number;
	modifiedCollapsed: number;
	modifiedExpanded: number;
	chevrons: number;
}

interface PreviewVisibleRange {
	startLineNumber: number;
	endLineNumber: number;
}

interface PreviewFoldEditor {
	getVisibleRanges(): PreviewVisibleRange[];
}

async function probeFolding(): Promise<void> {
	if (payload.page !== 'diff') {
		return;
	}
	const editor = (
		window as unknown as {
			__ARXML_DIFF_EDITOR__?: {
				getOriginalEditor(): PreviewFoldEditor;
				getModifiedEditor(): PreviewFoldEditor;
			};
		}
	).__ARXML_DIFF_EDITOR__;
	if (editor === undefined) {
		return;
	}
	const countVisible = (target: PreviewFoldEditor): number =>
		target.getVisibleRanges().reduce(
			(total, range) => total + range.endLineNumber - range.startLineNumber + 1,
			0
		);
	const original = editor.getOriginalEditor();
	const modified = editor.getModifiedEditor();
	const originalBefore = countVisible(original);
	const modifiedBefore = countVisible(modified);
	click('diff-collapse-all');
	await delay(250);
	const originalCollapsed = countVisible(original);
	const modifiedCollapsed = countVisible(modified);
	const chevrons = document.querySelectorAll(
		'.monaco-diff-editor .codicon-folding-collapsed, .monaco-diff-editor .codicon-folding-expanded'
	).length;
	click('diff-expand-all');
	await delay(250);
	const originalExpanded = countVisible(original);
	const modifiedExpanded = countVisible(modified);
	(window as unknown as { __FOLDING_PROBE__?: FoldingProbe }).__FOLDING_PROBE__ = {
		originalBefore,
		originalCollapsed,
		originalExpanded,
		modifiedBefore,
		modifiedCollapsed,
		modifiedExpanded,
		chevrons
	};
}

interface PreviewLayoutInfo {
	width: number;
	height: number;
}

interface PreviewSashEditor {
	getLayoutInfo(): PreviewLayoutInfo;
}

interface PreviewSashDiffEditor {
	getOriginalEditor(): PreviewSashEditor;
	getModifiedEditor(): PreviewSashEditor;
}

interface SashProbe {
	present: boolean;
	gutterWidth: number;
	initial: [number, number];
	dragged: [number, number];
	afterDocument: [number, number];
	afterSwap: [number, number] | null;
	reset: [number, number] | null;
}

function paneWidths(editor: PreviewSashDiffEditor): [number, number] {
	return [
		Math.round(editor.getOriginalEditor().getLayoutInfo().width),
		Math.round(editor.getModifiedEditor().getLayoutInfo().width)
	];
}

function previewSashEditor(): PreviewSashDiffEditor | undefined {
	return (window as unknown as { __ARXML_DIFF_EDITOR__?: PreviewSashDiffEditor }).__ARXML_DIFF_EDITOR__;
}

function dragSash(sash: HTMLElement, deltaX: number): void {
	const rect = sash.getBoundingClientRect();
	const clientX = rect.left + rect.width / 2;
	const clientY = rect.top + Math.min(rect.height / 2, 60);
	sash.dispatchEvent(
		new MouseEvent('mousedown', {
			bubbles: true,
			cancelable: true,
			clientX,
			clientY,
			button: 0,
			buttons: 1,
			view: window
		})
	);
	window.dispatchEvent(
		new MouseEvent('mousemove', {
			bubbles: true,
			cancelable: true,
			clientX: clientX + deltaX,
			clientY,
			button: 0,
			buttons: 1,
			view: window
		})
	);
	window.dispatchEvent(
		new MouseEvent('mouseup', {
			bubbles: true,
			cancelable: true,
			clientX: clientX + deltaX,
			clientY,
			button: 0,
			buttons: 0,
			view: window
		})
	);
}

async function probeSash(): Promise<void> {
	if (payload.page !== 'diff' || !payload.sash) {
		return;
	}
	await delay(250);
	const editor = previewSashEditor();
	const sash = document.querySelector<HTMLElement>('.monaco-diff-editor .monaco-sash.vertical');
	const gutterWidth = Math.round(
		document.querySelector('.monaco-diff-editor .gutter')?.getBoundingClientRect().width ?? 0
	);
	if (editor === undefined || sash === null) {
		(window as unknown as { __SASH_PROBE__?: SashProbe }).__SASH_PROBE__ = {
			present: sash !== null,
			gutterWidth,
			initial: [0, 0],
			dragged: [0, 0],
			afterDocument: [0, 0],
			afterSwap: null,
			reset: null
		};
		return;
	}
	const initial = paneWidths(editor);
	dragSash(sash, 140);
	await delay(350);
	const dragged = paneWidths(editor);
	window.postMessage(payload.message, '*');
	await delay(350);
	const afterDocument = paneWidths(editor);
	(window as unknown as { __SASH_PROBE__?: SashProbe }).__SASH_PROBE__ = {
		present: true,
		gutterWidth,
		initial,
		dragged,
		afterDocument,
		afterSwap: null,
		reset: null
	};
}

async function probeSashAfterSwap(): Promise<void> {
	if (payload.page !== 'diff' || !payload.sash) {
		return;
	}
	const editor = previewSashEditor();
	const sash = document.querySelector<HTMLElement>('.monaco-diff-editor .monaco-sash.vertical');
	const probe = (window as unknown as { __SASH_PROBE__?: SashProbe }).__SASH_PROBE__;
	if (editor === undefined || sash === null || probe === undefined) {
		return;
	}
	probe.afterSwap = paneWidths(editor);
	sash.dispatchEvent(
		new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 0, clientY: 0, view: window })
	);
	await delay(350);
	probe.reset = paneWidths(editor);
}

async function run(): Promise<void> {
	window.postMessage(payload.message, '*');
	await until(() => document.querySelector(pageRoot(payload.page)) !== null);
	if (payload.page === 'diff') {
		await waitForDiffRender();
	}
	await applyMerge();
	if (payload.page === 'diff') {
		await waitForMergeArrows();
		await probeFolding();
		await probeSash();
	}
	await applySwap();
	if (payload.page === 'diff') {
		await probeGutter();
		await probeSashAfterSwap();
	}
	await applyPan();
	await applyJumps();
	await applySelect();
	await applyFind();
	await applyDirtyEdit();
	await applyDetailsEdit();
	await applyDetailsRename();
	await applyDeleteEdit();
	await applyMultiSave();
	await applyPasteEdit();
	await applyStaleSave();
	await applyScroll();
	await settle();
	document.body.dataset.previewReady = 'true';
	publishAudit();
}

void run();
