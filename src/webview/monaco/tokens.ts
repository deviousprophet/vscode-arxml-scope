/**
 * Semantic tokens for the synthetic ECUC document.
 *
 * The row map tells us what a line is, but Monaco's semantic-token API only
 * needs the text range. This lexer deliberately keeps the categories distinct:
 * container labels are types, parameter/reference labels are variables, values
 * keep number/string/boolean, and the quiet meta is a separate `parameter`
 * colour. That is what stops the editor looking like one blue column.
 */

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
	| 'namespace';

export const ECUC_TOKEN_TYPES: readonly EcucTokenType[] = [
	'keyword',
	'type',
	'variable',
	'function',
	'parameter',
	'string',
	'number',
	'comment',
	'operator',
	'delimiter',
	'namespace'
];

export interface EcucToken {
	/** 0-based column in the line. */
	start: number;
	length: number;
	type: EcucTokenType;
}

function isSpace(character: string): boolean {
	return character === ' ' || character === '\t';
}

function wordEnd(text: string, start: number): number {
	let at = start;
	while (at < text.length) {
		const character = text[at];
		if (isSpace(character) || character === '"' || character === '(' || character === ')' ||
			character === '[' || character === ']' || character === '{' || character === '}' ||
			character === '<' || character === '>' || character === '=' || character === '@') {
			break;
		}
		at += 1;
	}
	return at;
}

function quotedEnd(text: string, start: number): number {
	const close = text.indexOf('"', start + 1);
	return close < 0 ? text.length : close + 1;
}

function bracketedEnd(text: string, start: number, open: string, close: string): number {
	const end = text.indexOf(close, start + 1);
	return end < 0 ? text.length : end + 1;
}

function labelEnd(text: string, start: number): number {
	let at = start;
	while (at < text.length) {
		if (isSpace(text[at])) {
			let next = at;
			while (next < text.length && isSpace(text[next])) {
				next += 1;
			}
			if (next >= text.length) {
				break;
			}
			const character = text[next];
			if (character === '=' || character === '"' || character === '(' ||
				character === '[' || character === '<' || character === '@' ||
				character === '{' || text.startsWith('context ', next)) {
				break;
			}
		}
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

/** Tokenize one synthetic ECUC line. */
export function tokenizeEcucLine(text: string): EcucToken[] {
	const tokens: EcucToken[] = [];
	const push = (start: number, end: number, type: EcucTokenType): void => {
		if (end > start) {
			tokens.push({ start, length: end - start, type });
		}
	};
	let at = 0;
	while (at < text.length && isSpace(text[at])) {
		at += 1;
	}
	if (at >= text.length) {
		return tokens;
	}

	if (text.startsWith('/*', at)) {
		push(at, text.length, 'comment');
		return tokens;
	}
	if (text[at] === '{' || text[at] === '}') {
		for (let index = at; index < text.length; index += 1) {
			if (text[index] === '{' || text[index] === '}') {
				push(index, index + 1, 'delimiter');
			}
		}
		return tokens;
	}

	const header = /^(schema|package)\s+/.exec(text.slice(at));
	if (header !== null) {
		push(at, at + header[1].length, 'keyword');
		at += header[0].length;
		push(at, text.length, header[1] === 'schema' ? 'number' : 'namespace');
		return tokens;
	}

	let labelType: EcucTokenType = 'type';
	if (text.startsWith('module ', at)) {
		push(at, at + 'module'.length, 'keyword');
		at += 'module '.length;
		labelType = 'variable';
	}
	const start = at;
	const end = labelEnd(text, at);
	if (end > start) {
		const isValueLine = text.indexOf(' = ', start) >= 0;
		push(start, end, isValueLine ? 'variable' : labelType);
	}
	at = end === start ? wordEnd(text, at) : end;

	let afterEquals = false;
	while (at < text.length) {
		while (at < text.length && isSpace(text[at])) {
			at += 1;
		}
		if (at >= text.length) {
			break;
		}
		const character = text[at];
		if (character === '=') {
			push(at, at + 1, 'operator');
			at += 1;
			afterEquals = true;
			continue;
		}
		if (character === '"') {
			const close = quotedEnd(text, at);
			push(at, close, 'string');
			at = close;
			afterEquals = false;
			continue;
		}
		if (character === '@') {
			const close = wordEnd(text, at + 1);
			push(at, close, 'comment');
			at = close;
			continue;
		}
		if (character === '(') {
			const close = bracketedEnd(text, at, '(', ')');
			push(at, close, 'parameter');
			at = close;
			continue;
		}
		if (character === '[') {
			const close = bracketedEnd(text, at, '[', ']');
			push(at, close, 'parameter');
			at = close;
			continue;
		}
		if (character === '<' && !afterEquals) {
			const close = bracketedEnd(text, at, '<', '>');
			push(at, close, 'parameter');
			at = close;
			continue;
		}
		if (character === '{') {
			const close = bracketedEnd(text, at, '{', '}');
			push(at, close, 'delimiter');
			at = close;
			continue;
		}
		if (text.startsWith('context ', at)) {
			push(at, at + 'context'.length, 'keyword');
			at += 'context '.length;
			const close = wordEnd(text, at);
			push(at, close, 'variable');
			at = close;
			continue;
		}
		const close = wordEnd(text, at);
		const word = text.slice(at, close);
		if (afterEquals) {
			push(at, close, valueType(word));
			afterEquals = false;
		} else {
			push(at, close, 'parameter');
		}
		at = close === at ? at + 1 : close;
	}
	return tokens;
}
