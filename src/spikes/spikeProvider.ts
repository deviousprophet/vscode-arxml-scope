import * as vscode from 'vscode';
import { randomBytes } from 'crypto';

/**
 * THROWAWAY — Step 0 de-risking scaffolding for the parent plan
 * (`.trellis/tasks/10-14-ecuc-artext-editor/implement.md` §Step 0).
 *
 * Not a deliverable; delete with `spike/` once the spikes are answered.
 *
 * FINDING (read from `@types/vscode` while writing this, and the reason the original design had to
 * change): `CustomTextEditorProvider` exposes **only**
 * `resolveCustomTextEditor(document: TextDocument, panel, token)`.
 *
 * There is no `openCustomDocument`, no `onDidChangeCustomDocument`, and no `saveCustomDocument` /
 * `saveCustomDocumentAs` / `revertCustomDocument` hook on it — those belong to `CustomEditorProvider`,
 * the non-text variant that owns a custom document of its own. Because this provider edits the **real
 * `TextDocument`**, undo/redo, the dirty indicator and save are VS Code's own behaviour, and the
 * invertible `CustomDocumentEditEvent` machinery the parent `design.md` §9 originally specified is
 * not needed. See `research/spike-results.md`.
 *
 * What is left to confirm by hand is only that the behaviour matches that contract: the dirty dot
 * appears, Ctrl+Z/Ctrl+Y work with one press each, Ctrl+S persists, and an external edit refreshes
 * the view.
 *
 * Deliberately crude: the "edit" replaces the WHOLE file, which the real design never does (parent D1
 * writes only a `<VALUE>` element). It is the smallest thing that produces a dirty document. Do not
 * copy any of this into `src/editor/`.
 */
export class SpikeEditorProvider implements vscode.CustomTextEditorProvider {
	public static readonly viewType = 'vscode-arxml-scope.spikeEditor';

	public resolveCustomTextEditor(
		document: vscode.TextDocument,
		panel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): void {
		const nonce = randomBytes(16).toString('base64');
		panel.webview.options = { enableScripts: true };
		panel.webview.html = render(document.getText(), nonce);

		const push = () => void panel.webview.postMessage({ type: 'text', text: document.getText() });

		const subscription = vscode.workspace.onDidChangeTextDocument((event) => {
			if (event.document.uri.toString() === document.uri.toString()) {
				push();
			}
		});

		panel.webview.onDidReceiveMessage(async (message: { type: string; text?: string }) => {
			if (message.type === 'ready') {
				push();
				return;
			}
			if (message.type !== 'apply') {
				return;
			}

			const next = message.text ?? '';
			const current = document.getText();
			if (next === current) {
				void panel.webview.postMessage({ type: 'notice', message: 'No change; nothing applied.' });
				return;
			}

			const edit = new vscode.WorkspaceEdit();
			edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(current.length)), next);
			const applied = await vscode.workspace.applyEdit(edit);
			void panel.webview.postMessage({
				type: 'notice',
				message: applied
					? 'Applied. Now try Ctrl+Z, Ctrl+Y and Ctrl+S.'
					: 'applyEdit failed; see the extension host log.',
			});
		});

		panel.onDidDispose(() => subscription.dispose());
	}
}

function render(text: string, nonce: string): string {
	const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 10px; }
	textarea { width: 100%; height: 40vh; font-family: var(--vscode-editor-font-family); }
	#msg { margin-top: 8px; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
	<h3>Spike lifecycle probe (throwaway)</h3>
	<p>Edit the text, press Apply, then test Ctrl+Z, Ctrl+Y and Ctrl+S.</p>
	<textarea id="text">${escaped}</textarea>
	<p><button id="apply">Apply (whole-file replace)</button></p>
	<div id="msg"></div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const area = document.getElementById('text');
		document.getElementById('apply').onclick = () => vscode.postMessage({ type: 'apply', text: area.value });
		window.addEventListener('message', (event) => {
			const message = event.data;
			if (message.type === 'text') { area.value = message.text; }
			else if (message.type === 'notice') { document.getElementById('msg').textContent = message.message; }
		});
		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
}
