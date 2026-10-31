/**
 * Large-file benchmark for the ECUC core: scan, rows and semantic diff.
 *
 * Generates a synthetic AUTOSAR ECUC-Values document (no real customer data),
 * then measures each pure stage that the editor runs for one open file and for
 * a two-file comparison. The document is ~25 MiB and is built from the same
 * element shape the scanner parses (modules -> containers -> sub-containers ->
 * parameters), so the timings and retained memory reflect the real pipeline.
 *
 * Hard limits are deliberately far above the local/CI measurements: they catch
 * a catastrophic regression (for example retaining the input text in the model)
 * without turning ordinary machine variance into a red run. Raise them only with
 * a measured reason.
 */
import { performance } from 'node:perf_hooks';
import { buildDiffDocument } from '../../core/diff/diffModel';
import type { EcucDocumentModel } from '../../core/ecuc/model';
import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { buildRows } from '../../core/ecuc/renderRows';
import { scanEcucValues } from '../../core/ecuc/scanner';

/** Synthetic document shape: 12 modules x 36 containers x 3 containers x 56 parameters. */
const MODULE_COUNT = 12;
const CONTAINERS_PER_MODULE = 36;
const SUB_CONTAINERS_PER_CONTAINER = 2;
const PARAMETERS_PER_CONTAINER = 56;

/** Per-stage retained heap: 512 MiB. */
const MAX_STEP_RETAINED_BYTES = 512 * 1024 * 1024;
/** Both synthetic documents plus every derived model: 1 GiB. */
const MAX_TOTAL_RETAINED_BYTES = 1024 * 1024 * 1024;
/** Generous ceiling that still fails a hang or an accidental quadratic pass. */
const MAX_STEP_MS = 60_000;

type Side = 'left' | 'right';

function indent(depth: number): string {
	return '    '.repeat(depth);
}

function parameterIndex(moduleIndex: number, containerIndex: number, slot: number, parameter: number): number {
	const containerId = (moduleIndex * CONTAINERS_PER_MODULE + containerIndex) * (SUB_CONTAINERS_PER_CONTAINER + 1) + slot;
	return containerId * PARAMETERS_PER_CONTAINER + parameter;
}

function parameterBlock(lines: string[], depth: number, path: string, index: number, side: Side): void {
	// A removed parameter on the right side gives the diff a `removed` row.
	if (side === 'right' && index % 313 === 0) {
		return;
	}
	const numeric = index % 2 === 0;
	// Every 97th value differs on the right side, giving the diff a `changed` row.
	const value = side === 'right' && index % 97 === 0 ? index + 1 : index % 100000;
	const tag = numeric ? 'ECUC-NUMERICAL-PARAM-VALUE' : 'ECUC-TEXTUAL-PARAM-VALUE';
	const dest = numeric ? 'ECUC-INTEGER-PARAM-DEF' : 'ECUC-STRING-PARAM-DEF';
	lines.push(`${indent(depth)}<${tag}>`);
	lines.push(`${indent(depth + 1)}<DEFINITION-REF DEST="${dest}">${path}/Parameter${index}</DEFINITION-REF>`);
	lines.push(`${indent(depth + 1)}<VALUE>${numeric ? value : `value_${value}`}</VALUE>`);
	lines.push(`${indent(depth)}</${tag}>`);
}

