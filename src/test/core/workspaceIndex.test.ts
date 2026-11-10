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

/** One container; `value` adds a parameter so a value edit shifts the container's end. */
function containerXml(name: string, value?: string, definitionRef?: string): string {
	const definition =
		definitionRef === undefined
			? ''
			: `<DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">${definitionRef}</DEFINITION-REF>`;
	const parameters =
		value === undefined
			? ''
			: `<PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/D/${name}/P</DEFINITION-REF><VALUE>${value}</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES>`;
	return `<ECUC-CONTAINER-VALUE><SHORT-NAME>${name}</SHORT-NAME>${definition}${parameters}</ECUC-CONTAINER-VALUE>`;
}

/** A module `M` under package `P`; `padding` shifts every following offset. */
function moduleFile(uri: string, containers: string, padding = ''): ReturnType<typeof buildFileIndex> {
	return buildFileIndex(
		uri,
		`<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME>${padding}<CONTAINERS>${containers}</CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`
	);
}

/** A module `R` whose container holds one reference per target path. */
function referencesFile(uri: string, targets: readonly string[]): ReturnType<typeof buildFileIndex> {
	const references = targets
		.map(
			(target) =>
				`<ECUC-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/P/R/Def/Ref</DEFINITION-REF><VALUE-REF DEST="ECUC-CONTAINER-VALUE">${target}</VALUE-REF></ECUC-REFERENCE-VALUE>`
		)
		.join('');
	return buildFileIndex(
		uri,
		`<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>R</SHORT-NAME><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>Holder</SHORT-NAME><REFERENCE-VALUES>${references}</REFERENCE-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`
	);
}

/** A file with references and no path-bearing elements (an empty target shape). */
function referenceOnlyFile(
	uri: string,
	target: string,
	starts: readonly number[],
	targetDest?: string
): FileIndex {
	return {
		uri,
		packages: [],
		elements: [],
		definitions: [],
		references: starts.map((start) => ({
			kind: 'reference',
			targetRawPath: target,
			...(targetDest === undefined ? {} : { targetDest }),
			contextPaths: [],
			file: uri,
			range: { start, end: start + 1 },
		})),
	};
}

