/**
 * The Document row primitives shared by the editor and the semantic diff.
 *
 * The builders append real DOM nodes only; model text always travels through
 * `textContent`/`appendHighlighted`, never markup. Both pages import the same
 * definitions, so a label, value or meta chip cannot drift between them.
 */
import type { EcucRow, MetaPart } from '../../../core/ecuc/renderRows';
import type { WordPair, WordSegment } from '../../../core/diff/wordDiff';
import {
	appendHighlighted,
	appendMetaPartText,
	metaSpan,
	twistyIcon,
	valueSpan,
	type MetaPartWriter,
	type PageElement,
} from '../../render/rowView';

export interface DocumentGuide {
	level: number;
	id: string;
}

/** The meta classes a changed row word-diffs, taken from the row model. */
export type DocumentWordDiffMetaClass = Extract<MetaPart['cls'], 'condition' | 'variant' | 'context'>;

/** One pair per chip of each class, in display order; extras stay plain. */
export const WORD_DIFF_META_CLASSES: readonly DocumentWordDiffMetaClass[] = ['condition', 'variant', 'context'];

/**
 * Word-level changes for one changed diff row. Only the fields a changed row
 * displays take part; an added or removed row supplies no word diff and keeps
 * the full-cell tint.
 */
export interface DocumentWordDiff {
	label?: WordPair;
	value?: WordPair;
	meta?: Partial<Record<DocumentWordDiffMetaClass, WordPair[]>>;
}

export interface DocumentRowContext {
	selectedId?: string;
	expandedIds: ReadonlySet<string>;
	searchQuery: string;
	currentId?: string;
	subtreeIds: ReadonlySet<string>;
	guides?: readonly DocumentGuide[];
	wordDiff?: DocumentWordDiff;
	/** The displayed pane; the changed-word colour follows it after a swap. */
	wordSide?: 'left' | 'right';
}

function appendDocumentGuides(rowElement: HTMLElement, guides: readonly DocumentGuide[] | undefined): void {
	for (const segment of guides || []) {
		const guide = document.createElement('span');
		guide.className = 'guide';
		guide.dataset.level = String(segment.level);
		guide.dataset.containerId = segment.id;
		guide.setAttribute('aria-hidden', 'true');
		rowElement.appendChild(guide);
	}
}

export function buildDocumentNodeRow(row: EcucRow, context: DocumentRowContext): HTMLElement {
	const inlineMeta = row.meta.filter((part) => part.cls !== 'annotation');
	const node = document.createElement('div');
	applyNodeIdentity(node, row, inlineMeta, context);
	applyNodeExpansion(node, row, context);
	applyNodeTabIndex(node);
	applyNodeData(node, row);
	applyNodeState(node, row, context);
	applyRowFlags(node, row);
	node.appendChild(buildRowShell(row, context, inlineMeta));
	return node;
}

/** The node's own class and ARIA identity. */
function applyNodeIdentity(
	node: HTMLElement,
	row: EcucRow,
	inlineMeta: readonly MetaPart[],
	context: DocumentRowContext
): void {
	node.className = inlineMeta.length > 0 ? 'node has-meta' : 'node';
	node.setAttribute('role', 'treeitem');
	node.setAttribute('aria-level', String(row.level));
	node.setAttribute('aria-posinset', String(row.posinset));
	node.setAttribute('aria-setsize', String(row.setsize));
	node.setAttribute('aria-selected', row.id === context.selectedId ? 'true' : 'false');
}

function applyNodeExpansion(node: HTMLElement, row: EcucRow, context: DocumentRowContext): void {
	if (row.hasChildren) {
		node.setAttribute('aria-expanded', context.expandedIds.has(row.id) ? 'true' : 'false');
	}
}

/** The roving tab stop: every node joins the tree's own keyboard focus model. */
function applyNodeTabIndex(node: HTMLElement): void {
	node.tabIndex = -1;
}

/** The datasets every node carries, plus the field its kind owns. */
function applyNodeData(node: HTMLElement, row: EcucRow): void {
	node.dataset.nodeId = row.id;
	node.dataset.kind = row.kind;
	node.dataset.definitionRef = row.definitionRef;
	node.dataset.shortName = row.shortName || '';
	writeParameterValue(node, row);
	writeReferenceTarget(node, row);
}

