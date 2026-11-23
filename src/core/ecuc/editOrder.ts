/**
 * Host-write order and rename bookkeeping for the ECUC draft.
 *
 * A short-name write changes the path-based node id, and a child container id
 * embeds its parent's short name. Flushing values first and renames deepest
 * first keeps every edit addressed at an id the host still knows. The renamed
 * id itself always comes from the host's acknowledgement; the page only reuses
 * the pair to move drafts that were addressed below the old container.
 */

/** The fields a draft may target; absent means the parameter's `<VALUE>`. */
export type EditField = 'value' | 'shortName' | 'definitionRef';

export interface FlushCandidate {
	nodeId: string;
	field?: EditField;
}

/**
 * Compare two pending edits for one flush.
 *
 * `levelOf` is the row's 1-based tree level, or undefined once the row is gone.
 * Equal keys keep their insertion order because `Array.prototype.sort` is
 * stable; the comparator never returns a non-zero value for two values or two
 * equally deep short names.
 */
export function compareEditFlushOrder(
	left: FlushCandidate,
	right: FlushCandidate,
	levelOf: (nodeId: string) => number | undefined
): number {
	const leftShort = shortNameRank(left);
	const rightShort = shortNameRank(right);
	if (leftShort !== rightShort) {
		return leftShort - rightShort;
	}
	if (!isShortNameEdit(left)) {
		return 0;
	}
	return deepestFirst(levelOf, left.nodeId, right.nodeId);
}

function isShortNameEdit(candidate: FlushCandidate): boolean {
	return candidate.field === 'shortName';
}

function shortNameRank(candidate: FlushCandidate): number {
	return isShortNameEdit(candidate) ? 1 : 0;
}

function deepestFirst(
	levelOf: (nodeId: string) => number | undefined,
	leftId: string,
	rightId: string
): number {
	return (levelOf(rightId) ?? 0) - (levelOf(leftId) ?? 0);
}

/**
 * `nodeId` after the container `oldId` was renamed to the host-provided `newId`.
 *
 * Covers the renamed container itself (`oldId`), its parameters and references
 * (`<oldId>/param:…`), and a nested container's subtree: a child container id
 * embeds the parent *path* (the parent id without its declaration ordinal), so
 * the same pair is applied to that path prefix. The new id always comes from the
 * host pair, so nothing here predicts what the re-scan will assign.
 */
export function remapNodeId(nodeId: string, oldId: string, newId: string): string | undefined {
	if (nodeId === oldId) {
		return newId;
	}
	if (nodeId.startsWith(`${oldId}/`)) {
		return `${newId}${nodeId.slice(oldId.length)}`;
	}
	return remapThroughPath(nodeId, oldId, newId);
}

