/**
 * The semantic body adapter for the Monaco diff.
 *
 * The pre-aligned synthetic documents already carry the semantic pairing: every
 * emitted line maps back to a `DiffRow` key. This module turns that map into the
 * small row/line view the diff decorations, the merge margin and the preview
 * audit share, so no caller re-derives the pairing or the owning side.
 */
import type { DiffCell, DiffChange, DiffDocument, DiffRow, DiffStatus } from '../../core/diff/diffModel';
import type { AlignedSyntheticDocuments } from './synthetic';

export type DiffSide = 'left' | 'right';

/**
 * One semantic row projected onto the aligned models. `leftLines` / `rightLines`
 * contain every model line keyed to the row on that side (node line, comment
 * lines and braces); they are empty when the row has no cell on that side, so a
 * one-sided block never reports a placeholder line as owning.
 */
export interface DiffBodyRow {
	key: string;
	status: DiffStatus;
	/** 1-based node line, when the side owns the row. */
	leftLine?: number;
	rightLine?: number;
	/** Every model line keyed to the row, per owning side. */
	leftLines: readonly number[];
	rightLines: readonly number[];
	changes: readonly DiffChange[];
	leftCell?: DiffCell;
	rightCell?: DiffCell;
	/** True when the row is a changed pair produced by the semantic pass. */
	renamed: boolean;
}

export interface DiffBody {
	rows: readonly DiffBodyRow[];
	byKey: ReadonlyMap<string, DiffBodyRow>;
}

/** `[left, right]` sides, in display order. */
export function otherSide(side: DiffSide): DiffSide {
	return side === 'left' ? 'right' : 'left';
}

/** The cell shown on `side`, or `undefined` for a missing-side placeholder. */
export function cellOnSide(row: DiffBodyRow, side: DiffSide): DiffCell | undefined {
	return side === 'left' ? row.leftCell : row.rightCell;
}

/** The 1-based node line on `side`, when that side owns the row. */
export function lineOnSide(row: DiffBodyRow, side: DiffSide): number | undefined {
	return side === 'left' ? row.leftLine : row.rightLine;
}

/** Every model line keyed to the row on `side`; empty for a placeholder side. */
export function linesOnSide(row: DiffBodyRow, side: DiffSide): readonly number[] {
	return side === 'left' ? row.leftLines : row.rightLines;
}

/** The sides that own a real cell for this row. */
export function owningSides(row: DiffBodyRow): DiffSide[] {
	const sides: DiffSide[] = [];
	if (row.leftCell !== undefined) {
		sides.push('left');
	}
	if (row.rightCell !== undefined) {
		sides.push('right');
	}
	return sides;
}

/**
 * The source side a merge click maps to. Keeping the existing rule means a click
 * on an empty side still resolves to the side that owns the element, so the host
 * keeps its copy/delete semantics unchanged.
 */
export function mergeSourceSide(row: DiffBodyRow, side: DiffSide): DiffSide {
	return cellOnSide(row, side) !== undefined ? side : otherSide(side);
}

/** Every model line keyed to `key`, grouped once per side. */
function linesByKey(keys: readonly (string | undefined)[]): Map<string, number[]> {
	const byKey = new Map<string, number[]>();
	for (let at = 0; at < keys.length; at += 1) {
		const key = keys[at];
		if (key === undefined) {
			continue;
		}
		const lines = byKey.get(key);
		if (lines === undefined) {
			byKey.set(key, [at + 1]);
		} else {
			lines.push(at + 1);
		}
	}
	return byKey;
}

function assignLeft(
	result: DiffBodyRow,
	row: DiffRow,
	aligned: AlignedSyntheticDocuments,
	leftLines: ReadonlyMap<string, readonly number[]>
): void {
	if (row.left === undefined) {
		return;
	}
	result.leftLines = leftLines.get(row.key) ?? [];
	result.leftCell = row.left;
	const line = aligned.left.rowLine.get(row.key);
	if (line !== undefined) {
		result.leftLine = line;
	}
}

function assignRight(
	result: DiffBodyRow,
	row: DiffRow,
	aligned: AlignedSyntheticDocuments,
	rightLines: ReadonlyMap<string, readonly number[]>
): void {
	if (row.right === undefined) {
		return;
	}
	result.rightLines = rightLines.get(row.key) ?? [];
	result.rightCell = row.right;
	const line = aligned.right.rowLine.get(row.key);
	if (line !== undefined) {
		result.rightLine = line;
	}
}

function isRenamedRow(row: DiffRow): boolean {
	return row.status === 'changed' && row.match?.kind === 'semantic';
}

function bodyRow(
	row: DiffRow,
	aligned: AlignedSyntheticDocuments,
	leftLines: ReadonlyMap<string, readonly number[]>,
	rightLines: ReadonlyMap<string, readonly number[]>
): DiffBodyRow {
	const result: DiffBodyRow = {
		key: row.key,
		status: row.status,
		leftLines: [],
		rightLines: [],
		changes: row.changes,
		renamed: isRenamedRow(row)
	};
	assignLeft(result, row, aligned, leftLines);
	assignRight(result, row, aligned, rightLines);
	return result;
}

/** Project every merged row onto its left/right model lines. */
export function buildDiffBody(document: DiffDocument, aligned: AlignedSyntheticDocuments): DiffBody {
	const leftLines = linesByKey(aligned.leftLineKeys);
	const rightLines = linesByKey(aligned.rightLineKeys);
	const rows = document.rows.map((row) => bodyRow(row, aligned, leftLines, rightLines));
	const byKey = new Map<string, DiffBodyRow>();
	for (const row of rows) {
		byKey.set(row.key, row);
	}
	return { rows, byKey };
}
