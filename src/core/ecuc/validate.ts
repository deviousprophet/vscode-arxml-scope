/**
 * Value validation and XML escaping (parent design §8, child design §2.5).
 *
 * Refusals return a reason and mutate nothing. An unchanged value is refused so
 * that idling cannot dirty the document. Container short names and definition
 * references share the XML-legality check and `escapeXml`; their grammars are
 * enforced here rather than in the write path, so a refusal can never leave a
 * partial write behind.
 */
import { ParameterNode } from './model';

export type ValidationResult = { ok: true; text: string } | { ok: false; reason: string };

const BOOLEAN = /^(true|false)$/;
const DECIMAL_INTEGER = /^-?\d+$/;
const HEXADECIMAL = /^0[xX][0-9A-Fa-f]+$/;
const DECIMAL_FRACTION = /^-?\d+\.\d+([eE][+-]?\d+)?$/;
const INTEGER_LITERAL = /^-?(?:\d+|0[xX][0-9A-Fa-f]+|0[bB][01]+)$/;
const FLOAT_LITERAL = /^-?(?:\d+|\d+\.\d+(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+)$/;

/** An AUTOSAR identifier: a letter or `_`, then letters, digits and `_`. */
const SHORT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * An absolute `/`-separated path with no empty segment. Segments stay permissive
 * (hyphens etc.) so a legitimate meta-model path is not refused; only structure and
 * XML hazards are enforced.
 */
const ABSOLUTE_PATH = /^\/[^\s/<>"'&]+(\/[^\s/<>"'&]+)*$/;

/** XML 1.0 legal characters; anything else cannot be represented even escaped. */
const ILLEGAL_XML = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;

/** The XML 1.0 legality refusal for `input`, or `undefined` when it can be written. */
function xmlRefusal(input: string, subject: string): string | undefined {
	return ILLEGAL_XML.test(input) ? `${subject} contains a character XML cannot represent` : undefined;
}

/**
 * Validates `input` for parameter `p` and returns the escaped text to write.
 * A known AUTOSAR `DEFINITION-REF DEST` narrows the accepted literal forms;
 * unknown/missing types keep the legacy numeric/text rule.
 */
export function validateValue(p: ParameterNode, input: string): ValidationResult {
	if (p.definitionDest === 'ECUC-BOOLEAN-PARAM-DEF' && !BOOLEAN.test(input)) {
		return { ok: false, reason: `"${input}" is not a boolean value (true or false)` };
	}
	if (p.definitionDest === 'ECUC-INTEGER-PARAM-DEF' && !INTEGER_LITERAL.test(input)) {
		return { ok: false, reason: `"${input}" is not an integer (decimal, hexadecimal or binary)` };
	}
	if (p.definitionDest === 'ECUC-FLOAT-PARAM-DEF' && !FLOAT_LITERAL.test(input)) {
		return { ok: false, reason: `"${input}" is not a decimal or floating-point value` };
	}
	if (
		p.definitionDest !== 'ECUC-BOOLEAN-PARAM-DEF' &&
		p.definitionDest !== 'ECUC-INTEGER-PARAM-DEF' &&
		p.definitionDest !== 'ECUC-FLOAT-PARAM-DEF' &&
		p.numeric &&
		!isNumericLiteral(input)
	) {
		return { ok: false, reason: `"${input}" is not a valid numerical value (true, false, integer, hexadecimal or decimal fraction)` };
	}
	const illegal = xmlRefusal(input, 'the value');
	if (illegal) {
		return { ok: false, reason: illegal };
	}
	if (input === (p.displayValue ?? '')) {
		return { ok: false, reason: 'the value is unchanged' };
	}
	return { ok: true, text: escapeXml(input) };
}

/**
 * Validates `input` as a container's `SHORT-NAME` text and returns the escaped text
 * to write. The grammar is the AUTOSAR identifier rule, so whitespace, `/`,
 * punctuation and XML-unrepresentable characters are all refused.
 */
export function validateShortName(input: string): ValidationResult {
	if (input === '') {
		return { ok: false, reason: 'the short name is empty' };
	}
	const illegal = xmlRefusal(input, 'the short name');
	if (illegal) {
		return { ok: false, reason: illegal };
	}
	if (!SHORT_NAME.test(input)) {
		return {
			ok: false,
			reason: `"${input}" is not a valid short name (letters, digits and underscores, not starting with a digit)`,
		};
	}
	return { ok: true, text: escapeXml(input) };
}

/**
 * Validates `input` as a container's `DEFINITION-REF` text and returns the escaped
 * text to write. Only the path structure and the XML hazards are enforced, so a
 * meta-model path whose segments are not identifiers is still accepted.
 */
export function validateDefinitionRef(input: string): ValidationResult {
	if (input === '') {
		return { ok: false, reason: 'the definition reference is empty' };
	}
	const illegal = xmlRefusal(input, 'the definition reference');
	if (illegal) {
		return { ok: false, reason: illegal };
	}
	if (!ABSOLUTE_PATH.test(input)) {
		return {
			ok: false,
			reason: `"${input}" is not a valid definition reference path (an absolute /-separated path)`,
		};
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
