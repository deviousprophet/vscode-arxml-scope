/**
 * SW-SYSCOND expression evaluator (task design §2).
 *
 * The scanner stores a condition as the joined text of its `SW-SYSCOND`
 * element, with inline `SYSC-REF` elements replaced by their path tail. This
 * module parses that text and evaluates it against a supplied map of system
 * constant values.
 *
 * Evaluation is three-valued: `true`, `false` or `unknown`. An unresolved
 * identifier, a syntax error or a comparison between incompatible types is
 * `unknown`, which the row builder never treats as "disabled". The evaluator is
 * a pure library over text — no `vscode`, no Node APIs — so it runs in the core
 * suite without an editor.
 *
 * Grammar (design §2.1):
 *
 * ```
 * expr       := or
 * or         := and ( '||' and )*
 * and        := equality ( '&&' equality )*
 * equality   := relational ( ('==' | '!=') relational )*
 * relational := unary ( ('<' | '<=' | '>' | '>=') unary )*
 * unary      := '!' unary | primary
 * primary    := number | string | 'true' | 'false' | identifier | '(' expr ')'
 * ```
 *
 * An identifier is `[A-Za-z_][A-Za-z0-9_.\-/]*`, optionally prefixed with `/`
 * so a pasted `SYSC-REF` path is one token (PRD R9).
 */

export type ConditionValue = string | number | boolean;

/**
 * The SW system-constant name rule shared by the host and the page:
 * `[A-Za-z_][A-Za-z0-9_.-/]*` with an optional leading `/` for a pasted
 * `SYSC-REF` path. It is core validation, not editor policy.
 */
export function isConditionName(name: string): boolean {
	return /^\/?[A-Za-z_][A-Za-z0-9_.\-/]*$/.test(name);
}

export type ConditionState = 'true' | 'false' | 'unknown';

export interface ConditionResult {
	state: ConditionState;
	/** Every identifier referenced by the expression, in source order. */
	symbols: string[];
	/** Identifiers with no supplied value. */
	missing: string[];
	/** Parse or comparison reason when the result is unknown. */
	error?: string;
}

type BinaryOperator = '||' | '&&' | '==' | '!=' | '<' | '<=' | '>' | '>=';

type Expression =
	| { kind: 'literal'; value: ConditionValue }
	| { kind: 'identifier'; name: string }
	| { kind: 'not'; operand: Expression }
	| { kind: 'binary'; operator: BinaryOperator; left: Expression; right: Expression };

type Token =
	| { kind: 'number'; value: number }
	| { kind: 'string'; value: string }
	| { kind: 'boolean'; value: boolean }
	| { kind: 'identifier'; value: string }
	| { kind: 'operator'; value: BinaryOperator | '!' }
	| { kind: 'left' }
	| { kind: 'right' };

interface Tokenized {
	tokens: Token[];
}

interface TokenizedError {
	error: string;
}

function isWhitespace(character: string): boolean {
	return character === ' ' || character === '\t' || character === '\r' || character === '\n';
}

function isDigit(character: string): boolean {
	return character >= '0' && character <= '9';
}

function isHexDigit(character: string): boolean {
	return isDigit(character) || (character >= 'a' && character <= 'f') || (character >= 'A' && character <= 'F');
}

function isIdentifierStart(character: string): boolean {
	return (
		(character >= 'A' && character <= 'Z') ||
		(character >= 'a' && character <= 'z') ||
		character === '_'
	);
}

function isIdentifierPart(character: string): boolean {
	return isIdentifierStart(character) || isDigit(character) || character === '.' || character === '-' || character === '/';
}

/** True when a number literal starts at `at` (sign included). */
function startsNumber(text: string, at: number): boolean {
	const character = text[at];
	if (isDigit(character)) {
		return true;
	}
	if (character === '.') {
		return isDigit(text[at + 1] ?? '');
	}
	if (character === '+' || character === '-') {
		const next = text[at + 1] ?? '';
		if (isDigit(next)) {
			return true;
		}
		return next === '.' && isDigit(text[at + 2] ?? '');
	}
	return false;
}

interface ScannedNumber {
	value: number;
	end: number;
}

