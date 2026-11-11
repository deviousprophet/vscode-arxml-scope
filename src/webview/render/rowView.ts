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
import type { MatchRange } from './treeQuery';

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

/** The explicit query, or the page's live one when none was passed. */
function searchRanges(text: string, query: string | undefined): MatchRange[] {
	const needle = query === undefined ? highlightQuery : query;
	return needle.trim() === '' ? [] : matchRanges(text, needle);
}

/** Appends one plain text node; an empty slice is never emitted. */
function appendPlainText(parent: PageElement, text: string): void {
	parent.appendChild(document.createTextNode(text));
}

/** Appends the slice covered by one match as a `<mark>`. */
function appendMark(parent: PageElement, text: string, range: MatchRange): void {
	const mark = document.createElement('mark');
	mark.textContent = text.slice(range.start, range.end);
	parent.appendChild(mark);
}

/** Writes the text, alternating the gaps and the matched slices. */
function appendHighlightRanges(parent: PageElement, text: string, ranges: readonly MatchRange[]): void {
	let at = 0;
	for (const range of ranges) {
		if (range.start > at) {
			appendPlainText(parent, text.slice(at, range.start));
		}
		appendMark(parent, text, range);
		at = range.end;
	}
	if (at < text.length) {
		appendPlainText(parent, text.slice(at));
	}
}

/**
 * Appends `text` to `parent`, wrapping every case-insensitive occurrence of the
 * query in `<mark>`. An explicit query wins; otherwise the page's live
 * `highlightQuery` is used.
 */
export function appendHighlighted(parent: PageElement, text: string, query?: string): void {
	const ranges = searchRanges(text, query);
	if (ranges.length === 0) {
		appendPlainText(parent, text);
		return;
	}
	appendHighlightRanges(parent, text, ranges);
}

/** Writes one field's text; the diff supplies a segment writer for word changes. */
export type RowTextWriter = (target: PageElement, text: string) => void;

/** The edit hint appended to a parameter value's title unless it is read-only. */
function editHint(readOnly: boolean): string {
	return readOnly ? '' : ' - edit in Details';
}

/** The `value` span title for a parameter value or a reference target. */
function valueTitle(row: RowViewFields, readOnly: boolean): string {
	const shown = row.shownValue || '';
	if (row.kind !== 'parameter') {
		return 'Target: ' + shown;
	}
	return 'Value: ' + shown + editHint(readOnly);
}

/** Writes the value text through the diff's segment writer, or the normal highlighter. */
function writeValueText(
	target: PageElement,
	row: RowViewFields,
	query: string | undefined,
	writeText: RowTextWriter | undefined
): void {
	if (writeText) {
		writeText(target, row.shownValue || '');
		return;
	}
	appendHighlighted(target, row.shownValue || '', query);
}

