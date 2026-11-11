/**
 * Structural edits: delete or duplicate one container/parameter element.
 *
 * Like the value/field editor, a plan names the node rather than an offset. The
 * apply path re-scans, re-finds the node, verifies the bytes the plan saw, and
 * writes exactly one `WorkspaceEdit`. Nothing is reformatted, so undo is the
 * platform's own single step.
 */
import * as vscode from 'vscode';
import { ContainerNode, EcucDocumentModel, ModuleNode, ParameterNode, Range, lastShortName } from '../core/ecuc/model';
import { scanEcucValues } from '../core/ecuc/scanner';
import { validateShortName } from '../core/ecuc/validate';
import { LineIndex } from '../core/text/offsets';
import { EcucNode, buildNodeIndex } from '../core/ecuc/nodeId';
import { ApplyResult } from './ecucEdit';
import { touchesCdata } from './editRange';

export type StructureAction = 'delete' | 'duplicate';

/** One action's bytes: the element the plan saw, plus the chosen duplicate name. */
export interface StructureEditRecord {
	nodeId: string;
	action: StructureAction;
	/** The exact element bytes the plan was built from. */
	oldText: string;
	/** Container duplicate only: the validated, unique short name. */
	duplicateName?: string;
}

export interface StructurePlanOk {
	ok: true;
	record: StructureEditRecord;
	/** The node's short name or parameter name, for confirmation text. */
	label: string;
	/** How many descendants a container delete removes. */
	descendants: number;
}

export type StructurePlan = StructurePlanOk | { ok: false; reason: string };

type ParentNode = ModuleNode | ContainerNode;
type StructureNode = ContainerNode | ParameterNode;

/** The node a structural action may target, or `undefined` for modules/references/unknown ids. */
export function structureNodeFor(model: EcucDocumentModel, nodeId: string): StructureNode | undefined {
	const entry = buildNodeIndex(model).byId.get(nodeId);
	return entry === undefined ? undefined : structureNodeOf(entry.node);
}

function structureNodeOf(node: EcucNode): StructureNode | undefined {
	return node.kind === 'container' || node.kind === 'parameter' ? node : undefined;
}

function nodeLabel(node: EcucNode): string {
	if (node.kind === 'parameter' || node.kind === 'reference') {
		return node.name;
	}
	return node.shortName || lastShortName(node.definitionRef);
}

function parentOf(model: EcucDocumentModel, target: EcucNode): ParentNode | undefined {
	for (const module of model.modules) {
		const found = moduleParent(module, target);
		if (found !== undefined) {
			return found;
		}
	}
	return undefined;
}

function moduleParent(module: ModuleNode, target: EcucNode): ParentNode | undefined {
	if (module.containers.includes(target as ContainerNode)) {
		return module;
	}
	if (module === target) {
		return undefined;
	}
	return findIn(module.containers, target);
}

function findIn(containers: readonly ContainerNode[], target: EcucNode): ParentNode | undefined {
	for (const container of containers) {
		if (container === target) {
			return undefined;
		}
		const found = containerOf(container, target);
		if (found !== undefined) {
			return found;
		}
	}
	return undefined;
}

function containerOf(container: ContainerNode, target: EcucNode): ParentNode | undefined {
	if (holdsTarget(container, target)) {
		return container;
	}
	return findIn(container.containers, target);
}

function holdsTarget(container: ContainerNode, target: EcucNode): boolean {
	return (
		container.containers.includes(target as ContainerNode) ||
		container.parameters.includes(target as ParameterNode)
	);
}

function siblingNames(model: EcucDocumentModel, node: ContainerNode): string[] {
	const parent = parentOf(model, node);
	return parent ? parent.containers.filter((sibling) => sibling !== node).map((sibling) => sibling.shortName) : [];
}

/** `<name>_Copy`, then `<name>_Copy2`, …, skipping every existing sibling short name. */
export function defaultDuplicateName(name: string, siblings: readonly string[]): string {
	const taken = new Set(siblings);
	const base = `${name}_Copy`;
	if (!taken.has(base)) {
		return base;
	}
	let ordinal = 2;
	while (taken.has(`${base}${ordinal}`)) {
		ordinal++;
	}
	return `${base}${ordinal}`;
}

