/**
 * Semantic-rename diff benchmark: many leftover containers with consistent
 * token renames. Guards the bucket-product cutoff and a 3 s budget.
 */
import type { EcucRow } from '../../core/ecuc/renderRows';
import { containerRow, containerRows, measureSemanticDiff, parameterRow } from './benchmarkUtils';

// Shared CI runners measured 1.4-1.9 s for this corpus, so a 1.5 s line was
// flaky. The real guard is the 250k bucket cut-off: without it this run takes
// many seconds.
const MAX_STEP_MS = 3_000;
const MAX_RETAINED_BYTES = 512 * 1024 * 1024;

/** Children whose values embed the container name, the shape the semantic deadlock hit. */
function embeddedRows(prefix: string, containers: number): EcucRow[] {
	const out: EcucRow[] = [];
	for (let at = 0; at < containers; at++) {
		const id = `container:Root/${prefix}_A_${at}#0`;
		out.push(containerRow(id, null, `${prefix}_A_${at}`, '/D/MainBus', 10));
		for (let child = 0; child < 10; child++) {
			const value = child < 6 ? `${prefix}_A_${at}_V_${child}` : String(child);
			out.push(
				parameterRow({
					id: `${id}/param:P${child}#0`,
					parentId: id,
					name: 'P',
					value,
					parameterType: 'Integer',
					valueKind: 'numeric',
					haystack: `p ${value}`,
				})
			);
		}
	}
	return out;
}

function run(): void {
	// Ten normal buckets plus one 500x400 bucket, all above the rename threshold.
	const counts = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 500];
	const leftRows = containerRows('NMH', counts);
	const rightRows = containerRows('NM', counts);

	const { document, sourceRows, elapsedMs, retainedMiB } = measureSemanticDiff(leftRows, rightRows);
	console.log(
		JSON.stringify({
			_type: 'diff-semantic',
			sourceRows,
			pairs: document.summary.renamed,
			changed: document.summary.changed,
			elapsedMs,
			retainedMiB,
		})
	);
	if (document.summary.renamed === 0) {
		throw new Error('semantic benchmark paired no containers');
	}
	if (elapsedMs > MAX_STEP_MS) {
		throw new Error(`semantic diff took ${elapsedMs} ms; limit is ${MAX_STEP_MS} ms`);
	}
	if (retainedMiB * 1048576 > MAX_RETAINED_BYTES) {
		throw new Error(`semantic diff retained ${retainedMiB} MiB; limit is ${MAX_RETAINED_BYTES / 1048576} MiB`);
	}
}

function runEmbedded(): void {
	const leftRows = embeddedRows('NMH', 200);
	const rightRows = embeddedRows('NM', 200);
	const { document, sourceRows, elapsedMs, retainedMiB } = measureSemanticDiff(leftRows, rightRows);
	console.log(
		JSON.stringify({
			_type: 'diff-semantic-embedded',
			sourceRows,
			pairs: document.summary.renamed,
			elapsedMs,
			retainedMiB,
		})
	);
	if (document.summary.renamed < 200) {
		throw new Error(`embedded-name semantic matched ${document.summary.renamed} of 200 containers`);
	}
	if (elapsedMs > MAX_STEP_MS) {
		throw new Error(`embedded-name semantic diff took ${elapsedMs} ms; limit is ${MAX_STEP_MS} ms`);
	}
}

try {
	run();
	runEmbedded();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
