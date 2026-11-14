/**
 * The contributed commands.
 *
 * They share the provider's gate and the navigation helpers, so a command and a
 * webview action cannot diverge. Nothing here writes a file; the diff is read-only.
 */
import * as vscode from 'vscode';
import { scanEcucValues } from './core/ecuc/scanner';
import { ReferenceNode } from './core/ecuc/model';
import { EcucEditorProvider, VIEW_TYPE, gateReason } from './host/ecucEditorProvider';
import { buildNodeIndex } from './core/ecuc/nodeId';
import type { NodeEntry } from './core/ecuc/nodeId';
import { followReference, innermostNodeIdAt, revealRangeInTextEditor } from './host/navigation';
import { CompareSelectionStore, fileName } from './host/compareSelection';
import { DiffPanel } from './host/diffPanel';
import type { CoreEngine } from './host/engine/coreEngine';
import { IndexService } from './host/indexService';

export function registerCommands(
	context: vscode.ExtensionContext,
	provider: EcucEditorProvider,
	compare: CompareSelectionStore,
	indexService: IndexService,
	engine: CoreEngine
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('vscode-arxml-scope.openEcucEditor', (uri?: vscode.Uri) => openEcucEditor(uri)),
		vscode.commands.registerCommand('vscode-arxml-scope.rebuildIndex', () => indexService.rebuild()),
		vscode.commands.registerCommand('vscode-arxml-scope.cycleCrossFileRules', () => cycleCrossFileRules()),
		vscode.commands.registerCommand('vscode-arxml-scope.revealInSource', (uri?: vscode.Uri, nodeId?: string, follow?: boolean) =>
			revealInSource(uri, nodeId, follow)
		),
		vscode.commands.registerCommand('vscode-arxml-scope.revealInEcucEditor', (uri?: vscode.Uri) =>
			revealInEcucEditor(provider, uri)
		),
		vscode.commands.registerCommand('vscode-arxml-scope.selectAsFirst', (uri?: vscode.Uri) =>
			selectAsFirst(compare, uri)
		),
		vscode.commands.registerCommand('vscode-arxml-scope.compareToStaged', (uri?: vscode.Uri) =>
			compareToStaged(context, compare, engine, uri)
		),
		vscode.commands.registerCommand(
			'vscode-arxml-scope.compareSelected',
			(uri?: vscode.Uri, selectedUris?: vscode.Uri[]) => compareSelected(context, engine, uri, selectedUris)
		)
	);
}

/** Cycles the per-workspace cross-file rule mode. No dialog or notification. */
async function cycleCrossFileRules(): Promise<void> {
	const config = vscode.workspace.getConfiguration('arxmlScope.validation');
	const current = config.get<string>('crossFileRules', 'auto');
	const next = current === 'auto' ? 'always' : current === 'always' ? 'never' : 'auto';
	await config.update('crossFileRules', next, vscode.ConfigurationTarget.Workspace);
}

/** Explicit activation (parent D14): gated, then opened with the custom editor. */async function openEcucEditor(uri?: vscode.Uri): Promise<void> {
	const target = uri ?? vscode.window.activeTextEditor?.document.uri;
	if (!target) {
		void vscode.window.showInformationMessage('Open an .arxml file first.');
		return;
	}
	const document = await vscode.workspace.openTextDocument(target);
	const reason = gateReason(document.getText(), target.fsPath);
	if (reason) {
		void vscode.window.showWarningMessage(reason);
		return;
	}
	await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
}

/**
 * Editor → source. `follow` resolves a reference's
 * target instead of revealing the reference itself; it is the webview's `follow`
 * message. Both go through `revealRangeInTextEditor`, which opens the source beside the
 * tree (or swaps the tab in `replace` mode) instead of replacing the custom editor.
 */
async function revealInSource(uri?: vscode.Uri, nodeId?: string, follow = false): Promise<vscode.Range | undefined> {
	const target = targetUri(uri);
	if (!target || !nodeId) {
		void vscode.window.showInformationMessage('Reveal needs an .arxml file and a node.');
		return undefined;
	}
	const document = await vscode.workspace.openTextDocument(target);
	const model = scanEcucValues(document.getText());
	const entry = buildNodeIndex(model).byId.get(nodeId);
	if (!entry) {
		void vscode.window.showWarningMessage(`Unknown node "${nodeId}".`);
		return undefined;
	}
	return revealEntry(document, model, entry, follow);
}

