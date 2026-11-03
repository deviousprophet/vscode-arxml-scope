/**
 * ECUC numeric literal parsing shared by value formatting and validation.
 * Integers use `BigInt`: an AUTOSAR 64-bit value must not round-trip through a
 * JavaScript `number`.
 */
export function ecucIntegerValue(value: string): bigint | undefined {
	let raw = value.trim();
	if (raw === '') {
		return undefined;
	}
	let sign = 1n;
	if (raw.startsWith('-') || raw.startsWith('+')) {
		sign = raw.startsWith('-') ? -1n : 1n;
		raw = raw.slice(1);
	}
	let parsed: bigint;
	if (/^0[xX][0-9A-Fa-f]+$/.test(raw)) {
		parsed = BigInt(raw);
	} else if (/^0[bB][01]+$/.test(raw)) {
		parsed = BigInt(raw);
	} else if (/^\d+$/.test(raw)) {
		parsed = BigInt(raw);
	} else {
		return undefined;
	}
	return sign * parsed;
}
