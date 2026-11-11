/**
 * Semantic-rename scale benchmark: 500 and 700 containers under one definition,
 * each with 25 parameter children whose values embed the old container name.
 *
 * Baseline before candidate blocking: 500 paired but took ~16 s locally (the
 * external review measured ~32 s); 700 was above the pair limit and the fallback
 * paired nothing. The current matcher pairs both; local measurements are ~0.2 s
 * and ~0.1 s. The limits are deliberately loose regression guards (roughly 15x
 * and 58x headroom) that still fail a return to quadratic scoring or a fallback
 * that pairs nothing.
 */
import type { EcucRow } from '../../core/ecuc/renderRows';
import { containerRow, measureSemanticDiff, parameterRow } from './benchmarkUtils';

const CHILDREN = 25;
const MAX_500_MS = 3_000;
const MAX_700_MS = 6_000;
const MAX_RETAINED_BYTES = 128 * 1024 * 1024;

/** One root and `count` containers under one definition; child values embed the name. */
function rows(prefix: string, count: number): EcucRow[] {
	const out: EcucRow[] = [];
	const rootId = 'container:Root#0';
	out.push(containerRow(rootId, null, 'Root', '/D/Root', count * (CHILDREN + 1)));
	for (let at = 0; at < count; at++) {
		const name = `${prefix}_MO_${at}`;
		const id = `${rootId}/${name}#0`;
		out.push(containerRow(id, rootId, name, '/D/Child', CHILDREN));
		for (let child = 0; child < CHILDREN; child++) {
			out.push(
				parameterRow({
					id: `${id}/param:P${child}#0`,
					parentId: id,
					name: `P${child}`,
					value: `${prefix}_MO_${at}_V_${child}`,
					parameterType: 'String',
					valueKind: 'textual',
				})
			);
		}
	}
	return out;
}

function measure(renames: number, maxMs: number): void {
	const leftRows = rows('NMH', renames);
	const rightRows = rows('NM', renames);
	const { document, sourceRows, elapsedMs, retainedMiB } = measureSemanticDiff(leftRows, rightRows);
	console.log(
		JSON.stringify({
			_type: 'rename-scale',
			renames,
			sourceRows,
			pairs: document.summary.renamed,
			changed: document.summary.changed,
			added: document.summary.added,
			removed: document.summary.removed,
			limited: document.semanticSkipped,
			reason: document.semanticLimitReason ?? null,
			elapsedMs,
			retainedMiB,
		})
	);
	if (document.summary.renamed !== renames) {
		throw new Error(`paired ${document.summary.renamed} of ${renames} renamed containers`);
	}
	if (document.semanticSkipped !== 0) {
		throw new Error(`${document.semanticSkipped} containers were limited at ${renames} renames`);
	}
	if (document.summary.added !== 0 || document.summary.removed !== 0) {
		throw new Error(
			`${document.summary.added} added and ${document.summary.removed} removed at ${renames} renames`
		);
	}
	if (elapsedMs > maxMs) {
		throw new Error(`${renames} renames took ${elapsedMs} ms; limit is ${maxMs} ms`);
	}
	if (retainedMiB * 1048576 > MAX_RETAINED_BYTES) {
		throw new Error(`retained ${retainedMiB} MiB; limit is ${MAX_RETAINED_BYTES / 1048576} MiB`);
	}
}

try {
	measure(500, MAX_500_MS);
	measure(700, MAX_700_MS);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
