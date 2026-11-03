/**
 * Validation at the extension boundary: the index change reaches the diagnostic
 * collection, the Problems-panel data carries the rule code, and disabling the
 * feature clears it.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { ArxmlScopeApi } from '../../extension';
import { fixtureText } from '../core/modelTestUtils';
import { sleep } from './testUtils';

const VALUES = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>Synthetic</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>SampleModule</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/Synthetic/SampleModuleDef</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>Main</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Synthetic/SampleModuleDef/Main</DEFINITION-REF><PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Synthetic/SampleModuleDef/Main/TimeoutSeconds</DEFINITION-REF><VALUE>70000</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;

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

suite('validation (extension)', function () {
	this.timeout(20000);

	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
	const values = path.join(root, 'validation-test-values.arxml');
	const definitions = path.join(root, 'validation-test-definitions.arxml');
	const valuesUri = vscode.Uri.file(values);

	suiteSetup(async () => {
		await api();
	});

	setup(() => {
		fs.writeFileSync(values, VALUES);
		fs.writeFileSync(definitions, fixtureText('index/module-def.arxml'));
	});

	teardown(() => {
		for (const file of [values, definitions]) {
			fs.rmSync(file, { force: true });
		}
	});

	test('an out-of-range value reaches the diagnostic collection', async () => {
		const extension = await api();
		await extension.reindex();
		await waitFor(
			'the valueOutOfRange diagnostic',
			() => vscode.languages.getDiagnostics(valuesUri).some((diagnostic) => diagnostic.code === 'valueOutOfRange')
		);
		const diagnostic = vscode.languages.getDiagnostics(valuesUri).find((item) => item.code === 'valueOutOfRange');
		assert.ok(diagnostic, 'the rule code is the diagnostic code');
		assert.strictEqual(diagnostic!.source, 'ARXML Scope');
	});

	test('disabling validation clears the collection', async () => {
		const extension = await api();
		const config = vscode.workspace.getConfiguration('arxmlScope.validation');
		await config.update('enabled', false, vscode.ConfigurationTarget.Workspace);
		await waitFor('the cleared diagnostics', () => vscode.languages.getDiagnostics(valuesUri).length === 0);
		await config.update('enabled', undefined, vscode.ConfigurationTarget.Workspace);
		await extension.reindex();
		await waitFor(
			'the restored valueOutOfRange diagnostic',
			() => vscode.languages.getDiagnostics(valuesUri).some((diagnostic) => diagnostic.code === 'valueOutOfRange')
		);
	});
});
