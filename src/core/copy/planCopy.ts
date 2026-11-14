/**
 * The two-way copy planner.
 *
 * One arrow copies one ECUC element from the pane that was clicked into the other
 * pane. This module turns that intent into the single text edit the host applies:
 *
 *   both sides have the row  → replace the target element with the source element
 *   only the source has it   → insert it after (or before) a target sibling
 *   only the target has it   → delete the target element with its line
 *
 * Pure: no `vscode`, no DOM. The host supplies the two texts, the element spans the
 * diff already carries, and the target indent; the planner returns one span or a reason.
 */

export interface CopyRange {
	start: number;
	end: number;
}

export interface CopySpan {
	start: number;
	end: number;
	text: string;
}

export type CopyPlan = { ok: true; span: CopySpan } | { ok: false; reason: string };

export interface CopyRequest {
	/** The document the arrow copies *into*. */
	targetText: string;
	/** The document the arrow copies *from*. */
	sourceText: string;
	/** The source element's whole span. */
	source: CopyRange;
	/** The target element's whole span, when the other side has this row. */
	target?: CopyRange;
	/** Where the target lacks the row: insert after this sibling element. */
	anchorAfter?: CopyRange;
	/** ...or before this sibling element, when nothing precedes it. */
	anchorBefore?: CopyRange;
	/** The indentation of the target parent's children. */
	targetIndent: string;
}

const STALE = 'the comparison changed; reload and try again';
const NO_ANCHOR = 'the target has no sibling to place this element next to';

function lineStart(text: string, from: number): number {
	let at = Math.min(from, text.length);
	while (at > 0 && text[at - 1] !== '\n' && text[at - 1] !== '\r') {
		at -= 1;
	}
	return at;
}

function lineEnd(text: string, from: number): number {
	let at = Math.min(from, text.length);
	while (at < text.length && text[at] !== '\n' && text[at] !== '\r') {
		at += 1;
	}
	return at;
}

function blank(text: string, start: number, end: number): boolean {
	return text.slice(start, end).trim() === '';
}

/** True when the element owns both ends of its line. */
function ownsWholeLine(text: string, range: CopyRange, start: number, end: number): boolean {
	return blank(text, start, range.start) && blank(text, range.end, end);
}

/** The offset past the line break that starts at `end`, if any. */
function afterLineBreak(text: string, end: number): number {
	if (end >= text.length) {
		return end;
	}
	return text[end] === '\r' && text[end + 1] === '\n' ? end + 2 : end + 1;
}

/** The whole-line span for an element that owns its line, or `undefined`. */
function wholeLineSpan(text: string, range: CopyRange): CopyRange | undefined {
	const start = lineStart(text, range.start);
	const end = lineEnd(text, range.end);
	return ownsWholeLine(text, range, start, end) ? { start, end: afterLineBreak(text, end) } : undefined;
}

/** The span that removes an element: its line when it owns it, else just the element. */
export function removalSpan(text: string, range: CopyRange): CopyRange {
	return wholeLineSpan(text, range) ?? range;
}

/** The indentation of the line the offset sits on. */
export function indentationAt(text: string, offset: number): string {
	const start = lineStart(text, offset);
	let end = start;
	while (end < text.length && (text[end] === ' ' || text[end] === '\t')) {
		end += 1;
	}
	return text.slice(start, end);
}

/** One line of a copied block, shifted by the indent delta. */
function shiftLine(line: string, sourceIndent: string, targetIndent: string): string {
	if (line.trim() === '') {
		return line;
	}
	const lead = /^[ \t]*/.exec(line)?.[0] ?? '';
	const width = Math.max(0, lead.length + targetIndent.length - sourceIndent.length);
	return `${' '.repeat(width)}${line.slice(lead.length)}`;
}

/** The document's own line break, the one a copied block must adopt. */
export function lineBreakOf(text: string): string {
	return text.includes('\r\n') ? '\r\n' : '\n';
}

/** Shifts every line of a copied block by the difference between the two indents. */
export function reindent(
	block: string,
	sourceIndent: string,
	targetIndent: string,
	lineBreak = lineBreakOf(block)
): string {
	return block
		.split(/\r?\n/)
		.map((line, index) => (index === 0 ? line : shiftLine(line, sourceIndent, targetIndent)))
		.join(lineBreak);
}