/** Scans `[+-]?0x…` or `[+-]?(digits[.digits]|.digits)` at `at`. */
function scanNumber(text: string, at: number): ScannedNumber | TokenizedError {
	let cursor = at;
	let sign = 1;
	if (text[cursor] === '+' || text[cursor] === '-') {
		if (text[cursor] === '-') {
			sign = -1;
		}
		cursor++;
	}
	if (text[cursor] === '0' && (text[cursor + 1] === 'x' || text[cursor + 1] === 'X')) {
		cursor += 2;
		const digitsStart = cursor;
		while (cursor < text.length && isHexDigit(text[cursor])) {
			cursor++;
		}
		if (cursor === digitsStart) {
			return { error: `invalid hexadecimal number at ${at + 1}` };
		}
		return { value: sign * parseInt(text.slice(digitsStart, cursor), 16), end: cursor };
	}
	const integerStart = cursor;
	while (cursor < text.length && isDigit(text[cursor])) {
		cursor++;
	}
	let hasDigits = cursor > integerStart;
	if (text[cursor] === '.') {
		cursor++;
		const fractionStart = cursor;
		while (cursor < text.length && isDigit(text[cursor])) {
			cursor++;
		}
		hasDigits = hasDigits || cursor > fractionStart;
	}
	if (!hasDigits) {
		return { error: `invalid number at ${at + 1}` };
	}
	return { value: sign * Number(text.slice(integerStart, cursor)), end: cursor };
}

interface ScannedString {
	value: string;
	end: number;
}

/** The escaped character itself: `\\` -> `\`, `\'` -> `'`, `\n` -> `n`. */
function unescapeCharacter(character: string): string {
	return character;
}

/** Scans a single- or double-quoted string, honouring backslash escapes. */
function scanString(text: string, at: number): ScannedString | TokenizedError {
	const quote = text[at];
	let cursor = at + 1;
	let value = '';
	while (cursor < text.length) {
		const character = text[cursor];
		if (character === '\\') {
			if (cursor + 1 >= text.length) {
				return { error: 'unterminated string' };
			}
			value += unescapeCharacter(text[cursor + 1]);
			cursor += 2;
			continue;
		}
		if (character === quote) {
			return { value, end: cursor + 1 };
		}
		value += character;
		cursor++;
	}
	return { error: 'unterminated string' };
}

/** Splits a condition into tokens; any unrecognised character is an error. */
function tokenize(text: string): Tokenized | TokenizedError {
	const tokens: Token[] = [];
	let at = 0;
	while (at < text.length) {
		const character = text[at];
		if (isWhitespace(character)) {
			at++;
			continue;
		}
		if (character === '(') {
			tokens.push({ kind: 'left' });
			at++;
			continue;
		}
		if (character === ')') {
			tokens.push({ kind: 'right' });
			at++;
			continue;
		}
		if (character === '"' || character === "'") {
			const scanned = scanString(text, at);
			if ('error' in scanned) {
				return scanned;
			}
			tokens.push({ kind: 'string', value: scanned.value });
			at = scanned.end;
			continue;
		}
		if (startsNumber(text, at)) {
			const scanned = scanNumber(text, at);
			if ('error' in scanned) {
				return scanned;
			}
			tokens.push({ kind: 'number', value: scanned.value });
			at = scanned.end;
			continue;
		}
		if (isIdentifierStart(character) || (character === '/' && isIdentifierStart(text[at + 1] ?? ''))) {
			let end = at + 1;
			while (end < text.length && isIdentifierPart(text[end])) {
				end++;
			}
			const name = text.slice(at, end);
			if (name.toLowerCase() === 'true' || name.toLowerCase() === 'false') {
				tokens.push({ kind: 'boolean', value: name.toLowerCase() === 'true' });
			} else {
				tokens.push({ kind: 'identifier', value: name });
			}
			at = end;
			continue;
		}
		const pair = text.slice(at, at + 2);
		if (pair === '==' || pair === '!=' || pair === '<=' || pair === '>=' || pair === '&&' || pair === '||') {
			tokens.push({ kind: 'operator', value: pair });
			at += 2;
			continue;
		}
		if (character === '!' || character === '<' || character === '>') {
			tokens.push({ kind: 'operator', value: character });
			at++;
			continue;
		}
		return { error: `unexpected character "${character}" at ${at + 1}` };
	}
	return { tokens };
}

/** Unique identifiers in source order, used when a parse error stops the parser. */
function identifiersOf(tokens: readonly Token[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const token of tokens) {
		if (token.kind === 'identifier' && !seen.has(token.value)) {
			seen.add(token.value);
			out.push(token.value);
		}
	}
	return out;
}

class Parser {
	private at = 0;
	private failure: string | undefined;

	constructor(private readonly tokens: readonly Token[]) {}

	parse(): Expression | undefined {
		const expression = this.parseOr();
		if (expression === undefined || this.failure !== undefined) {
			return undefined;
		}
		if (this.at < this.tokens.length) {
			return this.fail('unexpected token after the expression');
		}
		return expression;
	}

	failureMessage(): string | undefined {
		return this.failure;
	}

	private fail(message: string): undefined {
		if (this.failure === undefined) {
			this.failure = message;
		}
		return undefined;
	}

