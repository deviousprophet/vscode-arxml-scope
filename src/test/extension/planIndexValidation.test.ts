/**
 * Plan rows INDEX-01…06 and VALID-01…04 at the extension boundary.
 *
 * The index rows drive the real `IndexService` against files in the disposable
 * test workspace (the temp folder `vscode-test` opens), never a committed
 * fixture. The validation rows drive the real `ValidationService` over an
 * `IndexService` whose injected reader returns synthesized `FileIndex` values,
 * so they write nothing and the product's own workspace index cannot contribute
 * diagnostics for their URIs.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { buildFileIndex } from '../../core/index/indexBuilder';
import type { FileIndex, IndexReference } from '../../core/index/indexModel';
import { WorkspaceIndex } from '../../core/index/workspaceIndex';
import { IndexService } from '../../host/indexService';
import { ValidationService } from '../../host/validationService';
import { fixtureText } from '../core/modelTestUtils';
import { sleep } from './testUtils';

const INDEXING = 'indexing';

function workspaceRoot(): string {
	const folder = vscode.workspace.workspaceFolders?.[0];
	assert.ok(folder, 'the test host has a workspace folder');
	return folder!.uri.fsPath;
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

function indexConfig(): vscode.WorkspaceConfiguration {
	return vscode.workspace.getConfiguration('arxmlScope.index');
}

function validationConfig(): vscode.WorkspaceConfiguration {
	return vscode.workspace.getConfiguration('arxmlScope.validation');
}

/** A disposable directory inside the test workspace, removed by the test. */
function tempDir(label: string): string {
	return fs.mkdtempSync(path.join(workspaceRoot(), `plan-${label}-`));
}

/** A minimal module; `body` is inserted before `</ECUC-MODULE-CONFIGURATION-VALUES>`. */
function moduleXml(packageName: string, moduleName: string, body = ''): string {
	return `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>${packageName}</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>${moduleName}</SHORT-NAME>${body}</ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
}

/** The target container shared by the INDEX-05 files. */
function targetXml(value: string, padding = ''): string {
	return moduleXml(
		'Plan',
		'Target',
		`<CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Plan/Target/C/N</DEFINITION-REF><VALUE>${value}</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS>`
	).replace('<AR-PACKAGES>', `${padding}<AR-PACKAGES>`);
}

/** A values file for the committed module-def fixture, with `count` out-of-range values. */
function valuesXml(count = 1): string {
	const parameters = Array.from(
		{ length: count },
		(_, index) =>
			`<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Synthetic/SampleModuleDef/Main/TimeoutSeconds</DEFINITION-REF><VALUE>${70000 + index}</VALUE></ECUC-NUMERICAL-PARAM-VALUE>`
	).join('');
	return `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>Synthetic</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>SampleModule</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/Synthetic/SampleModuleDef</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>Main</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Synthetic/SampleModuleDef/Main</DEFINITION-REF><PARAMETER-VALUES>${parameters}</PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
}

/** One module with a missing definition tree, used by VALID-03. */
function missingDefinitionsXml(): string {
	return moduleXml(
		'Plan',
		'MissingModule',
		`<DEFINITION-REF DEST="ECUC-MODULE-DEF">/Plan/MissingModuleDef</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>Main</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Plan/MissingModuleDef/Main</DEFINITION-REF><PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Plan/MissingModuleDef/Main/Param</DEFINITION-REF><VALUE>1</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS>`
	);
}

/** One container declaration repeated in two files by VALID-04. */
const DUPLICATE_XML = moduleXml(
	'Plan',
	'Dup',
	'<CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME></ECUC-CONTAINER-VALUE></CONTAINERS>'
);

function referencePositions(references: readonly IndexReference[]): string[] {
	return references.map((reference) => `${reference.file}@${reference.range.start}-${reference.range.end}`);
}

