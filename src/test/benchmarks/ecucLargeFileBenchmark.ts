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
import { buildDiffDocument } from '../../core/diff/diffModel';
import type { EcucDocumentModel } from '../../core/ecuc/model';
import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { buildRows } from '../../core/ecuc/renderRows';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { measureStage, retainedBytes } from './benchmarkUtils';
import { buildEcucArxml, type FixtureSide } from './ecucLargeFixture';

/** Per-stage retained heap: 512 MiB. */
const MAX_STEP_RETAINED_BYTES = 512 * 1024 * 1024;
/** Both synthetic documents plus every derived model: 1 GiB. */
const MAX_TOTAL_RETAINED_BYTES = 1024 * 1024 * 1024;
/** Generous ceiling that still fails a hang or an accidental quadratic pass. */
const MAX_STEP_MS = 60_000;

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

interface Sample {
	records: number;
	extra?: Record<string, number>;
}

/** Runs one stage, prints its JSON line and enforces the hard limits. */
function measure<T>(name: string, sourceMiB: number, action: () => T, describe: (value: T) => Sample): T {
	const { value, elapsedMs, retained, retainedMiB } = measureStage(action);
	const { records, extra } = describe(value);
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
