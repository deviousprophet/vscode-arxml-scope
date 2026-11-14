/**
 * Engine diff benchmark: `diff.compute` against the TypeScript builder.
 *
 * Builds the same ~26 MiB synthetic pair as the large-file benchmark (module 12 x
 * 36 x 3 x 56), opens both sides in the engine, and measures what the panel does on
 * open and on every refresh:
 *
 *   engine: open (upload + parse) both, then strict and semantic `diff.compute`
 *   host:   today's scan + rows + `buildDiffDocument` for the same pair
 *
 * Test-only. Nothing here runs at import time in the extension.
 */
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { buildDiffDocument } from '../../core/diff/diffModel';
import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { buildNodeIndex } from '../../core/ecuc/nodeId';
import { buildRows } from '../../core/ecuc/renderRows';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { engineBinaryPath, EngineClient } from '../../host/engine/engineClient';
import { retainedBytes } from './benchmarkUtils';
import { buildEcucArxml } from './ecucLargeFixture';

interface Record {
	_type: string;
	sourceMiB: number;
	status: 'ok' | 'failed' | 'skipped';
	[stage: string]: unknown;
}

function report(record: Record): void {
	console.log(JSON.stringify({ ...record, _type: record._type ?? 'diff' }));
}

function round(value: number): number {
	return Math.round(value);
}

async function openSide(
	client: EngineClient,
	name: string,
	text: string
): Promise<{ docId: number; openMs: number }> {
	const started = performance.now();
	const opened = await client.request('doc.open', { uri: `/synthetic/${name}` }, text);
	const elapsed = round(performance.now() - started);
	return { docId: Number(opened.header.docId), openMs: elapsed };
}

async function computeOnce(
	client: EngineClient,
	left: number,
	right: number,
	semantic: boolean
): Promise<{ elapsedMs: number; rows: number; payloadMiB: number }> {
	const started = performance.now();
	const chunks = await client.requestStream(
		'diff.compute',
		{
			left: { docId: left, name: 'left.arxml', path: '/synthetic/left.arxml' },
			right: { docId: right, name: 'right.arxml', path: '/synthetic/right.arxml' },
			options: { semanticMatching: semantic }
		},
		undefined,
		300_000
	);
	const elapsedMs = round(performance.now() - started);
	const rows = chunks.reduce(
		(total, chunk) => total + (chunk.body.length === 0 ? 0 : JSON.parse(chunk.body.toString('utf8')).length),
		0
	);
	const payloadMiB = Math.round(chunks.reduce((total, chunk) => total + chunk.body.length, 0) / 1048576);
	return { elapsedMs, rows, payloadMiB };
}

function hostDocument(leftText: string, rightText: string, semantic: boolean): {
	rows: number;
	diffMs: number;
	jsonMs: number;
	payloadMiB: number;
} {
	const leftScan = scanEcucValues(leftText);
	const rightScan = scanEcucValues(rightText);
	const leftIndex = buildNodeIndex(leftScan);
	const rightIndex = buildNodeIndex(rightScan);
	const leftRows = buildRows(leftScan, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows;
	const rightRows = buildRows(rightScan, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows;
	const started = performance.now();
	const document = buildDiffDocument(
		{ name: 'left.arxml', path: '/synthetic/left.arxml' },
		{ name: 'right.arxml', path: '/synthetic/right.arxml' },
		leftRows,
		rightRows,
		(id) => leftIndex.byId.get(id)?.range,
		(id) => rightIndex.byId.get(id)?.range,
		undefined,
		{ semanticMatching: semantic }
	);
	const diffMs = round(performance.now() - started);
	// The panel posts this document, so its serialization is part of the same work.
	const payload = measureJson(document);
	return { rows: document.rows.length, diffMs, jsonMs: payload.elapsedMs, payloadMiB: payload.miB };
}

function measureJson(document: { rows: unknown[] }): { elapsedMs: number; miB: number } {
	const started = performance.now();
	const json = JSON.stringify(document);
	const elapsedMs = round(performance.now() - started);
	return { elapsedMs, miB: round(Buffer.byteLength(json) / 1048576) };
}

async function main(): Promise<void> {
	const leftText = buildEcucArxml('left');
	const rightText = buildEcucArxml('right');
	const sourceMiB = round(Buffer.byteLength(leftText) / 1048576);
	const binary = engineBinaryPath(process.cwd());
	if (!existsSync(binary)) {
		report({
			_type: 'diff',
			sourceMiB,
			status: 'skipped',
			reason: `engine not built at ${binary}; run npm run engine:build`
		});
		return;
	}
	const client = await EngineClient.start({ binary });
	try {
		const left = await openSide(client, 'left.arxml', leftText);
		const right = await openSide(client, 'right.arxml', rightText);
		const strict = await computeOnce(client, left.docId, right.docId, false);
		const semantic = await computeOnce(client, left.docId, right.docId, true);
		await client.request('shutdown');
		const hostStrict = hostDocument(leftText, rightText, false);
		const hostSemantic = hostDocument(leftText, rightText, true);
		report({
			_type: 'diff',
			sourceMiB,
			status: 'ok',
			rows: strict.rows,
			engine: {
				openMs: left.openMs + right.openMs,
				strict,
				semantic
			},
			hostToday: { strict: hostStrict, semantic: hostSemantic },
			retainedMiB: round(retainedBytes() / 1048576)
		});
	} finally {
		client.dispose();
	}
}

main().catch((error: unknown) => {
	report({
		_type: 'diff',
		sourceMiB: 0,
		status: 'failed',
		reason: error instanceof Error ? error.message : String(error)
	});
	process.exitCode = 1;
});
