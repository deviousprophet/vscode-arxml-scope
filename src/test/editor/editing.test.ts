/**
 * Value editing in the custom editor (child design §2.1–§2.3, §2.5; prd AC1–AC9).
 *
 * Every test that edits works on a **copy in a temporary directory**. Editing a committed
 * fixture in place would rewrite the repository on the second run, which is a correctness
 * problem rather than a style one. The bytes are compared, not the values: AC1, AC2 and
 * AC4 are about nothing else in the file moving.
 *
 * The provider is driven through its own entry point with a stub panel that captures the
 * message listener, because `@vscode/test-electron` exposes no webview DOM. The write it
 * performs is real, so undo, redo, dirty state and save are the platform's own — the same
 * behaviour the Spike A rows are meant to observe by hand.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { EcucEditorProvider } from '../../editor/ecucEditorProvider';
import { applyEdit, buildEdit, parameterFor, regionOf } from '../../editor/ecucEdit';
import { buildNodeIndex } from '../../editor/nodeId';
import { renderHtml, renderTree } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';
import { repoRoot, sleep } from './editorTestUtils';

interface StubMessage {
	type?: string;
	tree?: string;
	message?: string;
	nodeId?: string;
	selectedId?: string;
}

interface StubPanel {
	panel: vscode.WebviewPanel;
	/** The HTML the provider painted. */
	html(): string;
	messages: StubMessage[];
	/** Delivers a webview message to the provider's listener. */
	send(message: unknown): Promise<void>;
}

/** A panel that records what the provider pushes and lets a test post to it. */
function stubPanel(): StubPanel {
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
		html: () => raw.webview.html,
		messages,
		send: async (message) => {
			for (const listener of listeners) {
				listener(message);
			}
		},
	};
}

async function waitFor(what: string, predicate: () => boolean, timeoutMs = 5000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) {
			return;
		}
		await sleep(25);
	}
	assert.fail(`timed out waiting for ${what}`);
}

const fixturesDir = path.join(repoRoot, 'src', 'test', 'fixtures', 'editing');

function committed(name: string): string {
	return path.join(fixturesDir, name);
}

/** Opens a scratch copy of a committed fixture, so no test can rewrite the repository. */
async function withEditingFixture(
	name: string,
	run: (uri: vscode.Uri, document: vscode.TextDocument, dir: string) => Promise<void>
): Promise<void> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arxml-scope-editing-'));
	const uri = vscode.Uri.file(path.join(dir, name));
	fs.copyFileSync(committed(name), uri.fsPath);
	try {
		await run(uri, await vscode.workspace.openTextDocument(uri), dir);
	} finally {
		// VS Code's file watcher and local history keep a handle on a saved or reverted
		// file for a moment on Windows, so deleting the directory needs retries.
		await sleep(50);
		fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
}

/** The path-based id of a parameter, as the provider's own index computes it. */
function parameterId(text: string, name: string): string {
	const model = scanEcucValues(text);
	const index = buildNodeIndex(model);
	for (const parameter of model.modules[0].containers[0].parameters) {
		if (parameter.name === name) {
			const id = index.idOf(parameter);
			assert.ok(id, name);
			return id;
		}
	}
	throw new Error(`no parameter named ${name}`);
}

function notices(stub: StubPanel): StubMessage[] {
	return stub.messages.filter((message) => message.type === 'notice');
}

function lastNotice(stub: StubPanel): StubMessage {
	return notices(stub).at(-1) ?? {};
}

function lastModel(stub: StubPanel): StubMessage {
	return stub.messages.filter((message) => message.type === 'model').at(-1) ?? {};
}

/** A fresh scan rendered exactly as the provider renders it, for the staleness check. */
function expectedTree(text: string): string {
	return renderTree(scanEcucValues(text), { sort: 'all', sortExcept: [...SORT_EXCEPTIONS] });
}