function referencePositions(references: readonly { file: string; range: { start: number } }[]): string[] {
	return references.map((reference) => `${reference.file}@${reference.range.start}`);
}

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

	test('incremental lookups match a fresh build after updates and removals', () => {
		const module = (uri: string, name: string, child: string): ReturnType<typeof buildFileIndex> =>
			buildFileIndex(
				uri,
				`<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>${name}</SHORT-NAME><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>${child}</SHORT-NAME></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`
			);
		const index = new WorkspaceIndex();
		index.upsert(module('file:///a.arxml', 'A', 'OnlyA'));
		index.element('/P/A/OnlyA'); // build the lookups before the updates
		index.upsert(module('file:///b.arxml', 'B', 'OnlyB'));
		index.remove('file:///a.arxml');

		const fresh = new WorkspaceIndex();
		fresh.replaceAll([module('file:///b.arxml', 'B', 'OnlyB')]);
		assert.deepStrictEqual(index.element('/P/B/OnlyB'), fresh.element('/P/B/OnlyB'));
		assert.strictEqual(index.element('/P/A/OnlyA'), undefined);

		// Replacing a file must remove its old paths before adding the new ones.
		index.upsert(module('file:///b.arxml', 'B2', 'OnlyB2'));
		assert.strictEqual(index.element('/P/B/OnlyB'), undefined);
		assert.strictEqual(index.element('/P/B2/OnlyB2')?.shortName, 'OnlyB2');
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

	test('a value/range edit of a target file keeps cross-file references without a full rebuild', () => {
		const index = new WorkspaceIndex();
		index.upsert(moduleFile('file:///target.arxml', containerXml('C', '1')));
		index.upsert(referencesFile('file:///refs.arxml', ['/P/M/C']));
		const before = index.element('/P/M/C');
		assert.ok(before);
		assert.strictEqual(index.referencesFor(before!).length, 1);
		assert.strictEqual(index.referenceMapBuildCount, 1);

		// A longer value and extra whitespace move the container's range.
		index.upsert(moduleFile('file:///target.arxml', containerXml('C', '123456789'), '\n\n'));
		assert.strictEqual(index.referenceMapBuildCount, 1, 'the value save rebuilt the map');
		const after = index.element('/P/M/C');
		assert.ok(after);
		assert.notStrictEqual(after!.range.start, before!.range.start, 'the save must move the target range');
		assert.strictEqual(index.referencesFor(after!).length, 1);
		assert.strictEqual(index.referencesFor(after!)[0].file, 'file:///refs.arxml');
		assert.deepStrictEqual(index.referencesFor(before!), [], 'the replaced target is stale');
		assert.strictEqual(index.referenceMapBuildCount, 1, 'Find References rebuilt the map');
	});

	test('editing a referencing file replaces only its own contribution', () => {
		const index = new WorkspaceIndex();
		index.upsert(moduleFile('file:///target.arxml', containerXml('C1') + containerXml('C2')));
		index.upsert(referencesFile('file:///refs.arxml', ['/P/M/C1']));
		const c1 = index.element('/P/M/C1');
		const c2 = index.element('/P/M/C2');
		assert.ok(c1);
		assert.ok(c2);
		assert.strictEqual(index.referencesFor(c1!).length, 1);
		assert.strictEqual(index.referenceMapBuildCount, 1);

		index.upsert(referencesFile('file:///refs.arxml', ['/P/M/C2']));
		assert.strictEqual(index.referenceMapBuildCount, 1, 'the reference edit rebuilt the map');
		assert.deepStrictEqual(index.referencesFor(c1!), []);
		assert.strictEqual(index.referencesFor(c2!).length, 1);
		assert.strictEqual(index.referencesFor(c2!)[0].file, 'file:///refs.arxml');
		assert.strictEqual(index.referenceMapBuildCount, 1, 'Find References rebuilt the map');
	});

	test('a value edit keeps a same-file reference on the fast path', () => {
		const text = fixtureText('index/values.arxml');
		const index = new WorkspaceIndex();
		index.upsert(buildFileIndex('file:///values.arxml', text));
		const before = index.element('/Synthetic/SampleModule/Main/Sub');
		assert.ok(before);
		assert.strictEqual(index.referencesFor(before!).length, 1);
		assert.strictEqual(index.referenceMapBuildCount, 1);

		// Leading whitespace shifts every range; the target shape is unchanged.
		index.upsert(buildFileIndex('file:///values.arxml', text.replace('<AR-PACKAGES>', '\n  <AR-PACKAGES>')));
		const after = index.element('/Synthetic/SampleModule/Main/Sub');
		assert.ok(after);
		assert.notStrictEqual(after!.range.start, before!.range.start);
		assert.strictEqual(index.referencesFor(after!).length, 1);
		assert.strictEqual(index.referencesFor(after!)[0].file, 'file:///values.arxml');
		assert.strictEqual(index.referenceMapBuildCount, 1, 'the same-file reference save rebuilt the map');
	});

	test('adding and removing a reference-only file stays incremental', () => {
		const index = new WorkspaceIndex();
		index.upsert(moduleFile('file:///target.arxml', containerXml('C')));
		index.upsert(referencesFile('file:///refs.arxml', ['/P/M/C']));
		const target = index.element('/P/M/C');
		assert.ok(target);
		assert.strictEqual(index.referencesFor(target!).length, 1);
		assert.strictEqual(index.referenceMapBuildCount, 1);

		index.upsert(referenceOnlyFile('file:///extra.arxml', '/P/M/C', [7, 9]));
		assert.strictEqual(index.referenceMapBuildCount, 1, 'the add rebuilt the map');
		assert.strictEqual(index.referencesFor(target!).length, 3);
		assert.strictEqual(index.referenceMapBuildCount, 1, 'Find References rebuilt the map');

		assert.strictEqual(index.remove('file:///extra.arxml'), true);
		assert.strictEqual(index.referencesFor(target!).length, 1);
		assert.strictEqual(index.referenceMapBuildCount, 1, 'the remove rebuilt the map');
	});

	test('adding and removing a target file invalidates and matches a fresh index', () => {
		const index = new WorkspaceIndex();
		index.upsert(moduleFile('file:///a.arxml', containerXml('A')));
		index.upsert(referencesFile('file:///refs.arxml', ['/P/M/B']));
		const aTarget = index.element('/P/M/A');
		assert.ok(aTarget);
		assert.deepStrictEqual(index.referencesFor(aTarget!), []);
		assert.strictEqual(index.referenceMapBuildCount, 1);

		index.upsert(moduleFile('file:///b.arxml', containerXml('B')));
		const bTarget = index.element('/P/M/B');
		assert.ok(bTarget);
		assert.strictEqual(index.referencesFor(bTarget!).length, 1);
		assert.strictEqual(index.referenceMapBuildCount, 2, 'the target add did not invalidate');

		const freshAdded = new WorkspaceIndex();
		freshAdded.upsert(moduleFile('file:///a.arxml', containerXml('A')));
		freshAdded.upsert(moduleFile('file:///b.arxml', containerXml('B')));
		freshAdded.upsert(referencesFile('file:///refs.arxml', ['/P/M/B']));
		assert.deepStrictEqual(
			referencePositions(index.referencesFor(bTarget!)),
			referencePositions(freshAdded.referencesFor(freshAdded.element('/P/M/B')!))
		);

		assert.strictEqual(index.remove('file:///b.arxml'), true);
		assert.deepStrictEqual(index.referencesFor(bTarget!), [], 'references to a removed target disappear');
		assert.strictEqual(index.referenceMapBuildCount, 3, 'the target remove did not invalidate');

		const freshRemoved = new WorkspaceIndex();
		freshRemoved.upsert(moduleFile('file:///a.arxml', containerXml('A')));
		freshRemoved.upsert(referencesFile('file:///refs.arxml', ['/P/M/B']));
		assert.deepStrictEqual(
			referencePositions(index.referencesFor(aTarget!)),
			referencePositions(freshRemoved.referencesFor(freshRemoved.element('/P/M/A')!))
		);
	});

	test('a container path change invalidates the map and drops stale target entries', () => {
		const index = new WorkspaceIndex();
		index.upsert(moduleFile('file:///target.arxml', containerXml('C')));
		index.upsert(referencesFile('file:///refs.arxml', ['/P/M/C']));
		const before = index.element('/P/M/C');
		assert.ok(before);
		assert.strictEqual(index.referencesFor(before!).length, 1);
		assert.strictEqual(index.referenceMapBuildCount, 1);

		index.upsert(moduleFile('file:///target.arxml', containerXml('D')));
		const after = index.element('/P/M/D');
		assert.ok(after);
		assert.deepStrictEqual(index.referencesFor(after!), []);
		assert.strictEqual(index.referenceMapBuildCount, 2, 'the path change did not invalidate');

		const fresh = new WorkspaceIndex();
		fresh.upsert(moduleFile('file:///target.arxml', containerXml('D')));
		fresh.upsert(referencesFile('file:///refs.arxml', ['/P/M/C']));
		assert.deepStrictEqual(
			referencePositions(index.referencesFor(after!)),
			referencePositions(fresh.referencesFor(fresh.element('/P/M/D')!))
		);
	});

	test('a container definitionRef change invalidates the map', () => {
		const index = new WorkspaceIndex();
		index.upsert(moduleFile('file:///target.arxml', containerXml('C', undefined, '/P/D/C')));
		index.upsert(referencesFile('file:///refs.arxml', ['/P/M/C']));
		const before = index.element('/P/M/C');
		assert.ok(before);
		assert.strictEqual(index.referencesFor(before!).length, 1);
		assert.strictEqual(index.referenceMapBuildCount, 1);

		index.upsert(moduleFile('file:///target.arxml', containerXml('C', undefined, '/P/D/C2')));
		const after = index.element('/P/M/C');
		assert.ok(after);
		assert.strictEqual(index.referencesFor(after!).length, 1);
		assert.strictEqual(index.referenceMapBuildCount, 2, 'the definitionRef change did not invalidate');
	});

	test('a target kind change invalidates the map', () => {
		const target = (kind: IndexElement['kind']): FileIndex => ({
			uri: 'file:///target.arxml',
			packages: [],
			elements: [{ kind, path: '/P/X', file: 'file:///target.arxml', range: { start: 0, end: 9 } }],
			references: [],
			definitions: [],
		});
		const index = new WorkspaceIndex();
		index.upsert(target('container'));
		index.upsert(referenceOnlyFile('file:///refs.arxml', '/P/X', [4]));
		const before = index.element('/P/X');
		assert.ok(before);
		assert.strictEqual(index.referencesFor(before!).length, 1);
		assert.strictEqual(index.referenceMapBuildCount, 1);

		index.upsert(target('module'));
		const after = index.element('/P/X');
		assert.ok(after);
		assert.strictEqual(index.referencesFor(after!).length, 1);
		assert.strictEqual(index.referenceMapBuildCount, 2, 'the kind change did not invalidate');
	});

	test('duplicate targets resolve like a fresh index after the invalidation', () => {
		const makeA = (): ReturnType<typeof buildFileIndex> => moduleFile('file:///a.arxml', containerXml('C'));
		const makeB = (): ReturnType<typeof buildFileIndex> => moduleFile('file:///b.arxml', containerXml('C'));
		const makeRefs = (): ReturnType<typeof buildFileIndex> => referencesFile('file:///refs.arxml', ['/P/M/C']);

		const index = new WorkspaceIndex();
		index.upsert(makeA());
		index.upsert(makeRefs());
		const single = index.resolveTarget('/P/M/C', 'ECUC-CONTAINER-VALUE');
		assert.ok(single.ok);
		assert.strictEqual(single.ok && index.referencesFor(single.element).length, 1);
		assert.strictEqual(index.referenceMapBuildCount, 1);

		index.upsert(makeB());
		const copied = index.resolveTarget('/P/M/C', 'ECUC-CONTAINER-VALUE');
		assert.ok(copied.ok);

		const fresh = new WorkspaceIndex();
		fresh.upsert(makeA());
		fresh.upsert(makeB());
		fresh.upsert(makeRefs());
		const freshCopies = fresh.resolveTarget('/P/M/C', 'ECUC-CONTAINER-VALUE');
		assert.ok(freshCopies.ok);

		const copyList = copied.ok ? copied.copies : [];
		const freshCopyList = freshCopies.ok ? freshCopies.copies : [];
		assert.strictEqual(copyList.length, 2);
		assert.strictEqual(freshCopyList.length, 2);
		let total = 0;
		for (let at = 0; at < copyList.length; at++) {
			const copy: IndexElement = copyList[at];
			const freshCopy: IndexElement = freshCopyList[at];
			assert.strictEqual(copy.file, freshCopy.file);
			const incrementalRefs = index.referencesFor(copy);
			total += incrementalRefs.length;
			assert.deepStrictEqual(
				referencePositions(incrementalRefs),
				referencePositions(fresh.referencesFor(freshCopy))
			);
		}
		assert.strictEqual(total, 1, 'one copy owns the reference');
		assert.strictEqual(index.referenceMapBuildCount, 2, 'the duplicate add did not invalidate');
	});

	test('reordering identical duplicate targets matches a fresh index', () => {
		const targets = (starts: readonly number[]): FileIndex => {
			const elements: IndexElement[] = starts.map((start) => ({
				kind: 'container',
				path: '/P/M/C',
				file: 'file:///target.arxml',
				range: { start, end: start + 10 },
			}));
			return {
				uri: 'file:///target.arxml',
				packages: [],
				elements,
				references: [],
				definitions: [],
			};
		};
		const index = new WorkspaceIndex();
		index.upsert(targets([30, 90]));
		index.upsert(referenceOnlyFile('file:///refs.arxml', '/P/M/C', [4]));
		const before = index.resolveTarget('/P/M/C', 'ECUC-CONTAINER-VALUE');
		assert.ok(before.ok);
		assert.strictEqual(before.ok ? index.referencesFor(before.copies[0]).length : 0, 1);
		assert.strictEqual(index.referenceMapBuildCount, 1);

		// The path/kind sequence is identical; only the declaration order of the
		// duplicates changes. A fresh index still resolves the reference to the
		// smallest range, so the moved copy must not keep the stale entry.
		index.upsert(targets([90, 30]));
		const after = index.resolveTarget('/P/M/C', 'ECUC-CONTAINER-VALUE');
		assert.ok(after.ok);

		const fresh = new WorkspaceIndex();
		fresh.upsert(targets([90, 30]));
		fresh.upsert(referenceOnlyFile('file:///refs.arxml', '/P/M/C', [4]));
		const freshAfter = fresh.resolveTarget('/P/M/C', 'ECUC-CONTAINER-VALUE');
		assert.ok(freshAfter.ok);

		const copies = after.ok ? after.copies : [];
		const freshCopies = freshAfter.ok ? freshAfter.copies : [];
		assert.strictEqual(copies.length, 2);
		for (let at = 0; at < copies.length; at++) {
			assert.deepStrictEqual(
				referencePositions(index.referencesFor(copies[at])),
				referencePositions(fresh.referencesFor(freshCopies[at]))
			);
		}
		assert.strictEqual(index.referenceMapBuildCount, 2, 'the duplicate reorder did not invalidate');

		// The reverse direction: an out-of-order previous file must not take the
		// fast path just because the next file is canonical.
		index.upsert(targets([30, 90]));
		const back = index.resolveTarget('/P/M/C', 'ECUC-CONTAINER-VALUE');
		assert.ok(back.ok);
		const freshBack = new WorkspaceIndex();
		freshBack.upsert(targets([30, 90]));
		freshBack.upsert(referenceOnlyFile('file:///refs.arxml', '/P/M/C', [4]));
		const freshBackTarget = freshBack.resolveTarget('/P/M/C', 'ECUC-CONTAINER-VALUE');
		assert.ok(freshBackTarget.ok);
		const backCopies = back.ok ? back.copies : [];
		const freshBackCopies = freshBackTarget.ok ? freshBackTarget.copies : [];
		for (let at = 0; at < backCopies.length; at++) {
			assert.deepStrictEqual(
				referencePositions(index.referencesFor(backCopies[at])),
				referencePositions(freshBack.referencesFor(freshBackCopies[at]))
			);
		}
		assert.strictEqual(index.referenceMapBuildCount, 3, 'the reverse reorder did not invalidate');
	});

	test('turning an absent definitionRef into an empty one invalidates the map', () => {
		const copy = (uri: string, definitionRef?: string): FileIndex => ({
			uri,
			packages: [],
			elements: [
				{
					kind: 'container',
					path: '/P/M/C',
					file: uri,
					range: { start: 0, end: 10 },
					...(definitionRef === undefined ? {} : { definitionRef }),
				},
			],
			references: [],
			definitions: [],
		});
		const index = new WorkspaceIndex();
		index.upsert(copy('file:///a.arxml'));
		index.upsert(copy('file:///b.arxml', ''));
		index.upsert(referenceOnlyFile('file:///refs.arxml', '/P/M/C', [4]));
		const before = index.file('file:///a.arxml')?.elements[0];
		assert.ok(before);
		assert.deepStrictEqual(index.referencesFor(before!), [], 'different definitionRef values stay ambiguous');
		assert.strictEqual(index.referenceMapBuildCount, 1);

		// Absent and empty are different identities for copies, so this is a shape change.
		index.upsert(copy('file:///a.arxml', ''));
		const after = index.file('file:///a.arxml')?.elements[0];
		assert.ok(after);
		assert.strictEqual(index.referencesFor(after!).length, 1);
		assert.strictEqual(index.referenceMapBuildCount, 2, 'the definitionRef shape change did not invalidate');

		const fresh = new WorkspaceIndex();
		fresh.upsert(copy('file:///a.arxml', ''));
		fresh.upsert(copy('file:///b.arxml', ''));
		fresh.upsert(referenceOnlyFile('file:///refs.arxml', '/P/M/C', [4]));
		const freshTarget = fresh.file('file:///a.arxml')?.elements[0];
		assert.ok(freshTarget);
		assert.deepStrictEqual(
			referencePositions(index.referencesFor(after!)),
			referencePositions(fresh.referencesFor(freshTarget!))
		);
	});

	test('referencesFor returns file-then-start order after incremental updates', () => {
		const index = new WorkspaceIndex();
		index.upsert(moduleFile('file:///target.arxml', containerXml('C')));
		index.upsert(referenceOnlyFile('file:///z.arxml', '/P/M/C', [5]));
		const target = index.element('/P/M/C');
		assert.ok(target);
		assert.strictEqual(index.referencesFor(target!).length, 1);
		assert.strictEqual(index.referenceMapBuildCount, 1);

		index.upsert(referenceOnlyFile('file:///m.arxml', '/P/M/C', [30]));
		index.upsert(referenceOnlyFile('file:///a.arxml', '/P/M/C', [50, 10]));
		assert.strictEqual(index.referenceMapBuildCount, 1);
		assert.deepStrictEqual(referencePositions(index.referencesFor(target!)), [
			'file:///a.arxml@10',
			'file:///a.arxml@50',
			'file:///m.arxml@30',
			'file:///z.arxml@5',
		]);
		assert.strictEqual(index.referenceMapBuildCount, 1, 'Find References rebuilt the map');

		index.upsert(referenceOnlyFile('file:///m.arxml', '/P/M/C', [1, 99]));
		assert.deepStrictEqual(referencePositions(index.referencesFor(target!)), [
			'file:///a.arxml@10',
			'file:///a.arxml@50',
			'file:///m.arxml@1',
			'file:///m.arxml@99',
			'file:///z.arxml@5',
		]);
		assert.strictEqual(index.referenceMapBuildCount, 1, 'Find References rebuilt the map');
	});

	test('a listener sees the current reverse map and a generation mismatch forces a build', () => {
		const index = new WorkspaceIndex();
		index.upsert(moduleFile('file:///target.arxml', containerXml('C')));
		index.upsert(referenceOnlyFile('file:///refs.arxml', '/P/M/C', [1]));
		const target = index.element('/P/M/C');
		assert.ok(target);
		assert.strictEqual(index.referencesFor(target!).length, 1);
		assert.strictEqual(index.referenceMapBuildCount, 1);

		let observed: number | undefined;
		const subscription = index.onDidChange(() => {
			observed = index.referencesFor(target!).length;
		});
		index.upsert(referenceOnlyFile('file:///extra.arxml', '/P/M/C', [2]));
		subscription.dispose();
		assert.strictEqual(observed, 2, 'the listener saw the updated map');
		assert.strictEqual(index.referenceMapBuildCount, 1, 'the listener did not rebuild');

		index.replaceAll([
			moduleFile('file:///target.arxml', containerXml('C')),
			referenceOnlyFile('file:///refs.arxml', '/P/M/C', [1]),
		]);
		const replaced = index.element('/P/M/C');
		assert.ok(replaced);
		assert.strictEqual(index.referencesFor(replaced!).length, 1);
		assert.strictEqual(index.referenceMapBuildCount, 2, 'the generation mismatch did not rebuild');
	});

	test('a host-built target at the indexed range finds the same references', () => {
		const index = new WorkspaceIndex();
		index.upsert(moduleFile('file:///target.arxml', containerXml('C')));
		index.upsert(referencesFile('file:///refs.arxml', ['/P/M/C']));
		const indexed = index.element('/P/M/C');
		assert.ok(indexed);
		assert.strictEqual(index.referencesFor(indexed!).length, 1);

		// The host asks with a freshly built element, not the indexed instance.
		const synthetic: IndexElement = {
			kind: 'container',
			path: '/P/M/C',
			file: 'file:///target.arxml',
			range: indexed!.range,
		};
		assert.strictEqual(index.referencesFor(synthetic).length, 1);
		assert.strictEqual(index.referenceMapBuildCount, 1);
	});
});
