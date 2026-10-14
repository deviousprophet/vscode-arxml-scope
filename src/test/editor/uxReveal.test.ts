/**
 * AC1 (host half) and AC2 — selecting is in-place, and a deliberate reveal shows the
 * source without closing the custom editor.
 *
 * The webview cannot be clicked from here, so the `select` message the click posts is
 * sent through the provider's own listener, and "opens no text editor" is asserted
 * against `vscode.window.visibleTextEditors` — which a reveal really would change. The
 * AC2 test opens the real custom editor through the real command, so the tab behaviour
 * is the platform's, not a stub's.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { EcucEditorProvider, VIEW_TYPE } from '../../editor/ecucEditorProvider';
import { revealMode } from '../../editor/navigation';
import { buildNodeIndex } from '../../editor/nodeId';
import { fixtureText, slice } from '../core/modelTestUtils';
import { activeViewType, fixtureUri, sleep } from './editorTestUtils';

interface StubMessage {
	type?: string;
	nodeId?: string;
	tree?: string;
	selectedId?: string;
}

interface Stub {
	panel: vscode.WebviewPanel;
	raw: { webview: { html: string } };
	messages: StubMessage[];
	/** Invokes the provider's own message listener, as a webview postMessage would. */
	send(message: unknown): void;
}

/** A panel that records what the provider pushes and can push a message host-ward. */
function stubPanel(): Stub {
	const messages: StubMessage[] = [];
	const listeners: Array<(message: unknown) => void> = [];
	const raw = {
		webview: {
			options: {},
			html: '',
			onDidReceiveMessage: (listener: (message: unknown) => void) => {
				listeners.push(listener);
				return new vscode.Disposable(() => undefined);
			},
			postMessage: (message: unknown) => {
				messages.push(message as StubMessage);
				return Promise.resolve(true);
			},
		},
		reveal: () => undefined,
		onDidDispose: () => new vscode.Disposable(() => undefined),
	};
	return {
		panel: raw as unknown as vscode.WebviewPanel,
		raw,
		messages,
		send: (message) => listeners.forEach((listener) => listener(message)),
	};
}