	private peek(): Token | undefined {
		return this.tokens[this.at];
	}

	private peekOperator(): BinaryOperator | '!' | undefined {
		const token = this.peek();
		return token !== undefined && token.kind === 'operator' ? token.value : undefined;
	}

	private matchOperator(operator: BinaryOperator | '!'): boolean {
		if (this.peekOperator() !== operator) {
			return false;
		}
		this.at++;
		return true;
	}

	private parseOr(): Expression | undefined {
		let left = this.parseAnd();
		if (left === undefined) {
			return undefined;
		}
		while (this.matchOperator('||')) {
			const right = this.parseAnd();
			if (right === undefined) {
				return undefined;
			}
			left = { kind: 'binary', operator: '||', left, right };
		}
		return left;
	}

	private parseAnd(): Expression | undefined {
		let left = this.parseEquality();
		if (left === undefined) {
			return undefined;
		}
		while (this.matchOperator('&&')) {
			const right = this.parseEquality();
			if (right === undefined) {
				return undefined;
			}
			left = { kind: 'binary', operator: '&&', left, right };
		}
		return left;
	}

	private parseEquality(): Expression | undefined {
		let left = this.parseRelational();
		if (left === undefined) {
			return undefined;
		}
		for (;;) {
			const operator = this.peekOperator();
			if (operator !== '==' && operator !== '!=') {
				return left;
			}
			this.at++;
			const right = this.parseRelational();
			if (right === undefined) {
				return undefined;
			}
			left = { kind: 'binary', operator, left, right };
		}
	}

	private parseRelational(): Expression | undefined {
		let left = this.parseUnary();
		if (left === undefined) {
			return undefined;
		}
		for (;;) {
			const operator = this.peekOperator();
			if (operator !== '<' && operator !== '<=' && operator !== '>' && operator !== '>=') {
				return left;
			}
			this.at++;
			const right = this.parseUnary();
			if (right === undefined) {
				return undefined;
			}
			left = { kind: 'binary', operator, left, right };
		}
	}

	private parseUnary(): Expression | undefined {
		if (this.matchOperator('!')) {
			const operand = this.parseUnary();
			return operand === undefined ? undefined : { kind: 'not', operand };
		}
		return this.parsePrimary();
	}

	private parsePrimary(): Expression | undefined {
		const token = this.peek();
		if (token === undefined) {
			return this.fail('unexpected end of the expression');
		}
		if (token.kind === 'number' || token.kind === 'string' || token.kind === 'boolean') {
			this.at++;
			return { kind: 'literal', value: token.value };
		}
		if (token.kind === 'identifier') {
			this.at++;
			return { kind: 'identifier', name: token.value };
		}
		if (token.kind === 'left') {
			this.at++;
			const inner = this.parseOr();
			if (inner === undefined) {
				return undefined;
			}
			const close = this.peek();
			if (close === undefined || close.kind !== 'right') {
				return this.fail('missing closing parenthesis');
			}
			this.at++;
			return inner;
		}
		return this.fail('unexpected token');
	}
}

interface EvalState {
	values: ReadonlyMap<string, ConditionValue>;
	symbols: string[];
	missing: string[];
	reasons: string[];
}

function recordSymbol(state: EvalState, name: string): void {
	if (!state.symbols.includes(name)) {
		state.symbols.push(name);
	}
}

function recordMissing(state: EvalState, name: string): void {
	if (!state.missing.includes(name)) {
		state.missing.push(name);
	}
}

/**
 * Exact key first, then the last `/` segment (design §2.3). A value entered as
 * `CANIPCORETYPE_SC` therefore matches a condition that uses a pasted full
 * `SYSC-REF` path, and a pasted full path matches a tail-shaped key.
 */
function lookup(state: EvalState, name: string): ConditionValue | undefined {
	recordSymbol(state, name);
	const exact = state.values.get(name);
	if (exact !== undefined) {
		return exact;
	}
	const tail = name.slice(name.lastIndexOf('/') + 1);
	if (tail !== name) {
		const byTail = state.values.get(tail);
		if (byTail !== undefined) {
			return byTail;
		}
	}
	// A full path pasted into the value panel must match the tail-shaped
	// identifier the scanner produces. Only an unambiguous tail match is used;
	// two constants with the same tail stay unknown rather than guessing.
	let found: ConditionValue | undefined;
	let matches = 0;
	for (const [key, value] of state.values) {
		if (key.slice(key.lastIndexOf('/') + 1) === tail) {
			found = value;
			matches++;
			if (matches > 1) {
				break;
			}
		}
	}
	if (matches === 1) {
		return found;
	}
	recordMissing(state, name);
	return undefined;
}

function describe(value: ConditionValue): string {
	return typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string';
}

