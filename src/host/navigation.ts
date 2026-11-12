/**
 * Reveal mechanics.
 *
 * Reveal is two commands: editor → source opens the file in the text editor at the node's
 * range, source → editor maps the cursor offset to the innermost node and opens the
 * custom editor there. Do not add a second-pane mechanism on the strength of an
 * assumption.
 *
 * `revealRangeInTextEditor` is deliberately **non-destructive**:
 * it reuses a visible text editor for the file, or opens one beside the tree with
 * `preserveFocus`, so the custom editor's tab survives and focus stays in the tree.
 * `openWith('default')` — which swapped the tab and stole focus — survives only as the
 * explicit `replace` mode.
 *
 * Both directions share the model's ranges and the node index, so the two mappings
 * cannot drift apart.
 */
import * as vscode from 'vscode';
import { EcucDocumentModel, Range, ReferenceNode } from '../core/ecuc/model';
import { resolvePath } from '../core/ecuc/resolve';
import { LineIndex } from '../core/text/offsets';
import { NodeEntry, NodeIndex } from '../core/ecuc/nodeId';

/** A model range as a VS Code range, through the document's own line index. */
function toVscodeRange(lineIndex: LineIndex, range: Range): vscode.Range {
	const start = lineIndex.positionAt(range.start);
	const end = lineIndex.positionAt(range.end);
	return new vscode.Range(start.line, start.character, end.line, end.character);
}

/**
 * The innermost node containing `offset`.
 *
 * Nodes nest, so several ranges can contain one offset — a parameter inside a
 * container inside a module. The smallest containing range wins. The binary search
 * finds the last range starting at or before the offset; the backward walk that
 * follows picks the tightest containment among those, which is bounded by the entry
 * count rather than by a scan of the whole model.
 */
export function innermostNodeIdAt(index: NodeIndex, offset: number): string | undefined {
	const last = lastStartingAtOrBefore(index.sorted, offset);
	return bestId(innermostFrom(index.sorted, last, offset));
}

/** The last entry whose range starts at or before `offset`. */
function lastStartingAtOrBefore(entries: readonly NodeEntry[], offset: number): number {
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
	return last;
}

/** The tightest entry containing `offset`, walking backwards from `last`. */
function innermostFrom(entries: readonly NodeEntry[], last: number, offset: number): NodeEntry | undefined {
	let best: NodeEntry | undefined;
	for (let i = last; i >= 0; i--) {
		const entry = entries[i];
		if (entry.range.end < offset) {
			continue;
		}
		if (isTighter(entry, best)) {
			best = entry;
		}
	}
	return best;
}

/** True when `entry` is narrower than the current best. */
function isTighter(entry: NodeEntry, best: NodeEntry | undefined): boolean {
	return best === undefined || entry.range.end - entry.range.start < best.range.end - best.range.start;
}

function bestId(entry: NodeEntry | undefined): string | undefined {
	return entry === undefined ? undefined : entry.id;
}

export type FollowResult = { ok: true; range: Range } | { ok: false; reason: string };

/**
 * The node a follow result points at: an exact range match first, then the
 * smallest indexed node containing the range. The returned id is what the
 * webview selects, so following stays in the ECUC editor instead of opening
 * the text editor.
 */
export function nodeIdForRange(index: NodeIndex, range: Range): string | undefined {
	return nodeIdForEntries(index.byId.values(), range);
}

/** Exact range match first, else the tightest containing entry. */
function nodeIdForEntries(entries: Iterable<NodeEntry>, range: Range): string | undefined {
	let best: NodeEntry | undefined;
	for (const entry of entries) {
		if (isExactRange(entry, range)) {
			return entry.id;
		}
		if (isBetterContainment(entry, best, range)) {
			best = entry;
		}
	}
	return bestId(best);
}

function isExactRange(entry: NodeEntry, range: Range): boolean {
	return entry.range.start === range.start && entry.range.end === range.end;
}

