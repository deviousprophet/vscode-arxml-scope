/**
 * SW-SYSCOND expression evaluator.
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
 * Grammar:
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
 * so a pasted `SYSC-REF` path is one token.
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
	/** The supplied value for each referenced identifier that has one. */
	values: Record<string, ConditionValue>;
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

type LiteralToken = Extract<Token, { kind: 'number' | 'string' | 'boolean' }>;

interface Tokenized {
	tokens: Token[];
}

interface TokenizedError {
	error: string;
}

interface TokenStep {
	token?: Token;
	end: number;
}

const EQUALITY_OPERATORS: ReadonlySet<string> = new Set(['==', '!=']);
const RELATIONAL_OPERATORS: ReadonlySet<string> = new Set(['<', '<=', '>', '>=']);
const TWO_CHAR_OPERATORS: ReadonlyMap<string, BinaryOperator> = new Map([
	['==', '=='],
	['!=', '!='],
	['<=', '<='],
	['>=', '>='],
	['&&', '&&'],
	['||', '||'],
]);
const SINGLE_CHAR_OPERATORS: ReadonlyMap<string, '!' | '<' | '>'> = new Map([
	['!', '!'],
	['<', '<'],
	['>', '>'],
]);

function isWhitespace(character: string): boolean {
	return character === ' ' || character === '\t' || character === '\r' || character === '\n';
}

function isDigit(character: string): boolean {
	return character >= '0' && character <= '9';
}

function isLowerHexLetter(character: string): boolean {
	return character >= 'a' && character <= 'f';
}

function isUpperHexLetter(character: string): boolean {
	return character >= 'A' && character <= 'F';
}

function isHexDigit(character: string): boolean {
	return isDigit(character) || isLowerHexLetter(character) || isUpperHexLetter(character);
}

function isUpperLetter(character: string): boolean {
	return character >= 'A' && character <= 'Z';
}

function isLowerLetter(character: string): boolean {
	return character >= 'a' && character <= 'z';
}

function isIdentifierStart(character: string): boolean {
	return isUpperLetter(character) || isLowerLetter(character) || character === '_';
}

function isIdentifierPunctuation(character: string): boolean {
	return character === '.' || character === '-' || character === '/';
}

function isIdentifierPart(character: string): boolean {
	return isIdentifierStart(character) || isDigit(character) || isIdentifierPunctuation(character);
}

function isSign(character: string): boolean {
	return character === '+' || character === '-';
}

function isQuote(character: string): boolean {
	return character === '"' || character === "'";
}

/** True when a number literal starts at `at` (sign included). */
function startsNumber(text: string, at: number): boolean {
	if (isSign(text[at])) {
		return startsUnsignedNumber(text, at + 1);
	}
	return startsUnsignedNumber(text, at);
}

/** True for digits, or a `.` followed by a digit. */
function startsUnsignedNumber(text: string, at: number): boolean {
	if (isDigit(text[at])) {
		return true;
	}
	const next = text[at + 1] ?? '';
	return text[at] === '.' && isDigit(next);
}

interface ScannedNumber {
	value: number;
	end: number;
}

interface SignedNumber {
	value: number;
	end: number;
}

/** The literal's sign and the offset just past it. */
function numberSign(text: string, at: number): SignedNumber {
	if (isSign(text[at])) {
		return { value: text[at] === '-' ? -1 : 1, end: at + 1 };
	}
	return { value: 1, end: at };
}

function isHexPrefix(text: string, at: number): boolean {
	return text[at] === '0' && (text[at + 1] === 'x' || text[at + 1] === 'X');
}

function scanDecimalDigits(text: string, from: number): number {
	let cursor = from;
	while (cursor < text.length && isDigit(text[cursor])) {
		cursor++;
	}
	return cursor;
}

function scanHexDigits(text: string, from: number): number {
	let cursor = from;
	while (cursor < text.length && isHexDigit(text[cursor])) {
		cursor++;
	}
	return cursor;
}

