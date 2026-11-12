/**
 * Match-mode toggle benchmark.
 *
 * Builds the prepared rows once, then measures the first semantic build, the
 * first strict build and cached switches. The host must never re-scan or
 * rebuild rows to change the mode; the cached budget is therefore near zero.
 */
import { performance } from 'node:perf_hooks';
import type { EcucRow } from '../../core/ecuc/renderRows';
import { DiffSession } from '../../core/diff/diffSession';
import type { DiffPreparedSide } from '../../core/diff/diffSession';
import { containerRows, retainedBytes, retainedDelta } from './benchmarkUtils';

const MAX_FIRST_MS = 1_500;
const MAX_CACHED_MS = 50;
const MAX_RETAINED_BYTES = 512 * 1024 * 1024;
const PARENTS = 11;
const CHILDREN = 100;

/** `PARENTS` buckets of `CHILDREN` children each. */
function rows(prefix: string): EcucRow[] {
	return containerRows(prefix, Array.from({ length: PARENTS }, () => CHILDREN));
}

function prepared(source: readonly EcucRow[]): DiffPreparedSide {
	return {
		rows: source,
		rangeOf: () => undefined,
		header: { schema: '00048', packages: ['Pkg'] },
	};
}

function run(): void {
	const leftRows = rows('NMH');
	const rightRows = rows('NM');
	const labels = { name: 'left.arxml', path: '/work/left.arxml' };
	const other = { name: 'right.arxml', path: '/work/right.arxml' };
	const before = retainedBytes();

	const renamed = new DiffSession(labels, other, prepared(leftRows), prepared(rightRows));
	let started = performance.now();
	const semantic = renamed.document(true);
	const semanticFirstMs = Math.round(performance.now() - started);
	started = performance.now();
	const strict = renamed.document(false);
	const strictFirstMs = Math.round(performance.now() - started);
	started = performance.now();
	renamed.document(true);
	renamed.document(false);
	const cachedMs = Math.round(performance.now() - started);

	const identical = new DiffSession(labels, other, prepared(leftRows), prepared(leftRows));
	started = performance.now();
	identical.document(true);
	const equivalentFirstMs = Math.round(performance.now() - started);
	started = performance.now();
	const equivalentStrict = identical.document(false);
	const equivalentCachedMs = Math.round(performance.now() - started);

	const retainedMiB = retainedDelta(before).retainedMiB;
	console.log(
		JSON.stringify({
			_type: 'diff-toggle',
			sourceRows: leftRows.length + rightRows.length,
			renamed: semantic.document.summary.renamed,
			strictRows: strict.document.rows.length,
			equivalentChanged: equivalentStrict.changed,
			semanticFirstMs,
			strictFirstMs,
			cachedMs,
			equivalentFirstMs,
			equivalentCachedMs,
			retainedMiB,
		})
	);
	requireRenamedFixture(semantic.document.summary.renamed);
	requireNoSecondDocument(equivalentStrict.changed);
	requireFirstBuilds(semanticFirstMs, strictFirstMs, equivalentFirstMs);
	requireCachedSwitch(cachedMs, equivalentCachedMs);
	requireToggleRetention(retainedMiB);
}

function requireRenamedFixture(renamed: number): void {
	if (renamed === 0) {
		throw new Error('the renamed fixture paired no containers');
	}
}

function requireNoSecondDocument(changed: boolean): void {
	if (changed) {
		throw new Error('a no-rename pair posted a second document');
	}
}

function requireFirstBuilds(semanticFirstMs: number, strictFirstMs: number, equivalentFirstMs: number): void {
	if (semanticFirstMs > MAX_FIRST_MS || strictFirstMs > MAX_FIRST_MS || equivalentFirstMs > MAX_FIRST_MS) {
		throw new Error(`a first build exceeded ${MAX_FIRST_MS} ms`);
	}
}

function requireCachedSwitch(cachedMs: number, equivalentCachedMs: number): void {
	if (cachedMs > MAX_CACHED_MS || equivalentCachedMs > MAX_CACHED_MS) {
		throw new Error(`a cached switch exceeded ${MAX_CACHED_MS} ms`);
	}
}

function requireToggleRetention(retainedMiB: number): void {
	if (retainedMiB * 1048576 > MAX_RETAINED_BYTES) {
		throw new Error(`the toggle benchmark retained ${retainedMiB} MiB; limit is ${MAX_RETAINED_BYTES / 1048576} MiB`);
	}
}

try {
	run();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