function writeParameterValue(node: HTMLElement, row: EcucRow): void {
	if (row.kind === 'parameter') {
		node.dataset.value = row.value || '';
	}
}

function writeReferenceTarget(node: HTMLElement, row: EcucRow): void {
	if (row.kind === 'reference') {
		node.dataset.target = row.target || '';
	}
}

/** Selection, current search hit and subtree membership. */
function applyNodeState(node: HTMLElement, row: EcucRow, context: DocumentRowContext): void {
	if (row.id === context.selectedId) {
		node.dataset.selected = 'true';
	}
	if (isSearchCurrent(row, context)) {
		node.dataset.searchCurrent = 'true';
	}
	if (isSubtreeRow(row, context)) {
		node.dataset.subtree = 'true';
	}
}

function isSearchCurrent(row: EcucRow, context: DocumentRowContext): boolean {
	return context.searchQuery.trim() !== '' && row.id === context.currentId;
}

function isSubtreeRow(row: EcucRow, context: DocumentRowContext): boolean {
	return context.subtreeIds.has(row.id) && row.id !== context.selectedId;
}

function applyRowFlags(node: HTMLElement, row: EcucRow): void {
	if (row.empty) {
		node.dataset.empty = 'true';
	}
	if (row.disabled) {
		node.dataset.disabled = 'true';
	}
	node.title = row.title;
}

/** The visible row shell: twisty, label, value, meta, disabled suffix and guides. */
function buildRowShell(
	row: EcucRow,
	context: DocumentRowContext,
	inlineMeta: readonly MetaPart[]
): HTMLElement {
	const rowElement = document.createElement('span');
	rowElement.className = 'row k-' + row.kind + (row.shownValue !== undefined ? ' has-value' : ' no-value');
	rowElement.dataset.level = String(row.level);
	if (row.hasChildren) {
		rowElement.appendChild(twistySpan());
	}
	rowElement.appendChild(buildLabel(row, context));
	appendValuePart(rowElement, row, context);
	appendMeta(rowElement, row, context, inlineMeta);
	appendDisabledSuffix(rowElement, row);
	appendDocumentGuides(rowElement, context.guides);
	return rowElement;
}

function buildLabel(row: EcucRow, context: DocumentRowContext): HTMLElement {
	const label = document.createElement('span');
	label.className = 'label';
	if (!appendWordSegments(label, context.wordDiff && context.wordDiff.label, context.wordSide, writePlain)) {
		appendHighlighted(label, row.label);
	}
	return label;
}

function writePlain(target: PageElement, text: string): void {
	appendHighlighted(target, text);
}

function appendValuePart(rowElement: HTMLElement, row: EcucRow, context: DocumentRowContext): void {
	if (!isValueRow(row)) {
		return;
	}
	rowElement.appendChild(
		valueSpan(row, false, undefined, (target, text) => writeValue(target, text, context))
	);
}

function isValueRow(row: EcucRow): boolean {
	return row.kind === 'parameter' || row.kind === 'reference';
}

function writeValue(target: PageElement, text: string, context: DocumentRowContext): void {
	if (!appendWordSegments(target, context.wordDiff && context.wordDiff.value, context.wordSide, writePlain)) {
		appendHighlighted(target, text);
	}
}

function appendMeta(
	rowElement: HTMLElement,
	row: EcucRow,
	context: DocumentRowContext,
	inlineMeta: readonly MetaPart[]
): void {
	if (inlineMeta.length === 0) {
		return;
	}
	const metaIndexes = new Map<string, number>();
	const writePart: MetaPartWriter = (span, part) => writeWordDiffMeta(span, part, context, metaIndexes);
	rowElement.appendChild(metaSpan({ ...row, meta: inlineMeta }, undefined, writePart));
}

function writeWordDiffMeta(
	span: HTMLElement,
	part: { cls: string; text: string },
	context: DocumentRowContext,
	metaIndexes: Map<string, number>
): boolean {
	if (!isDiffableMeta(part, context)) {
		return false;
	}
	// Count every chip of a class, paired or not, so the pair index
	// matches the display order even when one side has extra chips.
	const at = nextMetaIndex(metaIndexes, part.cls);
	const pair = metaPair(context.wordDiff, part.cls, at);
	if (!pair) {
		return false;
	}
	return appendWordSegments(span, pair, context.wordSide, (target, text) =>
		appendMetaPartText(target, { cls: part.cls, text })
	);
}

