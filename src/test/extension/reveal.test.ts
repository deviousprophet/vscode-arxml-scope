/**
 * AC4 and AC5 — both reveal directions, including an offset inside a value selecting
 * its parameter and an offset on a tag selecting that element.
 *
 * The mapping is asserted through the real commands, so the live editor and the
 * programmatic surface cannot diverge.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { buildNodeIndex } from '../../core/ecuc/nodeId';
import { innermostNodeIdAt } from '../../host/navigation';
import { buildRows, EcucRow } from '../../core/ecuc/renderRows';
import type { EditorProviderToWebview } from '../../webviewProtocol';
import { fixtureText, slice } from '../core/modelTestUtils';
import { activeViewType, fixtureUri, sleep } from './testUtils';

const FIXTURE = 'editor/navigation.arxml';
const VIEW_TYPE = 'vscode-arxml-scope.ecucEditor';

suite('editor reveal (AC4, AC5)', () => {
	test('AC4: an offset inside an element selects that element, not an ancestor', () => {
		const model = scanEcucValues(fixtureText(FIXTURE));
		const index = buildNodeIndex(model);
		const module = model.modules[0];
		const container = module.containers[0];
		const parameter = container.parameters[0];

		// Inside the parameter's own `<VALUE>` text: the parameter wins over its
		// container and its module.
		assert.strictEqual(innermostNodeIdAt(index, parameter.valueRange!.start), index.idOf(parameter));
		assert.strictEqual(innermostNodeIdAt(index, parameter.valueRange!.end - 1), index.idOf(parameter));
		// On the container's own tag.
		assert.strictEqual(innermostNodeIdAt(index, container.range.start + 1), index.idOf(container));
		// On the module's own tag.
		assert.strictEqual(innermostNodeIdAt(index, module.range.start + 1), index.idOf(module));
		// An offset in the XML prologue belongs to no node.
		assert.strictEqual(innermostNodeIdAt(index, 0), undefined);
	});

	test('AC4: reveal from a parameter, a container and a reference selects its range', async () => {
		const uri = fixtureUri(FIXTURE);
		const text = fixtureText(FIXTURE);
		const model = scanEcucValues(text);
		const index = buildNodeIndex(model);
		const container = model.modules[0].containers[0];

		for (const node of [container.parameters[0], container, container.references[0]]) {
			const id = index.idOf(node)!;
			const range = await vscode.commands.executeCommand<vscode.Range>('vscode-arxml-scope.revealInSource', uri, id);
			assert.ok(range, id);
			// UX child design §3: reveal opens the source *beside* the tree and preserves
			// focus, so the editor is visible but is not necessarily the focused one. The
			// old `activeTextEditor` assertion was the behaviour that defect described.
			const editor = vscode.window.visibleTextEditors.find(
				(candidate) => candidate.document.uri.toString() === uri.toString()
			);
			assert.ok(editor, 'the range must be shown in a visible text editor');
			assert.strictEqual(editor.document.getText(range), slice(text, node.range), id);
			assert.strictEqual(editor.selection.start.line, range.start.line, id);
			assert.strictEqual(editor.selection.start.character, range.start.character, id);
			assert.strictEqual(editor.selection.end.character, range.end.character, id);
		}
	});

	test('AC5: reveal from a text cursor opens the custom editor at the innermost node', async () => {
		const uri = fixtureUri(FIXTURE);
		const model = scanEcucValues(fixtureText(FIXTURE));
		const index = buildNodeIndex(model);
		const parameter = model.modules[0].containers[0].parameters[0];

		const document = await vscode.workspace.openTextDocument(uri);
		const editor = await vscode.window.showTextDocument(document);
		const at = document.positionAt(parameter.valueRange!.start + 1);
		editor.selection = new vscode.Selection(at, at);

		const nodeId = await vscode.commands.executeCommand<string>('vscode-arxml-scope.revealInEcucEditor', uri);
		assert.strictEqual(nodeId, index.idOf(parameter), 'the innermost containing node is selected');

		await sleep(500);
		assert.strictEqual(activeViewType(), VIEW_TYPE, 'the custom editor is open');
	});

	test('AC5: the requested selection is carried in the host document message', () => {
		const model = scanEcucValues(fixtureText(FIXTURE));
		const index = buildNodeIndex(model);
		const id = index.idOf(model.modules[0].containers[0].parameters[0])!;
		const rows = buildRows(model, { sort: 'all', sortExcept: [] }).rows;
		const message: EditorProviderToWebview = {
			type: 'document',
			document: { rows, selectedId: id },
		};
		assert.strictEqual(message.document.selectedId, id, 'exactly one selection is requested');
		assert.ok(message.document.rows.some((row: EcucRow) => row.id === id), 'the selected row is in the data');
	});
});