function open(document: vscode.TextDocument): { provider: EcucEditorProvider; stub: StubPanel } {
	const provider = new EcucEditorProvider();
	const stub = stubPanel();
	provider.resolveCustomTextEditor(document, stub.panel, new vscode.CancellationTokenSource().token);
	return { provider, stub };
}

suite('editor value editing (AC1–AC9)', () => {
	test('AC1: a numerical edit changes exactly that value, byte for byte', async () => {
		await withEditingFixture('numeric.arxml', async (uri, document, dir) => {
			const original = document.getText();
			const { stub } = open(document);
			await stub.send({ type: 'edit', nodeId: parameterId(original, 'Count'), value: '42' });
			await waitFor('the numerical edit', () => document.getText().includes('<VALUE>42</VALUE>'));

			assert.strictEqual(document.getText(), fixtureText('editing/numeric.expected.arxml'));
			// The other parameter and every other byte are untouched.
			assert.ok(document.getText().includes('<VALUE>10</VALUE>'));

			await document.save();
			assert.strictEqual(
				fs.readFileSync(path.join(dir, 'numeric.arxml'), 'utf8'),
				fixtureText('editing/numeric.expected.arxml'),
				'the bytes on disk'
			);
		});
	});

	test('AC1: a textual edit changes exactly that value, byte for byte', async () => {
		await withEditingFixture('textual.arxml', async (uri, document, dir) => {
			const original = document.getText();
			const { stub } = open(document);
			await stub.send({ type: 'edit', nodeId: parameterId(original, 'Label'), value: 'hello world' });
			await waitFor('the textual edit', () => document.getText().includes('<VALUE>hello world</VALUE>'));

			assert.strictEqual(document.getText(), fixtureText('editing/textual.expected.arxml'));
			assert.ok(document.getText().includes('<VALUE>keep</VALUE>'), 'the sibling keeps its value');

			await document.save();
			assert.strictEqual(
				fs.readFileSync(path.join(dir, 'textual.arxml'), 'utf8'),
				fixtureText('editing/textual.expected.arxml')
			);
		});
	});

	test('AC2: the text-content shape replaces inside the tags (design §2.1)', () => {
		const text = fixtureText('editing/textual.arxml');
		const model = scanEcucValues(text);
		const plan = buildEdit(model, text, parameterId(text, 'Label'), 'hello world');
		assert.ok(plan.ok);
		assert.strictEqual(plan.record.region, 'value');
		assert.strictEqual(plan.record.oldText, 'bee');
		assert.strictEqual(plan.record.newText, 'hello world');
	});

	test('AC2: an empty or self-closing VALUE is replaced as a whole element', async () => {
		const text = fixtureText('editing/self-closing.arxml');
		const model = scanEcucValues(text);

		const selfClosing = buildEdit(model, text, parameterId(text, 'Count'), '42');
		assert.ok(selfClosing.ok);
		assert.strictEqual(selfClosing.record.region, 'element');
		assert.strictEqual(selfClosing.record.oldText, '<VALUE/>', 'the verbatim original element');
		assert.strictEqual(selfClosing.record.newText, '<VALUE>42</VALUE>');

		const emptyPair = buildEdit(model, text, parameterId(text, 'Label'), 'named');
		assert.ok(emptyPair.ok);
		assert.strictEqual(emptyPair.record.region, 'element');
		assert.strictEqual(emptyPair.record.oldText, '<VALUE></VALUE>');
		assert.strictEqual(emptyPair.record.newText, '<VALUE>named</VALUE>');

		await withEditingFixture('self-closing.arxml', async (_uri, document) => {
			const original = document.getText();
			const { stub } = open(document);
			await stub.send({ type: 'edit', nodeId: parameterId(original, 'Count'), value: '42' });
			await waitFor('the self-closing edit', () => document.getText().includes('<VALUE>42</VALUE>'));
			await stub.send({ type: 'edit', nodeId: parameterId(document.getText(), 'Label'), value: 'named' });
			await waitFor('the empty-pair edit', () => document.getText().includes('<VALUE>named</VALUE>'));

			assert.strictEqual(document.getText(), fixtureText('editing/self-closing.expected.arxml'));
		});
	});

	test('AC3: &, < and > are written escaped and read back unchanged', async () => {
		await withEditingFixture('escaping.arxml', async (uri, document) => {
			const original = document.getText();
			const { stub } = open(document);
			const typed = 'a&b<c>d';
			await stub.send({ type: 'edit', nodeId: parameterId(original, 'Pattern'), value: typed });
			await waitFor('the escaping edit', () => document.getText().includes('&amp;b'));

			assert.strictEqual(document.getText(), fixtureText('editing/escaping.expected.arxml'));
			assert.ok(document.getText().includes('<VALUE>a&amp;b&lt;c&gt;d</VALUE>'), 'written escaped');
			const reread = scanEcucValues(document.getText()).modules[0].containers[0].parameters[0];
			assert.strictEqual(reread.displayValue, typed, 're-reading yields what the user typed');

			await document.save();
			assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), fixtureText('editing/escaping.expected.arxml'));
		});
	});

	test('AC4: one Ctrl+Z restores the previous bytes and one Ctrl+Y re-applies them', async () => {
		await withEditingFixture('numeric.arxml', async (_uri, document) => {
			const original = document.getText();
			const { stub } = open(document);
			await vscode.window.showTextDocument(document);
			await stub.send({ type: 'edit', nodeId: parameterId(original, 'Count'), value: '42' });
			await waitFor('the edit', () => document.getText().includes('<VALUE>42</VALUE>'));

			await vscode.commands.executeCommand('undo');
			await waitFor('one undo to restore the original bytes', () => document.getText() === original);
			assert.strictEqual(document.getText(), original, 'the original bytes, not a reconstruction');
			assert.strictEqual(
				fs.readFileSync(committed('numeric.arxml'), 'utf8'),
				original,
				'the committed fixture is untouched'
			);

			await vscode.commands.executeCommand('redo');
			await waitFor('one redo to re-apply the edit', () =>
				document.getText().includes('<VALUE>42</VALUE>')
			);
			assert.strictEqual(document.getText(), fixtureText('editing/numeric.expected.arxml'));
		});
	});

	test('AC5: dirty after an edit, clean after save, revert restores from disk and re-renders', async () => {
		await withEditingFixture('numeric.arxml', async (uri, document) => {
			const original = document.getText();
			const { stub } = open(document);
			assert.strictEqual(document.isDirty, false, 'a freshly opened document is clean');

			await stub.send({ type: 'edit', nodeId: parameterId(original, 'Count'), value: '42' });
			await waitFor('the edit', () => document.getText().includes('<VALUE>42</VALUE>'));
			assert.strictEqual(document.isDirty, true, 'an edit dirties the real document');

			await document.save();
			assert.strictEqual(document.isDirty, false, 'save cleans it');
			assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), fixtureText('editing/numeric.expected.arxml'));

			// Dirty it again, then revert: the bytes come back from disk and the view is
			// refreshed by the re-scan subscription, not by a save/revert hook.
			await stub.send({ type: 'edit', nodeId: parameterId(document.getText(), 'Count'), value: '99' });
			await waitFor('the second edit', () => document.getText().includes('<VALUE>99</VALUE>'));
			assert.strictEqual(document.isDirty, true);

			await vscode.window.showTextDocument(document);
			await vscode.commands.executeCommand('workbench.action.files.revert');
			await waitFor('the revert to reload from disk', () => document.getText().includes('<VALUE>42</VALUE>'));
			assert.strictEqual(document.getText(), fixtureText('editing/numeric.expected.arxml'));
			assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), fixtureText('editing/numeric.expected.arxml'));

			await waitFor('the view to be re-rendered after the revert', () => {
				const tree = lastModel(stub).tree ?? '';
				return tree.includes('= 42') && !tree.includes('= 99');
			});
		});
	});

	test('AC6: an invalid numerical value is refused with a reason and no mutation', async () => {
		await withEditingFixture('numeric.arxml', async (uri, document) => {
			const before = document.getText();
			const onDisk = fs.readFileSync(uri.fsPath, 'utf8');
			const { stub } = open(document);

			await stub.send({ type: 'edit', nodeId: parameterId(before, 'Count'), value: 'abc' });
			await waitFor('the refusal', () => notices(stub).length > 0);

			assert.ok(lastNotice(stub).message?.includes('numerical'), lastNotice(stub).message);
			assert.strictEqual(document.getText(), before, 'the document is untouched');
			assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), onDisk, 'the file is untouched');
			assert.strictEqual(document.isDirty, false, 'a refusal does not dirty the document');
		});
	});

	test('AC6: a character XML cannot represent is refused with a reason and no mutation', async () => {
		await withEditingFixture('textual.arxml', async (uri, document) => {
			const before = document.getText();
			const { stub } = open(document);

			await stub.send({ type: 'edit', nodeId: parameterId(before, 'Label'), value: 'bad\u0001char' });
			await waitFor('the refusal', () => notices(stub).length > 0);

			assert.ok(lastNotice(stub).message?.includes('XML cannot represent'), lastNotice(stub).message);
			assert.strictEqual(document.getText(), before);
			assert.strictEqual(document.isDirty, false);
		});
	});

	test('AC6: a region whose bytes moved under the edit is refused rather than written', async () => {
		await withEditingFixture('numeric.arxml', async (uri, document) => {
			const original = document.getText();
			const plan = buildEdit(scanEcucValues(original), original, parameterId(original, 'Count'), '42');
			assert.ok(plan.ok);

			// Something else changes the same region before the record is applied.
			const model = scanEcucValues(document.getText());
			const parameter = parameterFor(model, plan.record.nodeId)!;
			const region = regionOf(parameter, document.getText(), 'value')!;
			const other = new vscode.WorkspaceEdit();
			other.replace(
				uri,
				new vscode.Range(document.positionAt(region.range.start), document.positionAt(region.range.end)),
				'11'
			);
			assert.ok(await vscode.workspace.applyEdit(other), 'the competing edit applies');

			const result = await applyEdit(document, plan.record);
			assert.strictEqual(result.ok, false, 'a stale record is not applied');
			assert.ok(document.getText().includes('<VALUE>11</VALUE>'), 'the competing bytes survive');
		});
	});

	test('AC7: an unchanged value is a no-op and does not dirty the document', async () => {
		await withEditingFixture('numeric.arxml', async (_uri, document) => {
			const before = document.getText();
			const { stub } = open(document);

			await stub.send({ type: 'edit', nodeId: parameterId(before, 'Count'), value: '7' });
			await waitFor('the refusal', () => notices(stub).length > 0);

			assert.ok(lastNotice(stub).message?.includes('unchanged'), lastNotice(stub).message);
			assert.strictEqual(document.getText(), before);
			assert.strictEqual(document.isDirty, false);
		});
	});

	test('AC8: after an edit, an undo and a redo the view matches the document', async () => {
		await withEditingFixture('numeric.arxml', async (_uri, document) => {
			const original = document.getText();
			const { stub } = open(document);
			await vscode.window.showTextDocument(document);

			await stub.send({ type: 'edit', nodeId: parameterId(original, 'Count'), value: '42' });
			await waitFor('the pushed edit', () => (lastModel(stub).tree ?? '').includes('= 42'));
			assert.strictEqual(lastModel(stub).tree, expectedTree(document.getText()), 'after the edit');

			await vscode.commands.executeCommand('undo');
			await waitFor('the pushed undo', () => (lastModel(stub).tree ?? '').includes('= 7'));
			assert.strictEqual(lastModel(stub).tree, expectedTree(document.getText()), 'after the undo');
			assert.ok(!(lastModel(stub).tree ?? '').includes('= 42'), 'no stale value is on screen');

			await vscode.commands.executeCommand('redo');
			await waitFor('the pushed redo', () => (lastModel(stub).tree ?? '').includes('= 42'));
			assert.strictEqual(lastModel(stub).tree, expectedTree(document.getText()), 'after the redo');
		});
	});

	test('AC9: no file is created and the committed fixtures are never written', async () => {
		const fixturesBefore = fs.readdirSync(fixturesDir).sort();
		const committedBefore = new Map(
			fs.readdirSync(fixturesDir).map((name) => [name, fs.readFileSync(committed(name), 'utf8')])
		);

		await withEditingFixture('numeric.arxml', async (uri, document, dir) => {
			const dirBefore = fs.readdirSync(dir).sort();
			const { stub } = open(document);
			await stub.send({ type: 'edit', nodeId: parameterId(document.getText(), 'Count'), value: '42' });
			await waitFor('the edit', () => document.getText().includes('<VALUE>42</VALUE>'));
			await document.save();

			assert.deepStrictEqual(fs.readdirSync(dir).sort(), dirBefore, 'no file is created beside the edited one');
			assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), fixtureText('editing/numeric.expected.arxml'));
		});

		assert.deepStrictEqual(fs.readdirSync(fixturesDir).sort(), fixturesBefore, 'no fixture was added');
		for (const [name, text] of committedBefore) {
			assert.strictEqual(fs.readFileSync(committed(name), 'utf8'), text, `${name} is unmodified`);
		}
	});

	test('§9: the tree carries the value the widget edits, and the widget is inlined', () => {
		const model = scanEcucValues(fixtureText('editing/numeric.arxml'));
		const tree = renderTree(model, {});
		assert.ok(tree.includes('data-kind="parameter"'));
		assert.ok(tree.includes('data-value="7"'), 'the current value is what the editor starts from');
		assert.ok(tree.includes('(= 0x7)'), 'the model’s secondary hex stays beside it');

		const page = renderHtml(model, { nonce: 'test-nonce' });
		assert.ok(page.includes('.value-edit'), 'the editor is styled from --vscode-* variables');
		assert.ok(page.includes("type: 'edit'"), 'and posts the edit message');
		assert.ok(page.includes('nodeId: item.dataset.nodeId'), 'with the id the provider resolves');
		assert.ok(page.includes("event.key === 'Enter' || event.key === 'Escape'"), 'Enter commits, Escape cancels');
		assert.ok(!/acquireVsCodeApi\(\)[\s\S]*acquireVsCodeApi\(\)/.test(page), 'the API is acquired once');
	});

	test('§2.2: the region is recomputed from a fresh scan, never replayed from an offset', () => {
		const text = fixtureText('editing/numeric.arxml');
		const count = parameterId(text, 'Count');
		const limit = parameterId(text, 'Limit');
		const plan = buildEdit(scanEcucValues(text), text, count, '123456');
		assert.ok(plan.ok);

		// The first value grew by five characters, so every later offset moved.
		const after = text.replace('<VALUE>7</VALUE>', plan.record.newText);
		const rescanned = scanEcucValues(after);
		const moved = regionOf(parameterFor(rescanned, limit)!, after, 'value')!;
		assert.strictEqual(after.slice(moved.range.start, moved.range.end), '10');

		// The element region is recomputed too, after a self-closing value gained text.
		const emptyText = fixtureText('editing/self-closing.arxml');
		const countElement = buildEdit(scanEcucValues(emptyText), emptyText, parameterId(emptyText, 'Count'), '42');
		assert.ok(countElement.ok);
		const grown = emptyText.replace('<VALUE/>', countElement.record.newText);
		const grownRegion = regionOf(
			parameterFor(scanEcucValues(grown), parameterId(emptyText, 'Count'))!,
			grown,
			'element'
		)!;
		assert.strictEqual(grown.slice(grownRegion.range.start, grownRegion.range.end), '<VALUE>42</VALUE>');
	});
});
