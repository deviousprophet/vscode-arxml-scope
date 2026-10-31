/**
 * The row primitives shared by every webview that shows an ECUC row.
 *
 * Keeping them in one module means the editor page and the diff page render the
 * same label, `= value` and meta chips from one definition instead of two copies
 * that can drift. The functions read the subset an `EcucRow` and a projected diff
 * cell both satisfy.
 *
 * `appendHighlighted` falls back to the page's live search query. The composition
 * root calls `setHighlightQuery` whenever the query changes; row builders pass an
 * explicit query when they have one.
 */
import { matchRanges } from './treeQuery';

/** The subset `valueSpan` / `metaSpan` read from a row or a projected diff cell. */
export interface RowViewFields {
	kind: string;
	valueKind?: string;
	shownValue?: string;
	meta: readonly { cls: string; text: string; title: string; state?: string }[];
}

/** The tiny DOM surface the row builders use. */
export interface PageElement {
	appendChild(child: unknown): void;
}

/** The page's live search query, shared by every row primitive. */
let highlightQuery = '';

/** Set the query every later highlight falls back to. */
export function setHighlightQuery(query: string): void {
	highlightQuery = query;
}

/** The Codicon chevron-right used by both tree row renderers (inline, no asset). */
export function twistyIcon(): SVGElement {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('width', '16');
	svg.setAttribute('height', '16');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('class', 'g-twisty');
	svg.setAttribute('fill', 'currentColor');
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	// Codicon chevron-right (MIT, microsoft/vscode-codicons).
	path.setAttribute('d', 'M6.14601 3.14579C5.95101 3.34079 5.95101 3.65779 6.14601 3.85279L10.292 7.99879L6.14601 12.1448C5.95101 12.3398 5.95101 12.6568 6.14601 12.8518C6.34101 13.0468 6.65801 13.0468 6.85301 12.8518L11.353 8.35179C11.548 8.15679 11.548 7.83979 11.353 7.64478L6.85301 3.14479C6.65801 2.94979 6.34101 2.95079 6.14601 3.14579Z');
	svg.appendChild(path);
	return svg;
}

/**
 * Appends `text` to `parent`, wrapping every case-insensitive occurrence of the
 * query in `<mark>`. An explicit query wins; otherwise the page's live
 * `highlightQuery` is used.
 */
export function appendHighlighted(parent: PageElement, text: string, query?: string): void {
	const needle = query === undefined ? highlightQuery : query;
	const ranges = needle.trim() === '' ? [] : matchRanges(text, needle);
	if (ranges.length === 0) {
		parent.appendChild(document.createTextNode(text));
		return;
	}
	let at = 0;
	for (const range of ranges) {
		if (range.start > at) {
			parent.appendChild(document.createTextNode(text.slice(at, range.start)));
		}
		const mark = document.createElement('mark');
		mark.textContent = text.slice(range.start, range.end);
		parent.appendChild(mark);
		at = range.end;
	}
	if (at < text.length) {
		parent.appendChild(document.createTextNode(text.slice(at)));
	}
}

/** The `= shownValue` span; the `=` is punctuation, not part of the value token. */
export function valueSpan(row: RowViewFields, readOnly = false, query?: string): HTMLElement {
	const value = document.createElement('span');
	value.className = 'value';
	if (row.kind === 'parameter') {
		value.dataset.valueKind = row.valueKind || 'textual';
		value.title = 'Value: ' + (row.shownValue || '') + (readOnly ? '' : ' - edit in Details');
	} else {
		value.title = 'Target: ' + (row.shownValue || '');
	}
	const punct = document.createElement('span');
	punct.className = 'punct';
	punct.textContent = '=';
	value.appendChild(punct);
	value.appendChild(document.createTextNode(' '));
	const text = document.createElement('span');
	text.className = 'value-text';
	appendHighlighted(text, row.shownValue || '', query);
	value.appendChild(text);
	return value;
}

/** One syntax-coloured slice of a condition expression. */
export interface ConditionToken {
	/** CSS class, or `''` for whitespace. */
	cls: string;
	start: number;
	end: number;
}

/**
 * Splits a condition into syntax tokens without changing any character.
 * Identifiers, numbers, strings, operators and punctuation get the shared
 * `--tok-*` classes; whitespace stays unstyled so the expression reads normally.
 */
