/**
 * Collapsed-row difference detection for the diff glyph-margin marker.
 *
 * The diff row list is a pre-order tree. A collapsed row hides its own line
 * plus `subtreeSize` descendants; the marker only needs to know whether any of
 * those rows is not unchanged.
 */
import type { DiffRow } from '../../core/diff/diffModel';

/** True when the row at `rowIndex` or any descendant is changed/added/removed. */
export function subtreeHasDifference(rows: readonly DiffRow[], rowIndex: number): boolean {
	const row = rows[rowIndex];
	if (row === undefined) {
		return false;
	}
	const end = Math.min(rows.length, rowIndex + 1 + row.subtreeSize);
	return rows.slice(rowIndex, end).some((candidate) => candidate.status !== 'unchanged');
}

/** The collapsed row keys whose folded subtree carries a difference. */
export function collapsedDifferenceKeys(
	rows: readonly DiffRow[],
	collapsedKeys: ReadonlySet<string>
): Set<string> {
	const indexByKey = new Map<string, number>();
	rows.forEach((row, index) => indexByKey.set(row.key, index));
	return new Set(
		[...collapsedKeys].filter((key) => {
			const index = indexByKey.get(key);
			return index !== undefined && subtreeHasDifference(rows, index);
		})
	);
}
