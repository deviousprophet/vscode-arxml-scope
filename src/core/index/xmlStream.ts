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
import { isXmlWhitespace, markupDeclarationEnd, stripXmlPrefix } from '../text/xmlText';

export interface XmlStreamHandlers {
	/** An opening tag. `offset` is the `<`. */
	open(name: string, attrs: ReadonlyMap<string, string>, offset: number): void;
	/** A closing tag. `offset` is just past the `>` of `</…>`. */
	close(name: string, offset: number): void;
	/** Character data between tags. Offsets bound the raw text. */
	text(text: string, start: number, end: number): void;
}

const CDATA_OPEN = '<![CDATA[';
const CDATA_CLOSE = ']]>';
const COMMENT_OPEN = '<!--';
const COMMENT_CLOSE = '-->';
const PI_CLOSE = '?>';

/** One tag header: the stripped name, the cursor past it, and whether it closes. */
interface TagScan {
	name: string;
	cursor: number;
	closing: boolean;
}

/** One attribute: its name, value, end cursor and whether it is stored at all. */
interface AttributeScan {
	name: string;
	value: string;
	next: number;
	assign: boolean;
}

/** The text and the cursor past one attribute value. */
interface AttributeValue {
	text: string;
	next: number;
}

/** One loop step: where the construct starts and where the next one starts. */
interface ConsumeStep {
	at: number;
	end: number;
}

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
		const at = this.consumeRange(final);
		if (at > 0) {
			this.consumed += at;
			this.buffer = this.buffer.slice(at);
		}
	}

	/** Consumes every complete construct; returns the buffer prefix length to drop. */
	private consumeRange(final: boolean): number {
		let at = 0;
		while (at < this.buffer.length) {
			const step = this.consumeStep(at, final);
			if (step.end < 0) {
				return this.stoppedAt(step.at, final);
			}
			at = step.end;
		}
		return at;
	}

	/** The prefix to drop when a construct is incomplete: all of it at end-of-stream. */
	private stoppedAt(at: number, final: boolean): number {
		return final ? this.buffer.length : at;
	}

	/** Consumes the text and one construct at `at`; `end` is -1 when the construct is incomplete. */
	private consumeStep(at: number, final: boolean): ConsumeStep {
		const lt = this.buffer.indexOf('<', at);
		if (lt < 0) {
			this.emitText(at, this.buffer.length);
			return { at: this.buffer.length, end: this.buffer.length };
		}
		if (lt > at) {
			this.emitText(at, lt);
		}
		// A construct always ends a text run: flush before parsing it, so a text run
		// split by the chunk boundary is still emitted as one event.
		this.flushText();
		return { at: lt, end: this.readConstruct(lt, final) };
	}

	private emitText(from: number, to: number): void {
		if (to <= from) {
			return;
		}
		if (this.breaksTextRun(from)) {
			this.flushText();
		}
		this.appendText(from, to);
	}

	/** True when the run so far ended before this range, so it must be flushed first. */
	private breaksTextRun(from: number): boolean {
		return this.textStart >= 0 && this.consumed + from !== this.textEnd;
	}

	private appendText(from: number, to: number): void {
		if (this.textStart < 0) {
			this.textStart = this.consumed + from;
		}
		this.textBuffer += this.buffer.slice(from, to);
		this.textEnd = this.consumed + to;
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
		const skipped = this.skipMarkup(at, final);
		return skipped === undefined ? this.readTag(at) : skipped;
	}

	/** Skips a comment, CDATA, PI or declaration at `at`; `undefined` when a tag starts there. */
	private skipMarkup(at: number, final: boolean): number | undefined {
		const comment = this.skipComment(at, final);
		if (comment !== undefined) {
			return comment;
		}
		const cdata = this.readCdata(at, final);
		if (cdata !== undefined) {
			return cdata;
		}
		const instruction = this.skipInstruction(at, final);
		if (instruction !== undefined) {
			return instruction;
		}
		return this.skipDeclarationTag(at, final);
	}

	private skipComment(at: number, final: boolean): number | undefined {
		if (!this.buffer.startsWith(COMMENT_OPEN, at)) {
			return undefined;
		}
		return this.advancePast(at + COMMENT_OPEN.length, COMMENT_CLOSE, final);
	}

	private readCdata(at: number, final: boolean): number | undefined {
		if (!this.buffer.startsWith(CDATA_OPEN, at)) {
			return undefined;
		}
		const close = this.buffer.indexOf(CDATA_CLOSE, at + CDATA_OPEN.length);
		if (close < 0) {
			return this.incompleteEnd(final);
		}
		this.emitText(at + CDATA_OPEN.length, close);
		return close + CDATA_CLOSE.length;
	}

	private skipInstruction(at: number, final: boolean): number | undefined {
		if (!this.buffer.startsWith('<?', at)) {
			return undefined;
		}
		return this.advancePast(at + 2, PI_CLOSE, final);
	}

	private skipDeclarationTag(at: number, final: boolean): number | undefined {
		if (!this.buffer.startsWith('<!', at)) {
			return undefined;
		}
		return this.skipDeclaration(at, final);
	}

	/** The cursor past `closeToken`, or the incomplete marker at end-of-stream. */
	private advancePast(from: number, closeToken: string, final: boolean): number {
		const close = this.buffer.indexOf(closeToken, from);
		return close < 0 ? this.incompleteEnd(final) : close + closeToken.length;
	}

	private incompleteEnd(final: boolean): number {
		return final ? this.buffer.length : -1;
	}

	/** Reads one start/end/self-closing tag. */
	private readTag(at: number): number {
		const gt = this.tagEnd(at);
		if (gt < 0) {
			return -1;
		}
		this.emitTag(this.buffer.slice(at, gt + 1), at, gt);
		return gt + 1;
	}

	private emitTag(raw: string, at: number, gt: number): void {
		const tag = scanTag(raw);
		if (tag.name === '') {
			return;
		}
		const end = this.consumed + gt + 1;
		if (tag.closing) {
			this.handlers.close(tag.name, end);
			return;
		}
		this.handlers.open(tag.name, this.readAttributes(raw, tag.cursor), this.consumed + at);
		if (raw.endsWith('/>')) {
			this.handlers.close(tag.name, end);
		}
	}

	/** The offset of the `>` that ends the tag at `at`, quote-aware. */
	private tagEnd(at: number): number {
		let quote: string | undefined;
		for (let j = at + 1; j < this.buffer.length; j++) {
			const character = this.buffer[j];
			quote = nextQuote(quote, character);
			if (isTagClose(quote, character)) {
				return j;
			}
		}
		return -1;
	}

	private readAttributes(raw: string, from: number): Map<string, string> {
		const attrs = new Map<string, string>();
		let at = from;
		while (at < raw.length) {
			at = skipWhitespace(raw, at);
			if (isAttributeListEnd(raw[at])) {
				break;
			}
			const attribute = scanAttribute(raw, at);
			if (attribute.assign) {
				attrs.set(attribute.name, attribute.value);
			}
			at = attribute.next;
		}
		return attrs;
	}

	/** Skips `<!DOCTYPE …>` including an internal subset in brackets. */
	private skipDeclaration(at: number, final: boolean): number {
		const end = markupDeclarationEnd(this.buffer, at);
		if (end >= 0) {
			return end;
		}
		return final ? this.buffer.length : -1;
	}
}