/** A scratch copy of a fixture, so no committed file is opened by the provider. */
async function withScratch(
	name: string,
	run: (uri: vscode.Uri, document: vscode.TextDocument) => Promise<void>
): Promise<void> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arxml-scope-ux-'));
	const uri = vscode.Uri.file(path.join(dir, name));
	fs.writeFileSync(uri.fsPath, fixtureText('editor/navigation.arxml'), 'utf8');
	try {
		await run(uri, await vscode.workspace.openTextDocument(uri));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

function textEditorsFor(uri: vscode.Uri): readonly vscode.TextEditor[] {
	return vscode.window.visibleTextEditors.filter(
		(editor) => editor.document.uri.toString() === uri.toString()
	);
}

/** True while a custom editor tab for `uri` is open, wherever its group is. */
function customTabOpen(uri: vscode.Uri): boolean {
	return vscode.window.tabGroups.all.some((group) =>
		group.tabs.some((tab) => {
			const input = tab.input;
			return (
				input instanceof vscode.TabInputCustom &&
				input.viewType === VIEW_TYPE &&
				input.uri.toString() === uri.toString()
			);
		})
	);
}

/** The index of the group holding `uri`'s custom editor tab (or its text tab), or -1. */
function groupIndexFor(uri: vscode.Uri, custom: boolean): number {
	const groups = vscode.window.tabGroups.all;
	for (let at = 0; at < groups.length; at++) {
		for (const tab of groups[at].tabs) {
			const input = tab.input;
			if (custom) {
				if (
					input instanceof vscode.TabInputCustom &&
					input.viewType === VIEW_TYPE &&
					input.uri.toString() === uri.toString()
				) {
					return at;
				}
			} else if (input instanceof vscode.TabInputText && input.uri.toString() === uri.toString()) {
				return at;
			}
		}
	}
	return -1;
}

/**
 * Closes the text tabs for `uri`, so a reveal has to open the source itself rather than
 * reuse an editor an earlier suite happened to leave visible. Without this, "the source
 * is visible" would be true before the reveal ran.
 */
async function closeTextTabs(uri: vscode.Uri): Promise<void> {
	const tabs = vscode.window.tabGroups.all
		.flatMap((group) => group.tabs)
		.filter((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString());
	if (tabs.length > 0) {
		await vscode.window.tabGroups.close(tabs);
	}
	await sleep(100);
}

suite('editor reveal (AC1, AC2)', () => {
	test('AC1: a select from the tree opens no text editor and survives the next re-scan', async () => {
		await withScratch('select.arxml', async (uri, document) => {
			const provider = new EcucEditorProvider();
			const stub = stubPanel();
			provider.resolveCustomTextEditor(document, stub.panel, new vscode.CancellationTokenSource().token);

			const model = scanEcucValues(document.getText());
			const index = buildNodeIndex(model);
			const id = index.idOf(model.modules[0].containers[0].parameters[0])!;

			const before = textEditorsFor(uri).length;
			stub.send({ type: 'select', nodeId: id });
			await sleep(100);
			assert.strictEqual(textEditorsFor(uri).length, before, 'selecting opens no text editor');

			// The selection is host state, so a re-scan cannot move it back to the node
			// the editor happened to open at.
			const edit = new vscode.WorkspaceEdit();
			edit.insert(uri, new vscode.Position(0, 0), '<!-- touched -->\n');
			assert.ok(await vscode.workspace.applyEdit(edit));
			await sleep(100);

			const pushed = stub.messages.filter((message) => message.type === 'model').at(-1);
			assert.ok(pushed, 'the re-scan is pushed');
			assert.strictEqual(pushed.selectedId, id, 'the click’s selection survives the re-scan');
			assert.ok((pushed.tree ?? '').includes(`data-node-id="${id}"`), 'and the node is still in the tree');
		});
	});

	test('AC2: a reveal leaves the custom editor open and shows the range in the source', async () => {
		const uri = fixtureUri('editor/navigation.arxml');
		await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
		await sleep(600);
		assert.strictEqual(activeViewType(), VIEW_TYPE, 'the custom editor is open to begin with');
		// Start from no text editor for the file, so "the source is visible" is the
		// reveal's doing and "beside" has a column to prove.
		await closeTextTabs(uri);
		assert.strictEqual(textEditorsFor(uri).length, 0, 'no text editor for this file is visible yet');

		const document = await vscode.workspace.openTextDocument(uri);
		const model = scanEcucValues(document.getText());
		const index = buildNodeIndex(model);
		const parameter = model.modules[0].containers[0].parameters[0];

		await vscode.commands.executeCommand('vscode-arxml-scope.revealInSource', uri, index.idOf(parameter));
		await sleep(300);

		assert.ok(customTabOpen(uri), 'the custom editor tab survives the reveal');
		assert.strictEqual(activeViewType(), VIEW_TYPE, 'and it is still the focused tab, as `beside` promises');
		const editor = textEditorsFor(uri)[0];
		assert.ok(editor, 'the source is visible in a text editor');
		assert.strictEqual(
			editor.document.getText(new vscode.Range(editor.selection.start, editor.selection.end)),
			slice(document.getText(), parameter.range),
			'the revealed range is selected'
		);
		assert.notStrictEqual(
			groupIndexFor(uri, false),
			groupIndexFor(uri, true),
			'the source opens beside the tree, not on top of it'
		);
	});

	test('AC2: focus mode takes focus in the source and still does not close the custom editor', async () => {
		const config = vscode.workspace.getConfiguration('arxmlScope.ecuc.editor');
		const uri = fixtureUri('editor/navigation.arxml');
		try {
			await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
			await sleep(600);
			assert.strictEqual(activeViewType(), VIEW_TYPE, 'the custom editor is open to begin with');
			await closeTextTabs(uri);
			assert.strictEqual(textEditorsFor(uri).length, 0, 'no text editor for this file is visible yet');

			const document = await vscode.workspace.openTextDocument(uri);
			const model = scanEcucValues(document.getText());
			const index = buildNodeIndex(model);
			await config.update('revealMode', 'focus', vscode.ConfigurationTarget.Global);
			await vscode.commands.executeCommand('vscode-arxml-scope.revealInSource', uri, index.idOf(model.modules[0])!);
			await sleep(400);

			assert.ok(customTabOpen(uri), 'the custom editor tab survives a reveal in focus mode too');
			assert.strictEqual(activeViewType(), undefined, 'the text editor took the active tab, as focus mode promises');
			assert.strictEqual(
				vscode.window.activeTextEditor?.document.uri.toString(),
				uri.toString(),
				'and focus is in the source'
			);
			assert.notStrictEqual(
				groupIndexFor(uri, false),
				groupIndexFor(uri, true),
				'which is still beside the tree, not on top of it'
			);
		} finally {
			await config.update('revealMode', undefined, vscode.ConfigurationTarget.Global);
		}
	});

	test('AC2: the reveal mode is read per reveal, and defaults to beside', async () => {
		const config = vscode.workspace.getConfiguration('arxmlScope.ecuc.editor');
		assert.strictEqual(revealMode(), 'beside', 'the default keeps focus in the tree');
		try {
			await config.update('revealMode', 'focus', vscode.ConfigurationTarget.Global);
			assert.strictEqual(revealMode(), 'focus', 'a change applies without a reload');
			await config.update('revealMode', 'replace', vscode.ConfigurationTarget.Global);
			assert.strictEqual(revealMode(), 'replace');
		} finally {
			await config.update('revealMode', undefined, vscode.ConfigurationTarget.Global);
		}
		assert.strictEqual(revealMode(), 'beside', 'and the default returns');
	});

	test('AC2: replace mode swaps the tab, which is what that mode promises', async () => {
		const config = vscode.workspace.getConfiguration('arxmlScope.ecuc.editor');
		const uri = fixtureUri('editor/render.arxml');
		try {
			await config.update('revealMode', 'replace', vscode.ConfigurationTarget.Global);
			assert.strictEqual(textEditorsFor(uri).length, 0, 'no text editor for this file is open yet');
			await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
			await sleep(600);
			assert.strictEqual(activeViewType(), VIEW_TYPE);

			const document = await vscode.workspace.openTextDocument(uri);
			const model = scanEcucValues(document.getText());
			const id = buildNodeIndex(model).idOf(model.modules[0])!;
			await vscode.commands.executeCommand('vscode-arxml-scope.revealInSource', uri, id);
			await sleep(400);

			// `replace` swaps the *active tab* for the text editor; the custom editor's
			// tab stays in the group's background, which is what "as older versions did"
			// means — the point of the mode is that the tree is no longer in front.
			assert.strictEqual(activeViewType(), undefined, 'the custom editor is no longer the active tab');
			assert.ok(customTabOpen(uri), 'but it is still open, so AC2 holds in replace mode too');
			const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
			assert.ok(input instanceof vscode.TabInputText, 'the text editor took the tab');
			assert.strictEqual(input.uri.toString(), uri.toString());
			assert.ok(vscode.window.activeTextEditor, 'and the text editor is active');
			assert.strictEqual(
				vscode.window.activeTextEditor!.document.uri.toString(),
				uri.toString(),
				'replace is the one mode that takes focus'
			);
		} finally {
			await config.update('revealMode', undefined, vscode.ConfigurationTarget.Global);
		}
	});
});
