/**
 * Large-index benchmark: stream-parse a synthetic ECUC file and build the
 * workspace lookups. The 200k+ element file is the size class that exposed the
 * array-spread crash before v0.5.0.
 *
 * Headless and synthetic: no `vscode`, no DOM, no customer data.
 */
import { performance } from 'node:perf_hooks';
import { IndexBuilder } from '../../core/index/indexBuilder';
import type { FileIndex, IndexDefinition } from '../../core/index/indexModel';
import { WorkspaceIndex } from '../../core/index/workspaceIndex';

const CONTAINERS = 1800;
const PARAMETERS_PER_CONTAINER = 120;
const MAX_STEP_MS = 60_000;
const MAX_RETAINED_BYTES = 1024 * 1024 * 1024;

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
