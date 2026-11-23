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
import '../../webview/diffMonaco';
import '../../webview/editorMonaco';
import { paneSnapshot, previewAudit } from './previewAudit';
import type { PaneSnapshot } from './previewAudit';

interface PreviewPayload {
	state: string;
	page: 'diff' | 'editor';
	message: unknown;
	merge?: boolean;
	swap?: boolean;
	wide?: boolean;
	pan?: number;
	jump?: number;
	select?: boolean;
	find?: string;
	edit?: string;
	detailsEdit?: string;
	detailsSave?: boolean;
	detailsUndo?: boolean;
	detailsRedo?: boolean;
	deleteEdit?: boolean;
	detailsRename?: boolean;
	renameRefusal?: boolean;
	renameLateAck?: boolean;
	renameDocument?: { rows: PreviewRow[]; selectedId?: string };
	multiSave?: boolean;
	pasteEdit?: boolean;
	staleSave?: boolean;
	scrollLine?: number;
	trySave?: boolean;
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

declare global {
	interface Window {
		__PREVIEW__: PreviewPayload;
		__PREVIEW_MESSAGES__: unknown[];
	}
}

const payload = window.__PREVIEW__;
let swapBefore: PaneSnapshot | undefined;

function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A short timer lets the resize observer and the final layout settle. */
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 200));
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
	const pane = document.getElementById('diff-pane-left');
	if (!pane) {
		return;
	}
	pane.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'F7', bubbles: true, cancelable: true })
	);
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
	return document.querySelector('#diff-pane-left .diff-row[data-status="changed"]') as HTMLElement | null;
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

function rowMatches(row: PreviewRow, query: string): PreviewFindMatch[] {
	const out: PreviewFindMatch[] = [];
	const label = findOccurrence(query, row.label);
	if (label !== undefined && row.id !== undefined) {
		out.push({ rowId: row.id, field: 'label', ...label });
	}
	const value = findOccurrence(query, row.value);
	if (value !== undefined && row.id !== undefined) {
		out.push({ rowId: row.id, field: 'value', replaceable: true, ...value });
	}
	for (let part = 0; part < (row.meta?.length ?? 0); part += 1) {
		const found = findOccurrence(query, row.meta?.[part]?.text);
		if (found !== undefined && row.id !== undefined) {
			out.push({ rowId: row.id, field: 'meta', part, ...found });
		}
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
	const push = (field: PreviewFindMatch['field'], found: { start: number; end: number } | undefined, part?: number): void => {
		if (found !== undefined) {
			out.push({ key: row.key, side, field, ...(part !== undefined ? { part } : {}), ...found });
		}
	};
	push('label', findOccurrence(query, cell.label));
	push('value', findOccurrence(query, cell.shownValue ?? cell.value));
	for (let part = 0; part < (cell.meta?.length ?? 0); part += 1) {
		push('meta', findOccurrence(query, cell.meta?.[part]?.text), part);
	}
	return out;
}

function previewFindResult(
	page: 'diff' | 'editor',
	query: string
): { matches: PreviewFindMatch[]; total: number; limited: boolean } {
	const document = (payload.message as { document?: { rows?: PreviewRow[] } }).document;
	const rows = document?.rows ?? [];
	const matches: PreviewFindMatch[] = [];
	for (const row of rows) {
		if (page === 'editor') {
			matches.push(...rowMatches(row, query));
			continue;
		}
		matches.push(...cellMatches(row, row.left, 'left', query));
		matches.push(...cellMatches(row, row.right, 'right', query));
	}
	return { matches, total: matches.length, limited: false };
}

async function applyFind(): Promise<void> {
	const query = payload.find;
	if (query === undefined || query === '') {
		return;
	}
	const previewWindow = window as unknown as {
		__ARXML_EDITOR__?: { trigger(source: string, id: string, args: unknown): void };
		__ARXML_DIFF_EDITOR__?: { getModifiedEditor(): { trigger(source: string, id: string, args: unknown): void } };
	};
	if (payload.page === 'editor') {
		previewWindow.__ARXML_EDITOR__?.trigger('preview', 'actions.find', null);
	} else {
		previewWindow.__ARXML_DIFF_EDITOR__?.getModifiedEditor().trigger('preview', 'actions.find', null);
	}
	await tick();
	const root = payload.page === 'editor' ? '#tree' : '.modified-in-monaco-diff-editor';
	const input = document.querySelector(`${root} .find-widget textarea.input`) as HTMLTextAreaElement | null;
	if (input === null) {
		return;
	}
	input.focus();
	input.value = query;
	input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: query }));
	await tick();
	const messages = window.__PREVIEW_MESSAGES__ as Array<{ type?: string; query?: string; requestId?: number }>;
	const request = [...messages]
		.reverse()
		.find((message) => message.type === 'find' && message.query === query);
	if (request?.requestId === undefined) {
		return;
	}
	window.postMessage(
		{ type: 'findResult', requestId: request.requestId, result: previewFindResult(payload.page, query) },
		'*'
	);
	await tick();
	const next = document.querySelector(`${root} .find-widget [aria-label^="Next Match"]`) as HTMLElement | null;
	next?.click();
	await tick();
	(input as HTMLTextAreaElement | null)?.focus();
}

