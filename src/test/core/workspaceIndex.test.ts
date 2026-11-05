import * as assert from 'assert';

import { buildFileIndex } from '../../core/index/indexBuilder';
import type { FileIndex, IndexDefinition, IndexElement } from '../../core/index/indexModel';
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

	test('referencesFor finds a same-file reference by element identity', () => {
		const file = buildFileIndex('file:///values.arxml', fixtureText('index/values.arxml'));
		const index = new WorkspaceIndex();
		index.upsert(file);
		const sub = file.elements.find((element) => element.path === '/Synthetic/SampleModule/Main/Sub');
		assert.ok(sub);
		assert.strictEqual(index.referencesFor(sub!).length, 1);
	});

	test('resolves a cross-file reference and lists the reverse references', () => {
		const values = buildFileIndex(
			'file:///values.arxml',
			'<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>'
		);
		const refs = buildFileIndex(
			'file:///refs.arxml',
			'<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>R</SHORT-NAME><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>Holder</SHORT-NAME><REFERENCE-VALUES><ECUC-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/P/R/Def/Ref</DEFINITION-REF><VALUE-REF DEST="ECUC-CONTAINER-VALUE">/P/M/C</VALUE-REF></ECUC-REFERENCE-VALUE></REFERENCE-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>'
		);
		const index = new WorkspaceIndex();
		index.upsert(values);
		index.upsert(refs);

		const resolution = index.resolveTarget('/P/M/C', 'ECUC-CONTAINER-VALUE');
		assert.strictEqual(resolution.ok, true);
		const target = resolution.ok ? resolution.element : undefined;
		assert.ok(target);
		assert.strictEqual(target!.file, 'file:///values.arxml');
		assert.strictEqual(index.resolveReference(refs.references[0]).ok, true);
		assert.strictEqual(index.referencesFor(target!).length, 1);
		assert.strictEqual(index.referencesFor(target!)[0].file, 'file:///refs.arxml');

		const mismatch = index.resolveTarget('/P/M/C', 'ECUC-MODULE-CONFIGURATION-VALUES');
		assert.strictEqual(mismatch.ok, false);
		if (!mismatch.ok) {
			assert.strictEqual(mismatch.reason, 'dest-mismatch');
		}
		const absent = index.resolveTarget('/P/M/Missing');
		assert.strictEqual(absent.ok, false);
		if (!absent.ok) {
			assert.strictEqual(absent.reason, 'absent');
		}

		index.upsert(
			buildFileIndex(
				'file:///duplicate.arxml',
				'<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>'
			)
		);
		const duplicated = index.resolveTarget('/P/M/C');
		assert.strictEqual(duplicated.ok, true);
		assert.strictEqual(duplicated.ok && duplicated.copies.length, 2);
		assert.deepStrictEqual(index.referencesFor(target!), []);
	});

	test('a local copy wins; same-identity local copies merge; different identities stay ambiguous', () => {
		const module = (uri: string, defRef: string, copies = 1): ReturnType<typeof buildFileIndex> => {
			const containers = Array.from({ length: copies }, () =>
				`<ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">${defRef}/C</DEFINITION-REF></ECUC-CONTAINER-VALUE>`
			).join('');
			return buildFileIndex(
				uri,
				`<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">${defRef}</DEFINITION-REF><CONTAINERS>${containers}</CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`
			);
		};
		const index = new WorkspaceIndex();
		index.upsert(module('file:///a.arxml', '/D/M'));
		index.upsert(module('file:///b.arxml', '/D/M'));

		const local = index.resolveTarget('/P/M/C', 'ECUC-CONTAINER-VALUE', 'file:///b.arxml');
		assert.strictEqual(local.ok, true);
		assert.strictEqual(local.ok && local.element.file, 'file:///b.arxml');
		assert.strictEqual(local.ok && local.copies.length, 2);

		const noLocal = index.resolveTarget('/P/M/C', 'ECUC-CONTAINER-VALUE', 'file:///c.arxml');
		assert.strictEqual(noLocal.ok, true);
		assert.strictEqual(noLocal.ok && noLocal.copies.length, 2);

		const sameFile = new WorkspaceIndex();
		sameFile.upsert(module('file:///a.arxml', '/D/M', 2));
		const merged = sameFile.resolveTarget('/P/M/C', 'ECUC-CONTAINER-VALUE', 'file:///a.arxml');
		assert.strictEqual(merged.ok, true);
		assert.strictEqual(merged.ok && merged.copies.length, 2);
		assert.strictEqual(merged.ok && merged.element, merged.ok ? merged.copies[0] : undefined);
		assert.strictEqual(merged.ok && merged.element.file, 'file:///a.arxml');

		const different = new WorkspaceIndex();
		different.upsert(module('file:///a.arxml', '/D/M'));
		different.upsert(module('file:///b.arxml', '/D/Other'));
		const mismatch = different.resolveTarget('/P/M/C', 'ECUC-CONTAINER-VALUE', 'file:///c.arxml');
		assert.strictEqual(mismatch.ok, false);
	});

	test('builds lookups for a 200k-element file without a spread crash', () => {
		const elements: IndexElement[] = [
			{ kind: 'container', path: '/P/M/C', file: 'file:///large.arxml', range: { start: 0, end: 10 } },
		];
		for (let at = 0; at < 200_000; at++) {
			elements.push({
				kind: 'parameter',
				definitionRef: `/P/M/C/Parameter${at}`,
				file: 'file:///large.arxml',
				range: { start: at, end: at + 1 },
			});
		}
		const definition: IndexDefinition = {
			path: '/P/M/C/Parameter0',
			kind: 'ECUC-INTEGER-PARAM-DEF',
			shortName: 'Parameter0',
			file: 'file:///module-def.arxml',
			range: { start: 0, end: 10 },
		};
		const file: FileIndex = {
			uri: 'file:///large.arxml',
			packages: ['/P'],
			elements,
			references: [],
			definitions: [definition],
		};
		const index = new WorkspaceIndex();
		index.upsert(file);
		assert.doesNotThrow(() => index.element('/P/M/C'));
		assert.strictEqual(index.element('/P/M/C')?.kind, 'container');
		assert.strictEqual(index.definitionEntry('/P/M/C/Parameter0')?.shortName, 'Parameter0');
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
