/**
 * The ECUC custom text editor (child design §1, §2).
 *
 * `resolveCustomTextEditor` runs once per panel. Order matters: the gate completes
 * before any HTML is set, so a refused file never flashes an empty tree.
 *
 * `CustomTextEditorProvider` has no `openCustomDocument`, no
 * `onDidChangeCustomDocument` and no save/revert hooks — undo, redo, dirty state and
 * save belong to the real `TextDocument`. This child writes nothing at all; it renders
 * and navigates only.
 */
import { randomBytes } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { isArxmlPath, isEcucValues } from '../core/ecuc/detect';
import { ReferenceNode, SortMode } from '../core/ecuc/model';
import { SORT_EXCEPTIONS } from '../core/ecuc/order';
import { scanEcucValues } from '../core/ecuc/scanner';
import { RenderOptions, renderHtml, renderTree } from './renderHtml';
import { buildNodeIndex } from './nodeId';
import { followReference, revealRangeInTextEditor } from './navigation';

export const VIEW_TYPE = 'vscode-arxml-scope.ecucEditor';

interface WebviewMessage {
	type?: string;
	nodeId?: string;
}

/**
 * Why a document cannot be rendered, or `undefined` when it can (AC2, parent R2).
 * Shared by the provider and the open command so both refuse for the same reason.
 */
export function gateReason(text: string, filePath: string): string | undefined {
	const name = path.basename(filePath);
	if (!isArxmlPath(filePath)) {
		return `"${name}" is not an .arxml file; showing the text editor instead.`;
	}
	if (!isEcucValues(text, filePath)) {
		return `"${name}" contains no ECUC values; showing the text editor instead.`;
	}
	return undefined;
}

function editorSettings(): { sort: SortMode; sortExcept: readonly string[] } {
	const config = vscode.workspace.getConfiguration('arxmlScope.ecuc.editor');
	const sort = config.get<SortMode>('sort', 'all');
	return {
		sort: sort === 'declaration' ? 'declaration' : 'all',
		sortExcept: config.get<string[]>('sortExcept', [...SORT_EXCEPTIONS]),
	};
}

export class EcucEditorProvider implements vscode.CustomTextEditorProvider {
	/** Open panels by document, so `selectNode` can reach a panel that already exists. */
	private readonly panels = new Map<string, vscode.WebviewPanel>();
	/** Selections requested before their panel existed, consumed by `resolveCustomTextEditor`. */
	private readonly pending = new Map<string, string>();
	/**
	 * The node each open panel is currently focused on. The re-scan payload carries it,
	 * so a change to the document cannot silently move the selection back to whatever
	 * node the editor happened to be opened at (design §2.2, §2.4).
	 */
	private readonly selections = new Map<string, string>();

	public resolveCustomTextEditor(
		document: vscode.TextDocument,
		panel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): void {
		const key = document.uri.toString();
		this.panels.set(key, panel);

		const reason = gateReason(document.getText(), document.uri.fsPath);
		if (reason) {
			// Explain, then hand the file back to the text editor. Nothing is rendered:
			// `webview.html` is never set, so there is no empty shell to flash.
			void vscode.window.showWarningMessage(reason);
			void vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
			panel.onDidDispose(() => this.forget(key));
			return;
		}

		const disposables: vscode.Disposable[] = [];
		const nonce = randomBytes(16).toString('base64');
		const selectedId = this.pending.get(key) ?? this.selections.get(key);
		this.pending.delete(key);
		if (selectedId !== undefined) {
			this.selections.set(key, selectedId);
		}
		let model = scanEcucValues(document.getText());

		panel.webview.options = { enableScripts: true };
		panel.webview.html = renderHtml(model, { ...editorSettings(), nonce, selectedId });

		// The single refresh path: any change to this document — an undo, an external
		// edit, or the sibling child's write — re-scans and swaps the tree, so no range
		// on screen can outlive the text it points at.
		disposables.push(
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document.uri.toString() !== key) {
					return;
				}
				model = scanEcucValues(document.getText());
				const current = this.selections.get(key);
				const options: RenderOptions = { ...editorSettings(), selectedId: current };
				void panel.webview.postMessage({ type: 'model', tree: renderTree(model, options), selectedId: current });
			})
		);

		disposables.push(
			panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
				if (!message || typeof message.nodeId !== 'string') {
					return;
				}
				if (message.type === 'reveal') {
					void this.revealNode(document, model, message.nodeId);
				} else if (message.type === 'follow') {
					void this.followReference(document, model, message.nodeId, panel);
				}
			})
		);

		panel.onDidDispose(() => {
			for (const disposable of disposables) {
				disposable.dispose();
			}
			this.forget(key);
		});
	}

	/** Releases everything this provider keeps for a document. */
	private forget(key: string): void {
		this.panels.delete(key);
		this.selections.delete(key);
		this.pending.delete(key);
	}

	/**
	 * Opens the custom editor for `uri` with `nodeId` selected, or moves the selection
	 * of the panel that is already showing it (design §2.4, source → editor).
	 */
	public async selectNode(uri: vscode.Uri, nodeId: string): Promise<void> {
		const key = uri.toString();
		const panel = this.panels.get(key);
		if (panel) {
			this.selections.set(key, nodeId);
			panel.reveal();
			await panel.webview.postMessage({ type: 'select', nodeId });
			return;
		}
		this.pending.set(key, nodeId);
		await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
	}

	private async revealNode(
		document: vscode.TextDocument,
		model: ReturnType<typeof scanEcucValues>,
		nodeId: string
	): Promise<void> {
		const entry = buildNodeIndex(model).byId.get(nodeId);
		if (!entry) {
			return;
		}
		await revealRangeInTextEditor(document, entry.range);
	}

	private async followReference(
		document: vscode.TextDocument,
		model: ReturnType<typeof scanEcucValues>,
		nodeId: string,
		panel: vscode.WebviewPanel
	): Promise<void> {
		const entry = buildNodeIndex(model).byId.get(nodeId);
		if (!entry || entry.kind !== 'reference') {
			return;
		}
		const result = followReference(model, entry.node as ReferenceNode);
		if (!result.ok) {
			await panel.webview.postMessage({ type: 'notice', message: result.reason, kind: 'warn' });
			return;
		}
		await revealRangeInTextEditor(document, result.range);
	}
}
