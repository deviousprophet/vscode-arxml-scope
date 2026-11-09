/**
 * The semantic diff model.
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
	/** True when the pair came from the cheap above-limit fallback. */
	fallback?: boolean;
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
	/** Enable the semantic container-rename pass; default false preserves strict output. */
	semanticMatching?: boolean;
	/**
	 * Deterministic cap on scored semantic pairs. The production default is the
	 * module budget; exposed so a test can exercise the limited path. Host code
	 * must not set it.
	 * @internal
	 */
	semanticPairBudget?: number;
}

/** A file label plus its path, the pair the title disambiguation needs. */
export interface FileLabel {
	name: string;
	path: string;
}

/** Why a semantic comparison stopped early. */
export type SemanticLimitReason = 'budget' | 'fallback';

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
	/**
	 * Containers in an above-limit bucket that the fallback could not pair. Zero
	 * unless a bucket exceeded the semantic pair limit and still had leftovers.
	 */
	semanticSkipped: number;
	/** Why the comparison was limited; absent when every candidate had a chance. */
	semanticLimitReason?: SemanticLimitReason;
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
	/** Counts containers the above-limit fallback could not pair. */
	semanticSkipped: number;
	/** Deterministic scored-pair budget shared by every bucket in one document. */
	semanticBudgetUsed: number;
	semanticBudgetLimit: number;
	/** True once a bucket hit the candidate/scored-pair budget. */
	semanticBudgetHit: boolean;
	/** Leftovers attributable to each limit, used to pick the dominant reason. */
	semanticBudgetSkipped: number;
	semanticFallbackSkipped: number;
	/** Why the comparison was limited, when it was. */
	semanticLimitReason?: SemanticLimitReason;
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
 * `definitionDest` is a separate attribute, so it is compared. Annotation
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
		// Type and format rows differ.
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

/**
 * One leftover container prepared for the semantic scorer. The child multiset
 * and token set are built once per pass; the old scorer rebuilt them for every
 * left/right pair.
 */
interface SemanticNode {
	tree: TreeRow;
	/** Position in the bucket, used for the deterministic position score. */
	index: number;
	/** Original name, used by the substitution reason. */
	name: string;
	/** Name after learned substitutions, lower-cased. */
	substituted: string;
	tokens: ReadonlySet<string>;
	/** Digit-collapsed name; bulk renames share one signature after learning. */
	signature: string;
	childKeys: ReadonlyMap<string, number>;
	/** Order-independent child-key identity; empty string means no children. */
	childKeySignature: string;
	/** Original child names/identities, built once for substitutionScore. */
	childBlob: string;
}

/** Above this product, a bucket uses candidate blocking instead of scoring every pair. */
const SEMANTIC_FULL_SCORE_PRODUCT = 4_096;
/** Deterministic caps; a candidate count, not a wall clock. */
const SEMANTIC_MAX_CANDIDATES_PER_NODE = 48;
const SEMANTIC_MAX_TOTAL_CANDIDATES = 50_000;
const SEMANTIC_SCORE_BUDGET = 250_000;
/** Number of nearest positions added so a near-tie still has a second score. */
const SEMANTIC_POSITION_NEIGHBOURS = 2;

function semanticNodes(trees: readonly TreeRow[], substitutions: ReadonlyMap<string, string>): SemanticNode[] {
	return trees.map((tree, index) => {
		const name = nameOf(tree);
		const substituted = applySubstitutions(name, substitutions).toLowerCase();
		const childKeys = new Map<string, number>();
		for (const child of tree.children) {
			const key = childKey(child, substitutions);
			childKeys.set(key, (childKeys.get(key) ?? 0) + 1);
		}
		return {
			tree,
			index,
			name,
			substituted,
			tokens: new Set(tokensOf(substituted)),
			signature: substituted.replace(/[0-9]+/g, '#'),
			childKeys,
			childKeySignature: childKeys.size === 0 ? '' : countsSignature(childKeys),
			childBlob: childBlob(tree),
		};
	});
}

function countsSignature(counts: ReadonlyMap<string, number>): string {
	return [...counts.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, count]) => `${key}\u0000${count}`)
		.join('\u0001');
}

