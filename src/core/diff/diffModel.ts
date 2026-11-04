/**
 * The semantic diff model (task design §2).
 *
 * Both sides are ordinary `EcucRow` lists built by `buildRows` with a fixed
 * `sort: 'all'` order, so declaration order, formatting and comments cannot
 * produce a difference. Same-named sibling groups pair by exact content first, then
 * by the looser sort identity, then by exact id, then by an ordinal-free base key,
 * so a declaration swap is not a change. Every page key is unique even when that
 * pairing shifts an ordinal. The merged list is pre-order with children contiguous,
 * exactly like the editor's row document, so the page can reuse the virtual-scroll
 * and collapse rules.
 *
 * Pure: no `vscode` import and no DOM. The page helpers at the end
 * The pure helpers (`diffVisibility`, `flattenDiffRows`, `nextChangeIndex`) are
 * imported by the bundled diff page and unit-tested directly.
 */
import { Range } from '../ecuc/model';
import { EcucRow, MetaPart } from '../ecuc/renderRows';

/** The displayed subset of one row, projected once per side. */
export interface DiffCell {
	kind: EcucRow['kind'];
	label: string;
	shortName?: string;
	definitionRef: string;
	definitionDest?: string;
	shownValue?: string;
	valueKind?: EcucRow['valueKind'];
	value?: string;
	target?: string;
	contextPaths?: string[];
	/** Annotation lines shown above this row in the Document view. */
	comments?: string[];
	meta: MetaPart[];
	range: Range;
}

export type DiffStatus = 'unchanged' | 'changed' | 'added' | 'removed';

/** One compared field whose left and right text differ. */
export interface DiffChange {
	/** Human label: value, target, short name, definition ref, variant, condition, context. */
	field: string;
	left: string;
	right: string;
	/** True when the difference is fully explained by the learned rename substitution. */
	renameImplied?: boolean;
}

/** Why a semantic pair was accepted. */
export interface DiffMatch {
	kind: 'identity' | 'semantic';
	score: number;
	reasons: { children: number; name: number; position: number; substitution: number };
	/** Learned token changes used by this pair, e.g. `NMH→NM`. */
	substitutions?: string[];
}

export interface DiffRow {
	/** Unique in the merged list; the page treats it as opaque. */
	key: string;
	parentKey: string | null;
	level: number;
	/** 1-based position among siblings, for the tree's `aria-posinset`. */
	posinset: number;
	/** Number of siblings including this row, for `aria-setsize`. */
	setsize: number;
	kind: DiffCell['kind'];
	hasChildren: boolean;
	/** Recomputed over the merged tree. */
	subtreeSize: number;
	status: DiffStatus;
	left?: DiffCell;
	right?: DiffCell;
	changes: DiffChange[];
	/** Present only on a row paired by the semantic pass. */
	match?: DiffMatch;
	/** Lower-cased label + short name + shown value from both sides. */
	haystack: string;
}

export interface DiffSummary {
	changed: number;
	added: number;
	removed: number;
	unchanged: number;
	/** Subset of `changed` rows produced by the semantic pass. */
	renamed: number;
}

export interface DiffOptions {
	/** Enable the semantic container-rename pass; default false preserves v0.6 output. */
	semanticMatching?: boolean;
}

/** A file label plus its path, the pair the title disambiguation needs. */
export interface FileLabel {
	name: string;
	path: string;
}

export interface DiffDocument {
	left: FileLabel;
	right: FileLabel;
	/** Schema/package lines shown above each pane's rows. */
	leftHeader: DiffHeader;
	rightHeader: DiffHeader;
	/**
	 * Pane headings in `[left, right]` order: the basename, or the shortest
	 * trailing path suffix when both files share one. The page and the Details
	 * strip both use it, so a side never means two different files on one screen.
	 */
	labels: [string, string];
	/** Pre-order, children contiguous. */
	rows: DiffRow[];
	summary: DiffSummary;
}

/** The small Document header repeated in each diff pane. */
export interface DiffHeader {
	schema?: string;
	packages: string[];
}

/** One node of a side's row tree, built from the pre-order list. */
interface TreeRow {
	row: EcucRow;
	children: TreeRow[];
}

/** One node of the merged output tree, before level/parent/subtree recomputation. */
interface MergedNode {
	key: string;
	kind: DiffCell['kind'];
	status: DiffStatus;
	left?: DiffCell;
	right?: DiffCell;
	changes: DiffChange[];
	match?: DiffMatch;
	children: MergedNode[];
}

/**
 * The ordinal-free key: the id with every `#<ordinal>` removed.
 *
 * A row's own ordinal is a trailing suffix. A parameter or reference id also
 * embeds its parent container's id, so a parent ordinal can appear in the middle
 * (`container:C#0/param:P#0`). When two duplicate containers were paired across
 * ordinals, their children differ only by that embedded ordinal; removing both
 * makes the group depend on the ECUC path, not on either side's declaration order.
 */
