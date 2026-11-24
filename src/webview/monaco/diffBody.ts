/**
 * The semantic body adapter for the Monaco diff.
 *
 * The per-side synthetic documents already carry the semantic pairing: every
 * emitted line maps back to a `DiffRow` key. This module turns those maps into
 * the small row/line view the diff decorations, the merge margin and the preview
 * audit share, so no caller re-derives the pairing or the owning side.
 */
import type { DiffCell, DiffChange, DiffDocument, DiffRow, DiffStatus } from '../../core/diff/diffModel';
import type { DiffSyntheticDocuments } from './synthetic';

export type DiffSide = 'left' | 'right';

/**
 * One semantic row projected onto the per-side models. `leftLines` / `rightLines`
 * contain every model line keyed to the row on that side (node line, comment
 * lines and braces); they are empty when the row has no cell on that side, so a
 * one-sided block never reports a line on the missing side.
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

/**
 * One navigable/ruler semantic row. `order` is the merged row index, so the
 * sequence follows the body rather than Monaco's line diff on the synthetic
 * text. A missing side leaves its line undefined; a missing side is never a target.
 */
export interface SemanticChange {
	key: string;
	status: Exclude<DiffStatus, 'unchanged'>;
	order: number;
	leftLine?: number;
	rightLine?: number;
	renamed: boolean;
}

export interface NavigationTarget {
	side: DiffSide;
	/** 1-based node line on `side`. */
	line: number;
}

/** `[left, right]` sides, in display order. */
function otherSide(side: DiffSide): DiffSide {
	return side === 'left' ? 'right' : 'left';
}

/** The cell shown on `side`, or `undefined` when the side has no cell. */
function cellOnSide(row: DiffBodyRow, side: DiffSide): DiffCell | undefined {
	return side === 'left' ? row.leftCell : row.rightCell;
}

/** The 1-based node line on `side`, when that side owns the row. */
export function lineOnSide(row: DiffBodyRow, side: DiffSide): number | undefined {
	return side === 'left' ? row.leftLine : row.rightLine;
}

/** Every model line keyed to the row on `side`; empty for a missing side. */
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
	aligned: DiffSyntheticDocuments,
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
	aligned: DiffSyntheticDocuments,
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
	aligned: DiffSyntheticDocuments,
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
export function buildDiffBody(document: DiffDocument, aligned: DiffSyntheticDocuments): DiffBody {
	const leftLines = linesByKey(aligned.leftLineKeys);
	const rightLines = linesByKey(aligned.rightLineKeys);
	const rows = document.rows.map((row) => bodyRow(row, aligned, leftLines, rightLines));
	const byKey = new Map<string, DiffBodyRow>();
	for (const row of rows) {
		byKey.set(row.key, row);
	}
	return { rows, byKey };
}

function semanticChange(row: DiffBodyRow, order: number): SemanticChange | undefined {
	if (row.status === 'unchanged') {
		return undefined;
	}
	return {
		key: row.key,
		status: row.status,
		order,
		...(row.leftLine === undefined ? {} : { leftLine: row.leftLine }),
		...(row.rightLine === undefined ? {} : { rightLine: row.rightLine }),
		renamed: row.renamed
	};
}

/**
 * The changed/added/removed rows in merged order. This is the navigation and
 * ruler source: a rename or a semantic pair is one entry, a one-sided row keeps
 * only the side that owns it, and an unchanged row is never a step.
 */
export function semanticChanges(rows: readonly DiffBodyRow[]): SemanticChange[] {
	const changes: SemanticChange[] = [];
	for (let order = 0; order < rows.length; order += 1) {
		const change = semanticChange(rows[order], order);
		if (change !== undefined) {
			changes.push(change);
		}
	}
	return changes;
}

function lineOnChange(change: SemanticChange, side: DiffSide): number | undefined {
	return side === 'left' ? change.leftLine : change.rightLine;
}

/**
 * The pane and line a navigation step reveals. Prefer the pane the caller is
 * working in (the focused pane, mapped through swap); a row that side does not
 * own falls back to the owning pane, so a removed row never reveals a
 * missing side.
 */
export function navigationTarget(change: SemanticChange, preferred: DiffSide): NavigationTarget | undefined {
	const preferredLine = lineOnChange(change, preferred);
	if (preferredLine !== undefined) {
		return { side: preferred, line: preferredLine };
	}
	const fallback = otherSide(preferred);
	const fallbackLine = lineOnChange(change, fallback);
	return fallbackLine === undefined ? undefined : { side: fallback, line: fallbackLine };
}

/**
 * Step through the semantic changes, wrapping past either end. `current` is an
 * index into `changes`; no current position starts at the first change forward
 * and the last change backward.
 */
export function stepChange(count: number, current: number | undefined, direction: 1 | -1): number | undefined {
	if (count <= 0) {
		return undefined;
	}
	return direction > 0 ? stepForward(count, current) : stepBackward(count, current);
}

function stepForward(count: number, current: number | undefined): number {
	if (current === undefined || current < 0 || current >= count) {
		return 0;
	}
	return (current + 1) % count;
}

function stepBackward(count: number, current: number | undefined): number {
	if (current === undefined || current < 0 || current >= count) {
		return count - 1;
	}
	return (current - 1 + count) % count;
}

/**
 * The change the cursor sits in or after on `side`. A cursor above the first
 * change has no anchor, so a forward step starts at the first row and a
 * backward step wraps to the last one.
 */
export function cursorChangeIndex(
	changes: readonly SemanticChange[],
	line: number,
	side: DiffSide
): number | undefined {
	let found: number | undefined;
	for (let at = 0; at < changes.length; at += 1) {
		const changeLine = lineOnChange(changes[at], side);
		if (changeLine !== undefined && changeLine <= line) {
			found = at;
		}
	}
	return found;
}