async function applyDirtyEdit(): Promise<void> {
	const edit = payload.edit;
	if (edit === undefined || edit === '') {
		return;
	}
	const editor = (window as unknown as {
		__ARXML_EDITOR__?: {
			focus(): void;
			getModel(): { getLineCount(): number; getLineContent(line: number): string } | null;
			setPosition(position: { lineNumber: number; column: number }): void;
			trigger(source: string, id: string, args: unknown): void;
		};
	}).__ARXML_EDITOR__;
	const model = editor?.getModel();
	if (editor === undefined || model === null || model === undefined) {
		return;
	}
	let line = 0;
	for (let at = 1; at <= model.getLineCount(); at += 1) {
		if (model.getLineContent(at).includes('P0000 = ')) {
			line = at;
			break;
		}
	}
	if (line === 0) {
		return;
	}
	editor.focus();
	editor.setPosition({ lineNumber: line, column: model.getLineContent(line).length + 1 });
	for (const character of edit) {
		editor.trigger('preview', 'type', { text: character });
		await new Promise((resolve) => setTimeout(resolve, 40));
	}
	await new Promise((resolve) => setTimeout(resolve, 250));
	if (payload.trySave === true) {
		document.dispatchEvent(
			new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

/**
 * Types into the Details value control of the selected textual parameter. The
 * draft stays local: no host edit may be posted before Ctrl+S.
 */
async function applyDetailsEdit(): Promise<void> {
	const text = payload.detailsEdit;
	if (text === undefined || text === '') {
		return;
	}
	await tick();
	const input = document.getElementById('details-value') as HTMLInputElement | null;
	if (input === null || typeof input.setSelectionRange !== 'function') {
		return;
	}
	input.focus();
	input.setSelectionRange(input.value.length, input.value.length);
	for (const character of text) {
		const start = input.selectionStart ?? input.value.length;
		const end = input.selectionEnd ?? start;
		input.value = input.value.slice(0, start) + character + input.value.slice(end);
		input.setSelectionRange(start + character.length, start + character.length);
		input.dispatchEvent(
			new InputEvent('input', { bubbles: true, inputType: 'insertText', data: character })
		);
		await tick();
	}
	if (payload.detailsUndo === true) {
		// The registered Undo/Redo actions route a local draft to the model stack.
		const editor = (window as unknown as {
			__ARXML_EDITOR__?: { trigger(source: string, id: string, args: unknown): void };
		}).__ARXML_EDITOR__;
		editor?.trigger('api', 'undo', null);
		await tick();
		if (payload.detailsRedo === true) {
			editor?.trigger('api', 'redo', null);
			await tick();
		}
		return;
	}
	if (payload.detailsSave !== true) {
		return;
	}
	document.dispatchEvent(
		new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
	);
	await tick();
	const messages = window.__PREVIEW_MESSAGES__ as Array<{ type?: string; editId?: number; nodeId?: string; value?: string }>;
	const edits = messages.filter((message) => message.type === 'edit');
	for (let index = 0; index < edits.length; index += 1) {
		window.postMessage({ type: 'editResult', editId: edits[index].editId, ok: true, revision: index + 1 }, '*');
	}
	await tick();
	echoAcceptedValue(edits[0], edits.length + 1);
	await tick();
}

/** The re-scan after an accepted edit: the host posts the row with its new value. */
function echoAcceptedValue(edit: { nodeId?: string; value?: string } | undefined, revision: number): void {
	const message = payload.message as { document?: Record<string, unknown> & { rows?: PreviewRow[] } } | undefined;
	const document = message?.document;
	if (document === undefined || !Array.isArray(document.rows) || typeof edit?.nodeId !== 'string') {
		return;
	}
	const value = typeof edit.value === 'string' ? edit.value : '';
	const rows = document.rows.map((row) =>
		row.id === edit.nodeId ? { ...row, value, shownValue: `"${value}"` } : row
	);
	window.postMessage({ type: 'document', document: { ...document, rows, revision, dirty: true } }, '*');
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
	const input = document.getElementById('details-short-name') as HTMLInputElement | null;
	if (input === null || typeof input.setSelectionRange !== 'function') {
		return;
	}
	const type = (text: string): void => {
		const start = input.selectionStart ?? input.value.length;
		input.value = input.value.slice(0, start) + text + input.value.slice(start);
		input.setSelectionRange(start + text.length, start + text.length);
		input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
	};
	input.focus();
	input.setSelectionRange(input.value.length, input.value.length);
	type('2');
	await tick();
	// First Ctrl+S: one rename edit.
	dispatchCtrlS();
	await tick();
	const messages = window.__PREVIEW_MESSAGES__ as Array<{ type?: string; editId?: number }>;
	const first = messages.find((message) => message.type === 'edit');
	const acknowledgeRename = (): void => {
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
	};
	// The host normally answers before its re-scan; the late-ack state reverses that
	// to prove the page keeps the caret across a document-first rebuild.
	if (payload.renameLateAck !== true) {
		acknowledgeRename();
		await tick();
	}
	// The new id has not arrived yet. Keep typing and save again: this draft must
	// wait for the re-scan instead of being sent at the pre-rename id.
	input.focus();
	input.setSelectionRange(input.value.length, input.value.length);
	type('3');
	await tick();
	dispatchCtrlS();
	await tick();
	window.postMessage({ type: 'document', document: { ...echo, revision: 2, dirty: true } }, '*');
	await tick();
	if (payload.renameLateAck === true) {
		acknowledgeRename();
		await tick();
	}
	const edits = (window.__PREVIEW_MESSAGES__ as Array<{ type?: string; editId?: number }>).filter(
		(message) => message.type === 'edit'
	);
	const second = edits[1];
	if (second?.editId !== undefined) {
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
		} else {
			window.postMessage({ type: 'editResult', editId: second.editId, ok: true, revision: 3 }, '*');
		}
	}
	await tick();
}

/**
 * Direct-editor delete scenario: type, backspace, word-delete, select-and-replace,
 * clear and retype in the textual value. Everything stays local until Ctrl+S.
 */
async function applyDeleteEdit(): Promise<void> {
	if (payload.deleteEdit !== true) {
		return;
	}
	const editor = (window as unknown as {
		__ARXML_EDITOR__?: {
			focus(): void;
			getModel(): { getLineCount(): number; getLineContent(line: number): string } | null;
			setPosition(position: { lineNumber: number; column: number }): void;
			setSelection(selection: {
				startLineNumber: number;
				startColumn: number;
				endLineNumber: number;
				endColumn: number;
			}): void;
			trigger(source: string, id: string, args: unknown): void;
		};
	}).__ARXML_EDITOR__;
	const model = editor?.getModel();
	if (editor === undefined || model === null || model === undefined) {
		return;
	}
	let line = 0;
	for (let at = 1; at <= model.getLineCount(); at += 1) {
		if (model.getLineContent(at).includes('Text = ')) {
			line = at;
			break;
		}
	}
	if (line === 0) {
		return;
	}
	const rawRange = (): { start: number; end: number } => {
		const text = model.getLineContent(line);
		const open = text.indexOf('"');
		const close = text.lastIndexOf('"');
		return { start: open + 2, end: close + 1 };
	};
	const placeAtEnd = (): void => {
		const range = rawRange();
		editor.setPosition({ lineNumber: line, column: range.end });
	};
	const replaceRaw = (): void => {
		const range = rawRange();
		editor.setSelection({
			startLineNumber: line,
			startColumn: range.start,
			endLineNumber: line,
			endColumn: range.end
		});
	};
	editor.focus();
	placeAtEnd();
	for (const character of 'XYZ') {
		editor.trigger('preview', 'type', { text: character });
	}
	editor.trigger('preview', 'deleteLeft', {});
	editor.trigger('preview', 'deleteWordLeft', {});
	for (const character of 'new') {
		editor.trigger('preview', 'type', { text: character });
	}
	await tick();
	replaceRaw();
	editor.trigger('preview', 'type', { text: 'Q' });
	await tick();
	replaceRaw();
	editor.trigger('preview', 'deleteLeft', {});
	await tick();
	editor.trigger('preview', 'type', { text: 'R' });
	await tick();
}

interface PreviewEditorHandle {
	focus(): void;
	getModel(): { getLineCount(): number; getLineContent(line: number): string } | null;
	setPosition(position: { lineNumber: number; column: number }): void;
	setSelection(selection: {
		startLineNumber: number;
		startColumn: number;
		endLineNumber: number;
		endColumn: number;
	}): void;
	trigger(source: string, id: string, args: unknown): void;
}

function previewEditor(): PreviewEditorHandle | undefined {
	return (window as unknown as { __ARXML_EDITOR__?: PreviewEditorHandle }).__ARXML_EDITOR__;
}

function modelLineStartingWith(prefix: string): number {
	const model = previewEditor()?.getModel();
	if (model === null || model === undefined) {
		return 0;
	}
	for (let line = 1; line <= model.getLineCount(); line += 1) {
		if (model.getLineContent(line).includes(prefix)) {
			return line;
		}
	}
	return 0;
}

/** Caret at the end of the raw field text, before a closing syntax quote. */
function placeAtRawEnd(line: number): void {
	const editor = previewEditor();
	const model = editor?.getModel();
	if (editor === undefined || model === null || model === undefined) {
		return;
	}
	const text = model.getLineContent(line);
	const close = text.lastIndexOf('"');
	editor.setPosition({ lineNumber: line, column: close < 0 ? text.length + 1 : close + 1 });
}

function dispatchCtrlS(): void {
	document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
}

/** The host's re-scan after accepted edits: both rows carry their new values. */
function echoAcceptedEdits(
	edits: Array<{ nodeId?: string; value?: string }>,
	revision: number
): void {
	const message = payload.message as { document?: Record<string, unknown> & { rows?: PreviewRow[] } } | undefined;
	const documentPayload = message?.document;
	if (documentPayload === undefined || !Array.isArray(documentPayload.rows)) {
		return;
	}
	const values = new Map<string, string>();
	for (const edit of edits) {
		if (typeof edit.nodeId === 'string') {
			values.set(edit.nodeId, typeof edit.value === 'string' ? edit.value : '');
		}
	}
	const rows = documentPayload.rows.map((row) => {
		const value = row.id === undefined ? undefined : values.get(row.id);
		if (value === undefined) {
			return row;
		}
		return { ...row, value, shownValue: row.valueKind === 'textual' ? `"${value}"` : value };
	});
	window.postMessage({ type: 'document', document: { ...documentPayload, rows, revision, dirty: true } }, '*');
}

/**
 * Edit the decimal and textual values, press Ctrl+S once, acknowledge both edits,
 * and deliver the host's re-scan. Two host edits, then one save, both values shown.
 */
async function applyMultiSave(): Promise<void> {
	if (payload.multiSave !== true) {
		return;
	}
	const editor = previewEditor();
	const model = editor?.getModel();
	if (editor === undefined || model === null || model === undefined) {
		return;
	}
	const decimal = modelLineStartingWith('Decimal = ');
	const text = modelLineStartingWith('Text = ');
	if (decimal === 0 || text === 0) {
		return;
	}
	editor.focus();
	editor.setPosition({ lineNumber: decimal, column: model.getLineContent(decimal).length + 1 });
	editor.trigger('preview', 'type', { text: '7' });
	placeAtRawEnd(text);
	editor.trigger('preview', 'type', { text: '!' });
	await tick();
	dispatchCtrlS();
	await tick();
	const messages = window.__PREVIEW_MESSAGES__ as Array<{
		type?: string;
		editId?: number;
		nodeId?: string;
		value?: string;
	}>;
	const edits = messages.filter((message) => message.type === 'edit');
	for (let index = 0; index < edits.length; index += 1) {
		window.postMessage({ type: 'editResult', editId: edits[index].editId, ok: true, revision: index + 1 }, '*');
	}
	await tick();
	echoAcceptedEdits(edits, edits.length + 1);
	await tick();
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
	const editor = previewEditor();
	const model = editor?.getModel();
	if (editor === undefined || model === null || model === undefined) {
		return;
	}
	const line = modelLineStartingWith('Text = ');
	if (line === 0) {
		return;
	}
	editor.focus();
	placeAtRawEnd(line);
	await tick();
	const paste = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(paste, 'clipboardData', {
		value: { getData: (type: string) => (type === 'text/plain' ? '\nsecond' : '') }
	});
	const target = document.querySelector('#tree .monaco-editor textarea') ?? document.getElementById('tree');
	target?.dispatchEvent(paste);
	await tick();
}

/**
 * A draft whose row disappears from the re-scan must block Ctrl+S: the page keeps
 * the draft, says the node is gone and posts no save.
 */
async function applyStaleSave(): Promise<void> {
	if (payload.staleSave !== true) {
		return;
	}
	const editor = previewEditor();
	const model = editor?.getModel();
	if (editor === undefined || model === null || model === undefined) {
		return;
	}
	const line = modelLineStartingWith('Text = ');
	if (line === 0) {
		return;
	}
	editor.focus();
	placeAtRawEnd(line);
	editor.trigger('preview', 'type', { text: '!' });
	await tick();
	const message = payload.message as { document?: Record<string, unknown> & { rows?: PreviewRow[] } } | undefined;
	const documentPayload = message?.document;
	if (documentPayload === undefined || !Array.isArray(documentPayload.rows)) {
		return;
	}
	// Another client removed the edited parameter; the host re-scan no longer has it.
	const rows = documentPayload.rows.filter((row) => row.label !== 'Text');
	const selectedId = rows.find((row) => row.kind === 'container')?.id;
	window.postMessage(
		{ type: 'document', document: { ...documentPayload, rows, selectedId, revision: 2, dirty: true } },
		'*'
	);
	await tick();
	dispatchCtrlS();
	await tick();
}

async function applyScroll(): Promise<void> {
	const line = payload.scrollLine;
	if (line === undefined || line <= 0) {
		return;
	}
	const editor = (window as unknown as {
		__ARXML_EDITOR__?: {
			revealLineInCenter(line: number): void;
			getModel(): { getLineCount(): number } | null;
		};
	}).__ARXML_EDITOR__;
	const model = editor?.getModel();
	if (editor === undefined || model === null || model === undefined) {
		return;
	}
	editor.revealLineInCenter(Math.min(line, model.getLineCount()));
	// Sticky scroll builds through a 300ms debounce plus the folding model; give
	// it room before the screenshot and audit read the widget.
	await new Promise((resolve) => setTimeout(resolve, 1200));
}

async function run(): Promise<void> {
	window.postMessage(payload.message, '*');
	const root = payload.page === 'diff' ? '.monaco-diff-editor' : '#tree .monaco-editor';
	await until(() => document.querySelector(root) !== null);
	if (payload.page === 'diff') {
		await waitFor(
			() =>
				document.querySelector(
					'.monaco-diff-editor .line-insert, .monaco-diff-editor .line-delete, .monaco-diff-editor .char-insert, .monaco-diff-editor .char-delete'
				) !== null
		);
	}
	await applyMerge();
	if (payload.page === 'diff' && payload.merge) {
		await waitFor(() => document.querySelector('[class*="arxml-merge-arrow"]') !== null);
	}
	await applySwap();
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