/** Apply the parent pair to an id built from the declaration-less path prefix. */
function remapThroughPath(nodeId: string, oldId: string, newId: string): string | undefined {
	const oldPath = oldId.replace(/#\d+$/, '');
	if (oldPath === oldId) {
		return undefined;
	}
	if (!nodeId.startsWith(`${oldPath}/`)) {
		return undefined;
	}
	const newPath = newId.replace(/#\d+$/, '');
	return `${newPath}${nodeId.slice(oldPath.length)}`;
}

/** One short-name write the page flushed and the host has not answered yet. */
export interface RenameIntent {
	/** The edit id of the flushed write; refusals clear the intent by this id. */
	editId: number;
	/** The pre-rename path id the write was addressed at. */
	nodeId: string;
	/** The final short name sent to the host. */
	shortName: string;
	/** The host's predicted id for the renamed container, once `editResult` carries it. */
	nextNodeId?: string;
}

/** One container whose pre-rename id the latest row store no longer contains. */
export interface RenameResolution {
	oldId: string;
	newId: string;
}

/** How the latest row store resolves the outstanding rename intents. */
export interface RenamePlan {
	/** Intents proved by the host pair and a renamed container in the row store. */
	resolved: RenameResolution[];
	/** Intents whose old row is still present or whose host pair is not known yet. */
	kept: RenameIntent[];
	/** Intents whose old row is gone and whose host-provided row does not exist. */
	dropped: number[];
}

/**
 * Resolve outstanding rename intents against one row store.
 *
 * A rename intent survives `editResult` (which may arrive before the re-scan)
 * and is proved when the host supplied `nextNodeId`, its old row disappears and
 * a container with that id and the edited short name appears. Resolution runs to
 * a fixed point so a child rename can compose with an already-proved parent
 * rename before its own candidate is looked up. Intents without a host pair or
 * whose old row is still present stay unresolved; intents whose old row is gone
 * and whose host-provided row cannot be found are dropped.
 */
export function resolveRenameIntents(
	intents: readonly RenameIntent[],
	rowOf: RowLookup
): RenamePlan {
	const { resolved, unresolved, remaining } = partitionIntents(intents, rowOf);
	resolveToFixedPoint(unresolved, resolved, rowOf);
	// Deepest id first: a child draft must move to its official new id (which
	// already contains the new parent path) before the parent prefix rewrite runs.
	resolved.sort((left, right) => right.oldId.length - left.oldId.length);
	return { resolved, kept: remaining, dropped: unresolved.map((intent) => intent.editId) };
}

type RowLookup = (id: string) => { kind: string; shortName?: string } | undefined;

interface IntentPartition {
	resolved: RenameResolution[];
	unresolved: RenameIntent[];
	remaining: RenameIntent[];
}

function partitionIntents(intents: readonly RenameIntent[], rowOf: RowLookup): IntentPartition {
	const resolved: RenameResolution[] = [];
	const unresolved: RenameIntent[] = [];
	const remaining: RenameIntent[] = [];
	for (const intent of intents) {
		if (isUnproved(intent, rowOf)) {
			remaining.push(intent);
			continue;
		}
		unresolved.push(intent);
	}
	return { resolved, unresolved, remaining };
}

/** An intent without a host pair, or whose old row is still present. */
function isUnproved(intent: RenameIntent, rowOf: RowLookup): boolean {
	return intent.nextNodeId === undefined || rowOf(intent.nodeId) !== undefined;
}

function resolveToFixedPoint(unresolved: RenameIntent[], resolved: RenameResolution[], rowOf: RowLookup): void {
	let progress = true;
	while (progress) {
		progress = false;
		for (let at = unresolved.length - 1; at >= 0; at -= 1) {
			if (!resolveAt(unresolved, at, resolved, rowOf)) {
				continue;
			}
			progress = true;
		}
	}
}

/** Prove one intent against the row store; true when it moved to `resolved`. */
function resolveAt(unresolved: RenameIntent[], at: number, resolved: RenameResolution[], rowOf: RowLookup): boolean {
	const intent = unresolved[at];
	const newId = remapThroughResolved(intent.nextNodeId, resolved);
	if (!isProvedRename(newId, intent.shortName, rowOf)) {
		return false;
	}
	resolved.push({ oldId: intent.nodeId, newId });
	unresolved.splice(at, 1);
	return true;
}

function remapThroughResolved(newId: string | undefined, resolved: readonly RenameResolution[]): string | undefined {
	let current = newId;
	for (const pair of resolved) {
		if (current === undefined) {
			return undefined;
		}
		current = remapNodeId(current, pair.oldId, pair.newId) ?? current;
	}
	return current;
}

function isProvedRename(newId: string | undefined, shortName: string, rowOf: RowLookup): newId is string {
	if (newId === undefined) {
		return false;
	}
	const row = rowOf(newId);
	if (row === undefined) {
		return false;
	}
	if (row.kind !== 'container') {
		return false;
	}
	return row.shortName === shortName;
}

/** One draft the page holds for a field, keyed by {@link draftKey}. */
export interface DraftEntry {
	nodeId: string;
	field?: EditField;
}

/** The one key a draft map uses: the node id and the field. */
export function draftKey(nodeId: string, field: EditField | undefined): string {
	return `${nodeId}|${field ?? ''}`;
}

/** Apply one proved host pair to a draft entry's node id, or `undefined` when it is outside. */
export function remapDraftNodeId<T extends DraftEntry>(
	entry: T,
	oldId: string,
	newId: string
): T | undefined {
	const nodeId = remapNodeId(entry.nodeId, oldId, newId);
	return nodeId === undefined ? undefined : { ...entry, nodeId };
}

/**
 * Re-key every draft addressed at a renamed container or its subtree.
 *
 * `drafts` is a field-keyed map (pending or invalid); the entries keep their
 * payload and move to the host-provided id. An in-flight map is keyed by edit
 * id instead, so its callers store {@link remapDraftNodeId} under the same key.
 * Returns the moved entries in iteration order.
 */
export function remapDraftMap<T extends DraftEntry>(
	drafts: Map<string, T>,
	oldId: string,
	newId: string
): T[] {
	const moved: T[] = [];
	for (const [key, entry] of Array.from(drafts)) {
		const next = remapDraftNodeId(entry, oldId, newId);
		if (next === undefined) {
			continue;
		}
		drafts.delete(key);
		drafts.set(draftKey(next.nodeId, next.field), next);
		moved.push(next);
	}
	return moved;
}
