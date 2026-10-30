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
import { EcucNode, buildNodeIndex } from './nodeId';
import { ApplyResult } from './ecucEdit';

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
	return structureNode(model, nodeId);
}

function structureNode(model: EcucDocumentModel, nodeId: string): StructureNode | undefined {
	const node = buildNodeIndex(model).byId.get(nodeId)?.node;
	return node?.kind === 'container' || node?.kind === 'parameter' ? node : undefined;
}

function nodeLabel(node: EcucNode): string {
	if (node.kind === 'parameter' || node.kind === 'reference') {
		return node.name;
	}
	return node.shortName || lastShortName(node.definitionRef);
}

function parentOf(model: EcucDocumentModel, target: EcucNode): ParentNode | undefined {
	const findIn = (containers: readonly ContainerNode[]): ParentNode | undefined => {
		for (const container of containers) {
			if (container === target) {
				return undefined;
			}
			if (container.containers.includes(target as ContainerNode)) {
				return container;
			}
			if (container.parameters.includes(target as ParameterNode)) {
				return container;
			}
			const nested = findIn(container.containers);
			if (nested) {
				return nested;
			}
		}
		return undefined;
	};
	for (const module of model.modules) {
		if (module.containers.includes(target as ContainerNode)) {
			return module;
		}
		if (module === target) {
			return undefined;
		}
		const found = findIn(module.containers);
		if (found) {
			return found;
		}
	}
	return undefined;
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
	const node = structureNode(model, nodeId);
	if (node?.kind !== 'container') {
		return 'the node is not a container';
	}
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
		Number.isInteger(range.start) &&
		Number.isInteger(range.end) &&
		range.start >= 0 &&
		range.end <= text.length &&
		range.start < range.end
	);
}

/** True when the element bytes include or sit inside a CDATA section. */
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
	let start = range.start;
	while (start > 0 && text[start - 1] !== '\n' && text[start - 1] !== '\r') {
		start--;
	}
	if (!/^[ \t]*$/.test(text.slice(start, range.start))) {
		return { start: range.start, end: range.end };
	}
	let end = range.end;
	while (end < text.length && text[end] !== '\n' && text[end] !== '\r') {
		end++;
	}
	if (!/^[ \t]*$/.test(text.slice(range.end, end))) {
		return { start: range.start, end: range.end };
	}
	if (text[end] === '\r' && text[end + 1] === '\n') {
		end += 2;
	} else if (end < text.length) {
		end += 1;
	}
	return { start, end };
}

/** The document's own line break; CRLF when the file uses it. */
function lineBreakOf(text: string): string {
	return text.includes('\r\n') ? '\r\n' : '\n';
}

/** The whitespace before an element on its own line, or `''` for an inline element. */
function lineIndent(text: string, start: number): string {
	let at = start;
	while (at > 0 && text[at - 1] !== '\n' && text[at - 1] !== '\r') {
		at--;
	}
	const prefix = text.slice(at, start);
	return /^[ \t]*$/.test(prefix) ? prefix : '';
}

function duplicateInsertion(text: string, node: StructureNode, name: string | undefined): string | undefined {
	const source = text.slice(node.range.start, node.range.end);
	let copy = source;
	if (node.kind === 'container') {
		if (name === undefined || !node.shortNameRange || !validRange(text, node.shortNameRange)) {
			return undefined;
		}
		const validation = validateShortName(name);
		if (!validation.ok) {
			return undefined;
		}
		const relativeStart = node.shortNameRange.start - node.range.start;
		const relativeEnd = node.shortNameRange.end - node.range.start;
		if (relativeStart < 0 || relativeEnd > copy.length) {
			return undefined;
		}
		copy = copy.slice(0, relativeStart) + validation.text + copy.slice(relativeEnd);
	}
	return lineBreakOf(text) + lineIndent(text, node.range.start) + copy;
}

/** A delete plan, or a refusal that leaves the document untouched. */
export function planDelete(model: EcucDocumentModel, text: string, nodeId: string): StructurePlan {
	const node = structureNode(model, nodeId);
	if (!node) {
		return { ok: false, reason: 'only a container or parameter can be deleted' };
	}
	if (!validRange(text, node.range)) {
		return { ok: false, reason: 'the node has no removable source range' };
	}
	if (touchesCdata(text, node.range)) {
		return { ok: false, reason: 'the node is stored in a CDATA section, which this editor does not edit' };
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

/** A duplicate plan, or a refusal. A container requires a valid, unique short name. */
export function planDuplicate(
	model: EcucDocumentModel,
	text: string,
	nodeId: string,
	name?: string
): StructurePlan {
	const node = structureNode(model, nodeId);
	if (!node) {
		return { ok: false, reason: 'only a container or parameter can be duplicated' };
	}
	if (!validRange(text, node.range)) {
		return { ok: false, reason: 'the node has no copyable source range' };
	}
	if (touchesCdata(text, node.range)) {
		return { ok: false, reason: 'the node is stored in a CDATA section, which this editor does not edit' };
	}
	let duplicateName: string | undefined;
	if (node.kind === 'container') {
		duplicateName = name ?? defaultDuplicateName(node.shortName, siblingNames(model, node));
		const refusal = duplicateNameRefusal(model, nodeId, duplicateName);
		if (refusal) {
			return { ok: false, reason: refusal };
		}
		if (duplicateInsertion(text, node, duplicateName) === undefined) {
			return { ok: false, reason: 'the container has no editable <SHORT-NAME> text to copy' };
		}
	}
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
	const node = structureNode(model, record.nodeId);
	if (!node) {
		return { ok: false, reason: 'the node is no longer a container or parameter' };
	}
	if (record.action === 'delete') {
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
	if (record.action === 'duplicate') {
		if (!validRange(text, node.range)) {
			return { ok: false, reason: 'the node no longer has a copyable source range' };
		}
		if (touchesCdata(text, node.range)) {
			return { ok: false, reason: 'the node is stored in a CDATA section, which this editor does not edit' };
		}
		if (text.slice(node.range.start, node.range.end) !== record.oldText) {
			return { ok: false, reason: 'the file changed since the row was read; try again' };
		}
		if (node.kind === 'container') {
			const refusal = duplicateNameRefusal(model, record.nodeId, record.duplicateName ?? '');
			if (refusal) {
				return { ok: false, reason: refusal };
			}
		}
		const insertion = duplicateInsertion(text, node, record.duplicateName);
		if (insertion === undefined) {
			return { ok: false, reason: 'the node no longer has the text a duplicate needs' };
		}
		return writeReplacement(document, { start: node.range.end, end: node.range.end }, insertion);
	}
	return { ok: false, reason: 'the structural action is not recognised' };
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
