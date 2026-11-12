/**
 * Pure virtual-scroll math for the windowed ECUC views.
 *
 * The page keeps a flat display-row list, a deterministic row-height function
 * and the scroll container's viewport height; this module answers three
 * questions from those: which row slice to render, where a row starts, and how
 * tall the whole list is. No DOM, no `vscode`, no measurement — heights come
 * from the caller so the CSS and the math can be asserted against the same
 * constants.
 *
 * Heights may be uniform (Document/brace lines) or any non-negative function; the
 * caller owns the height policy. Cumulative
 * heights are cached for the latest state because a scroll pass asks for the
 * range, the spacers and sometimes a row offset from the same list; the cache
 * is keyed on row count, height function identity and `heightVersion`, so a
 * view/data change invalidates it explicitly.
 */

/** A deterministic row height in CSS pixels. */
export type RowHeight = (index: number) => number;

/** A cumulative row-offset table: `offsets[i]` is the top of row `i`. */
export type RowOffsets = readonly number[];

/** A non-negative row count; fractional input is floored. */
function countOf(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** A height is used only when it is a finite, non-negative number. */
function safeHeight(height: number): number {
	return Number.isFinite(height) && height > 0 ? height : 0;
}

/** A finite positive viewport height, else 0. */
function viewportHeight(value: number): number {
	return Number.isFinite(value) && value > 0 ? value : 0;
}

/** A non-negative integer row buffer, else 0. */
function bufferRows(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** The content-relative scroll offset, clamped to `[0, total - 1]`. */
function clampedTop(value: number, total: number): number {
	const top = Number.isFinite(value) && value > 0 ? value : 0;
	return Math.min(top, Math.max(0, total - 1));
}

/** The render range with the buffer applied to both visible edges. */
function visibleRangeOf(
	rowCount: number,
	firstVisible: number,
	lastVisible: number,
	buffer: number
): [number, number] {
	const start = Math.max(0, firstVisible - buffer);
	const end = Math.min(rowCount, Math.max(firstVisible + 1, lastVisible + 1 + buffer));
	return [start, end];
}

/** Builds the cumulative offsets for `rowCount` rows. */
export function buildOffsets(rowCount: number, rowHeight: RowHeight): number[] {
	const count = countOf(rowCount);
	const offsets = new Array<number>(count + 1);
	offsets[0] = 0;
	for (let at = 0; at < count; at++) {
		offsets[at + 1] = offsets[at] + safeHeight(rowHeight(at));
	}
	return offsets;
}

/** The total pixel height in an offsets table. */
export function totalHeightOf(offsets: RowOffsets): number {
	return offsets.length === 0 ? 0 : offsets[offsets.length - 1];
}

/** The first row whose `[offset, offset + height)` range contains `offset`. */
function rowAtOffsetFromOffsets(offsets: RowOffsets, offset: number): number {
	const rowCount = Math.max(0, offsets.length - 1);
	if (rowCount === 0) {
		return 0;
	}
	return searchRowAt(offsets, clampOffset(offset), rowCount);
}

/** A finite non-negative offset; anything else reads as the top. */
function clampOffset(offset: number): number {
	return Number.isFinite(offset) && offset > 0 ? offset : 0;
}

/** Binary search for the row whose range contains `target`. */
function searchRowAt(offsets: RowOffsets, target: number, rowCount: number): number {
	let lo = 0;
	let hi = rowCount - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (offsets[mid + 1] > target) {
			hi = mid;
		} else {
			lo = mid + 1;
		}
	}
	return lo;
}

/**
 * The render range for a precomputed offsets table. The viewport and buffer
 * rules match `calcVisibleRange`; no height function is walked here.
 */
export function visibleRangeFromOffsets(
	offsets: RowOffsets,
	scrollTop: number,
	containerHeight: number,
	bufferSize: number
): [number, number] {
	const rowCount = Math.max(0, offsets.length - 1);
	if (rowCount === 0) {
		return [0, 0];
	}
	const total = totalHeightOf(offsets);
	if (total <= 0) {
		return [0, Math.min(rowCount, 1 + bufferRows(bufferSize))];
	}
	const top = clampedTop(scrollTop, total);
	const bottom = Math.min(top + viewportHeight(containerHeight), total);
	const firstVisible = rowAtOffsetFromOffsets(offsets, top);
	const lastVisible = Math.max(firstVisible, rowAtOffsetFromOffsets(offsets, Math.max(0, bottom - 1)));
	return visibleRangeOf(rowCount, firstVisible, lastVisible, bufferRows(bufferSize));
}

export interface VirtualState {
	rowCount: number;
	rowHeight: RowHeight;
	/** The scroll viewport height (the visible part of `#main`). */
	containerHeight: number;
	/** Content-relative scroll offset, after any header/padding the page subtracts. */
	scrollTop: number;
	/** Extra rows rendered before and after the viewport to hide scroll gaps. */
	bufferSize: number;
	/**
	 * Optional cache key. Change it whenever the same `rowHeight`/`rowCount`
	 * pair starts returning different values (for example a font-size change
	 * that rescales both Document and Tree rows).
	 */
	heightVersion?: string | number;
}

interface HeightCache {
	rowCount: number;
	rowHeight: RowHeight;
	heightVersion: string | number | undefined;
	cumulative: number[];
}

/** The last computed list. Scroll handlers reuse one height function per row set. */
let cache: HeightCache | undefined;

/**
 * A constant height function, used by Document node/brace rows and by tests.
 */
export function fixedRowHeight(height: number): RowHeight {
	return () => height;
}

/** The row count as a non-negative integer (defensive against fractional input). */
function rowCountOf(state: VirtualState): number {
	return countOf(state.rowCount);
}

/** A height is used only when it is a finite, non-negative number. */
function heightAt(state: VirtualState, index: number): number {
	return safeHeight(state.rowHeight(index));
}

/** Whether the cached table still matches this state's key and row count. */
function cacheKeyMatches(current: HeightCache, state: VirtualState, rowCount: number): boolean {
	return (
		current.rowCount === rowCount &&
		current.rowHeight === state.rowHeight &&
		current.heightVersion === state.heightVersion
	);
}

/** Whether the cache is reusable, narrowing an absent cache to a miss. */
function cacheMatches(
	current: HeightCache | undefined,
	state: VirtualState,
	rowCount: number
): current is HeightCache {
	return (
		current !== undefined &&
		cacheKeyMatches(current, state, rowCount) &&
		current.cumulative.length === rowCount + 1
	);
}

function cumulativeHeights(state: VirtualState): number[] {
	const rowCount = rowCountOf(state);
	const current = cache;
	if (cacheMatches(current, state, rowCount)) {
		return current.cumulative;
	}
	const cumulative = new Array<number>(rowCount + 1);
	cumulative[0] = 0;
	for (let i = 0; i < rowCount; i++) {
		cumulative[i + 1] = cumulative[i] + heightAt(state, i);
	}
	cache = { rowCount, rowHeight: state.rowHeight, heightVersion: state.heightVersion, cumulative };
	return cumulative;
}

/**
 * The first row whose `[offset, offset + height)` range contains `offset`.
 * Zero-height rows are skipped; an offset at or past the end maps to the last
 * row. Binary search over the cumulative list.
 */
function rowAtOffset(cumulative: readonly number[], rowCount: number, offset: number): number {
	let lo = 0;
	let hi = rowCount - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (cumulative[mid + 1] > offset) {
			hi = mid;
		} else {
			lo = mid + 1;
		}
	}
	return lo;
}

