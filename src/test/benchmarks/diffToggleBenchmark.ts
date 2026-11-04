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

const MAX_FIRST_MS = 1_500;
const MAX_CACHED_MS = 50;
const MAX_RETAINED_BYTES = 512 * 1024 * 1024;
const PARENTS = 11;
const CHILDREN = 100;

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

function rows(prefix: string): EcucRow[] {
	const out: EcucRow[] = [];
	for (let parent = 0; parent < PARENTS; parent++) {
		const parentId = `container:Root/Parent${parent}#0`;
		out.push(containerRow(parentId, null, `Parent${parent}`, '/D/Parent', CHILDREN * 2));
		for (let child = 0; child < CHILDREN; child++) {
			const childId = `${parentId}/${prefix}_MO_${parent}_${child}#0`;
			out.push(containerRow(childId, parentId, `${prefix}_MO_${parent}_${child}`, '/D/Child', 1));
			out.push(parameterRow(`${childId}/param:P#0`, childId, String(child)));
		}
	}
	return out;
}

function prepared(source: readonly EcucRow[]): DiffPreparedSide {
	return {
		rows: source,
		rangeOf: () => undefined,
		header: { schema: '00048', packages: ['Pkg'] },
	};
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

	const retainedMiB = Math.round(Math.max(0, retainedBytes() - before) / 1048576);
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
	if (semantic.document.summary.renamed === 0) {
		throw new Error('the renamed fixture paired no containers');
	}
	if (equivalentStrict.changed) {
		throw new Error('a no-rename pair posted a second document');
	}
	if (semanticFirstMs > MAX_FIRST_MS || strictFirstMs > MAX_FIRST_MS || equivalentFirstMs > MAX_FIRST_MS) {
		throw new Error(`a first build exceeded ${MAX_FIRST_MS} ms`);
	}
	if (cachedMs > MAX_CACHED_MS || equivalentCachedMs > MAX_CACHED_MS) {
		throw new Error(`a cached switch exceeded ${MAX_CACHED_MS} ms`);
	}
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
