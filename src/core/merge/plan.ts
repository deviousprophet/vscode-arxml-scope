/**
 * The three-way merge planner.
 *
 * Pairing reuses the semantic matcher (`buildDiffDocument`) twice: base↔ours and
 * base↔theirs. The planner then applies one decision per ECUC node, recursing into
 * containers so two sides editing different children of one container both merge.
 *
 * The decision matrix, in order:
 *
 *   theirs unchanged          → keep ours
 *   ours unchanged            → take theirs (whole element)
 *   both changed, leaf        → conflict unless the new bytes are identical
 *   both changed, container   → recurse when neither changed its own fields
 *   a side changed own fields → conflict (field change + other side's children)
 *   deleted vs unchanged      → the delete wins
 *   deleted vs changed        → delete/modify conflict
 *   added on both sides       → conflict only when the ids match and bytes differ
 *
 * Pure: no `vscode`, no DOM, no I/O.
 */
import { buildDiffDocument } from '../diff/diffModel';
import type { EcucRow } from '../ecuc/renderRows';
import {
	rowValue,
	type MergeConflict,
	type MergeConflictReason,
	type MergeDecision,
	type MergeDoc,
	type MergeInput,
	type MergeNode,
	type MergePlan,
	type MergeSide
} from './model';

interface Pairing {
	/** base id → other id, from the diff's matched rows. */
	toOther: Map<string, string>;
	/** other id → base id. */
	toBase: Map<string, string>;
}

interface Context {
	input: MergeInput;
	base: Map<string, MergeNode>;
	ours: Map<string, MergeNode>;
	theirs: Map<string, MergeNode>;
	baseKids: Map<string, MergeNode[]>;
	oursKids: Map<string, MergeNode[]>;
	theirsKids: Map<string, MergeNode[]>;
	baseRows: Map<string, EcucRow>;
	oursRows: Map<string, EcucRow>;
	theirsRows: Map<string, EcucRow>;
	toOurs: Map<string, string>;
	toTheirs: Map<string, string>;
	oursToBase: Map<string, string>;
	theirsToBase: Map<string, string>;
	changedOurs: Map<string, boolean>;
	changedTheirs: Map<string, boolean>;
	decisions: MergeDecision[];
	conflicts: MergeConflict[];
}

const ROOT = '';

function byId(nodes: readonly MergeNode[]): Map<string, MergeNode> {
	return new Map(nodes.map((node) => [node.id, node]));
}

function childrenOf(nodes: readonly MergeNode[]): Map<string, MergeNode[]> {
	const map = new Map<string, MergeNode[]>();
	for (const node of [...nodes].sort((left, right) => left.order - right.order)) {
		const key = node.parentId ?? ROOT;
		map.set(key, [...(map.get(key) ?? []), node]);
	}
	return map;
}

function rowsById(rows: readonly EcucRow[]): Map<string, EcucRow> {
	return new Map(rows.map((row) => [row.id, row]));
}

/** id lookup by element range, built once: the diff walks every row. */
function rangesById(nodes: readonly MergeNode[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const node of nodes) {
		map.set(`${node.range.start}:${node.range.end}`, node.id);
	}
	return map;
}

/** The id → element range lookup the diff needs to name each cell's source span. */
function rangeLookup(doc: MergeDoc): (id: string) => { start: number; end: number } | undefined {
	const ranges = new Map(doc.nodes.map((node) => [node.id, node.range]));
	return (id: string) => ranges.get(id);
}

/** base↔other pairing through the semantic diff, keyed by element range. */
function pair(base: MergeDoc, other: MergeDoc, baseIsLeft: boolean): Pairing {
	const diff = buildDiffDocument(
		{ name: base.uri, path: base.uri },
		{ name: other.uri, path: other.uri },
		base.rows,
		other.rows,
		rangeLookup(base),
		rangeLookup(other),
		undefined,
		{ semanticMatching: true }
	);
	const toOther = new Map<string, string>();
	const toBase = new Map<string, string>();
	const baseIds = rangesById(base.nodes);
	const otherIds = rangesById(other.nodes);
	for (const row of diff.rows) {
		if (row.left === undefined || row.right === undefined) {
			continue;
		}
		const baseId = baseIds.get(`${row.left.range.start}:${row.left.range.end}`);
		const otherId = otherIds.get(`${row.right.range.start}:${row.right.range.end}`);
		if (baseId === undefined || otherId === undefined) {
			continue;
		}
		toOther.set(baseIsLeft ? baseId : otherId, baseIsLeft ? otherId : baseId);
		toBase.set(baseIsLeft ? otherId : baseId, baseIsLeft ? baseId : otherId);
	}
	return { toOther, toBase };
}

