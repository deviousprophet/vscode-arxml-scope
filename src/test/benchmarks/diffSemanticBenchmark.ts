/**
 * Semantic-rename diff benchmark: many leftover containers with consistent
 * token renames. Guards the bucket-product cutoff and a 3 s budget.
 */
import { performance } from 'node:perf_hooks';
import type { EcucRow } from '../../core/ecuc/renderRows';
import { buildDiffDocument } from '../../core/diff/diffModel';

// Shared CI runners measured 1.4-1.9 s for this corpus, so a 1.5 s line was
// flaky. The real guard is the 250k bucket cut-off: without it this run takes
// many seconds.
const MAX_STEP_MS = 3_000;
const MAX_RETAINED_BYTES = 512 * 1024 * 1024;

function containerRow(id: string, parentId: string | null, shortName: string, definitionRef: string, children: number): EcucRow {
	return {
		id,
		kind: 'container',
		level: parentId === null ? 1 : 2,
		parentId,
		subtreeSize: children,
		posinset: 1,
		setsize: 1,
		hasChildren: children > 0,
		label: shortName,
		shortName,
		definitionRef,
		title: definitionRef,
		meta: [],
		haystack: shortName.toLowerCase(),
	};
}

function parameterRow(id: string, parentId: string, value: string): EcucRow {
	return {
		id,
		kind: 'parameter',
		level: 3,
		parentId,
		subtreeSize: 0,
		posinset: 1,
		setsize: 1,
		hasChildren: false,
		label: 'P',
		definitionRef: '/D/Child/P',
		parameterType: 'Integer',
		value,
		valueKind: 'numeric',
		shownValue: value,
		title: '/D/Child/P',
		meta: [],
		haystack: `p ${value}`,
	};
}

function rows(prefix: string, childCounts: readonly number[]): EcucRow[] {
	const out: EcucRow[] = [];
	for (let parent = 0; parent < childCounts.length; parent++) {
		const parentId = `container:Root/Parent${parent}#0`;
		out.push(containerRow(parentId, null, `Parent${parent}`, '/D/Parent', childCounts[parent] * 2));
		for (let child = 0; child < childCounts[parent]; child++) {
			const childId = `${parentId}/${prefix}_MO_${parent}_${child}#0`;
			out.push(containerRow(childId, parentId, `${prefix}_MO_${parent}_${child}`, '/D/Child', 1));
			out.push(parameterRow(`${childId}/param:P#0`, childId, String(child)));
		}
	}
	return out;
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
	// Ten normal buckets plus one 500x400 bucket, all above the rename threshold.
	const counts = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 500];
	const leftRows = rows('NMH', counts);
	const rightRows = rows('NM', counts);
	const sourceRows = leftRows.length + rightRows.length;

	const before = retainedBytes();
	const started = performance.now();
	const document = buildDiffDocument(
		{ name: 'left.arxml', path: '/work/left.arxml' },
		{ name: 'right.arxml', path: '/work/right.arxml' },
		leftRows,
		rightRows,
		undefined,
		undefined,
		undefined,
		{ semanticMatching: true }
	);
	const elapsedMs = Math.round(performance.now() - started);
	const retainedMiB = Math.round(Math.max(0, retainedBytes() - before) / 1048576);
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

try {
	run();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