/** Scans `[+-]?0x…` at `at`. */
function scanHexNumber(text: string, at: number, sign: SignedNumber): ScannedNumber | TokenizedError {
	const digitsStart = sign.end + 2;
	const end = scanHexDigits(text, digitsStart);
	if (end === digitsStart) {
		return { error: `invalid hexadecimal number at ${at + 1}` };
	}
	return { value: sign.value * parseInt(text.slice(digitsStart, end), 16), end };
}

interface ScannedFraction {
	end: number;
	hasDigits: boolean;
}

/** The optional `.digits` part of a decimal literal. */
function scanFraction(text: string, at: number): ScannedFraction {
	if (text[at] !== '.') {
		return { end: at, hasDigits: false };
	}
	const end = scanDecimalDigits(text, at + 1);
	return { end, hasDigits: end > at + 1 };
}

/** Scans `[+-]?(digits[.digits]|.digits)` at `at`. */
function scanDecimalNumber(text: string, at: number, sign: SignedNumber): ScannedNumber | TokenizedError {
	const integerStart = sign.end;
	const integerEnd = scanDecimalDigits(text, integerStart);
	const fraction = scanFraction(text, integerEnd);
	if (integerEnd === integerStart && !fraction.hasDigits) {
		return { error: `invalid number at ${at + 1}` };
	}
	return { value: sign.value * Number(text.slice(integerStart, fraction.end)), end: fraction.end };
}

/** Scans `[+-]?0x…` or `[+-]?(digits[.digits]|.digits)` at `at`. */
function scanNumber(text: string, at: number): ScannedNumber | TokenizedError {
	const sign = numberSign(text, at);
	return isHexPrefix(text, sign.end)
		? scanHexNumber(text, at, sign)
		: scanDecimalNumber(text, at, sign);
}

interface ScannedString {
	value: string;
	end: number;
}

/** The index of the closing quote, or -1 when the escape run swallows it. */
function closingQuote(text: string, from: number, quote: string): number {
	let cursor = from;
	while (cursor < text.length) {
		if (text[cursor] === '\\') {
			cursor += 2;
			continue;
		}
		if (text[cursor] === quote) {
			return cursor;
		}
		cursor++;
	}
	return -1;
}

/** Scans a single- or double-quoted string, honouring backslash escapes. */
function scanString(text: string, at: number): ScannedString | TokenizedError {
	const quote = text[at];
	const close = closingQuote(text, at + 1, quote);
	if (close < 0) {
		return { error: 'unterminated string' };
	}
	return { value: unescapeBody(text.slice(at + 1, close)), end: close + 1 };
}

function bracketStep(character: string, at: number): TokenStep | undefined {
	if (character === '(') {
		return { token: { kind: 'left' }, end: at + 1 };
	}
	if (character === ')') {
		return { token: { kind: 'right' }, end: at + 1 };
	}
	return undefined;
}

function stringStep(text: string, at: number): TokenStep | TokenizedError {
	const scanned = scanString(text, at);
	return 'error' in scanned
		? scanned
		: { token: { kind: 'string', value: scanned.value }, end: scanned.end };
}

function numberStep(text: string, at: number): TokenStep | TokenizedError {
	const scanned = scanNumber(text, at);
	return 'error' in scanned
		? scanned
		: { token: { kind: 'number', value: scanned.value }, end: scanned.end };
}

/** Whitespace and bracket tokens, which never depend on the following text. */
function simpleStep(text: string, at: number): TokenStep | TokenizedError | undefined {
	if (isWhitespace(text[at])) {
		return { end: at + 1 };
	}
	const bracket = bracketStep(text[at], at);
	if (bracket !== undefined) {
		return bracket;
	}
	return isQuote(text[at]) ? stringStep(text, at) : undefined;
}

