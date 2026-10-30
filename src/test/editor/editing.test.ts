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
 * performs is real, so undo, redo, dirty state and save are the platform's own - the same
 * behaviour the extension tests observe.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { LineIndex } from '../../core/text/offsets';
import { EcucEditorProvider } from '../../editor/ecucEditorProvider';
import {
	applyEdit,
	buildEdit,
	buildFieldEdit,
	nodeFor,
	parameterFor,
	regionOf,
	wrapElement,
} from '../../editor/ecucEdit';
import { buildNodeIndex } from '../../editor/nodeId';
import { EcucRow, buildRows } from '../../editor/renderRows';
import { renderHtml } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';
import { repoRoot, sleep } from './editorTestUtils';

interface StubMessage {
	type?: string;
	rows?: EcucRow[];
	message?: string;
	nodeId?: string;
	selectedId?: string;
	inline?: boolean;
	scope?: string;
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

/** The path-based id of a container, as the provider's own index computes it. */
function containerId(text: string, shortName: string): string {
	const model = scanEcucValues(text);
	const index = buildNodeIndex(model);
	for (const container of model.modules[0].containers) {
		if (container.shortName === shortName) {
			const id = index.idOf(container);
			assert.ok(id, shortName);
			return id;
		}
	}
	throw new Error(`no container named ${shortName}`);
}

/** The path-based id of a module, as the provider's own index computes it. */
function moduleId(text: string): string {
	const model = scanEcucValues(text);
	const index = buildNodeIndex(model);
	const id = index.idOf(model.modules[0]);
	assert.ok(id);
	return id;
}

/**
 * The id the **row data** gives the parameter labelled `name`.
 *
 * This is the widget's own source of truth (`item.dataset.nodeId`), so a test that uses
 * it exercises the contract the two children share: the id rendered after a re-scan is
 * the id the write path resolves. Deriving it with `parameterId` instead would let the
 * two sides disagree without any test noticing.
 */
function nodeIdInRows(rows: readonly EcucRow[], name: string): string | undefined {
	return rows.find((row) => row.label === name)?.id;
}

function notices(stub: StubPanel): StubMessage[] {
	return stub.messages.filter((message) => message.type === 'notice');
}

function lastNotice(stub: StubPanel): StubMessage {
	return notices(stub).at(-1) ?? {};
}

/** The last refusal; the details panel owns it, so it is marked `inline`. */
function lastRefusal(stub: StubPanel): StubMessage {
	const notice = lastNotice(stub);
	assert.strictEqual(notice.inline, true, 'a field refusal is shown inline in the details panel');
	return notice;
}

function lastModel(stub: StubPanel): StubMessage {
	return stub.messages.filter((message) => message.type === 'model').at(-1) ?? {};
}

function lastRows(stub: StubPanel): EcucRow[] {
	return lastModel(stub).rows ?? [];
}

/** A fresh scan rendered exactly as the provider renders it, for the staleness check. */
function expectedRows(text: string): EcucRow[] {
	return buildRows(scanEcucValues(text), {
		sort: 'all',
		sortExcept: [...SORT_EXCEPTIONS],
	}).rows;
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

	test('§2.1: a CDATA-backed value is refused, not mistaken for an element', () => {
		const text = fixtureText('editing/cdata.arxml');
		const model = scanEcucValues(text);
		const id = parameterId(text, 'Pattern');
		const parameter = parameterFor(model, id)!;

		// The scanner points `valueRange` at the inside of the section, so its first byte is
		// `<` although it is not an element. Neither region kind may be resolved from it:
		// `element` would write markup into the value, `value` would write escaped text into
		// a section where `&` is literal.
		assert.strictEqual(text[parameter.valueRange!.start], '<', 'the bytes look like an element');
		assert.strictEqual(regionOf(parameter, text, 'value'), undefined);
		assert.strictEqual(regionOf(parameter, text, 'element'), undefined);

		const plan = buildEdit(model, text, id, '42');
		assert.strictEqual(plan.ok, false, 'a CDATA value is refused rather than wrapped');
		assert.ok(plan.ok === false && plan.reason.includes('CDATA'), plan.ok ? 'accepted' : plan.reason);
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
				const rows = lastRows(stub);
				return rows.some((row) => row.value === '42') && !rows.some((row) => row.value === '99');
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

			assert.ok(lastRefusal(stub).message?.includes('integer'), lastRefusal(stub).message);
			assert.strictEqual(document.getText(), before, 'the document is untouched');
			assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), onDisk, 'the file is untouched');
			assert.strictEqual(document.isDirty, false, 'a refusal does not dirty the document');
		});
	});

	test('AC6: a character XML cannot represent is refused with a reason and no mutation', async () => {
		await withEditingFixture('textual.arxml', async (uri, document) => {
			const before = document.getText();
			const onDisk = fs.readFileSync(uri.fsPath, 'utf8');
			const { stub } = open(document);

			await stub.send({ type: 'edit', nodeId: parameterId(before, 'Label'), value: 'bad\u0001char' });
			await waitFor('the refusal', () => notices(stub).length > 0);

			assert.ok(lastRefusal(stub).message?.includes('XML cannot represent'), lastRefusal(stub).message);
			assert.strictEqual(document.getText(), before);
			assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), onDisk, 'the file is untouched');
			assert.strictEqual(document.isDirty, false);
		});
	});

	test('AC6: a CDATA-backed value is refused with a reason and no mutation', async () => {
		await withEditingFixture('cdata.arxml', async (uri, document) => {
			const before = document.getText();
			const onDisk = fs.readFileSync(uri.fsPath, 'utf8');
			const { stub } = open(document);

			// `Pattern` holds `<![CDATA[<b>]]>`: a write there would put markup into the value.
			await stub.send({ type: 'edit', nodeId: parameterId(before, 'Pattern'), value: '42' });
			await waitFor('the refusal', () => notices(stub).length > 0);

			assert.ok(lastRefusal(stub).message?.includes('CDATA'), lastRefusal(stub).message);
			assert.strictEqual(document.getText(), before, 'the document is untouched');
			assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), onDisk, 'the file is untouched');
			assert.strictEqual(document.isDirty, false, 'a refusal does not dirty the document');
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

	test('AC6: a record whose region no longer resolves is refused rather than written', async () => {
		await withEditingFixture('self-closing.arxml', async (_uri, document) => {
			const before = document.getText();
			// A `value` record cannot resolve against a self-closing element: it has no text
			// content to replace, so `regionOf` finds nothing and the write is refused.
			const record = {
				nodeId: parameterId(before, 'Count'),
				region: 'value' as const,
				oldText: '7',
				newText: '42',
			};
			const result = await applyEdit(document, record);

			assert.strictEqual(result.ok, false, 'an unresolvable region is not applied');
			assert.ok(
				result.ok === false && result.reason.includes('<VALUE>'),
				'the refusal names the element it could not find'
			);
			assert.strictEqual(document.getText(), before, 'the document is untouched');
			assert.strictEqual(document.isDirty, false);
		});
	});

	test('AC7: an unchanged value is a no-op and does not dirty the document', async () => {
		await withEditingFixture('numeric.arxml', async (_uri, document) => {
			const before = document.getText();
			const { stub } = open(document);

			await stub.send({ type: 'edit', nodeId: parameterId(before, 'Count'), value: '7' });
			await waitFor('the refusal', () => notices(stub).length > 0);

			assert.ok(lastRefusal(stub).message?.includes('unchanged'), lastRefusal(stub).message);
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
			await waitFor('the pushed edit', () => lastRows(stub).some((row) => row.value === '42'));
			assert.deepStrictEqual(lastRows(stub), expectedRows(document.getText()), 'after the edit');

			await vscode.commands.executeCommand('undo');
			await waitFor('the pushed undo', () => lastRows(stub).some((row) => row.value === '7'));
			assert.deepStrictEqual(lastRows(stub), expectedRows(document.getText()), 'after the undo');
			assert.ok(!lastRows(stub).some((row) => row.value === '42'), 'no stale value is on screen');

			await vscode.commands.executeCommand('redo');
			await waitFor('the pushed redo', () => lastRows(stub).some((row) => row.value === '42'));
			assert.deepStrictEqual(lastRows(stub), expectedRows(document.getText()), 'after the redo');
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

	test('AC7: an edit on a CRLF document leaves every other byte, line endings included', async () => {
		await withEditingFixture('crlf.arxml', async (uri, document) => {
			const before = document.getText();
			assert.ok(before.includes('\r\n'), 'the fixture is CRLF');
			const breaks = (before.match(/\r\n/g) ?? []).length;

			// Derived by hand from the fixture: only the value's inner text changes.
			const expected = before.replace('<VALUE>63</VALUE>', '<VALUE>64</VALUE>');
			assert.notStrictEqual(expected, before, 'the replacement actually applied to the expectation');

			const { stub } = open(document);
			await stub.send({ type: 'edit', nodeId: parameterId(before, 'IniValue'), value: '64' });
			await waitFor('the CRLF edit', () => document.getText().includes('<VALUE>64</VALUE>'));

			assert.strictEqual(document.getText(), expected, 'only the value changed');
			assert.strictEqual((document.getText().match(/\r\n/g) ?? []).length, breaks, 'no line ending changed');

			await document.save();
			assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), expected, 'the bytes on disk');
		});
	});

	test('§2.2: the offset-to-position conversion the write uses is VS Code’s, on CRLF too', async () => {
		await withEditingFixture('crlf.arxml', async (_uri, document) => {
			const text = document.getText();
			const index = new LineIndex(text);
			const mismatches: number[] = [];
			for (let offset = 0; offset <= text.length; offset++) {
				const mine = index.positionAt(offset);
				const theirs = document.positionAt(offset);
				if (mine.line !== theirs.line || mine.character !== theirs.character) {
					mismatches.push(offset);
				}
			}
			// VS Code reports the `\r` for an offset that falls on the `\n` of a CRLF;
			// `LineIndex` reports the offset literally. That is the only divergence, and a
			// region never begins or ends inside an EOL — the value's bytes are trimmed of
			// their surrounding whitespace first — so the write is unaffected.
			for (const offset of mismatches) {
				assert.strictEqual(text.slice(offset - 1, offset + 1), '\r\n', `offset ${offset} is not an EOL interior`);
			}
			assert.ok(mismatches.length > 0, 'the CRLF fixture exercises the divergence');

			// What the write actually depends on: the `Range` built from `LineIndex` selects
			// exactly the bytes of the region it was computed for.
			const model = scanEcucValues(text);
			for (const parameter of model.modules[0].containers[0].parameters) {
				for (const region of ['value', 'element'] as const) {
					const described = regionOf(parameter, text, region);
					if (!described) {
						continue;
					}
					const start = index.positionAt(described.range.start);
					const end = index.positionAt(described.range.end);
					assert.strictEqual(
						document.getText(new vscode.Range(start.line, start.character, end.line, end.character)),
						described.oldText,
						`${parameter.name} ${region}`
					);
				}
			}
		});
	});

	test('§9: the rows carry the value the details editor edits, and the details editor is inlined', () => {
		const model = scanEcucValues(fixtureText('editing/numeric.arxml'));
		const rows = buildRows(model, {}).rows;
		const parameter = rows.find((row) => row.kind === 'parameter')!;
		assert.strictEqual(parameter.id.includes('param:Count'), true, 'the row is the parameter');
		assert.strictEqual(parameter.value, '7', 'the current value is what the editor starts from');
		assert.strictEqual(parameter.parameterType, 'Integer', 'the AUTOSAR type comes from DEFINITION-REF DEST');
		assert.deepStrictEqual(parameter.formats, [
			{ label: 'Decimal', value: '7' },
			{ label: 'Hexadecimal', value: '0x07' },
			{ label: 'Binary', value: '0b00000111' },
		]);
		assert.ok(!parameter.meta.some((part) => part.text.indexOf('(= 0x') === 0), 'hex is no longer Document meta');

		const page = renderHtml(model, { nonce: 'test-nonce' });
		assert.ok(page.includes('.details-value'), 'the editor is styled from --vscode-* variables');
		assert.ok(page.includes("type: 'edit'"), 'and posts the edit message');
		assert.ok(page.includes('nodeId: edit.rowId'), 'with the id the provider resolves');
		assert.ok(page.includes("event.key === 'Enter'"), 'Enter commits');
		assert.ok(page.includes("event.key === 'Escape'"), 'Escape cancels');
		assert.ok(page.includes("event.key === 'Tab'"), 'Tab commits and moves');
		assert.ok(!page.includes("span.querySelector('.value-text')"), 'the Document value is not an input host');
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

	test('§2.2: the element span of a value ending in a raw `>` still reaches `</VALUE>`', () => {
		// `>` is legal unescaped in XML text, so `<VALUE>a></VALUE>` is well formed and
		// the value's own `>` is the last character of the text region. An element span
		// found from that character stops short of the closing tag, and a write would
		// leave a stray `</VALUE>` behind.
		const text = fixtureText('editing/numeric.arxml').replace('<VALUE>7</VALUE>', '<VALUE>a></VALUE>');
		const model = scanEcucValues(text);
		const parameter = parameterFor(model, parameterId(text, 'Count'))!;
		assert.strictEqual(parameter.displayValue, 'a>', 'the fixture really ends the text with `>`');

		const described = regionOf(parameter, text, 'element')!;
		assert.strictEqual(text.slice(described.range.start, described.range.end), '<VALUE>a></VALUE>');
		assert.strictEqual(wrapElement(described.oldText, '42'), '<VALUE>42</VALUE>');
	});

	test('§2.2: a `>` inside an attribute does not truncate the element being wrapped', () => {
		// `>` is legal unescaped in an attribute value, so the first `>` of the slice is not
		// necessarily the end of the open tag. The scanner's lexer is quote-aware for that
		// reason (parent design §5); a wrapper that is not rewrites the element without its
		// closing quote and the attributes after it, which is not well-formed XML. The
		// element's own tags are kept verbatim, so the attribute survives the write.
		const text = fixtureText('editing/self-closing.arxml').replace('<VALUE/>', '<VALUE DEST="a>b"/>');
		const model = scanEcucValues(text);
		const id = parameterId(text, 'Count');
		const described = regionOf(parameterFor(model, id)!, text, 'element')!;
		assert.strictEqual(described.oldText, '<VALUE DEST="a>b"/>', 'the whole element, verbatim');
		assert.strictEqual(wrapElement(described.oldText, '42'), '<VALUE DEST="a>b">42</VALUE>');

		const plan = buildEdit(model, text, id, '42');
		assert.ok(plan.ok);
		assert.strictEqual(plan.record.newText, '<VALUE DEST="a>b">42</VALUE>');
	});

	test('§2.2: the id in the re-scanned rows is the id the next edit resolves', async () => {
		// The seam the editing child rests on: after a change — an edit, an undo, an
		// external write — the rows the user clicks are a re-scan, so the id in them must
		// be the id `buildEdit` resolves. The id is taken from the rendered row data,
		// exactly as the widget takes it from `data-node-id`, and never re-derived by the test.
		await withEditingFixture('numeric.arxml', async (_uri, document) => {
			const original = document.getText();
			const { stub } = open(document);
			await vscode.window.showTextDocument(document);

			await stub.send({ type: 'edit', nodeId: parameterId(original, 'Count'), value: '42' });
			await waitFor('the first edit', () => document.getText().includes('<VALUE>42</VALUE>'));
			await vscode.commands.executeCommand('undo');
			await waitFor('the pushed undo', () => lastRows(stub).some((row) => row.value === '7'));
			assert.strictEqual(document.getText(), original, 'one press restores the bytes');

			const id = nodeIdInRows(lastRows(stub), 'Count');
			assert.ok(id, 'the re-scanned rows still carry the parameter');
			assert.strictEqual(id, parameterId(original, 'Count'), 'and it is the id the write path resolves');

			await stub.send({ type: 'edit', nodeId: id!, value: '9' });
			await waitFor('the second edit', () => document.getText().includes('<VALUE>9</VALUE>'));
			assert.strictEqual(document.getText(), original.replace('<VALUE>7</VALUE>', '<VALUE>9</VALUE>'));
			await waitFor('the pushed second edit', () => lastRows(stub).some((row) => row.value === '9'));
		});
	});
});

/**
 * A module whose containers have no `SHORT-NAME` text to replace: absent, empty, or
 * CDATA-backed, plus one with no `DEFINITION-REF` at all. Hand-written for the refusal
 * cases; adding or creating an element is out of scope (`prd.md`, non-goals).
 */
const sparseContainers = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0">
    <AR-PACKAGES>
        <AR-PACKAGE>
            <SHORT-NAME>PkgS</SHORT-NAME>
            <ELEMENTS>
                <ECUC-MODULE-CONFIGURATION-VALUES>
                    <SHORT-NAME>SparseMod</SHORT-NAME>
                    <DEFINITION-REF DEST="ECUC-MODULE-DEF">/PkgS/SparseMod</DEFINITION-REF>
                    <CONTAINERS>
                        <ECUC-CONTAINER-VALUE>
                            <DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/PkgS/SparseMod/NoName</DEFINITION-REF>
                        </ECUC-CONTAINER-VALUE>
                        <ECUC-CONTAINER-VALUE>
                            <SHORT-NAME></SHORT-NAME>
                            <DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/PkgS/SparseMod/EmptyName</DEFINITION-REF>
                        </ECUC-CONTAINER-VALUE>
                        <ECUC-CONTAINER-VALUE>
                            <SHORT-NAME><![CDATA[CdataCont]]></SHORT-NAME>
                        </ECUC-CONTAINER-VALUE>
                    </CONTAINERS>
                </ECUC-MODULE-CONFIGURATION-VALUES>
            </ELEMENTS>
        </AR-PACKAGE>
    </AR-PACKAGES>
</AUTOSAR>
`;

/**
 * Container short name and definition ref editing (prd R1–R5).
 *
 * The byte expectations are hand-derived: the expected files differ from
 * `editing/container.arxml` in exactly one contiguous span, so a writer that rewrites the
 * element, its `DEST`, or the surrounding lines fails the whole-file comparison.
 */
suite('editor container field editing (R1–R5)', () => {
	/** The committed fixtures as they were before this suite ran any edit. */
	let committedBefore: Map<string, string>;
	suiteSetup(() => {
		committedBefore = new Map(
			fs.readdirSync(fixturesDir).map((name) => [name, fs.readFileSync(committed(name), 'utf8')])
		);
	});

	test('R1/R2: the plan replaces the inner text, never the tags or attributes', () => {
		const text = fixtureText('editing/container.arxml');
		const model = scanEcucValues(text);
		const id = containerId(text, 'FirstCont');
		const node = nodeFor(model, id)!;

		const shortName = buildFieldEdit(model, text, id, 'shortName', 'FirstContA');
		assert.ok(shortName.ok);
		assert.strictEqual(shortName.record.region, 'shortName');
		assert.strictEqual(shortName.record.oldText, 'FirstCont', 'no tag bytes are in the region');
		assert.strictEqual(shortName.record.newText, 'FirstContA');
		const shortRange = regionOf(node, text, 'shortName')!.range;
		assert.strictEqual(text.slice(shortRange.start - 1, shortRange.end + 1), '>FirstCont<');

		const definitionRef = '/PkgF/ContDefs/ContMod/FirstContRenamed';
		const reference = buildFieldEdit(model, text, id, 'definitionRef', definitionRef);
		assert.ok(reference.ok);
		assert.strictEqual(reference.record.region, 'definitionRef');
		assert.strictEqual(reference.record.oldText, '/PkgF/ContDefs/ContMod/FirstCont');
		assert.strictEqual(reference.record.newText, definitionRef);
		const refRange = regionOf(node, text, 'definitionRef')!.range;
		assert.strictEqual(
			text.slice(refRange.start - 1, refRange.end + 1),
			'>/PkgF/ContDefs/ContMod/FirstCont<',
			'the region is the inner text only'
		);
		// The element's own tag and `DEST` attribute sit before the region.
		const openTagAt = text.lastIndexOf('<DEFINITION-REF', refRange.start);
		assert.ok(
			text.slice(openTagAt, refRange.start).includes('DEST="ECUC-PARAM-CONF-CONTAINER-DEF"'),
			'the attribute is outside the span the write replaces'
		);
	});

	test('R4/R5: only a container, and only a known node, can be edited', () => {
		const text = fixtureText('editing/container.arxml');
		const model = scanEcucValues(text);

		const missing = buildFieldEdit(model, text, 'container:gone', 'shortName', 'Other');
		assert.ok(missing.ok === false && missing.reason.includes('no longer in the file'), String(missing));

		const module = buildFieldEdit(model, text, moduleId(text), 'shortName', 'OtherMod');
		assert.ok(module.ok === false && module.reason === 'the node is not a container', String(module));

		const parameter = buildFieldEdit(model, text, parameterId(text, 'Count'), 'definitionRef', '/Gone');
		assert.ok(parameter.ok === false && parameter.reason === 'the node is not a container', String(parameter));
	});

	test('R4: an invalid or unchanged container field is refused with its reason', () => {
		const text = fixtureText('editing/container.arxml');
		const model = scanEcucValues(text);
		const id = containerId(text, 'FirstCont');

		for (const value of ['', 'First Cont', 'First/Cont', 'First&Cont', '1First']) {
			const plan = buildFieldEdit(model, text, id, 'shortName', value);
			assert.ok(plan.ok === false, JSON.stringify(value));
			assert.ok(plan.ok === false && plan.reason.length > 0, JSON.stringify(value));
		}
		const relative = buildFieldEdit(model, text, id, 'definitionRef', 'PkgF/ContDefs/ContMod/FirstCont');
		assert.ok(relative.ok === false && relative.reason.includes('absolute /-separated path'), String(relative));

		const unchangedShortName = buildFieldEdit(model, text, id, 'shortName', 'FirstCont');
		assert.ok(unchangedShortName.ok === false && unchangedShortName.reason === 'the short name is unchanged');
		const unchangedRef = buildFieldEdit(model, text, id, 'definitionRef', '/PkgF/ContDefs/ContMod/FirstCont');
		assert.ok(unchangedRef.ok === false && unchangedRef.reason === 'the definition ref is unchanged');
	});

	test('R5: a rename predicts the new id; a ref edit keeps the id', () => {
		const text = fixtureText('editing/container.arxml');
		const model = scanEcucValues(text);
		const id = containerId(text, 'FirstCont');

		const rename = buildFieldEdit(model, text, id, 'shortName', 'FirstContA');
		assert.ok(rename.ok);
		assert.ok(rename.nextNodeId, 'a rename has a predicted id');
		assert.notStrictEqual(rename.nextNodeId, id, 'the old id is invalid after the rename');
		const renamed = fixtureText('editing/container-short-name.expected.arxml');
		assert.strictEqual(rename.nextNodeId, containerId(renamed, 'FirstContA'), 'the id the re-scan will assign');

		const reference = buildFieldEdit(model, text, id, 'definitionRef', '/PkgF/ContDefs/ContMod/FirstContRenamed');
		assert.ok(reference.ok);
		assert.strictEqual(reference.nextNodeId, id, 'a definition-ref edit does not renumber the container');

		// The value path is not touched by the prediction.
		const value = buildEdit(scanEcucValues(fixtureText('editing/numeric.arxml')), fixtureText('editing/numeric.arxml'), parameterId(fixtureText('editing/numeric.arxml'), 'Count'), '42');
		assert.ok(value.ok);
		assert.strictEqual(value.nextNodeId, undefined);
	});

	test('AC2/AC6: a short-name commit changes one span, keeps the selection and its new id', async () => {
		await withEditingFixture('container.arxml', async (uri, document, dir) => {
			const original = document.getText();
			const { stub } = open(document);
			await vscode.window.showTextDocument(document);
			const id = containerId(original, 'FirstCont');
			await stub.send({ type: 'select', nodeId: id });

			await stub.send({ type: 'edit', nodeId: id, field: 'shortName', value: 'FirstContA' });
			await waitFor('the rename', () => document.getText().includes('<SHORT-NAME>FirstContA</SHORT-NAME>'));

			const renamed = fixtureText('editing/container-short-name.expected.arxml');
			assert.strictEqual(document.getText(), renamed, 'only the short name line changed');
			assert.strictEqual(document.isDirty, true);

			const newId = containerId(renamed, 'FirstContA');
			await waitFor('the re-scan with the new id', () => lastModel(stub).selectedId === newId);
			assert.strictEqual(lastModel(stub).selectedId, newId, 'the renamed container stays selected');
			const row = lastRows(stub).find((candidate) => candidate.id === newId);
			assert.ok(row, 'the re-scanned rows carry the new id');
			assert.strictEqual(row!.shortName, 'FirstContA', 'and the new short name');

			await document.save();
			assert.strictEqual(fs.readFileSync(path.join(dir, 'container.arxml'), 'utf8'), renamed);

			await vscode.commands.executeCommand('undo');
			await waitFor('one undo', () => document.getText() === original);
			assert.strictEqual(document.getText(), original, 'one press restores the previous bytes');
			await vscode.commands.executeCommand('redo');
			await waitFor('one redo', () => document.getText() === renamed);
			assert.strictEqual(document.getText(), renamed);
		});
	});

	test('AC3/AC7: a definition-ref commit keeps DEST and the container selected', async () => {
		await withEditingFixture('container.arxml', async (uri, document, dir) => {
			const original = document.getText();
			const { stub } = open(document);
			await vscode.window.showTextDocument(document);
			const id = containerId(original, 'FirstCont');
			await stub.send({ type: 'select', nodeId: id });

			const next = '/PkgF/ContDefs/ContMod/FirstContRenamed';
			await stub.send({ type: 'edit', nodeId: id, field: 'definitionRef', value: next });
			await waitFor('the definition-ref edit', () => document.getText().includes(next + '</DEFINITION-REF>'));

			const edited = fixtureText('editing/container-ref.expected.arxml');
			assert.strictEqual(document.getText(), edited, 'only the DEFINITION-REF inner text changed');
			assert.ok(
				document.getText().includes('<DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">' + next),
				'the DEST attribute and tag spelling are intact'
			);

			await waitFor('the re-scan with the container selected', () => lastModel(stub).selectedId === id);
			assert.strictEqual(lastModel(stub).selectedId, id, 'the container is still selected');
			await waitFor('the row label to follow the new tail', () =>
				lastRows(stub).some((candidate) => candidate.id === id && candidate.label === 'FirstContRenamed')
			);
			assert.strictEqual(lastRows(stub).find((candidate) => candidate.id === id)!.shortName, 'FirstCont');

			await document.save();
			assert.strictEqual(fs.readFileSync(path.join(dir, 'container.arxml'), 'utf8'), edited);

			await vscode.commands.executeCommand('undo');
			await waitFor('one undo', () => document.getText() === original);
			assert.strictEqual(document.getText(), original);
			await vscode.commands.executeCommand('redo');
			await waitFor('one redo', () => document.getText() === edited);
		});
	});

	test('AC5: a refused container edit leaves the bytes, the file and the selection alone', async () => {
		await withEditingFixture('container.arxml', async (uri, document) => {
			const before = document.getText();
			const onDisk = fs.readFileSync(uri.fsPath, 'utf8');
			const { stub } = open(document);
			const id = containerId(before, 'FirstCont');
			await stub.send({ type: 'select', nodeId: id });

			await stub.send({ type: 'edit', nodeId: id, field: 'shortName', value: 'First Cont' });
			await waitFor('the refusal', () => notices(stub).length > 0);
			assert.ok(lastRefusal(stub).message?.includes('not a valid short name'), lastRefusal(stub).message);
			assert.strictEqual(document.getText(), before, 'the document is untouched');
			assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), onDisk, 'the file is untouched');
			assert.strictEqual(document.isDirty, false, 'a refusal does not dirty the document');

			// A later re-scan still carries the selection the user had: the refusal did not
			// swap in a predicted id.
			await stub.send({ type: 'edit', nodeId: parameterId(before, 'Count'), value: '9' });
			await waitFor('an unrelated re-scan', () => lastRows(stub).some((row) => row.value === '9'));
			assert.strictEqual(lastModel(stub).selectedId, id, 'the selection survived the refusal');
		});
	});

	test('AC5: an unchanged container field does not dirty the document', async () => {
		await withEditingFixture('container.arxml', async (uri, document) => {
			const before = document.getText();
			const { stub } = open(document);
			const id = containerId(before, 'FirstCont');

			await stub.send({ type: 'edit', nodeId: id, field: 'shortName', value: 'FirstCont' });
			await waitFor('the refusal', () => notices(stub).length > 0);
			assert.ok(lastRefusal(stub).message?.includes('unchanged'), lastRefusal(stub).message);
			assert.strictEqual(document.getText(), before);
			assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), before);
			assert.strictEqual(document.isDirty, false);
		});
	});

	test('R3: the parameter value message shape is unchanged', async () => {
		await withEditingFixture('container.arxml', async (_uri, document) => {
			const original = document.getText();
			const { stub } = open(document);
			await stub.send({ type: 'edit', nodeId: parameterId(original, 'Count'), value: '42' });
			await waitFor('the value edit', () => document.getText().includes('<VALUE>42</VALUE>'));
			assert.strictEqual(
				document.getText(),
				original.replace('<VALUE>7</VALUE>', '<VALUE>42</VALUE>'),
				'the value path still writes only the VALUE text'
			);
		});
	});

	test('R4: an absent, empty or CDATA-backed element is refused, never created', () => {
		// Hand-written: three containers whose SHORT-NAME is absent, empty and CDATA-backed,
		// and one whose DEFINITION-REF is absent. Adding an element is out of scope, so the
		// plan must refuse instead of writing text where there is no inner text span.
		const text = sparseContainers;
		const model = scanEcucValues(text);
		const index = buildNodeIndex(model);
		const [noName, emptyName, cdataName] = model.modules[0].containers;
		assert.strictEqual(model.modules[0].containers.length, 3);

		const missing = buildFieldEdit(model, text, index.idOf(noName)!, 'shortName', 'NowNamed');
		assert.ok(missing.ok === false && missing.reason.includes('no <SHORT-NAME> text'), String(missing));

		const empty = buildFieldEdit(model, text, index.idOf(emptyName)!, 'shortName', 'NowNamed');
		assert.ok(empty.ok === false && empty.reason.includes('no <SHORT-NAME> text'), String(empty));

		assert.strictEqual(cdataName.shortName, 'CdataCont', 'the CDATA text is read');
		const cdata = buildFieldEdit(model, text, index.idOf(cdataName)!, 'shortName', 'CdataRenamed');
		assert.ok(cdata.ok === false && cdata.reason.includes('no <SHORT-NAME> text'), String(cdata));

		const noRef = buildFieldEdit(model, text, index.idOf(cdataName)!, 'definitionRef', '/PkgS/SparseMod/CdataCont');
		assert.ok(noRef.ok === false && noRef.reason.includes('no <DEFINITION-REF> text'), String(noRef));
	});

	test('R5: a stale container region is refused instead of rewriting moved bytes', async () => {
		await withEditingFixture('container.arxml', async (_uri, document) => {
			const text = document.getText();
			const model = scanEcucValues(text);
			const id = containerId(text, 'FirstCont');

			// Both plans are prepared against the same bytes; the id is unchanged by a
			// definition-ref edit, so only the region's own text can tell them apart.
			const first = buildFieldEdit(model, text, id, 'definitionRef', '/PkgF/ContDefs/ContMod/One');
			const second = buildFieldEdit(model, text, id, 'definitionRef', '/PkgF/ContDefs/ContMod/Two');
			assert.ok(first.ok && second.ok);

			assert.deepStrictEqual(await applyEdit(document, first.record), { ok: true });
			const written = document.getText();
			assert.strictEqual(
				written,
				text.replace(
					'<DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/PkgF/ContDefs/ContMod/FirstCont</DEFINITION-REF>',
					'<DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/PkgF/ContDefs/ContMod/One</DEFINITION-REF>'
				),
				'one contiguous change, hand-derived'
			);

			const stale = await applyEdit(document, second.record);
			assert.strictEqual(stale.ok, false, 'the stale record is refused');
			assert.ok(stale.ok === false && stale.reason.includes('changed since'), String(stale));
			assert.strictEqual(document.getText(), written, 'the refusal wrote nothing');
		});
	});

	test('R5: a rename onto a sibling short name still predicts the renamed node', () => {
		const text = fixtureText('editing/container.arxml');
		const model = scanEcucValues(text);
		const index = buildNodeIndex(model);
		const sibling = model.modules[0].containers[1];
		assert.strictEqual(sibling.shortName, 'SiblingCont');
		const siblingStart = sibling.range.start;

		const plan = buildFieldEdit(model, text, index.idOf(sibling)!, 'shortName', 'FirstCont');
		assert.ok(plan.ok);
		assert.ok(plan.nextNodeId, 'the rename still has a predicted id');

		const predicted = scanEcucValues(
			text.replace('<SHORT-NAME>SiblingCont</SHORT-NAME>', '<SHORT-NAME>FirstCont</SHORT-NAME>')
		);
		const renamed = nodeFor(predicted, plan.nextNodeId!);
		assert.ok(renamed && renamed.kind === 'container', 'the predicted id resolves');
		assert.strictEqual(
			renamed!.range.start,
			siblingStart,
			'the id names the renamed sibling, not the sibling that already had that name'
		);
		assert.notStrictEqual(plan.nextNodeId, containerId(text, 'FirstCont'), 'the namesake keeps its own id');
	});

	test('R4: an unknown edit field is ignored, not guessed at', async () => {
		await withEditingFixture('container.arxml', async (uri, document) => {
			const before = document.getText();
			const { stub } = open(document);
			const id = containerId(before, 'FirstCont');

			await stub.send({ type: 'edit', nodeId: id, field: 'sortKey', value: '/PkgF/Elsewhere' });
			await sleep(50);

			assert.strictEqual(notices(stub).length, 0, 'the message is dropped, not refused as a ref edit');
			assert.strictEqual(document.getText(), before);
			assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), before, 'the file is untouched');
			assert.strictEqual(document.isDirty, false);
		});
	});

	test('AC9: the new fixtures are never written by the suite', () => {
		const names = fs.readdirSync(fixturesDir).sort();
		assert.deepStrictEqual(names, [...committedBefore.keys()].sort(), 'no fixture was added');
		for (const [name, text] of committedBefore) {
			assert.strictEqual(fs.readFileSync(committed(name), 'utf8'), text, `${name} is unmodified`);
		}
		assert.ok(names.includes('container.arxml'), 'the new fixture is present');
		assert.ok(names.includes('container-short-name.expected.arxml'));
		assert.ok(names.includes('container-ref.expected.arxml'));
	});
});
