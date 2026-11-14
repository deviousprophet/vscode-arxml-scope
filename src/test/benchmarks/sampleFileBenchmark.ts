/**
 * Local-only benchmark against a real ARXML file.
 *
 * Point `ARXML_SCOPE_SAMPLE` at the file; without it the benchmark reports
 * `skipped`, so CI (which has no sample) stays green and no private document is
 * ever committed. The synthetic 26 MiB fixture covers the same scale in CI.
 *
 *   ARXML_SCOPE_SAMPLE=/path/to/all-cases.arxml npm run benchmark sampleFile
 */
import { existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { buildNodeIndex } from '../../core/ecuc/nodeId';
import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { buildRows } from '../../core/ecuc/renderRows';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { engineBinaryPath, EngineClient } from '../../host/engine/engineClient';
import { measureStage } from './benchmarkUtils';

interface SampleRow {
	id: string;
	kind: string;
	value: string;
	valueKind?: string;
}

function report(record: Record<string, unknown>): void {
	console.log(JSON.stringify({ _type: 'sample-file', ...record }));
}

async function measureEngine(client: EngineClient, text: string): Promise<Record<string, unknown>> {
	const openStart = performance.now();
	const opened = await client.request(
		'doc.open',
		{ uri: 'sample.arxml', options: { sort: 'all', sortExcept: SORT_EXCEPTIONS } },
		text
	);
	const openMs = Math.round(performance.now() - openStart);
	const docId = Number(opened.header.docId);
	const rowsStart = performance.now();
	const chunks = await client.requestStream('doc.rows', {
		docId,
		options: { sort: 'all', sortExcept: SORT_EXCEPTIONS }
	});
	const rowsMs = Math.round(performance.now() - rowsStart);
	const engineRows = chunks.flatMap((chunk) =>
		chunk.body.length === 0 ? [] : (JSON.parse(chunk.body.toString('utf8')) as SampleRow[])
	);
	const target = engineRows.find((row) => row.kind === 'parameter' && row.valueKind === 'numeric');
	if (target === undefined) {
		return { openMs, rowsMs, rows: engineRows.length };
	}
	const planStart = performance.now();
	const planned = await client.request('doc.plan', {
		docId,
		kind: 'value',
		nodeId: target.id,
		value: `${target.value}1`
	});
	const planMs = Math.round(performance.now() - planStart);
	const record = JSON.parse(planned.body.toString('utf8')) as {
		record?: { range: { start: number; end: number } };
	};
	if (record.record === undefined) {
		return { openMs, rowsMs, planMs, rows: engineRows.length };
	}
	const updateStart = performance.now();
	const updated = await client.request('doc.update', {
		docId,
		edits: [
			{ start: record.record.range.start, end: record.record.range.end, text: `${target.value}1` }
		]
	});
	const updateMs = Math.round(performance.now() - updateStart);
	await client.request('doc.close', { docId });
	return {
		openMs,
		rowsMs,
		planMs,
		updateMs,
		rows: engineRows.length,
		patchBytes: updated.body.length
	};
}

/** The sample path from the environment, or `undefined` when unset or missing. */
function samplePath(): string | undefined {
	const file = process.env.ARXML_SCOPE_SAMPLE;
	return file !== undefined && existsSync(file) ? file : undefined;
}

async function main(): Promise<void> {
	const file = samplePath();
	if (file === undefined) {
		report({ status: 'skipped', sourceMiB: 0, reason: 'set ARXML_SCOPE_SAMPLE to a local ARXML file' });
		return;
	}
	const sourceMiB = Math.round(readFileSync(file).byteLength / 1048576);
	const text = readFileSync(file, 'utf8');
	const scan = measureStage(() => scanEcucValues(text));
	const index = measureStage(() => buildNodeIndex(scan.value));
	const rows = measureStage(() => buildRows(scan.value, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows);
	const json = measureStage(() => JSON.stringify(rows.value));
	const clone = measureStage(() => structuredClone(rows.value));
	const client = await EngineClient.start({ binary: engineBinaryPath(process.cwd()) });
	try {
		report({
			status: 'ok',
			sourceMiB,
			hostToday: {
				scanMs: scan.elapsedMs,
				indexMs: index.elapsedMs,
				rowsMs: rows.elapsedMs,
				jsonMiB: Math.round(json.value.length / 1048576),
				cloneMs: clone.elapsedMs
			},
			engine: await measureEngine(client, text)
		});
	} finally {
		client.dispose();
	}
}

void main();
