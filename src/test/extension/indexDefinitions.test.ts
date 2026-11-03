/**
 * The provider's definition seam: rows carry the resolved definition and an
 * index change re-pushes an open panel without touching the document.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { EcucEditorProvider, DefinitionSource } from '../../host/ecucEditorProvider';
import type { DefinitionInfo } from '../../core/index/definitions';
import { sleep } from './testUtils';

interface PushedDocument {
	type?: string;
	document?: { rows?: Array<{ label?: string; definition?: DefinitionInfo }> };
}

interface StubPanel {
	panel: vscode.WebviewPanel;
	messages: PushedDocument[];
	send(message: unknown): void;
	dispose(): void;
}

function stubPanel(): StubPanel {
	const messages: PushedDocument[] = [];
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
			postMessage: (message: unknown) => {
				messages.push(message as PushedDocument);
				return Promise.resolve(true);
			},
		},
		reveal: () => undefined,
		onDidDispose: (dispose: () => void) => {
			disposeListeners.push(dispose);
			return new vscode.Disposable(() => undefined);
		},
	};
	return {
		panel: raw as unknown as vscode.WebviewPanel,
		messages,
		send: (message) => listener?.(message),
		dispose: () => disposeListeners.forEach((dispose) => dispose()),
	};
}

const DEFINITION: DefinitionInfo = {
	kind: 'ECUC-INTEGER-PARAM-DEF',
	type: 'Integer',
	range: '0 .. 65535',
	defaultValue: '30',
	description: 'Timeout in seconds.',
	file: 'file:///work/module-def.arxml',
	fileName: 'module-def.arxml',
};

suite('provider definitions (extension)', () => {
	test('a document push carries the resolved definition and an index change re-pushes', async () => {
		let listener: (() => void) | undefined;
		const source: DefinitionSource = {
			definition: (ref) => (ref.endsWith('/TimeoutSeconds') ? DEFINITION : undefined),
			subscribe: (next) => {
				listener = next;
				return { dispose: () => undefined };
			},
		};
		const provider = new EcucEditorProvider(undefined, undefined, source);
		const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'arxml-scope-def-')), 'values.arxml');
		fs.writeFileSync(
			file,
			`<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/M/C/TimeoutSeconds</DEFINITION-REF><VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`
		);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const stub = stubPanel();
		provider.resolveCustomTextEditor(document, stub.panel, new vscode.CancellationTokenSource().token);
		stub.send({ type: 'ready' });
		await sleep(50);

		const first = stub.messages.filter((message) => message.type === 'document').pop();
		assert.ok(first?.document?.rows, 'the initial push carries rows');
		const timeout = first!.document!.rows!.find((row) => row.label === 'TimeoutSeconds');
		assert.ok(timeout, 'the parameter row is present');
		assert.strictEqual(timeout!.definition?.type, 'Integer');
		assert.strictEqual(timeout!.definition?.range, '0 .. 65535');

		listener!();
		await sleep(50);
		const pushes = stub.messages.filter((message) => message.type === 'document');
		assert.ok(pushes.length >= 2, 'the index change re-pushed the document');
		const last = pushes[pushes.length - 1];
		assert.strictEqual(
			last.document!.rows!.find((row) => row.label === 'TimeoutSeconds')?.definition?.description,
			'Timeout in seconds.'
		);

		stub.dispose();
		fs.rmSync(path.dirname(file), { recursive: true, force: true });
	});
});