function childCount(counts: ReadonlyMap<string, number>): number {
	let total = 0;
	for (const count of counts.values()) {
		total += count;
	}
	return total;
}

/** Multiset Jaccard over precomputed child keys. */
function childrenScoreNodes(left: SemanticNode, right: SemanticNode): number {
	const leftSize = childCount(left.childKeys);
	const rightSize = childCount(right.childKeys);
	if (leftSize === 0 && rightSize === 0) {
		return 1;
	}
	if (leftSize === 0 || rightSize === 0) {
		return 0;
	}
	let intersection = 0;
	let union = 0;
	for (const key of new Set([...left.childKeys.keys(), ...right.childKeys.keys()])) {
		const leftCountValue = left.childKeys.get(key) ?? 0;
		const rightCountValue = right.childKeys.get(key) ?? 0;
		intersection += Math.min(leftCountValue, rightCountValue);
		union += Math.max(leftCountValue, rightCountValue);
	}
	return union === 0 ? 1 : intersection / union;
}

function nameSimilarity(
	leftName: string,
	leftTokens: ReadonlySet<string>,
	rightName: string,
	rightTokens: ReadonlySet<string>
): number {
	if (leftName === '' || rightName === '') {
		return 0;
	}
	const union = new Set([...leftTokens, ...rightTokens]);
	let intersection = 0;
	for (const token of leftTokens) {
		if (rightTokens.has(token)) {
			intersection++;
		}
	}
	const jaccard = union.size === 0 ? 0 : intersection / union.size;
	const distance = levenshtein(leftName, rightName);
	const similarity = 1 - distance / Math.max(leftName.length, rightName.length, 1);
	return 0.5 * jaccard + 0.5 * similarity;
}

function nameScoreNodes(left: SemanticNode, right: SemanticNode): number {
	return nameSimilarity(left.substituted, left.tokens, right.substituted, right.tokens);
}

function positionScoreNodes(left: SemanticNode, right: SemanticNode, leftCount: number, rightCount: number): number {
	return Math.max(0, Math.min(1, 1 - Math.abs(left.index - right.index) / Math.max(1, leftCount, rightCount)));
}

function substitutionScoreNodes(
	left: SemanticNode,
	right: SemanticNode,
	substitutions: ReadonlyMap<string, string>
): number {
	if (substitutions.size === 0) {
		return 0;
	}
	if (
		applySubstitutions(left.name, substitutions) === right.name ||
		applySubstitutions(right.name, substitutions) === left.name
	) {
		return 1;
	}
	const blob = `${left.name} ${right.name} ${left.childBlob} ${right.childBlob}`;
	for (const old of substitutions.keys()) {
		if (blob.includes(old)) {
			return 0.5;
		}
	}
	return 0;
}