function containerBlock(
	lines: string[],
	depth: number,
	moduleIndex: number,
	containerIndex: number,
	subIndex: number | null,
	side: Side
): void {
	const shortName = subIndex === null
		? `Container${moduleIndex}_${containerIndex}`
		: `SubContainer${moduleIndex}_${containerIndex}_${subIndex}`;
	const path = `/SyntheticPkg/ModuleDefs/Module${moduleIndex}/${shortName}`;
	const slot = subIndex === null ? 0 : subIndex + 1;
	lines.push(`${indent(depth)}<ECUC-CONTAINER-VALUE>`);
	lines.push(`${indent(depth + 1)}<SHORT-NAME>${shortName}</SHORT-NAME>`);
	lines.push(`${indent(depth + 1)}<DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">${path}</DEFINITION-REF>`);
	lines.push(`${indent(depth + 1)}<PARAMETER-VALUES>`);
	for (let parameter = 0; parameter < PARAMETERS_PER_CONTAINER; parameter++) {
		parameterBlock(lines, depth + 2, path, parameterIndex(moduleIndex, containerIndex, slot, parameter), side);
	}
	lines.push(`${indent(depth + 1)}</PARAMETER-VALUES>`);
	if (subIndex === null) {
		lines.push(`${indent(depth + 1)}<SUB-CONTAINERS>`);
		for (let sub = 0; sub < SUB_CONTAINERS_PER_CONTAINER; sub++) {
			containerBlock(lines, depth + 2, moduleIndex, containerIndex, sub, side);
		}
		lines.push(`${indent(depth + 1)}</SUB-CONTAINERS>`);
	}
	lines.push(`${indent(depth)}</ECUC-CONTAINER-VALUE>`);
}

/** Builds the synthetic ECUC-Values ARXML for one side of the comparison. */
function buildEcucArxml(side: Side): string {
	const lines: string[] = [];
	lines.push('<?xml version="1.0" encoding="UTF-8"?>');
	lines.push('<AUTOSAR xmlns="http://autosar.org/schema/r4.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://autosar.org/schema/r4.0 AUTOSAR_00048.xsd">');
	lines.push(`${indent(1)}<AR-PACKAGES>`);
	lines.push(`${indent(2)}<AR-PACKAGE>`);
	lines.push(`${indent(3)}<SHORT-NAME>SyntheticPkg</SHORT-NAME>`);
	lines.push(`${indent(3)}<ELEMENTS>`);
	for (let module = 0; module < MODULE_COUNT; module++) {
		lines.push(`${indent(4)}<ECUC-MODULE-CONFIGURATION-VALUES>`);
		lines.push(`${indent(5)}<SHORT-NAME>Module${module}</SHORT-NAME>`);
		lines.push(`${indent(5)}<DEFINITION-REF DEST="ECUC-MODULE-DEF">/SyntheticPkg/ModuleDefs/Module${module}</DEFINITION-REF>`);
		lines.push(`${indent(5)}<IMPLEMENTATION-CONFIG-VARIANT>VARIANT-PRE-COMPILE</IMPLEMENTATION-CONFIG-VARIANT>`);
		lines.push(`${indent(5)}<CONTAINERS>`);
		for (let container = 0; container < CONTAINERS_PER_MODULE; container++) {
			containerBlock(lines, 6, module, container, null, side);
		}
		lines.push(`${indent(5)}</CONTAINERS>`);
		lines.push(`${indent(4)}</ECUC-MODULE-CONFIGURATION-VALUES>`);
	}
	lines.push(`${indent(3)}</ELEMENTS>`);
	lines.push(`${indent(2)}</AR-PACKAGE>`);
	lines.push(`${indent(1)}</AR-PACKAGES>`);
	lines.push('</AUTOSAR>');
	return lines.join('\n');
}

interface NodeCounts {
	total: number;
	modules: number;
	containers: number;
	parameters: number;
	references: number;
}

/** Counts the nodes the scanner captured; `total` is the model record count. */
function countNodes(model: EcucDocumentModel): NodeCounts {
	const counts: NodeCounts = {
		total: model.modules.length,
		modules: model.modules.length,
		containers: 0,
		parameters: 0,
		references: 0,
	};
	const stack = model.modules.flatMap((module) => module.containers);
	while (stack.length > 0) {
		const container = stack.pop();
		if (!container) {
			break;
		}
		counts.containers++;
		counts.parameters += container.parameters.length;
		counts.references += container.references.length;
		stack.push(...container.containers);
	}
	counts.total += counts.containers + counts.parameters + counts.references;
	return counts;
}

