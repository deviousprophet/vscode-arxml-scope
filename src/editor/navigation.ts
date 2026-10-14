/**
 * Reveal mechanics (parent design §10, child design §2.3–§2.4).
 *
 * Spike B has not been run, so a live two-way split is unproven. Reveal is therefore
 * the two commands: editor → source opens the file in the text editor at the node's
 * range, source → editor maps the cursor offset to the innermost node and opens the
 * custom editor there. Do not add a second-pane mechanism on the strength of an
 * assumption.
 *
 * Both directions share the model's ranges and the node index, so the two mappings
 * cannot drift apart.
 */
import * as vscode from 'vscode';
import { EcucDocumentModel, Range, ReferenceNode } from '../core/ecuc/model';
import { resolvePath } from '../core/ecuc/resolve';
import { LineIndex } from '../core/text/offsets';
import { NodeEntry, NodeIndex } from './nodeId';

/** A model range as a VS Code range, through the document's own line index. */
export function toVscodeRange(lineIndex: LineIndex, range: Range): vscode.Range {
	const start = lineIndex.positionAt(range.start);
	const end = lineIndex.positionAt(range.end);
	return new vscode.Range(start.line, start.character, end.line, end.character);
}

/**
 * The innermost node containing `offset` (design §2.4).
 *
 * Nodes nest, so several ranges can contain one offset — a parameter inside a
 * container inside a module. The smallest containing range wins. The binary search
 * finds the last range starting at or before the offset; the backward walk that
 * follows picks the tightest containment among those, which is bounded by the entry
 * count rather than by a scan of the whole model.
 */
export function innermostNodeIdAt(index: NodeIndex, offset: number): string | undefined {
	const entries = index.sorted;
	let low = 0;
	let high = entries.length - 1;
	let last = -1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (entries[mid].range.start <= offset) {
			last = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	let best: NodeEntry | undefined;
	for (let i = last; i >= 0; i--) {
		const entry = entries[i];
		if (entry.range.end < offset) {
			continue;
		}
		if (!best || entry.range.end - entry.range.start < best.range.end - best.range.start) {
			best = entry;
		}
	}
	return best?.id;
}

export type FollowResult = { ok: true; range: Range } | { ok: false; reason: string };

/**
 * Same-file reference following (parent design §7, R10). Resolution reads the verbatim
 * `targetRawPath`, never the dotted display form. An absent path and an ambiguous
 * suffix both resolve to nothing; the reason covers both, because the resolver
 * deliberately refuses to guess between them.
 */
export function followReference(model: EcucDocumentModel, reference: ReferenceNode): FollowResult {
	const raw = reference.targetRawPath ?? '';
	if (raw === '') {
		return { ok: false, reason: `"${reference.name}" has no target path.` };
	}
	const range = resolvePath(model.pathIndex, raw);
	if (!range) {
		return { ok: false, reason: `No same-file target for "${raw}" (absent or ambiguous).` };
	}
	return { ok: true, range };
}

/**
 * Shows `range` in the text editor for `document`. The file must be shown by the text
 * editor to show raw XML, so this swaps the editor rather than opening a second pane.
 */
export async function revealRangeInTextEditor(document: vscode.TextDocument, range: Range): Promise<vscode.Range> {
	const selection = toVscodeRange(new LineIndex(document.getText()), range);
	await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default', { selection });
	const editor = vscode.window.activeTextEditor;
	if (editor && editor.document.uri.toString() === document.uri.toString()) {
		editor.selection = new vscode.Selection(selection.start, selection.end);
		editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
	}
	return selection;
}