export function baseId(id: string): string {
	return id.replace(/#\d+(?=\/|$)/g, '');
}

/** The final child segment of an id, used inside a renamed parent. */
function relativeId(id: string): string {
	const at = id.lastIndexOf('/');
	return at < 0 ? id : id.slice(at + 1);
}

interface PairContext {
	relative: boolean;
	semantic: boolean;
	substitutions: Map<string, string>;
}

/** A row id to its source range; the row itself deliberately carries no position. */
export type RangeLookup = (id: string) => Range | undefined;

function rangeOf(lookup: RangeLookup | undefined, id: string): Range {
	const range = lookup ? lookup(id) : undefined;
	return range ? { start: range.start, end: range.end } : { start: 0, end: 0 };
}

/** Projects a display row to the fields both panes show and compare. */
export function toDiffCell(row: EcucRow, range?: Range): DiffCell {
	return {
		kind: row.kind,
		label: row.label,
		shortName: row.shortName,
		definitionRef: row.definitionRef,
		definitionDest: row.definitionDest,
		shownValue: row.shownValue,
		valueKind: row.valueKind,
		value: row.value,
		target: row.target,
		contextPaths: row.contextPaths ? row.contextPaths.slice() : undefined,
		comments: row.comments ? row.comments.slice() : undefined,
		meta: row.meta.map((part) => ({ cls: part.cls, text: part.text, title: part.title, ...(part.state ? { state: part.state } : {}) })),
		range: range ? { start: range.start, end: range.end } : { start: 0, end: 0 },
	};
}

function metaText(cell: DiffCell, cls: MetaPart['cls']): string {
	return cell.meta
		.filter((part) => part.cls === cls)
		.map((part) => part.text)
		.join('\n');
}

function contextText(cell: DiffCell): string {
	if (cell.contextPaths && cell.contextPaths.length > 0) {
		return cell.contextPaths.join(', ');
	}
	const part = cell.meta.find((candidate) => candidate.cls === 'context');
	if (!part) {
		return '';
	}
	return part.text.indexOf('context ') === 0 ? part.text.slice('context '.length) : part.text;
}

/**
 * Every compared field whose text differs, in the design's order. `label` is a
 * derivative and gets no separate entry. `shownValue` normally follows `value`, so it
 * is only reported when the raw values match but the display (quoted/bare) does not.
 * `definitionDest` is a separate attribute, so it is compared (PRD R6). Annotation
 * meta is deliberately ignored, so a comment-only change is not a configuration
 * change.
 */
export function diffChanges(left: DiffCell, right: DiffCell): DiffChange[] {
	const changes: DiffChange[] = [];
	if ((left.value ?? '') !== (right.value ?? '')) {
		changes.push({ field: 'value', left: left.value ?? '', right: right.value ?? '' });
	} else if ((left.shownValue ?? '') !== (right.shownValue ?? '')) {
		// `shownValue` is derived from the value text and the element kind. They can
		// disagree while the raw value matches only for a mistyped tag, but showing the
		// quoted/bare difference is better than reporting the row unchanged.
		changes.push({ field: 'shown value', left: left.shownValue ?? '', right: right.shownValue ?? '' });
	}
	const comparisons: Array<[string, string, string]> = [
		['target', left.target ?? '', right.target ?? ''],
		['short name', left.shortName ?? '', right.shortName ?? ''],
		['definition ref', left.definitionRef, right.definitionRef],
		// `DEST` is a separate attribute, not part of the ref text: an integer parameter
		// retyped as boolean would otherwise compare as unchanged while the editor's
		// Type and format rows differ (PRD R6).
		['definition dest', left.definitionDest ?? '', right.definitionDest ?? ''],
		['variant', metaText(left, 'variant'), metaText(right, 'variant')],
		['condition', metaText(left, 'condition'), metaText(right, 'condition')],
		['context', contextText(left), contextText(right)],
	];
	for (const [field, leftText, rightText] of comparisons) {
		if (leftText !== rightText) {
			changes.push({ field, left: leftText, right: rightText });
		}
	}
	return changes;
}

/** Rebuilds the pre-order row list as a tree, using each row's `subtreeSize`. */
function treeOf(rows: readonly EcucRow[]): TreeRow[] {
	const build = (start: number, end: number): TreeRow[] => {
		const out: TreeRow[] = [];
		let index = start;
		while (index < end) {
			const row = rows[index];
			const stop = Math.min(end, index + 1 + Math.max(0, row.subtreeSize));
			out.push({ row, children: build(index + 1, stop) });
			// Defensive: a malformed subtreeSize must not stall the walk.
			index = stop > index ? stop : index + 1;
		}
		return out;
	};
	return build(0, rows.length);
}

/**
 * The content identity used first to pair same-named siblings when their ordinal
 * ids disagree because the declarations were reordered. It covers every compared
 * field, so two reordered duplicates that differ only in a condition (or DEST)
 * still pair with their identical counterpart instead of being reported changed.
 * Annotation meta is ignored for the same reason `diffChanges` ignores it.
 */
function contentIdentity(row: EcucRow): string {
	const cell = toDiffCell(row);
	return [
		cell.kind,
		cell.definitionRef,
		cell.definitionDest ?? '',
		cell.value ?? '',
		cell.target ?? '',
		contextText(cell),
		metaText(cell, 'variant'),
		metaText(cell, 'condition'),
	].join('\u0000');
}

/**
 * The content identity of a whole subtree: a duplicate container's own fields plus
 * its ordered descendants. Two same-named instances whose contents were reordered
 * therefore pair with their identical twin instead of being compared positionally.
 */
function subtreeIdentity(node: TreeRow): string {
	return node.children.length === 0
		? contentIdentity(node.row)
		: `${contentIdentity(node.row)}\u0001${node.children.map(subtreeIdentity).join('\u0002')}`;
}

/**
 * The looser identity used after exact content fails: the row's sort identity plus
 * variant and reference context. It pairs a duplicate whose value/condition changed
 * with its counterpart so the change is reported on one row, not as add + remove.
 */
function sortIdentity(row: EcucRow): string {
	if (row.kind === 'parameter') {
		return `value:${row.value ?? ''}`;
	}
	if (row.kind === 'reference') {
		return `target:${row.target ?? ''}|context:${(row.contextPaths ?? []).join(',')}`;
	}
	return `definition:${row.definitionRef}|variant:${row.meta
		.filter((part) => part.cls === 'variant')
		.map((part) => part.text)
		.join(',')}`;
}

function groupByBase(children: readonly TreeRow[], context: PairContext): Map<string, TreeRow[]> {
	const groups = new Map<string, TreeRow[]>();
	for (const child of children) {
		const id = context.relative ? relativeId(child.row.id) : child.row.id;
		const base = baseId(id);
		const list = groups.get(base);
		if (list) {
			list.push(child);
		} else {
			groups.set(base, [child]);
		}
	}
	return groups;
}

interface PairResult {
	matchOfRight: Map<TreeRow, TreeRow>;
	matches: Map<TreeRow, DiffMatch>;
}

/**
 * Pairs the children of one level.
 *
 * Same-named sibling groups are paired by content identity first, because their
 * ordinal ids are the same set on both sides and an exact-id pass would pair
 * `alpha#0` with the reordered `beta#0` and report a false change. Exact content
 * (every compared field) pairs a reordered pair even when both rows differ only in
 * a condition or DEST; the looser sort identity then pairs a duplicate whose value
 * changed so the change lands on one row. The remaining rows pair by exact id, then
 * by the ordinal-free base id when exactly one candidate remains on each side (the
 * design's fallback, widened to embedded parent ordinals). The optional semantic
 * pass then pairs leftover containers by parent, kind, DEFINITION-REF and score.
 */
function pairLevel(leftChildren: readonly TreeRow[], rightChildren: readonly TreeRow[], context: PairContext): PairResult {
	const matchOfRight = new Map<TreeRow, TreeRow>();
	const matches = new Map<TreeRow, DiffMatch>();
	const matchedLeft = new Set<TreeRow>();
	const tryPair = (right: TreeRow, left: TreeRow, match?: DiffMatch): boolean => {
		if (matchOfRight.has(right) || matchedLeft.has(left)) {
			return false;
		}
		matchOfRight.set(right, left);
		matchedLeft.add(left);
		if (match) {
			matches.set(left, match);
		}
		return true;
	};

	const leftByBase = groupByBase(leftChildren, context);
	const rightByBase = groupByBase(rightChildren, context);
	for (const [base, lefts] of leftByBase) {
		const rights = rightByBase.get(base);
		if (!rights || (lefts.length === 1 && rights.length === 1)) {
			continue;
		}
		const pairIdentity = (
			lefts: readonly TreeRow[],
			rights: readonly TreeRow[],
			keyOf: (node: TreeRow) => string
		): void => {
			const buckets = new Map<string, TreeRow[]>();
			for (const right of rights) {
				if (matchOfRight.has(right)) {
					continue;
				}
				const key = keyOf(right);
				const list = buckets.get(key);
				if (list) {
					list.push(right);
				} else {
					buckets.set(key, [right]);
				}
			}
			for (const left of lefts) {
				if (matchedLeft.has(left)) {
					continue;
				}
				const bucket = buckets.get(keyOf(left));
				if (!bucket) {
					continue;
				}
				while (bucket.length > 0) {
					if (tryPair(bucket.shift() as TreeRow, left)) {
						break;
					}
				}
			}
		};
		pairIdentity(lefts, rights, subtreeIdentity);
		pairIdentity(lefts, rights, (node) => sortIdentity(node.row));
	}

	const idOf = (row: TreeRow): string => (context.relative ? relativeId(row.row.id) : row.row.id);
	const rightById = new Map<string, TreeRow>();
	for (const right of rightChildren) {
		rightById.set(idOf(right), right);
	}
	for (const left of leftChildren) {
		if (matchedLeft.has(left)) {
			continue;
		}
		const right = rightById.get(idOf(left));
		if (right) {
			tryPair(right, left);
		}
	}

	const leftRestByBase = new Map<string, TreeRow[]>();
	for (const left of leftChildren) {
		if (matchedLeft.has(left)) {
			continue;
		}
		const base = baseId(idOf(left));
		const list = leftRestByBase.get(base);
		if (list) {
			list.push(left);
		} else {
			leftRestByBase.set(base, [left]);
		}
	}
	const rightRestByBase = new Map<string, TreeRow[]>();
	for (const right of rightChildren) {
		if (matchOfRight.has(right)) {
			continue;
		}
		const base = baseId(idOf(right));
		const list = rightRestByBase.get(base);
		if (list) {
			list.push(right);
		} else {
			rightRestByBase.set(base, [right]);
		}
	}
	for (const [base, lefts] of leftRestByBase) {
		const rights = rightRestByBase.get(base);
		if (lefts.length === 1 && rights && rights.length === 1) {
			tryPair(rights[0], lefts[0]);
		}
	}

	if (context.semantic) {
		semanticPass(leftChildren, rightChildren, context, tryPair, matchedLeft, matchOfRight);
	}
	return { matchOfRight, matches };
}

interface SemanticScore {
	score: number;
	reasons: DiffMatch['reasons'];
}

interface SemanticPair extends SemanticScore {
	left: TreeRow;
	right: TreeRow;
}

/** Pairs leftover containers with the same parent, kind and definition ref. */
function semanticPass(
	leftChildren: readonly TreeRow[],
	rightChildren: readonly TreeRow[],
	context: PairContext,
	tryPair: (right: TreeRow, left: TreeRow, match?: DiffMatch) => boolean,
	matchedLeft: ReadonlySet<TreeRow>,
	matchOfRight: ReadonlyMap<TreeRow, TreeRow>
): void {
	const lefts = leftChildren.filter((node) => !matchedLeft.has(node) && node.row.kind === 'container');
	const rights = rightChildren.filter((node) => !matchOfRight.has(node) && node.row.kind === 'container');
	if (lefts.length === 0 || rights.length === 0) {
		return;
	}
	const buckets = new Map<string, { lefts: TreeRow[]; rights: TreeRow[] }>();
	for (const left of lefts) {
		const key = left.row.definitionRef;
		const bucket = buckets.get(key) ?? { lefts: [], rights: [] };
		bucket.lefts.push(left);
		buckets.set(key, bucket);
	}
	for (const right of rights) {
		const key = right.row.definitionRef;
		const bucket = buckets.get(key) ?? { lefts: [], rights: [] };
		bucket.rights.push(right);
		buckets.set(key, bucket);
	}
	for (const bucket of buckets.values()) {
		if (bucket.lefts.length === 0 || bucket.rights.length === 0) {
			continue;
		}
		if (bucket.lefts.length * bucket.rights.length > 250_000) {
			continue;
		}
		const seeds = assignSemantic(bucket.lefts, bucket.rights, context);
		learnSubstitutions(seeds, context.substitutions);
		const final = assignSemantic(bucket.lefts, bucket.rights, context);
		for (const pair of final) {
			const used = substitutionsUsed(pair.left, pair.right, context.substitutions);
			tryPair(pair.right, pair.left, {
				kind: 'semantic',
				score: pair.score,
				reasons: pair.reasons,
				...(used.length === 0 ? {} : { substitutions: used }),
			});
		}
	}
}

/** Scores and greedily assigns one bucket. Near-ties stay unpaired. */
function assignSemantic(lefts: readonly TreeRow[], rights: readonly TreeRow[], context: PairContext): SemanticPair[] {
	const leftIndex = new Map(lefts.map((node, index) => [node, index]));
	const rightIndex = new Map(rights.map((node, index) => [node, index]));
	const candidates: SemanticPair[] = [];
	for (const left of lefts) {
		for (const right of rights) {
			const scored = scoreSemantic(left, right, leftIndex, rightIndex, context.substitutions);
			candidates.push({ left, right, ...scored });
		}
	}
	if (candidates.length === 0) {
		return [];
	}
	const bestLeft = new Map<TreeRow, number>();
	const secondLeft = new Map<TreeRow, number>();
	const bestRight = new Map<TreeRow, number>();
	const secondRight = new Map<TreeRow, number>();
	const record = (best: Map<TreeRow, number>, second: Map<TreeRow, number>, node: TreeRow, score: number): void => {
		const current = best.get(node);
		if (current === undefined || score > current) {
			second.set(node, current ?? 0);
			best.set(node, score);
		} else if (score > (second.get(node) ?? 0)) {
			second.set(node, score);
		}
	};
	for (const candidate of candidates) {
		record(bestLeft, secondLeft, candidate.left, candidate.score);
		record(bestRight, secondRight, candidate.right, candidate.score);
	}
	const accepted = candidates.filter((candidate) => {
		if (candidate.score < 0.62) {
			return false;
		}
		const leftMargin = (bestLeft.get(candidate.left) ?? 0) - (secondLeft.get(candidate.left) ?? 0);
		const rightMargin = (bestRight.get(candidate.right) ?? 0) - (secondRight.get(candidate.right) ?? 0);
		return leftMargin >= 0.08 && rightMargin >= 0.08;
	});
	accepted.sort(
		(a, b) =>
			b.score - a.score ||
			relativeId(a.left.row.id).localeCompare(relativeId(b.left.row.id)) ||
			relativeId(a.right.row.id).localeCompare(relativeId(b.right.row.id))
	);
	const usedLeft = new Set<TreeRow>();
	const usedRight = new Set<TreeRow>();
	const out: SemanticPair[] = [];
	for (const candidate of accepted) {
		if (usedLeft.has(candidate.left) || usedRight.has(candidate.right)) {
			continue;
		}
		usedLeft.add(candidate.left);
		usedRight.add(candidate.right);
		out.push(candidate);
	}
	return out;
}

function scoreSemantic(
	left: TreeRow,
	right: TreeRow,
	leftIndex: ReadonlyMap<TreeRow, number>,
	rightIndex: ReadonlyMap<TreeRow, number>,
	substitutions: ReadonlyMap<string, string>
): SemanticScore {
	const children = childrenScore(left, right, substitutions);
	if (children === 0) {
		return { score: 0, reasons: { children: 0, name: 0, position: 0, substitution: 0 } };
	}
	const name = nameScore(left, right, substitutions);
	const position = positionScore(left, right, leftIndex, rightIndex);
	const substitution = substitutionScore(left, right, substitutions);
	const score = 0.55 * children + 0.3 * name + 0.1 * position + 0.05 * substitution;
	return {
		score,
		reasons: {
			children: round(children),
			name: round(name),
			position: round(position),
			substitution: round(substitution),
		},
	};
}

function childrenScore(left: TreeRow, right: TreeRow, substitutions: ReadonlyMap<string, string>): number {
	if (left.children.length === 0 && right.children.length === 0) {
		return 1;
	}
	if (left.children.length === 0 || right.children.length === 0) {
		return 0;
	}
	const leftKeys = multiset(left.children.map((child) => childKey(child, substitutions)));
	const rightKeys = multiset(right.children.map((child) => childKey(child, substitutions)));
	let intersection = 0;
	let union = 0;
	for (const key of new Set([...leftKeys.keys(), ...rightKeys.keys()])) {
		const leftCount = leftKeys.get(key) ?? 0;
		const rightCount = rightKeys.get(key) ?? 0;
		intersection += Math.min(leftCount, rightCount);
		union += Math.max(leftCount, rightCount);
	}
	return union === 0 ? 1 : intersection / union;
}

function childKey(node: TreeRow, substitutions: ReadonlyMap<string, string>): string {
	return `${node.row.kind}|${node.row.definitionRef}|${applySubstitutions(sortIdentity(node.row), substitutions)}`;
}

function nameScore(left: TreeRow, right: TreeRow, substitutions: ReadonlyMap<string, string>): number {
	const leftName = applySubstitutions(nameOf(left), substitutions).toLowerCase();
	const rightName = applySubstitutions(nameOf(right), substitutions).toLowerCase();
	if (leftName === '' || rightName === '') {
		return 0;
	}
	const tokensLeft = new Set(tokensOf(leftName));
	const tokensRight = new Set(tokensOf(rightName));
	const union = new Set([...tokensLeft, ...tokensRight]);
	let intersection = 0;
	for (const token of tokensLeft) {
		if (tokensRight.has(token)) {
			intersection++;
		}
	}
	const jaccard = union.size === 0 ? 0 : intersection / union.size;
	const distance = levenshtein(leftName, rightName);
	const similarity = 1 - distance / Math.max(leftName.length, rightName.length, 1);
	return 0.5 * jaccard + 0.5 * similarity;
}

function positionScore(
	left: TreeRow,
	right: TreeRow,
	leftIndex: ReadonlyMap<TreeRow, number>,
	rightIndex: ReadonlyMap<TreeRow, number>
): number {
	const i = leftIndex.get(left) ?? 0;
	const j = rightIndex.get(right) ?? 0;
	return Math.max(0, Math.min(1, 1 - Math.abs(i - j) / Math.max(1, leftIndex.size, rightIndex.size)));
}

function substitutionScore(left: TreeRow, right: TreeRow, substitutions: ReadonlyMap<string, string>): number {
	if (substitutions.size === 0) {
		return 0;
	}
	const leftName = nameOf(left);
	const rightName = nameOf(right);
	if (applySubstitutions(leftName, substitutions) === rightName || applySubstitutions(rightName, substitutions) === leftName) {
		return 1;
	}
	const blob = `${leftName} ${rightName} ${childBlob(left)} ${childBlob(right)}`;
	for (const old of substitutions.keys()) {
		if (blob.includes(old)) {
			return 0.5;
		}
	}
	return 0;
}

function childBlob(node: TreeRow): string {
	return node.children.map((child) => `${nameOf(child)} ${sortIdentity(child.row)}`).join(' ');
}

function substitutionsUsed(left: TreeRow, right: TreeRow, substitutions: ReadonlyMap<string, string>): string[] {
	const blob = `${nameOf(left)} ${nameOf(right)} ${childBlob(left)} ${childBlob(right)}`;
	return [...substitutions.entries()]
		.filter(([old]) => blob.includes(old))
		.map(([old, next]) => `${old}→${next}`);
}

/** Learns `old→new` token changes from high-confidence seed pairs. */
function learnSubstitutions(seeds: readonly SemanticPair[], substitutions: Map<string, string>): void {
	if (substitutions.size > 0) {
		return;
	}
	const counts = new Map<string, Map<string, number>>();
	const totals = new Map<string, number>();
	for (const seed of seeds) {
		if (seed.score < 0.8 || nameOf(seed.left) === nameOf(seed.right)) {
			continue;
		}
		for (const [old, next] of tokenChanges(nameOf(seed.left), nameOf(seed.right))) {
			if (old.length < 2 || next.length < 2 || /^\d+$/.test(old) || /^\d+$/.test(next)) {
				continue;
			}
			totals.set(old, (totals.get(old) ?? 0) + 1);
			const byNext = counts.get(old) ?? new Map<string, number>();
			byNext.set(next, (byNext.get(next) ?? 0) + 1);
			counts.set(old, byNext);
		}
	}
	const candidates: Array<{ old: string; next: string; count: number }> = [];
	for (const [old, byNext] of counts) {
		let bestNext = '';
		let bestCount = 0;
		for (const [next, count] of byNext) {
			if (count > bestCount || (count === bestCount && next < bestNext)) {
				bestNext = next;
				bestCount = count;
			}
		}
		if (bestCount >= 2 && bestCount / Math.max(1, totals.get(old) ?? 0) >= 0.6) {
			candidates.push({ old, next: bestNext, count: bestCount });
		}
	}
	candidates.sort((a, b) => b.count - a.count || a.old.localeCompare(b.old));
	for (const candidate of candidates) {
		if (!substitutions.has(candidate.old)) {
			substitutions.set(candidate.old, candidate.next);
		}
	}
}

function tokenChanges(left: string, right: string): Array<[string, string]> {
	const a = tokensOf(left);
	const b = tokensOf(right);
	const out: Array<[string, string]> = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			i++;
			j++;
			continue;
		}
		out.push([a[i], b[j]]);
		i++;
		j++;
	}
	return out;
}