function invert(map: Map<string, string>): Map<string, string> {
	return new Map([...map].map(([left, right]) => [right, left]));
}

function isContainer(kind: string): boolean {
	return kind === 'container' || kind === 'module';
}

function kidsOf(context: Context, side: 'base' | 'ours' | 'theirs', parentId: string | null): MergeNode[] {
	const map = side === 'base' ? context.baseKids : side === 'ours' ? context.oursKids : context.theirsKids;
	return map.get(parentId ?? ROOT) ?? [];
}

function nodeOf(context: Context, side: 'base' | 'ours' | 'theirs', id: string | undefined): MergeNode | undefined {
	if (id === undefined) {
		return undefined;
	}
	const map = side === 'base' ? context.base : side === 'ours' ? context.ours : context.theirs;
	return map.get(id);
}

function pairingFor(
	context: Context,
	side: 'ours' | 'theirs'
): { toOther: Map<string, string>; toBase: Map<string, string> } {
	return side === 'ours'
		? { toOther: context.toOurs, toBase: context.oursToBase }
		: { toOther: context.toTheirs, toBase: context.theirsToBase };
}

/**
 * True when the side added or dropped a child of the base node. Own digests cannot
 * see an addition, and a missing decision here would make a whole container look
 * unchanged.
 */
function childrenDiffer(
	context: Context,
	side: 'ours' | 'theirs',
	baseId: string,
	otherId: string
): boolean {
	const pairing = pairingFor(context, side);
	const added = kidsOf(context, side, otherId).some((child) => !pairing.toBase.has(child.id));
	const removed = kidsOf(context, 'base', baseId).some((child) => !pairing.toOther.has(child.id));
	return added || removed;
}

/** True when the base subtree differs on this side: own fields, a child, or a delete. */
function changedOn(context: Context, side: 'ours' | 'theirs', baseId: string, seen: Set<string>): boolean {
	const cache = side === 'ours' ? context.changedOurs : context.changedTheirs;
	const cached = cache.get(baseId);
	if (cached !== undefined) {
		return cached;
	}
	const baseNode = context.base.get(baseId);
	const otherId = (side === 'ours' ? context.toOurs : context.toTheirs).get(baseId);
	if (baseNode === undefined) {
		return false;
	}
	if (otherId === undefined) {
		cache.set(baseId, true);
		return true;
	}
	if (seen.has(baseId)) {
		return false;
	}
	seen.add(baseId);
	const otherNode = nodeOf(context, side, otherId);
	const ownChanged = otherNode === undefined || otherNode.ownDigest !== baseNode.ownDigest;
	const childChanged = kidsOf(context, 'base', baseId).some((child) => changedOn(context, side, child.id, seen));
	const addedOrRemoved = otherId !== undefined && childrenDiffer(context, side, baseId, otherId);
	const changed = ownChanged || addedOrRemoved || childChanged;
	cache.set(baseId, changed);
	return changed;
}

function oursChanged(context: Context, baseId: string): boolean {
	return changedOn(context, 'ours', baseId, new Set());
}

function theirsChanged(context: Context, baseId: string): boolean {
	return changedOn(context, 'theirs', baseId, new Set());
}

function conflictValue(context: Context, side: 'base' | 'ours' | 'theirs', id: string | undefined) {
	const rows = side === 'base' ? context.baseRows : side === 'ours' ? context.oursRows : context.theirsRows;
	return id === undefined ? undefined : rowValue(rows.get(id));
}

/** Pushes a decision and, when it is a conflict, its conflict record. */
function pushDecision(
	context: Context,
	decision: MergeDecision,
	reason?: MergeConflictReason
): MergeConflict | undefined {
	const index = context.decisions.length;
	context.decisions.push(decision);
	if (reason === undefined) {
		return undefined;
	}
	const conflict: MergeConflict = {
		id: decision.id,
		kind: decision.kind,
		path: decision.path,
		reason,
		base: conflictValue(context, 'base', decision.baseId),
		ours: conflictValue(context, 'ours', decision.oursId),
		theirs: conflictValue(context, 'theirs', decision.theirsId),
		decision: index
	};
	decision.conflict = conflict;
	context.conflicts.push(conflict);
	return conflict;
}

