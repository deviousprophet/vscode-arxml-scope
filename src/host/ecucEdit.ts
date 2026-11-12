/**
 * The write path.
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
import { ContainerNode, EcucDocumentModel, ParameterNode, Range, lastShortName } from '../core/ecuc/model';
import { scanEcucValues } from '../core/ecuc/scanner';
import { ValidationResult, validateDefinitionRef, validateShortName, validateValue } from '../core/ecuc/validate';
import { LineIndex } from '../core/text/offsets';
import { EcucNode, buildNodeIndex } from '../core/ecuc/nodeId';
import { nodeIdForRange } from './navigation';
import { touchesCdata } from './editRange';

/**
 * `value` is the text content inside `<VALUE>…</VALUE>`; `element` is the whole element.
 * `shortName` and `definitionRef` are the trimmed text content of a container's
 * `<SHORT-NAME>` / `<DEFINITION-REF>` element, written as inner text so the element's own
 * tags and attributes survive byte-for-byte.
 */
export type EditRegion = 'value' | 'element' | 'shortName' | 'definitionRef';

/** The two fields the details panel edits on a container. */
export type EditableField = 'shortName' | 'definitionRef';

/** The exact strings that occupied and will occupy the region. */
export interface EcucEditRecord {
	nodeId: string;
	region: EditRegion;
	oldText: string;
	newText: string;
}

export type EditRefusal = { ok: false; reason: string };
export interface EditPlanOk {
	ok: true;
	record: EcucEditRecord;
	/** The id of the edited node after the write; differs for a rename. */
	nextNodeId?: string;
}
export type EditPlan = EditPlanOk | EditRefusal;
export type ApplyResult = { ok: true } | EditRefusal;

/** The value-bearing node for `nodeId`, or `undefined` when it is absent or not a parameter. */
export function parameterFor(model: EcucDocumentModel, nodeId: string): ParameterNode | undefined {
	const entry = buildNodeIndex(model).byId.get(nodeId);
	return entry?.kind === 'parameter' ? (entry.node as ParameterNode) : undefined;
}

/** The node `nodeId` names, whatever its kind, or `undefined` when it is absent. */
export function nodeFor(model: EcucDocumentModel, nodeId: string): EcucNode | undefined {
	return buildNodeIndex(model).byId.get(nodeId)?.node;
}

/** The node's short name (or definition-ref tail), for a refusal message. */
function nodeLabel(node: EcucNode): string {
	if (node.kind === 'parameter' || node.kind === 'reference') {
		return node.name;
	}
	return node.shortName || lastShortName(node.definitionRef);
}

/** What `region` replaces, so a refusal reads as one sentence for every region. */
function regionLabel(region: EditRegion): string {
	switch (region) {
		case 'shortName':
			return 'a <SHORT-NAME> text';
		case 'definitionRef':
			return 'a <DEFINITION-REF> text';
		case 'element':
			return 'a <VALUE> element';
		default:
			return 'a <VALUE> text';
	}
}

/**
 * The span a write must touch, resolved from the node's ranges in `text`.
 *
 * `element` is the whole `<VALUE/>` slice, `value` the text content inside the tags. The
 * rule is the bytes rather than the decoded value: an element slice begins with `<`.
 * `shortName` and `definitionRef` are the scanner's trimmed text spans, written as plain
 * inner text. `undefined` means the node has nothing of that kind to replace, which is a
 * refusal — including a range inside a CDATA section, which has no region of either kind
 * (`touchesCdata`).
 */
export function regionOf(
	node: EcucNode,
	text: string,
	region: EditRegion
): { range: Range; oldText: string } | undefined {
	const range = regionRange(node, text, region);
	if (range === undefined) {
		return undefined;
	}
	if (touchesCdata(text, range)) {
		return undefined; // a CDATA section is neither text content nor an element
	}
	return { range, oldText: text.slice(range.start, range.end) };
}

function regionRange(node: EcucNode, text: string, region: EditRegion): Range | undefined {
	if (region === 'shortName') {
		return namedRange(node);
	}
	if (region === 'definitionRef') {
		return node.definitionRefRange;
	}
	return valueRegion(node, text, region);
}

function namedRange(node: EcucNode): Range | undefined {
	if (node.kind !== 'module' && node.kind !== 'container') {
		return undefined;
	}
	return node.shortNameRange;
}

function valueRegion(node: EcucNode, text: string, region: EditRegion): Range | undefined {
	if (node.kind !== 'parameter' || node.valueRange === undefined) {
		return undefined;
	}
	const valueRange = node.valueRange;
	if (region === 'value') {
		return valueTextRange(text, valueRange);
	}
	return elementSpan(text, valueRange);
}

