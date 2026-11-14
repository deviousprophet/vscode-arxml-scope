/**
 * Line spans for whole-element deletion in a merge.
 *
 * An ARXML element that owns its lines is removed with its indentation and one line
 * break; an element that shares its line with something else is removed as a bare
 * range so the surrounding text is not damaged.
 */
export interface LineSpan {
	start: number;
	end: number;
}

function lineStart(text: string, from: number): number {
	let at = Math.min(from, text.length);
	while (at > 0 && text[at - 1] !== '\n' && text[at - 1] !== '\r') {
		at -= 1;
	}
	return at;
}

function lineEnd(text: string, from: number): number {
	let at = Math.min(from, text.length);
	while (at < text.length && text[at] !== '\n' && text[at] !== '\r') {
		at += 1;
	}
	return at;
}

function isBlank(text: string, start: number, end: number): boolean {
	return text.slice(start, end).trim() === '';
}

/** The removal span for an element, including its indentation and one line break when it owns them. */
export function lineSpan(text: string, range: { start: number; end: number }): LineSpan {
	const start = lineStart(text, range.start);
	const end = lineEnd(text, range.end);
	const ownsLineStart = isBlank(text, start, range.start);
	const ownsLineEnd = isBlank(text, range.end, end);
	if (!ownsLineStart || !ownsLineEnd) {
		return { start: range.start, end: range.end };
	}
	const after = end < text.length ? end + (text[end] === '\r' && text[end + 1] === '\n' ? 2 : 1) : end;
	return { start, end: after };
}
