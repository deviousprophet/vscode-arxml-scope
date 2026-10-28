/**
 * Pure virtual-scroll math for the windowed ECUC views (task design §5).
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

/** A constant height function, used by Document node/brace rows and by tests. */
export function fixedRowHeight(height: number): RowHeight {
	return () => height;
}

/**
 * A self-contained copy of the virtual-scroll math for the inlined page. The
 * module's functions are serialized rather than re-written, so the page and the
 * unit tests keep one implementation; only the cache variable and the private
 * helpers they reference are declared alongside them.
 */
export function virtualScrollScript(): string {
	return `
let cache;
${rowCountOf.toString()}
${heightAt.toString()}
${cumulativeHeights.toString()}
${rowAtOffset.toString()}
${calcTotalHeight.toString()}
${calcRowOffset.toString()}
${calcVisibleRange.toString()}
`;
}

/** The row count as a non-negative integer (defensive against fractional input). */
function rowCountOf(state: VirtualState): number {
	return Number.isFinite(state.rowCount) && state.rowCount > 0 ? Math.floor(state.rowCount) : 0;
}

/** A height is used only when it is a finite, non-negative number. */
function heightAt(state: VirtualState, index: number): number {
	const height = state.rowHeight(index);
	return Number.isFinite(height) && height > 0 ? height : 0;
}

function cumulativeHeights(state: VirtualState): number[] {
	const rowCount = rowCountOf(state);
	const current = cache;
	if (
		current &&
		current.rowCount === rowCount &&
		current.rowHeight === state.rowHeight &&
		current.heightVersion === state.heightVersion &&
		current.cumulative.length === rowCount + 1
	) {
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
	const viewport = Number.isFinite(state.containerHeight) && state.containerHeight > 0 ? state.containerHeight : 0;
	const buffer = Number.isFinite(state.bufferSize) && state.bufferSize > 0 ? Math.floor(state.bufferSize) : 0;
	if (total <= 0) {
		// Degenerate zero-height rows: render the first rows so a focus or reveal
		// still has elements, rather than an empty window.
		return [0, Math.min(rowCount, 1 + buffer)];
	}
	const scrollTop = Number.isFinite(state.scrollTop) && state.scrollTop > 0 ? state.scrollTop : 0;
	const top = Math.min(scrollTop, Math.max(0, total - 1));
	const bottom = Math.min(top + viewport, total);

	const firstVisible = rowAtOffset(cumulative, rowCount, top);
	const lastVisible = Math.max(firstVisible, rowAtOffset(cumulative, rowCount, Math.max(0, bottom - 1)));
	const start = Math.max(0, firstVisible - buffer);
	const end = Math.min(rowCount, Math.max(firstVisible + 1, lastVisible + 1 + buffer));
	return [start, end];
}