function scoreSemanticNode(
	left: SemanticNode,
	right: SemanticNode,
	leftCount: number,
	rightCount: number,
	substitutions: ReadonlyMap<string, string>
): SemanticScore {
	const children = childrenScoreNodes(left, right);
	if (children === 0) {
		return { score: 0, reasons: { children: 0, name: 0, position: 0, substitution: 0 } };
	}
	const name = nameScoreNodes(left, right);
	const position = positionScoreNodes(left, right, leftCount, rightCount);
	const substitution = substitutionScoreNodes(left, right, substitutions);
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


/** Above this product, a bucket uses the linear fallback instead of scoring every pair. */
const SEMANTIC_PAIR_LIMIT = 250_000;
const SEMANTIC_SCORE_FLOOR = 0.62;
const SEMANTIC_MARGIN = 0.08;
/** Token-Jaccard floor for choosing name seeds; the full name score gates learning. */
const SEMANTIC_NAME_SEED_FLOOR = 0.55;
const SEMANTIC_LEARN_SCORE = 0.62;

/** Pairs leftover modules and containers with the same parent and definition ref. */
function semanticPass(
	leftChildren: readonly TreeRow[],
	rightChildren: readonly TreeRow[],
	context: PairContext,
	tryPair: (right: TreeRow, left: TreeRow, match?: DiffMatch) => boolean,
	matchedLeft: ReadonlySet<TreeRow>,
	matchOfRight: ReadonlyMap<TreeRow, TreeRow>
): void {
	const lefts = leftChildren.filter((node) => !matchedLeft.has(node) && isSemanticKind(node.row.kind));
	const rights = rightChildren.filter((node) => !matchOfRight.has(node) && isSemanticKind(node.row.kind));
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
	const normal: Array<{ lefts: TreeRow[]; rights: TreeRow[] }> = [];
	const oversized: Array<{ lefts: TreeRow[]; rights: TreeRow[] }> = [];
	for (const bucket of buckets.values()) {
		if (bucket.lefts.length === 0 || bucket.rights.length === 0) {
			continue;
		}
		(bucket.lefts.length * bucket.rights.length > SEMANTIC_PAIR_LIMIT ? oversized : normal).push(bucket);
	}

	// Normal buckets first: their learned substitutions are what the oversized
	// fallback applies later, independent of the definition's sort order.
	for (const bucket of normal) {
		// The original path: score, learn from high-confidence pairs, score again.
		let pairs = assignSemantic(bucket.lefts, bucket.rights, context);
		if (!context.semanticBudgetHit && learnSubstitutions(pairs, context.substitutions, 0.8, false)) {
			pairs = assignSemantic(bucket.lefts, bucket.rights, context);
		}
		// The deadlock breaker: learn the rename from container names when child
		// values embed the old name and no high-confidence pair exists yet. It runs
		// even after another bucket taught a different substitution.
		if (
			!context.semanticBudgetHit &&
			pairs.length < Math.min(bucket.lefts.length, bucket.rights.length) &&
			learnNameSubstitutions(bucket.lefts, bucket.rights, context.substitutions)
		) {
			pairs = assignSemantic(bucket.lefts, bucket.rights, context);
		}
		// Partial renames can hide further token changes; learn again from the
		// accepted pairs and rescore, with a small bound so this stays linear.
		for (let pass = 0; pass < 3 && !context.semanticBudgetHit; pass++) {
			if (!learnSubstitutions(pairs, context.substitutions, SEMANTIC_LEARN_SCORE, false)) {
				break;
			}
			pairs = assignSemantic(bucket.lefts, bucket.rights, context);
		}
		for (const pair of pairs) {
			const used = substitutionsUsed(pair.left, pair.right, context.substitutions);
			tryPair(pair.right, pair.left, {
				kind: 'semantic',
				score: pair.score,
				reasons: pair.reasons,
				...(used.length === 0 ? {} : { substitutions: used }),
			});
		}
		if (context.semanticBudgetHit) {
			const pairedLeft = new Set(pairs.map((pair) => pair.left));
			const pairedRight = new Set(pairs.map((pair) => pair.right));
			const unpaired =
				bucket.lefts.length - pairedLeft.size + (bucket.rights.length - pairedRight.size);
			context.semanticBudgetSkipped += unpaired;
			context.semanticSkipped += unpaired;
		}
	}

	for (const bucket of oversized) {
		// Learn the rename from names before the name-key fallback. Without this,
		// a single above-limit bucket has no normal bucket to teach it a
		// substitution and its fallback pairs nothing.
		learnNameSubstitutions(bucket.lefts, bucket.rights, context.substitutions);
		const pairs = assignFallback(bucket.lefts, bucket.rights, context.substitutions);
		for (const pair of pairs) {
			tryPair(pair.right, pair.left, {
				kind: 'semantic',
				score: pair.score,
				reasons: pair.reasons,
				fallback: true,
			});
		}
		const pairedLeft = new Set(pairs.map((pair) => pair.left));
		const pairedRight = new Set(pairs.map((pair) => pair.right));
		const unpaired = bucket.lefts.length - pairedLeft.size + (bucket.rights.length - pairedRight.size);
		context.semanticFallbackSkipped += unpaired;
		context.semanticSkipped += unpaired;
	}
	if (context.semanticSkipped > 0) {
		context.semanticLimitReason =
			context.semanticBudgetSkipped > context.semanticFallbackSkipped
				? 'budget'
				: context.semanticFallbackSkipped > 0
					? 'fallback'
					: 'budget';
	}
}

/** Semantic pairing covers modules and containers; parameters and references stay strict. */
function isSemanticKind(kind: EcucRow['kind']): boolean {
	return kind === 'container' || kind === 'module';
}

/** Records the best and second-best value for one node. */
function recordTopTwo(map: Map<TreeRow, number>, second: Map<TreeRow, number>, node: TreeRow, value: number): void {
	const current = map.get(node);
	if (current === undefined || value > current) {
		second.set(node, current ?? 0);
		map.set(node, value);
	} else if (value > (second.get(node) ?? 0)) {
		second.set(node, value);
	}
}

/** Groups nodes by a deterministic key, preserving their bucket order. */
function groupBy<T>(
	nodes: readonly T[],
	keyOf: (node: T) => string,
	skipEmpty = false
): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const node of nodes) {
		const key = keyOf(node);
		if (skipEmpty && key === '') {
			continue;
		}
		const list = groups.get(key);
		if (list) {
			list.push(node);
		} else {
			groups.set(key, [node]);
		}
	}
	return groups;
}

