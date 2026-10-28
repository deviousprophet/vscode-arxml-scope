/**
 * AC6 — following a same-file reference selects the target; an absent path and an
 * ambiguous suffix each produce a message and no navigation, with no exception thrown.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { ReferenceNode } from '../../core/ecuc/model';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { buildNodeIndex } from '../../editor/nodeId';
import { followReference, nodeIdForRange } from '../../editor/navigation';
import { fixtureText, slice } from '../core/modelTestUtils';
import { fixtureUri } from './editorTestUtils';

const FIXTURE = 'editor/navigation.arxml';
const text = fixtureText(FIXTURE);
const model = scanEcucValues(text);
const index = buildNodeIndex(model);
const container = model.modules[0].containers[0];

function reference(name: string): ReferenceNode {
	const found = container.references.find((r) => r.name === name);
	assert.ok(found, name);
	return found;
}

suite('editor references (AC6)', () => {
	test('AC6: a same-file reference resolves to its target element', () => {
		const result = followReference(model, reference('Good'));
		assert.strictEqual(result.ok, true);
		if (result.ok) {
			assert.deepStrictEqual(result.range, container.range);
			assert.ok(slice(text, result.range).startsWith('<ECUC-CONTAINER-VALUE>'));
		}
	});

	test('AC6: a same-file target maps back to its ECUC row id', () => {
		const result = followReference(model, reference('Good'));
		assert.strictEqual(result.ok, true);
		if (result.ok) {
			assert.strictEqual(nodeIdForRange(index, result.range), index.idOf(container));
		}
	});

	test('AC6: an absent path and an ambiguous suffix resolve to nothing, with a reason', () => {
		for (const name of ['Missing', 'Ambiguous']) {
			const result = followReference(model, reference(name));
			assert.strictEqual(result.ok, false, name);
			if (!result.ok) {
				assert.ok(result.reason.length > 0, name);
				assert.ok(result.reason.includes('No same-file target'), name);
			}
		}
	});

	test('AC6: following from the command selects the target, and resolves nothing otherwise', async () => {
		const uri = fixtureUri(FIXTURE);
		const target = await vscode.commands.executeCommand<vscode.Range>(
			'vscode-arxml-scope.revealInSource',
			uri,
			index.idOf(reference('Good'))!,
			true
		);
		assert.ok(target, 'the target range');
		// UX child design §3: the source opens beside the tree, so the editor is visible
		// without having to be the focused one.
		const editor = vscode.window.visibleTextEditors.find(
			(candidate) => candidate.document.uri.toString() === uri.toString()
		);
		assert.ok(editor, 'the range must be shown in a visible text editor');
		assert.strictEqual(editor.document.getText(target), slice(text, container.range));

		for (const name of ['Missing', 'Ambiguous']) {
			const none = await vscode.commands.executeCommand(
				'vscode-arxml-scope.revealInSource',
				uri,
				index.idOf(reference(name))!,
				true
			);
			assert.strictEqual(none, undefined, `${name} must navigate nowhere`);
		}
	});
});