export function conditionTokens(text: string): ConditionToken[] {
	const twoChar = ['&&', '||', '==', '!=', '<=', '>='];
	const nameStart = (character: string): boolean =>
		(character >= 'A' && character <= 'Z') ||
		(character >= 'a' && character <= 'z') ||
		character === '_';
	const namePart = (character: string): boolean =>
		nameStart(character) ||
		(character >= '0' && character <= '9') ||
		character === '.' ||
		character === '-' ||
		character === '/';
	const digit = (character: string): boolean => character >= '0' && character <= '9';
	const whitespace = (character: string): boolean =>
		character === ' ' || character === '\t' || character === '\r' || character === '\n';

	const tokens: ConditionToken[] = [];
	let at = 0;
	while (at < text.length) {
		const character = text[at];
		const start = at;
		if (whitespace(character)) {
			while (at < text.length && whitespace(text[at])) {
				at++;
			}
			tokens.push({ cls: '', start, end: at });
			continue;
		}
		if (character === '"' || character === "'") {
			at++;
			while (at < text.length) {
				if (text[at] === '\\') {
					at += 2;
					continue;
				}
				if (text[at] === character) {
					at++;
					break;
				}
				at++;
			}
			tokens.push({ cls: 'syscond-string', start, end: Math.min(at, text.length) });
			continue;
		}
		const signed =
			(character === '+' || character === '-') && digit(text[at + 1] ?? '');
		const decimal = character === '.' && digit(text[at + 1] ?? '');
		if (digit(character) || signed || decimal) {
			if (character === '+' || character === '-') {
				at++;
			}
			if (text[at] === '0' && (text[at + 1] === 'x' || text[at + 1] === 'X')) {
				at += 2;
				while (at < text.length && /[0-9a-fA-F]/.test(text[at])) {
					at++;
				}
			} else {
				while (at < text.length && digit(text[at])) {
					at++;
				}
				if (text[at] === '.') {
					at++;
					while (at < text.length && digit(text[at])) {
						at++;
					}
				}
			}
			tokens.push({ cls: 'syscond-number', start, end: at });
			continue;
		}
		if (nameStart(character)) {
			while (at < text.length && namePart(text[at])) {
				at++;
			}
			const name = text.slice(start, at);
			const literal = name === 'true' || name === 'false' || name === 'TRUE' || name === 'FALSE';
			tokens.push({ cls: literal ? 'syscond-literal' : 'syscond-name', start, end: at });
			continue;
		}
		const pair = text.slice(at, at + 2);
		if (twoChar.indexOf(pair) !== -1) {
			tokens.push({ cls: 'syscond-operator', start, end: at + 2 });
			at += 2;
			continue;
		}
		if ('<>!'.indexOf(character) !== -1) {
			tokens.push({ cls: 'syscond-operator', start, end: at + 1 });
			at++;
			continue;
		}
		tokens.push({ cls: 'syscond-punct', start, end: at + 1 });
		at++;
	}
	return tokens;
}

/** Appends one token slice, optionally wrapped in the search `<mark>`. */
function appendConditionSlice(
	parent: PageElement,
	cls: string,
	text: string,
	marked: boolean
): void {
	let target = parent;
	if (cls !== '') {
		const span = document.createElement('span');
		span.className = cls;
		parent.appendChild(span);
		target = span;
	}
	if (marked) {
		const mark = document.createElement('mark');
		mark.textContent = text;
		target.appendChild(mark);
	} else {
		target.appendChild(document.createTextNode(text));
	}
}

/**
 * Appends a condition with token colours while keeping Search highlighting.
 * Highlight ranges are computed over the whole expression, so a match that
 * crosses a token boundary stays one visible mark inside each token.
 */
export function appendConditionTokens(parent: PageElement, text: string, query?: string): void {
	const needle = query === undefined ? highlightQuery : query;
	const ranges = needle.trim() === '' ? [] : matchRanges(text, needle);
	let rangeIndex = 0;
	for (const token of conditionTokens(text)) {
		let at = token.start;
		while (at < token.end) {
			while (rangeIndex < ranges.length && ranges[rangeIndex].end <= at) {
				rangeIndex++;
			}
			const range = ranges[rangeIndex];
			if (!range || range.start >= token.end) {
				appendConditionSlice(parent, token.cls, text.slice(at, token.end), false);
				at = token.end;
				continue;
			}
			if (range.start > at) {
				appendConditionSlice(parent, token.cls, text.slice(at, range.start), false);
				at = range.start;
				continue;
			}
			const end = Math.min(range.end, token.end);
			appendConditionSlice(parent, token.cls, text.slice(at, end), true);
			at = end;
		}
	}
}

/** The quiet-source meta chips (short name, variant, context, condition, annotation). */
export function metaSpan(row: RowViewFields, query?: string): HTMLElement {
	const meta = document.createElement('span');
	meta.className = 'row-meta';
	for (const part of row.meta) {
		const span = document.createElement('span');
		span.className = part.cls;
		span.title = part.title;
		if (part.state) {
			span.dataset.state = part.state;
		}
		if (part.cls === 'condition') {
			appendConditionTokens(span, part.text, query);
		} else if (part.cls === 'context' && part.text.indexOf('context ') === 0) {
			const keyword = document.createElement('span');
			keyword.className = 'keyword';
			appendHighlighted(keyword, 'context', query);
			span.appendChild(keyword);
			span.appendChild(document.createTextNode(' '));
			appendHighlighted(span, part.text.slice('context '.length), query);
		} else {
			appendHighlighted(span, part.text, query);
		}
		meta.appendChild(span);
	}
	return meta;
}
