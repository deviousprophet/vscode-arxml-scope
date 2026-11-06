/**
 * Byte-order-mark and XML-declaration detection for the streamed index reader.
 *
 * The reader feeds decoded text to the XML tokenizer, so the encoding must be
 * chosen before the first chunk is decoded. Detection is deliberately small: a
 * BOM wins, then the declaration's `encoding` attribute. Anything outside the
 * supported set is refused instead of decoded as mojibake.
 */

export interface DetectedEncoding {
	/** A label accepted by `TextDecoder`. */
	label: string;
	/** Bytes to skip before decoding (the BOM length). */
	bomBytes: number;
}

const SUPPORTED = new Map<string, string>([
	['utf-8', 'utf-8'],
	['utf8', 'utf-8'],
	['utf-16le', 'utf-16le'],
	['utf-16', 'utf-16le'],
	['utf-16be', 'utf-16be'],
	['iso-8859-1', 'iso-8859-1'],
	['latin1', 'iso-8859-1'],
	['windows-1252', 'windows-1252'],
	['cp1252', 'windows-1252'],
	['us-ascii', 'windows-1252'],
]);

/** Reads the first chunk's BOM and XML declaration. */
export function detectEncoding(head: Uint8Array): DetectedEncoding | undefined {
	if (
		head.length >= 4 &&
		head[0] === 0xff &&
		head[1] === 0xfe &&
		head[2] === 0x00 &&
		head[3] === 0x00
	) {
		return undefined; // UTF-32LE is not supported
	}
	if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
		return { label: 'utf-8', bomBytes: 3 };
	}
	if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) {
		return { label: 'utf-16le', bomBytes: 2 };
	}
	if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) {
		return { label: 'utf-16be', bomBytes: 2 };
	}

	// The declaration is ASCII-compatible for every supported encoding without a
	// BOM. A UTF-16 file without a BOM is not guessed.
	const sample = Buffer.from(head.subarray(0, Math.min(head.length, 256))).toString('latin1');
	const match = /<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(sample);
	if (match === null) {
		return { label: 'utf-8', bomBytes: 0 };
	}
	const label = SUPPORTED.get(match[1].trim().toLowerCase());
	return label === undefined ? undefined : { label, bomBytes: 0 };
}