function buildTokenPostings<T>(nodes: readonly T[], tokensOf: (node: T) => ReadonlySet<string>): Map<string, T[]> {
	const postings = new Map<string, T[]>();
	for (const node of nodes) {
		for (const token of tokensOf(node)) {
			const list = postings.get(token);
			if (list) {
				list.push(node);
			} else {
				postings.set(token, [node]);
			}
		}
	}
	return postings;
}

/**
 * Candidate blocking for one bucket.
 *
 * Small buckets keep the original all-pairs behavior. Large buckets get
 * signature groups (the bulk-rename path), non-empty child-key groups, rare
 * tokens and a few position neighbours. Neighbours are deliberate: the near-tie
 * margin needs a second score, so a single candidate must not look certain.
 */
function collectSemanticCandidates(
	lefts: readonly SemanticNode[],
	rights: readonly SemanticNode[],
	context: PairContext
): Array<[SemanticNode, SemanticNode]> {
	if (lefts.length * rights.length <= SEMANTIC_FULL_SCORE_PRODUCT) {
		const all: Array<[SemanticNode, SemanticNode]> = [];
		for (const left of lefts) {
			for (const right of rights) {
				all.push([left, right]);
			}
		}
		return all;
	}

	const out: Array<[SemanticNode, SemanticNode]> = [];
	const seen = new Set<string>();
	const perLeft = new Map<number, number>();
	const add = (left: SemanticNode, right: SemanticNode): void => {
		if (out.length >= SEMANTIC_MAX_TOTAL_CANDIDATES) {
			context.semanticBudgetHit = true;
			return;
		}
		if ((perLeft.get(left.index) ?? 0) >= SEMANTIC_MAX_CANDIDATES_PER_NODE) {
			return;
		}
		const key = `${left.index}\u0000${right.index}`;
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		perLeft.set(left.index, (perLeft.get(left.index) ?? 0) + 1);
		out.push([left, right]);
	};

	const addGroups = (keyOf: (node: SemanticNode) => string, skipEmpty: boolean): void => {
		const leftGroups = groupBy(lefts, keyOf, skipEmpty);
		const rightGroups = groupBy(rights, keyOf, skipEmpty);
		for (const [key, leftGroup] of leftGroups) {
			const rightGroup = rightGroups.get(key);
			if (rightGroup === undefined) {
				continue;
			}
			const common = Math.min(leftGroup.length, rightGroup.length);
			for (let at = 0; at < common; at++) {
				add(leftGroup[at], rightGroup[at]);
			}
			// Unequal groups still get the nearest alternatives for the margin.
			for (let at = common; at < leftGroup.length; at++) {
				add(leftGroup[at], rightGroup[Math.min(at, rightGroup.length - 1)]);
			}
		}
	};

	addGroups((node) => node.signature, false);
	addGroups((node) => node.childKeySignature, true);

	// Rare tokens: digits usually give a cheap 1:1 ordinal seed. Suppress tokens
	// common enough to produce the full product.
	const postings = buildTokenPostings(rights, (right) => right.tokens);
	const frequencyLimit = Math.max(32, Math.ceil(rights.length * 0.1));
	for (const left of lefts) {
		const candidates = new Map<number, SemanticNode>();
		for (const token of left.tokens) {
			const list = postings.get(token);
			if (list === undefined || list.length > frequencyLimit) {
				continue;
			}
			for (const right of list) {
				candidates.set(right.index, right);
			}
		}
		const ranked = [...candidates.values()].sort(
			(a, b) => tokenJaccard(left.tokens, b.tokens) - tokenJaccard(left.tokens, a.tokens) || a.index - b.index
		);
		for (const right of ranked.slice(0, SEMANTIC_MAX_CANDIDATES_PER_NODE)) {
			add(left, right);
		}
	}

	// Every left needs at least a second candidate for the near-tie margin, even
	// when no signature/child/token candidate exists. Position neighbours are
	// deterministic and cheap; the scorer still rejects a low score or a tie.
	for (const left of lefts) {
		if ((perLeft.get(left.index) ?? 0) >= 2) {
			continue;
		}
		for (let offset = 0; offset <= SEMANTIC_POSITION_NEIGHBOURS; offset++) {
			for (const direction of offset === 0 ? [0] : [-1, 1]) {
				const at = left.index + direction * offset;
				if (at >= 0 && at < rights.length) {
					add(left, rights[at]);
				}
			}
		}
	}
	return out;
}