/**
 * The skipped-file report is published only on the status item's tooltip and VS
 * Code exposes no status-bar accessor, so read the item the service owns.
 */
function statusTooltip(service: IndexService): string {
	const item = (service as unknown as { status?: vscode.StatusBarItem }).status;
	return typeof item?.tooltip === 'string' ? item.tooltip : '';
}

/** An IndexService whose reader serves synthesized files; nothing touches disk. */
interface VirtualIndex {
	service: IndexService;
	add(name: string, text: string): Promise<vscode.Uri>;
}

function virtualIndex(): VirtualIndex {
	const folder = vscode.workspace.workspaceFolders?.[0];
	assert.ok(folder, 'the test host has a workspace folder');
	const texts = new Map<string, string>();
	const service = new IndexService(async (uri) => {
		const text = texts.get(uri.toString());
		return text === undefined ? undefined : buildFileIndex(uri.toString(), text);
	});
	return {
		service,
		add: async (name, text) => {
			const uri = vscode.Uri.joinPath(folder!.uri, name);
			texts.set(uri.toString(), text);
			await service.reindexFile(uri);
			return uri;
		},
	};
}

suite('plan index and validation rows (extension)', function () {
	this.timeout(30000);

	test('INDEX-01 a rename in one watch burst leaves one contribution and no duplicate path', async () => {
		const dir = tempDir('index-rename');
		const before = path.join(dir, 'before.arxml');
		const after = path.join(dir, 'after.arxml');
		const beforeUri = vscode.Uri.file(before);
		const afterUri = vscode.Uri.file(after);
		fs.writeFileSync(before, moduleXml('Plan', 'Renamed'));
		const service = new IndexService();
		try {
			service.start();
			await waitFor('the initial index', () => service.workspaceIndex.file(beforeUri.toString()) !== undefined);
			fs.renameSync(before, after);
			await waitFor('the renamed file', () => service.workspaceIndex.file(afterUri.toString()) !== undefined);
			await waitFor('the old path to be dropped', () => service.workspaceIndex.file(beforeUri.toString()) === undefined);

			const resolution = service.workspaceIndex.resolveTarget('/Plan/Renamed');
			assert.ok(resolution.ok, 'the renamed path resolves');
			assert.strictEqual(resolution.copies.length, 1, 'one contribution, no duplicate copy');
			assert.strictEqual(resolution.element.file, afterUri.toString());
		} finally {
			service.dispose();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('INDEX-02 an excluded file is picked up on rebuild only after the exclude is removed', async () => {
		const dir = tempDir('index-exclude');
		const excludedDir = path.join(dir, 'excluded');
		fs.mkdirSync(excludedDir);
		const file = path.join(excludedDir, 'generated.arxml');
		const fileUri = vscode.Uri.file(file);
		fs.writeFileSync(file, moduleXml('Plan', 'Excluded'));
		const service = new IndexService();
		try {
			await indexConfig().update(
				'exclude',
				['**/plan-index-exclude-*/excluded/**'],
				vscode.ConfigurationTarget.Workspace
			);
			service.start();
			await waitFor('the initial excluded rebuild', () => !service.statusText().includes(INDEXING));

			fs.writeFileSync(file, moduleXml('Plan', 'Excluded'));
			await sleep(600);
			assert.strictEqual(
				service.workspaceIndex.file(fileUri.toString()),
				undefined,
				'an excluded file is not picked up by the watcher'
			);

			await indexConfig().update('exclude', undefined, vscode.ConfigurationTarget.Workspace);
			await waitFor('the unexcluded rebuild', () => service.workspaceIndex.file(fileUri.toString()) !== undefined);
		} finally {
			service.dispose();
			await indexConfig().update('exclude', undefined, vscode.ConfigurationTarget.Workspace);
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('INDEX-03 two saves inside the debounce window cause one reindex', async () => {
		const dir = tempDir('index-debounce');
		const file = path.join(dir, 'saved.arxml');
		const fileUri = vscode.Uri.file(file);
		const key = fileUri.toString();
		fs.writeFileSync(file, moduleXml('Plan', 'SavedOne'));
		let reads = 0;
		const service = new IndexService(async (uri) => {
			const text = fs.readFileSync(uri.fsPath, 'utf8');
			if (uri.toString() === key) {
				reads++;
			}
			return buildFileIndex(uri.toString(), text);
		});
		try {
			service.start();
			await waitFor('the initial index', () => service.workspaceIndex.element('/Plan/SavedOne') !== undefined);
			await waitFor('the initial build to settle', () => !service.statusText().includes(INDEXING));

			reads = 0;
			fs.writeFileSync(file, moduleXml('Plan', 'SavedOne'));
			fs.writeFileSync(file, moduleXml('Plan', 'SavedTwo'));
			await waitFor('the debounced reindex', () => service.workspaceIndex.element('/Plan/SavedTwo') !== undefined);
			await sleep(600);

			assert.strictEqual(reads, 1, 'two saves in one burst are read once');
			assert.strictEqual(service.workspaceIndex.element('/Plan/SavedOne'), undefined);
		} finally {
			service.dispose();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('INDEX-04 disabling and re-enabling during a build does not serve the stale read', async () => {
		const dir = tempDir('index-toggle');
		const file = path.join(dir, 'race.arxml');
		const fileUri = vscode.Uri.file(file);
		fs.writeFileSync(file, moduleXml('Plan', 'Old'));
		let release: (() => void) | undefined;
		let blockNext = true;
		const service = new IndexService(async (uri) => {
			const text = fs.readFileSync(uri.fsPath, 'utf8');
			if (blockNext) {
				blockNext = false;
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			}
			return buildFileIndex(uri.toString(), text);
		});
		try {
			service.start();
			await waitFor('the blocked read', () => release !== undefined);

			await indexConfig().update('enabled', false, vscode.ConfigurationTarget.Workspace);
			await waitFor('the disabled index to clear', () => service.workspaceIndex.size === 0);
			fs.writeFileSync(file, moduleXml('Plan', 'New'));
			await indexConfig().update('enabled', true, vscode.ConfigurationTarget.Workspace);

			release!();
			await waitFor('the fresh rebuild', () => service.workspaceIndex.element('/Plan/New') !== undefined);
			assert.strictEqual(service.workspaceIndex.element('/Plan/Old'), undefined, 'the stale read is not served');
			await sleep(300);
			assert.strictEqual(service.workspaceIndex.element('/Plan/Old'), undefined, 'the fresh generation remains');
			assert.strictEqual(service.workspaceIndex.file(fileUri.toString())?.elements.length, 1);
		} finally {
			service.dispose();
			await indexConfig().update('enabled', undefined, vscode.ConfigurationTarget.Workspace);
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('INDEX-05 the reference map after 50 target edits equals a fresh build', async () => {
		const dir = tempDir('index-refs');
		const holder = path.join(dir, 'holder.arxml');
		const target = path.join(dir, 'target.arxml');
		const holderUri = vscode.Uri.file(holder);
		const targetUri = vscode.Uri.file(target);
		fs.writeFileSync(
			holder,
			moduleXml(
				'Plan',
				'Holder',
				'<CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>H</SHORT-NAME><REFERENCE-VALUES><ECUC-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/Plan/Holder/Def/Ref</DEFINITION-REF><VALUE-REF DEST="ECUC-CONTAINER-VALUE">/Plan/Target/C</VALUE-REF></ECUC-REFERENCE-VALUE></REFERENCE-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS>'
			)
		);
		fs.writeFileSync(target, targetXml('0'));
		const service = new IndexService();
		try {
			await service.reindexFile(holderUri);
			await service.reindexFile(targetUri);
			const first = service.workspaceIndex.element('/Plan/Target/C');
			assert.ok(first, 'the target resolves');
			assert.strictEqual(service.workspaceIndex.referencesFor(first!).length, 1, 'the holder reference resolves');

			for (let edit = 0; edit < 50; edit++) {
				fs.writeFileSync(target, targetXml(String(edit), '\n'.repeat(edit % 5)));
				await service.reindexFile(targetUri);
			}

			const incrementalTarget = service.workspaceIndex.element('/Plan/Target/C');
			assert.ok(incrementalTarget, 'the edited target resolves');
			const incremental = referencePositions(service.workspaceIndex.referencesFor(incrementalTarget!));

			const fresh = new WorkspaceIndex();
			fresh.upsert(buildFileIndex(holderUri.toString(), fs.readFileSync(holder, 'utf8')));
			fresh.upsert(buildFileIndex(targetUri.toString(), fs.readFileSync(target, 'utf8')));
			const freshTarget = fresh.element('/Plan/Target/C');
			assert.ok(freshTarget, 'the fresh target resolves');
			const rebuilt = referencePositions(fresh.referencesFor(freshTarget!));

			assert.strictEqual(incremental.length, 1, 'the reference survives every edit');
			assert.deepStrictEqual(incremental, rebuilt, 'the incremental map equals a fresh build');
		} finally {
			service.dispose();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('INDEX-06 a file over maxFileSizeMB is skipped and reported, never partially indexed', async () => {
		const dir = tempDir('index-size');
		const small = path.join(dir, 'small.arxml');
		const big = path.join(dir, 'big.arxml');
		const bigUri = vscode.Uri.file(big);
		fs.writeFileSync(small, moduleXml('Plan', 'Small'));
		const service = new IndexService();
		try {
			await indexConfig().update('maxFileSizeMB', 1, vscode.ConfigurationTarget.Workspace);
			await service.rebuild();
			const baseline = service.stats();

			const padding = ' '.repeat(1024 * 1024 + 64);
			fs.writeFileSync(
				big,
				`<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>Plan</SHORT-NAME><ELEMENTS>${padding}<ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>Big</SHORT-NAME></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`
			);
			await service.rebuild();

			assert.strictEqual(service.workspaceIndex.file(bigUri.toString()), undefined, 'the oversized file has no contribution');
			assert.strictEqual(service.workspaceIndex.element('/Plan/Big'), undefined, 'nothing from it is indexed');
			assert.strictEqual(service.stats().elements, baseline.elements, 'no partial elements are served');
			assert.strictEqual(service.stats().files, baseline.files, 'the skipped file is not counted');
			const tooltip = statusTooltip(service);
			assert.ok(tooltip.includes('Skipped:'), tooltip);
			assert.ok(tooltip.includes('big.arxml'), tooltip);
		} finally {
			service.dispose();
			await indexConfig().update('maxFileSizeMB', undefined, vscode.ConfigurationTarget.Workspace);
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('VALID-01 a severity change republishes diagnostics without a reindex', async () => {
		const index = virtualIndex();
		await index.add('plan-validation-definitions.arxml', fixtureText('index/module-def.arxml'));
		const valuesUri = await index.add('plan-validation-severity.arxml', valuesXml());
		const validation = new ValidationService(index.service);
		try {
			const severity = (): vscode.DiagnosticSeverity | undefined =>
				vscode.languages.getDiagnostics(valuesUri).find((item) => item.code === 'valueOutOfRange')?.severity;
			await waitFor('the warning', () => severity() === vscode.DiagnosticSeverity.Warning);
			const revision = index.service.workspaceIndex.revision;

			await validationConfig().update(
				'severities',
				{ valueOutOfRange: 'error' },
				vscode.ConfigurationTarget.Workspace
			);
			await waitFor('the republished error', () => severity() === vscode.DiagnosticSeverity.Error);

			assert.strictEqual(index.service.workspaceIndex.revision, revision, 'no reindex accompanied the change');
			assert.strictEqual(
				vscode.languages.getDiagnostics(valuesUri).filter((item) => item.code === 'valueOutOfRange').length,
				1
			);
		} finally {
			validation.dispose();
			index.service.dispose();
			await validationConfig().update('severities', undefined, vscode.ConfigurationTarget.Workspace);
		}
	});

	test('VALID-02 cap 0 keeps every diagnostic and publishes no summary', async () => {
		const index = virtualIndex();
		await index.add('plan-validation-cap-definitions.arxml', fixtureText('index/module-def.arxml'));
		const valuesUri = await index.add('plan-validation-cap.arxml', valuesXml(510));
		let validation: ValidationService | undefined;
		try {
			await validationConfig().update('maxDiagnosticsPerFile', 0, vscode.ConfigurationTarget.Workspace);
			await validationConfig().update('maxDiagnostics', 0, vscode.ConfigurationTarget.Workspace);
			validation = new ValidationService(index.service);

			const problems = (): vscode.Diagnostic[] => vscode.languages.getDiagnostics(valuesUri);
			await waitFor('all out-of-range diagnostics', () => problems().filter((item) => item.code === 'valueOutOfRange').length === 510);
			assert.strictEqual(problems().filter((item) => item.code === 'diagnosticCap').length, 0);
		} finally {
			validation?.dispose();
			index.service.dispose();
			await validationConfig().update('maxDiagnosticsPerFile', undefined, vscode.ConfigurationTarget.Workspace);
			await validationConfig().update('maxDiagnostics', undefined, vscode.ConfigurationTarget.Workspace);
		}
	});

	test('VALID-03 a missing module definition is one diagnostic with its children counted', async () => {
		const index = virtualIndex();
		const valuesUri = await index.add('plan-validation-missing.arxml', missingDefinitionsXml());
		const validation = new ValidationService(index.service);
		try {
			const missing = (): vscode.Diagnostic[] =>
				vscode.languages.getDiagnostics(valuesUri).filter((item) => item.code === 'missingDefinition');
			await waitFor('the grouped module diagnostic', () => missing().length === 1);
			assert.ok(missing()[0].message.includes('/Plan/MissingModuleDef'), missing()[0].message);
			assert.ok(missing()[0].message.includes('3 instances'), missing()[0].message);
		} finally {
			validation.dispose();
			index.service.dispose();
		}
	});

	test('VALID-04 a cross-file duplicate is not reported when one file is excluded', async () => {
		const index = virtualIndex();
		const firstUri = await index.add('plan-validation-dup-a.arxml', DUPLICATE_XML);
		const secondUri = await index.add('plan-validation-dup-b.arxml', DUPLICATE_XML);
		const duplicates = (uri: vscode.Uri): vscode.Diagnostic[] =>
			vscode.languages.getDiagnostics(uri).filter((item) => item.code === 'duplicateShortName');
		let validation: ValidationService | undefined;
		try {
			await validationConfig().update('crossFileRules', 'always', vscode.ConfigurationTarget.Workspace);
			validation = new ValidationService(index.service);
			await waitFor('the cross-file duplicate', () => duplicates(firstUri).length > 0);

			await indexConfig().update('exclude', ['**/plan-validation-dup-b.arxml'], vscode.ConfigurationTarget.Workspace);
			await index.service.reindexFile(secondUri);
			assert.strictEqual(index.service.workspaceIndex.file(secondUri.toString()), undefined);

			await waitFor('the duplicate to disappear', () => duplicates(firstUri).length === 0);
			assert.strictEqual(duplicates(secondUri).length, 0);
		} finally {
			validation?.dispose();
			index.service.dispose();
			await indexConfig().update('exclude', undefined, vscode.ConfigurationTarget.Workspace);
			await validationConfig().update('crossFileRules', undefined, vscode.ConfigurationTarget.Workspace);
		}
	});
});
