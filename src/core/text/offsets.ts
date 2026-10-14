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
		this.lineStarts = starts;
	}

	/** Number of lines in the indexed text. */
	get lineCount(): number {
		return this.lineStarts.length;
	}

	/** Line/character of a UTF-16 offset, clamped into the text. */
	positionAt(offset: number): Position {
		const at = offset < 0 ? 0 : offset > this.length ? this.length : offset;
		let lo = 0;
		let hi = this.lineStarts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (this.lineStarts[mid] <= at) {
				lo = mid;
			} else {
				hi = mid - 1;
			}
		}
		return { line: lo, character: at - this.lineStarts[lo] };
	}
}
