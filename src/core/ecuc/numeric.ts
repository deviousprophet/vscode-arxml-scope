/**
 * ECUC numeric literal parsing shared by value formatting and validation.
 * Integers use `BigInt`: an AUTOSAR 64-bit value must not round-trip through a
 * JavaScript `number`.
 */
const HEX_INTEGER = /^0[xX][0-9A-Fa-f]+$/;
const BINARY_INTEGER = /^0[bB][01]+$/;
const DECIMAL_INTEGER = /^\d+$/;

/** The literal's sign and the digits without it. */
interface SignedLiteral {
	value: bigint;
	body: string;
}

/** Splits a leading `+`/`-` from the literal body. */
function signedLiteral(raw: string): SignedLiteral {
	if (raw.startsWith('-') || raw.startsWith('+')) {
		return { value: raw.startsWith('-') ? -1n : 1n, body: raw.slice(1) };
	}
	return { value: 1n, body: raw };
}

/** Parses the unsigned body of a decimal, hexadecimal or binary integer. */
function unsignedInteger(body: string): bigint | undefined {
	if (HEX_INTEGER.test(body) || BINARY_INTEGER.test(body)) {
		return BigInt(body);
	}
	if (DECIMAL_INTEGER.test(body)) {
		return BigInt(body);
	}
	return undefined;
}

export function ecucIntegerValue(value: string): bigint | undefined {
	const raw = value.trim();
	if (raw === '') {
		return undefined;
	}
	const literal = signedLiteral(raw);
	const parsed = unsignedInteger(literal.body);
	return parsed === undefined ? undefined : literal.value * parsed;
}
