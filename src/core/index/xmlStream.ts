/**
 * Chunk-fed XML tokenizer for ARXML files.
 *
 * The index builder must read files that do not fit comfortably in memory, so
 * this parser never requires the whole document. `write` accepts text in any
 * chunk size; a construct split across two chunks stays in the tail buffer until
 * its terminator arrives, which makes the emitted event stream independent of
 * the chunk boundaries.
 *
 * The scanner in `core/ecuc/scanner.ts` stays the single-file ECUC model
 * builder. This module is the smaller generic event surface the workspace index
 * needs: tags, text, comments and CDATA, with absolute UTF-16 offsets.
 *
 * No DOM and no `vscode` import: the host supplies decoded text.
 */
import { isXmlWhitespace, stripXmlPrefix } from '../text/xmlText';

export interface XmlStreamHandlers {
	/** An opening tag. `offset` is the `<`. */
	open(name: string, attrs: ReadonlyMap<string, string>, offset: number): void;
	/** A closing tag. `offset` is the `<` of `</…>`. */
	close(name: string, offset: number): void;
	/** Character data between tags. Offsets bound the raw text. */
	text(text: string, start: number, end: number): void;
}

const CDATA_OPEN = '<![CDATA[';
const CDATA_CLOSE = ']]>';
const COMMENT_OPEN = '<!--';
const COMMENT_CLOSE = '-->';
const PI_CLOSE = '?>';

export class XmlStreamParser {
	private buffer = '';
	/** Absolute offset of `buffer[0]`. */
	private consumed = 0;
	/** Pending character data, merged across writes so chunking is unobservable. */
	private textBuffer = '';
	private textStart = -1;
	private textEnd = -1;
	private readonly handlers: XmlStreamHandlers;

	constructor(handlers: XmlStreamHandlers) {
		this.handlers = handlers;
	}

	/** Feeds one text chunk. */
	write(chunk: string): void {
		if (chunk.length === 0) {
			return;
		}
		this.buffer += chunk;
		this.consume(false);
	}

	/** Ends the stream: any complete tail is consumed, an unterminated construct is dropped. */
	end(): void {
		this.consume(true);
		this.flushText();
		this.buffer = '';
	}

	private consume(final: boolean): void {
		let at = 0;
		while (at < this.buffer.length) {
			const lt = this.buffer.indexOf('<', at);
			if (lt < 0) {
				this.emitText(at, this.buffer.length);
				at = this.buffer.length;
				break;
			}
			if (lt > at) {
				this.emitText(at, lt);
				at = lt;
			}
			// A construct always ends a text run: flush before parsing it, so a text run
			// split by the chunk boundary is still emitted as one event.
			this.flushText();
			const end = this.readConstruct(at, final);
			if (end < 0) {
				// Incomplete construct: keep it for the next chunk. At the end of the
				// stream there is nothing left to pair with it, so it is discarded.
				if (final) {
					at = this.buffer.length;
				}
				break;
			}
			at = end;
		}
		if (at > 0) {
			this.consumed += at;
			this.buffer = this.buffer.slice(at);
		}
	}

	private emitText(from: number, to: number): void {
		if (to <= from) {
			return;
		}
		const start = this.consumed + from;
		const end = this.consumed + to;
		if (this.textStart >= 0 && start !== this.textEnd) {
			this.flushText();
		}
		if (this.textStart < 0) {
			this.textStart = start;
		}
		this.textBuffer += this.buffer.slice(from, to);
		this.textEnd = end;
	}

	private flushText(): void {
		if (this.textStart < 0 || this.textBuffer.length === 0) {
			this.textStart = -1;
			this.textEnd = -1;
			this.textBuffer = '';
			return;
		}
		const text = this.textBuffer;
		const start = this.textStart;
		const end = this.textEnd;
		this.textStart = -1;
		this.textEnd = -1;
		this.textBuffer = '';
		this.handlers.text(text, start, end);
	}

