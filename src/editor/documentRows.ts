/**
 * The Document row primitives shared by the editor and the semantic diff.
 *
 * The builders are serialized into both webviews with `toString()`, so they may
 * only reference page globals (`appendHighlighted`, `valueSpan`, `metaSpan`,
 * `twistyIcon`) and their own arguments. The shared CSS comes from
 * `documentTreeStyles()` in `documentTreeView.ts`.
 */
declare const document: any;

import type { EcucRow } from './renderRows';
declare const window: any;

export interface DocumentGuide {
	level: number;
	id: string;
}

export interface DocumentRowContext {
	selectedId?: string;
	expandedIds: ReadonlySet<string>;
	searchQuery: string;
	currentId?: string;
	subtreeIds: ReadonlySet<string>;
	gap?: boolean;
	guides?: readonly DocumentGuide[];
}

export function appendDocumentGuides(rowElement: any, guides: readonly DocumentGuide[] | undefined): void {
	for (const segment of guides || []) {
		const guide = document.createElement('span');
		guide.className = 'guide';
		guide.dataset.level = String(segment.level);
		guide.dataset.containerId = segment.id;
		guide.setAttribute('aria-hidden', 'true');
		rowElement.appendChild(guide);
	}
}

export function buildDocumentNodeRow(row: EcucRow, context: DocumentRowContext): any {
	const inlineMeta = row.meta.filter((part) => part.cls !== 'annotation');
	const node = document.createElement('div');
	node.className = inlineMeta.length > 0 ? 'node has-meta' : 'node';
	node.setAttribute('role', 'treeitem');
	node.setAttribute('aria-level', String(row.level));
	node.setAttribute('aria-posinset', String(row.posinset));
	node.setAttribute('aria-setsize', String(row.setsize));
	node.setAttribute('aria-selected', row.id === context.selectedId ? 'true' : 'false');
	if (row.hasChildren) {
		node.setAttribute('aria-expanded', context.expandedIds.has(row.id) ? 'true' : 'false');
	}
	node.tabIndex = -1;
	node.dataset.nodeId = row.id;
	node.dataset.kind = row.kind;
	node.dataset.definitionRef = row.definitionRef;
	node.dataset.shortName = row.shortName || '';
	if (row.kind === 'parameter') {
		node.dataset.value = row.value || '';
	}
	if (row.kind === 'reference') {
		node.dataset.target = row.target || '';
	}
	if (row.id === context.selectedId) {
		node.dataset.selected = 'true';
	}
	if (context.searchQuery.trim() !== '' && row.id === context.currentId) {
		node.dataset.searchCurrent = 'true';
	}
	if (context.subtreeIds.has(row.id) && row.id !== context.selectedId) {
		node.dataset.subtree = 'true';
	}
	if (context.gap) {
		node.dataset.gap = 'true';
	}
	if (row.empty) {
		node.dataset.empty = 'true';
	}
	if (row.disabled) {
		node.dataset.disabled = 'true';
	}
	node.title = row.title;

	const rowElement = document.createElement('span');
	rowElement.className = 'row k-' + row.kind + (row.shownValue !== undefined ? ' has-value' : ' no-value');
	rowElement.dataset.level = String(row.level);
	if (row.hasChildren) {
		rowElement.appendChild(twistySpan());
	}
	const label = document.createElement('span');
	label.className = 'label';
	window.appendHighlighted(label, row.label);
	rowElement.appendChild(label);
	if (row.kind === 'parameter' || row.kind === 'reference') {
		rowElement.appendChild(window.valueSpan(row) as any);
	}
	if (inlineMeta.length > 0) {
		rowElement.appendChild(window.metaSpan({ ...row, meta: inlineMeta }) as any);
	}
	if (row.disabled) {
		const suffix = document.createElement('span');
		suffix.className = 'sr-only';
		suffix.textContent = '(disabled by condition)';
		rowElement.appendChild(suffix);
	}
	appendDocumentGuides(rowElement, context.guides);
	node.appendChild(rowElement);
	return node;
}

function twistySpan(): any {
	const span = document.createElement('span');
	span.className = 'twisty';
	span.setAttribute('aria-hidden', 'true');
	span.appendChild(window.twistyIcon() as any);
	return span;
}

export function buildDocumentBraceRow(
	kind: 'brace-open' | 'brace-close',
	level: number,
	rowId: string,
	context: DocumentRowContext
): any {
	const node = document.createElement('div');
	node.className = 'brace';
	node.setAttribute('aria-hidden', 'true');
	if (context.subtreeIds.has(rowId)) {
		node.dataset.subtree = 'true';
	}
	node.dataset.rowId = rowId;
	const rowElement = document.createElement('span');
	rowElement.className = 'row brace-row';
	rowElement.dataset.level = String(level);
	const mark = document.createElement('span');
	mark.className = 'punct brace-mark';
	mark.textContent = kind === 'brace-open' ? '{' : '}';
	rowElement.appendChild(mark);
	appendDocumentGuides(rowElement, context.guides);
	node.appendChild(rowElement);
	return node;
}

export function buildDocumentCommentRow(
	text: string,
	level: number,
	rowId: string,
	context: DocumentRowContext
): any {
	const node = document.createElement('div');
	node.className = 'comment';
	node.setAttribute('aria-hidden', 'true');
	node.dataset.rowId = rowId;
	if (context.gap) {
		node.dataset.gap = 'true';
	}
	const rowElement = document.createElement('span');
	rowElement.className = 'row comment-row';
	rowElement.dataset.level = String(level);
	rowElement.appendChild(textSpan('span', 'punct comment-mark', '/* '));
	const body = document.createElement('span');
	body.className = 'comment-text';
	window.appendHighlighted(body, text);
	rowElement.appendChild(body);
	rowElement.appendChild(textSpan('span', 'punct comment-mark', ' */'));
	appendDocumentGuides(rowElement, context.guides);
	node.appendChild(rowElement);
	return node;
}

function textSpan(tag: string, className: string, text: string): any {
	const element = document.createElement(tag);
	element.className = className;
	element.textContent = text;
	return element;
}

/** The serialized builders and their private helpers, for a webview page. */
export function documentRowsScript(): string {
	return `${appendDocumentGuides.toString()}${twistySpan.toString()}${textSpan.toString()}${buildDocumentNodeRow.toString()}${buildDocumentBraceRow.toString()}${buildDocumentCommentRow.toString()}`;
}
