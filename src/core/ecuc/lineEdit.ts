/**
 * Field text recovered from a whole-line replacement.
 *
 * A Details edit repaints its row through one full-line `pushEditOperations`, so
 * Monaco's undo of that repaint arrives as a change that starts outside the
 * field span. The synthetic line keeps the field's prefix and suffix, so a
 * replacement that preserves both still carries exactly one field's new text.
 */

export interface FieldSpanBounds {
	startColumn: number;
	endColumn: number;
}

/**
 * The field text `current` holds when `lineText`'s single span is the only part
 * that changed, or `undefined` when the prefix/suffix are not intact.
 *
 * Callers must only use this for a whole-line change: a one-character edit
 * outside the span (a deleted quote) is indistinguishable from a field change at
 * this level and must be restored instead.
 */
export function fieldTextFromWholeLine(
	lineText: string,
	spans: readonly FieldSpanBounds[],
	current: string
): string | undefined {
	if (spans.length !== 1) {
		return undefined;
	}
	const span = spans[0];
	const prefix = lineText.slice(0, span.startColumn - 1);
	const suffix = lineText.slice(span.endColumn - 1);
	if (current.length < prefix.length + suffix.length || !current.startsWith(prefix) || !current.endsWith(suffix)) {
		return undefined;
	}
	const text = current.slice(prefix.length, current.length - suffix.length);
	return /[\r\n]/.test(text) ? undefined : text;
}
