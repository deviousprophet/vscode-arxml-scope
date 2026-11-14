/**
 * Composes the merged document from the plan.
 *
 * The result is built from **ours' bytes**: unchanged nodes stay untouched, a node
 * taken from theirs replaces ours' element span with theirs' element text, a deleted
 * node loses its whole line, and a theirs-only node is inserted after its anchor with
 * the surrounding indentation. Nothing is re-serialized, so formatting, conditions and
 * annotations survive exactly as authored.
 *
 * Pure: no `vscode`, no DOM.
 */
import { lineSpan } from './lines';
import type { MergeDecision, MergeDoc, MergeInput, MergePlan } from './model';

export type ComposeResult = { ok: true; text: string } | { ok: false; reason: string };

/** One text edit in the original coordinates of ours' text. */
interface Edit {
	start: number;
	end: number;
	text: string;
}

function elementText(doc: MergeDoc, nodeId: string | undefined): string | undefined {
	const node = doc.nodes.find((candidate) => candidate.id === nodeId);
	if (node === undefined) {
		return undefined;
	}
	return doc.text.slice(node.range.start, node.range.end);
}

function lineStartOf(text: string, offset: number): number {
	let at = Math.min(offset, text.length);
	while (at > 0 && text[at - 1] !== '\n' && text[at - 1] !== '\r') {
		at -= 1;
	}
	return at;
}

function indentationAt(text: string, offset: number): string {
	const from = lineStartOf(text, offset);
	let end = from;
	while (end < text.length && (text[end] === ' ' || text[end] === '\t')) {
		end += 1;
	}
	return text.slice(from, end);
}

/** Re-indents a copied block by the difference between the two element indents. */
function reindentBlock(block: string, sourceIndent: string, targetIndent: string): string {
	const separator = block.includes('\r\n') ? '\r\n' : '\n';
	const lines = block.split(separator);
	return lines
		.map((line, index) => (index === 0 ? line : adjustIndent(line, sourceIndent, targetIndent)))
		.join(separator);
}

function adjustIndent(line: string, sourceIndent: string, targetIndent: string): string {
	if (line.trim() === '') {
		return line;
	}
	const lead = /^[ 	]*/.exec(line)?.[0] ?? '';
	const rest = line.slice(lead.length);
	// A block can be copied out of a differently nested document: shift every line's
	// own indent by the delta, never by a prefix assumption, so an under-indented
	// child keeps its relative position instead of gaining the target indent twice.
	const width = Math.max(0, lead.length + targetIndent.length - sourceIndent.length);
	return `${' '.repeat(width)}${rest}`;
}

function nodeOf(doc: MergeDoc, id: string | undefined) {
	return id === undefined ? undefined : doc.nodes.find((node) => node.id === id);
}

/** A replacement for a node taken from theirs. */
function replacementFor(input: MergeInput, decision: MergeDecision): Edit | undefined {
	const oursNode = nodeOf(input.ours, decision.oursId);
	const theirsNode = nodeOf(input.theirs, decision.theirsId);
	const theirsText = elementText(input.theirs, decision.theirsId);
	if (oursNode === undefined || theirsNode === undefined || theirsText === undefined) {
		return undefined;
	}
	const targetIndent = indentationAt(input.ours.text, oursNode.range.start);
	const sourceIndent = indentationAt(input.theirs.text, theirsNode.range.start);
	return {
		start: oursNode.range.start,
		end: oursNode.range.end,
		text: reindentBlock(theirsText, sourceIndent, targetIndent)
	};
}

/** A deletion for a node ours has and the merge drops. */
function deletionFor(input: MergeInput, decision: MergeDecision): Edit | undefined {
	const oursNode = nodeOf(input.ours, decision.oursId);
	if (oursNode === undefined) {
		return undefined;
	}
	const span = lineSpan(input.ours.text, oursNode.range);
	return { start: span.start, end: span.end, text: '' };
}

/** An insertion for a node only theirs has. */
function insertionFor(input: MergeInput, decision: MergeDecision): Edit | undefined {
	const theirsNode = nodeOf(input.theirs, decision.theirsId);
	const theirsText = elementText(input.theirs, decision.theirsId);
	if (theirsNode === undefined || theirsText === undefined) {
		return undefined;
	}
	const anchor = nodeOf(input.ours, decision.afterId) ?? nodeOf(input.ours, decision.beforeId);
	const targetIndent = indentationAt(input.ours.text, anchor?.range.start ?? 0);
	const sourceIndent = indentationAt(input.theirs.text, theirsNode.range.start);
	const block = reindentBlock(theirsText, sourceIndent, targetIndent);
	const separator = input.ours.text.includes('\r\n') ? '\r\n' : '\n';
	if (decision.afterId !== undefined && anchor !== undefined) {
		return { start: anchor.range.end, end: anchor.range.end, text: `${separator}${targetIndent}${block}` };
	}
	if (decision.beforeId !== undefined && anchor !== undefined) {
		return {
			start: anchor.range.start,
			end: anchor.range.start,
			text: `${block}${separator}${targetIndent}`
		};
	}
	return undefined;
}

/**
 * Applies every edit back to front. Edits are expressed in ours' original
 * coordinates; sorting by `start` then `end` descending keeps every later offset
 * valid, and a replacement that shares a point with an insertion is applied first.
 */
function applySpans(text: string, edits: readonly Edit[]): string {
	const ordered = [...edits].sort((left, right) => right.start - left.start || right.end - left.end);
	let result = text;
	for (const edit of ordered) {
		result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
	}
	return result;
}

/** The one edit a decision contributes, or `undefined` when ours' bytes already win. */
function editFor(input: MergeInput, decision: MergeDecision): Edit | undefined {
	if (decision.source === 'ours') {
		return undefined;
	}
	if (decision.source === 'none') {
		return deletionFor(input, decision);
	}
	return decision.oursId === undefined ? insertionFor(input, decision) : replacementFor(input, decision);
}

/**
 * Builds the merged text, or refuses while a conflict is unresolved.
 *
 * Replacements and insertions are applied back to front so earlier offsets stay
 * valid; a replaced element that also carries an insertion anchor is handled by the
 * decision's own source, never both.
 */
export function composeMerge(input: MergeInput, plan: MergePlan): ComposeResult {
	if (plan.unresolved > 0) {
		return {
			ok: false,
			reason: `${plan.unresolved} conflict${plan.unresolved === 1 ? '' : 's'} still need a decision`
		};
	}
	const edits: Edit[] = [];
	for (const decision of plan.decisions) {
		const edit = editFor(input, decision);
		if (edit !== undefined) {
			edits.push(edit);
		}
	}
	return { ok: true, text: applySpans(input.ours.text, edits) };
}
