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

	// Keep the fixture files at the workspace root: the VS Code node.js watcher
	// does not reliably follow a subdirectory created after the watcher starts on
	// Linux, and the product's `**/*.arxml` watcher is what this suite exercises.
	const root = workspaceDir();
	let values = '';
	let moduleDef = '';
	let extra = '';
	let run = 0;

	function removeFixtures(): void {
		for (const file of [values, moduleDef, extra]) {
			if (file !== '') {
				fs.rmSync(file, { force: true });
			}
		}
		for (let index = 0; index <= run; index++) {
			fs.rmSync(path.join(root, `index-test-${index}-excluded`), { recursive: true, force: true });
		}
	}

	suiteSetup(async () => {
		await api();
	});

	setup(() => {
		removeFixtures();
		run++;
		values = path.join(root, `index-test-${run}-values.arxml`);
		moduleDef = path.join(root, `index-test-${run}-module-def.arxml`);
		extra = path.join(root, `index-test-${run}-extra.arxml`);
	});

	teardown(() => {
		removeFixtures();
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

	test('arxmlScope.index.exclude removes matching files', async () => {
		fs.writeFileSync(values, fixtureText('index/values.arxml'));
		const dir = path.join(root, `index-test-${run}-excluded`);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'generated.arxml'), fixtureText('index/module-def.arxml'));
		const extension = await api();
		const config = vscode.workspace.getConfiguration('arxmlScope.index');
		await config.update('exclude', [`**/index-test-${run}-excluded/**`], vscode.ConfigurationTarget.Workspace);
		try {
			await extension.reindex();
			assert.strictEqual(extension.indexStats().files, 1, 'the excluded copy is not indexed');
		} finally {
			await config.update('exclude', undefined, vscode.ConfigurationTarget.Workspace);
		}
		await extension.reindex();
		assert.strictEqual(extension.indexStats().files, 2);
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

	test('indexes a UTF-16LE file with a BOM', async () => {
		const text = fixtureText('index/values.arxml');
		fs.writeFileSync(extra, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
		const extension = await api();
		await extension.reindex();
		assert.strictEqual(extension.indexStats().files, 1);
		assert.strictEqual(extension.indexStats().elements, 6);
	});

	test('skips a file with an unsupported encoding', async () => {
		const text = '<?xml version="1.0" encoding="UTF-32"?><AUTOSAR/>';
		fs.writeFileSync(extra, Buffer.from(text, 'utf8'));
		const extension = await api();
		await extension.reindex();
		assert.strictEqual(extension.indexStats().files, 0);
	});

	test('disabling the index hides the status bar and enabling it rebuilds', async () => {
		fs.writeFileSync(values, fixtureText('index/values.arxml'));
		const extension = await api();
		const config = vscode.workspace.getConfiguration('arxmlScope.index');
		await config.update('enabled', false, vscode.ConfigurationTarget.Workspace);
		await waitFor('the disabled index to clear', () => extension.indexStats().files === 0);
		assert.strictEqual(extension.statusBarText(), '');

		await config.update('enabled', true, vscode.ConfigurationTarget.Workspace);
		await waitFor('the enabled index to rebuild', () => extension.indexStats().files === 1);
		assert.ok(extension.statusBarText().includes('1 file indexed'), extension.statusBarText());
		await config.update('enabled', undefined, vscode.ConfigurationTarget.Workspace);
	});

	test('the status bar hides when nothing is indexed', async () => {
		const extension = await api();
		await extension.reindex();
		assert.strictEqual(extension.indexStats().files, 0);
		assert.strictEqual(extension.statusBarText(), '');
	});
});
