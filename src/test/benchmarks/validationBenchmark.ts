/**
 * Validation benchmark over a synthetic, many-file ECUC workspace.
 *
 * Builds ~40 MiB of values plus a definition file, then measures the pure
 * `validateWorkspace` pass. The pass must stay under 5 s and 512 MiB so a full
 * index refresh cannot freeze the extension host.
 */
import { performance } from 'node:perf_hooks';
import { buildFileIndex } from '../../core/index/indexBuilder';
import type { FileIndex } from '../../core/index/indexModel';
import { WorkspaceIndex } from '../../core/index/workspaceIndex';
import { DEFAULT_SEVERITIES } from '../../core/validation/types';
import { validateWorkspace, validateWorkspaceSlices } from '../../core/validation/validate';
import { measureStage } from './benchmarkUtils';

const FILE_COUNT = 10;
const CONTAINERS_PER_FILE = 1000;
const PARAMETERS_PER_CONTAINER = 20;
const MAX_STEP_MS = 5_000;
const MAX_RETAINED_BYTES = 512 * 1024 * 1024;
/** Warm-up plus three measured passes; the median max absorbs one-off runner noise. */
const SLICE_PASSES = 3;
const MAX_SLICE_MS = 50;

/** One generator pass's shape and timing, before the assertions. */
interface SlicedResult {
	slices: number;
	maxSliceMs: number;
	diagnostics: number;
	elapsedMs: number;
}

function definitionsText(): string {
	const parameters: string[] = [];
	for (let parameter = 0; parameter < PARAMETERS_PER_CONTAINER; parameter++) {
		parameters.push(
			`<ECUC-INTEGER-PARAM-DEF><SHORT-NAME>P${parameter}</SHORT-NAME><LOWER-LIMIT>0</LOWER-LIMIT><UPPER-LIMIT>100</UPPER-LIMIT></ECUC-INTEGER-PARAM-DEF>`
		);
	}
	return `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-DEF><SHORT-NAME>MDef</SHORT-NAME><CONTAINERS><ECUC-PARAM-CONF-CONTAINER-DEF><SHORT-NAME>C</SHORT-NAME><LOWER-MULTIPLICITY>0</LOWER-MULTIPLICITY><UPPER-MULTIPLICITY>1</UPPER-MULTIPLICITY><PARAMETERS>${parameters.join('')}</PARAMETERS></ECUC-PARAM-CONF-CONTAINER-DEF></CONTAINERS></ECUC-MODULE-DEF></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
}

function parameterValue(parameter: number): string {
	if (parameter === 0) {
		return '100000';
	}
	return parameter === 1 ? '' : String(parameter);
}

function parameterLine(parameter: number): string {
	const value = parameterValue(parameter);
	return `<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/MDef/C/P${parameter}</DEFINITION-REF><VALUE>${value}</VALUE></ECUC-NUMERICAL-PARAM-VALUE>`;
}

function referenceLine(): string {
	return `<ECUC-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/P/MDef/C/R</DEFINITION-REF><VALUE-REF DEST="ECUC-CONTAINER-VALUE">/P/M/C0</VALUE-REF></ECUC-REFERENCE-VALUE>`;
}

function missingDefinitionLine(fileIndex: number): string {
	return `<PARAMETER-VALUES><ECUC-TEXTUAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-STRING-PARAM-DEF">/P/Missing/Def</DEFINITION-REF><VALUE>${fileIndex}</VALUE></ECUC-TEXTUAL-PARAM-VALUE></PARAMETER-VALUES>`;
}

function containerLines(container: number, fileIndex: number): string[] {
	const name = `C${container}`;
	const lines: string[] = [
		`<ECUC-CONTAINER-VALUE><SHORT-NAME>${name}</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/MDef/C</DEFINITION-REF><PARAMETER-VALUES>`,
	];
	for (let parameter = 0; parameter < PARAMETERS_PER_CONTAINER; parameter++) {
		lines.push(parameterLine(parameter));
	}
	lines.push('</PARAMETER-VALUES><REFERENCE-VALUES>');
	lines.push(referenceLine());
	lines.push('</REFERENCE-VALUES>');
	if (container === 0) {
		lines.push(missingDefinitionLine(fileIndex));
	}
	lines.push('</ECUC-CONTAINER-VALUE>');
	return lines;
}

function valuesText(fileIndex: number): string {
	const lines: string[] = [];
	lines.push('<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS>');
	lines.push(
		`<ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/MDef</DEFINITION-REF><CONTAINERS>`
	);
	for (let container = 0; container < CONTAINERS_PER_FILE; container++) {
		lines.push(...containerLines(container, fileIndex));
	}
	lines.push('</CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES>');
	lines.push('</ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>');
	return lines.join('');
}