function keepOurs(context: Context, oursNode: MergeNode, baseId?: string, theirsId?: string): void {
	pushDecision(context, {
		id: oursNode.id,
		kind: oursNode.kind,
		path: oursNode.path,
		parentId: oursNode.parentId,
		source: 'ours',
		oursId: oursNode.id,
		baseId,
		theirsId
	});
}

function takeTheirs(context: Context, oursNode: MergeNode, theirsNode: MergeNode, baseId?: string): void {
	pushDecision(context, {
		id: oursNode.id,
		kind: oursNode.kind,
		path: oursNode.path,
		parentId: oursNode.parentId,
		source: 'theirs',
		oursId: oursNode.id,
		theirsId: theirsNode.id,
		baseId
	});
}

function dropOurs(context: Context, oursNode: MergeNode, baseId?: string): void {
	pushDecision(context, {
		id: oursNode.id,
		kind: oursNode.kind,
		path: oursNode.path,
		parentId: oursNode.parentId,
		source: 'none',
		oursId: oursNode.id,
		baseId
	});
}

function sameChange(context: Context, oursNode: MergeNode, theirsNode: MergeNode): boolean {
	return oursNode.ownDigest === theirsNode.ownDigest;
}

/**
 * A container both sides changed: recurse when neither changed its own fields, or
 * when both changed them to the same bytes. Anything else cannot be combined
 * without splicing individual fields, so it is a conflict.
 */
function mergeChangedContainer(
	context: Context,
	oursNode: MergeNode,
	theirsNode: MergeNode,
	baseNode: MergeNode,
	baseId: string,
	theirsId: string
): void {
	const ownOurs = oursNode.ownDigest !== baseNode.ownDigest;
	const ownTheirs = theirsNode.ownDigest !== baseNode.ownDigest;
	const sameOwn = sameChange(context, oursNode, theirsNode);
	if (ownOurs && ownTheirs && sameOwn) {
		walkChildren(context, baseId, oursNode.id);
		return;
	}
	if (ownOurs || ownTheirs) {
		pushDecision(context, keepDecision(context, oursNode, baseId, theirsId), 'both-changed');
		return;
	}
	walkChildren(context, baseId, oursNode.id);
}

function keepDecision(context: Context, oursNode: MergeNode, baseId?: string, theirsId?: string): MergeDecision {
	return {
		id: oursNode.id,
		kind: oursNode.kind,
		path: oursNode.path,
		parentId: oursNode.parentId,
		source: 'ours',
		oursId: oursNode.id,
		baseId,
		theirsId
	};
}

/** A base node that ours still has. */
function mergePairedChild(
	context: Context,
	oursNode: MergeNode,
	baseId: string,
	consumed: Set<string>
): void {
	const baseNode = context.base.get(baseId);
	const theirsId = context.toTheirs.get(baseId);
	if (baseNode === undefined) {
		return;
	}
	if (theirsId === undefined) {
		mergeTheirsDeleted(context, oursNode, baseNode, baseId);
		return;
	}
	consumed.add(theirsId);
	const theirsNode = context.theirs.get(theirsId);
	if (theirsNode === undefined) {
		return;
	}
	mergePairedNode(context, oursNode, theirsNode, baseNode, baseId, theirsId);
}

function mergeTheirsDeleted(
	context: Context,
	oursNode: MergeNode,
	baseNode: MergeNode,
	baseId: string
): void {
	if (oursChanged(context, baseId)) {
		pushDecision(context, keepDecision(context, oursNode, baseId), 'delete-modify');
		return;
	}
	dropOurs(context, oursNode, baseId);
	void baseNode;
}

function mergePairedNode(
	context: Context,
	oursNode: MergeNode,
	theirsNode: MergeNode,
	_baseNode: MergeNode,
	baseId: string,
	theirsId: string
): void {
	const oursMoved = oursChanged(context, baseId);
	const theirsMoved = theirsChanged(context, baseId);
	if (!theirsMoved) {
		keepOurs(context, oursNode, baseId, theirsId);
		return;
	}
	if (!oursMoved) {
		takeTheirs(context, oursNode, theirsNode, baseId);
		return;
	}
	if (isContainer(oursNode.kind)) {
		mergeChangedContainer(context, oursNode, theirsNode, _baseNode, baseId, theirsId);
		return;
	}
	if (sameChange(context, oursNode, theirsNode)) {
		keepOurs(context, oursNode, baseId, theirsId);
		return;
	}
	pushDecision(context, keepDecision(context, oursNode, baseId, theirsId), 'both-changed');
}

