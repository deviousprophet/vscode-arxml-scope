/**
 * The re-scan subscription (child design §1.4–§1.5) and node-id stability
 * (child design §2.2).
 *
 * These are the two mechanisms the sibling editing child depends on and that no other
 * test reaches: the subscription is what keeps a range on screen from outliving the
 * text it points at, and the ids are what let a re-scan re-find the node the user was
 * working on. The subscription is driven here through the provider's own entry point
 * with a stub panel, because `@vscode/test-electron` exposes no webview DOM or message
 * observer — the stub records what the provider pushes, and the document edit is real.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { EcucDocumentModel } from '../../core/ecuc/model';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { LineIndex } from '../../core/text/offsets';
import { EcucEditorProvider } from '../../editor/ecucEditorProvider';
import { buildNodeIndex } from '../../editor/nodeId';
import { renderTree } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';
import { sleep } from './editorTestUtils';

interface StubMessage {
	type?: string;
	tree?: string;
	selectedId?: string;
	nodeId?: string;
}

interface StubPanelShape {
	webview: {
		options: vscode.WebviewOptions;
		html: string;
		onDidReceiveMessage(listener: (message: unknown) => void): vscode.Disposable;
		postMessage(message: unknown): Thenable<boolean>;
	};
	reveal(): void;
	onDidDispose(listener: () => void): vscode.Disposable;
}

interface StubPanel {
	panel: vscode.WebviewPanel;
	raw: StubPanelShape;
	messages: StubMessage[];
	dispose(): void;
}

/** A panel that records what the provider pushes, so the push itself is observable. */
function stubPanel(): StubPanel {
	const messages: StubMessage[] = [];
	const disposeListeners: Array<() => void> = [];
	const raw: StubPanelShape = {
		webview: {
			options: {},
			html: '',
			onDidReceiveMessage: () => new vscode.Disposable(() => undefined),
			postMessage: (message) => {
				messages.push(message as StubMessage);
				return Promise.resolve(true);
			},
		},
		reveal: () => undefined,
		onDidDispose: (listener) => {
			disposeListeners.push(listener);
			return new vscode.Disposable(() => undefined);
		},
	};
	return {
		panel: raw as unknown as vscode.WebviewPanel,
		raw,
		messages,
		dispose: () => disposeListeners.forEach((listener) => listener()),
	};
}

