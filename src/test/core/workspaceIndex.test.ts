import * as assert from 'assert';

import { buildFileIndex } from '../../core/index/indexBuilder';
import { WorkspaceIndex } from '../../core/index/workspaceIndex';
import { fixtureText } from './modelTestUtils';

function values(uri: string): ReturnType<typeof buildFileIndex> {
	return buildFileIndex(uri, fixtureText('index/values.arxml'));
}

function definitions(uri: string): ReturnType<typeof buildFileIndex> {
	return buildFileIndex(uri, fixtureText('index/module-def.arxml'));
}

const MODULE = (uri: string, moduleName: string): ReturnType<typeof buildFileIndex> =>
	buildFileIndex(
		uri,
		`<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>${moduleName}</SHORT-NAME><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`
	);

suite('workspaceIndex (core)', () => {
	test('aggregates stats across files', () => {
		const index = new WorkspaceIndex();
		index.upsert(values('file:///values.arxml'));
		index.upsert(definitions('file:///module-def.arxml'));
		assert.deepStrictEqual(index.stats(), {
			files: 2,
			elements: 6,
			references: 1,
			definitions: 11,
			packages: 1,
		});
	});

	test('resolves an exact path and a unique suffix', () => {
		const index = new WorkspaceIndex();
		index.upsert(values('file:///values.arxml'));
		assert.strictEqual(index.element('/Synthetic/SampleModule/Main')?.shortName, 'Main');
		assert.strictEqual(index.element('/SampleModule/Main')?.shortName, 'Main');
		assert.strictEqual(index.element('/Main')?.shortName, 'Main');
		assert.strictEqual(index.element('/NotThere'), undefined);
	});

	test('refuses an ambiguous suffix', () => {
		const index = new WorkspaceIndex();
		index.upsert(MODULE('file:///a.arxml', 'A'));
		index.upsert(MODULE('file:///b.arxml', 'B'));
		// Both files contribute `/P/A/C` and `/P/B/C`; `/C` therefore matches two.
		assert.strictEqual(index.element('/C'), undefined);
		assert.strictEqual(index.element('/P/A/C')?.shortName, 'C');
		assert.strictEqual(index.element('/P/B/C')?.shortName, 'C');
	});

	test('a duplicate exact AR path across files is ambiguous', () => {
		const index = new WorkspaceIndex();
		index.upsert(MODULE('file:///a.arxml', 'M'));
		index.upsert(MODULE('file:///b.arxml', 'M'));
		assert.strictEqual(index.element('/P/M/C'), undefined);
	});

	test('upsert replaces only one file and remove deletes only that file', () => {
		const index = new WorkspaceIndex();
		index.upsert(values('file:///values.arxml'));
		index.upsert(definitions('file:///module-def.arxml'));
		assert.strictEqual(index.size, 2);

		index.upsert(MODULE('file:///extra.arxml', 'Extra'));
		assert.strictEqual(index.size, 3);
		assert.deepStrictEqual(index.stats().elements, 8);
		assert.strictEqual(index.element('/P/Extra/C')?.shortName, 'C');

		assert.strictEqual(index.remove('file:///extra.arxml'), true);
		assert.strictEqual(index.remove('file:///extra.arxml'), false);
		assert.strictEqual(index.element('/P/Extra/C'), undefined);
		assert.strictEqual(index.element('/Synthetic/SampleModule')?.shortName, 'SampleModule', 'other files survive');
	});

	test('replaceAll swaps the whole set in one change', () => {
		const index = new WorkspaceIndex();
		index.upsert(values('file:///values.arxml'));
		index.replaceAll([definitions('file:///module-def.arxml')]);
		assert.deepStrictEqual(index.stats().files, 1);
		assert.strictEqual(index.element('/Synthetic/SampleModule'), undefined);
		assert.strictEqual(index.stats().definitions, 11);
	});

	test('resolves definitions by exact path and suffix', () => {
		const index = new WorkspaceIndex();
		index.upsert(definitions('file:///module-def.arxml'));
		const exact = index.definitionEntry('/Synthetic/SampleModuleDef/Main/TimeoutSeconds');
		assert.strictEqual(exact?.kind, 'ECUC-INTEGER-PARAM-DEF');
		assert.strictEqual(index.definitionEntry('/SampleModuleDef/Main/TimeoutSeconds')?.kind, 'ECUC-INTEGER-PARAM-DEF');
		assert.strictEqual(index.definitionEntry('/Nope'), undefined);
	});

	test('reports the files behind a split package', () => {
		const index = new WorkspaceIndex();
		index.upsert(values('file:///values.arxml'));
		index.upsert(definitions('file:///module-def.arxml'));
		const sources = index.packageSources();
		assert.deepStrictEqual(sources.get('/Synthetic'), ['file:///values.arxml', 'file:///module-def.arxml']);
	});

	test('notifies subscribers on every mutation and disposes them', () => {
		const index = new WorkspaceIndex();
		let calls = 0;
		const subscription = index.onDidChange(() => {
			calls++;
		});
		index.upsert(values('file:///values.arxml'));
		index.upsert(values('file:///values.arxml'));
		index.remove('file:///values.arxml');
		assert.strictEqual(calls, 3);
		subscription.dispose();
		index.upsert(values('file:///values.arxml'));
		assert.strictEqual(calls, 3);
	});
});