function valueTextRange(text: string, valueRange: Range): Range | undefined {
	if (text[valueRange.start] === '<') {
		return undefined; // the range covers the element, not its text content
	}
	return valueRange;
}

/**
 * The whole `<VALUE>…</VALUE>` element around `valueRange`.
 *
 * For an empty or self-closing value the scanner already points at the element, so the
 * outward expansion is only needed once such a value has been given text — the case
 * described here. The closing tag's `>` is found from the `</` that follows the
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
		quote = quoteStateAfter(text[i], quote);
		if (quote === '>') {
			return i + 1;
		}
	}
	return -1;
}

const QUOTE_CHARS = new Set(['"', "'"]);

/**
 * The scan state after `char`: the quote that is open, `''` for unquoted text, or `'>'`
 * when this character is the unquoted `>` that ends the tag. Inside a quote, `>` is text.
 */
function quoteStateAfter(char: string, quote: string): string {
	if (quote !== '') {
		return char === quote ? '' : quote;
	}
	return unquotedState(char);
}

function unquotedState(char: string): string {
	if (char === '>') {
		return '>';
	}
	return QUOTE_CHARS.has(char) ? char : '';
}

/**
 * The exact string that will occupy an `element` region: `<VALUE>` + escaped + `</VALUE>`.
 * The element's own open and close tags are kept verbatim, so a namespace prefix, an
 * attribute or a space before the slash survives.
 */
export function wrapElement(slice: string, escaped: string): string {
	const gt = tagEnd(slice, 0);
	const open = openTag(slice, gt);
	return open + escaped + closingTag(slice, open, gt);
}

/** The element's own open tag, kept verbatim apart from a dropped self-closing slash. */
function openTag(slice: string, gt: number): string {
	const tag = gt < 0 ? slice : slice.slice(0, gt);
	return tag.replace(/[\s/]+>$/, '>');
}

/** The element's existing close tag, or one synthesized from the open tag's name. */
function closingTag(slice: string, open: string, gt: number): string {
	const lt = slice.lastIndexOf('<');
	if (!hasCloseTagAt(slice, lt, gt)) {
		return `</${tagName(open)}>`;
	}
	return slice.slice(lt);
}

function hasCloseTagAt(slice: string, lt: number, gt: number): boolean {
	if (lt < 0) {
		return false;
	}
	if (gt < 0) {
		return false;
	}
	if (lt < gt) {
		return false;
	}
	return slice[lt + 1] === '/';
}

function tagName(open: string): string {
	return open.slice(1, -1).split(/[\s/>]/, 1)[0];
}

/**
 * Validates `value` and describes the byte-level replacement, or refuses. Nothing is
 * mutated here, so a refusal costs no partial write: the whole replacement is either
 * applied or not. Validation runs before `applyEdit`, always.
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
	return planValueEdit(text, nodeId, parameter, value);
}

/** The value-write stages after the node lookup: range, CDATA, validation, record. */
function planValueEdit(text: string, nodeId: string, parameter: ParameterNode, value: string): EditPlan {
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
	return valueEditPlan(text, nodeId, parameter, valueRange, validation.text);
}

function valueEditPlan(
	text: string,
	nodeId: string,
	parameter: ParameterNode,
	valueRange: Range,
	newText: string
): EditPlan {
	const region = editRegionAt(text, valueRange);
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
			newText: replacementText(region, described.oldText, newText),
		},
	};
}

/** `element` when the stored span covers the tags, `value` when it covers the text. */
function editRegionAt(text: string, range: Range): EditRegion {
	return text[range.start] === '<' ? 'element' : 'value';
}

function replacementText(region: EditRegion, oldText: string, newText: string): string {
	return region === 'element' ? wrapElement(oldText, newText) : newText;
}

/**
 * Validates a container's short name or definition ref and describes the inner-text
 * replacement, or refuses. Container-only on purpose: a module's short name is part of
 * every container's path, so one write there would renumber the whole tree.
 *
 * The plan also names the id the container will carry after the write. A container id
 * embeds its short name, so a rename invalidates the id the panel is selected by; the
 * host uses this prediction to keep the renamed container selected across the re-scan.
 * It is only a hint: `applyEdit` re-scans and refuses if the bytes moved.
 */
export function buildFieldEdit(
	model: EcucDocumentModel,
	text: string,
	nodeId: string,
	field: EditableField,
	value: string
): EditPlan {
	const node = nodeFor(model, nodeId);
	if (!node) {
		return { ok: false, reason: 'the node is no longer in the file' };
	}
	if (node.kind !== 'container') {
		return { ok: false, reason: 'the node is not a container' };
	}
	return planFieldEdit(text, nodeId, node, field, value);
}

