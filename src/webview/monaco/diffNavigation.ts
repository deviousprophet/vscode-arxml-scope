/**
 * Pure change-navigation arithmetic for the semantic diff.
 *
 * Monaco owns the change list; this module only decides which change is next
 * and which line each pane should reveal. Keeping it free of Monaco imports
 * makes the navigation order unit-testable in the extension host.
 */

export interface DiffNavigationChange {
	originalStartLineNumber: number;
	modifiedStartLineNumber: number;
}

/** The line shown in the modified pane for a change under the current swap state. */
export function displayedChangeLine(change: DiffNavigationChange, swapped: boolean): number {
	const primary = swapped ? change.originalStartLineNumber : change.modifiedStartLineNumber;
	const fallback = swapped ? change.modifiedStartLineNumber : change.originalStartLineNumber;
	return primary || fallback;
}

/** The line in the original pane for the same change. */
export function originalChangeLine(change: DiffNavigationChange, swapped: boolean): number {
	const primary = swapped ? change.modifiedStartLineNumber : change.originalStartLineNumber;
	const fallback = swapped ? change.originalStartLineNumber : change.modifiedStartLineNumber;
	return primary || fallback;
}

/** The first change strictly after `currentLine`, wrapped to the first. */
export function nextChangeIndex(lines: readonly number[], currentLine: number): number {
	const at = lines.findIndex((line) => line > currentLine);
	return at >= 0 ? at : 0;
}

/** The last change strictly before `currentLine`, wrapped to the last. */
export function previousChangeIndex(lines: readonly number[], currentLine: number): number {
	for (let at = lines.length - 1; at >= 0; at -= 1) {
		if (lines[at] < currentLine) {
			return at;
		}
	}
	return lines.length - 1;
}

/** The adjacent change index, or -1 when there are no changes. */
export function adjacentChangeIndex(
	lines: readonly number[],
	currentLine: number,
	direction: 1 | -1
): number {
	if (lines.length === 0) {
		return -1;
	}
	return direction > 0 ? nextChangeIndex(lines, currentLine) : previousChangeIndex(lines, currentLine);
}
