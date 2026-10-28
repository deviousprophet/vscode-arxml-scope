/**
 * The three contributed commands (child design §2.1, §10; parent design §11).
 *
 * They share the provider's gate and the navigation helpers, so a command and a
 * webview action cannot diverge. Nothing here writes a file.
 */
import * as vscode from 'vscode';
import { scanEcucValues } from './core/ecuc/scanner';
import { ReferenceNode } from './core/ecuc/model';
import { EcucEditorProvider, VIEW_TYPE, gateReason } from './editor/ecucEditorProvider';
import { buildNodeIndex } from './editor/nodeId';
import { followReference, innermostNodeIdAt, revealRangeInTextEditor } from './editor/navigation';

export function registerCommands(context: vscode.ExtensionContext, provider: EcucEditorProvider): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('vscode-arxml-scope.openEcucEditor', (uri?: vscode.Uri) => openEcucEditor(uri)),
		vscode.commands.registerCommand('vscode-arxml-scope.revealInSource', (uri?: vscode.Uri, nodeId?: string, follow?: boolean) =>
			revealInSource(uri, nodeId, follow)
		),
		vscode.commands.registerCommand('vscode-arxml-scope.revealInEcucEditor', (uri?: vscode.Uri) =>
			revealInEcucEditor(provider, uri)
		)
	);
}

/** Explicit activation (parent D14): gated, then opened with the custom editor. */
async function openEcucEditor(uri?: vscode.Uri): Promise<void> {
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
 * Editor → source (design §2.3; UX child design §3). `follow` resolves a reference's
 * target instead of revealing the reference itself; it is the webview's `follow`
 * message. Both go through `revealRangeInTextEditor`, which opens the source beside the
 * tree (or swaps the tab in `replace` mode) instead of replacing the custom editor.
 */
async function revealInSource(uri?: vscode.Uri, nodeId?: string, follow = false): Promise<vscode.Range | undefined> {
	const target = uri ?? vscode.window.activeTextEditor?.document.uri;
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
	if (!follow || entry.kind !== 'reference') {
		return revealRangeInTextEditor(document, entry.range);
	}
	const result = followReference(model, entry.node as ReferenceNode);
	if (!result.ok) {
		void vscode.window.showWarningMessage(result.reason);
		return undefined;
	}
	return revealRangeInTextEditor(document, result.range);
}

/**
 * Source → editor (design §2.4). The cursor offset is mapped to the innermost node and
 * the custom editor is opened at it. Returns the node id, so the mapping is observable.
 */
async function revealInEcucEditor(provider: EcucEditorProvider, uri?: vscode.Uri): Promise<string | undefined> {
	const editor = vscode.window.activeTextEditor;
	const target = uri ?? editor?.document.uri;
	if (!target) {
		void vscode.window.showInformationMessage('Place the cursor in an .arxml file first.');
		return undefined;
	}
	const document = await vscode.workspace.openTextDocument(target);
	const reason = gateReason(document.getText(), target.fsPath);
	if (reason) {
		void vscode.window.showWarningMessage(reason);
		return undefined;
	}
	const offset =
		editor && editor.document.uri.toString() === target.toString() ? document.offsetAt(editor.selection.active) : 0;
	const nodeId = innermostNodeIdAt(buildNodeIndex(scanEcucValues(document.getText())), offset);
	if (!nodeId) {
		void vscode.window.showInformationMessage('No ECUC node at the cursor.');
		return undefined;
	}
	await provider.selectNode(target, nodeId);
	return nodeId;
}