/** A base node ours deleted: a theirs change makes it a delete/modify conflict. */
function mergeDeletedInOurs(
	context: Context,
	baseNode: MergeNode,
	baseKids: readonly MergeNode[],
	oursKids: readonly MergeNode[]
): void {
	const theirsId = context.toTheirs.get(baseNode.id);
	if (theirsId === undefined || !theirsChanged(context, baseNode.id)) {
		return;
	}
	const parentId = baseNode.parentId === null ? null : context.toOurs.get(baseNode.parentId) ?? null;
	pushDecision(
		context,
		{
			id: baseNode.id,
			kind: baseNode.kind,
			path: baseNode.path,
			parentId,
			source: 'none',
			baseId: baseNode.id,
			theirsId,
			...anchorForBase(context, baseKids, baseNode, oursKids)
		},
		'delete-modify'
	);
}

/** The insertion anchor for a base-only node, in ours' sibling ids. */
function anchorForBase(
	context: Context,
	baseKids: readonly MergeNode[],
	node: MergeNode,
	oursKids: readonly MergeNode[]
): { afterId?: string; beforeId?: string } {
	const at = baseKids.indexOf(node);
	for (let index = at - 1; index >= 0; index--) {
		const oursId = context.toOurs.get(baseKids[index].id);
		if (oursId !== undefined && oursKids.some((ours) => ours.id === oursId)) {
			return { afterId: oursId };
		}
	}
	const first = oursKids[0];
	return first === undefined ? {} : { beforeId: first.id };
}

function sameNode(left: MergeNode, right: MergeNode | undefined): boolean {
	return right !== undefined && left.id === right.id && left.ownDigest === right.ownDigest;
}

/** Two subtrees are identical when every child, in order, matches and recurses. */
function sameSubtree(context: Context, oursId: string, theirsId: string): boolean {
	const oursKids = kidsOf(context, 'ours', oursId);
	const theirsKids = kidsOf(context, 'theirs', theirsId);
	return oursKids.length === theirsKids.length && oursKids.every((child, index) => {
		const other = theirsKids[index];
		return sameNode(child, other) && sameSubtree(context, child.id, other.id);
	});
}

/** A node ours added: an addition of the same id on theirs is a conflict when it differs. */
function mergeOursAdded(
	context: Context,
	oursNode: MergeNode,
	theirsKids: readonly MergeNode[],
	consumed: Set<string>
): void {
	const same = theirsKids.find((node) => node.id === oursNode.id && !consumed.has(node.id));
	if (same === undefined) {
		keepOurs(context, oursNode);
		return;
	}
	consumed.add(same.id);
	if (same.ownDigest === oursNode.ownDigest && sameSubtree(context, oursNode.id, same.id)) {
		keepOurs(context, oursNode, undefined, same.id);
		return;
	}
	pushDecision(
		context,
		{ ...keepDecision(context, oursNode, undefined, same.id), theirsId: same.id },
		'add-add'
	);
}

function anchorFor(
	context: Context,
	theirsKids: readonly MergeNode[],
	node: MergeNode,
	oursKids: readonly MergeNode[]
): { afterId?: string; beforeId?: string } {
	const at = theirsKids.indexOf(node);
	for (let index = at - 1; index >= 0; index--) {
		const sibling = theirsKids[index];
		const baseId = context.theirsToBase.get(sibling.id);
		const oursId = baseId === undefined ? sibling.id : context.toOurs.get(baseId);
		if (oursId !== undefined && oursKids.some((ours) => ours.id === oursId)) {
			return { afterId: oursId };
		}
	}
	const first = oursKids[0];
	return first === undefined ? {} : { beforeId: first.id };
}

/** A node only theirs has, under a parent that exists in ours. */
function insertTheirs(
	context: Context,
	theirsNode: MergeNode,
	theirsKids: readonly MergeNode[],
	oursKids: readonly MergeNode[],
	parentOursId: string | null
): void {
	const anchors = anchorFor(context, theirsKids, theirsNode, oursKids);
	pushDecision(context, {
		id: theirsNode.id,
		kind: theirsNode.kind,
		path: theirsNode.path,
		parentId: parentOursId,
		source: 'theirs',
		theirsId: theirsNode.id,
		...anchors
	});
}