/** Scores and greedily assigns one bucket. Near-ties stay unpaired, except for identical children. */
function assignSemantic(lefts: readonly TreeRow[], rights: readonly TreeRow[], context: PairContext): SemanticPair[] {
	const leftNodes = semanticNodes(lefts, context.substitutions);
	const rightNodes = semanticNodes(rights, context.substitutions);
	const candidateNodes = collectSemanticCandidates(leftNodes, rightNodes, context);
	if (candidateNodes.length === 0) {
		return [];
	}
	const remainingBudget = Math.max(0, context.semanticBudgetLimit - context.semanticBudgetUsed);
	const considered =
		candidateNodes.length > remainingBudget ? candidateNodes.slice(0, remainingBudget) : candidateNodes;
	const budgetLimited = considered.length < candidateNodes.length;
	if (budgetLimited) {
		context.semanticBudgetHit = true;
	}
	context.semanticBudgetUsed += considered.length;

	const leftIndex = new Map(lefts.map((node, index) => [node, index]));
	const rightIndex = new Map(rights.map((node, index) => [node, index]));
	const candidates: SemanticPair[] = [];
	for (const [left, right] of considered) {
		const scored = scoreSemanticNode(left, right, leftNodes.length, rightNodes.length, context.substitutions);
		candidates.push({ left: left.tree, right: right.tree, ...scored });
	}
	if (candidates.length === 0) {
		return [];
	}
	const bestLeft = new Map<TreeRow, number>();
	const secondLeft = new Map<TreeRow, number>();
	const bestRight = new Map<TreeRow, number>();
	const secondRight = new Map<TreeRow, number>();
	for (const candidate of candidates) {
		recordTopTwo(bestLeft, secondLeft, candidate.left, candidate.score);
		recordTopTwo(bestRight, secondRight, candidate.right, candidate.score);
	}
	const accepted = candidates.filter((candidate) => {
		if (candidate.score < SEMANTIC_SCORE_FLOOR) {
			return false;
		}
		const leftMargin = (bestLeft.get(candidate.left) ?? 0) - (secondLeft.get(candidate.left) ?? 0);
		const rightMargin = (bestRight.get(candidate.right) ?? 0) - (secondRight.get(candidate.right) ?? 0);
		return leftMargin >= SEMANTIC_MARGIN && rightMargin >= SEMANTIC_MARGIN;
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

	if (budgetLimited) {
		return out;
	}

	// Identical children make every pair score the same, so the 0.08 margin can
	// never accept one. Pair the leftovers by name, then by ordinal position.
	const remainingLeft = lefts.filter((node) => !usedLeft.has(node));
	const remainingRight = rights.filter((node) => !usedRight.has(node));
	if (
		remainingLeft.length > 0 &&
		remainingRight.length > 0 &&
		candidates.every((candidate) => candidate.reasons.children >= 0.99)
	) {
		out.push(...assignIdenticalChildren(remainingLeft, remainingRight, leftIndex, rightIndex, context.substitutions));
	}
	return out;
}

/** Deterministic pairing for buckets whose children are all identical. */
function assignIdenticalChildren(
	lefts: readonly TreeRow[],
	rights: readonly TreeRow[],
	leftIndex: ReadonlyMap<TreeRow, number>,
	rightIndex: ReadonlyMap<TreeRow, number>,
	substitutions: ReadonlyMap<string, string>
): SemanticPair[] {
	const substitutedName = (node: TreeRow): string =>
		applySubstitutions(nameOf(node), substitutions).toLowerCase();
	const normalized = (node: TreeRow): string => substitutedName(node).replace(/[0-9]+/g, '#');
	const usedLeft = new Set<TreeRow>();
	const usedRight = new Set<TreeRow>();
	const out: SemanticPair[] = [];

	const pair = (left: TreeRow, right: TreeRow): void => {
		const name = nameScore(left, right, substitutions);
		const position = positionScore(left, right, leftIndex, rightIndex);
		const substitution = substitutionScore(left, right, substitutions);
		const nameKey = normalized(left) === normalized(right) ? 1 : name;
		out.push({
			left,
			right,
			score: 0.55 + 0.3 * nameKey + 0.1 * position + 0.05 * substitution,
			reasons: {
				children: 1,
				name: round(name),
				position: round(position),
				substitution: round(substitution),
			},
		});
		usedLeft.add(left);
		usedRight.add(right);
	};

	/** Zips matching groups in bucket order; leftovers remain for the next key. */
	const pairGroups = (keyOf: (node: TreeRow) => string): void => {
		const leftGroups = groupBy(lefts.filter((node) => !usedLeft.has(node)), keyOf);
		const rightGroups = groupBy(rights.filter((node) => !usedRight.has(node)), keyOf);
		for (const [key, leftGroup] of leftGroups) {
			const rightGroup = rightGroups.get(key);
			if (rightGroup === undefined) {
				continue;
			}
			const common = Math.min(leftGroup.length, rightGroup.length);
			for (let at = 0; at < common; at++) {
				pair(leftGroup[at], rightGroup[at]);
			}
		}
	};

	pairGroups(substitutedName);
	pairGroups(normalized);
	// Anything left is paired by ordinal position, but only when the names are
	// still plausibly related; identical children alone must not invent a pair.
	const remainingLeft = lefts.filter((node) => !usedLeft.has(node));
	const remainingRight = rights.filter((node) => !usedRight.has(node));
	const common = Math.min(remainingLeft.length, remainingRight.length);
	for (let at = 0; at < common; at++) {
		const left = remainingLeft[at];
		const right = remainingRight[at];
		if (nameScore(left, right, substitutions) < 0.5) {
			continue;
		}
		pair(left, right);
	}
	return out;
}

/** Cheap linear assignment for buckets above the pair limit. */
function assignFallback(
	lefts: readonly TreeRow[],
	rights: readonly TreeRow[],
	substitutions: ReadonlyMap<string, string>
): SemanticPair[] {
	const keyOf = (node: TreeRow): string => applySubstitutions(nameOf(node), substitutions).toLowerCase();
	const leftGroups = groupBy(lefts, keyOf);
	const rightGroups = groupBy(rights, keyOf);
	const out: SemanticPair[] = [];
	for (const [key, leftGroup] of leftGroups) {
		const rightGroup = rightGroups.get(key);
		if (rightGroup === undefined) {
			continue;
		}
		const count = Math.min(leftGroup.length, rightGroup.length);
		for (let at = 0; at < count; at++) {
			out.push({
				left: leftGroup[at],
				right: rightGroup[at],
				score: SEMANTIC_SCORE_FLOOR,
				reasons: { children: 0, name: 1, position: 1, substitution: 0 },
			});
		}
	}
	return out;
}

/** Learns token changes from mutual-best name pairs, before child values are scored. */
function learnNameSubstitutions(
	lefts: readonly TreeRow[],
	rights: readonly TreeRow[],
	substitutions: Map<string, string>
): boolean {
	const tokenSets = (nodes: readonly TreeRow[]): Map<TreeRow, Set<string>> => {
		const out = new Map<TreeRow, Set<string>>();
		for (const node of nodes) {
			out.set(node, new Set(tokensOf(applySubstitutions(nameOf(node), substitutions).toLowerCase())));
		}
		return out;
	};
	const leftTokens = tokenSets(lefts);
	const rightTokens = tokenSets(rights);

	// Inverted index over the right side. A token shared by more than a tenth of
	// the bucket is a stop token; the unique ordinal token still gives a seed.
	const postings = buildTokenPostings(rights, (right) => rightTokens.get(right) ?? new Set<string>());
	const frequencyLimit = Math.max(32, Math.ceil(rights.length * 0.1));
	const bestRight = new Map<TreeRow, { node: TreeRow; score: number }>();
	const bestLeft = new Map<TreeRow, { node: TreeRow; score: number }>();
	const remember = (
		map: Map<TreeRow, { node: TreeRow; score: number }>,
		from: TreeRow,
		to: TreeRow,
		score: number
	): void => {
		const current = map.get(from);
		if (current === undefined || score > current.score) {
			map.set(from, { node: to, score });
		}
	};
	for (let leftAt = 0; leftAt < lefts.length; leftAt++) {
		const left = lefts[leftAt];
		const a = leftTokens.get(left) ?? new Set<string>();
		const candidates = new Map<TreeRow, number>();
		for (const token of a) {
			const list = postings.get(token);
			if (list === undefined || list.length > frequencyLimit) {
				continue;
			}
			for (const right of list) {
				if (!candidates.has(right)) {
					candidates.set(right, tokenJaccard(a, rightTokens.get(right) ?? new Set<string>()));
				}
			}
		}
		// A bucket with no rare token still gets a few position alternatives.
		if (candidates.size < 2) {
			for (const offset of [0, -1, 1]) {
				const at = leftAt + offset;
				if (at >= 0 && at < rights.length) {
					const right = rights[at];
					if (!candidates.has(right)) {
						candidates.set(right, tokenJaccard(a, rightTokens.get(right) ?? new Set<string>()));
					}
				}
			}
		}
		const ranked = [...candidates.entries()]
			.sort(([leftNode, leftScore], [rightNode, rightScore]) =>
				rightScore - leftScore || leftNode.row.id.localeCompare(rightNode.row.id)
			)
			.slice(0, 16);
		for (const [right, score] of ranked) {
			if (score > 0) {
				remember(bestRight, left, right, score);
				remember(bestLeft, right, left, score);
			}
		}
	}
	const seeds: SemanticPair[] = [];
	for (const left of lefts) {
		const picked = bestRight.get(left);
		if (picked === undefined || bestLeft.get(picked.node)?.node !== left) {
			continue;
		}
		// Jaccard chooses the mutual-best pair; the full name score gates learning.
		const score = nameScore(left, picked.node, substitutions);
		if (score < SEMANTIC_NAME_SEED_FLOOR) {
			continue;
		}
		seeds.push({
			left,
			right: picked.node,
			score,
			reasons: { children: 0, name: round(score), position: 0, substitution: 0 },
		});
	}
	return learnSubstitutions(seeds, substitutions, SEMANTIC_NAME_SEED_FLOOR, true);
}

function tokenJaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
	if (left.size === 0 || right.size === 0) {
		return 0;
	}
	let intersection = 0;
	for (const token of left) {
		if (right.has(token)) {
			intersection++;
		}
	}
	const union = left.size + right.size - intersection;
	return union === 0 ? 0 : intersection / union;
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
	return nameSimilarity(leftName, new Set(tokensOf(leftName)), rightName, new Set(tokensOf(rightName)));
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

/**
 * Learns `old→new` token changes from seed pairs and merges any new mappings.
 * Returns true when at least one mapping was added.
 */
function learnSubstitutions(
	seeds: readonly SemanticPair[],
	substitutions: Map<string, string>,
	minScore: number,
	allowSingle: boolean
): boolean {
	const counts = new Map<string, Map<string, number>>();
	const totals = new Map<string, number>();
	/** True when this token came from a seed with exactly one usable token change. */
	const sole = new Map<string, boolean>();
	for (const seed of seeds) {
		if (seed.score < minScore || nameOf(seed.left) === nameOf(seed.right)) {
			continue;
		}
		const changes: Array<[string, string]> = [];
		for (const [old, next] of tokenChanges(nameOf(seed.left), nameOf(seed.right))) {
			if (old.length < 2 || next.length < 2 || /^\d+$/.test(old) || /^\d+$/.test(next)) {
				continue;
			}
			changes.push([old, next]);
			totals.set(old, (totals.get(old) ?? 0) + 1);
			const byNext = counts.get(old) ?? new Map<string, number>();
			byNext.set(next, (byNext.get(next) ?? 0) + 1);
			counts.set(old, byNext);
		}
		if (changes.length === 1 && sole.get(changes[0][0]) !== false) {
			sole.set(changes[0][0], true);
		} else if (changes.length > 1) {
			for (const [old] of changes) {
				sole.set(old, false);
			}
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
		const total = totals.get(old) ?? 0;
		const consistent = bestCount >= 2 && bestCount / Math.max(1, total) >= 0.6;
		// A single mutual-best name pair is enough when it changed exactly one token.
		const single = allowSingle && bestCount === 1 && total === 1 && byNext.size === 1 && sole.get(old) === true;
		if (consistent || single) {
			candidates.push({ old, next: bestNext, count: bestCount });
		}
	}
	candidates.sort((a, b) => b.count - a.count || a.old.localeCompare(b.old));
	let added = false;
	for (const candidate of candidates) {
		if (!substitutions.has(candidate.old)) {
			substitutions.set(candidate.old, candidate.next);
			added = true;
		}
	}
	return added;
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

/** The merged rows plus the semantic-skip counter, kept separate from the public list API. */
interface DiffRowsResult {
	rows: DiffRow[];
	semanticSkipped: number;
	semanticLimitReason?: SemanticLimitReason;
}

/** The merged diff rows for two display-row lists, in deterministic order. */
export function diffRows(
	leftRows: readonly EcucRow[],
	rightRows: readonly EcucRow[],
	leftRanges?: RangeLookup,
	rightRanges?: RangeLookup,
	options: DiffOptions = {}
): DiffRow[] {
	return diffRowsWithMetrics(leftRows, rightRows, leftRanges, rightRanges, options).rows;
}

function diffRowsWithMetrics(
	leftRows: readonly EcucRow[],
	rightRows: readonly EcucRow[],
	leftRanges?: RangeLookup,
	rightRanges?: RangeLookup,
	options: DiffOptions = {}
): DiffRowsResult {
	const leftLookup: RangeLookup = leftRanges ?? (() => undefined);
	const rightLookup: RangeLookup = rightRanges ?? (() => undefined);
	const context: PairContext = {
		relative: false,
		semantic: options.semanticMatching === true,
		substitutions: new Map(),
		semanticSkipped: 0,
		semanticBudgetUsed: 0,
		semanticBudgetLimit: options.semanticPairBudget ?? SEMANTIC_SCORE_BUDGET,
		semanticBudgetHit: false,
		semanticBudgetSkipped: 0,
		semanticFallbackSkipped: 0,
	};
	const merged = mergeChildren(treeOf(leftRows), treeOf(rightRows), leftLookup, rightLookup, context);
	const out: DiffRow[] = [];
	flattenMerged(merged, null, 1, out);
	return {
		rows: out,
		semanticSkipped: context.semanticSkipped,
		...(context.semanticLimitReason === undefined ? {} : { semanticLimitReason: context.semanticLimitReason }),
	};
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
	const { rows, semanticSkipped, semanticLimitReason } = diffRowsWithMetrics(
		leftRows,
		rightRows,
		leftRanges,
		rightRanges,
		options
	);
	return {
		left,
		right,
		leftHeader: headers ? headers.left : { packages: [] },
		rightHeader: headers ? headers.right : { packages: [] },
		labels: disambiguatedLabels(left, right),
		rows,
		summary: summarizeDiff(rows),
		semanticSkipped,
		...(semanticLimitReason === undefined ? {} : { semanticLimitReason }),
	};
}

/** The pure page helpers below are imported by the bundled diff entrypoint. */

/**
 * Changes-only visibility. Every row is visible in Show all; Show diff keeps
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