/** A `true`/`false` identifier is a boolean token, case-insensitively. */
function booleanToken(lower: string): Token | undefined {
	return lower === 'true' || lower === 'false'
		? { kind: 'boolean', value: lower === 'true' }
		: undefined;
}

function startsIdentifier(text: string, at: number): boolean {
	if (isIdentifierStart(text[at])) {
		return true;
	}
	return text[at] === '/' && isIdentifierStart(text[at + 1] ?? '');
}

function identifierStep(text: string, at: number): TokenStep {
	let end = at + 1;
	while (end < text.length && isIdentifierPart(text[end])) {
		end++;
	}
	const name = text.slice(at, end);
	const lower = name.toLowerCase();
	return { token: booleanToken(lower) ?? { kind: 'identifier', value: name }, end };
}

/** Numbers and identifiers, which consume a variable-length run. */
function wordStep(text: string, at: number): TokenStep | TokenizedError | undefined {
	if (startsNumber(text, at)) {
		return numberStep(text, at);
	}
	if (startsIdentifier(text, at)) {
		return identifierStep(text, at);
	}
	return undefined;
}

function operatorStep(text: string, at: number): TokenStep | TokenizedError {
	const twoChar = TWO_CHAR_OPERATORS.get(text.slice(at, at + 2));
	if (twoChar !== undefined) {
		return { token: { kind: 'operator', value: twoChar }, end: at + 2 };
	}
	const single = SINGLE_CHAR_OPERATORS.get(text[at]);
	if (single !== undefined) {
		return { token: { kind: 'operator', value: single }, end: at + 1 };
	}
	return { error: `unexpected character "${text[at]}" at ${at + 1}` };
}

/** The next token at `at`, or the first unrecognised character's error. */
function nextToken(text: string, at: number): TokenStep | TokenizedError {
	const simple = simpleStep(text, at);
	if (simple !== undefined) {
		return simple;
	}
	const word = wordStep(text, at);
	return word ?? operatorStep(text, at);
}

