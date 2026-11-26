/**
 * Copied-but-unsaved rows.
 *
 * A merge copy writes into one document and leaves it dirty until the user
 * saves. The pages mark the rows that copy created or changed, on the target
 * side only, until the host acknowledges a save. This module is the host's
 * record of those rows: it survives a page reload, follows later edits and
 * drops a record when a change overlaps its span (an undo, or a user edit over
 * the copied text).
 *
 * Pure: no `vscode` import and no DOM.
 */
import type { DiffRow } from '../diff/diffModel';

export type CopySide = 'left' | 'right';

/** One applied copy: the span it wrote and the rows that span now covers. */
export interface CopyRecord {
	/** Row keys on that side, without the diff page's added-row prefix. */
	keys: string[];
	/** The written span in target-document offsets. */
	start: number;
	end: number;
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
export const ADDED_ROW_PREFIX = 'right:';

/**
 * The row id on one side of a diff row. A row that exists only on the right is
 * keyed `right:<id>`; the editor and the page want the bare `<id>`.
 */
export function sideKey(row: DiffRow, side: CopySide): string | undefined {
	if (row[side] === undefined) {
		return undefined;
	}
	return side === 'right' && row.key.startsWith(ADDED_ROW_PREFIX)
		? row.key.slice(ADDED_ROW_PREFIX.length)
		: row.key;
}

/** True when a row's cell on `side` covers part of a written span. */
function rowOverlapsSpan(row: DiffRow, side: CopySide, span: { start: number; end: number }): boolean {
	const cell = row[side];
	return cell !== undefined && cell.range.end > span.start && cell.range.start < span.end;
}

/** The row keys whose cell on `side` overlaps a written span. */
export function copiedRowKeys(
	rows: readonly DiffRow[],
	side: CopySide,
	span: { start: number; end: number }
): string[] {
	const keys: string[] = [];
	for (const row of rows.filter((candidate) => rowOverlapsSpan(candidate, side, span))) {
		const key = sideKey(row, side);
		if (key !== undefined && !keys.includes(key)) {
			keys.push(key);
		}
	}
	return keys;
}

/** One record after one change: shifted when disjoint, dropped when overlapped. */
function shiftRecord(record: CopyRecord, change: CopyTextChange): CopyRecord | undefined {
	if (change.end <= record.start) {
		const delta = change.text.length - (change.end - change.start);
		return { ...record, start: record.start + delta, end: record.end + delta };
	}
	return change.start >= record.end ? record : undefined;
}

/** One record after one event: its own version, or the shifted record. */
function shiftOne(
	record: CopyRecord,
	changes: readonly CopyTextChange[],
	version: number
): CopyRecord | undefined {
	if (version <= record.version) {
		// The copy's own edit, or an event from before it: not a user change.
		return record;
	}
	let current: CopyRecord | undefined = record;
	for (const change of changes) {
		current = shiftRecord(current, change);
		if (current === undefined) {
			break;
		}
	}
	return current;
}

/** Every record still standing after one event's changes. */
function shiftRecords(
	records: readonly CopyRecord[],
	changes: readonly CopyTextChange[],
	version: number
): CopyRecord[] {
	return records
		.map((record) => shiftOne(record, changes, version))
		.filter((record): record is CopyRecord => record !== undefined);
}

/** True when an event left every record where it was. */
function sameRecords(before: readonly CopyRecord[], after: readonly CopyRecord[]): boolean {
	return before.length === after.length && after.every((record, at) => record === before[at]);
}

/** True when two key lists hold the same ids in the same order. */
function sameKeys(before: readonly string[], after: readonly string[]): boolean {
	return before.length === after.length && after.every((key, at) => key === before[at]);
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

	/**
	 * Follows one document event. Returns true when the marked rows changed: a
	 * record was dropped because a change overlapped its span (an undo, or an
	 * edit over the copied text). Rows are keyed by id, so an edit before the
	 * span only shifts its offsets and returns false.
	 */
	applyChange(document: string, changes: readonly CopyTextChange[], version: number): boolean {
		const records = this.documents.get(document);
		if (records === undefined) {
			return false;
		}
		const before = this.keys(document);
		const next = shiftRecords(records, changes, version);
		if (sameRecords(records, next)) {
			return false;
		}
		this.replace(document, next);
		return !sameKeys(before, this.keys(document));
	}

	/** Stores the surviving records, or forgets the document when none is left. */
	private replace(document: string, records: readonly CopyRecord[]): void {
		if (records.length === 0) {
			this.documents.delete(document);
			return;
		}
		this.documents.set(document, [...records]);
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
