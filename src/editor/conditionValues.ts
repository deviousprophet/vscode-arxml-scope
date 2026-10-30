/**
 * Condition-value entries and their workspace persistence (task design §3).
 *
 * The values are entered by hand in the ECUC editor's Conditions panel and
 * belong to the workspace, not to the ARXML file: they are stored through
 * `workspaceState` and never written beside the user's file. The same
 * normalization runs on the way in (the page's message) and on the way out
 * (`load`), so an old or hand-edited stored value cannot crash the editor.
 */
import * as vscode from 'vscode';

import { ConditionValue, parseConditionValue } from '../core/ecuc/syscond';

export interface ConditionEntry {
	name: string;
	value: string;
}

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
 * The constant-name rule. Self-contained so a page copy can be compared against
 * it in a test; the page cannot call this module (it has no `vscode` import).
 * A leading `/` is allowed so a full `SYSC-REF` path can be pasted (PRD R3).
 */
export function isConditionName(name: string): boolean {
	return /^\/?[A-Za-z_][A-Za-z0-9_.\-/]*$/.test(name);
}

/**
 * Normalizes raw `{ name, value }` input. Names are trimmed and validated,
 * values are trimmed and length-capped, later duplicates replace earlier ones
 * in place, and at most `limit` entries survive. Invalid names are reported so
 * the host can post one warning instead of storing a constant it can never
 * match.
 *
 * A name may start with `/` so a full `SYSC-REF` path can be pasted (PRD R3).
 * An empty value keeps the entry in `entries` so the panel can show the discovered
 * constant, but it is absent from `values`: the evaluator treats it as missing
 * (unknown) rather than as the known empty string.
 */
export function parseConditionEntries(input: unknown, limit = ENTRY_LIMIT): ParsedConditions {
	const entries: ConditionEntry[] = [];
	const values = new Map<string, ConditionValue>();
	const invalid: string[] = [];
	if (!Array.isArray(input)) {
		return { entries, values, invalid };
	}
	const cap = Math.max(0, Math.floor(limit));
	const positions = new Map<string, number>();
	for (const item of input) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			continue;
		}
		const candidate = item as { name?: unknown; value?: unknown };
		if (typeof candidate.name !== 'string' || typeof candidate.value !== 'string') {
			continue;
		}
		const name = candidate.name.trim().slice(0, NAME_LIMIT);
		if (name === '') {
			continue;
		}
		if (!isConditionName(name)) {
			if (!invalid.includes(name)) {
				invalid.push(name);
			}
			continue;
		}
		const value = candidate.value.trim().slice(0, VALUE_LIMIT);
		const at = positions.get(name);
		if (at !== undefined) {
			// Later duplicates replace the value but keep the first position, and the
			// Map keeps its first insertion position for the same key.
			entries[at] = { name, value };
			if (value === '') {
				values.delete(name);
			} else {
				values.set(name, parseConditionValue(value));
			}
			continue;
		}
		if (entries.length >= cap) {
			continue;
		}
		positions.set(name, entries.length);
		entries.push({ name, value });
		if (value !== '') {
			values.set(name, parseConditionValue(value));
		}
	}
	return { entries, values, invalid };
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