/** Why `name` cannot be a container duplicate's short name, or `undefined` when it can. */
export function duplicateNameRefusal(model: EcucDocumentModel, nodeId: string, name: string): string | undefined {
	const node = structureNodeFor(model, nodeId);
	if (node === undefined || node.kind !== 'container') {
		return 'the node is not a container';
	}
	return containerNameRefusal(model, node, name);
}

function containerNameRefusal(model: EcucDocumentModel, node: ContainerNode, name: string): string | undefined {
	const validation = validateShortName(name);
	if (!validation.ok) {
		return validation.reason;
	}
	if (name === node.shortName) {
		return 'choose a different short name from the original';
	}
	if (siblingNames(model, node).includes(name)) {
		return `a sibling container already uses "${name}"`;
	}
	return undefined;
}

/** True when the range is a real slice of `text` (never a reversed or out-of-bounds span). */
function validRange(text: string, range: Range): boolean {
	return (
		areIntegerBounds(range) &&
		range.start >= 0 &&
		range.end <= text.length &&
		range.start < range.end
	);
}

function areIntegerBounds(range: Range): boolean {
	return Number.isInteger(range.start) && Number.isInteger(range.end);
}

function countDescendants(node: ContainerNode): number {
	let count = node.parameters.length + node.references.length;
	for (const child of node.containers) {
		count += 1 + countDescendants(child);
	}
	return count;
}

/**
 * The whole line around `range`, including its indentation and line break, when the
 * element occupies the line by itself. An inline element keeps its own range, so a
 * neighbouring element is never touched.
 */
export function lineSpan(text: string, range: Range): Range {
	const start = lineStart(text, range.start);
	if (!isWhitespaceRange(text, start, range.start)) {
		return { start: range.start, end: range.end };
	}
	const end = lineEnd(text, range.end);
	if (!isWhitespaceRange(text, range.end, end)) {
		return { start: range.start, end: range.end };
	}
	return { start, end: includeLineBreak(text, end) };
}

/** The first offset of the line containing `from`. */
function lineStart(text: string, from: number): number {
	let start = from;
	while (start > 0 && !isLineBreakChar(text[start - 1])) {
		start--;
	}
	return start;
}

function isLineBreakChar(char: string): boolean {
	return char === '\n' || char === '\r';
}

/** The offset of the line break ending the line that contains `from`. */
function lineEnd(text: string, from: number): number {
	let end = from;
	while (end < text.length && !isLineBreakChar(text[end])) {
		end++;
	}
	return end;
}

function isWhitespaceRange(text: string, start: number, end: number): boolean {
	return /^[ \t]*$/.test(text.slice(start, end));
}

/** `end` moved past the line break at that offset, CRLF included. */
function includeLineBreak(text: string, end: number): number {
	if (text[end] === '\r' && text[end + 1] === '\n') {
		return end + 2;
	}
	return end < text.length ? end + 1 : end;
}

/** The document's own line break; CRLF when the file uses it. */
function lineBreakOf(text: string): string {
	return text.includes('\r\n') ? '\r\n' : '\n';
}

/** The whitespace before an element on its own line, or `''` for an inline element. */
function lineIndent(text: string, start: number): string {
	const at = lineStart(text, start);
	const prefix = text.slice(at, start);
	return isWhitespaceRange(text, at, start) ? prefix : '';
}

function duplicateInsertion(text: string, node: StructureNode, name: string | undefined): string | undefined {
	const source = text.slice(node.range.start, node.range.end);
	const copy = node.kind === 'container' ? renamedContainerCopy(text, node, name) : source;
	if (copy === undefined) {
		return undefined;
	}
	return lineBreakOf(text) + lineIndent(text, node.range.start) + copy;
}