function replacement(request: CopyRequest): CopyPlan {
	const target = request.target as CopyRange;
	const sourceIndent = indentationAt(request.sourceText, request.source.start);
	const block = request.sourceText.slice(request.source.start, request.source.end);
	return {
		ok: true,
		span: {
			start: target.start,
			end: target.end,
			text: reindent(block, sourceIndent, request.targetIndent, lineBreakOf(request.targetText))
		}
	};
}

function deletion(request: CopyRequest): CopyPlan {
	const target = request.target as CopyRange;
	const span = removalSpan(request.targetText, target);
	return { ok: true, span: { start: span.start, end: span.end, text: '' } };
}

function insertion(request: CopyRequest): CopyPlan {
	const sourceIndent = indentationAt(request.sourceText, request.source.start);
	const block = reindent(
		request.sourceText.slice(request.source.start, request.source.end),
		sourceIndent,
		request.targetIndent,
		lineBreakOf(request.targetText)
	);
	const separator = lineBreakOf(request.targetText);
	if (request.anchorAfter !== undefined) {
		return {
			ok: true,
			span: {
				start: request.anchorAfter.end,
				end: request.anchorAfter.end,
				text: `${separator}${request.targetIndent}${block}`
			}
		};
	}
	if (request.anchorBefore !== undefined) {
		return {
			ok: true,
			span: {
				start: request.anchorBefore.start,
				end: request.anchorBefore.start,
				text: `${block}${separator}${request.targetIndent}`
			}
		};
	}
	return { ok: false, reason: NO_ANCHOR };
}

/** One arrow's edit, or the reason it cannot be made. */
export function planCopy(request: CopyRequest): CopyPlan {
	if (request.target !== undefined) {
		return replacement(request);
	}
	if (request.anchorAfter !== undefined || request.anchorBefore !== undefined) {
		return insertion(request);
	}
	return { ok: false, reason: NO_ANCHOR };
}

/** A copy that removes the target row (the source pane has no cell for it). */
export function planDelete(request: Omit<CopyRequest, 'source' | 'anchorAfter' | 'anchorBefore'>): CopyPlan {
	return request.target === undefined
		? { ok: false, reason: STALE }
		: deletion({ ...request, source: request.target });
}

/** One missing container between the copied element and the target parent. */
export interface MissingAncestor {
	shortName: string;
	definitionRef: string;
	definitionDest: string;
	/** The kind of the element nested inside this ancestor. */
	childKind: 'container' | 'parameter' | 'reference';
}

const LIST_TAG: Record<MissingAncestor['childKind'], string> = {
	container: 'SUB-CONTAINERS',
	parameter: 'PARAMETER-VALUES',
	reference: 'REFERENCE-VALUES'
};

/** One ancestor element wrapping the block below it. */
function wrapOne(
	block: string,
	childIndent: string,
	ancestor: MissingAncestor,
	wrapperIndent: string,
	lineBreak: string
): string {
	const fieldIndent = `${wrapperIndent}  `;
	const list = LIST_TAG[ancestor.childKind];
	return [
		'<ECUC-CONTAINER-VALUE>',
		`${fieldIndent}<SHORT-NAME>${ancestor.shortName}</SHORT-NAME>`,
		`${fieldIndent}<DEFINITION-REF DEST="${ancestor.definitionDest}">${ancestor.definitionRef}</DEFINITION-REF>`,
		`${fieldIndent}<${list}>`,
		`${childIndent}${block}`,
		`${fieldIndent}</${list}>`,
		`${wrapperIndent}</ECUC-CONTAINER-VALUE>`
	].join(lineBreak);
}

/**
 * Wraps a copied element in the missing ancestor containers, as minimal containers:
 * their own short name, definition ref and one child list holding only the copied
 * chain. Copying the source ancestors verbatim would import their unrelated children.
 *
 * `elementIndent` is the source indentation of the copied element; `targetIndent` is
 * the indentation the outermost created container must occupy.
 */
export function wrapWithAncestors(
	elementText: string,
	elementIndent: string,
	ancestors: readonly MissingAncestor[],
	targetIndent: string,
	lineBreak = lineBreakOf(elementText)
): string {
	let block = reindent(elementText, elementIndent, targetIndent + '    '.repeat(ancestors.length), lineBreak);
	let blockIndent = targetIndent + '    '.repeat(ancestors.length);
	for (let index = ancestors.length - 1; index >= 0; index--) {
		const wrapperIndent = targetIndent + '    '.repeat(index);
		block = wrapOne(block, blockIndent, ancestors[index], wrapperIndent, lineBreak);
		blockIndent = wrapperIndent;
	}
	return block;
}
