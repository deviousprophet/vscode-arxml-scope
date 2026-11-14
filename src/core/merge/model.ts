/**
 * Three-way ECUC merge model.
 *
 * The merge is computed from three documents that the engine parsed: each one's
 * nodes (identity, placement, element span, own-field digest) and its rows (the
 * values a conflict shows and the labels the panel posts). The planner decides per
 * node; the composer turns those decisions into text spans over ours.
 *
 * Pure: no `vscode`, no DOM. The host supplies the documents and writes the result.
 */
import type { EcucRow } from '../ecuc/renderRows';

/** One node of the engine's merge index. */
export interface MergeNode {
	id: string;
	kind: string;
	path: string;
	parentId: string | null;
	order: number;
	range: { start: number; end: number };
	/** Hash of the node's own fields, never its children. */
	ownDigest: string;
}

/** One side of the merge: the source text plus what the engine parsed from it. */
export interface MergeDoc {
	uri: string;
	text: string;
	nodes: readonly MergeNode[];
	rows: readonly EcucRow[];
}

export interface MergeInput {
	base: MergeDoc;
	ours: MergeDoc;
	theirs: MergeDoc;
}

export type MergeSide = 'ours' | 'theirs';

/** Why a node could not be merged automatically. */
export type MergeConflictReason = 'both-changed' | 'delete-modify' | 'add-add';

/** The value a conflict shows for one side. */
export interface MergeValue {
	label: string;
	value: string;
}

export interface MergeConflict {
	/** Stable id used by the panel to post a resolution. */
	id: string;
	kind: string;
	/** The AR path, for the message and the jump. */
	path: string;
	reason: MergeConflictReason;
	base?: MergeValue;
	ours?: MergeValue;
	theirs?: MergeValue;
	resolution?: MergeSide;
	/** Index into `MergePlan.decisions`. */
	decision: number;
}

/** Where a merged node's bytes come from. */
export type MergeSource = 'ours' | 'theirs' | 'none';

export interface MergeDecision {
	/** Ours' id when ours has the node, else the base or theirs id. */
	id: string;
	kind: string;
	path: string;
	parentId: string | null;
	source: MergeSource;
	oursId?: string;
	theirsId?: string;
	baseId?: string;
	/** Insertion anchor: the ours node this insertion follows. */
	afterId?: string;
	/** Insertion anchor: the ours node this insertion precedes (no `afterId`). */
	beforeId?: string;
	conflict?: MergeConflict;
}

export interface MergePlan {
	decisions: MergeDecision[];
	conflicts: MergeConflict[];
	/** Post-merge problems such as two containers ending with one short name. */
	problems: string[];
	/** Conflicts with no resolution yet. Writing is refused while this is non-zero. */
	unresolved: number;
}

/** The value a row shows, for conflict display. */
export function rowValue(row: EcucRow | undefined): MergeValue | undefined {
	if (row === undefined) {
		return undefined;
	}
	const value = row.shownValue ?? row.value ?? row.target ?? '';
	return { label: row.label, value };
}
