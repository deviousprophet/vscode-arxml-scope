/**
 * Provider-level cross-file follow: a reference in one ECUC file resolves to an
 * element in a non-ECUC ARXML file, so the text editor opens at the target.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import type { ElementResolution } from '../../core/index/workspaceIndex';
import { buildRows } from '../../core/ecuc/renderRows';
import { scanEcucValues } from '../../core/ecuc/scanner';
import type { DefinitionSource, EcucEditorProvider } from '../../host/ecucEditorProvider';
import { EcucEditorProvider as Provider } from '../../host/ecucEditorProvider';
import type { DefinitionInfo } from '../../core/index/definitions';
import { fixtureText } from '../core/modelTestUtils';
import { sleep } from './testUtils';

const SOURCE = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>Holder</SHORT-NAME><REFERENCE-VALUES><ECUC-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/P/M/Def/Ref</DEFINITION-REF><VALUE-REF DEST="ECUC-CONTAINER-VALUE">/P/T/Target</VALUE-REF></ECUC-REFERENCE-VALUE></REFERENCE-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;

interface StubPanel {
	panel: vscode.WebviewPanel;
	send(message: unknown): void;
	dispose(): void;
}

function stubPanel(): StubPanel {
	const disposeListeners: Array<() => void> = [];
	let listener: ((message: unknown) => void) | undefined;
	const raw = {
		webview: {
			options: {},
			html: '',
			onDidReceiveMessage: (next: (message: unknown) => void) => {
				listener = next;
				return new vscode.Disposable(() => undefined);
			},
			postMessage: () => Promise.resolve(true),
		},
		reveal: () => undefined,
		onDidDispose: (dispose: () => void) => {
			disposeListeners.push(dispose);
			return new vscode.Disposable(() => undefined);
		},
	};
	return {
		panel: raw as unknown as vscode.WebviewPanel,
		send: (message) => listener?.(message),
		dispose: () => disposeListeners.forEach((dispose) => dispose()),
	};
}

async function waitFor(what: string, predicate: () => boolean, timeoutMs = 5000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) {
			return;
		}
		await sleep(50);
	}
	assert.fail(`timed out waiting for ${what}`);
}

suite('cross-file provider follow (extension)', () => {
	test('a reference opens its non-ECUC target in the text editor', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arxml-scope-cross-'));
		const source = path.join(dir, 'source.arxml');
		const target = path.join(dir, 'target.arxml');
		fs.writeFileSync(source, SOURCE);
		fs.writeFileSync(target, fixtureText('index/module-def.arxml'));
		const sourceUri = vscode.Uri.file(source);
		const targetUri = vscode.Uri.file(target);
		try {
			const sourceIndex: DefinitionSource = {
				definition: (_ref: string): DefinitionInfo | undefined => undefined,
				subscribe: () => ({ dispose: () => undefined }),
				resolveTarget: (targetPath: string): ElementResolution => {
					const targetElement = {
						kind: 'container' as const,
						path: '/P/T/Target',
						file: targetUri.toString(),
						range: { start: 0, end: 1 },
					};
					return targetPath === '/P/T/Target'
						? { ok: true, element: targetElement, copies: [targetElement] }
						: { ok: false, reason: 'absent', path: targetPath };
				},
			};
			const provider: EcucEditorProvider = new Provider(undefined, undefined, sourceIndex);
			const document = await vscode.workspace.openTextDocument(sourceUri);
			const rows = buildRows(scanEcucValues(document.getText())).rows;
			const reference = rows.find((row) => row.kind === 'reference');
			assert.ok(reference, 'the source has a reference row');

			const stub = stubPanel();
			provider.resolveCustomTextEditor(document, stub.panel, new vscode.CancellationTokenSource().token);
			stub.send({ type: 'ready' });
			stub.send({ type: 'follow', nodeId: reference!.id });
			await waitFor(
				'the target text editor',
				() =>
					vscode.window.visibleTextEditors.some(
						(editor) => editor.document.uri.toString() === targetUri.toString()
					)
			);
			assert.ok(
				vscode.window.visibleTextEditors.some((editor) => editor.document.uri.toString() === targetUri.toString()),
				'the target opened in the text editor'
			);
			stub.dispose();
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