/** The container's own bytes with its `<SHORT-NAME>` text replaced. */
function renamedContainerCopy(
	text: string,
	node: ContainerNode,
	name: string | undefined
): string | undefined {
	const copy = text.slice(node.range.start, node.range.end);
	const relative = validRelativeRange(text, node, copy.length);
	if (relative === undefined) {
		return undefined;
	}
	const renamed = validRename(name);
	if (renamed === undefined) {
		return undefined;
	}
	return copy.slice(0, relative.start) + renamed + copy.slice(relative.end);
}

function validRelativeRange(text: string, node: ContainerNode, length: number): Range | undefined {
	const shortNameRange = node.shortNameRange;
	if (shortNameRange === undefined) {
		return undefined;
	}
	if (!validRange(text, shortNameRange)) {
		return undefined;
	}
	return containedRange(shortNameRange, node.range.start, length);
}

function containedRange(range: Range, origin: number, length: number): Range | undefined {
	const start = range.start - origin;
	const end = range.end - origin;
	if (start < 0 || end > length) {
		return undefined;
	}
	return { start, end };
}

function validRename(name: string | undefined): string | undefined {
	if (name === undefined) {
		return undefined;
	}
	const validation = validateShortName(name);
	return validation.ok ? validation.text : undefined;
}

/** A delete plan, or a refusal that leaves the document untouched. */
export function planDelete(model: EcucDocumentModel, text: string, nodeId: string): StructurePlan {
	const node = structureNodeFor(model, nodeId);
	if (!node) {
		return { ok: false, reason: 'only a container or parameter can be deleted' };
	}
	const refusal = unremovableReason(text, node);
	if (refusal !== undefined) {
		return { ok: false, reason: refusal };
	}
	const span = lineSpan(text, node.range);
	return {
		ok: true,
		record: {
			nodeId,
			action: 'delete',
			oldText: text.slice(span.start, span.end),
		},
		label: nodeLabel(node),
		descendants: node.kind === 'container' ? countDescendants(node) : 0,
	};
}

function unremovableReason(text: string, node: StructureNode): string | undefined {
	if (!validRange(text, node.range)) {
		return 'the node has no removable source range';
	}
	if (touchesCdata(text, node.range)) {
		return 'the node is stored in a CDATA section, which this editor does not edit';
	}
	return undefined;
}

/** A duplicate plan, or a refusal. A container requires a valid, unique short name. */
export function planDuplicate(
	model: EcucDocumentModel,
	text: string,
	nodeId: string,
	name?: string
): StructurePlan {
	const node = structureNodeFor(model, nodeId);
	if (!node) {
		return { ok: false, reason: 'only a container or parameter can be duplicated' };
	}
	const refusal = duplicateRefusal(model, text, node, nodeId, name);
	if (refusal !== undefined) {
		return { ok: false, reason: refusal };
	}
	const duplicateName = duplicateNameFor(model, node, name);
	return {
		ok: true,
		record: {
			nodeId,
			action: 'duplicate',
			oldText: text.slice(node.range.start, node.range.end),
			...(duplicateName === undefined ? {} : { duplicateName }),
		},
		label: nodeLabel(node),
		descendants: 0,
	};
}

function duplicateRefusal(
	model: EcucDocumentModel,
	text: string,
	node: StructureNode,
	nodeId: string,
	name: string | undefined
): string | undefined {
	if (!validRange(text, node.range)) {
		return 'the node has no copyable source range';
	}
	if (touchesCdata(text, node.range)) {
		return 'the node is stored in a CDATA section, which this editor does not edit';
	}
	if (node.kind !== 'container') {
		return undefined;
	}
	return containerDuplicateRefusal(model, text, node, nodeId, name);
}

function containerDuplicateRefusal(
	model: EcucDocumentModel,
	text: string,
	node: ContainerNode,
	nodeId: string,
	name: string | undefined
): string | undefined {
	const duplicateName = duplicateNameFor(model, node, name);
	const refusal = duplicateNameRefusal(model, nodeId, duplicateName ?? '');
	if (refusal) {
		return refusal;
	}
	return insertionRefusal(text, node, duplicateName ?? '');
}