/** The clicked target, or the active editor's document. */
function targetUri(uri?: vscode.Uri): vscode.Uri | undefined {
	return uri ?? vscode.window.activeTextEditor?.document.uri;
}

/** Reveals the entry itself, or follows it when it is a reference and `follow` is set. */
async function revealEntry(
	document: vscode.TextDocument,
	model: ReturnType<typeof scanEcucValues>,
	entry: NodeEntry,
	follow: boolean
): Promise<vscode.Range | undefined> {
	if (!follow || entry.kind !== 'reference') {
		return revealRangeInTextEditor(document, entry.range);
	}
	return revealFollowTarget(document, model, entry.node as ReferenceNode);
}

async function revealFollowTarget(
	document: vscode.TextDocument,
	model: ReturnType<typeof scanEcucValues>,
	reference: ReferenceNode
): Promise<vscode.Range | undefined> {
	const result = followReference(model, reference);
	if (!result.ok) {
		void vscode.window.showWarningMessage(result.reason);
		return undefined;
	}
	return revealRangeInTextEditor(document, result.range);
}

/**
 * Source → editor. The cursor offset is mapped to the innermost node and
 * the custom editor is opened at it. Returns the node id, so the mapping is observable.
 */
async function revealInEcucEditor(provider: EcucEditorProvider, uri?: vscode.Uri): Promise<string | undefined> {
	const editor = vscode.window.activeTextEditor;
	const target = targetUri(uri);
	if (!target) {
		void vscode.window.showInformationMessage('Place the cursor in an .arxml file first.');
		return undefined;
	}
	const document = await gatedDocumentAt(target);
	if (document === undefined) {
		return undefined;
	}
	return revealNodeAtCursor(provider, editor, document, target);
}

/** The opened document, or `undefined` with the gate's warning already shown. */
async function gatedDocumentAt(target: vscode.Uri): Promise<vscode.TextDocument | undefined> {
	const document = await vscode.workspace.openTextDocument(target);
	const reason = gateReason(document.getText(), target.fsPath);
	if (reason === undefined) {
		return document;
	}
	void vscode.window.showWarningMessage(reason);
	return undefined;
}

async function revealNodeAtCursor(
	provider: EcucEditorProvider,
	editor: vscode.TextEditor | undefined,
	document: vscode.TextDocument,
	target: vscode.Uri
): Promise<string | undefined> {
	const offset = cursorOffset(editor, document, target);
	const nodeId = innermostNodeIdAt(buildNodeIndex(scanEcucValues(document.getText())), offset);
	if (!nodeId) {
		void vscode.window.showInformationMessage('No ECUC node at the cursor.');
		return undefined;
	}
	await provider.selectNode(target, nodeId);
	return nodeId;
}

/** The active editor's cursor when it shows `target`, otherwise the document start. */
function cursorOffset(editor: vscode.TextEditor | undefined, document: vscode.TextDocument, target: vscode.Uri): number {
	if (editor === undefined || editor.document.uri.toString() !== target.toString()) {
		return 0;
	}
	return document.offsetAt(editor.selection.active);
}

/** Validates and stashes the clicked file as the left side of the next compare. */
async function selectAsFirst(compare: CompareSelectionStore, uri?: vscode.Uri): Promise<void> {
	const target = targetUri(uri);
	if (!target) {
		void vscode.window.showInformationMessage('Select an .arxml file first.');
		return;
	}
	const document = await openForCompare(target);
	if (document === undefined) {
		return;
	}
	stashFirstFile(compare, target, document);
}