/** The next quote state after one character of a tag header. */
function nextQuote(quote: string | undefined, character: string): string | undefined {
	if (quote !== undefined) {
		return character === quote ? undefined : quote;
	}
	return isQuote(character) ? character : undefined;
}

function isQuote(character: string): boolean {
	return character === '"' || character === "'";
}

function isTagClose(quote: string | undefined, character: string): boolean {
	return quote === undefined && character === '>';
}

function scanTag(raw: string): TagScan {
	const closing = raw[1] === '/';
	const start = closing ? 2 : 1;
	const cursor = scanTagName(raw, start);
	return { name: stripXmlPrefix(raw.slice(start, cursor)), cursor, closing };
}

function scanTagName(raw: string, from: number): number {
	let cursor = from;
	while (cursor < raw.length && !isTagNameTerminator(raw[cursor])) {
		cursor++;
	}
	return cursor;
}

function isTagNameTerminator(character: string): boolean {
	return character === '>' || character === '/' || isXmlWhitespace(character);
}

function scanAttribute(raw: string, from: number): AttributeScan {
	const nameEnd = scanAttributeName(raw, from);
	const name = stripXmlPrefix(raw.slice(from, nameEnd));
	const afterName = skipWhitespace(raw, nameEnd);
	if (raw[afterName] !== '=') {
		return { name, value: '', next: afterName, assign: name !== '' };
	}
	const value = scanAttributeValue(raw, skipWhitespace(raw, afterName + 1));
	return { name, value: value.text, next: value.next, assign: true };
}

function scanAttributeName(raw: string, from: number): number {
	let at = from;
	while (at < raw.length && !isAttributeNameEnd(raw[at])) {
		at++;
	}
	return at;
}

function isAttributeNameEnd(character: string): boolean {
	return character === '=' || character === '>' || character === '/' || isXmlWhitespace(character);
}

function scanAttributeValue(raw: string, from: number): AttributeValue {
	const quote = raw[from];
	if (isQuote(quote)) {
		const close = scanUntil(raw, from + 1, quote);
		return { text: raw.slice(from + 1, close), next: afterClose(raw, close) };
	}
	const end = scanUnquoted(raw, from);
	return { text: raw.slice(from, end), next: end };
}

function scanUntil(raw: string, from: number, character: string): number {
	let at = from;
	while (at < raw.length && raw[at] !== character) {
		at++;
	}
	return at;
}

/** The cursor just past a closing quote, or the end of the tag when it never closed. */
function afterClose(raw: string, close: number): number {
	return close < raw.length ? close + 1 : close;
}

function scanUnquoted(raw: string, from: number): number {
	let at = from;
	while (at < raw.length && !isUnquotedValueEnd(raw[at])) {
		at++;
	}
	return at;
}

function isUnquotedValueEnd(character: string): boolean {
	return character === '>' || isXmlWhitespace(character);
}

function skipWhitespace(raw: string, from: number): number {
	let at = from;
	while (at < raw.length && isXmlWhitespace(raw[at])) {
		at++;
	}
	return at;
}

function isAttributeListEnd(character: string | undefined): boolean {
	return character === undefined || character === '>' || character === '/';
}