function retainedBytes(): number {
	if (typeof global.gc !== 'function') {
		throw new Error('Run with --expose-gc');
	}
	global.gc();
	const memory = process.memoryUsage();
	return memory.heapUsed + memory.arrayBuffers;
}

interface Sample {
	records: number;
	extra?: Record<string, number>;
}

/** Runs one stage, prints its JSON line and enforces the hard limits. */
function measure<T>(name: string, sourceMiB: number, action: () => T, describe: (value: T) => Sample): T {
	const before = retainedBytes();
	const started = performance.now();
	const value = action();
	const elapsedMs = Math.round(performance.now() - started);
	const retained = Math.max(0, retainedBytes() - before);
	const { records, extra } = describe(value);
	const retainedMiB = Math.round(retained / 1048576);
	console.log(JSON.stringify({
		_type: 'large-file-load',
		name,
		sourceMiB,
		records,
		elapsedMs,
		retainedMiB,
		...extra,
	}));
	if (retained > MAX_STEP_RETAINED_BYTES) {
		throw new Error(`${name} retained ${retainedMiB} MiB; limit is ${MAX_STEP_RETAINED_BYTES / 1048576} MiB`);
	}
	if (elapsedMs > MAX_STEP_MS) {
		throw new Error(`${name} took ${elapsedMs} ms; limit is ${MAX_STEP_MS} ms`);
	}
	return value;
}

function run(): void {
	if (typeof global.gc !== 'function') {
		throw new Error('Run with --expose-gc');
	}
	const baseline = retainedBytes();

	const leftSource = buildEcucArxml('left');
	const rightSource = buildEcucArxml('right');
	const leftMiB = Math.round(leftSource.length / 1048576);
	const combinedMiB = Math.round((leftSource.length + rightSource.length) / 1048576);

	const leftModel = measure(
		'scan',
		leftMiB,
		() => scanEcucValues(leftSource),
		(model) => {
			const counts = countNodes(model);
			return {
				records: counts.total,
				extra: {
					modules: counts.modules,
					containers: counts.containers,
					parameters: counts.parameters,
					references: counts.references,
				},
			};
		}
	);

	const leftRows = measure(
		'rows',
		leftMiB,
		() => buildRows(leftModel, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows,
		(rows) => ({ records: rows.length })
	);

	// The right side is setup for the comparison, not a measured stage: the diff
	// itself is what the panel runs when both documents are already loaded.
	const rightModel = scanEcucValues(rightSource);
	const rightRows = buildRows(rightModel, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows;

	const diff = measure(
		'diff',
		combinedMiB,
		() => buildDiffDocument(
			{ name: 'left.arxml', path: '/synthetic/left.arxml' },
			{ name: 'right.arxml', path: '/synthetic/right.arxml' },
			leftRows,
			rightRows
		),
		(document) => ({
			records: document.summary.changed + document.summary.added + document.summary.removed,
			extra: {
				changed: document.summary.changed,
				added: document.summary.added,
				removed: document.summary.removed,
				unchanged: document.summary.unchanged,
			},
		})
	);

	const total = Math.max(0, retainedBytes() - baseline);
	const totalMiB = Math.round(total / 1048576);
	console.log(JSON.stringify({
		_type: 'large-file-summary',
		concurrentRetainedMiB: totalMiB,
		documents: ['left.arxml', 'right.arxml'],
		sourceMiB: combinedMiB,
		records: [countNodes(leftModel).total, countNodes(rightModel).total, diff.rows.length],
	}));
	if (total > MAX_TOTAL_RETAINED_BYTES) {
		throw new Error(`Synthetic documents retained ${totalMiB} MiB; limit is ${MAX_TOTAL_RETAINED_BYTES / 1048576} MiB`);
	}
}

try {
	run();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