/** The field-write stages after the container lookup: validation, span, record. */
function planFieldEdit(
	text: string,
	nodeId: string,
	node: ContainerNode,
	field: EditableField,
	value: string
): EditPlan {
	const validation = validateField(field, value);
	if (!validation.ok) {
		return validation;
	}
	const described = regionOf(node, text, field);
	if (!described) {
		// No text span: the element is absent, empty or CDATA-backed. Creating or
		// re-shaping the element is out of scope, so the write is refused.
		return { ok: false, reason: missingFieldReason(node, field) };
	}
	return fieldEditRecord(text, nodeId, node, field, value, described, validation.text);
}

function validateField(field: EditableField, value: string): ValidationResult {
	return field === 'shortName' ? validateShortName(value) : validateDefinitionRef(value);
}

function missingFieldReason(node: ContainerNode, field: EditableField): string {
	const label = `"${nodeLabel(node)}"`;
	return field === 'shortName'
		? `${label} has no <SHORT-NAME> text to edit (absent, empty or CDATA-backed)`
		: `${label} has no <DEFINITION-REF> text to edit (absent, empty or CDATA-backed)`;
}

function fieldEditRecord(
	text: string,
	nodeId: string,
	node: ContainerNode,
	field: EditableField,
	value: string,
	described: { range: Range; oldText: string },
	newText: string
): EditPlan {
	const unchanged = unchangedFieldReason(field, value, currentFieldText(node, field));
	if (unchanged !== undefined) {
		return { ok: false, reason: unchanged };
	}
	return {
		ok: true,
		record: {
			nodeId,
			region: field,
			oldText: described.oldText,
			newText,
		},
		nextNodeId: predictNodeId(text, described.range, newText),
	};
}

function currentFieldText(node: ContainerNode, field: EditableField): string {
	return field === 'shortName' ? node.shortName : node.definitionRef;
}

function unchangedFieldReason(field: EditableField, value: string, current: string): string | undefined {
	if (value.trim() !== current) {
		return undefined;
	}
	return field === 'shortName' ? 'the short name is unchanged' : 'the definition ref is unchanged';
}

/**
 * The id of the node that will contain `range` once `newText` replaces its bytes.
 *
 * Resolved with the same rule as a follow target (`nodeIdForRange`: exact match first,
 * then the smallest containing node), so the id scheme is not duplicated here.
 */
function predictNodeId(text: string, range: Range, newText: string): string | undefined {
	const predicted = text.slice(0, range.start) + newText + text.slice(range.end);
	const index = buildNodeIndex(scanEcucValues(predicted));
	return nodeIdForRange(index, { start: range.start, end: range.start + newText.length });
}

/**
 * Applies `record` as exactly one `WorkspaceEdit`, after recomputing the region from a
 * fresh scan. Nothing else is written, so the document is never
 * reformatted and no derived file exists to write.
 */
export async function applyEdit(
	document: vscode.TextDocument,
	record: EcucEditRecord
): Promise<ApplyResult> {
	const text = document.getText();
	const node = nodeFor(scanEcucValues(text), record.nodeId);
	if (!node) {
		return { ok: false, reason: 'the node is no longer in the file' };
	}
	const described = regionOf(node, text, record.region);
	if (!described) {
		return { ok: false, reason: `"${nodeLabel(node)}" no longer has ${regionLabel(record.region)} to replace` };
	}
	if (described.oldText !== record.oldText) {
		// The bytes under the region moved since the edit was prepared; writing now would
		// replace text the user never saw.
		return { ok: false, reason: 'the file changed since the value was read; try again' };
	}
	return writeEdit(document, text, described.range, record.newText);
}

/** Applies one replacement through a `WorkspaceEdit`, in document positions. */
async function writeEdit(
	document: vscode.TextDocument,
	text: string,
	range: Range,
	newText: string
): Promise<ApplyResult> {
	const edit = new vscode.WorkspaceEdit();
	edit.replace(document.uri, rangeIn(new LineIndex(text), range), newText);
	return applyWorkspaceEdit(edit);
}

function rangeIn(lineIndex: LineIndex, range: Range): vscode.Range {
	const start = lineIndex.positionAt(range.start);
	const end = lineIndex.positionAt(range.end);
	return new vscode.Range(start.line, start.character, end.line, end.character);
}

async function applyWorkspaceEdit(edit: vscode.WorkspaceEdit): Promise<ApplyResult> {
	if (!(await vscode.workspace.applyEdit(edit))) {
		return { ok: false, reason: 'VS Code refused the edit' };
	}
	return { ok: true };
}
