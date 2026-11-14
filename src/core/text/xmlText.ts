/**
 * XML text helpers shared by the ECUC scanner and the workspace index.
 *
 * The decoders are deliberately small: ARXML values are display text, and the
 * five predefined entities plus numeric character references are the only ones
 * an entity-aware reader needs. A custom or unknown entity is left verbatim.
 */

const NAMED_ENTITIES = new Map<string, string>([
	['amp', '&'],
	['lt', '<'],
	['gt', '>'],
	['quot', '"'],
	['apos', "'"],
]);

/** True when a numeric reference body uses the hexadecimal form. */
function isHexCharRef(body: string): boolean {
	return body.startsWith('#x') || body.startsWith('#X');
}

/** True when `code` is a Unicode scalar value. */
function inUnicodeRange(code: number): boolean {
	return code >= 0 && code <= 0x10ffff;
}

/** True for a lone surrogate, which `String.fromCodePoint` accepts but XML does not. */
function isSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdfff;
}

/** Decodes one numeric reference; out-of-range or surrogate code points stay verbatim. */
function decodeCodePoint(match: string, digits: string, radix: number): string {
	const code = Number.parseInt(digits, radix);
	if (!Number.isFinite(code) || !inUnicodeRange(code) || isSurrogate(code)) {
		return match;
	}
	return String.fromCodePoint(code);
}

/** Decodes one entity-reference match; unknown names stay verbatim. */
function decodeEntity(match: string, body: string): string {
	if (isHexCharRef(body)) {
		return decodeCodePoint(match, body.slice(2), 16);
	}
	if (body.startsWith('#')) {
		return decodeCodePoint(match, body.slice(1), 10);
	}
	return NAMED_ENTITIES.get(body) ?? match;
}

/** Decodes the predefined and numeric XML entity references in `raw`. */
export function decodeXml(raw: string): string {
	return raw.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, decodeEntity);
}

/** True for the four XML whitespace characters. */
export function isXmlWhitespace(character: string | undefined): boolean {
	return character === ' ' || character === '\t' || character === '\n' || character === '\r';
}

/** Strips a namespace prefix from a tag or attribute name. */
export function stripXmlPrefix(name: string): string {
	const colon = name.lastIndexOf(':');
	return colon < 0 ? name : name.slice(colon + 1);
}

/** The mutable state of one declaration scan. */
interface DeclarationScan {
	quote: string | undefined;
	depth: number;
}

/** True for the two characters that open a quoted literal. */
function isQuoteCharacter(character: string): boolean {
	return character === '"' || character === "'";
}

/** True for the two internal-subset bracket characters. */
function isBracketCharacter(character: string): boolean {
	return character === '[' || character === ']';
}

/** Applies one bracket to the internal-subset depth. */
function adjustDepth(state: DeclarationScan, character: string): void {
	state.depth += character === '[' ? 1 : -1;
}

/** True when the character closes the declaration at the current depth. */
function isDeclarationTerminator(state: DeclarationScan, character: string): boolean {
	return character === '>' && state.depth <= 0;
}

/** A character inside a quoted literal only watches for its closing quote. */
function quotedStep(state: DeclarationScan, character: string): undefined {
	if (state.quote === character) {
		state.quote = undefined;
	}
	return undefined;
}

/** A character outside a literal opens a quote or bracket, or ends the declaration. */
function unquotedStep(state: DeclarationScan, character: string, at: number): number | undefined {
	if (isQuoteCharacter(character)) {
		state.quote = character;
		return undefined;
	}
	if (isBracketCharacter(character)) {
		adjustDepth(state, character);
		return undefined;
	}
	return isDeclarationTerminator(state, character) ? at + 1 : undefined;
}

/** One scan step; the declaration end offset, or `undefined` while it continues. */
function declarationStep(state: DeclarationScan, character: string, at: number): number | undefined {
	if (state.quote !== undefined) {
		return quotedStep(state, character);
	}
	return unquotedStep(state, character, at);
}

/**
 * The offset just past a `<!DOCTYPE …>` declaration, including an internal
 * subset in brackets, or `-1` when the declaration is not complete yet.
 * Shared by the whole-text scanner and the chunk-fed stream parser.
 */
export function markupDeclarationEnd(source: string, at: number): number {
	const state: DeclarationScan = { quote: undefined, depth: 0 };
	for (let index = at + 2; index < source.length; index++) {
		const end = declarationStep(state, source[index], index);
		if (end !== undefined) {
			return end;
		}
	}
	return -1;
}
