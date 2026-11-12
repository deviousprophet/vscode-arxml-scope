/**
 * Range predicates shared by the field edit plan and the structural edit plan.
 */
import type { Range } from '../core/ecuc/model';

/**
 * True when `range` is inside, or straddles, a `<![CDATA[…]]>` section.
 *
 * The scanner points a value's range at the *inside* of a CDATA section, and the bytes
 * there are not interchangeable with escaped text content. Writing escaped text into one
 * changes what a conforming XML parser reads (`&amp;` is the literal four characters
 * inside CDATA); a section whose content begins with `<` is mistaken for an element by the
 * byte rule above, and gets that markup written back into the value; and a range that
 * crosses a marker deletes the `]]>` and leaves the section unterminated, which is not
 * well-formed XML at all. Every one of those is a refusal rather than a write; editing a
 * CDATA-backed value is out of scope (`implement.md`, decision 5), and this is what makes
 * that a refusal instead of silent damage.
 */
export function touchesCdata(text: string, range: Range): boolean {
	const bytes = text.slice(range.start, range.end);
	if (hasCdataMarker(bytes)) {
		return true;
	}
	const open = text.lastIndexOf('<![CDATA[', range.start);
	if (open < 0) {
		return false;
	}
	const close = text.indexOf(']]>', open + 9);
	return crossesCdataStart(close, range.start);
}

/** The range itself carries a CDATA marker. */
function hasCdataMarker(bytes: string): boolean {
	return bytes.includes('<![CDATA[') || bytes.includes(']]>');
}

/** True when the section that opened before the range is still open at its start. */
function crossesCdataStart(close: number, start: number): boolean {
	return close < 0 || close > start;
}
