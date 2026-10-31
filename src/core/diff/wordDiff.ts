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

/** Splits one field into whitespace, identifier and single-punctuation tokens. */
function tokenize(text: string): string[] {
	const tokens: string[] = [];
	let at = 0;
	while (at < text.length) {
		const character = text[at];
		const start = at;
		if (isWhitespace(character)) {
			while (at < text.length && isWhitespace(text[at])) {
				at++;
			}
		} else if (isIdentifier(character)) {
			while (at < text.length && isIdentifier(text[at])) {
				at++;
			}
		} else {
			at++;
		}
		tokens.push(text.slice(start, at));
	}
	return tokens;
}

interface TokenMatch {
	left: boolean[];
	right: boolean[];
}

/** Marks the tokens that belong to one longest common subsequence. */
function longestCommon(left: readonly string[], right: readonly string[]): TokenMatch {
	const rows = left.length;
	const columns = right.length;
	// Suffix lengths let the forward walk match the earliest equal token, which
	// keeps a repeated separator (whitespace) on the segment a reader expects.
	const table: number[][] = [];
	for (let row = 0; row <= rows; row++) {
		table.push(new Array<number>(columns + 1).fill(0));
	}
	for (let row = rows - 1; row >= 0; row--) {
		for (let column = columns - 1; column >= 0; column--) {
			table[row][column] =
				left[row] === right[column]
					? table[row + 1][column + 1] + 1
					: Math.max(table[row + 1][column], table[row][column + 1]);
		}
	}
	const matchedLeft = new Array<boolean>(rows).fill(false);
	const matchedRight = new Array<boolean>(columns).fill(false);
	let row = 0;
	let column = 0;
	while (row < rows && column < columns) {
		if (left[row] === right[column]) {
			matchedLeft[row] = true;
			matchedRight[column] = true;
			row++;
			column++;
		} else if (table[row + 1][column] >= table[row][column + 1]) {
			row++;
		} else {
			column++;
		}
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

/**
 * Compares two displayed strings by token. An identical pair is one unchanged
 * segment per side; an empty side leaves the other side entirely changed.
 */
export function diffWords(left: string, right: string): WordPair {
	if (left === right) {
		const unchanged: WordSegment[] = left === '' ? [] : [{ text: left, changed: false }];
		return {
			left: unchanged.map((segment) => ({ ...segment })),
			right: unchanged.map((segment) => ({ ...segment })),
		};
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
