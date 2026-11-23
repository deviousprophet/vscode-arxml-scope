/**
 * Semantic tokens for the synthetic ECUC document.
 *
 * The row map tells us what a line is, but Monaco's semantic-token API only
 * needs the text range. This lexer deliberately keeps the categories distinct:
 * container labels are types, parameter/reference labels are variables, values
 * keep number/string/boolean, and the quiet meta is a separate `parameter`
 * colour. That is what stops the editor looking like one blue column.
 */

import { conditionTokens } from '../render/rowView';

export type EcucTokenType =
	| 'keyword'
	| 'type'
	| 'variable'
	| 'function'
	| 'parameter'
	| 'string'
	| 'number'
	| 'comment'
	| 'operator'
	| 'delimiter'
	| 'namespace'
	| 'syscond'
	| 'constant';

export interface EcucToken {
	/** 0-based column in the line. */
	start: number;
	length: number;
	type: EcucTokenType;
}

type PushToken = (start: number, end: number, type: EcucTokenType) => void;

interface TailResult {
	at: number;
	afterEquals: boolean;
}

function isSpace(character: string): boolean {
	return character === ' ' || character === '\t';
}

/** Characters that end an unquoted word. */
const WORD_DELIMITERS = ' \t"()[]{}<>=@';

function isWordDelimiter(character: string): boolean {
	return WORD_DELIMITERS.includes(character);
}

function skipSpaces(text: string, start: number): number {
	let at = start;
	while (at < text.length && isSpace(text[at])) {
		at += 1;
	}
	return at;
}

function wordEnd(text: string, start: number): number {
	let at = start;
	while (at < text.length && !isWordDelimiter(text[at])) {
		at += 1;
	}
	return at;
}

function isQuoteEscaped(text: string, index: number): boolean {
	let backslashes = 0;
	for (let at = index - 1; at >= 0 && text[at] === '\\'; at -= 1) {
		backslashes += 1;
	}
	return backslashes % 2 === 1;
}

function findUnescapedQuote(text: string, start: number): number {
	let at = start;
	while (at < text.length) {
		const quote = text.indexOf('"', at);
		if (quote < 0) {
			return -1;
		}
		if (!isQuoteEscaped(text, quote)) {
			return quote;
		}
		at = quote + 1;
	}
	return -1;
}

function quotedEnd(text: string, start: number): number {
	const close = findUnescapedQuote(text, start + 1);
	if (close >= 0) {
		return close + 1;
	}
	// No unescaped close. The synthetic display does not escape a trailing
	// backslash, so a quote preceded by one is still the closing quote.
	const fallback = text.lastIndexOf('"');
	return fallback > start ? fallback + 1 : text.length;
}

function bracketedEnd(text: string, start: number, open: string, close: string): number {
	const end = text.indexOf(close, start + 1);
	return end < 0 ? text.length : end + 1;
}

/** A character that ends the container label and starts a field. */
function isLabelBoundary(text: string, at: number): boolean {
	return '="([<@{'.includes(text[at]) || text.startsWith('context ', at);
}

/** True when this position is whitespace followed by a boundary or the end. */
function labelGapEndsAt(text: string, at: number): boolean {
	if (!isSpace(text[at])) {
		return false;
	}
	const next = skipSpaces(text, at);
	return next >= text.length || isLabelBoundary(text, next);
}

function labelEnd(text: string, start: number): number {
	let at = start;
	while (at < text.length && !labelGapEndsAt(text, at)) {
		at += 1;
	}
	return at;
}

function isNumber(word: string): boolean {
	return /^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|0[xX][0-9a-fA-F]+|0[bB][01]+|[+-]?INF|NaN)$/.test(word);
}

function isBoolean(word: string): boolean {
	return /^(?:true|false|TRUE|FALSE)$/.test(word);
}

/** A reference target is absolute, or a dotted instance path like `Pkg.Mod.Row`. */
function isReference(word: string): boolean {
	return word.startsWith('/') || /^[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)+$/.test(word);
}

