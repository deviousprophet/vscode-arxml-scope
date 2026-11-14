/**
 * Three-way merge benchmark on the synthetic large document.
 *
 * Opens base, ours and theirs in the engine, plans the merge and composes the text.
 * The work is one plan over every node, so the ceiling catches an accidental quadratic
 * pass rather than machine variance.
 */
import { buildEcucArxml } from './ecucLargeFixture';
import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { composeMerge } from '../../core/merge/compose';
import { planMerge } from '../../core/merge/plan';
import type { MergeDoc } from '../../core/merge/model';
import { engineBinaryPath, EngineClient } from '../../host/engine/engineClient';
import { measureStage } from './benchmarkUtils';

const MAX_TOTAL_MS = 120_000;
const OPTIONS = { sort: 'all' as const, sortExcept: SORT_EXCEPTIONS };

async function openDoc(client: EngineClient, name: string, text: string): Promise<MergeDoc> {
	const opened = await client.request('doc.open', { uri: name, options: OPTIONS }, text);
	const docId = Number(opened.header.docId);
	const chunks = await client.requestStream('doc.rows', { docId, options: OPTIONS });
	const rows = chunks.flatMap((chunk) =>
		chunk.body.length === 0 ? [] : (JSON.parse(chunk.body.toString('utf8')) as MergeDoc['rows'])
	);
	const indexChunks = await client.requestStream('doc.mergeIndex', { docId });
	const nodes = indexChunks.flatMap((chunk) =>
		chunk.body.length === 0 ? [] : (JSON.parse(chunk.body.toString('utf8')) as MergeDoc['nodes'])
	);
	await client.request('doc.close', { docId });
	return { uri: name, text, rows, nodes };
}

async function main(): Promise<void> {
	const baseText = buildEcucArxml('left');
	const changedText = buildEcucArxml('right');
	const sourceMiB = Math.round(Buffer.byteLength(baseText) / 1048576);
	const client = await EngineClient.start({ binary: engineBinaryPath(process.cwd()) });
	const started = performance.now();
	try {
		const [base, ours, theirs] = await Promise.all([
			openDoc(client, 'base.arxml', baseText),
			openDoc(client, 'ours.arxml', changedText),
			openDoc(client, 'theirs.arxml', changedText)
		]);
		const plan = measureStage(() => planMerge({ base, ours, theirs }));
		const composed = measureStage(() => composeMerge({ base, ours, theirs }, plan.value));
		const totalMs = Math.round(performance.now() - started);
		if (totalMs > MAX_TOTAL_MS) {
			throw new Error(`merge took ${totalMs} ms, over the ${MAX_TOTAL_MS} ms ceiling`);
		}
		console.log(
			JSON.stringify({
				_type: 'merge',
				sourceMiB,
				rows: ours.rows.length,
				records: plan.value.decisions.length,
				conflicts: plan.value.conflicts.length,
				unresolved: plan.value.unresolved,
				planMs: plan.elapsedMs,
				composeMs: composed.elapsedMs,
				writtenMiB: composed.value.ok
					? Math.round(Buffer.byteLength(composed.value.text) / 1048576)
					: 0,
				totalMs
			})
		);
	} finally {
		client.dispose();
	}
}

main().catch((error: unknown) => {
	console.log(
		JSON.stringify({
			_type: 'merge',
			status: 'failed',
			reason: error instanceof Error ? error.message : String(error)
		})
	);
	process.exit(1);
});