function walkChildren(context: Context, parentBaseId: string | null, parentOursId: string | null): void {
	const baseKids = kidsOf(context, 'base', parentBaseId);
	const oursKids = kidsOf(context, 'ours', parentOursId);
	const theirsKids = kidsOf(context, 'theirs', parentBaseId === null ? null : context.toTheirs.get(parentBaseId) ?? null);
	const consumed = new Set<string>();
	const handled = new Set<string>();

	for (const oursNode of oursKids) {
		const baseId = context.oursToBase.get(oursNode.id);
		if (baseId === undefined) {
			mergeOursAdded(context, oursNode, theirsKids, consumed);
			continue;
		}
		handled.add(baseId);
		mergePairedChild(context, oursNode, baseId, consumed);
	}

	for (const baseNode of baseKids) {
		if (!handled.has(baseNode.id)) {
			mergeDeletedInOurs(context, baseNode, baseKids, oursKids);
		}
	}

	for (const theirsNode of theirsKids) {
		if (consumed.has(theirsNode.id) || context.theirsToBase.has(theirsNode.id)) {
			continue;
		}
		insertTheirs(context, theirsNode, theirsKids, oursKids, parentOursId);
	}
}

function postMergeProblems(context: Context): string[] {
	const groups = new Map<string, number>();
	for (const decision of context.decisions) {
		if (decision.kind !== 'container') {
			continue;
		}
		const row =
			decision.source === 'theirs'
				? context.theirsRows.get(decision.theirsId ?? '')
				: context.oursRows.get(decision.id);
		const name = row?.shortName;
		if (name === undefined) {
			continue;
		}
		const key = `${decision.parentId ?? ROOT}/${name}`;
		groups.set(key, (groups.get(key) ?? 0) + 1);
	}
	const problems: string[] = [];
	for (const [key, count] of groups) {
		if (count > 1) {
			problems.push(`${key.slice(key.indexOf('/') + 1)} is duplicated ${count} times in the merged result`);
		}
	}
	return problems;
}

function buildContext(input: MergeInput): Context {
	const pairingOurs = pair(input.base, input.ours, true);
	const pairingTheirs = pair(input.base, input.theirs, true);
	return {
		input,
		base: byId(input.base.nodes),
		ours: byId(input.ours.nodes),
		theirs: byId(input.theirs.nodes),
		baseKids: childrenOf(input.base.nodes),
		oursKids: childrenOf(input.ours.nodes),
		theirsKids: childrenOf(input.theirs.nodes),
		baseRows: rowsById(input.base.rows),
		oursRows: rowsById(input.ours.rows),
		theirsRows: rowsById(input.theirs.rows),
		toOurs: pairingOurs.toOther,
		toTheirs: pairingTheirs.toOther,
		oursToBase: pairingOurs.toBase,
		theirsToBase: pairingTheirs.toBase,
		changedOurs: new Map(),
		changedTheirs: new Map(),
		decisions: [],
		conflicts: []
	};
}

/** Applies one resolution to the plan, returning the new unresolved count. */
export function applyResolution(plan: MergePlan, conflictId: string, side: MergeSide): number {
	const conflict = plan.conflicts.find((candidate) => candidate.id === conflictId);
	if (conflict === undefined) {
		return plan.unresolved;
	}
	const decision = plan.decisions[conflict.decision];
	resolveDecision(decision, conflict, side);
	const unresolved = plan.conflicts.filter((candidate) => candidate.resolution === undefined).length;
	plan.unresolved = unresolved;
	return unresolved;
}

function resolveDecision(decision: MergeDecision, conflict: MergeConflict, side: MergeSide): void {
	conflict.resolution = side;
	if (decision.oursId === undefined) {
		decision.source = side === 'theirs' ? 'theirs' : 'none';
		return;
	}
	if (decision.theirsId === undefined) {
		decision.source = side === 'ours' ? 'ours' : 'none';
		return;
	}
	decision.source = side;
}

/** Plans a three-way merge. */
export function planMerge(input: MergeInput): MergePlan {
	const context = buildContext(input);
	walkChildren(context, null, null);
	const plan: MergePlan = {
		decisions: context.decisions,
		conflicts: context.conflicts,
		problems: postMergeProblems(context),
		unresolved: context.conflicts.length
	};
	return plan;
}

/** Sets every conflict to one side; returns the plan for chaining. */
export function resolveAll(plan: MergePlan, side: MergeSide): MergePlan {
	for (const conflict of plan.conflicts) {
		applyResolution(plan, conflict.id, side);
	}
	return plan;
}