function valueType(word: string): EcucTokenType {
	if (isNumber(word)) {
		return 'number';
	}
	if (isBoolean(word)) {
		return 'keyword';
	}
	return isReference(word) ? 'function' : 'string';
}

/** The shared condition lexer classes mapped onto the editor token types. */
const CONDITION_TYPES: Readonly<Record<string, EcucTokenType>> = {
	'syscond-name': 'syscond',
	'syscond-number': 'number',
	'syscond-string': 'string',
	'syscond-operator': 'parameter',
	'syscond-literal': 'constant',
	'syscond-punct': 'delimiter'
};

function pushConditionTokens(
	text: string,
	contentStart: number,
	contentEnd: number,
	push: PushToken
): void {
	for (const token of conditionTokens(text.slice(contentStart, contentEnd))) {
		const type = token.cls === '' ? undefined : CONDITION_TYPES[token.cls];
		if (type !== undefined) {
			push(contentStart + token.start, contentStart + token.end, type);
		}
	}
}

/** Split a bracketed syscond into names, operators, numbers and punctuation. */
function pushCondition(
	text: string,
	start: number,
	close: number,
	closer: string,
	push: PushToken
): void {
	const contentStart = start + 1;
	const hasClose = close > contentStart && text[close - 1] === closer;
	const contentEnd = hasClose ? close - 1 : close;
	push(start, start + 1, 'delimiter');
	pushConditionTokens(text, contentStart, contentEnd, push);
	if (hasClose) {
		push(contentEnd, close, 'delimiter');
	}
}

function pushBraceLine(text: string, at: number, push: PushToken): void {
	for (let index = at; index < text.length; index += 1) {
		if (text[index] === '{' || text[index] === '}') {
			push(index, index + 1, 'delimiter');
		}
	}
}

function pushHeader(text: string, at: number, push: PushToken): boolean {
	const header = /^(schema|package)\s+/.exec(text.slice(at));
	if (header === null) {
		return false;
	}
	push(at, at + header[1].length, 'keyword');
	const valueAt = at + header[0].length;
	push(valueAt, text.length, header[1] === 'schema' ? 'number' : 'namespace');
	return true;
}

function pushWholeLine(text: string, at: number, push: PushToken): boolean {
	if (text.startsWith('/*', at)) {
		push(at, text.length, 'comment');
		return true;
	}
	if ('{}'.includes(text[at])) {
		pushBraceLine(text, at, push);
		return true;
	}
	return pushHeader(text, at, push);
}

function pushQuoted(text: string, at: number, push: PushToken): number {
	const close = quotedEnd(text, at);
	push(at, close, 'string');
	return close;
}

function pushCommentWord(text: string, at: number, push: PushToken): number {
	const close = wordEnd(text, at + 1);
	push(at, close, 'comment');
	return close;
}

function pushBracketed(
	text: string,
	at: number,
	open: string,
	closeCharacter: string,
	type: EcucTokenType,
	push: PushToken
): number {
	const close = bracketedEnd(text, at, open, closeCharacter);
	push(at, close, type);
	return close;
}

function pushConditionAt(
	text: string,
	at: number,
	open: string,
	closer: string,
	push: PushToken
): number {
	const close = bracketedEnd(text, at, open, closer);
	pushCondition(text, at, close, closer, push);
	return close;
}

function isContextStart(text: string, at: number): boolean {
	return text.startsWith('context ', at) && text[at + 'context '.length] !== '=';
}

function pushContext(text: string, at: number, push: PushToken): number {
	push(at, at + 'context'.length, 'keyword');
	const start = at + 'context '.length;
	const close = wordEnd(text, start);
	push(start, close, 'variable');
	return close;
}

function modulePrefix(
	text: string,
	at: number,
	push: PushToken
): { at: number; labelType: EcucTokenType } {
	if (!text.startsWith('module ', at)) {
		return { at, labelType: 'type' };
	}
	push(at, at + 'module'.length, 'keyword');
	return { at: at + 'module '.length, labelType: 'variable' };
}

