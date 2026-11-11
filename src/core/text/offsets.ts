/**
 * Offset -> line/character conversion.
 *
 * One pass collects line-start offsets; `positionAt` is a binary search into
 * that array. No per-call re-slicing of the text, unlike the reference's
 * `offsetToPosition`.
 *
 * Offsets are UTF-16 code units, the unit VS Code `Position` uses. Line breaks
 * follow VS Code: `\r\n`, `\n` and lone `\r` each start a new line.
 */

export interface Position {
	line: number;
	character: number;
}

export class LineIndex {
	private readonly lineStarts: number[];
	private readonly length: number;

	constructor(text: string) {
		this.length = text.length;
		this.lineStarts = lineStartsFromText(text);
	}

	/** Number of lines in the indexed text. */
	get lineCount(): number {
		return this.lineStarts.length;
	}

	/** The raw line-start offsets, for callers that only need the table. */
	get starts(): readonly number[] {
		return this.lineStarts;
	}

	/** Line/character of a UTF-16 offset, clamped into the text. */
	positionAt(offset: number): Position {
		return positionAtLineStarts(this.lineStarts, offset, this.length);
	}
}

/**
 * Collects line starts from streamed chunks without retaining the text.
 * Handles `\r\n`, `\n` and lone `\r` exactly like `LineIndex`, including a CR
 * at a chunk boundary.
 */
export class LineStartBuilder {
	private readonly starts: number[] = [0];
	private offset = 0;
	private pendingCR = -1;

	write(chunk: string): void {
		for (let at = 0; at < chunk.length; at++) {
			this.writeCharacter(chunk[at], at);
		}
		this.offset += chunk.length;
	}

	/** Consumes a pending CR first, then records the current line break. */
	private writeCharacter(character: string, at: number): void {
		if (this.consumePendingCR(character, at)) {
			return;
		}
		this.recordBreak(character, at);
	}

	/**
	 * Resolves a CR held from the previous character. Returns true when the
	 * current character completed a CRLF and must not be recorded again.
	 */
	private consumePendingCR(character: string, at: number): boolean {
		if (this.pendingCR < 0) {
			return false;
		}
		if (character === '\n') {
			this.starts.push(this.offset + at + 1);
			this.pendingCR = -1;
			return true;
		}
		this.starts.push(this.pendingCR + 1);
		this.pendingCR = -1;
		return false;
	}

	/** Holds a CR until the next character, or records an LF line start. */
	private recordBreak(character: string, at: number): void {
		if (character === '\r') {
			this.pendingCR = this.offset + at;
		} else if (character === '\n') {
			this.starts.push(this.offset + at + 1);
		}
	}

	/** Flushes a trailing lone CR and returns the complete table. */
	finish(): number[] {
		if (this.pendingCR >= 0) {
			this.starts.push(this.pendingCR + 1);
			this.pendingCR = -1;
		}
		return this.starts;
	}
}

/** The offset just past the line break at `at`, or undefined for a plain character. */
function lineBreakEnd(text: string, at: number): number | undefined {
	const code = text.charCodeAt(at);
	if (code === 13 /* \r */) {
		return text.charCodeAt(at + 1) === 10 /* \n */ ? at + 2 : at + 1;
	}
	return code === 10 /* \n */ ? at + 1 : undefined;
}

function lineStartsFromText(text: string): number[] {
	const starts: number[] = [0];
	for (let i = 0; i < text.length; i++) {
		const end = lineBreakEnd(text, i);
		if (end !== undefined) {
			starts.push(end);
			i = end - 1;
		}
	}
	return starts;
}

/** Clamps a UTF-16 offset into the document. */
function clampOffset(offset: number, length: number): number {
	return Math.max(0, Math.min(offset, length));
}

/** The last line start at or before `at`, via binary search. */
function lineAt(lineStarts: readonly number[], at: number): number {
	let low = 0;
	let high = lineStarts.length - 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (lineStarts[mid] <= at) {
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return Math.max(0, high);
}

/** Line/character for an offset against a line-start table. */
export function positionAtLineStarts(
	lineStarts: readonly number[] | undefined,
	offset: number,
	length = Number.MAX_SAFE_INTEGER
): Position {
	if (lineStarts === undefined || lineStarts.length === 0) {
		return { line: 0, character: clampOffset(offset, length) };
	}
	const at = clampOffset(offset, length);
	const line = lineAt(lineStarts, at);
	return { line, character: Math.max(0, at - lineStarts[line]) };
}
