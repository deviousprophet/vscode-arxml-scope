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
	scrollLine?: number;
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
	value?: string;
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
			select: payload.select
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
	await applyScroll();
	await settle();
	document.body.dataset.previewReady = 'true';
	publishAudit();
}

void run();
