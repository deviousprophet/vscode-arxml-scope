/**
 * Large-index benchmark: stream-parse a synthetic ECUC file and build the
 * workspace lookups. The 200k+ element file is the size class that exposed the
 * array-spread crash on a large file.
 *
 * It also measures save-then-Find-References on the incremental reverse map and
 * on the structural fallback; the reported build count proves which path ran.
 *
 * Headless and synthetic: no `vscode`, no DOM, no customer data.
 */
import { performance } from 'node:perf_hooks';
import { IndexBuilder } from '../../core/index/indexBuilder';
import type { FileIndex, IndexDefinition, IndexReference } from '../../core/index/indexModel';
import { WorkspaceIndex } from '../../core/index/workspaceIndex';

const CONTAINERS = 1800;
const PARAMETERS_PER_CONTAINER = 120;
const MAX_STEP_MS = 60_000;
const MAX_RETAINED_BYTES = 1024 * 1024 * 1024;
const MAX_FIND_REFERENCES_MS = 5_000;

function withShiftedRanges(file: FileIndex, shift: number): FileIndex {
	return {
		...file,
		elements: file.elements.map((element) =>
			element.path === undefined
				? element
				: { ...element, range: { start: element.range.start + shift, end: element.range.end + shift } }
		),
	};
}

function withPathChange(file: FileIndex, from: string, to: string): FileIndex {
	return {
		...file,
		elements: file.elements.map((element) => (element.path === from ? { ...element, path: to } : element)),
	};
}

function indent(depth: number): string {
	return '  '.repeat(depth);
}

function parameterBlock(lines: string[], depth: number, container: number, parameter: number): void {
	lines.push(`${indent(depth)}<ECUC-NUMERICAL-PARAM-VALUE>`);
	lines.push(
		`${indent(depth + 1)}<DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/SyntheticPkg/ModuleDef/Container${container}/Parameter${parameter}</DEFINITION-REF>`
	);
	lines.push(`${indent(depth + 1)}<VALUE>${parameter}</VALUE>`);
	lines.push(`${indent(depth)}</ECUC-NUMERICAL-PARAM-VALUE>`);
}

function buildEcucText(): string {
	const lines: string[] = [];
	lines.push('<?xml version="1.0" encoding="UTF-8"?>');
	lines.push(
		'<AUTOSAR xmlns="http://autosar.org/schema/r4.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://autosar.org/schema/r4.0 AUTOSAR_00048.xsd">'
	);
	lines.push(`${indent(1)}<AR-PACKAGES>`);
	lines.push(`${indent(2)}<AR-PACKAGE>`);
	lines.push(`${indent(3)}<SHORT-NAME>SyntheticPkg</SHORT-NAME>`);
	lines.push(`${indent(3)}<ELEMENTS>`);
	lines.push(`${indent(4)}<ECUC-MODULE-CONFIGURATION-VALUES>`);
	lines.push(`${indent(5)}<SHORT-NAME>Module0</SHORT-NAME>`);
	lines.push(
		`${indent(5)}<DEFINITION-REF DEST="ECUC-MODULE-DEF">/SyntheticPkg/ModuleDef</DEFINITION-REF>`
	);
	lines.push(`${indent(5)}<CONTAINERS>`);
	for (let container = 0; container < CONTAINERS; container++) {
		lines.push(`${indent(6)}<ECUC-CONTAINER-VALUE>`);
		lines.push(`${indent(7)}<SHORT-NAME>Container${container}</SHORT-NAME>`);
		lines.push(
			`${indent(7)}<DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/SyntheticPkg/ModuleDef/Container${container}</DEFINITION-REF>`
		);
		lines.push(`${indent(7)}<PARAMETER-VALUES>`);
		for (let parameter = 0; parameter < PARAMETERS_PER_CONTAINER; parameter++) {
			parameterBlock(lines, 8, container, parameter);
		}
		lines.push(`${indent(7)}</PARAMETER-VALUES>`);
		lines.push(`${indent(6)}</ECUC-CONTAINER-VALUE>`);
	}
	lines.push(`${indent(5)}</CONTAINERS>`);
	lines.push(`${indent(4)}</ECUC-MODULE-CONFIGURATION-VALUES>`);
	lines.push(`${indent(3)}</ELEMENTS>`);
	lines.push(`${indent(2)}</AR-PACKAGE>`);
	lines.push(`${indent(1)}</AR-PACKAGES>`);
	lines.push('</AUTOSAR>');
	return lines.join('\n');
}

function retainedBytes(): number {
	if (typeof global.gc !== 'function') {
		throw new Error('Run with --expose-gc');
	}
	global.gc();
	const memory = process.memoryUsage();
	return memory.heapUsed + memory.arrayBuffers;
}

