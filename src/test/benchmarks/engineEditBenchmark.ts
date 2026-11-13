/**
 * Engine edit benchmark: the process round trip against the TypeScript pipeline.
 *
 * Builds the same ~26 MiB synthetic ECUC-Values document as the large-file
 * benchmark, then measures the operations one accepted edit runs:
 *
 *   engine: open (upload + parse), rows, and plan + update per edit
 *   host:   today's scan + row build, including the row payload that is posted
 *
 * Test-only. Nothing here runs at import time in the extension.
 */
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { buildRows } from '../../core/ecuc/renderRows';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { engineBinaryPath, EngineClient } from '../../host/engine/engineClient';
import { arxmlDocument, arxmlPreamble, indent as indentBy, measureStage, retainedBytes } from './benchmarkUtils';


const MODULE_COUNT = 12;
const CONTAINERS_PER_MODULE = 36;
const SUB_CONTAINERS_PER_CONTAINER = 2;
const PARAMETERS_PER_CONTAINER = 56;

function indent(depth: number): string {
	return indentBy(depth, 4);
}

function parameterBlock(lines: string[], depth: number, path: string, index: number): void {
	const numeric = index % 2 === 0;
	const tag = numeric ? 'ECUC-NUMERICAL-PARAM-VALUE' : 'ECUC-TEXTUAL-PARAM-VALUE';
	const dest = numeric ? 'ECUC-INTEGER-PARAM-DEF' : 'ECUC-STRING-PARAM-DEF';
	const value = numeric ? String(index % 100000) : `value_${index % 100000}`;
	lines.push(`${indent(depth)}<${tag}>`);
	lines.push(`${indent(depth + 1)}<DEFINITION-REF DEST="${dest}">${path}/Parameter${index}</DEFINITION-REF>`);
	lines.push(`${indent(depth + 1)}<VALUE>${value}</VALUE>`);
	lines.push(`${indent(depth)}</${tag}>`);
}

function containerBlock(
	lines: string[],
	depth: number,
	moduleIndex: number,
	containerIndex: number,
	subIndex: number | null
): void {
	const shortName =
		subIndex === null
			? `Container${moduleIndex}_${containerIndex}`
			: `SubContainer${moduleIndex}_${containerIndex}_${subIndex}`;
	const path = `/SyntheticPkg/ModuleDefs/Module${moduleIndex}/${shortName}`;
	const slot = subIndex === null ? 0 : subIndex + 1;
	lines.push(`${indent(depth)}<ECUC-CONTAINER-VALUE>`);
	lines.push(`${indent(depth + 1)}<SHORT-NAME>${shortName}</SHORT-NAME>`);
	lines.push(`${indent(depth + 1)}<DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">${path}</DEFINITION-REF>`);
	lines.push(`${indent(depth + 1)}<PARAMETER-VALUES>`);
	for (let parameter = 0; parameter < PARAMETERS_PER_CONTAINER; parameter++) {
		const index =
			((moduleIndex * CONTAINERS_PER_MODULE + containerIndex) * (SUB_CONTAINERS_PER_CONTAINER + 1) + slot) *
				PARAMETERS_PER_CONTAINER +
			parameter;
		parameterBlock(lines, depth + 2, path, index);
	}
	lines.push(`${indent(depth + 1)}</PARAMETER-VALUES>`);
	if (subIndex === null) {
		lines.push(`${indent(depth + 1)}<SUB-CONTAINERS>`);
		for (let sub = 0; sub < SUB_CONTAINERS_PER_CONTAINER; sub++) {
			containerBlock(lines, depth + 2, moduleIndex, containerIndex, sub);
		}
		lines.push(`${indent(depth + 1)}</SUB-CONTAINERS>`);
	}
	lines.push(`${indent(depth)}</ECUC-CONTAINER-VALUE>`);
}

/** The same ~26 MiB synthetic document the large-file benchmark uses. */
function buildEcucArxml(): string {
	const lines = arxmlPreamble(indent);
	for (let module = 0; module < MODULE_COUNT; module++) {
		lines.push(`${indent(4)}<ECUC-MODULE-CONFIGURATION-VALUES>`);
		lines.push(`${indent(5)}<SHORT-NAME>Module${module}</SHORT-NAME>`);
		lines.push(`${indent(5)}<DEFINITION-REF DEST="ECUC-MODULE-DEF">/SyntheticPkg/ModuleDefs/Module${module}</DEFINITION-REF>`);
		lines.push(`${indent(5)}<IMPLEMENTATION-CONFIG-VARIANT>VARIANT-PRE-COMPILE</IMPLEMENTATION-CONFIG-VARIANT>`);
		lines.push(`${indent(5)}<CONTAINERS>`);
		for (let container = 0; container < CONTAINERS_PER_MODULE; container++) {
			containerBlock(lines, 6, module, container, null);
		}
		lines.push(`${indent(5)}</CONTAINERS>`);
		lines.push(`${indent(4)}</ECUC-MODULE-CONFIGURATION-VALUES>`);
	}
	return arxmlDocument(lines, indent);
}