/** Opens the file for comparison, or warns with the read error. */
async function openForCompare(target: vscode.Uri): Promise<vscode.TextDocument | undefined> {
	try {
		return await vscode.workspace.openTextDocument(target);
	} catch (error) {
		void vscode.window.showWarningMessage(
			`Cannot read "${fileName(target)}" for comparison: ${errorMessage(error)}`
		);
		return undefined;
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function stashFirstFile(
	compare: CompareSelectionStore,
	target: vscode.Uri,
	document: vscode.TextDocument
): void {
	const reason = gateReason(document.getText(), target.fsPath);
	if (reason) {
		void vscode.window.showWarningMessage(reason);
		return;
	}
	compare.set(target);
	void vscode.window.showInformationMessage(
		`"${fileName(target)}" is the first file. Open the second file and run "Compare with First File".`
	);
}

/** Compares the stashed left file with the clicked right file. */
async function compareToStaged(
	context: vscode.ExtensionContext,
	compare: CompareSelectionStore,
	engine: CoreEngine,
	uri?: vscode.Uri
): Promise<void> {
	const stashed = compare.get();
	if (!stashed) {
		void vscode.window.showWarningMessage(
			'Select a first file with "Select as First File to Compare" before comparing.'
		);
		return;
	}
	const target = targetUri(uri);
	if (!target) {
		void vscode.window.showWarningMessage('Select the second .arxml file to compare.');
		return;
	}
	// The first-file stash is one-shot: a successful compare clears the context key
	// so the Explorer item keeps telling the truth.
	await compareWithStashed(context, compare, engine, stashed, target);
}

async function compareWithStashed(
	context: vscode.ExtensionContext,
	compare: CompareSelectionStore,
	engine: CoreEngine,
	first: vscode.Uri,
	second: vscode.Uri
): Promise<void> {
	if (await DiffPanel.open(context, first, second, engine)) {
		compare.clear();
	}
}

/**
 * Explorer two-file selection: the clicked file is left, the other selected file is
 * right. With no selection (a palette invocation) a two-file dialog is the fallback.
 */
async function compareSelected(
	context: vscode.ExtensionContext,
	engine: CoreEngine,
	uri?: vscode.Uri,
	selectedUris?: vscode.Uri[]
): Promise<void> {
	const pair = selectedComparePair(uri, selectedUris);
	if (pair) {
		await DiffPanel.open(context, pair[0], pair[1], engine);
		return;
	}
	if (!isPaletteInvocation(uri, selectedUris)) {
		void vscode.window.showWarningMessage('Select exactly two .arxml files to compare.');
		return;
	}
	await comparePickedFiles(context, engine);
}

/** True when the command ran from the palette with no Explorer selection. */
function isPaletteInvocation(uri?: vscode.Uri, selectedUris?: readonly vscode.Uri[]): boolean {
	if (uri !== undefined) {
		return false;
	}
	return (selectedUris ?? []).length === 0;
}

async function comparePickedFiles(context: vscode.ExtensionContext, engine: CoreEngine): Promise<void> {
	const picked = await vscode.window.showOpenDialog({
		canSelectMany: true,
		openLabel: 'Compare',
		filters: { ARXML: ['arxml'] },
	});
	if (!picked) {
		return;
	}
	if (picked.length !== 2) {
		void vscode.window.showWarningMessage('Select exactly two .arxml files to compare.');
		return;
	}
	await DiffPanel.open(context, picked[0], picked[1], engine);
}

/** The clicked file plus exactly one other selected file, or undefined. */
function selectedComparePair(
	clicked: vscode.Uri | undefined,
	selected: readonly vscode.Uri[] | undefined
): [vscode.Uri, vscode.Uri] | undefined {
	if (!clicked) {
		return undefined;
	}
	const others = otherSelectedUris(clicked, selected);
	return others.length === 1 ? [clicked, others[0]] : undefined;
}

/** The selected files other than the clicked one, deduplicated. */
function otherSelectedUris(clicked: vscode.Uri, selected: readonly vscode.Uri[] | undefined): vscode.Uri[] {
	const clickedKey = clicked.toString();
	const seen = new Set<string>();
	const others: vscode.Uri[] = [];
	for (const uri of selected ?? []) {
		addOtherUri(uri, clickedKey, seen, others);
	}
	return others;
}

function addOtherUri(uri: vscode.Uri, clickedKey: string, seen: Set<string>, others: vscode.Uri[]): void {
	const key = uri.toString();
	if (seen.has(key) || key === clickedKey) {
		return;
	}
	seen.add(key);
	others.push(uri);
}
