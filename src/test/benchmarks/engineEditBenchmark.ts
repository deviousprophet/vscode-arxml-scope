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
import { benchmarkReporter, measureStage, retainedBytes } from './benchmarkUtils';
import { buildEcucArxml } from './ecucLargeFixture';

const EDIT_COUNT = 5;

const report = benchmarkReporter('edit-latency');


function median(values: number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

interface HostStats {
	scanMs: number;
	rowsMs: number;
	jsonMiB: number;
	jsonMs: number;
	cloneMs: number;
}

/** What the host does today for one edit: scan, rows, and the payload it posts. */
function measureHost(text: string): HostStats {
	const scan = measureStage(() => scanEcucValues(text));
	const rows = measureStage(() =>
		buildRows(scan.value, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows
	);
	const payload = measureStage(() => JSON.stringify(rows.value));
	const clone = measureStage(() => structuredClone(rows.value));
	return {
		scanMs: scan.elapsedMs,
		rowsMs: rows.elapsedMs,
		jsonMiB: Math.round(payload.value.length / 1048576),
		jsonMs: payload.elapsedMs,
		cloneMs: clone.elapsedMs
	};
}

interface EngineRows {
	docId: number;
	rows: Array<{ id: string; kind: string; valueKind?: string }>;
	rowsMs: number;
	payloadBytes: number;
}

async function openRows(client: EngineClient, text: string): Promise<EngineRows> {
	const opened = await client.request('doc.open', { uri: '/synthetic/left.arxml' }, text);
	const docId = Number(opened.header.docId);
	const started = performance.now();
	const chunks = await client.requestStream('doc.rows', {
		docId,
		options: { sort: 'all', sortExcept: SORT_EXCEPTIONS }
	});
	const rowsMs = Math.round(performance.now() - started);
	const rows = chunks.flatMap((chunk) =>
		chunk.body.length === 0
			? []
			: (JSON.parse(chunk.body.toString('utf8')) as Array<{ id: string; kind: string }>)
	);
	const payloadBytes = chunks.reduce((total, chunk) => total + chunk.body.length, 0);
	return { docId, rows: rows as EngineRows['rows'], rowsMs, payloadBytes };
}

function numericTarget(rows: EngineRows['rows']): string {
	const target = rows.find((row) => row.valueKind === 'numeric');
	if (!target) {
		throw new Error('the fixture has no numeric parameter');
	}
	return target.id;
}

async function planOnce(client: EngineClient, docId: number, nodeId: string, value: string): Promise<number> {
	const started = performance.now();
	const plan = await client.request('doc.plan', { docId, kind: 'value', nodeId, value });
	if (plan.header.ok !== true) {
		throw new Error(`plan refused: ${String(plan.header.reason)}`);
	}
	return performance.now() - started;
}

interface EditStats {
	planMs: number;
	updateMs: number;
	pushedBytes: number;
}

/** A same-size replacement mid-file: the cost of one delta, not edit semantics. */
async function updateOnce(
	client: EngineClient,
	docId: number,
	text: string,
	index: number
): Promise<{ elapsed: number; pushedBytes: number }> {
	const at = Math.floor(text.length / 2) + index;
	const started = performance.now();
	const updated = await client.request('doc.update', {
		docId,
		edits: [{ start: at, end: at + 1, text: text[at] === '0' ? '1' : '0' }]
	});
	return { elapsed: performance.now() - started, pushedBytes: updated.body.length };
}

async function runEdits(client: EngineClient, document: EngineRows, text: string): Promise<EditStats> {
	const nodeId = numericTarget(document.rows);
	const planTimes: number[] = [];
	const updateTimes: number[] = [];
	let pushedBytes = 0;
	for (let index = 0; index < EDIT_COUNT; index++) {
		planTimes.push(await planOnce(client, document.docId, nodeId, String(9000 + index)));
		const update = await updateOnce(client, document.docId, text, index);
		updateTimes.push(update.elapsed);
		pushedBytes = Math.max(pushedBytes, update.pushedBytes);
	}
	return {
		planMs: Math.round(median(planTimes)),
		updateMs: Math.round(median(updateTimes)),
		pushedBytes
	};
}

async function measureEngine(
	text: string,
	binary: string,
	sourceMiB: number,
	host: HostStats
): Promise<void> {
	const client = await EngineClient.start({ binary });
	try {
		const hello = await client.request('hello');
		const opened = performance.now();
		const document = await openRows(client, text);
		const openMs = Math.round(performance.now() - opened);
		const edits = await runEdits(client, document, text);
		await client.request('doc.close', { docId: document.docId });
		await client.request('shutdown');
		report({
			sourceMiB,
			status: 'ok',
			rows: document.rows.length,
			protocol: hello.header.protocol,
			engine: {
				openMs,
				rowsMs: document.rowsMs,
				enginePayloadMiB: Math.round(document.payloadBytes / 1048576),
				...edits
			},
			hostToday: host,
			retainedMiB: Math.round(retainedBytes() / 1048576)
		});
	} finally {
		client.dispose();
	}
}

async function main(): Promise<void> {
	const text = buildEcucArxml('left');
	const sourceMiB = Math.round(Buffer.byteLength(text) / 1048576);
	const binary = engineBinaryPath(process.cwd());
	if (!existsSync(binary)) {
		// The benchmark job has no Rust toolchain; the binary is staged by engine:build.
		report({
				sourceMiB,
			status: 'skipped',
			reason: `engine not built at ${binary}; run npm run engine:build`
		});
		return;
	}
	await measureEngine(text, binary, sourceMiB, measureHost(text));
}

main().catch((error: unknown) => {
	report({
		sourceMiB: 0,
		status: 'failed',
		reason: error instanceof Error ? error.message : String(error)
	});
	process.exit(1);
});
