/**
 * The workspace index at the extension boundary: discovery, status bar text,
 * a watcher-driven update and removal.
 *
 * The test workspace is the disposable temp folder `vscode-test` opens, so the
 * files written here never touch the repository.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { ArxmlScopeApi } from '../../extension';
import { fixtureText } from '../core/modelTestUtils';
import { sleep } from './testUtils';

function workspaceDir(): string {
	const folder = vscode.workspace.workspaceFolders?.[0];
	assert.ok(folder, 'the test host has a workspace folder');
	return folder!.uri.fsPath;
}

async function api(): Promise<ArxmlScopeApi> {
	const extension = vscode.extensions.getExtension('deviousprophet.vscode-arxml-scope');
	assert.ok(extension, 'the extension is installed in the test host');
	return (await extension!.activate()) as ArxmlScopeApi;
}

async function waitFor(what: string, predicate: () => boolean, timeoutMs = 8000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) {
			return;
		}
		await sleep(50);
	}
	assert.fail(`timed out waiting for ${what}`);
}

suite('workspace index (extension)', function () {
	this.timeout(20000);

	const dir = path.join(workspaceDir(), 'index-test');
	const values = path.join(dir, 'values.arxml');
	const moduleDef = path.join(dir, 'module-def.arxml');
	const extra = path.join(dir, 'extra.arxml');

	suiteSetup(async () => {
		await api();
	});

	setup(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.mkdirSync(dir, { recursive: true });
	});

	teardown(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('indexes the workspace and shows the file count in the status bar', async () => {
		fs.writeFileSync(values, fixtureText('index/values.arxml'));
		fs.writeFileSync(moduleDef, fixtureText('index/module-def.arxml'));
		const extension = await api();
		await extension.reindex();

		const stats = extension.indexStats();
		assert.strictEqual(stats.files, 2);
		assert.strictEqual(stats.elements, 6);
		assert.strictEqual(stats.definitions, 11);
		assert.ok(extension.statusBarText().includes('2 files indexed'), extension.statusBarText());
	});

	test('a created file is picked up by the watcher and a deleted one is dropped', async () => {
		fs.writeFileSync(values, fixtureText('index/values.arxml'));
		const extension = await api();
		await extension.reindex();
		assert.strictEqual(extension.indexStats().files, 1);

		fs.writeFileSync(
			extra,
			'<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>Extra</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>ExtraModule</SHORT-NAME></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>'
		);
		await waitFor('the created file to be indexed', () => extension.indexStats().files === 2);
		assert.ok(extension.statusBarText().includes('2 files indexed'), extension.statusBarText());

		fs.rmSync(extra);
		await waitFor('the deleted file to be dropped', () => extension.indexStats().files === 1);
		assert.ok(extension.statusBarText().includes('1 file indexed'), extension.statusBarText());
	});

	test('an edited file updates its entries without dropping another file', async () => {
		fs.writeFileSync(moduleDef, fixtureText('index/module-def.arxml'));
		const original = fixtureText('index/values.arxml');
		fs.writeFileSync(values, original);
		const extension = await api();
		await extension.reindex();
		assert.strictEqual(extension.indexStats().elements, 6);

		const extended = original.replace(
			'<SUB-CONTAINERS>',
			`<PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Synthetic/SampleModuleDef/Main/Added</DEFINITION-REF><VALUE>1</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES><SUB-CONTAINERS>`
		);
		assert.notStrictEqual(extended, original, 'the fixture contains the insertion anchor');
		fs.writeFileSync(values, extended);

		await waitFor('the edited file to be reindexed', () => extension.indexStats().elements === 7);
		assert.strictEqual(extension.indexStats().definitions, 11, 'the other file survives the update');
	});

	test('the status bar hides when nothing is indexed', async () => {
		const extension = await api();
		await extension.reindex();
		assert.strictEqual(extension.indexStats().files, 0);
		assert.strictEqual(extension.statusBarText(), '');
	});
});
