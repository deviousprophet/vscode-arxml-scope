/**
 * Collapsed-row difference detection for the diff glyph-margin marker.
 *
 * The diff row list is a pre-order tree. A collapsed row hides its own line
 * plus `subtreeSize` descendants; the marker only needs to know whether any of
 * those rows is not unchanged.
 */
import type { DiffRow } from '../../core/diff/diffModel';

function isNameOnly(row: DiffRow): boolean {
	return (
		row.status === 'changed' &&
		row.changes.length > 0 &&
		row.changes.every((change) => change.field === 'short name')
	);
}

function rowHasDifference(row: DiffRow, isRoot: boolean): boolean {
	if (row.status === 'unchanged') {
		return false;
	}
	return !(isRoot && isNameOnly(row));
}

/** True when the row at `rowIndex` or any descendant is changed/added/removed. */
export function subtreeHasDifference(rows: readonly DiffRow[], rowIndex: number): boolean {
	const row = rows[rowIndex];
	if (row === undefined || row.left === undefined || row.right === undefined) {
		return false;
	}
	const end = Math.min(rows.length, rowIndex + 1 + row.subtreeSize);
	return rows
		.slice(rowIndex, end)
		.some((candidate, offset) => rowHasDifference(candidate, offset === 0));
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