function measure<T>(name: string, sourceMiB: number, action: () => T, records: (value: T) => number): T {
	const before = retainedBytes();
	const started = performance.now();
	const value = action();
	const elapsedMs = Math.round(performance.now() - started);
	const retainedMiB = Math.round(Math.max(0, retainedBytes() - before) / 1048576);
	console.log(
		JSON.stringify({
			_type: 'large-file-load',
			name,
			sourceMiB,
			records: records(value),
			elapsedMs,
			retainedMiB,
		})
	);
	if (elapsedMs > MAX_STEP_MS) {
		throw new Error(`${name} took ${elapsedMs} ms; limit is ${MAX_STEP_MS} ms`);
	}
	if (retainedMiB * 1048576 > MAX_RETAINED_BYTES) {
		throw new Error(`${name} retained ${retainedMiB} MiB; limit is ${MAX_RETAINED_BYTES / 1048576} MiB`);
	}
	return value;
}

function run(): void {
	if (typeof global.gc !== 'function') {
		throw new Error('Run with --expose-gc');
	}
	const baseline = retainedBytes();
	const text = buildEcucText();
	const sourceMiB = Math.round(text.length / 1048576);

	const file: FileIndex = measure(
		'index-build',
		sourceMiB,
		() => {
			const builder = new IndexBuilder('file:///large.arxml');
			builder.write(text);
			return builder.finish();
		},
		(index) => index.elements.length + index.references.length + index.definitions.length
	);

	const index = new WorkspaceIndex();
	index.upsert(file);
	const definition: IndexDefinition = {
		path: '/SyntheticPkg/ModuleDef/Container0/Parameter0',
		kind: 'ECUC-INTEGER-PARAM-DEF',
		shortName: 'Parameter0',
		file: 'file:///module-def.arxml',
		range: { start: 0, end: 1 },
	};
	index.upsert({
		uri: 'file:///module-def.arxml',
		packages: [],
		elements: [],
		references: [],
		definitions: [definition],
	});

	const found = measure(
		'index-lookup',
		sourceMiB,
		() => ({
			container: index.element('/SyntheticPkg/Module0/Container0'),
			definition: index.definitionEntry('/SyntheticPkg/ModuleDef/Container0/Parameter0'),
		}),
		(value) => (value.container === undefined ? 0 : 1) + (value.definition === undefined ? 0 : 1)
	);
	if (found.container === undefined || found.definition === undefined) {
		throw new Error('index lookup did not resolve the large file');
	}

	// A single-file change must update the live maps, not rebuild the 216k-element
	// workspace. This is the G8 guard.
	const extra: FileIndex = {
		uri: 'file:///extra.arxml',
		packages: [],
		elements: [
			{
				kind: 'container',
				path: '/Extra/C',
				shortName: 'C',
				file: 'file:///extra.arxml',
				range: { start: 0, end: 1 },
			},
		],
		references: [],
		definitions: [],
	};
	const upsertStarted = performance.now();
	index.upsert(extra);
	const upsertElapsedMs = Math.round(performance.now() - upsertStarted);
	const resolved = index.element('/Extra/C');
	console.log(
		JSON.stringify({
			_type: 'index-mutation',
			name: 'upsert-one-file',
			elapsedMs: upsertElapsedMs,
			resolved: resolved !== undefined,
		})
	);
	if (resolved === undefined) {
		throw new Error('the incremental upsert did not add its element');
	}
	if (upsertElapsedMs > 50) {
		throw new Error(`upsert-one-file took ${upsertElapsedMs} ms; limit is 50 ms`);
	}
	index.remove('file:///extra.arxml');

	// Find References must answer from the reverse map after the first build.
	const refs: IndexReference[] = [];
	for (let at = 0; at < 5000; at++) {
		refs.push({
			kind: 'reference',
			targetRawPath: '/SyntheticPkg/Module0/Container0',
			targetDest: 'ECUC-CONTAINER-VALUE',
			contextPaths: [],
			file: 'file:///refs.arxml',
			range: { start: at, end: at + 1 },
		});
	}
	index.upsert({ uri: 'file:///refs.arxml', packages: [], elements: [], references: refs, definitions: [] });
	index.referencesFor(found.container);
	const referencesStarted = performance.now();
	const references = index.referencesFor(found.container);
	const referencesElapsedMs = Math.round(performance.now() - referencesStarted);
	console.log(
		JSON.stringify({
			_type: 'index-references',
			name: 'references-warm',
			references: references.length,
			elapsedMs: referencesElapsedMs,
		})
	);
	if (references.length !== refs.length) {
		throw new Error(`referencesFor returned ${references.length} of ${refs.length} references`);
	}
	if (referencesElapsedMs > 100) {
		throw new Error(`references-warm took ${referencesElapsedMs} ms; limit is 100 ms`);
	}

	// Save-then-Find-References. A value or reference save must use the incremental
	// reverse map; a structural save pays the lazy full rebuild. The build count is
	// the fast-path proof; the elapsed bound is deliberately generous.
	const referenceSave: IndexReference[] = [];
	for (let at = 0; at < 20_000; at++) {
		referenceSave.push({
			kind: 'reference',
			targetRawPath: '/SyntheticPkg/Module0/Container0',
			targetDest: 'ECUC-CONTAINER-VALUE',
			contextPaths: [],
			file: 'file:///refs-extra.arxml',
			range: { start: at * 2, end: at * 2 + 1 },
		});
	}
	const referenceSaveStarted = performance.now();
	index.upsert({
		uri: 'file:///refs-extra.arxml',
		packages: [],
		elements: [],
		references: referenceSave,
		definitions: [],
	});
	const savedReferences = index.referencesFor(found.container);
	const referenceSaveElapsedMs = Math.round(performance.now() - referenceSaveStarted);
	const referenceSaveBuilds = index.referenceMapBuildCount;
	console.log(
		JSON.stringify({
			_type: 'index-find-references',
			name: 'reference-only-save',
			references: savedReferences.length,
			builds: referenceSaveBuilds,
			elapsedMs: referenceSaveElapsedMs,
		})
	);
	if (savedReferences.length !== refs.length + referenceSave.length) {
		throw new Error(`reference-only save returned ${savedReferences.length} references`);
	}
	if (referenceSaveBuilds !== 1) {
		throw new Error(`reference-only save rebuilt the map ${referenceSaveBuilds} times`);
	}
	if (referenceSaveElapsedMs > MAX_FIND_REFERENCES_MS) {
		throw new Error(`reference-only save took ${referenceSaveElapsedMs} ms; limit is ${MAX_FIND_REFERENCES_MS} ms`);
	}
	index.remove('file:///refs-extra.arxml');

	// A value edit rebuilds the file's elements but leaves its target shape intact.
	const valueEdited = withShiftedRanges(file, 1);
	const valueSaveStarted = performance.now();
	index.upsert(valueEdited);
	const editedContainer = index.element('/SyntheticPkg/Module0/Container0');
	const editedReferences = editedContainer === undefined ? [] : index.referencesFor(editedContainer);
	const valueSaveElapsedMs = Math.round(performance.now() - valueSaveStarted);
	const valueSaveBuilds = index.referenceMapBuildCount;
	console.log(
		JSON.stringify({
			_type: 'index-find-references',
			name: 'value-edited-target-save',
			references: editedReferences.length,
			builds: valueSaveBuilds,
			elapsedMs: valueSaveElapsedMs,
		})
	);
	if (editedContainer === undefined || editedReferences.length !== refs.length) {
		throw new Error(`value-edited target save returned ${editedReferences.length} references`);
	}
	if (valueSaveBuilds !== 1) {
		throw new Error(`value-edited target save rebuilt the map ${valueSaveBuilds} times`);
	}
	if (valueSaveElapsedMs > MAX_FIND_REFERENCES_MS) {
		throw new Error(`value-edited target save took ${valueSaveElapsedMs} ms; limit is ${MAX_FIND_REFERENCES_MS} ms`);
	}

	// A path change is structural: the map is invalidated and the query rebuilds it.
	const structural = withPathChange(
		valueEdited,
		'/SyntheticPkg/Module0/Container1799',
		'/SyntheticPkg/Module0/Container1799X'
	);
	const structuralStarted = performance.now();
	index.upsert(structural);
	const structuralContainer = index.element('/SyntheticPkg/Module0/Container0');
	const structuralReferences = structuralContainer === undefined ? [] : index.referencesFor(structuralContainer);
	const structuralElapsedMs = Math.round(performance.now() - structuralStarted);
	const structuralBuilds = index.referenceMapBuildCount;
	console.log(
		JSON.stringify({
			_type: 'index-find-references',
			name: 'structural-save-fallback',
			references: structuralReferences.length,
			builds: structuralBuilds,
			elapsedMs: structuralElapsedMs,
		})
	);
	if (structuralContainer === undefined || structuralReferences.length !== refs.length) {
		throw new Error(`structural save returned ${structuralReferences.length} references`);
	}
	if (structuralBuilds !== 2) {
		throw new Error(`structural save did not rebuild the map (${structuralBuilds} builds)`);
	}
	if (structuralElapsedMs > MAX_FIND_REFERENCES_MS) {
		throw new Error(`structural save took ${structuralElapsedMs} ms; limit is ${MAX_FIND_REFERENCES_MS} ms`);
	}

	const total = Math.max(0, retainedBytes() - baseline);
	const totalMiB = Math.round(total / 1048576);
	console.log(
		JSON.stringify({
			_type: 'large-file-summary',
			concurrentRetainedMiB: totalMiB,
			documents: ['large.arxml', 'module-def.arxml'],
			sourceMiB,
			records: [file.elements.length + file.references.length + file.definitions.length, 1],
		})
	);
	if (total > MAX_RETAINED_BYTES) {
		throw new Error(`Index retained ${totalMiB} MiB; limit is ${MAX_RETAINED_BYTES / 1048576} MiB`);
	}
}

try {
	run();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