/** The `= shownValue` span; the `=` is punctuation, not part of the value token. */
export function valueSpan(
	row: RowViewFields,
	readOnly = false,
	query?: string,
	writeText?: RowTextWriter
): HTMLElement {
	const value = document.createElement('span');
	value.className = 'value';
	if (row.kind === 'parameter') {
		value.dataset.valueKind = row.valueKind || 'textual';
	}
	value.title = valueTitle(row, readOnly);
	const punct = document.createElement('span');
	punct.className = 'punct';
	punct.textContent = '=';
	value.appendChild(punct);
	value.appendChild(document.createTextNode(' '));
	const text = document.createElement('span');
	text.className = 'value-text';
	writeValueText(text, row, query, writeText);
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

/** The two-character operators, longest match first at a token start. */
const TWO_CHAR_OPERATORS = ['&&', '||', '==', '!=', '<=', '>='];

function isUpperLetter(character: string): boolean {
	return character >= 'A' && character <= 'Z';
}

function isLowerLetter(character: string): boolean {
	return character >= 'a' && character <= 'z';
}

function isLetter(character: string): boolean {
	return isUpperLetter(character) || isLowerLetter(character);
}

function isNameStart(character: string): boolean {
	return isLetter(character) || character === '_';
}

function isDigit(character: string): boolean {
	return character >= '0' && character <= '9';
}

function isNamePunctuation(character: string): boolean {
	return character === '.' || character === '-' || character === '/';
}

function isNamePart(character: string): boolean {
	return isNameStart(character) || isDigit(character) || isNamePunctuation(character);
}

function isSpace(character: string): boolean {
	return character === ' ' || character === '\t';
}

function isLineBreak(character: string): boolean {
	return character === '\r' || character === '\n';
}

function isWhitespace(character: string): boolean {
	return isSpace(character) || isLineBreak(character);
}

function isHexDigit(character: string): boolean {
	return /[0-9a-fA-F]/.test(character);
}

function isSign(character: string): boolean {
	return character === '+' || character === '-';
}

function isQuote(character: string): boolean {
	return character === '"' || character === "'";
}

function isLiteralName(name: string): boolean {
	return name === 'true' || name === 'false' || name === 'TRUE' || name === 'FALSE';
}

/** The first character after a run of digits. */
function scanDigits(text: string, at: number): number {
	let cursor = at;
	while (cursor < text.length && isDigit(text[cursor])) {
		cursor++;
	}
	return cursor;
}

/** The end of a decimal integer or fractional literal; a trailing dot is kept. */
function scanDecimal(text: string, at: number): number {
	const integerEnd = scanDigits(text, at);
	if (text[integerEnd] !== '.') {
		return integerEnd;
	}
	return scanDigits(text, integerEnd + 1);
}

/** The end of a hexadecimal literal (the `0x` prefix is already consumed). */
function scanHex(text: string, at: number): number {
	let cursor = at;
	while (cursor < text.length && isHexDigit(text[cursor])) {
		cursor++;
	}
	return cursor;
}

function isSignedNumberStart(text: string, at: number): boolean {
	return isSign(text[at]) && isDigit(text[at + 1] ?? '');
}

function isDecimalNumberStart(text: string, at: number): boolean {
	return text[at] === '.' && isDigit(text[at + 1] ?? '');
}

function isNumberStart(text: string, at: number): boolean {
	return isDigit(text[at]) || isSignedNumberStart(text, at) || isDecimalNumberStart(text, at);
}

function isHexStart(text: string, at: number): boolean {
	return text[at] === '0' && (text[at + 1] === 'x' || text[at + 1] === 'X');
}

/** One number token, including a sign, a decimal part or a hex body. */
function scanNumber(text: string, at: number): ConditionToken {
	const start = isSign(text[at]) ? at + 1 : at;
	const end = isHexStart(text, start) ? scanHex(text, start + 2) : scanDecimal(text, start);
	return { cls: 'syscond-number', start: at, end };
}

/** One whitespace run; left unstyled so the expression reads normally. */
function scanWhitespace(text: string, at: number): ConditionToken {
	let cursor = at;
	while (cursor < text.length && isWhitespace(text[cursor])) {
		cursor++;
	}
	return { cls: '', start: at, end: cursor };
}

/** One quoted string, honouring backslash escapes and an unterminated tail. */
function scanString(text: string, at: number): ConditionToken {
	const quote = text[at];
	let cursor = at + 1;
	while (cursor < text.length) {
		if (text[cursor] === '\\') {
			cursor += 2;
			continue;
		}
		if (text[cursor] === quote) {
			cursor++;
			break;
		}
		cursor++;
	}
	return { cls: 'syscond-string', start: at, end: Math.min(cursor, text.length) };
}

/** One identifier, classed as a literal when it is a boolean word. */
function scanName(text: string, at: number): ConditionToken {
	let cursor = at;
	while (cursor < text.length && isNamePart(text[cursor])) {
		cursor++;
	}
	const name = text.slice(at, cursor);
	return { cls: isLiteralName(name) ? 'syscond-literal' : 'syscond-name', start: at, end: cursor };
}

/** One operator or punctuation character; two-character operators win first. */
function scanOperator(text: string, at: number): ConditionToken {
	const pair = text.slice(at, at + 2);
	if (TWO_CHAR_OPERATORS.indexOf(pair) !== -1) {
		return { cls: 'syscond-operator', start: at, end: at + 2 };
	}
	if ('<>!'.indexOf(text[at]) !== -1) {
		return { cls: 'syscond-operator', start: at, end: at + 1 };
	}
	return { cls: 'syscond-punct', start: at, end: at + 1 };
}

/** The whitespace, string and number forms; `undefined` means a word follows. */
function scanSpanToken(text: string, at: number): ConditionToken | undefined {
	const character = text[at];
	if (isWhitespace(character)) {
		return scanWhitespace(text, at);
	}
	if (isQuote(character)) {
		return scanString(text, at);
	}
	if (isNumberStart(text, at)) {
		return scanNumber(text, at);
	}
	return undefined;
}

function scanWordToken(text: string, at: number): ConditionToken {
	return isNameStart(text[at]) ? scanName(text, at) : scanOperator(text, at);
}

/** The token that starts at `at`; every branch consumes at least one character. */
function scanToken(text: string, at: number): ConditionToken {
	return scanSpanToken(text, at) ?? scanWordToken(text, at);
}

/**
 * Splits a condition into syntax tokens without changing any character.
 * Identifiers, numbers, strings, operators and punctuation get the shared
 * `--tok-*` classes; whitespace stays unstyled so the expression reads normally.
 */
export function conditionTokens(text: string): ConditionToken[] {
	const tokens: ConditionToken[] = [];
	let at = 0;
	while (at < text.length) {
		const token = scanToken(text, at);
		tokens.push(token);
		at = token.end;
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

/** Whether a match still covers part of the token that ends at `tokenEnd`. */
function tokenHasRange(range: MatchRange | undefined, tokenEnd: number): boolean {
	return range !== undefined && range.start < tokenEnd;
}

/** Drops match ranges that end at or before the current token offset. */
function advanceRangeIndex(
	ranges: readonly MatchRange[],
	rangeIndex: number,
	at: number
): number {
	let index = rangeIndex;
	while (index < ranges.length && ranges[index].end <= at) {
		index++;
	}
	return index;
}

/** Writes one token, split into unmarked gaps and marked slices. */
function appendTokenSlices(
	parent: PageElement,
	text: string,
	token: ConditionToken,
	ranges: readonly MatchRange[],
	rangeIndex: number
): number {
	let at = token.start;
	while (at < token.end) {
		rangeIndex = advanceRangeIndex(ranges, rangeIndex, at);
		const range = ranges[rangeIndex];
		if (!tokenHasRange(range, token.end)) {
			appendConditionSlice(parent, token.cls, text.slice(at, token.end), false);
			return rangeIndex;
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
	return rangeIndex;
}

/**
 * Appends a condition with token colours while keeping Search highlighting.
 * Highlight ranges are computed over the whole expression, so a match that
 * crosses a token boundary stays one visible mark inside each token.
 */
export function appendConditionTokens(parent: PageElement, text: string, query?: string): void {
	const ranges = searchRanges(text, query);
	let rangeIndex = 0;
	for (const token of conditionTokens(text)) {
		rangeIndex = appendTokenSlices(parent, text, token, ranges, rangeIndex);
	}
}

/**
 * Writes one meta part's text with its normal syntax and search treatment. A
 * word-diff writer reuses it for the unchanged segments of a changed part.
 */
export function appendMetaPartText(
	target: PageElement,
	part: { cls: string; text: string },
	query?: string
): void {
	if (part.cls === 'condition') {
		appendConditionTokens(target, part.text, query);
	} else if (part.cls === 'context' && part.text.indexOf('context ') === 0) {
		const keyword = document.createElement('span');
		keyword.className = 'keyword';
		appendHighlighted(keyword, 'context', query);
		target.appendChild(keyword);
		target.appendChild(document.createTextNode(' '));
		appendHighlighted(target, part.text.slice('context '.length), query);
	} else {
		appendHighlighted(target, part.text, query);
	}
}

/** Handles one meta part; returning false falls back to the normal writer. */
export type MetaPartWriter = (span: HTMLElement, part: { cls: string; text: string }) => boolean;

/** One meta chip with its class, title, state and text. */
function partSpan(
	part: { cls: string; text: string; title: string; state?: string },
	query: string | undefined,
	writePart: MetaPartWriter | undefined
): HTMLElement {
	const span = document.createElement('span');
	span.className = part.cls;
	span.title = part.title;
	if (part.state) {
		span.dataset.state = part.state;
	}
	if (!writePart || !writePart(span, part)) {
		appendMetaPartText(span, part, query);
	}
	return span;
}

/** The quiet-source meta chips (short name, variant, context, condition, annotation). */
export function metaSpan(row: RowViewFields, query?: string, writePart?: MetaPartWriter): HTMLElement {
	const meta = document.createElement('span');
	meta.className = 'row-meta';
	for (const part of row.meta) {
		meta.appendChild(partSpan(part, query, writePart));
	}
	return meta;
}
