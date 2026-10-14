/**
 * Value validation and XML escaping (parent design §8, child design §2.5).
 *
 * Refusals return a reason and mutate nothing. An unchanged value is refused so
 * that idling cannot dirty the document.
 */
import { ParameterNode } from './model';

export type ValidationResult = { ok: true; text: string } | { ok: false; reason: string };

const BOOLEAN = /^(true|false)$/;
const DECIMAL_INTEGER = /^-?\d+$/;
const HEXADECIMAL = /^0[xX][0-9A-Fa-f]+$/;
const DECIMAL_FRACTION = /^-?\d+\.\d+([eE][+-]?\d+)?$/;

/** XML 1.0 legal characters; anything else cannot be represented even escaped. */
const ILLEGAL_XML = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;

/**
 * Validates `input` for parameter `p` and returns the escaped text to write.
 */
export function validateValue(p: ParameterNode, input: string): ValidationResult {
	if (p.numeric && !isNumericLiteral(input)) {
		return { ok: false, reason: `"${input}" is not a valid numerical value (true, false, integer, hexadecimal or decimal fraction)` };
	}
	const illegal = ILLEGAL_XML.exec(input);
	if (illegal) {
		return { ok: false, reason: 'the value contains a character XML cannot represent' };
	}
	if (input === (p.displayValue ?? '')) {
		return { ok: false, reason: 'the value is unchanged' };
	}
	return { ok: true, text: escapeXml(input) };
}

/** True for the literal forms a numerical parameter accepts. */
export function isNumericLiteral(input: string): boolean {
	return (
		BOOLEAN.test(input) ||
		DECIMAL_INTEGER.test(input) ||
		HEXADECIMAL.test(input) ||
		DECIMAL_FRACTION.test(input)
	);
}

/** `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`, in that order. */
export function escapeXml(input: string): string {
	return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
