/**
 * AC2, AC3 and AC9 — the activation gate, the "never claim the default" rule, and the
 * guarantee that a full activation-and-navigation flow writes no file.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { gateReason, VIEW_TYPE } from '../../host/ecucEditorProvider';
import { buildNodeIndex } from '../../core/ecuc/nodeId';
import { fixtureText } from '../core/modelTestUtils';
import { activeViewType, fixtureUri, repoRoot, sleep } from './testUtils';

/** Every file under `dir`, with the size and mtime a write would change. */
function snapshot(dir: string): string[] {
	const entries: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			entries.push(...snapshot(path.join(dir, entry.name)).map((line) => `${entry.name}/${line}`));
		} else {
			const stat = fs.statSync(path.join(dir, entry.name));
			entries.push(`${entry.name} ${stat.size} ${stat.mtimeMs}`);
		}
	}
	return entries.sort();
}

suite('editor activation (AC2, AC3, AC9)', () => {
	test('AC2: the gate explains a non-ECUC arxml and a non-arxml file', () => {
		const ecuc = fixtureText('basic.arxml');
		assert.strictEqual(gateReason(ecuc, 'basic.arxml'), undefined, 'an ECUC file is accepted');

		const noEcuc = gateReason(fixtureText('not-ecuc.arxml'), 'not-ecuc.arxml');
		assert.ok(noEcuc, 'a non-ECUC arxml is refused');
		assert.ok(noEcuc!.includes('ECUC'), noEcuc!);

		const notArxml = gateReason(ecuc, 'notes.txt');
		assert.ok(notArxml, 'a non-arxml path is refused even with ECUC content');
		assert.ok(notArxml!.includes('.arxml'), notArxml!);
	});

	test('AC2: a non-ECUC arxml never renders an empty view and falls back to the text editor', async () => {
		const uri = fixtureUri('not-ecuc.arxml');
		await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
		await sleep(600);

		assert.strictEqual(activeViewType(), undefined, 'no custom editor may stay open');
		assert.ok(vscode.window.activeTextEditor, 'the text editor must be active');
		assert.strictEqual(vscode.window.activeTextEditor!.document.uri.toString(), uri.toString());
	});

	test('AC3: a normally opened arxml still uses the text editor', async () => {
		const uri = fixtureUri('basic.arxml');
		// `vscode.open` is the normal open path — the one an Explorer click or
		// `File: Open File` takes — so it runs editor resolution, which is exactly what
		// `priority` controls. `showTextDocument` would force the text editor and could
		// not fail even with a `default` priority, so it would prove nothing here.
		await vscode.commands.executeCommand('vscode.open', uri);
		await sleep(600);

		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		assert.ok(input instanceof vscode.TabInputText, 'the plain text editor must be used');
		assert.strictEqual(activeViewType(), undefined, 'the custom editor must not claim the file');
		assert.ok(vscode.window.activeTextEditor, 'the text editor must be active');
		assert.strictEqual(vscode.window.activeTextEditor!.document.uri.toString(), uri.toString());
	});

	test('AC3: the manifest never claims .arxml by default', () => {
		const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
		const entry = manifest.contributes.customEditors.find(
			(candidate: { viewType: string }) => candidate.viewType === VIEW_TYPE
		);
		assert.ok(entry, 'the editor is contributed');
		assert.deepStrictEqual(entry.selector, [{ filenamePattern: '*.arxml' }]);
		assert.strictEqual(entry.priority, 'option', 'a default priority would take over .arxml');
		assert.deepStrictEqual(manifest.activationEvents, [], 'no activation event claims .arxml');
		assert.strictEqual(
			manifest.contributes.configuration.properties['workbench.editorAssociations'],
			undefined,
			'no default editor association is set'
		);
	});

	test('AC3: the explicit command opens the custom editor', async () => {
		const uri = fixtureUri('basic.arxml');
		await vscode.commands.executeCommand('vscode-arxml-scope.openEcucEditor', uri);
		await sleep(600);
		assert.strictEqual(activeViewType(), VIEW_TYPE);
	});

	test('AC9: activation, rendering and navigation create no file', async () => {
		const dir = path.join(repoRoot, 'src', 'test', 'fixtures', 'editor');
		const before = snapshot(dir);
		const uri = fixtureUri('editor/navigation.arxml');

		await vscode.commands.executeCommand('vscode-arxml-scope.openEcucEditor', uri);
		await sleep(500);

		const document = await vscode.workspace.openTextDocument(uri);
		const model = scanEcucValues(document.getText());
		const index = buildNodeIndex(model);
		const parameter = model.modules[0].containers[0].parameters[0];
		await vscode.commands.executeCommand('vscode-arxml-scope.revealInSource', uri, index.idOf(parameter));
		await sleep(200);

		const editor = await vscode.window.showTextDocument(document);
		const at = document.positionAt(parameter.valueRange!.start + 1);
		editor.selection = new vscode.Selection(at, at);
		await vscode.commands.executeCommand('vscode-arxml-scope.revealInEcucEditor', uri);
		await sleep(500);

		assert.deepStrictEqual(snapshot(dir), before, 'nothing was created, modified or deleted');
		assert.strictEqual(fs.existsSync(path.join(dir, '.artext_cache')), false);
	});
});
