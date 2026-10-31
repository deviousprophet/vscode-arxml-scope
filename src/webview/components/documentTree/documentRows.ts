/**
 * The Document row primitives shared by the editor and the semantic diff.
 *
 * The builders append real DOM nodes only; model text always travels through
 * `textContent`/`appendHighlighted`, never markup. Both pages import the same
 * definitions, so a label, value or meta chip cannot drift between them.
 */
import type { EcucRow, MetaPart } from '../../../core/ecuc/renderRows';
import type { WordPair } from '../../../core/diff/wordDiff';
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
	gap?: boolean;
	guides?: readonly DocumentGuide[];
	wordDiff?: DocumentWordDiff;
	/** The displayed pane; the changed-word colour follows it after a swap. */
	wordSide?: 'left' | 'right';
}

export function appendDocumentGuides(rowElement: HTMLElement, guides: readonly DocumentGuide[] | undefined): void {
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
	const wordDiff = context.wordDiff;
	const wordSide = context.wordSide;
	const writePlain = (target: PageElement, text: string): void => {
		appendHighlighted(target, text);
	};
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
	if (!appendWordSegments(label, wordDiff && wordDiff.label, wordSide, writePlain)) {
		appendHighlighted(label, row.label);
	}
	rowElement.appendChild(label);
	if (row.kind === 'parameter' || row.kind === 'reference') {
		rowElement.appendChild(
			valueSpan(row, false, undefined, (target, text) => {
				if (!appendWordSegments(target, wordDiff && wordDiff.value, wordSide, writePlain)) {
					appendHighlighted(target, text);
				}
			})
		);
	}
	if (inlineMeta.length > 0) {
		const metaIndexes = new Map<string, number>();
		const writePart: MetaPartWriter = (span, part) => {
			if (!wordDiff || !wordSide || !isWordDiffMetaClass(part.cls)) {
				return false;
			}
			// Count every chip of a class, paired or not, so the pair index
			// matches the display order even when one side has extra chips.
			const at = metaIndexes.get(part.cls) || 0;
			metaIndexes.set(part.cls, at + 1);
			const pair = wordDiff.meta ? wordDiff.meta[part.cls]?.[at] : undefined;
			if (!pair) {
				return false;
			}
			return appendWordSegments(span, pair, wordSide, (target, text) =>
				appendMetaPartText(target, { cls: part.cls, text })
			);
		};
		rowElement.appendChild(metaSpan({ ...row, meta: inlineMeta }, undefined, writePart));
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
	const segments = side === 'left' ? pair.left : pair.right;
	for (const segment of segments) {
		if (!segment.changed) {
			writePlain(parent, segment.text);
			continue;
		}
		const span = document.createElement('span');
		span.className = 'word-changed';
		span.dataset.wordSide = side;
		writePlain(span, segment.text);
		parent.appendChild(span);
	}
	return true;
}

/** Whether a meta class takes part in the word diff. */
function isWordDiffMetaClass(cls: string): cls is DocumentWordDiffMetaClass {
	return WORD_DIFF_META_CLASSES.some((candidate) => candidate === cls);
}

export function twistySpan(): HTMLElement {
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
	if (context.gap) {
		node.dataset.gap = 'true';
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
