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
import { buildNodeIndex } from '../../editor/nodeId';
import { innermostNodeIdAt } from '../../editor/navigation';
import { renderHtml } from '../../editor/renderHtml';
import { fixtureText, slice } from '../core/modelTestUtils';
import { activeViewType, fixtureUri, sleep } from './editorTestUtils';

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
			const editor = vscode.window.activeTextEditor;
			assert.ok(editor, 'the text editor must be active after reveal');
			assert.strictEqual(editor.document.uri.toString(), uri.toString());
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

	test('AC5: the requested selection is the marked node in the rendered tree', () => {
		const model = scanEcucValues(fixtureText(FIXTURE));
		const index = buildNodeIndex(model);
		const id = index.idOf(model.modules[0].containers[0].parameters[0])!;
		const page = renderHtml(model, { nonce: 'test-nonce', selectedId: id });

		// Scoped to the tree: the stylesheet also mentions the attribute.
		const tree = page.slice(page.indexOf('id="tree"'));
		const marked = tree.split('<div class="node"').find((part) => part.includes('data-selected="true"'));
		assert.ok(marked, 'exactly one node is marked');
		assert.ok(marked.includes(`data-node-id="${id}"`));
		assert.strictEqual(tree.split('data-selected="true"').length - 1, 1);
	});
});