function evaluate(expression: Expression, state: EvalState): ConditionValue | undefined {
	switch (expression.kind) {
		case 'literal':
			return expression.value;
		case 'identifier':
			return lookup(state, expression.name);
		case 'not': {
			const operand = evaluate(expression.operand, state);
			if (operand === undefined) {
				return undefined;
			}
			if (typeof operand !== 'boolean') {
				state.reasons.push(`operator ! requires a boolean, not a ${describe(operand)}`);
				return undefined;
			}
			return !operand;
		}
		case 'binary': {
			const left = evaluate(expression.left, state);
			const right = evaluate(expression.right, state);
			const operator = expression.operator;
			if (operator === '&&' || operator === '||') {
				if (left !== undefined && typeof left !== 'boolean') {
					state.reasons.push(`operator ${operator} requires booleans`);
					return undefined;
				}
				if (right !== undefined && typeof right !== 'boolean') {
					state.reasons.push(`operator ${operator} requires booleans`);
					return undefined;
				}
				if (operator === '&&') {
					if (left === false || right === false) {
						return false;
					}
					return left === undefined || right === undefined ? undefined : true;
				}
				if (left === true || right === true) {
					return true;
				}
				return left === undefined || right === undefined ? undefined : false;
			}
			if (operator === '==' || operator === '!=') {
				if (left === undefined || right === undefined) {
					return undefined;
				}
				if (typeof left !== typeof right) {
					state.reasons.push(`cannot compare ${describe(left)} with ${describe(right)} using ${operator}`);
					return undefined;
				}
				const equal = left === right;
				return operator === '==' ? equal : !equal;
			}
			if (left === undefined || right === undefined) {
				return undefined;
			}
			if (typeof left !== 'number' || typeof right !== 'number') {
				state.reasons.push(`operator ${operator} requires numbers`);
				return undefined;
			}
			if (operator === '<') {
				return left < right;
			}
			if (operator === '<=') {
				return left <= right;
			}
			if (operator === '>') {
				return left > right;
			}
			return left >= right;
		}
	}
}

/** Evaluates one condition against the supplied constant values. */
export function evaluateSyscond(text: string, values: ReadonlyMap<string, ConditionValue>): ConditionResult {
	const tokenized = tokenize(text);
	if ('error' in tokenized) {
		return { state: 'unknown', symbols: [], missing: [], error: tokenized.error };
	}
	const parser = new Parser(tokenized.tokens);
	const expression = parser.parse();
	if (expression === undefined) {
		return {
			state: 'unknown',
			symbols: identifiersOf(tokenized.tokens),
			missing: [],
			error: parser.failureMessage() ?? 'invalid expression',
		};
	}
	const state: EvalState = { values, symbols: [], missing: [], reasons: [] };
	const value = evaluate(expression, state);
	let conditionState: ConditionState;
	if (value === true) {
		conditionState = 'true';
	} else if (value === false) {
		conditionState = 'false';
	} else {
		conditionState = 'unknown';
		if (value !== undefined && state.reasons.length === 0) {
			state.reasons.push(`condition evaluates to a ${describe(value)}, not a boolean`);
		}
	}
	const result: ConditionResult = {
		state: conditionState,
		symbols: state.symbols,
		missing: state.missing,
	};
	if (conditionState === 'unknown' && state.reasons.length > 0) {
		result.error = state.reasons[0];
	}
	return result;
}

/** Removes one level of backslash escapes from a quoted string body. */
function unescapeBody(body: string): string {
	let out = '';
	for (let at = 0; at < body.length; at++) {
		if (body[at] === '\\' && at + 1 < body.length) {
			out += body[at + 1];
			at++;
		} else {
			out += body[at];
		}
	}
	return out;
}

/**
 * Classifies one raw value the user typed (design §2.4): boolean, number
 * (decimal or `0x` hexadecimal), quoted string, or the trimmed string itself.
 * The raw text is what gets persisted, so this never mutates the entry.
 */
export function parseConditionValue(raw: string): ConditionValue {
	const text = raw.trim();
	if (/^(true|false)$/i.test(text)) {
		return text.toLowerCase() === 'true';
	}
	if (/^[+-]?0[xX][0-9a-fA-F]+$/.test(text)) {
		const negative = text.startsWith('-');
		const body = text.replace(/^[+-]/, '');
		const parsed = parseInt(body.slice(2), 16);
		return negative ? -parsed : parsed;
	}
	if (/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(text)) {
		return Number(text);
	}
	if (text.length >= 2) {
		const quote = text[0];
		if ((quote === '"' || quote === "'") && text[text.length - 1] === quote) {
			return unescapeBody(text.slice(1, -1));
		}
	}
	return text;
}
