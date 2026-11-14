/**
 * Applying the engine's copy patch to a displayed diff document.
 *
 * The engine returns the rows one copy changed, the ancestor rows it re-sent, the
 * offset shift for later rows, and the new counters. The host applies the edit to the
 * engine document, then patches its own copy with this module; the page applies the
 * same message so both stay on the engine's answer.
 *
 * Pure: no `vscode` import and no DOM.
 */
import type { DiffDocument, DiffRow, DiffSummary } from './diffModel';

/** The rows one copy changed, as `diff.patch` reports them. */
export interface DiffPatch {
	at: number;
	remove: number;
	rows: DiffRow[];
	ancestors: DiffRow[];
	shift?: { side: 'left' | 'right'; after: number; by: number };
	summary: DiffSummary;
	semanticSkipped: number;
}

function shifted(row: DiffRow, side: 'left' | 'right', after: number, by: number): DiffRow {
	const cell = row[side];
	if (cell === undefined || cell.range.start < after) {
		return row;
	}
	return {
		...row,
		[side]: { ...cell, range: { start: cell.range.start + by, end: cell.range.end + by } }
	};
}

/** The document after one copy: replaced rows, re-sent ancestors, shifted ranges. */
export function applyDiffPatch(document: DiffDocument, patch: DiffPatch): DiffDocument {
	const rows = document.rows.slice();
	const end = Math.min(rows.length, patch.at + patch.remove);
	rows.splice(patch.at, end - patch.at, ...patch.rows);
	for (const ancestor of patch.ancestors) {
		const at = rows.findIndex((row) => row.key === ancestor.key);
		if (at >= 0) {
			rows[at] = ancestor;
		}
	}
	if (patch.shift !== undefined) {
		const replacedEnd = patch.at + patch.rows.length;
		const { side, after, by } = patch.shift;
		for (let at = 0; at < rows.length; at++) {
			// The replacement rows already carry their new ranges.
			if (at >= patch.at && at < replacedEnd) {
				continue;
			}
			rows[at] = shifted(rows[at], side, after, by);
		}
	}
	return { ...document, rows, summary: patch.summary, semanticSkipped: patch.semanticSkipped };
}
