/**
 * Word-level comparison for one displayed diff field.
 *
 * The semantic diff compares whole fields; this helper turns a changed field
 * into unchanged and changed runs so a changed row can show exactly which words
 * moved. Pure: no DOM and no `vscode`, so the page can import it directly and
 * the tokenizer/LCS rules are unit-tested without a webview.
 *
 * Tokenization is deliberately small: whitespace runs stay one token, an
 * identifier is `[A-Za-z0-9_]+` (so `0x1F` is one token) and every other
 * character is its own token (so `/Pkg/Diff` is `/`, `Pkg`, `/`, `Diff`).
 * Unmatched tokens are changed; adjacent segments with the same flag merge.
 */
export interface WordSegment {
	text: string;
	changed: boolean;
}

export interface WordPair {
	left: WordSegment[];
	right: WordSegment[];
}

const IDENTIFIER = /[A-Za-z0-9_]/;
const WHITESPACE = /[ \t\r\n]/;

function isIdentifier(character: string): boolean {
	return IDENTIFIER.test(character);
}

function isWhitespace(character: string): boolean {
	return WHITESPACE.test(character);
}

function runEnd(text: string, at: number, accept: (character: string) => boolean): number {
	let end = at;
	while (end < text.length && accept(text[end])) {
		end++;
	}
	return end;
}

/** The end of the token that starts at `at`: a whitespace run, an identifier or one character. */
function tokenEnd(text: string, at: number): number {
	const character = text[at];
	if (isWhitespace(character)) {
		return runEnd(text, at, isWhitespace);
	}
	if (isIdentifier(character)) {
		return runEnd(text, at, isIdentifier);
	}
	return at + 1;
}

/** Splits one field into whitespace, identifier and single-punctuation tokens. */
function tokenize(text: string): string[] {
	const tokens: string[] = [];
	let at = 0;
	while (at < text.length) {
		const end = tokenEnd(text, at);
		tokens.push(text.slice(at, end));
		at = end;
	}
	return tokens;
}

interface TokenMatch {
	left: boolean[];
	right: boolean[];
}

interface MatchStep {
	row: number;
	column: number;
}

/**
 * Suffix lengths let the forward walk match the earliest equal token, which
 * keeps a repeated separator (whitespace) on the segment a reader expects.
 */
function suffixTable(left: readonly string[], right: readonly string[]): number[][] {
	const rows = left.length;
	const columns = right.length;
	const table: number[][] = [];
	for (let row = 0; row <= rows; row++) {
		table.push(new Array<number>(columns + 1).fill(0));
	}
	for (let row = rows - 1; row >= 0; row--) {
		for (let column = columns - 1; column >= 0; column--) {
			table[row][column] = suffixLength(table, left[row], right[column], row, column);
		}
	}
	return table;
}

function suffixLength(
	table: number[][],
	leftToken: string,
	rightToken: string,
	row: number,
	column: number
): number {
	return leftToken === rightToken
		? table[row + 1][column + 1] + 1
		: Math.max(table[row + 1][column], table[row][column + 1]);
}

/** Consumes one token pair, marking a match and choosing the branch to walk. */
function stepMatch(
	left: readonly string[],
	right: readonly string[],
	table: number[][],
	row: number,
	column: number,
	matchedLeft: boolean[],
	matchedRight: boolean[]
): MatchStep {
	if (left[row] === right[column]) {
		matchedLeft[row] = true;
		matchedRight[column] = true;
		return { row: row + 1, column: column + 1 };
	}
	return table[row + 1][column] >= table[row][column + 1]
		? { row: row + 1, column }
		: { row, column: column + 1 };
}

/** Marks the tokens that belong to one longest common subsequence. */
function longestCommon(left: readonly string[], right: readonly string[]): TokenMatch {
	const table = suffixTable(left, right);
	const matchedLeft = new Array<boolean>(left.length).fill(false);
	const matchedRight = new Array<boolean>(right.length).fill(false);
	let row = 0;
	let column = 0;
	while (row < left.length && column < right.length) {
		const next = stepMatch(left, right, table, row, column, matchedLeft, matchedRight);
		row = next.row;
		column = next.column;
	}
	return { left: matchedLeft, right: matchedRight };
}

/** Groups consecutive tokens with the same flag into visible segments. */
function segmentsOf(tokens: readonly string[], matched: readonly boolean[]): WordSegment[] {
	const segments: WordSegment[] = [];
	for (let at = 0; at < tokens.length; at++) {
		const changed = !matched[at];
		const last = segments[segments.length - 1];
		if (last && last.changed === changed) {
			last.text += tokens[at];
		} else {
			segments.push({ text: tokens[at], changed });
		}
	}
	return segments;
}

function unchangedPair(text: string): WordPair {
	const unchanged: WordSegment[] = text === '' ? [] : [{ text, changed: false }];
	return {
		left: unchanged.map((segment) => ({ ...segment })),
		right: unchanged.map((segment) => ({ ...segment })),
	};
}

/**
 * Compares two displayed strings by token. An identical pair is one unchanged
 * segment per side; an empty side leaves the other side entirely changed.
 */
export function diffWords(left: string, right: string): WordPair {
	if (left === right) {
		return unchangedPair(left);
	}
	if (left === '') {
		return { left: [], right: [{ text: right, changed: true }] };
	}
	if (right === '') {
		return { left: [{ text: left, changed: true }], right: [] };
	}
	const leftTokens = tokenize(left);
	const rightTokens = tokenize(right);
	const match = longestCommon(leftTokens, rightTokens);
	return {
		left: segmentsOf(leftTokens, match.left),
		right: segmentsOf(rightTokens, match.right),
	};
}