function isBetterContainment(entry: NodeEntry, best: NodeEntry | undefined, range: Range): boolean {
	return containsRange(entry, range) && isTighter(entry, best);
}

function containsRange(entry: NodeEntry, range: Range): boolean {
	return entry.range.start <= range.start && entry.range.end >= range.end;
}

/**
 * Same-file reference following. Resolution reads the verbatim
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
 * Where a reveal puts the source, and whether it takes focus.
 * `beside` opens the source next to the tree and leaves focus in the tree; `focus`
 * opens it beside and moves focus there; `replace` is the old behaviour — swap this
 * tab for the text editor.
 */
export type RevealMode = 'beside' | 'focus' | 'replace';

/** The configured reveal mode. Read per reveal, so a change applies without a reload. */
export function revealMode(): RevealMode {
	const configured = vscode.workspace
		.getConfiguration('arxmlScope.ecuc.editor')
		.get<string>('revealMode', 'beside');
	return configured === 'focus' || configured === 'replace' ? configured : 'beside';
}

export interface RevealOptions {
	/** The custom editor's own column, so the source opens beside *it*, not beside "active". */
	viewColumn?: vscode.ViewColumn;
	/** Overrides the setting; the tests use it to exercise every mode. */
	mode?: RevealMode;
}

/** The column just after `column`, so the source opens beside the tree's own group. */
function besideColumn(column: vscode.ViewColumn): vscode.ViewColumn {
	return column > 0 ? ((column + 1) as vscode.ViewColumn) : vscode.ViewColumn.Beside;
}

/**
 * Shows `range` in the text editor for `document` without destroying the custom
 * editor's tab. Reuses a text editor already showing the file, so
 * repeated reveals do not accumulate tabs; otherwise opens one beside `viewColumn`
 * (or beside the active group) as a preview with focus preserved.
 */
export async function revealRangeInTextEditor(
	document: vscode.TextDocument,
	range: Range,
	options: RevealOptions = {}
): Promise<vscode.Range> {
	const selection = toVscodeRange(new LineIndex(document.getText()), range);
	const mode = options.mode ?? revealMode();

	if (mode === 'replace') {
		return replaceWithTextEditor(document, selection);
	}

	const editor = await textEditorBeside(document, mode, options.viewColumn);
	applySelection(editor, selection);
	return selection;
}

/** The old behaviour, kept for anyone who wants the tab swapped. */
async function replaceWithTextEditor(
	document: vscode.TextDocument,
	selection: vscode.Range
): Promise<vscode.Range> {
	await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default', { selection });
	const active = vscode.window.activeTextEditor;
	if (isEditorFor(active, document)) {
		applySelection(active, selection);
	}
	return selection;
}

function isEditorFor(
	editor: vscode.TextEditor | undefined,
	document: vscode.TextDocument
): editor is vscode.TextEditor {
	return editor !== undefined && editor.document.uri.toString() === document.uri.toString();
}

/** Reuses a visible text editor for the file, else opens one beside. */
async function textEditorBeside(
	document: vscode.TextDocument,
	mode: RevealMode,
	viewColumn: vscode.ViewColumn | undefined
): Promise<vscode.TextEditor> {
	const existing = findVisibleEditor(document);
	if (existing !== undefined) {
		return existing;
	}
	return vscode.window.showTextDocument(document, {
		viewColumn: targetColumn(viewColumn),
		preserveFocus: mode === 'beside',
		preview: true,
	});
}

function findVisibleEditor(document: vscode.TextDocument): vscode.TextEditor | undefined {
	return vscode.window.visibleTextEditors.find(
		(editor) => editor.document.uri.toString() === document.uri.toString()
	);
}

function targetColumn(column: vscode.ViewColumn | undefined): vscode.ViewColumn {
	return column === undefined ? vscode.ViewColumn.Beside : besideColumn(column);
}

function applySelection(editor: vscode.TextEditor, selection: vscode.Range): void {
	editor.selection = new vscode.Selection(selection.start, selection.end);
	editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}