/** Total pixel height of every row; 0 for an empty list. */
export function calcTotalHeight(state: VirtualState): number {
	const rowCount = rowCountOf(state);
	return cumulativeHeights(state)[rowCount];
}

/**
 * Pixel offset where `index` starts. Clamped to `[0, rowCount]`, so
 * `calcRowOffset(rowCount, state)` is the total height and a negative index is
 * the top.
 */
export function calcRowOffset(index: number, state: VirtualState): number {
	const rowCount = rowCountOf(state);
	const at = Number.isFinite(index) ? Math.max(0, Math.min(Math.floor(index), rowCount)) : 0;
	return cumulativeHeights(state)[at];
}

/**
 * The render range `[start, end)` for the current scroll position, including
 * `bufferSize` rows on each side.
 *
 * - An empty list yields `[0, 0)`.
 * - `scrollTop` is clamped at the top; an over-scrolled value maps to the last
 *   row instead of an empty range.
 * - The viewport bottom is exclusive: a row starting exactly at the bottom edge
 *   is not "visible", though the buffer may still render it.
 * - At least one row is returned when the list is non-empty, even with a zero
 *   viewport height, so keyboard/reveal calls always have a target.
 */
export function calcVisibleRange(state: VirtualState): [number, number] {
	const rowCount = rowCountOf(state);
	if (rowCount === 0) {
		return [0, 0];
	}
	const cumulative = cumulativeHeights(state);
	const total = cumulative[rowCount];
	if (total <= 0) {
		// Degenerate zero-height rows: render the first rows so a focus or reveal
		// still has elements, rather than an empty window.
		return [0, Math.min(rowCount, 1 + bufferRows(state.bufferSize))];
	}
	const top = clampedTop(state.scrollTop, total);
	const bottom = Math.min(top + viewportHeight(state.containerHeight), total);
	const firstVisible = rowAtOffset(cumulative, rowCount, top);
	const lastVisible = Math.max(firstVisible, rowAtOffset(cumulative, rowCount, Math.max(0, bottom - 1)));
	return visibleRangeOf(rowCount, firstVisible, lastVisible, bufferRows(state.bufferSize));
}