const EDIT_COUNT = 5;

function median(values: number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

interface Record {
	_type: string;
	sourceMiB: number;
	status: 'ok' | 'failed' | 'skipped';
	[stage: string]: unknown;
}

function report(record: Record): void {
	console.log(JSON.stringify({ ...record, _type: record._type ?? 'edit-latency' }));
}

async function main(): Promise<void> {
	const text = buildEcucArxml();
	const sourceMiB = Math.round(Buffer.byteLength(text) / 1048576);
	const binary = engineBinaryPath(process.cwd());
	if (!existsSync(binary)) {
		// The benchmark job has no Rust toolchain; the binary is staged by engine:build.
		report({
			_type: 'edit-latency',
			sourceMiB,
			status: 'skipped',
			reason: `engine not built at ${binary}; run npm run engine:build`
		});
		return;
	}

	// Baseline: what the host does today for one edit.
	const scan = measureStage(() => scanEcucValues(text));
	const rows = measureStage(() =>
		buildRows(scan.value, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows
	);
	const payload = measureStage(() => JSON.stringify(rows.value));
	const clone = measureStage(() => structuredClone(rows.value));

	const client = await EngineClient.start({ binary });
	try {
		const hello = await client.request('hello');
		const protocol = hello.header.protocol;

		const open = performance.now();
		const opened = await client.request('doc.open', { uri: '/synthetic/left.arxml' }, text);
		const openMs = Math.round(performance.now() - open);
		const docId = Number(opened.header.docId);

		const rowsStart = performance.now();
		const chunks = await client.requestStream('doc.rows', {
			docId,
			options: { sort: 'all', sortExcept: SORT_EXCEPTIONS }
		});
		const rowsMs = Math.round(performance.now() - rowsStart);
		const engineRows = chunks.flatMap((chunk) =>
			chunk.body.length === 0 ? [] : JSON.parse(chunk.body.toString('utf8'))
		);
		const enginePayloadBytes = chunks.reduce((total, chunk) => total + chunk.body.length, 0);

		// One accepted edit: plan against the retained model, then apply the delta.
		const planTimes: number[] = [];
		const updateTimes: number[] = [];
		const pushedBytes: number[] = [];
		for (let index = 0; index < EDIT_COUNT; index++) {
			const target = engineRows.find((row: { valueKind?: string }) => row.valueKind === 'numeric');
			if (!target) {
				break;
			}
			const planStart = performance.now();
			const plan = await client.request('doc.plan', {
				docId,
				kind: 'value',
				nodeId: target.id,
				value: String(9000 + index)
			});
			planTimes.push(performance.now() - planStart);
			if (plan.header.ok !== true) {
				throw new Error(`plan refused: ${String(plan.header.reason)}`);
			}
			// A same-size replacement mid-file: this measures the cost of one delta
			// (splice + native rescan + row diff), not edit semantics, which `doc.plan`
			// covers above.
			const at = Math.floor(text.length / 2) + index;
			const updateStart = performance.now();
			const updated = await client.request('doc.update', {
				docId,
				edits: [{ start: at, end: at + 1, text: text[at] === '0' ? '1' : '0' }]
			});
			updateTimes.push(performance.now() - updateStart);
			pushedBytes.push(updated.body.length);
		}

		await client.request('doc.close', { docId });
		await client.request('shutdown');

		report({
			_type: 'edit-latency',
			sourceMiB,
			status: 'ok',
			rows: engineRows.length,
			protocol,
			engine: {
				openMs,
				rowsMs,
				enginePayloadMiB: Math.round(enginePayloadBytes / 1048576),
				planMs: Math.round(median(planTimes)),
				updateMs: Math.round(median(updateTimes)),
				pushedBytes: Math.max(...pushedBytes)
			},
			hostToday: {
				scanMs: scan.elapsedMs,
				rowsMs: rows.elapsedMs,
				jsonMiB: Math.round(payload.value.length / 1048576),
				jsonMs: payload.elapsedMs,
				cloneMs: clone.elapsedMs
			},
			retainedMiB: Math.round((retainedBytes() - 0) / 1048576)
		});
	} finally {
		client.dispose();
	}
}

main().catch((error: unknown) => {
	report({
		_type: 'edit-latency',
		sourceMiB: 0,
		status: 'failed',
		reason: error instanceof Error ? error.message : String(error)
	});
	process.exit(1);
});
