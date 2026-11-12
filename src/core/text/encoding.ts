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

/** One BOM probe: a hit, a definite refusal, or no BOM at all. */
type BomDetection =
	| { kind: 'found'; encoding: DetectedEncoding }
	| { kind: 'refused' }
	| { kind: 'none' };

/** True when `head` starts with exactly the given bytes. */
function bytesAt(head: Uint8Array, ...expected: number[]): boolean {
	if (head.length < expected.length) {
		return false;
	}
	return expected.every((byte, at) => head[at] === byte);
}

/** The encoding a BOM names, when the head starts with one. */
function bomEncoding(head: Uint8Array): DetectedEncoding | undefined {
	if (bytesAt(head, 0xef, 0xbb, 0xbf)) {
		return { label: 'utf-8', bomBytes: 3 };
	}
	if (bytesAt(head, 0xff, 0xfe)) {
		return { label: 'utf-16le', bomBytes: 2 };
	}
	if (bytesAt(head, 0xfe, 0xff)) {
		return { label: 'utf-16be', bomBytes: 2 };
	}
	return undefined;
}

/** Resolves the BOM probes in precedence order, refusing UTF-32LE explicitly. */
function bomDetection(head: Uint8Array): BomDetection {
	if (bytesAt(head, 0xff, 0xfe, 0x00, 0x00)) {
		return { kind: 'refused' }; // UTF-32LE is not supported
	}
	const encoding = bomEncoding(head);
	return encoding === undefined ? { kind: 'none' } : { kind: 'found', encoding };
}

/** The first 256 bytes as one character per byte, for the declaration regex. */
function asciiSample(head: Uint8Array): string {
	const limit = Math.min(head.length, 256);
	let sample = '';
	for (let at = 0; at < limit; at++) {
		sample += String.fromCharCode(head[at]);
	}
	return sample;
}

/** The declaration's `encoding` attribute, or the UTF-8 default. */
function declaredEncoding(head: Uint8Array): DetectedEncoding | undefined {
	const match = /<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(asciiSample(head));
	if (match === null) {
		return { label: 'utf-8', bomBytes: 0 };
	}
	const label = SUPPORTED.get(match[1].trim().toLowerCase());
	return label === undefined ? undefined : { label, bomBytes: 0 };
}

/** Reads the first chunk's BOM and XML declaration. */
export function detectEncoding(head: Uint8Array): DetectedEncoding | undefined {
	const bom = bomDetection(head);
	if (bom.kind === 'found') {
		return bom.encoding;
	}
	if (bom.kind === 'refused') {
		return undefined;
	}
	// The declaration is ASCII-compatible for every supported encoding without a
	// BOM. A UTF-16 file without a BOM is not guessed.
	return declaredEncoding(head);
}