/** Replaces whole identifier tokens; display text is never rewritten by the model. */
export function applySubstitutions(text: string, substitutions: ReadonlyMap<string, string>): string {
	if (substitutions.size === 0) {
		return text;
	}
	const ordered = [...substitutions.entries()].sort((a, b) => b[0].length - a[0].length);
	return text.replace(/[A-Za-z0-9]+/g, (token) => {
		for (const [old, next] of ordered) {
			if (token === old) {
				return next;
			}
		}
		return token;
	});
}

function tokensOf(text: string): string[] {
	return text.match(/[A-Za-z0-9]+/g) ?? [];
}

function nameOf(node: TreeRow): string {
	return node.row.shortName || node.row.label;
}

function multiset(values: readonly string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return counts;
}

function levenshtein(left: string, right: string): number {
	const previous = new Array<number>(right.length + 1);
	const current = new Array<number>(right.length + 1);
	for (let j = 0; j <= right.length; j++) {
		previous[j] = j;
	}
	for (let i = 1; i <= left.length; i++) {
		current[0] = i;
		for (let j = 1; j <= right.length; j++) {
			current[j] = Math.min(
				previous[j] + 1,
				current[j - 1] + 1,
				previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
			);
		}
		for (let j = 0; j <= right.length; j++) {
			previous[j] = current[j];
		}
	}
	return previous[right.length];
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function haystackOf(cell: DiffCell | undefined): string {
	if (!cell) {
		return '';
	}
	return [
		cell.label,
		cell.shortName ?? '',
		cell.shownValue ?? '',
		...(cell.meta ? cell.meta.map((part) => part.text) : []),
	]
		.filter((part) => part !== '')
		.join(' ');
}

function rowHaystack(left: DiffCell | undefined, right: DiffCell | undefined): string {
	return [haystackOf(left), haystackOf(right)].filter((part) => part !== '').join(' ').toLowerCase();
}

/** Added rows live in their own key namespace (see `sideNode`). */
const ADDED_KEY_PREFIX = 'right:';

function pairedNode(
	left: TreeRow,
	right: TreeRow,
	leftRanges: RangeLookup,
	rightRanges: RangeLookup,
	context: PairContext,
	match?: DiffMatch
): MergedNode {
	const leftCell = toDiffCell(left.row, rangeOf(leftRanges, left.row.id));
	const rightCell = toDiffCell(right.row, rangeOf(rightRanges, right.row.id));
	const changes = diffChanges(leftCell, rightCell);
	markRenameImplied(changes, context.substitutions);
	const childContext = match?.kind === 'semantic' ? { ...context, relative: true } : context;
	return {
		// The left id is the key. A right-only sibling can carry the same id when a
		// duplicate-name group was paired by content across ordinals, so added rows
		// are namespaced instead (`sideNode`) and the two key sets stay disjoint.
		key: left.row.id,
		kind: leftCell.kind,
		status: changes.length > 0 ? 'changed' : 'unchanged',
		left: leftCell,
		right: rightCell,
		changes,
		...(match === undefined ? {} : { match }),
		children: mergeChildren(left.children, right.children, leftRanges, rightRanges, childContext),
	};
}

/** Marks a changed field that differs only by the learned substitution. */
function markRenameImplied(changes: DiffChange[], substitutions: ReadonlyMap<string, string>): void {
	if (substitutions.size === 0) {
		return;
	}
	for (const change of changes) {
		if (applySubstitutions(change.left, substitutions) === change.right) {
			change.renameImplied = true;
		}
	}
}

function sideNode(tree: TreeRow, status: 'added' | 'removed', ranges: RangeLookup, context: PairContext): MergedNode {
	const cell = toDiffCell(tree.row, rangeOf(ranges, tree.row.id));
	return {
		// Paired and removed rows use left ids; an added row can be the right twin of
		// a left id that is already a paired row's key after a duplicate-name shift,
		// and its subtree embeds that id too. The prefix keeps every page key unique.
		key: status === 'added' ? `${ADDED_KEY_PREFIX}${tree.row.id}` : tree.row.id,
		kind: cell.kind,
		status,
		left: status === 'removed' ? cell : undefined,
		right: status === 'added' ? cell : undefined,
		changes: [],
		children: tree.children.map((child) => sideNode(child, status, ranges, context)),
	};
}

/** The merged sibling order: left order preserved, additions next to their right context. */
function mergeChildren(
	leftChildren: readonly TreeRow[],
	rightChildren: readonly TreeRow[],
	leftRanges: RangeLookup,
	rightRanges: RangeLookup,
	context: PairContext
): MergedNode[] {
	const { matchOfRight, matches } = pairLevel(leftChildren, rightChildren, context);
	const matchOfLeft = new Map<TreeRow, TreeRow>();
	for (const [right, left] of matchOfRight) {
		matchOfLeft.set(left, right);
	}

	// Right-only rows queue behind the nearest earlier right sibling that paired
	// with a left row; `null` is "before the first left child".
	const rightOnlyByPrevious = new Map<string | null, TreeRow[]>();
	let previousMatchedLeftId: string | null = null;
	for (const right of rightChildren) {
		const left = matchOfRight.get(right);
		if (left) {
			previousMatchedLeftId = left.row.id;
			continue;
		}
		const list = rightOnlyByPrevious.get(previousMatchedLeftId);
		if (list) {
			list.push(right);
		} else {
			rightOnlyByPrevious.set(previousMatchedLeftId, [right]);
		}
	}

	const out: MergedNode[] = [];
	for (const right of rightOnlyByPrevious.get(null) ?? []) {
		out.push(sideNode(right, 'added', rightRanges, context));
	}
	for (const left of leftChildren) {
		const right = matchOfLeft.get(left);
		if (right) {
			out.push(pairedNode(left, right, leftRanges, rightRanges, context, matches.get(left)));
		} else {
			out.push(sideNode(left, 'removed', leftRanges, context));
		}
		for (const addition of rightOnlyByPrevious.get(left.row.id) ?? []) {
			out.push(sideNode(addition, 'added', rightRanges, context));
		}
	}
	return out;
}

/** Pre-order flatten with level, parent, hasChildren and subtreeSize recomputed. */
function flattenMerged(nodes: readonly MergedNode[], parentKey: string | null, level: number, out: DiffRow[]): void {
	for (let position = 0; position < nodes.length; position++) {
		const node = nodes[position];
		const at = out.length;
		const row: DiffRow = {
			key: node.key,
			parentKey,
			level,
			posinset: position + 1,
			setsize: nodes.length,
			kind: node.kind,
			hasChildren: node.children.length > 0,
			subtreeSize: 0,
			status: node.status,
			left: node.left,
			right: node.right,
			changes: node.changes,
			...(node.match === undefined ? {} : { match: node.match }),
			haystack: rowHaystack(node.left, node.right),
		};
		out.push(row);
		flattenMerged(node.children, node.key, level + 1, out);
		row.subtreeSize = out.length - at - 1;
	}
}

/** The merged diff rows for two display-row lists, in deterministic order. */
export function diffRows(
	leftRows: readonly EcucRow[],
	rightRows: readonly EcucRow[],
	leftRanges?: RangeLookup,
	rightRanges?: RangeLookup,
	options: DiffOptions = {}
): DiffRow[] {
	const leftLookup: RangeLookup = leftRanges ?? (() => undefined);
	const rightLookup: RangeLookup = rightRanges ?? (() => undefined);
	const context: PairContext = {
		relative: false,
		semantic: options.semanticMatching === true,
		substitutions: new Map(),
	};
	const merged = mergeChildren(treeOf(leftRows), treeOf(rightRows), leftLookup, rightLookup, context);
	const out: DiffRow[] = [];
	flattenMerged(merged, null, 1, out);
	return out;
}

/** Counts every row with a status, descendants included. */
export function summarizeDiff(rows: readonly DiffRow[]): DiffSummary {
	const summary: DiffSummary = { changed: 0, added: 0, removed: 0, unchanged: 0, renamed: 0 };
	for (const row of rows) {
		summary[row.status]++;
		if (row.match?.kind === 'semantic') {
			summary.renamed++;
		}
	}
	return summary;
}

/** Builds the document the panel embeds and refreshes. */
export function buildDiffDocument(
	left: FileLabel,
	right: FileLabel,
	leftRows: readonly EcucRow[],
	rightRows: readonly EcucRow[],
	leftRanges?: RangeLookup,
	rightRanges?: RangeLookup,
	headers?: { left: DiffHeader; right: DiffHeader },
	options: DiffOptions = {}
): DiffDocument {
	const rows = diffRows(leftRows, rightRows, leftRanges, rightRanges, options);
	return {
		left,
		right,
		leftHeader: headers ? headers.left : { packages: [] },
		rightHeader: headers ? headers.right : { packages: [] },
		labels: disambiguatedLabels(left, right),
		rows,
		summary: summarizeDiff(rows),
	};
}

/** The pure page helpers below are imported by the bundled diff entrypoint. */

/**
 * Changes-only visibility. Every row is visible in Show all; Show diff only keeps
 * changed/added/removed rows and marks their ancestors. Search is a jump control,
 * so it never removes a row from this list.
 */
export function diffVisibility(
	rows: readonly DiffRow[],
	changesOnly: boolean,
	contextLines = 0
): boolean[] {
	const count = rows.length;
	const visible = new Array<boolean>(count).fill(false);
	if (!changesOnly) {
		visible.fill(true);
		return visible;
	}
	const parentIndex = new Int32Array(count).fill(-1);
	const byKey = new Map<string, number>();
	for (let i = 0; i < count; i++) {
		byKey.set(rows[i].key, i);
	}
	for (let i = 0; i < count; i++) {
		const parentKey = rows[i].parentKey;
		if (parentKey !== null) {
			parentIndex[i] = byKey.get(parentKey) ?? -1;
		}
	}
	const markVisibleWithAncestors = (index: number): void => {
		visible[index] = true;
		let parent = parentIndex[index];
		while (parent >= 0 && !visible[parent]) {
			visible[parent] = true;
			parent = parentIndex[parent];
		}
	};

	const below = new Array<boolean>(count).fill(false);
	for (let i = count - 1; i >= 0; i--) {
		const self = rows[i].status !== 'unchanged';
		const show = self || below[i];
		visible[i] = show;
		if (show && parentIndex[i] >= 0) {
			below[parentIndex[i]] = true;
		}
	}
	const context = Math.max(0, Math.floor(contextLines));
	if (context > 0) {
		for (let i = 0; i < count; i++) {
			if (rows[i].status === 'unchanged') {
				continue;
			}
			const start = Math.max(0, i - context);
			const end = Math.min(count, i + context + 1);
			for (let at = start; at < end; at++) {
				markVisibleWithAncestors(at);
			}
		}
	}
	return visible;
}

/** One displayed diff row: `rowIndex` refers to the source row array. */
export interface FlatDiffRow {
	rowIndex: number;
	level: number;
	expanded: boolean;
}

/** One hidden run of unchanged rows, rendered as an expandable split line. */
export interface DiffGap {
	/** Stable within one document; based on the first hidden row's key. */
	key: string;
	from: number;
	/** Exclusive. */
	to: number;
	count: number;
	expanded: boolean;
}

/** One display line shared by both panes; a side without that line is blank. */
export interface DiffDisplayRow {
	rowIndex: number;
	level: number;
	left: 'node' | 'brace-open' | 'brace-close' | 'comment' | 'blank' | 'gap';
	right: 'node' | 'brace-open' | 'brace-close' | 'comment' | 'blank' | 'gap';
	commentLeft?: string;
	commentRight?: string;
	expanded: boolean;
	/** Present only on a split-line row. */
	gap?: DiffGap;
	guidesLeft: { level: number; id: string }[];
	guidesRight: { level: number; id: string }[];
}

/**
 * The structural display list: annotations, node rows and brace rows for both
 * sides, aligned into one list so the panes share row positions and the
 * virtual window. A side that lacks a structural row gets a blank cell.
 *
 * When a visibility map hides a run, the run becomes one expandable gap row.
 * An expanded gap keeps its header and walks the hidden rows, so the same row
 * can collapse them again.
 */
export function flattenDiffDocument(
	rows: readonly DiffRow[],
	options: {
		collapsed?: ReadonlySet<string>;
		visible?: readonly boolean[];
		expandedGaps?: ReadonlySet<string>;
	} = {}
): DiffDisplayRow[] {
	const count = rows.length;
	const collapsed = options.collapsed;
	const visible = options.visible;
	const expandedGaps = options.expandedGaps;
	let effectiveVisible = visible;
	let gapByStart: Map<number, DiffGap> | undefined;
	if (visible) {
		const gaps: DiffGap[] = [];
		for (let i = 0; i < count; ) {
			if (visible[i]) {
				i++;
				continue;
			}
			const from = i;
			while (i < count && !visible[i]) {
				i++;
			}
			const key = `gap:${rows[from].key}`;
			gaps.push({
				key,
				from,
				to: i,
				count: i - from,
				expanded: expandedGaps?.has(key) === true,
			});
		}
		if (gaps.length > 0) {
			gapByStart = new Map(gaps.map((gap) => [gap.from, gap]));
			const next = visible.slice();
			for (const gap of gaps) {
				if (gap.expanded) {
					for (let at = gap.from; at < gap.to; at++) {
						next[at] = true;
					}
				}
			}
			effectiveVisible = next;
		}
	}
	let visiblePrefix: Int32Array | undefined;
	if (effectiveVisible) {
		visiblePrefix = new Int32Array(count + 1);
		for (let i = 0; i < count; i++) {
			visiblePrefix[i + 1] = visiblePrefix[i] + (effectiveVisible[i] ? 1 : 0);
		}
	}
	const subtreeEnd = (index: number): number => Math.min(count, index + Math.max(0, rows[index].subtreeSize) + 1);
	const hasVisibleDescendant = (index: number): boolean => {
		const end = subtreeEnd(index);
		if (end <= index + 1) {
			return false;
		}
		if (visiblePrefix) {
			return visiblePrefix[end] - visiblePrefix[index + 1] > 0;
		}
		return rows[index].hasChildren;
	};
	const out: DiffDisplayRow[] = [];

	const walk = (
		start: number,
		end: number,
		leftOpen: { level: number; id: string }[],
		rightOpen: { level: number; id: string }[]
	): number => {
		let index = start;
		while (index < end) {
			const gap = gapByStart?.get(index);
			if (gap) {
				out.push({
					rowIndex: index,
					level: rows[index].level,
					left: 'gap',
					right: 'gap',
					expanded: gap.expanded,
					gap,
					guidesLeft: leftOpen.slice(),
					guidesRight: rightOpen.slice()
				});
				if (!gap.expanded) {
					index = Math.min(end, gap.to);
					continue;
				}
			}
			if (effectiveVisible && !effectiveVisible[index]) {
				index = Math.min(end, subtreeEnd(index));
				continue;
			}
			const row = rows[index];
			const nodeIndex = index;
			const leftComments = row.left && row.left.comments ? row.left.comments : [];
			const rightComments = row.right && row.right.comments ? row.right.comments : [];
			const commentCount = Math.max(leftComments.length, rightComments.length);
			const expanded =
				row.hasChildren &&
				hasVisibleDescendant(index) &&
				!(collapsed ? collapsed.has(row.key) : false);
			for (let at = 0; at < commentCount; at++) {
				out.push({
					rowIndex: index,
					level: row.level,
					left: at < leftComments.length ? 'comment' : 'blank',
					right: at < rightComments.length ? 'comment' : 'blank',
					commentLeft: at < leftComments.length ? leftComments[at] : undefined,
					commentRight: at < rightComments.length ? rightComments[at] : undefined,
					expanded: false,
					guidesLeft: leftOpen.slice(),
					guidesRight: rightOpen.slice()
				});
			}
			out.push({
				rowIndex: index,
				level: row.level,
				left: row.left ? 'node' : 'blank',
				right: row.right ? 'node' : 'blank',
				expanded: expanded,
				guidesLeft: leftOpen.slice(),
				guidesRight: rightOpen.slice()
			});
			if (expanded) {
				out.push({
					rowIndex: index,
					level: row.level,
					left: row.left ? 'brace-open' : 'blank',
					right: row.right ? 'brace-open' : 'blank',
					expanded: false,
					guidesLeft: leftOpen.slice(),
					guidesRight: rightOpen.slice()
				});
				const childLeft = row.left ? leftOpen.concat([{ level: row.level, id: row.key }]) : leftOpen;
				const childRight = row.right ? rightOpen.concat([{ level: row.level, id: row.key }]) : rightOpen;
				index = walk(index + 1, Math.min(end, subtreeEnd(index)), childLeft, childRight);
				out.push({
					rowIndex: nodeIndex,
					level: row.level,
					left: row.left ? 'brace-close' : 'blank',
					right: row.right ? 'brace-close' : 'blank',
					expanded: false,
					guidesLeft: leftOpen.slice(),
					guidesRight: rightOpen.slice()
				});
			} else {
				index = Math.min(end, subtreeEnd(index));
			}
		}
		return index;
	};

	walk(0, count, [], []);
	return out;
}

/**
 * The display list: source rows in order, subtrees skipped when collapsed or
 * hidden by the current view. The collapsed set is only read, never modified, so
 * switching views restores exactly the user's state.
 */
export function flattenDiffRows(
	rows: readonly DiffRow[],
	options: { collapsed?: ReadonlySet<string>; visible?: readonly boolean[] } = {}
): FlatDiffRow[] {
	const count = rows.length;
	const collapsed = options.collapsed;
	const visible = options.visible;

	let visiblePrefix: Int32Array | undefined;
	if (visible) {
		visiblePrefix = new Int32Array(count + 1);
		for (let i = 0; i < count; i++) {
			visiblePrefix[i + 1] = visiblePrefix[i] + (visible[i] ? 1 : 0);
		}
	}

	const subtreeEnd = (index: number): number => Math.min(count, index + Math.max(0, rows[index].subtreeSize) + 1);
	const hasVisibleDescendant = (index: number): boolean => {
		const end = subtreeEnd(index);
		if (end <= index + 1) {
			return false;
		}
		if (visiblePrefix) {
			return visiblePrefix[end] - visiblePrefix[index + 1] > 0;
		}
		return rows[index].hasChildren;
	};

	const out: FlatDiffRow[] = [];
	let i = 0;
	while (i < count) {
		if (visible && !visible[i]) {
			i = subtreeEnd(i);
			continue;
		}
		const row = rows[i];
		const expanded =
			row.hasChildren &&
			hasVisibleDescendant(i) &&
			!(collapsed ? collapsed.has(row.key) : false);
		out.push({ rowIndex: i, level: row.level, expanded });
		i = expanded ? i + 1 : subtreeEnd(i);
	}
	return out;
}

/**
 * The next visible changed/added/removed row in `direction`, wrapping at the
 * ends, or `-1` when no row qualifies. `from` may be `-1`: forward then starts at
 * the first row, backward at the last.
 */
export function nextChangeIndex(
	rows: readonly DiffRow[],
	visible: readonly boolean[] | undefined,
	from: number,
	direction: 1 | -1
): number {
	const count = rows.length;
	if (count === 0) {
		return -1;
	}
	const origin = from >= 0 && from < count ? from : direction === 1 ? -1 : 0;
	for (let step = 1; step <= count; step++) {
		const index = (((origin + direction * step) % count) + count) % count;
		const row = rows[index];
		if (row.status === 'unchanged') {
			continue;
		}
		if (visible && !visible[index]) {
			continue;
		}
		return index;
	}
	return -1;
}

function pathParts(path: string): string[] {
	return path.split(/[\\/]/).filter(Boolean);
}

function sameSuffix(a: readonly string[], b: readonly string[], depth: number): boolean {
	return a.slice(-depth).join('/') === b.slice(-depth).join('/');
}

function suffixLabel(parts: readonly string[], depth: number, fallback: string): string {
	return parts.slice(-depth).join('/') || fallback;
}

/**
 * Side labels for a pair of files: the basename, unless both sides share one —
 * then the shortest trailing path suffix that tells them apart.
 */
export function disambiguatedLabels(a: FileLabel, b: FileLabel): [string, string] {
	if (a.name !== b.name || a.path === b.path) {
		return [a.name, b.name];
	}
	const aParts = pathParts(a.path);
	const bParts = pathParts(b.path);
	const maxDepth = Math.max(aParts.length, bParts.length);
	let depth = 1;
	while (depth < maxDepth && sameSuffix(aParts, bParts, depth)) {
		depth++;
	}
	return [suffixLabel(aParts, depth, a.name), suffixLabel(bParts, depth, b.name)];
}

/** The panel title, `<left> ↔ <right>`, with same-named files disambiguated. */
export function compareTitle(left: FileLabel, right: FileLabel): string {
	const [leftLabel, rightLabel] = disambiguatedLabels(left, right);
	return `${leftLabel} ↔ ${rightLabel}`;
}
