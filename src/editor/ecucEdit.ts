/**
 * The write path (child design §2.1–§2.3).
 *
 * An edit record names a **region**, never an offset. A value's length changes when it
 * is edited, so every offset after it shifts and a range stored at edit time would be
 * wrong for the next one; `applyEdit` therefore re-scans, re-finds the node by its
 * path-based id and recomputes the region (§2.2).
 *
 * There is no document class, no `CustomDocumentEditEvent` and no private history:
 * `CustomTextEditorProvider` has no hook for them, and because every write targets the
 * real `TextDocument`, undo, redo, dirty state and save are VS Code's own (§2.4, §2.7).
 * One record becomes exactly one `WorkspaceEdit`.
 */
import * as vscode from 'vscode';
import { EcucDocumentModel, ParameterNode, Range } from '../core/ecuc/model';
import { scanEcucValues } from '../core/ecuc/scanner';
import { validateValue } from '../core/ecuc/validate';
import { LineIndex } from '../core/text/offsets';
import { buildNodeIndex } from './nodeId';

/** `value` is the text content inside `<VALUE>…</VALUE>`; `element` is the whole element. */
export type EditRegion = 'value' | 'element';

/** The exact strings that occupied and will occupy the region (design §2.1). */
export interface EcucEditRecord {
	nodeId: string;
	region: EditRegion;
	oldText: string;
	newText: string;
}

export type EditRefusal = { ok: false; reason: string };
export type EditPlan = { ok: true; record: EcucEditRecord } | EditRefusal;
export type ApplyResult = { ok: true } | EditRefusal;

/** The value-bearing node for `nodeId`, or `undefined` when it is absent or not a parameter. */
export function parameterFor(model: EcucDocumentModel, nodeId: string): ParameterNode | undefined {
	const entry = buildNodeIndex(model).byId.get(nodeId);
	return entry?.kind === 'parameter' ? (entry.node as ParameterNode) : undefined;
}

/**
 * The span a write must touch, resolved from the node's ranges in `text`.
 *
 * `element` is the whole `<VALUE/>` slice, `value` the text content inside the tags. The
 * rule is the bytes rather than the decoded value: an element slice begins with `<`.
 * `undefined` means the node has nothing of that kind to replace, which is a refusal —
 * including a range inside a CDATA section, which has no region of either kind
 * (`touchesCdata`).
 */
export function regionOf(
	parameter: ParameterNode,
	text: string,
	region: EditRegion
): { range: Range; oldText: string } | undefined {
	const valueRange = parameter.valueRange;
	if (!valueRange) {
		return undefined;
	}
	let range: Range;
	if (region === 'value') {
		if (text[valueRange.start] === '<') {
			return undefined; // the range covers the element, not its text content
		}
		range = valueRange;
	} else {
		range = elementSpan(text, valueRange);
	}
	if (touchesCdata(text, range)) {
		return undefined; // a CDATA section is neither text content nor an element
	}
	return { range, oldText: text.slice(range.start, range.end) };
}

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
function touchesCdata(text: string, range: Range): boolean {
	const bytes = text.slice(range.start, range.end);
	if (bytes.includes('<![CDATA[') || bytes.includes(']]>')) {
		return true;
	}
	const open = text.lastIndexOf('<![CDATA[', range.start);
	if (open < 0) {
		return false;
	}
	const close = text.indexOf(']]>', open + 9);
	return close < 0 || close > range.start;
}

/**
 * The whole `<VALUE>…</VALUE>` element around `valueRange`.
 *
 * For an empty or self-closing value the scanner already points at the element, so the
 * outward expansion is only needed once such a value has been given text — the case
 * design §2.2 describes. The closing tag's `>` is found from the `</` that follows the
 * text, never from the text's last character: a raw `>` is legal unescaped in XML text,
 * so a value ending in one (`<VALUE>a></VALUE>`) would otherwise have its own `>`
 * mistaken for the closing tag's and the span would stop short of `</VALUE>`.
 */
function elementSpan(text: string, valueRange: Range): Range {
	if (text[valueRange.start] === '<') {
		return valueRange;
	}
	const closeTag = text.indexOf('</', valueRange.end);
	const end = closeTag < 0 ? text.indexOf('>', valueRange.end) + 1 : tagEnd(text, closeTag);
	return {
		start: text.lastIndexOf('<', valueRange.start),
		// `-1` only from a tag with no `>` at all (malformed input): keep the text's own end
		// rather than building a range that ends before it starts.
		end: end < 0 ? valueRange.end : end,
	};
}