/** Opens a scratch copy of the navigation fixture, so no committed file is touched. */
async function withScratchDocument(
	name: string,
	run: (uri: vscode.Uri, document: vscode.TextDocument) => Promise<void>
): Promise<void> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arxml-scope-rescan-'));
	const uri = vscode.Uri.file(path.join(dir, name));
	fs.writeFileSync(uri.fsPath, fixtureText('editor/navigation.arxml'), 'utf8');
	try {
		await run(uri, await vscode.workspace.openTextDocument(uri));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

/** Replaces a parameter's `<VALUE>` text in memory; never saved. */
async function replaceValue(
	uri: vscode.Uri,
	document: vscode.TextDocument,
	from: string,
	to: string
): Promise<void> {
	const model = scanEcucValues(document.getText());
	const parameter = model.modules[0].containers[0].parameters[0];
	assert.strictEqual(parameter.displayValue, from, 'the fixture still holds the expected value');
	const lineIndex = new LineIndex(document.getText());
	const start = lineIndex.positionAt(parameter.valueRange!.start);
	const end = lineIndex.positionAt(parameter.valueRange!.end);
	const edit = new vscode.WorkspaceEdit();
	edit.replace(uri, new vscode.Range(start.line, start.character, end.line, end.character), to);
	assert.ok(await vscode.workspace.applyEdit(edit), 'the in-memory edit applies');
}

/** A minimal ECUC-Values file whose container order is the argument order. */
function ecucText(containerNames: readonly string[]): string {
	const containers = containerNames
		.map(
			(name) => `                <ECUC-CONTAINER-VALUE>
                    <SHORT-NAME>${name}</SHORT-NAME>
                    <DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Pkg/ModDefs/Mod/${name}</DEFINITION-REF>
                    <PARAMETER-VALUES>
                        <ECUC-NUMERICAL-PARAM-VALUE>
                            <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Pkg/ModDefs/Mod/${name}/${name}Zeta</DEFINITION-REF>
                            <VALUE>1</VALUE>
                        </ECUC-NUMERICAL-PARAM-VALUE>
                        <ECUC-NUMERICAL-PARAM-VALUE>
                            <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Pkg/ModDefs/Mod/${name}/${name}Alpha</DEFINITION-REF>
                            <VALUE>2</VALUE>
                        </ECUC-NUMERICAL-PARAM-VALUE>
                    </PARAMETER-VALUES>
                </ECUC-CONTAINER-VALUE>`
		)
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xsi:schemaLocation="http://autosar.org/schema/r4.0 AUTOSAR_00048.xsd">
    <AR-PACKAGES>
        <AR-PACKAGE>
            <SHORT-NAME>Pkg</SHORT-NAME>
            <ELEMENTS>
                <ECUC-MODULE-CONFIGURATION-VALUES>
                    <SHORT-NAME>Mod</SHORT-NAME>
                    <DEFINITION-REF DEST="ECUC-MODULE-DEF">/Pkg/ModDefs/Mod</DEFINITION-REF>
                    <CONTAINERS>
${containers}
                    </CONTAINERS>
                </ECUC-MODULE-CONFIGURATION-VALUES>
            </ELEMENTS>
        </AR-PACKAGE>
    </AR-PACKAGES>
</AUTOSAR>
`;
}

function containerNamed(model: EcucDocumentModel, name: string) {
	const found = model.modules[0].containers.find((container) => container.shortName === name);
	assert.ok(found, name);
	return found;
}

suite('editor re-scan (design §1.5, §2.2)', () => {
	test('§1.5: a document change re-scans and pushes the refreshed tree', async () => {
		await withScratchDocument('rescan.arxml', async (uri, document) => {
			const provider = new EcucEditorProvider();
			const stub = stubPanel();
			provider.resolveCustomTextEditor(document, stub.panel, new vscode.CancellationTokenSource().token);

			assert.ok(stub.raw.webview.html.includes('NavCont'), 'the first paint renders the tree');
			assert.ok(stub.raw.webview.html.includes('= 7'), 'the first paint carries the value');
			assert.strictEqual(stub.messages.length, 0, 'nothing is pushed before the document changes');

			// Count the platform's own change events for this document, so "one refresh
			// path" is asserted against what VS Code actually reports rather than against
			// a guess about how many events one `applyEdit` produces. A second
			// subscription would push more messages than there are events.
			let events = 0;
			const listener = vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document.uri.toString() === uri.toString()) {
					events++;
				}
			});

			await replaceValue(uri, document, '7', '8');

			assert.ok(events >= 1, 'the platform reported the change');
			assert.strictEqual(stub.messages.length, events, 'exactly one push per document change');
			const pushed = stub.messages.at(-1)!;
			assert.strictEqual(pushed.type, 'model');
			const tree = pushed.tree ?? '';
			assert.ok(tree.includes('id="tree"'), 'the payload is the refreshable tree region');
			assert.ok(tree.includes('= 8'), 'the pushed tree carries the new value');
			assert.ok(!tree.includes('= 7'), 'the pushed tree is not the stale one');

			// The subscription must not outlive the panel.
			stub.dispose();
			const pushedBeforeDispose = stub.messages.length;
			await replaceValue(uri, document, '8', '9');
			assert.strictEqual(stub.messages.length, pushedBeforeDispose, 'a disposed panel is not refreshed');
			listener.dispose();
		});
	});

	test('§1.5: a change to another document does not refresh this panel', async () => {
		await withScratchDocument('watched.arxml', async (_watchedUri, watched) => {
			await withScratchDocument('other.arxml', async (otherUri, other) => {
				const provider = new EcucEditorProvider();
				const stub = stubPanel();
				provider.resolveCustomTextEditor(watched, stub.panel, new vscode.CancellationTokenSource().token);

				const edit = new vscode.WorkspaceEdit();
				edit.insert(otherUri, new vscode.Position(0, 0), '<!-- other document -->\n');
				assert.ok(await vscode.workspace.applyEdit(edit));
				await sleep(50);

				assert.strictEqual(stub.messages.length, 0, 'only the panel’s own document refreshes it');
				assert.ok(other.getText().startsWith('<!-- other document -->'), 'the other edit applied');
			});
		});
	});

	test('§2.4: a re-scan keeps the node that source → editor selected', async () => {
		await withScratchDocument('selection.arxml', async (uri, document) => {
			const provider = new EcucEditorProvider();
			const stub = stubPanel();
			provider.resolveCustomTextEditor(document, stub.panel, new vscode.CancellationTokenSource().token);

			const model = scanEcucValues(document.getText());
			const index = buildNodeIndex(model);
			const id = index.idOf(model.modules[0].containers[0].parameters[0])!;

			await provider.selectNode(uri, id);
			assert.strictEqual(stub.messages.at(-1)?.type, 'select', 'the open panel is told to select');
			assert.strictEqual(stub.messages.at(-1)?.nodeId, id);

			const edit = new vscode.WorkspaceEdit();
			edit.insert(uri, new vscode.Position(0, 0), '<!-- touched -->\n');
			assert.ok(await vscode.workspace.applyEdit(edit));
			await sleep(50);

			const refreshed = stub.messages.filter((message) => message.type === 'model').at(-1);
			assert.ok(refreshed, 'the re-scan is pushed');
			assert.strictEqual(refreshed.selectedId, id, 'the selection survives the re-scan');
			const tree = refreshed.tree ?? '';
			assert.ok(tree.includes(`data-node-id="${id}"`), 'the node is still in the tree');
			assert.strictEqual(tree.split('data-selected="true"').length - 1, 1, 'exactly one node is marked');
		});
	});

	test('§2.2: the id of a node does not depend on where its siblings are declared', () => {
		const declared = scanEcucValues(ecucText(['ContZ', 'ContA']));
		const reordered = scanEcucValues(ecucText(['ContA', 'ContZ']));
		const a = buildNodeIndex(declared);
		const b = buildNodeIndex(reordered);

		assert.strictEqual(
			a.idOf(containerNamed(declared, 'ContA')),
			b.idOf(containerNamed(reordered, 'ContA')),
			'the container keeps its id when the file order changes'
		);
		assert.strictEqual(
			a.idOf(containerNamed(declared, 'ContA').parameters[0]),
			b.idOf(containerNamed(reordered, 'ContA').parameters[0]),
			'the parameter keeps its id when the file order changes'
		);
		// Stability is not achieved by giving every node the same id.
		assert.notStrictEqual(
			a.idOf(containerNamed(declared, 'ContA')),
			a.idOf(containerNamed(declared, 'ContZ'))
		);
		assert.strictEqual(a.byId.size, b.byId.size, 'the same nodes are indexed either way');
	});

	test('§2.2: rendering in a different order does not renumber a node', () => {
		// The declaration order deliberately differs from the sorted order, so an
		// implementation that applied the sort to the model in place — the one plausible
		// way ids could drift when the setting changes — is visible here.
		const model = scanEcucValues(ecucText(['ContZ', 'ContA']));
		const before = buildNodeIndex(model);
		const declaredContainers = model.modules[0].containers.map((container) => container.shortName);
		const declaredParameters = model.modules[0].containers[0].parameters.map((parameter) => parameter.name);
		assert.deepStrictEqual(declaredContainers, ['ContZ', 'ContA'], 'the fixture is in declaration order');
		assert.deepStrictEqual(declaredParameters, ['ContZZeta', 'ContZAlpha'], 'and so are its parameters');

		renderTree(model, { sort: 'all' });
		renderTree(model, { sort: 'declaration' });

		assert.deepStrictEqual(
			model.modules[0].containers.map((container) => container.shortName),
			declaredContainers,
			'ordering is pure: the model keeps its declaration order'
		);
		assert.deepStrictEqual(
			model.modules[0].containers[0].parameters.map((parameter) => parameter.name),
			declaredParameters,
			'ordering is pure for members too'
		);
		assert.deepStrictEqual([...buildNodeIndex(model).byId.keys()], [...before.byId.keys()], 'ids are unchanged');
	});

	test('§2.2: editing a value does not renumber the edited node', () => {
		const text = fixtureText('editor/navigation.arxml');
		const edited = text.replace('<VALUE>7</VALUE>', '<VALUE>123456</VALUE>');
		const beforeModel = scanEcucValues(text);
		const before = buildNodeIndex(beforeModel);
		const after = buildNodeIndex(scanEcucValues(edited));
		const id = before.idOf(beforeModel.modules[0].containers[0].parameters[0])!;

		assert.strictEqual(after.byId.size, before.byId.size);
		for (const [key, entry] of before.byId) {
			const found = after.byId.get(key);
			assert.ok(found, key);
			assert.strictEqual(found.kind, entry.kind, key);
			assert.strictEqual(found.label, entry.label, key);
		}

		const editedNode = after.byId.get(id);
		assert.ok(editedNode, 'the edited parameter keeps its id');
		assert.ok(
			edited.slice(editedNode.range.start, editedNode.range.end).includes('<VALUE>123456</VALUE>'),
			'and its range now covers the new value'
		);
	});
});
