/**
 * Text-editor providers at the extension boundary. The test drives the same
 * `vscode.execute*Provider` commands a user action invokes.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { ArxmlScopeApi } from '../../extension';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { fixtureText } from '../core/modelTestUtils';

async function api(): Promise<ArxmlScopeApi> {
	const extension = vscode.extensions.getExtension('deviousprophet.vscode-arxml-scope');
	assert.ok(extension, 'the extension is installed in the test host');
	return (await extension!.activate()) as ArxmlScopeApi;
}

suite('text features (extension)', function () {
	this.timeout(20000);

	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
	const values = path.join(root, 'text-features-values.arxml');
	const definitions = path.join(root, 'text-features-definitions.arxml');
	const valuesUri = vscode.Uri.file(values);

	suiteSetup(async () => {
		fs.writeFileSync(values, fixtureText('index/values.arxml'));
		fs.writeFileSync(definitions, fixtureText('index/module-def.arxml'));
		const extension = await api();
		await extension.reindex();
	});

	suiteTeardown(() => {
		for (const file of [values, definitions]) {
			fs.rmSync(file, { force: true });
		}
	});

	test('document symbols expose the module and its containers', async () => {
		const symbols = (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
			'vscode.executeDocumentSymbolProvider',
			valuesUri
		)) ?? [];
		assert.ok(symbols.length > 0);
		assert.strictEqual(symbols[0].name, 'SampleModule');
		assert.ok(symbols[0].children.length > 0);
	});

	test('definition resolves a parameter definition across files', async () => {
		const document = await vscode.workspace.openTextDocument(valuesUri);
		const model = scanEcucValues(document.getText());
		const parameter = model.modules[0].containers[0].parameters[0];
		assert.ok(parameter.definitionRefRange);
		const position = document.positionAt(parameter.definitionRefRange!.start);
		const locations = (await vscode.commands.executeCommand<vscode.Location[]>(
			'vscode.executeDefinitionProvider',
			valuesUri,
			position
		)) ?? [];
		assert.ok(locations.some((location) => location.uri.toString() === vscode.Uri.file(definitions).toString()));
	});

	test('hover explains a definition ref', async () => {
		const document = await vscode.workspace.openTextDocument(valuesUri);
		const model = scanEcucValues(document.getText());
		const parameter = model.modules[0].containers[0].parameters[0];
		const position = document.positionAt(parameter.definitionRefRange!.start);
		const hovers = (await vscode.commands.executeCommand<vscode.Hover[]>(
			'vscode.executeHoverProvider',
			valuesUri,
			position
		)) ?? [];
		assert.ok(hovers.length > 0);
	});

	test('document links cover reference values', async () => {
		const links = (await vscode.commands.executeCommand<vscode.DocumentLink[]>(
			'vscode.executeLinkProvider',
			valuesUri
		)) ?? [];
		assert.ok(links.length > 0);
	});

	test('find references on a container short name lists the reference value', async () => {
		const document = await vscode.workspace.openTextDocument(valuesUri);
		const model = scanEcucValues(document.getText());
		const main = model.modules[0].containers[0];
		const sub = main.containers[0];
		assert.ok(sub?.shortNameRange);
		const position = document.positionAt(sub!.shortNameRange!.start);
		const locations = (await vscode.commands.executeCommand<vscode.Location[]>(
			'vscode.executeReferenceProvider',
			valuesUri,
			position
		)) ?? [];
		assert.ok(locations.some((location) => location.uri.toString() === valuesUri.toString()));
	});

	test('a non-ARXML document gets no symbols from this provider', async () => {
		const file = path.join(root, 'text-features-note.txt');
		fs.writeFileSync(file, 'not arxml');
		const uri = vscode.Uri.file(file);
		try {
			const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
				'vscode.executeDocumentSymbolProvider',
				uri
			);
			assert.ok(symbols === undefined || symbols.length === 0);
		} finally {
			fs.rmSync(file, { force: true });
		}
	});
});