	/** Consumes one construct at `at`; returns the index past it, or -1 when incomplete. */
	private readConstruct(at: number, final: boolean): number {
		if (this.buffer.startsWith(COMMENT_OPEN, at)) {
			const close = this.buffer.indexOf(COMMENT_CLOSE, at + COMMENT_OPEN.length);
			if (close < 0) {
				return final ? this.buffer.length : -1;
			}
			return close + COMMENT_CLOSE.length;
		}
		if (this.buffer.startsWith(CDATA_OPEN, at)) {
			const close = this.buffer.indexOf(CDATA_CLOSE, at + CDATA_OPEN.length);
			if (close < 0) {
				return final ? this.buffer.length : -1;
			}
			this.emitText(at + CDATA_OPEN.length, close);
			return close + CDATA_CLOSE.length;
		}
		if (this.buffer.startsWith('<?', at)) {
			const close = this.buffer.indexOf(PI_CLOSE, at + 2);
			return close < 0 ? (final ? this.buffer.length : -1) : close + PI_CLOSE.length;
		}
		if (this.buffer.startsWith('<!', at)) {
			return this.skipDeclaration(at, final);
		}
		return this.readTag(at);
	}

	/** Reads one start/end/self-closing tag. */
	private readTag(at: number): number {
		const gt = this.tagEnd(at);
		if (gt < 0) {
			return -1;
		}
		const raw = this.buffer.slice(at, gt + 1);
		let cursor = 1;
		let closing = false;
		if (raw[cursor] === '/') {
			closing = true;
			cursor++;
		}
		const nameStart = cursor;
		while (cursor < raw.length && !isXmlWhitespace(raw[cursor]) && raw[cursor] !== '>' && raw[cursor] !== '/') {
			cursor++;
		}
		const name = stripXmlPrefix(raw.slice(nameStart, cursor));
		if (name === '') {
			return gt + 1;
		}
		const offset = this.consumed + at;
		if (closing) {
			this.handlers.close(name, offset);
			return gt + 1;
		}
		const attrs = this.readAttributes(raw, cursor);
		const selfClosing = raw.endsWith('/>');
		this.handlers.open(name, attrs, offset);
		if (selfClosing) {
			this.handlers.close(name, this.consumed + gt + 1);
		}
		return gt + 1;
	}

	/** The offset of the `>` that ends the tag at `at`, quote-aware. */
	private tagEnd(at: number): number {
		let quote: string | undefined;
		for (let j = at + 1; j < this.buffer.length; j++) {
			const c = this.buffer[j];
			if (quote !== undefined) {
				if (c === quote) {
					quote = undefined;
				}
			} else if (c === '"' || c === "'") {
				quote = c;
			} else if (c === '>') {
				return j;
			}
		}
		return -1;
	}

	private readAttributes(raw: string, from: number): Map<string, string> {
		const attrs = new Map<string, string>();
		let j = from;
		while (j < raw.length) {
			while (j < raw.length && isXmlWhitespace(raw[j])) {
				j++;
			}
			const c = raw[j];
			if (c === undefined || c === '>' || c === '/') {
				break;
			}
			const nameStart = j;
			while (j < raw.length && !isXmlWhitespace(raw[j]) && raw[j] !== '=' && raw[j] !== '>' && raw[j] !== '/') {
				j++;
			}
			const name = stripXmlPrefix(raw.slice(nameStart, j));
			while (j < raw.length && isXmlWhitespace(raw[j])) {
				j++;
			}
			if (raw[j] !== '=') {
				if (name !== '') {
					attrs.set(name, '');
				}
				continue;
			}
			j++;
			while (j < raw.length && isXmlWhitespace(raw[j])) {
				j++;
			}
			const quote = raw[j];
			if (quote === '"' || quote === "'") {
				j++;
				const valueStart = j;
				while (j < raw.length && raw[j] !== quote) {
					j++;
				}
				attrs.set(name, raw.slice(valueStart, j));
				if (j < raw.length) {
					j++;
				}
			} else {
				const valueStart = j;
				while (j < raw.length && !isXmlWhitespace(raw[j]) && raw[j] !== '>') {
					j++;
				}
				attrs.set(name, raw.slice(valueStart, j));
			}
		}
		return attrs;
	}

	/** Skips `<!DOCTYPE …>` including an internal subset in brackets. */
	private skipDeclaration(at: number, final: boolean): number {
		let depth = 0;
		let quote: string | undefined;
		for (let j = at + 2; j < this.buffer.length; j++) {
			const c = this.buffer[j];
			if (quote !== undefined) {
				if (c === quote) {
					quote = undefined;
				}
			} else if (c === '"' || c === "'") {
				quote = c;
			} else if (c === '[') {
				depth++;
			} else if (c === ']') {
				depth--;
			} else if (c === '>' && depth <= 0) {
				return j + 1;
			}
		}
		return final ? this.buffer.length : -1;
	}
}