/**
 * Offset just past the `>` that ends the tag starting at `start`, or `-1` when there is
 * none.
 *
 * Quote-aware, because `>` is legal unescaped inside an attribute value: the first `>`
 * is not necessarily the end of the tag. The scanner's lexer is quote-aware for the same
 * reason, so a writer that is not would rewrite the element without its closing quote and
 * every attribute after it — a silent corruption of a well-formed input.
 */
function tagEnd(text: string, start: number): number {
	let quote = '';
	for (let i = start + 1; i < text.length; i++) {
		const c = text[i];
		if (quote !== '') {
			if (c === quote) {
				quote = '';
			}
		} else if (c === '"' || c === "'") {
			quote = c;
		} else if (c === '>') {
			return i + 1;
		}
	}
	return -1;
}

/**
 * The exact string that will occupy an `element` region: `<VALUE>` + escaped + `</VALUE>`.
 * The element's own open and close tags are kept verbatim, so a namespace prefix, an
 * attribute or a space before the slash survives (parent design §8, shape 2).
 */
export function wrapElement(slice: string, escaped: string): string {
	const gt = tagEnd(slice, 0);
	const open = (gt < 0 ? slice : slice.slice(0, gt)).replace(/[\s/]+>$/, '>');
	const lt = slice.lastIndexOf('<');
	const closing = gt >= 0 && lt >= gt && slice[lt + 1] === '/' ? slice.slice(lt) : `</${tagName(open)}>`;
	return open + escaped + closing;
}

function tagName(open: string): string {
	return open.slice(1, -1).split(/[\s/>]/, 1)[0];
}

/**
 * Validates `value` and describes the byte-level replacement, or refuses (design §2.3,
 * §2.5). Nothing is mutated here, so a refusal costs no partial write: the whole
 * replacement is either applied or not. Validation runs before `applyEdit`, always.
 */
export function buildEdit(
	model: EcucDocumentModel,
	text: string,
	nodeId: string,
	value: string
): EditPlan {
	const parameter = parameterFor(model, nodeId);
	if (!parameter) {
		return { ok: false, reason: 'the node is no longer in the file' };
	}
	const valueRange = parameter.valueRange;
	if (!valueRange) {
		return { ok: false, reason: `"${parameter.name}" has no <VALUE> element to edit` };
	}
	if (touchesCdata(text, valueRange)) {
		return { ok: false, reason: `"${parameter.name}" is stored in a CDATA section, which this editor does not edit` };
	}
	const validation = validateValue(parameter, value);
	if (!validation.ok) {
		return validation;
	}
	const region: EditRegion = text[valueRange.start] === '<' ? 'element' : 'value';
	const described = regionOf(parameter, text, region);
	if (!described) {
		return { ok: false, reason: `"${parameter.name}" has no <VALUE> element to edit` };
	}
	return {
		ok: true,
		record: {
			nodeId,
			region,
			oldText: described.oldText,
			newText: region === 'element' ? wrapElement(described.oldText, validation.text) : validation.text,
		},
	};
}

/**
 * Applies `record` as exactly one `WorkspaceEdit`, after recomputing the region from a
 * fresh scan (design §2.2, §2.7). Nothing else is written, so the document is never
 * reformatted and no derived file exists to write.
 */
export async function applyEdit(
	document: vscode.TextDocument,
	record: EcucEditRecord
): Promise<ApplyResult> {
	const text = document.getText();
	const parameter = parameterFor(scanEcucValues(text), record.nodeId);
	if (!parameter) {
		return { ok: false, reason: 'the node is no longer in the file' };
	}
	const described = regionOf(parameter, text, record.region);
	if (!described) {
		return { ok: false, reason: `"${parameter.name}" no longer has a ${record.region} to replace` };
	}
	if (described.oldText !== record.oldText) {
		// The bytes under the region moved since the edit was prepared; writing now would
		// replace text the user never saw.
		return { ok: false, reason: 'the file changed since the value was read; try again' };
	}
	const lineIndex = new LineIndex(text);
	const start = lineIndex.positionAt(described.range.start);
	const end = lineIndex.positionAt(described.range.end);
	const edit = new vscode.WorkspaceEdit();
	edit.replace(
		document.uri,
		new vscode.Range(start.line, start.character, end.line, end.character),
		record.newText
	);
	if (!(await vscode.workspace.applyEdit(edit))) {
		return { ok: false, reason: 'VS Code refused the edit' };
	}
	return { ok: true };
}