function insertionRefusal(text: string, node: ContainerNode, name: string): string | undefined {
	return duplicateInsertion(text, node, name) === undefined
		? 'the container has no editable <SHORT-NAME> text to copy'
		: undefined;
}

function duplicateNameFor(
	model: EcucDocumentModel,
	node: StructureNode,
	name: string | undefined
): string | undefined {
	if (node.kind !== 'container') {
		return undefined;
	}
	return name ?? defaultDuplicateName(node.shortName, siblingNames(model, node));
}

/**
 * Applies one structural record as exactly one `WorkspaceEdit`, after re-scanning and
 * checking the bytes the plan saw. A moved node or a now-taken duplicate name is a
 * refusal, never a write against text the user did not see.
 */
export async function applyStructureEdit(
	document: vscode.TextDocument,
	record: StructureEditRecord
): Promise<ApplyResult> {
	const text = document.getText();
	const model = scanEcucValues(text);
	const node = structureNodeFor(model, record.nodeId);
	if (!node) {
		return { ok: false, reason: 'the node is no longer a container or parameter' };
	}
	if (record.action === 'delete') {
		return applyStructureDelete(document, text, node, record);
	}
	if (record.action === 'duplicate') {
		return applyStructureDuplicate(document, text, model, node, record);
	}
	return { ok: false, reason: 'the structural action is not recognised' };
}

async function applyStructureDelete(
	document: vscode.TextDocument,
	text: string,
	node: StructureNode,
	record: StructureEditRecord
): Promise<ApplyResult> {
	if (!validRange(text, node.range)) {
		return { ok: false, reason: 'the node no longer has a removable source range' };
	}
	if (touchesCdata(text, node.range)) {
		return { ok: false, reason: 'the node is stored in a CDATA section, which this editor does not edit' };
	}
	const span = lineSpan(text, node.range);
	if (text.slice(span.start, span.end) !== record.oldText) {
		return { ok: false, reason: 'the file changed since the row was read; try again' };
	}
	return writeReplacement(document, span, '');
}

async function applyStructureDuplicate(
	document: vscode.TextDocument,
	text: string,
	model: EcucDocumentModel,
	node: StructureNode,
	record: StructureEditRecord
): Promise<ApplyResult> {
	const refusal = duplicateSourceRefusal(model, text, node, record);
	if (refusal !== undefined) {
		return { ok: false, reason: refusal };
	}
	const insertion = duplicateInsertion(text, node, record.duplicateName);
	if (insertion === undefined) {
		return { ok: false, reason: 'the node no longer has the text a duplicate needs' };
	}
	return writeReplacement(document, { start: node.range.end, end: node.range.end }, insertion);
}

function duplicateSourceRefusal(
	model: EcucDocumentModel,
	text: string,
	node: StructureNode,
	record: StructureEditRecord
): string | undefined {
	if (!validRange(text, node.range)) {
		return 'the node no longer has a copyable source range';
	}
	if (touchesCdata(text, node.range)) {
		return 'the node is stored in a CDATA section, which this editor does not edit';
	}
	if (text.slice(node.range.start, node.range.end) !== record.oldText) {
		return 'the file changed since the row was read; try again';
	}
	return duplicateRecordRefusal(model, node, record);
}

function duplicateRecordRefusal(
	model: EcucDocumentModel,
	node: StructureNode,
	record: StructureEditRecord
): string | undefined {
	if (node.kind !== 'container') {
		return undefined;
	}
	return duplicateNameRefusal(model, record.nodeId, record.duplicateName ?? '');
}

async function writeReplacement(document: vscode.TextDocument, range: Range, newText: string): Promise<ApplyResult> {
	const lineIndex = new LineIndex(document.getText());
	const start = lineIndex.positionAt(range.start);
	const end = lineIndex.positionAt(range.end);
	const edit = new vscode.WorkspaceEdit();
	edit.replace(
		document.uri,
		new vscode.Range(start.line, start.character, end.line, end.character),
		newText
	);
	if (!(await vscode.workspace.applyEdit(edit))) {
		return { ok: false, reason: 'VS Code refused the edit' };
	}
	return { ok: true };
}
