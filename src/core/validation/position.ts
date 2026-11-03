/** Offset-to-line/column conversion for diagnostics, without a `vscode` import. */
export interface LinePosition {
	line: number;
	character: number;
}

/**
 * Converts a UTF-16 offset with a file's line starts. A missing table falls back
 * to line 0 so a synthetic `FileIndex` still yields a usable range.
 */
export function positionAt(lineStarts: readonly number[] | undefined, offset: number): LinePosition {
	if (lineStarts === undefined || lineStarts.length === 0) {
		return { line: 0, character: Math.max(0, offset) };
	}
	let low = 0;
	let high = lineStarts.length - 1;
	let line = 0;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (lineStarts[mid] <= offset) {
			line = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return { line, character: Math.max(0, offset - lineStarts[line]) };
}