function pushLabelRange(
	text: string,
	start: number,
	end: number,
	labelType: EcucTokenType,
	push: PushToken
): void {
	if (end > start) {
		push(start, end, text.includes(' = ', start) ? 'variable' : labelType);
	}
}

function pushLabel(text: string, at: number, push: PushToken): number {
	const prefix = modulePrefix(text, at, push);
	const end = labelEnd(text, prefix.at);
	pushLabelRange(text, prefix.at, end, prefix.labelType, push);
	return end === prefix.at ? wordEnd(text, prefix.at) : end;
}

function pushLeadingToken(text: string, at: number, push: PushToken): number {
	if (text[at] === '"') {
		return pushQuoted(text, at, push);
	}
	if (text[at] === '@') {
		push(at, text.length, 'comment');
		return text.length;
	}
	if (isContextStart(text, at)) {
		return pushContext(text, at, push);
	}
	return pushLabel(text, at, push);
}

type TailHandler = (
	text: string,
	at: number,
	push: PushToken,
	afterEquals: boolean
) => TailResult;

const TAIL_HANDLERS: Readonly<Record<string, TailHandler>> = {
	'=': (_text, at, push) => {
		push(at, at + 1, 'operator');
		return { at: at + 1, afterEquals: true };
	},
	'"': (text, at, push) => ({ at: pushQuoted(text, at, push), afterEquals: false }),
	'@': (text, at, push, afterEquals) => ({
		at: pushCommentWord(text, at, push),
		afterEquals
	}),
	'(': (text, at, push, afterEquals) => ({
		at: pushConditionAt(text, at, '(', ')', push),
		afterEquals
	}),
	'[': (text, at, push, afterEquals) => ({
		at: pushConditionAt(text, at, '[', ']', push),
		afterEquals
	}),
	'<': (text, at, push, afterEquals) =>
		afterEquals
			? { at: at + 1, afterEquals: false }
			: { at: pushBracketed(text, at, '<', '>', 'parameter', push), afterEquals },
	'{': (text, at, push, afterEquals) => ({
		at: pushBracketed(text, at, '{', '}', 'delimiter', push),
		afterEquals
	})
};

function pushWordToken(
	text: string,
	at: number,
	afterEquals: boolean,
	push: PushToken
): TailResult {
	const close = wordEnd(text, at);
	const word = text.slice(at, close);
	push(at, close, afterEquals ? valueType(word) : 'parameter');
	return { at: close === at ? at + 1 : close, afterEquals: false };
}

function pushTailToken(
	text: string,
	at: number,
	afterEquals: boolean,
	push: PushToken
): TailResult {
	const handler = TAIL_HANDLERS[text[at]];
	if (handler !== undefined) {
		return handler(text, at, push, afterEquals);
	}
	if (isContextStart(text, at)) {
		return { at: pushContext(text, at, push), afterEquals };
	}
	return pushWordToken(text, at, afterEquals, push);
}

function pushTailTokens(text: string, at: number, push: PushToken): void {
	let afterEquals = false;
	while (at < text.length) {
		at = skipSpaces(text, at);
		if (at >= text.length) {
			return;
		}
		const result = pushTailToken(text, at, afterEquals, push);
		at = result.at;
		afterEquals = result.afterEquals;
	}
}

/** Tokenize one synthetic ECUC line. */
export function tokenizeEcucLine(text: string): EcucToken[] {
	const tokens: EcucToken[] = [];
	const push: PushToken = (start, end, type) => {
		if (end > start) {
			tokens.push({ start, length: end - start, type });
		}
	};
	let at = skipSpaces(text, 0);
	if (at >= text.length) {
		return tokens;
	}
	if (pushWholeLine(text, at, push)) {
		return tokens;
	}
	at = pushLeadingToken(text, at, push);
	pushTailTokens(text, at, push);
	return tokens;
}