type DiffableMetaPart = { cls: DocumentWordDiffMetaClass; text: string };

function isDiffableMeta(
	part: { cls: string; text: string },
	context: DocumentRowContext
): part is DiffableMetaPart {
	return Boolean(context.wordDiff) && Boolean(context.wordSide) && isWordDiffMetaClass(part.cls);
}

function nextMetaIndex(indexes: Map<string, number>, cls: string): number {
	const at = indexes.get(cls) || 0;
	indexes.set(cls, at + 1);
	return at;
}

function metaPair(
	wordDiff: DocumentWordDiff | undefined,
	cls: DocumentWordDiffMetaClass,
	at: number
): WordPair | undefined {
	if (!wordDiff) {
		return undefined;
	}
	const meta = wordDiff.meta;
	return meta ? meta[cls]?.[at] : undefined;
}

function appendDisabledSuffix(rowElement: HTMLElement, row: EcucRow): void {
	if (!row.disabled) {
		return;
	}
	const suffix = document.createElement('span');
	suffix.className = 'sr-only';
	suffix.textContent = '(disabled by condition)';
	rowElement.appendChild(suffix);
}

/**
 * Writes one field through a word pair. Both unchanged and changed runs go
 * through the field's normal writer, so condition token colours and search
 * marks survive; changed runs are wrapped in `.word-changed` on the displayed
 * side first. Returns false when no pair is available, so the caller can fall
 * back to the plain text.
 */
function appendWordSegments(
	parent: PageElement,
	pair: WordPair | undefined,
	side: 'left' | 'right' | undefined,
	writePlain: (target: PageElement, text: string) => void
): boolean {
	if (!pair || !side) {
		return false;
	}
	for (const segment of wordSegments(pair, side)) {
		appendWordSegment(parent, segment, side, writePlain);
	}
	return true;
}

function wordSegments(pair: WordPair, side: 'left' | 'right'): readonly WordSegment[] {
	return side === 'left' ? pair.left : pair.right;
}

function appendWordSegment(
	parent: PageElement,
	segment: WordSegment,
	side: 'left' | 'right',
	writePlain: (target: PageElement, text: string) => void
): void {
	if (!segment.changed) {
		writePlain(parent, segment.text);
		return;
	}
	const span = document.createElement('span');
	span.className = 'word-changed';
	span.dataset.wordSide = side;
	writePlain(span, segment.text);
	parent.appendChild(span);
}

/** Whether a meta class takes part in the word diff. */
function isWordDiffMetaClass(cls: string): cls is DocumentWordDiffMetaClass {
	return WORD_DIFF_META_CLASSES.some((candidate) => candidate === cls);
}

function twistySpan(): HTMLElement {
	const span = document.createElement('span');
	span.className = 'twisty';
	span.setAttribute('aria-hidden', 'true');
	span.appendChild(twistyIcon());
	return span;
}

export function buildDocumentBraceRow(
	kind: 'brace-open' | 'brace-close',
	level: number,
	rowId: string,
	context: DocumentRowContext
): HTMLElement {
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
): HTMLElement {
	const node = document.createElement('div');
	node.className = 'comment';
	node.setAttribute('aria-hidden', 'true');
	node.dataset.rowId = rowId;
	if (context.subtreeIds.has(rowId)) {
		node.dataset.subtree = 'true';
	}
	const rowElement = document.createElement('span');
	rowElement.className = 'row comment-row';
	rowElement.dataset.level = String(level);
	rowElement.appendChild(textSpan('span', 'punct comment-mark', '/* '));
	const body = document.createElement('span');
	body.className = 'comment-text';
	appendHighlighted(body, text);
	rowElement.appendChild(body);
	rowElement.appendChild(textSpan('span', 'punct comment-mark', ' */'));
	appendDocumentGuides(rowElement, context.guides);
	node.appendChild(rowElement);
	return node;
}

function textSpan(tag: string, className: string, text: string): HTMLElement {
	const element = document.createElement(tag);
	element.className = className;
	element.textContent = text;
	return element;
}
