/**
 * Validation benchmark over a synthetic, many-file ECUC workspace.
 *
 * Builds ~40 MiB of values plus a definition file, then measures the pure
 * `validateWorkspace` pass. The pass must stay under 5 s and 512 MiB so a full
 * index refresh cannot freeze the extension host.
 */
import { performance } from 'node:perf_hooks';
import { buildFileIndex } from '../../core/index/indexBuilder';
import { WorkspaceIndex } from '../../core/index/workspaceIndex';
import { DEFAULT_SEVERITIES } from '../../core/validation/types';
import { validateWorkspace } from '../../core/validation/validate';

const FILE_COUNT = 10;
const CONTAINERS_PER_FILE = 1000;
const PARAMETERS_PER_CONTAINER = 20;
const MAX_STEP_MS = 5_000;
const MAX_RETAINED_BYTES = 512 * 1024 * 1024;

function definitionsText(): string {
	const parameters: string[] = [];
	for (let parameter = 0; parameter < PARAMETERS_PER_CONTAINER; parameter++) {
		parameters.push(
			`<ECUC-INTEGER-PARAM-DEF><SHORT-NAME>P${parameter}</SHORT-NAME><LOWER-LIMIT>0</LOWER-LIMIT><UPPER-LIMIT>100</UPPER-LIMIT></ECUC-INTEGER-PARAM-DEF>`
		);
	}
	return `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-DEF><SHORT-NAME>MDef</SHORT-NAME><CONTAINERS><ECUC-PARAM-CONF-CONTAINER-DEF><SHORT-NAME>C</SHORT-NAME><LOWER-MULTIPLICITY>0</LOWER-MULTIPLICITY><UPPER-MULTIPLICITY>1</UPPER-MULTIPLICITY><PARAMETERS>${parameters.join('')}</PARAMETERS></ECUC-PARAM-CONF-CONTAINER-DEF></CONTAINERS></ECUC-MODULE-DEF></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
}

function valuesText(fileIndex: number): string {
	const lines: string[] = [];
	lines.push('<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS>');
	lines.push(
		`<ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/MDef</DEFINITION-REF><CONTAINERS>`
	);
	for (let container = 0; container < CONTAINERS_PER_FILE; container++) {
		const name = `C${container}`;
		lines.push(
			`<ECUC-CONTAINER-VALUE><SHORT-NAME>${name}</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/MDef/C</DEFINITION-REF><PARAMETER-VALUES>`
		);
		for (let parameter = 0; parameter < PARAMETERS_PER_CONTAINER; parameter++) {
			const value = parameter === 0 ? '100000' : parameter === 1 ? '' : String(parameter);
			lines.push(
				`<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/MDef/C/P${parameter}</DEFINITION-REF><VALUE>${value}</VALUE></ECUC-NUMERICAL-PARAM-VALUE>`
			);
		}
		lines.push('</PARAMETER-VALUES><REFERENCE-VALUES>');
		lines.push(
			`<ECUC-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/P/MDef/C/R</DEFINITION-REF><VALUE-REF DEST="ECUC-CONTAINER-VALUE">/P/M/C0</VALUE-REF></ECUC-REFERENCE-VALUE>`
		);
		lines.push('</REFERENCE-VALUES>');
		if (container === 0) {
			lines.push(
				`<PARAMETER-VALUES><ECUC-TEXTUAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-STRING-PARAM-DEF">/P/Missing/Def</DEFINITION-REF><VALUE>${fileIndex}</VALUE></ECUC-TEXTUAL-PARAM-VALUE></PARAMETER-VALUES>`
			);
		}
		lines.push('</ECUC-CONTAINER-VALUE>');
	}
	lines.push('</CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES>');
	lines.push('</ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>');
	return lines.join('');
}

function retainedBytes(): number {
	if (typeof global.gc !== 'function') {
		throw new Error('Run with --expose-gc');
	}
	global.gc();
	const memory = process.memoryUsage();
	return memory.heapUsed + memory.arrayBuffers;
}

function run(): void {
	const definitions = buildFileIndex('file:///defs.arxml', definitionsText());
	const files = [];
	for (let file = 0; file < FILE_COUNT; file++) {
		files.push(buildFileIndex(`file:///values${file}.arxml`, valuesText(file)));
	}
	const index = new WorkspaceIndex();
	index.upsert(definitions);
	for (const file of files) {
		index.upsert(file);
	}
	const sourceMiB = Math.round(files.reduce((total, file) => total + file.elements.length * 180, 0) / 1048576);
	const records = files.reduce((total, file) => total + file.elements.length + file.references.length, 0) + definitions.definitions.length;

	const before = retainedBytes();
	const started = performance.now();
	const diagnostics = validateWorkspace(index, DEFAULT_SEVERITIES);
	const elapsedMs = Math.round(performance.now() - started);
	const retainedMiB = Math.round(Math.max(0, retainedBytes() - before) / 1048576);
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
}

try {
	run();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
