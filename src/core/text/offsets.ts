/**
 * Offset -> line/character conversion (child design §2.6).
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
			const character = chunk[at];
			if (this.pendingCR >= 0) {
				if (character === '\n') {
					this.starts.push(this.offset + at + 1);
					this.pendingCR = -1;
					continue;
				}
				this.starts.push(this.pendingCR + 1);
				this.pendingCR = -1;
			}
			if (character === '\r') {
				this.pendingCR = this.offset + at;
			} else if (character === '\n') {
				this.starts.push(this.offset + at + 1);
			}
		}
		this.offset += chunk.length;
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

function lineStartsFromText(text: string): number[] {
	const starts: number[] = [0];
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c === 13 /* \r */) {
			if (text.charCodeAt(i + 1) === 10 /* \n */) {
				i++;
			}
			starts.push(i + 1);
		} else if (c === 10 /* \n */) {
			starts.push(i + 1);
		}
	}
	return starts;
}

/** Line/character for an offset against a line-start table. */
export function positionAtLineStarts(
	lineStarts: readonly number[] | undefined,
	offset: number,
	length = Number.MAX_SAFE_INTEGER
): Position {
	if (lineStarts === undefined || lineStarts.length === 0) {
		return { line: 0, character: Math.max(0, Math.min(offset, length)) };
	}
	const at = Math.max(0, Math.min(offset, length));
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
	const line = Math.max(0, high);
	return { line, character: Math.max(0, at - lineStarts[line]) };
}
