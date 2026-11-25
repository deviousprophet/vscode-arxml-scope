import type { DiffRow } from '../../core/diff/diffModel';
import type { DiffGutterRange } from './diffGutterActions';

export type DiffSide = 'left' | 'right';

/** Whether a merged row owns a cell on the stored side. */
function rowHasSide(row: DiffRow | undefined, side: DiffSide): boolean {
	return row !== undefined && (side === 'left' ? row.left : row.right) !== undefined;
}

/** The row key on this model line, when it owns a cell on the stored side. */
function keyHasSide(
	rows: readonly DiffRow[],
	key: string | undefined,
	side: DiffSide
): boolean {
	if (key === undefined) {
		return false;
	}
	return rowHasSide(
		rows.find((candidate) => candidate.key === key),
		side
	);
}

/** The first keyed, side-owning model line in a hunk range. */
export function firstKeyInRange(
	rows: readonly DiffRow[],
	keys: readonly (string | undefined)[],
	range: DiffGutterRange,
	side: DiffSide
): string | undefined {
	const end = Math.min(range.endLineNumberExclusive, keys.length + 1);
	return keys.slice(range.startLineNumber - 1, end - 1).find((key) => keyHasSide(rows, key, side));
}

export function rangeHasSource(
	rows: readonly DiffRow[],
	keys: readonly (string | undefined)[],
	range: DiffGutterRange,
	side: DiffSide
): boolean {
	return firstKeyInRange(rows, keys, range, side) !== undefined;
}
