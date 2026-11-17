/**
 * The page-local matcher used for `<mark>` highlighting and header text.
 *
 * The engine owns the match list, count and replace; this matcher keeps the visual
 * marks and the schema/package header in step with the same options. It mirrors the
 * Rust rules: literal or regex, optional case sensitivity and ASCII whole-word.
 */
import type { FindOptions } from '../../core/searchModel';
import type { MatchRange } from './treeQuery';

const WORD = /[A-Za-z0-9_]/;

/** True when neither side of the match touches an ASCII word character. */
function wholeWord(text: string, start: number, end: number): boolean {
	const before = start === 0 ? '' : text[start - 1];
	const after = end >= text.length ? '' : text[end];
	return !WORD.test(before) && !WORD.test(after);
}

function escapeLiteral(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The ranges one field shows, or an empty list for a blank/invalid pattern. */
export function findRanges(text: string, query: string, options: FindOptions): MatchRange[] {
	const needle = options.regex ? query : query.trim();
	if (needle === '') {
		return [];
	}
	return rangesOf(text, compilePattern(needle, options), options.wholeWord);
}

function rangesOf(text: string, pattern: RegExp, whole: boolean): MatchRange[] {
	const ranges: MatchRange[] = [];
	for (const match of text.matchAll(pattern)) {
		const start = match.index ?? 0;
		const end = start + match[0].length;
		if (acceptedMatch(text, start, end, whole)) {
			ranges.push({ start, end });
		}
	}
	return ranges;
}

function acceptedMatch(text: string, start: number, end: number, whole: boolean): boolean {
	return end > start && (!whole || wholeWord(text, start, end));
}

function compilePattern(needle: string, options: FindOptions): RegExp {
	try {
		return new RegExp(options.regex ? needle : escapeLiteral(needle), options.caseSensitive ? 'g' : 'gi');
	} catch {
		return /(?!)/g;
	}
}