function run(): void {
	const definitions = buildFileIndex('file:///defs.arxml', definitionsText());
	const files = buildValueFiles();
	const index = buildWorkspace(definitions, files);
	const sourceMiB = Math.round(files.reduce((total, file) => total + file.elements.length * 180, 0) / 1048576);
	const records = files.reduce((total, file) => total + file.elements.length + file.references.length, 0) + definitions.definitions.length;

	const diagnosticCount = checkFullPass(index, sourceMiB, records);
	checkSlicedPass(index, diagnosticCount);
}

function buildValueFiles(): FileIndex[] {
	const files: FileIndex[] = [];
	for (let file = 0; file < FILE_COUNT; file++) {
		files.push(buildFileIndex(`file:///values${file}.arxml`, valuesText(file)));
	}
	return files;
}

function buildWorkspace(definitions: FileIndex, files: readonly FileIndex[]): WorkspaceIndex {
	const index = new WorkspaceIndex();
	index.upsert(definitions);
	for (const file of files) {
		index.upsert(file);
	}
	return index;
}

/** Measures the one-shot pass and returns its diagnostic count. */
function checkFullPass(index: WorkspaceIndex, sourceMiB: number, records: number): number {
	const { value: diagnostics, elapsedMs, retainedMiB } = measureStage(() =>
		validateWorkspace(index, DEFAULT_SEVERITIES)
	);
	console.log(
		JSON.stringify({
			_type: 'validation',
			sourceMiB,
			records,
			diagnostics: diagnostics.length,
			elapsedMs,
			retainedMiB,
		})
	);
	if (elapsedMs > MAX_STEP_MS) {
		throw new Error(`validation took ${elapsedMs} ms; limit is ${MAX_STEP_MS} ms`);
	}
	if (retainedMiB * 1048576 > MAX_RETAINED_BYTES) {
		throw new Error(`validation retained ${retainedMiB} MiB; limit is ${MAX_RETAINED_BYTES / 1048576} MiB`);
	}
	return diagnostics.length;
}

/**
 * The host consumes the generator in slices. Measure the longest slice; this
 * run does not await between yields, so the number is the work upper bound.
 */
function collectSlices(index: WorkspaceIndex): SlicedResult {
	const iterator = validateWorkspaceSlices(index, DEFAULT_SEVERITIES);
	let slices = 0;
	let maxSliceMs = 0;
	let diagnostics = 0;
	const slicedStarted = performance.now();
	while (true) {
		const stepStarted = performance.now();
		const step = iterator.next();
		maxSliceMs = Math.max(maxSliceMs, performance.now() - stepStarted);
		if (step.done) {
			diagnostics = step.value.length;
			break;
		}
		slices++;
	}
	return { slices, maxSliceMs, diagnostics, elapsedMs: Math.round(performance.now() - slicedStarted) };
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.floor(sorted.length / 2)];
}

/** One sliced pass, refusing a diagnostic drift before it can pollute the sample. */
function measureSlicedPass(index: WorkspaceIndex, expected: number): SlicedResult {
	const result = collectSlices(index);
	if (result.diagnostics !== expected) {
		throw new Error(`the sliced pass returned ${result.diagnostics} of ${expected} diagnostics`);
	}
	return result;
}

function checkSlicedPass(index: WorkspaceIndex, expected: number): void {
	// The first sliced pass pays the generator/JIT warm-up; measure the steady state.
	measureSlicedPass(index, expected);
	const passes: SlicedResult[] = [];
	for (let pass = 0; pass < SLICE_PASSES; pass += 1) {
		passes.push(measureSlicedPass(index, expected));
	}
	const maxSlices = passes.map((pass) => pass.maxSliceMs);
	const representativeMax = median(maxSlices);
	const representativeElapsed = median(passes.map((pass) => pass.elapsedMs));
	console.log(
		JSON.stringify({
			_type: 'validation-slices',
			slices: passes[0].slices,
			maxSliceMs: Math.round(representativeMax),
			diagnostics: expected,
			elapsedMs: Math.round(representativeElapsed),
			passes: maxSlices.map((value) => Math.round(value))
		})
	);
	if (representativeMax > MAX_SLICE_MS) {
		throw new Error(
			`the median longest validation slice took ${Math.round(representativeMax)} ms over ${SLICE_PASSES} passes; limit is ${MAX_SLICE_MS} ms`
		);
	}
}

try {
	run();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