/** Splits a condition into tokens; any unrecognised character is an error. */
function tokenize(text: string): Tokenized | TokenizedError {
	const tokens: Token[] = [];
	let at = 0;
	while (at < text.length) {
		const step = nextToken(text, at);
		if ('error' in step) {
			return step;
		}
		if (step.token !== undefined) {
			tokens.push(step.token);
		}
		at = step.end;
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

function isLiteralToken(token: Token): token is LiteralToken {
	return token.kind === 'number' || token.kind === 'string' || token.kind === 'boolean';
}

function isEqualityOperator(operator: BinaryOperator | '!' | undefined): operator is '==' | '!=' {
	return operator !== undefined && EQUALITY_OPERATORS.has(operator);
}

function isRelationalOperator(
	operator: BinaryOperator | '!' | undefined
): operator is '<' | '<=' | '>' | '>=' {
	return operator !== undefined && RELATIONAL_OPERATORS.has(operator);
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
		let operator = this.equalityOperator();
		while (operator !== undefined) {
			this.at++;
			const right = this.parseRelational();
			if (right === undefined) {
				return undefined;
			}
			left = { kind: 'binary', operator, left, right };
			operator = this.equalityOperator();
		}
		return left;
	}

	private equalityOperator(): '==' | '!=' | undefined {
		const operator = this.peekOperator();
		return isEqualityOperator(operator) ? operator : undefined;
	}

	private parseRelational(): Expression | undefined {
		let left = this.parseUnary();
		if (left === undefined) {
			return undefined;
		}
		let operator = this.relationalOperator();
		while (operator !== undefined) {
			this.at++;
			const right = this.parseUnary();
			if (right === undefined) {
				return undefined;
			}
			left = { kind: 'binary', operator, left, right };
			operator = this.relationalOperator();
		}
		return left;
	}

	private relationalOperator(): '<' | '<=' | '>' | '>=' | undefined {
		const operator = this.peekOperator();
		return isRelationalOperator(operator) ? operator : undefined;
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
		return this.parseToken(token);
	}

	private parseToken(token: Token): Expression | undefined {
		if (token.kind === 'identifier') {
			this.at++;
			return { kind: 'identifier', name: token.value };
		}
		if (isLiteralToken(token)) {
			this.at++;
			return { kind: 'literal', value: token.value };
		}
		if (token.kind === 'left') {
			return this.parseGroup();
		}
		return this.fail('unexpected token');
	}

	private parseGroup(): Expression | undefined {
		this.at++;
		const inner = this.parseOr();
		if (inner === undefined) {
			return undefined;
		}
		return this.consumeClose(inner);
	}

	private consumeClose(inner: Expression): Expression | undefined {
		const close = this.peek();
		if (close === undefined || close.kind !== 'right') {
			return this.fail('missing closing parenthesis');
		}
		this.at++;
		return inner;
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

/** The last `/`-separated segment of a name. */
function tailOf(name: string): string {
	return name.slice(name.lastIndexOf('/') + 1);
}

/** All supplied values whose key has the requested tail, in map order. */
function tailMatches(values: ReadonlyMap<string, ConditionValue>, tail: string): ConditionValue[] {
	const matches: ConditionValue[] = [];
	for (const [key, value] of values) {
		if (tailOf(key) === tail) {
			matches.push(value);
		}
	}
	return matches;
}

/** The value for a tail only when exactly one supplied key has it. */
function uniqueTailValue(
	values: ReadonlyMap<string, ConditionValue>,
	tail: string
): ConditionValue | undefined {
	const matches = tailMatches(values, tail);
	return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Exact key first, then the last `/` segment. A value entered as
 * `CANIPCORETYPE_SC` therefore matches a condition that uses a pasted full
 * `SYSC-REF` path, and a pasted full path matches a tail-shaped key. Only an
 * unambiguous tail match is used; two constants with the same tail stay
 * unresolved rather than guessing.
 */
function resolveValue(
	values: ReadonlyMap<string, ConditionValue>,
	name: string
): ConditionValue | undefined {
	const exact = values.get(name);
	if (exact !== undefined) {
		return exact;
	}
	const tail = tailOf(name);
	const byTail = tail === name ? undefined : values.get(tail);
	if (byTail !== undefined) {
		return byTail;
	}
	return uniqueTailValue(values, tail);
}

function lookup(state: EvalState, name: string): ConditionValue | undefined {
	recordSymbol(state, name);
	const value = resolveValue(state.values, name);
	if (value === undefined) {
		recordMissing(state, name);
	}
	return value;
}

function describe(value: ConditionValue): string {
	return typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string';
}

function isNumber(value: ConditionValue | undefined): value is number {
	return typeof value === 'number';
}

function isBooleanOrUndefined(value: ConditionValue | undefined): boolean {
	return value === undefined || typeof value === 'boolean';
}

function eitherUndefined(
	left: ConditionValue | undefined,
	right: ConditionValue | undefined
): boolean {
	return left === undefined || right === undefined;
}

function eitherFalse(left: ConditionValue | undefined, right: ConditionValue | undefined): boolean {
	return left === false || right === false;
}

function eitherTrue(left: ConditionValue | undefined, right: ConditionValue | undefined): boolean {
	return left === true || right === true;
}

function isLogicalOperator(operator: BinaryOperator): operator is '&&' | '||' {
	return operator === '&&' || operator === '||';
}

function andResult(
	left: ConditionValue | undefined,
	right: ConditionValue | undefined
): boolean | undefined {
	if (eitherFalse(left, right)) {
		return false;
	}
	if (eitherUndefined(left, right)) {
		return undefined;
	}
	return true;
}

function orResult(
	left: ConditionValue | undefined,
	right: ConditionValue | undefined
): boolean | undefined {
	if (eitherTrue(left, right)) {
		return true;
	}
	if (eitherUndefined(left, right)) {
		return undefined;
	}
	return false;
}

function rejectBooleans(
	state: EvalState,
	operator: '&&' | '||'
): undefined {
	state.reasons.push(`operator ${operator} requires booleans`);
	return undefined;
}

function evaluateLogical(
	operator: '&&' | '||',
	left: ConditionValue | undefined,
	right: ConditionValue | undefined,
	state: EvalState
): ConditionValue | undefined {
	if (!isBooleanOrUndefined(left)) {
		return rejectBooleans(state, operator);
	}
	if (!isBooleanOrUndefined(right)) {
		return rejectBooleans(state, operator);
	}
	return operator === '&&' ? andResult(left, right) : orResult(left, right);
}

function compareEquality(
	operator: '==' | '!=',
	left: ConditionValue,
	right: ConditionValue,
	state: EvalState
): ConditionValue | undefined {
	if (typeof left !== typeof right) {
		state.reasons.push(
			`cannot compare ${describe(left)} with ${describe(right)} using ${operator}`
		);
		return undefined;
	}
	const equal = left === right;
	return operator === '==' ? equal : !equal;
}

function evaluateEquality(
	operator: '==' | '!=',
	left: ConditionValue | undefined,
	right: ConditionValue | undefined,
	state: EvalState
): ConditionValue | undefined {
	if (left === undefined || right === undefined) {
		return undefined;
	}
	return compareEquality(operator, left, right, state);
}

function rejectNumbers(
	operator: '<' | '<=' | '>' | '>=',
	state: EvalState
): undefined {
	state.reasons.push(`operator ${operator} requires numbers`);
	return undefined;
}

function compareOrdering(
	operator: '<' | '<=' | '>' | '>=',
	left: number,
	right: number
): boolean {
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

function evaluateOrdering(
	operator: '<' | '<=' | '>' | '>=',
	left: ConditionValue | undefined,
	right: ConditionValue | undefined,
	state: EvalState
): ConditionValue | undefined {
	if (eitherUndefined(left, right)) {
		return undefined;
	}
	if (!isNumber(left)) {
		return rejectNumbers(operator, state);
	}
	if (!isNumber(right)) {
		return rejectNumbers(operator, state);
	}
	return compareOrdering(operator, left, right);
}

function evaluateNot(operand: Expression, state: EvalState): ConditionValue | undefined {
	const value = evaluate(operand, state);
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'boolean') {
		state.reasons.push(`operator ! requires a boolean, not a ${describe(value)}`);
		return undefined;
	}
	return !value;
}

function evaluateBinary(
	expression: Extract<Expression, { kind: 'binary' }>,
	state: EvalState
): ConditionValue | undefined {
	const left = evaluate(expression.left, state);
	const right = evaluate(expression.right, state);
	const operator = expression.operator;
	if (isLogicalOperator(operator)) {
		return evaluateLogical(operator, left, right, state);
	}
	if (isEqualityOperator(operator)) {
		return evaluateEquality(operator, left, right, state);
	}
	return evaluateOrdering(operator, left, right, state);
}

function evaluate(expression: Expression, state: EvalState): ConditionValue | undefined {
	if (expression.kind === 'literal') {
		return expression.value;
	}
	if (expression.kind === 'identifier') {
		return lookup(state, expression.name);
	}
	if (expression.kind === 'not') {
		return evaluateNot(expression.operand, state);
	}
	return evaluateBinary(expression, state);
}

/** The supplied value for every referenced name that has one, keyed by name. */
function valuesOf(
	symbols: readonly string[],
	values: ReadonlyMap<string, ConditionValue>
): Record<string, ConditionValue> {
	const out: Record<string, ConditionValue> = {};
	for (const name of symbols) {
		const value = resolveValue(values, name);
		if (value !== undefined) {
			out[name] = value;
		}
	}
	return out;
}

/** The three-valued result of an evaluated expression. */
function conditionStateOf(value: ConditionValue | undefined, state: EvalState): ConditionState {
	if (value === true) {
		return 'true';
	}
	if (value === false) {
		return 'false';
	}
	recordNonBoolean(value, state);
	return 'unknown';
}

/** A defined non-boolean result is itself a reason for `unknown`. */
function recordNonBoolean(value: ConditionValue | undefined, state: EvalState): void {
	if (value !== undefined && state.reasons.length === 0) {
		state.reasons.push(`condition evaluates to a ${describe(value)}, not a boolean`);
	}
}

/** Evaluates one parsed expression and builds its result. */
function evaluateExpression(
	expression: Expression,
	values: ReadonlyMap<string, ConditionValue>
): ConditionResult {
	const state: EvalState = { values, symbols: [], missing: [], reasons: [] };
	const value = evaluate(expression, state);
	const conditionState = conditionStateOf(value, state);
	const result: ConditionResult = {
		state: conditionState,
		symbols: state.symbols,
		missing: state.missing,
		values: valuesOf(state.symbols, values),
	};
	if (conditionState === 'unknown' && state.reasons.length > 0) {
		result.error = state.reasons[0];
	}
	return result;
}

function tokenizeFailure(error: string): ConditionResult {
	return { state: 'unknown', symbols: [], missing: [], values: {}, error };
}

/** A parse failure still reports every identifier the tokens referenced. */
function parseFailure(
	parser: Parser,
	tokens: readonly Token[],
	values: ReadonlyMap<string, ConditionValue>
): ConditionResult {
	const symbols = identifiersOf(tokens);
	return {
		state: 'unknown',
		symbols,
		missing: [],
		values: valuesOf(symbols, values),
		error: parser.failureMessage() ?? 'invalid expression',
	};
}

/** Evaluates one condition against the supplied constant values. */
export function evaluateSyscond(text: string, values: ReadonlyMap<string, ConditionValue>): ConditionResult {
	const tokenized = tokenize(text);
	if ('error' in tokenized) {
		return tokenizeFailure(tokenized.error);
	}
	const parser = new Parser(tokenized.tokens);
	const expression = parser.parse();
	if (expression === undefined) {
		return parseFailure(parser, tokenized.tokens, values);
	}
	return evaluateExpression(expression, values);
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

const BOOLEAN_VALUE = /^(true|false)$/i;
const HEX_VALUE = /^[+-]?0[xX][0-9a-fA-F]+$/;
const DECIMAL_VALUE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/** A hexadecimal literal's value, or `undefined` when the text is not one. */
function hexValue(text: string): number | undefined {
	if (!HEX_VALUE.test(text)) {
		return undefined;
	}
	const negative = text.startsWith('-');
	const body = text.replace(/^[+-]/, '');
	const parsed = parseInt(body.slice(2), 16);
	return negative ? -parsed : parsed;
}

/** True when the text is wrapped in matching single or double quotes. */
function isQuoted(text: string): boolean {
	if (text.length < 2) {
		return false;
	}
	const quote = text[0];
	return (quote === '"' || quote === "'") && text[text.length - 1] === quote;
}

/** A quoted literal without its quotes, otherwise the text itself. */
function quotedOrText(text: string): string {
	return isQuoted(text) ? unescapeBody(text.slice(1, -1)) : text;
}

/**
 * Classifies one raw value the user typed: boolean, number
 * (decimal or `0x` hexadecimal), quoted string, or the trimmed string itself.
 * The raw text is what gets persisted, so this never mutates the entry.
 */
export function parseConditionValue(raw: string): ConditionValue {
	const text = raw.trim();
	if (BOOLEAN_VALUE.test(text)) {
		return text.toLowerCase() === 'true';
	}
	const hex = hexValue(text);
	if (hex !== undefined) {
		return hex;
	}
	if (DECIMAL_VALUE.test(text)) {
		return Number(text);
	}
	return quotedOrText(text);
}
