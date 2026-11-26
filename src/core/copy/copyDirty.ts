/**
 * Copied-but-unsaved rows.
 *
 * A merge copy writes into one document and leaves it dirty until the user
 * saves. The pages mark the rows that copy created or changed, on the target
 * side only, until the host acknowledges a save. This module is the host's
 * record of those rows: it survives a page reload, follows later edits and
 * drops a record when its text no longer matches (an undo, or a user edit over
 * the copied span).
 *
 * Pure: no `vscode` import and no DOM.
 */
import type { DiffRow } from '../diff/diffModel';

export type CopySide = 'left' | 'right';

/** One applied copy: the span it wrote and the rows that span now covers. */
export interface CopyRecord {
	/** The side the copy wrote to. */
	side: CopySide;
	/** Row keys on that side, without the diff page's added-row prefix. */
	keys: string[];
	/** The written span in target-document offsets. */
	start: number;
	end: number;
	/** The text the plan applied; a span that no longer holds it was undone. */
	text: string;
	/** The target document version after the copy; earlier events are pre-record. */
	version: number;
}

/** One content change in document offsets, as VS Code reports it. */
export interface CopyTextChange {
	start: number;
	end: number;
	text: string;
}

/** The rows each side marks as copied-dirty. */
export interface CopyDirtyRows {
	left: string[];
	right: string[];
}

/** Added diff rows carry the target side's prefix; pages key decorations by row id. */
const ADDED_PREFIX = 'right:';

/**
 * The row id on one side of a diff row. A row that exists only on the right is
 * keyed `right:<id>`; the editor and the page want the bare `<id>`.
 */
export function sideKey(row: DiffRow, side: CopySide): string | undefined {
	if (row[side] === undefined) {
		return undefined;
	}
	return side === 'right' && row.key.startsWith(ADDED_PREFIX)
		? row.key.slice(ADDED_PREFIX.length)
		: row.key;
}

/** The row keys whose cell on `side` overlaps a written span. */
export function copiedRowKeys(
	rows: readonly DiffRow[],
	side: CopySide,
	span: { start: number; end: number }
): string[] {
	const keys: string[] = [];
	for (const row of rows) {
		const cell = row[side];
		if (cell === undefined || cell.range.end <= span.start || cell.range.start >= span.end) {
			continue;
		}
		const key = sideKey(row, side);
		if (key !== undefined && !keys.includes(key)) {
			keys.push(key);
		}
	}
	return keys;
}

/** True when a change covers part of a record's span. */
function overlaps(record: CopyRecord, change: CopyTextChange): boolean {
	return change.start < record.end && change.end > record.start;
}

/** One record after one change: shifted when disjoint, dropped when overlapped. */
function shiftRecord(record: CopyRecord, change: CopyTextChange): CopyRecord | undefined {
	if (change.end <= record.start) {
		const delta = change.text.length - (change.end - change.start);
		return { ...record, start: record.start + delta, end: record.end + delta };
	}
	if (change.start >= record.end) {
		return record;
	}
	return overlaps(record, change) ? undefined : record;
}

/** Every record still standing after one event's changes. */
function shiftRecords(
	records: readonly CopyRecord[],
	changes: readonly CopyTextChange[],
	version: number
): CopyRecord[] {
	const next: CopyRecord[] = [];
	for (const record of records) {
		if (version <= record.version) {
			// The copy's own edit, or an event from before it: not a user change.
			next.push(record);
			continue;
		}
		let current: CopyRecord | undefined = record;
		for (const change of changes) {
			current = shiftRecord(current, change);
			if (current === undefined) {
				break;
			}
		}
		if (current !== undefined) {
			next.push(current);
		}
	}
	return next;
}

/** The host's copied-row state, one record list per document. */
export class CopyDirtyStore {
	private readonly documents = new Map<string, CopyRecord[]>();

	/** Records one applied copy and its rows. */
	record(document: string, record: CopyRecord): void {
		const records = this.documents.get(document);
		if (records === undefined) {
			this.documents.set(document, [record]);
			return;
		}
		records.push(record);
	}

	/** The records still unsaved in one document; empty after a save. */
	records(document: string): readonly CopyRecord[] {
		return this.documents.get(document) ?? [];
	}

	/** The row keys to mark dirty, in copy order and without duplicates. */
	keys(document: string): string[] {
		const keys: string[] = [];
		for (const record of this.records(document)) {
			for (const key of record.keys) {
				if (!keys.includes(key)) {
					keys.push(key);
				}
			}
		}
		return keys;
	}

	/** Whether one document has any unsaved copied rows. */
	has(document: string): boolean {
		return this.keys(document).length > 0;
	}

	/**
	 * Follows one document event. Returns true when the dirty rows changed:
	 * a record was dropped because its span no longer holds the copied text, or
	 * its offsets moved. Rows are keyed by id, so a pure shift keeps them.
	 */
	applyChange(document: string, changes: readonly CopyTextChange[], version: number): boolean {
		const records = this.documents.get(document);
		if (records === undefined || changes.length === 0) {
			return false;
		}
		const before = this.keys(document);
		const next = shiftRecords(records, changes, version);
		if (next.length === records.length && next.every((record, at) => record === records[at])) {
			return false;
		}
		if (next.length === 0) {
			this.documents.delete(document);
		} else {
			this.documents.set(document, next);
		}
		const after = this.keys(document);
		return after.length !== before.length || after.some((key, at) => key !== before[at]);
	}

	/** A save persists every copy: the document has no copied-dirty rows left. */
	clear(document: string): boolean {
		return this.documents.delete(document);
	}

	/** A closed, unsaved buffer loses its copies with it. */
	forget(document: string): boolean {
		return this.documents.delete(document);
	}
}
