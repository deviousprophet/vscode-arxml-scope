/**
 * XML text helpers shared by the ECUC scanner and the workspace index.
 *
 * The decoders are deliberately small: ARXML values are display text, and the
 * five predefined entities plus numeric character references are the only ones
 * an entity-aware reader needs. A custom or unknown entity is left verbatim.
 */

/** Decodes the predefined and numeric XML entity references in `raw`. */
export function decodeXml(raw: string): string {
	return raw.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
		if (body.startsWith('#x') || body.startsWith('#X')) {
			const code = Number.parseInt(body.slice(2), 16);
			return Number.isFinite(code) ? String.fromCodePoint(code) : match;
		}
		if (body.startsWith('#')) {
			const code = Number.parseInt(body.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : match;
		}
		switch (body) {
			case 'amp':
				return '&';
			case 'lt':
				return '<';
			case 'gt':
				return '>';
			case 'quot':
				return '"';
			case 'apos':
				return "'";
			default:
				return match;
		}
	});
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
