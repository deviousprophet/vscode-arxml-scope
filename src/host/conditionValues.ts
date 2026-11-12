/**
 * Condition-value entries and their workspace persistence.
 *
 * The values are entered by hand in the ECUC editor's Conditions panel and
 * belong to the workspace, not to the ARXML file: they are stored through
 * `workspaceState` and never written beside the user's file. The same
 * normalization runs on the way in (the page's message) and on the way out
 * (`load`), so an old or hand-edited stored value cannot crash the editor.
 */
import * as vscode from 'vscode';

import type { ConditionEntry } from '../core/ecuc/conditionEntry';
import { ConditionValue, isConditionName, parseConditionValue } from '../core/ecuc/syscond';

export interface ParsedConditions {
	/** Trimmed, de-duplicated (last wins), invalid rows removed. */
	entries: ConditionEntry[];
	values: Map<string, ConditionValue>;
	invalid: string[];
}

/** The `workspaceState` key that holds the raw entries. */
export const CONDITION_VALUES_KEY = 'arxmlScope.conditionValues.v1';

const ENTRY_LIMIT = 200;
const NAME_LIMIT = 200;
const VALUE_LIMIT = 200;

/**
 * Normalizes raw `{ name, value }` input. Names are trimmed and validated,
 * values are trimmed and length-capped, later duplicates replace earlier ones
 * in place, and at most `limit` entries survive. Invalid names are reported so
 * the host can post one warning instead of storing a constant it can never
 * match.
 *
 * A name may start with `/` so a full `SYSC-REF` path can be pasted.
 * An empty value keeps the entry in `entries` so the panel can show the discovered
 * constant, but it is absent from `values`: the evaluator treats it as missing
 * (unknown) rather than as the known empty string.
 */
export function parseConditionEntries(input: unknown, limit = ENTRY_LIMIT): ParsedConditions {
	const result: ParsedConditions = { entries: [], values: new Map(), invalid: [] };
	if (!Array.isArray(input)) {
		return result;
	}
	const cap = Math.max(0, Math.floor(limit));
	const positions = new Map<string, number>();
	for (const item of input) {
		const candidate = candidateEntry(item);
		if (candidate === undefined) {
			continue;
		}
		recordEntry(candidate, cap, positions, result);
	}
	return result;
}

/** True for a non-array object, the only shape an entry row can have. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The raw name/value strings of one row; undefined for anything else. */
function readRawEntry(item: unknown): { name: string; value: string } | undefined {
	if (!isRecord(item)) {
		return undefined;
	}
	const { name, value } = item;
	if (typeof name !== 'string' || typeof value !== 'string') {
		return undefined;
	}
	return { name, value };
}

/** A row trimmed and capped, with an empty name already rejected. */
function candidateEntry(item: unknown): { name: string; value: string } | undefined {
	const raw = readRawEntry(item);
	if (raw === undefined) {
		return undefined;
	}
	const name = raw.name.trim().slice(0, NAME_LIMIT);
	if (name === '') {
		return undefined;
	}
	return { name, value: raw.value.trim().slice(0, VALUE_LIMIT) };
}

/** Reports an invalid name once, keeping the first occurrence's position. */
function addInvalid(invalid: string[], name: string): void {
	if (!invalid.includes(name)) {
		invalid.push(name);
	}
}

/** A later duplicate replaces the value in place; an empty value means unknown. */
function replaceEntry(
	entries: ConditionEntry[],
	values: Map<string, ConditionValue>,
	at: number,
	candidate: { name: string; value: string }
): void {
	entries[at] = { name: candidate.name, value: candidate.value };
	if (candidate.value === '') {
		values.delete(candidate.name);
	} else {
		values.set(candidate.name, parseConditionValue(candidate.value));
	}
}

/** Adds a new, in-cap row at the next position. */
function appendEntry(
	entries: ConditionEntry[],
	values: Map<string, ConditionValue>,
	positions: Map<string, number>,
	candidate: { name: string; value: string }
): void {
	positions.set(candidate.name, entries.length);
	entries.push({ name: candidate.name, value: candidate.value });
	if (candidate.value !== '') {
		values.set(candidate.name, parseConditionValue(candidate.value));
	}
}

/** Validates one candidate and records it in `result` (or in `invalid`). */
function recordEntry(
	candidate: { name: string; value: string },
	cap: number,
	positions: Map<string, number>,
	result: ParsedConditions
): void {
	if (!isConditionName(candidate.name)) {
		addInvalid(result.invalid, candidate.name);
		return;
	}
	const at = positions.get(candidate.name);
	if (at !== undefined) {
		replaceEntry(result.entries, result.values, at, candidate);
		return;
	}
	if (result.entries.length >= cap) {
		return;
	}
	appendEntry(result.entries, result.values, positions, candidate);
}

/** Persists the normalized entries in the per-workspace memento. */
export class ConditionValueStore {
	constructor(
		private readonly memento: vscode.Memento,
		private readonly key = CONDITION_VALUES_KEY
	) {}

	/** The stored entries, normalized exactly as an incoming message is. */
	load(): ConditionEntry[] {
		return parseConditionEntries(this.memento.get<unknown>(this.key)).entries;
	}

	save(entries: readonly ConditionEntry[]): Thenable<void> {
		// The same normalization as `load`, so a caller cannot persist an entry the
		// panel could never render or the evaluator could never match.
		return this.memento.update(this.key, parseConditionEntries(entries).entries);
	}

	clear(): Thenable<void> {
		return this.memento.update(this.key, undefined);
	}
}
