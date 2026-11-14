/**
 * Following a same-file reference selects the target; an absent path and an
 * ambiguous suffix each produce a message and no navigation, with no exception thrown.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { ReferenceNode } from '../../core/ecuc/model';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { buildNodeIndex } from '../../core/ecuc/nodeId';
import { buildFileIndex } from '../../core/index/indexBuilder';
import { WorkspaceIndex } from '../../core/index/workspaceIndex';
import { followReference, nodeIdForRange } from '../../host/navigation';
import { fixtureText, slice } from '../core/modelTestUtils';
import { fixtureUri } from './testUtils';

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

	test('NAV-03 AC6: an absent path and an ambiguous suffix resolve to nothing, with a reason', () => {
		for (const name of ['Missing', 'Ambiguous']) {
			const result = followReference(model, reference(name));
			assert.strictEqual(result.ok, false, name);
			if (!result.ok) {
				assert.ok(result.reason.length > 0, name);
				assert.ok(result.reason.includes('No same-file target'), name);
			}
		}
	});

	test('NAV-04 a follow whose target was deleted is refused with a reason and navigates nowhere', () => {
		const source = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS>
<ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/M</DEFINITION-REF><CONTAINERS>
<ECUC-CONTAINER-VALUE><SHORT-NAME>Source</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/M/Source</DEFINITION-REF><REFERENCE-VALUES>
<ECUC-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/P/M/Source/Dangling</DEFINITION-REF><VALUE-REF DEST="ECUC-CONTAINER-VALUE">/P/M/Deleted</VALUE-REF></ECUC-REFERENCE-VALUE>
</REFERENCE-VALUES></ECUC-CONTAINER-VALUE>
</CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES>
</ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const model = scanEcucValues(source);
		assert.strictEqual(model.pathIndex.has('/P/M/Deleted'), false, 'the deleted target has no path entry');
		const dangling = model.modules[0].containers[0].references.find((entry) => entry.name === 'Dangling');
		assert.ok(dangling, 'the reference survives its target');

		const result = followReference(model, dangling);
		assert.strictEqual(result.ok, false, 'following must not invent a range');
		if (!result.ok) {
			assert.ok(result.reason.includes('No same-file target'), result.reason);
			assert.ok(result.reason.includes('/P/M/Deleted'), 'the refusal names the missing target');
		}
	});

	test('NAV-05 a parameter target with zero references lists nothing and posts no notice', () => {
		const file = buildFileIndex(
			'file:///params.arxml',
			`<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/M/C/Value</DEFINITION-REF><VALUE>7</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`
		);
		const index = new WorkspaceIndex();
		index.upsert(file);
		const parameter = file.elements.find((element) => element.kind === 'parameter');
		assert.ok(parameter, 'the index keeps the parameter element');
		assert.strictEqual(parameter.path, undefined, 'a parameter has no AR path to key references by');
		assert.deepStrictEqual(index.referencesFor(parameter), [], 'the list is empty, not a refusal');
		assert.strictEqual(
			index.stats().references,
			0,
			'a zero-reference file has no reverse-reference contribution to report'
		);
	});

	test('NAV-02 AC6: following from the command selects the target, and resolves nothing otherwise', async () => {
		const uri = fixtureUri(FIXTURE);
		const target = await vscode.commands.executeCommand<vscode.Range>(
			'vscode-arxml-scope.revealInSource',
			uri,
			index.idOf(reference('Good'))!,
			true
		);
		assert.ok(target, 'the target range');
		// The source opens beside the tree, so the editor is visible
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
