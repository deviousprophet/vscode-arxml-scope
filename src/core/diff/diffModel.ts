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
function baseId(id: string): string {
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
function toDiffCell(row: EcucRow, range?: Range): DiffCell {
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

function contextMetaText(cell: DiffCell): string {
	const part = cell.meta.find((candidate) => candidate.cls === 'context');
	if (!part) {
		return '';
	}
	return part.text.indexOf('context ') === 0 ? part.text.slice('context '.length) : part.text;
}

function contextText(cell: DiffCell): string {
	const paths = cell.contextPaths;
	if (paths && paths.length > 0) {
		return paths.join(', ');
	}
	return contextMetaText(cell);
}

function textOrEmpty(value: string | undefined): string {
	return value ?? '';
}

function valueChanges(left: DiffCell, right: DiffCell): DiffChange[] {
	const value = changeOf('value', textOrEmpty(left.value), textOrEmpty(right.value));
	if (value) {
		return [value];
	}
	// `shownValue` is derived from the value text and the element kind. They can
	// disagree while the raw value matches only for a mistyped tag, but showing the
	// quoted/bare difference is better than reporting the row unchanged.
	const shown = changeOf('shown value', textOrEmpty(left.shownValue), textOrEmpty(right.shownValue));
	return shown ? [shown] : [];
}

function changeOf(field: string, leftText: string, rightText: string): DiffChange | undefined {
	return leftText === rightText ? undefined : { field, left: leftText, right: rightText };
}

function comparedFields(left: DiffCell, right: DiffCell): Array<[string, string, string]> {
	return [
		['target', textOrEmpty(left.target), textOrEmpty(right.target)],
		['short name', textOrEmpty(left.shortName), textOrEmpty(right.shortName)],
		['definition ref', left.definitionRef, right.definitionRef],
		// `DEST` is a separate attribute, not part of the ref text: an integer parameter
		// retyped as boolean would otherwise compare as unchanged while the editor's
		// Type and format rows differ.
		['definition dest', textOrEmpty(left.definitionDest), textOrEmpty(right.definitionDest)],
		['variant', metaText(left, 'variant'), metaText(right, 'variant')],
		['condition', metaText(left, 'condition'), metaText(right, 'condition')],
		['context', contextText(left), contextText(right)],
	];
}

function fieldChanges(left: DiffCell, right: DiffCell): DiffChange[] {
	const changes: DiffChange[] = [];
	for (const [field, leftText, rightText] of comparedFields(left, right)) {
		const change = changeOf(field, leftText, rightText);
		if (change) {
			changes.push(change);
		}
	}
	return changes;
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
	return [...valueChanges(left, right), ...fieldChanges(left, right)];
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

function variantText(meta: readonly MetaPart[]): string {
	return meta
		.filter((part) => part.cls === 'variant')
		.map((part) => part.text)
		.join(',');
}

function valueIdentity(row: EcucRow): string {
	return `value:${row.value ?? ''}`;
}

function referenceIdentity(row: EcucRow): string {
	return `target:${row.target ?? ''}|context:${(row.contextPaths ?? []).join(',')}`;
}

function containerIdentity(row: EcucRow): string {
	return `definition:${row.definitionRef}|variant:${variantText(row.meta)}`;
}

/**
 * The looser identity used after exact content fails: the row's sort identity plus
 * variant and reference context. It pairs a duplicate whose value/condition changed
 * with its counterpart so the change is reported on one row, not as add + remove.
 */
function sortIdentity(row: EcucRow): string {
	if (row.kind === 'parameter') {
		return valueIdentity(row);
	}
	if (row.kind === 'reference') {
		return referenceIdentity(row);
	}
	return containerIdentity(row);
}

function pushGrouped<K, T>(groups: Map<K, T[]>, key: K, value: T): void {
	const list = groups.get(key);
	if (list) {
		list.push(value);
	} else {
		groups.set(key, [value]);
	}
}

function groupByBase(children: readonly TreeRow[], context: PairContext): Map<string, TreeRow[]> {
	const groups = new Map<string, TreeRow[]>();
	for (const child of children) {
		const id = context.relative ? relativeId(child.row.id) : child.row.id;
		pushGrouped(groups, baseId(id), child);
	}
	return groups;
}

interface PairResult {
	matchOfRight: Map<TreeRow, TreeRow>;
	matches: Map<TreeRow, DiffMatch>;
}

type TryPair = (right: TreeRow, left: TreeRow, match?: DiffMatch) => boolean;

function pairNextInBucket(bucket: TreeRow[], left: TreeRow, tryPair: TryPair): boolean {
	const right = bucket.shift();
	return right !== undefined && tryPair(right, left);
}

/** Pairs the first unmatched right row of a bucket, honouring an already-used left row. */
function pairFromBucket(bucket: TreeRow[] | undefined, left: TreeRow, tryPair: TryPair): void {
	if (bucket === undefined) {
		return;
	}
	while (bucket.length > 0) {
		if (pairNextInBucket(bucket, left, tryPair)) {
			return;
		}
	}
}

function pushUnmatched(
	groups: Map<string, TreeRow[]>,
	nodes: readonly TreeRow[],
	keyOf: (node: TreeRow) => string,
	isMatched: (node: TreeRow) => boolean
): void {
	for (const node of nodes) {
		if (!isMatched(node)) {
			pushGrouped(groups, keyOf(node), node);
		}
	}
}

/** One identity pass: bucket the free right rows by key and pair each free left row. */
function pairByKey(
	lefts: readonly TreeRow[],
	rights: readonly TreeRow[],
	keyOf: (node: TreeRow) => string,
	tryPair: TryPair,
	matchedLeft: ReadonlySet<TreeRow>,
	matchOfRight: ReadonlyMap<TreeRow, TreeRow>
): void {
	const buckets = new Map<string, TreeRow[]>();
	pushUnmatched(buckets, rights, keyOf, (node) => matchOfRight.has(node));
	for (const left of lefts) {
		if (matchedLeft.has(left)) {
			continue;
		}
		pairFromBucket(buckets.get(keyOf(left)), left, tryPair);
	}
}

function skipsIdentityPair(lefts: readonly TreeRow[], rights: readonly TreeRow[]): boolean {
	return lefts.length === 1 && rights.length === 1;
}

/** Same-named sibling groups: exact subtree content first, then the looser sort identity. */
function pairIdentityGroups(
	leftByBase: ReadonlyMap<string, readonly TreeRow[]>,
	rightByBase: ReadonlyMap<string, readonly TreeRow[]>,
	tryPair: TryPair,
	matchedLeft: ReadonlySet<TreeRow>,
	matchOfRight: ReadonlyMap<TreeRow, TreeRow>
): void {
	for (const [base, lefts] of leftByBase) {
		const rights = rightByBase.get(base);
		if (rights === undefined || skipsIdentityPair(lefts, rights)) {
			continue;
		}
		pairByKey(lefts, rights, subtreeIdentity, tryPair, matchedLeft, matchOfRight);
		pairByKey(lefts, rights, (node) => sortIdentity(node.row), tryPair, matchedLeft, matchOfRight);
	}
}

function pairKnownRight(
	left: TreeRow,
	right: TreeRow | undefined,
	tryPair: TryPair,
	matchedLeft: ReadonlySet<TreeRow>
): void {
	if (matchedLeft.has(left) || right === undefined) {
		return;
	}
	tryPair(right, left);
}

function pairByIdentity(
	leftChildren: readonly TreeRow[],
	rightChildren: readonly TreeRow[],
	context: PairContext,
	tryPair: TryPair,
	matchedLeft: ReadonlySet<TreeRow>
): void {
	const idOf = (row: TreeRow): string => (context.relative ? relativeId(row.row.id) : row.row.id);
	const rightById = new Map<string, TreeRow>();
	for (const right of rightChildren) {
		rightById.set(idOf(right), right);
	}
	for (const left of leftChildren) {
		pairKnownRight(left, rightById.get(idOf(left)), tryPair, matchedLeft);
	}
}

function unmatchedByBase(
	children: readonly TreeRow[],
	context: PairContext,
	isMatched: (node: TreeRow) => boolean
): Map<string, TreeRow[]> {
	const groups = new Map<string, TreeRow[]>();
	for (const child of children) {
		if (isMatched(child)) {
			continue;
		}
		const id = context.relative ? relativeId(child.row.id) : child.row.id;
		pushGrouped(groups, baseId(id), child);
	}
	return groups;
}

function singletonRight(
	lefts: readonly TreeRow[],
	rights: readonly TreeRow[] | undefined
): rights is readonly TreeRow[] {
	return lefts.length === 1 && rights !== undefined && rights.length === 1;
}

/** The design's ordinal-free fallback, widened to embedded parent ordinals. */
function pairByBaseFallback(
	leftChildren: readonly TreeRow[],
	rightChildren: readonly TreeRow[],
	context: PairContext,
	tryPair: TryPair,
	matchedLeft: ReadonlySet<TreeRow>,
	matchOfRight: ReadonlyMap<TreeRow, TreeRow>
): void {
	const leftRestByBase = unmatchedByBase(leftChildren, context, (node) => matchedLeft.has(node));
	const rightRestByBase = unmatchedByBase(rightChildren, context, (node) => matchOfRight.has(node));
	for (const [base, lefts] of leftRestByBase) {
		const rights = rightRestByBase.get(base);
		if (singletonRight(lefts, rights)) {
			tryPair(rights[0], lefts[0]);
		}
	}
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
	const tryPair: TryPair = (right, left, match) => {
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

	pairIdentityGroups(
		groupByBase(leftChildren, context),
		groupByBase(rightChildren, context),
		tryPair,
		matchedLeft,
		matchOfRight
	);
	pairByIdentity(leftChildren, rightChildren, context, tryPair, matchedLeft);
	pairByBaseFallback(leftChildren, rightChildren, context, tryPair, matchedLeft, matchOfRight);
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

function countOf(counts: ReadonlyMap<string, number>, key: string): number {
	return counts.get(key) ?? 0;
}

function bothEmpty(left: number, right: number): boolean {
	return left === 0 && right === 0;
}

function eitherEmptyCount(left: number, right: number): boolean {
	return left === 0 || right === 0;
}

function multisetScore(
	leftCounts: ReadonlyMap<string, number>,
	rightCounts: ReadonlyMap<string, number>
): number {
	let intersection = 0;
	let union = 0;
	for (const key of new Set([...leftCounts.keys(), ...rightCounts.keys()])) {
		intersection += Math.min(countOf(leftCounts, key), countOf(rightCounts, key));
		union += Math.max(countOf(leftCounts, key), countOf(rightCounts, key));
	}
	return union === 0 ? 1 : intersection / union;
}

/** Multiset Jaccard over precomputed child keys. */
function childrenScoreNodes(left: SemanticNode, right: SemanticNode): number {
	const leftSize = childCount(left.childKeys);
	const rightSize = childCount(right.childKeys);
	if (bothEmpty(leftSize, rightSize)) {
		return 1;
	}
	if (eitherEmptyCount(leftSize, rightSize)) {
		return 0;
	}
	return multisetScore(left.childKeys, right.childKeys);
}

function tokenIntersection(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
	let intersection = 0;
	for (const token of left) {
		if (right.has(token)) {
			intersection++;
		}
	}
	return intersection;
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
	const jaccard = union.size === 0 ? 0 : tokenIntersection(leftTokens, rightTokens) / union.size;
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

function renamesToOneSide(
	leftName: string,
	rightName: string,
	substitutions: ReadonlyMap<string, string>
): boolean {
	return (
		applySubstitutions(leftName, substitutions) === rightName ||
		applySubstitutions(rightName, substitutions) === leftName
	);
}

function blobMentionsSubstitution(blob: string, substitutions: ReadonlyMap<string, string>): boolean {
	for (const old of substitutions.keys()) {
		if (blob.includes(old)) {
			return true;
		}
	}
	return false;
}

function substitutionScoreNodes(
	left: SemanticNode,
	right: SemanticNode,
	substitutions: ReadonlyMap<string, string>
): number {
	if (substitutions.size === 0) {
		return 0;
	}
	if (renamesToOneSide(left.name, right.name, substitutions)) {
		return 1;
	}
	const blob = `${left.name} ${right.name} ${left.childBlob} ${right.childBlob}`;
	return blobMentionsSubstitution(blob, substitutions) ? 0.5 : 0;
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

interface SemanticBucket {
	lefts: TreeRow[];
	rights: TreeRow[];
}

function bucketByDefinition(nodes: readonly TreeRow[]): Map<string, TreeRow[]> {
	const groups = new Map<string, TreeRow[]>();
	for (const node of nodes) {
		pushGrouped(groups, node.row.definitionRef, node);
	}
	return groups;
}

function semanticBuckets(
	lefts: readonly TreeRow[],
	rights: readonly TreeRow[]
): { normal: SemanticBucket[]; oversized: SemanticBucket[] } {
	const leftGroups = bucketByDefinition(lefts);
	const rightGroups = bucketByDefinition(rights);
	const normal: SemanticBucket[] = [];
	const oversized: SemanticBucket[] = [];
	for (const [definition, leftGroup] of leftGroups) {
		const rightGroup = rightGroups.get(definition);
		if (rightGroup === undefined) {
			continue;
		}
		const bucket = { lefts: leftGroup, rights: rightGroup };
		(bucket.lefts.length * bucket.rights.length > SEMANTIC_PAIR_LIMIT ? oversized : normal).push(bucket);
	}
	return { normal, oversized };
}

function rescoreIfLearned(pairs: SemanticPair[], bucket: SemanticBucket, context: PairContext): SemanticPair[] {
	if (context.semanticBudgetHit) {
		return pairs;
	}
	if (!learnSubstitutions(pairs, context.substitutions, 0.8, false)) {
		return pairs;
	}
	return assignSemantic(bucket.lefts, bucket.rights, context);
}

/**
 * The deadlock breaker: learn the rename from container names when child values
 * embed the old name and no high-confidence pair exists yet. It runs even after
 * another bucket taught a different substitution.
 */
function rescoreFromNames(pairs: SemanticPair[], bucket: SemanticBucket, context: PairContext): SemanticPair[] {
	if (context.semanticBudgetHit) {
		return pairs;
	}
	if (pairs.length >= Math.min(bucket.lefts.length, bucket.rights.length)) {
		return pairs;
	}
	if (!learnNameSubstitutions(bucket.lefts, bucket.rights, context.substitutions)) {
		return pairs;
	}
	return assignSemantic(bucket.lefts, bucket.rights, context);
}

/** Partial renames can hide further token changes; a small bound keeps this linear. */
function learnLoop(pairs: SemanticPair[], bucket: SemanticBucket, context: PairContext): SemanticPair[] {
	let current = pairs;
	for (let pass = 0; pass < 3; pass++) {
		if (context.semanticBudgetHit) {
			break;
		}
		if (!learnSubstitutions(current, context.substitutions, SEMANTIC_LEARN_SCORE, false)) {
			break;
		}
		current = assignSemantic(bucket.lefts, bucket.rights, context);
	}
	return current;
}

function semanticMatch(pair: SemanticPair, used: readonly string[]): DiffMatch {
	return {
		kind: 'semantic',
		score: pair.score,
		reasons: pair.reasons,
		...(used.length === 0 ? {} : { substitutions: [...used] }),
	};
}

function fallbackMatch(pair: SemanticPair): DiffMatch {
	return { kind: 'semantic', score: pair.score, reasons: pair.reasons, fallback: true };
}

function acceptPairs(pairs: readonly SemanticPair[], context: PairContext, tryPair: TryPair): void {
	for (const pair of pairs) {
		tryPair(pair.right, pair.left, semanticMatch(pair, substitutionsUsed(pair.left, pair.right, context.substitutions)));
	}
}

function noteBudgetSkipped(bucket: SemanticBucket, pairs: readonly SemanticPair[], context: PairContext): void {
	if (!context.semanticBudgetHit) {
		return;
	}
	const unpaired = unpairedCount(bucket.lefts, bucket.rights, pairs);
	context.semanticBudgetSkipped += unpaired;
	context.semanticSkipped += unpaired;
}

/** The original path: score, learn from high-confidence pairs, score again. */
function runNormalBucket(bucket: SemanticBucket, context: PairContext, tryPair: TryPair): void {
	let pairs = assignSemantic(bucket.lefts, bucket.rights, context);
	pairs = rescoreIfLearned(pairs, bucket, context);
	pairs = rescoreFromNames(pairs, bucket, context);
	pairs = learnLoop(pairs, bucket, context);
	acceptPairs(pairs, context, tryPair);
	noteBudgetSkipped(bucket, pairs, context);
}

function runOversizedBucket(bucket: SemanticBucket, context: PairContext, tryPair: TryPair): void {
	// Learn the rename from names before the name-key fallback. Without this,
	// a single above-limit bucket has no normal bucket to teach it a
	// substitution and its fallback pairs nothing.
	learnNameSubstitutions(bucket.lefts, bucket.rights, context.substitutions);
	const pairs = assignFallback(bucket.lefts, bucket.rights, context.substitutions);
	for (const pair of pairs) {
		tryPair(pair.right, pair.left, fallbackMatch(pair));
	}
	const unpaired = unpairedCount(bucket.lefts, bucket.rights, pairs);
	context.semanticFallbackSkipped += unpaired;
	context.semanticSkipped += unpaired;
}

function updateLimitReason(context: PairContext): void {
	if (context.semanticSkipped === 0) {
		return;
	}
	if (context.semanticBudgetSkipped > context.semanticFallbackSkipped) {
		context.semanticLimitReason = 'budget';
		return;
	}
	context.semanticLimitReason = context.semanticFallbackSkipped > 0 ? 'fallback' : 'budget';
}

function bothNonEmpty<T>(lefts: readonly T[], rights: readonly T[]): boolean {
	return lefts.length > 0 && rights.length > 0;
}

/** Pairs leftover modules and containers with the same parent and definition ref. */
function semanticPass(
	leftChildren: readonly TreeRow[],
	rightChildren: readonly TreeRow[],
	context: PairContext,
	tryPair: TryPair,
	matchedLeft: ReadonlySet<TreeRow>,
	matchOfRight: ReadonlyMap<TreeRow, TreeRow>
): void {
	const lefts = leftChildren.filter((node) => !matchedLeft.has(node) && isSemanticKind(node.row.kind));
	const rights = rightChildren.filter((node) => !matchOfRight.has(node) && isSemanticKind(node.row.kind));
	if (!bothNonEmpty(lefts, rights)) {
		return;
	}
	const { normal, oversized } = semanticBuckets(lefts, rights);
	// Normal buckets first: their learned substitutions are what the oversized
	// fallback applies later, independent of the definition's sort order.
	for (const bucket of normal) {
		runNormalBucket(bucket, context, tryPair);
	}
	for (const bucket of oversized) {
		runOversizedBucket(bucket, context, tryPair);
	}
	updateLimitReason(context);
}

/** Semantic pairing covers modules and containers; parameters and references stay strict. */
function isSemanticKind(kind: EcucRow['kind']): boolean {
	return kind === 'container' || kind === 'module';
}

function betterThan(current: number | undefined, value: number): boolean {
	return current === undefined || value > current;
}

function exceedsBest(current: number | undefined, value: number): boolean {
	return value > (current ?? 0);
}

/** Records the best and second-best value for one node. */
function recordTopTwo(map: Map<TreeRow, number>, second: Map<TreeRow, number>, node: TreeRow, value: number): void {
	if (betterThan(map.get(node), value)) {
		second.set(node, map.get(node) ?? 0);
		map.set(node, value);
		return;
	}
	if (exceedsBest(second.get(node), value)) {
		second.set(node, value);
	}
}

/** The subtree/visibility queries shared by both flatten passes. */
interface VisibleRows {
	subtreeEnd(index: number): number;
	hasVisibleDescendant(index: number): boolean;
}

/** Precomputes the visible prefix so a collapsed subtree check stays O(1). */
function visibleRows(rows: readonly DiffRow[], visible: readonly boolean[] | undefined): VisibleRows {
	let prefix: Int32Array | undefined;
	if (visible) {
		prefix = new Int32Array(rows.length + 1);
		for (let i = 0; i < rows.length; i++) {
			prefix[i + 1] = prefix[i] + (visible[i] ? 1 : 0);
		}
	}
	const subtreeEnd = (index: number): number =>
		Math.min(rows.length, index + Math.max(0, rows[index].subtreeSize) + 1);
	const hasVisibleDescendant = (index: number): boolean => {
		const end = subtreeEnd(index);
		if (end <= index + 1) {
			return false;
		}
		if (prefix) {
			return prefix[end] - prefix[index + 1] > 0;
		}
		return rows[index].hasChildren;
	};
	return { subtreeEnd, hasVisibleDescendant };
}

/** How many nodes a semantic pass left unpaired on both sides. */
function unpairedCount<T>(
	lefts: readonly T[],
	rights: readonly T[],
	pairs: readonly { left: T; right: T }[]
): number {
	const pairedLeft = new Set(pairs.map((pair) => pair.left));
	const pairedRight = new Set(pairs.map((pair) => pair.right));
	return lefts.length - pairedLeft.size + (rights.length - pairedRight.size);
}

/** Visits every pairing bucket present on both sides, with the shorter length. */
function forEachCommonGroup<T>(
	leftGroups: ReadonlyMap<string, readonly T[]>,
	rightGroups: ReadonlyMap<string, readonly T[]>,
	each: (leftGroup: readonly T[], rightGroup: readonly T[], common: number) => void
): void {
	for (const [key, leftGroup] of leftGroups) {
		const rightGroup = rightGroups.get(key);
		if (rightGroup === undefined) {
			continue;
		}
		each(leftGroup, rightGroup, Math.min(leftGroup.length, rightGroup.length));
	}
}

/** Groups nodes by a deterministic key, preserving their bucket order. */
function groupBy<T>(nodes: readonly T[], keyOf: (node: T) => string, skipEmpty = false): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const node of nodes) {
		const key = keyOf(node);
		if (skipEmpty && key === '') {
			continue;
		}
		pushGrouped(groups, key, node);
	}
	return groups;
}

function buildTokenPostings<T>(nodes: readonly T[], tokensOf: (node: T) => ReadonlySet<string>): Map<string, T[]> {
	const postings = new Map<string, T[]>();
	for (const node of nodes) {
		for (const token of tokensOf(node)) {
			pushGrouped(postings, token, node);
		}
	}
	return postings;
}

interface CandidateSink {
	out: Array<[SemanticNode, SemanticNode]>;
	seen: Set<string>;
	perLeft: Map<number, number>;
	context: PairContext;
}

function allCandidatePairs(
	lefts: readonly SemanticNode[],
	rights: readonly SemanticNode[]
): Array<[SemanticNode, SemanticNode]> {
	const all: Array<[SemanticNode, SemanticNode]> = [];
	for (const left of lefts) {
		for (const right of rights) {
			all.push([left, right]);
		}
	}
	return all;
}

function candidateLimitReached(sink: CandidateSink): boolean {
	return sink.out.length >= SEMANTIC_MAX_TOTAL_CANDIDATES;
}

function perLeftCount(sink: CandidateSink, left: SemanticNode): number {
	return sink.perLeft.get(left.index) ?? 0;
}

function perLeftCountReached(sink: CandidateSink, left: SemanticNode): boolean {
	return perLeftCount(sink, left) >= SEMANTIC_MAX_CANDIDATES_PER_NODE;
}

function candidateKey(left: SemanticNode, right: SemanticNode): string {
	return `${left.index}\u0000${right.index}`;
}

function notePerLeft(sink: CandidateSink, left: SemanticNode): void {
	sink.perLeft.set(left.index, perLeftCount(sink, left) + 1);
}

function addCandidate(sink: CandidateSink, left: SemanticNode, right: SemanticNode): void {
	if (candidateLimitReached(sink)) {
		sink.context.semanticBudgetHit = true;
		return;
	}
	if (perLeftCountReached(sink, left)) {
		return;
	}
	const key = candidateKey(left, right);
	if (sink.seen.has(key)) {
		return;
	}
	sink.seen.add(key);
	notePerLeft(sink, left);
	sink.out.push([left, right]);
}

function addGroupCandidates(
	sink: CandidateSink,
	leftGroup: readonly SemanticNode[],
	rightGroup: readonly SemanticNode[],
	common: number
): void {
	for (let at = 0; at < common; at++) {
		addCandidate(sink, leftGroup[at], rightGroup[at]);
	}
	// Unequal groups still get the nearest alternatives for the margin.
	for (let at = common; at < leftGroup.length; at++) {
		addCandidate(sink, leftGroup[at], rightGroup[Math.min(at, rightGroup.length - 1)]);
	}
}

function addCandidateGroups(
	sink: CandidateSink,
	lefts: readonly SemanticNode[],
	rights: readonly SemanticNode[],
	keyOf: (node: SemanticNode) => string,
	skipEmpty: boolean
): void {
	const leftGroups = groupBy(lefts, keyOf, skipEmpty);
	const rightGroups = groupBy(rights, keyOf, skipEmpty);
	forEachCommonGroup(leftGroups, rightGroups, (leftGroup, rightGroup, common) => {
		addGroupCandidates(sink, leftGroup, rightGroup, common);
	});
}

function isRareList<T>(list: readonly T[] | undefined, frequencyLimit: number): list is readonly T[] {
	return list !== undefined && list.length <= frequencyLimit;
}

function noteCandidate(candidates: Map<TreeRow, SemanticNode>, right: SemanticNode): void {
	if (candidates.has(right.tree)) {
		return;
	}
	candidates.set(right.tree, right);
}

// Rare tokens: digits usually give a cheap 1:1 ordinal seed. Suppress tokens
// common enough to produce the full product.
function rareTokenCandidates(
	left: SemanticNode,
	postings: ReadonlyMap<string, SemanticNode[]>,
	frequencyLimit: number
): SemanticNode[] {
	const candidates = new Map<TreeRow, SemanticNode>();
	for (const token of left.tokens) {
		const list = postings.get(token);
		if (!isRareList(list, frequencyLimit)) {
			continue;
		}
		for (const right of list) {
			noteCandidate(candidates, right);
		}
	}
	return [...candidates.values()]
		.sort(
			(a, b) => tokenJaccard(left.tokens, b.tokens) - tokenJaccard(left.tokens, a.tokens) || a.index - b.index
		)
		.slice(0, SEMANTIC_MAX_CANDIDATES_PER_NODE);
}

function addTokenCandidates(
	sink: CandidateSink,
	lefts: readonly SemanticNode[],
	rights: readonly SemanticNode[]
): void {
	const postings = buildTokenPostings(rights, (right) => right.tokens);
	const frequencyLimit = Math.max(32, Math.ceil(rights.length * 0.1));
	for (const left of lefts) {
		for (const right of rareTokenCandidates(left, postings, frequencyLimit)) {
			addCandidate(sink, left, right);
		}
	}
}

function directionsAt(offset: number): readonly number[] {
	return offset === 0 ? [0] : [-1, 1];
}

function addAtOffset(
	sink: CandidateSink,
	left: SemanticNode,
	rights: readonly SemanticNode[],
	direction: number,
	offset: number
): void {
	const at = left.index + direction * offset;
	if (at >= 0 && at < rights.length) {
		addCandidate(sink, left, rights[at]);
	}
}

function addNeighbourOffsets(sink: CandidateSink, left: SemanticNode, rights: readonly SemanticNode[]): void {
	for (let offset = 0; offset <= SEMANTIC_POSITION_NEIGHBOURS; offset++) {
		for (const direction of directionsAt(offset)) {
			addAtOffset(sink, left, rights, direction, offset);
		}
	}
}

// Every left needs at least a second candidate for the near-tie margin, even
// when no signature/child/token candidate exists.
function addPositionNeighbours(sink: CandidateSink, lefts: readonly SemanticNode[], rights: readonly SemanticNode[]): void {
	for (const left of lefts) {
		if (perLeftCount(sink, left) >= 2) {
			continue;
		}
		addNeighbourOffsets(sink, left, rights);
	}
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
		return allCandidatePairs(lefts, rights);
	}
	const sink: CandidateSink = { out: [], seen: new Set(), perLeft: new Map(), context };
	addCandidateGroups(sink, lefts, rights, (node) => node.signature, false);
	addCandidateGroups(sink, lefts, rights, (node) => node.childKeySignature, true);
	addTokenCandidates(sink, lefts, rights);
	addPositionNeighbours(sink, lefts, rights);
	return sink.out;
}

interface CandidateScores {
	bestLeft: Map<TreeRow, number>;
	secondLeft: Map<TreeRow, number>;
	bestRight: Map<TreeRow, number>;
	secondRight: Map<TreeRow, number>;
}

function candidateScores(candidates: readonly SemanticPair[]): CandidateScores {
	const scores: CandidateScores = {
		bestLeft: new Map(),
		secondLeft: new Map(),
		bestRight: new Map(),
		secondRight: new Map(),
	};
	for (const candidate of candidates) {
		recordTopTwo(scores.bestLeft, scores.secondLeft, candidate.left, candidate.score);
		recordTopTwo(scores.bestRight, scores.secondRight, candidate.right, candidate.score);
	}
	return scores;
}

function marginOf(
	best: ReadonlyMap<TreeRow, number>,
	second: ReadonlyMap<TreeRow, number>,
	node: TreeRow
): number {
	return (best.get(node) ?? 0) - (second.get(node) ?? 0);
}

function acceptedCandidate(candidate: SemanticPair, scores: CandidateScores): boolean {
	if (candidate.score < SEMANTIC_SCORE_FLOOR) {
		return false;
	}
	return (
		marginOf(scores.bestLeft, scores.secondLeft, candidate.left) >= SEMANTIC_MARGIN &&
		marginOf(scores.bestRight, scores.secondRight, candidate.right) >= SEMANTIC_MARGIN
	);
}

function compareSemanticPairs(a: SemanticPair, b: SemanticPair): number {
	return (
		b.score - a.score ||
		relativeId(a.left.row.id).localeCompare(relativeId(b.left.row.id)) ||
		relativeId(a.right.row.id).localeCompare(relativeId(b.right.row.id))
	);
}

function greedyPairs(accepted: readonly SemanticPair[]): SemanticPair[] {
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

function budgetSlice(
	candidateNodes: ReadonlyArray<[SemanticNode, SemanticNode]>,
	context: PairContext
): { considered: ReadonlyArray<[SemanticNode, SemanticNode]>; budgetLimited: boolean } {
	const remainingBudget = Math.max(0, context.semanticBudgetLimit - context.semanticBudgetUsed);
	const budgetLimited = candidateNodes.length > remainingBudget;
	const considered = budgetLimited ? candidateNodes.slice(0, remainingBudget) : candidateNodes;
	if (budgetLimited) {
		context.semanticBudgetHit = true;
	}
	context.semanticBudgetUsed += considered.length;
	return { considered, budgetLimited };
}

function scoreCandidates(
	considered: ReadonlyArray<[SemanticNode, SemanticNode]>,
	leftNodes: readonly SemanticNode[],
	rightNodes: readonly SemanticNode[],
	substitutions: ReadonlyMap<string, string>
): SemanticPair[] {
	const candidates: SemanticPair[] = [];
	for (const [left, right] of considered) {
		candidates.push({
			left: left.tree,
			right: right.tree,
			...scoreSemanticNode(left, right, leftNodes.length, rightNodes.length, substitutions),
		});
	}
	return candidates;
}

function treesIndex(trees: readonly TreeRow[]): Map<TreeRow, number> {
	const index = new Map<TreeRow, number>();
	trees.forEach((node, at) => index.set(node, at));
	return index;
}

function allChildrenIdentical(candidates: readonly SemanticPair[]): boolean {
	return candidates.every((candidate) => candidate.reasons.children >= 0.99);
}

function remainingPairs(
	lefts: readonly TreeRow[],
	rights: readonly TreeRow[],
	pairs: readonly SemanticPair[]
): { left: TreeRow[]; right: TreeRow[] } {
	const usedLeft = new Set(pairs.map((pair) => pair.left));
	const usedRight = new Set(pairs.map((pair) => pair.right));
	return {
		left: lefts.filter((node) => !usedLeft.has(node)),
		right: rights.filter((node) => !usedRight.has(node)),
	};
}

// Identical children make every pair score the same, so the 0.08 margin can
// never accept one. Pair the leftovers by name, then by ordinal position.
function mergeIdenticalChildren(
	out: SemanticPair[],
	lefts: readonly TreeRow[],
	rights: readonly TreeRow[],
	candidates: readonly SemanticPair[],
	context: PairContext
): SemanticPair[] {
	const { left: remainingLeft, right: remainingRight } = remainingPairs(lefts, rights, out);
	if (remainingLeft.length === 0 || remainingRight.length === 0 || !allChildrenIdentical(candidates)) {
		return out;
	}
	const extra = assignIdenticalChildren(
		remainingLeft,
		remainingRight,
		treesIndex(lefts),
		treesIndex(rights),
		context.substitutions
	);
	return [...out, ...extra];
}

/** Scores and greedily assigns one bucket. Near-ties stay unpaired, except for identical children. */
function assignSemantic(lefts: readonly TreeRow[], rights: readonly TreeRow[], context: PairContext): SemanticPair[] {
	const leftNodes = semanticNodes(lefts, context.substitutions);
	const rightNodes = semanticNodes(rights, context.substitutions);
	const candidateNodes = collectSemanticCandidates(leftNodes, rightNodes, context);
	if (candidateNodes.length === 0) {
		return [];
	}
	const { considered, budgetLimited } = budgetSlice(candidateNodes, context);
	const candidates = scoreCandidates(considered, leftNodes, rightNodes, context.substitutions);
	if (candidates.length === 0) {
		return [];
	}
	const scores = candidateScores(candidates);
	const accepted = candidates
		.filter((candidate) => acceptedCandidate(candidate, scores))
		.sort(compareSemanticPairs);
	const out = greedyPairs(accepted);
	if (budgetLimited) {
		return out;
	}
	return mergeIdenticalChildren(out, lefts, rights, candidates, context);
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
		forEachCommonGroup(leftGroups, rightGroups, (leftGroup, rightGroup, common) => {
			for (let at = 0; at < common; at++) {
				pair(leftGroup[at], rightGroup[at]);
			}
		});
	};

	pairGroups(substitutedName);
	pairGroups(normalized);
	// Anything left is paired by ordinal position, but only when the names are
	// still plausibly related; identical children alone must not invent a pair.
	const { left: remainingLeft, right: remainingRight } = remainingPairs(lefts, rights, out);
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

interface NamedScore {
	node: TreeRow;
	score: number;
}

function tokenSetOf(map: ReadonlyMap<TreeRow, Set<string>>, node: TreeRow): Set<string> {
	return map.get(node) ?? new Set<string>();
}

function substitutionTokenSets(
	nodes: readonly TreeRow[],
	substitutions: ReadonlyMap<string, string>
): Map<TreeRow, Set<string>> {
	const out = new Map<TreeRow, Set<string>>();
	for (const node of nodes) {
		out.set(node, new Set(tokensOf(applySubstitutions(nameOf(node), substitutions).toLowerCase())));
	}
	return out;
}

function rememberBest(map: Map<TreeRow, NamedScore>, from: TreeRow, to: TreeRow, score: number): void {
	const current = map.get(from);
	if (current === undefined || score > current.score) {
		map.set(from, { node: to, score });
	}
}

function noteNameCandidate(
	candidates: Map<TreeRow, number>,
	leftTokens: ReadonlySet<string>,
	rightTokens: ReadonlyMap<TreeRow, Set<string>>,
	right: TreeRow
): void {
	if (candidates.has(right)) {
		return;
	}
	candidates.set(right, tokenJaccard(leftTokens, tokenSetOf(rightTokens, right)));
}

function tokenCandidateScores(
	leftTokens: ReadonlySet<string>,
	rightTokens: ReadonlyMap<TreeRow, Set<string>>,
	rights: readonly TreeRow[],
	postings: ReadonlyMap<string, TreeRow[]>,
	frequencyLimit: number
): Map<TreeRow, number> {
	const candidates = new Map<TreeRow, number>();
	for (const token of leftTokens) {
		const list = postings.get(token);
		if (!isRareList(list, frequencyLimit)) {
			continue;
		}
		for (const right of list) {
			noteNameCandidate(candidates, leftTokens, rightTokens, right);
		}
	}
	return candidates;
}

function atIndex<T>(items: readonly T[], at: number): T | undefined {
	return at >= 0 && at < items.length ? items[at] : undefined;
}

// A bucket with no rare token still gets a few position alternatives.
function fillPositionAlternatives(
	candidates: Map<TreeRow, number>,
	leftTokens: ReadonlySet<string>,
	leftAt: number,
	rights: readonly TreeRow[],
	rightTokens: ReadonlyMap<TreeRow, Set<string>>
): void {
	if (candidates.size >= 2) {
		return;
	}
	for (const offset of [0, -1, 1]) {
		const right = atIndex(rights, leftAt + offset);
		if (right !== undefined) {
			noteNameCandidate(candidates, leftTokens, rightTokens, right);
		}
	}
}

function compareNamedCandidates([aNode, aScore]: [TreeRow, number], [bNode, bScore]: [TreeRow, number]): number {
	return bScore - aScore || aNode.row.id.localeCompare(bNode.row.id);
}

function rememberRankedCandidates(
	bestRight: Map<TreeRow, NamedScore>,
	bestLeft: Map<TreeRow, NamedScore>,
	left: TreeRow,
	candidates: ReadonlyMap<TreeRow, number>
): void {
	const ranked = [...candidates.entries()].sort(compareNamedCandidates).slice(0, 16);
	for (const [right, score] of ranked) {
		if (score > 0) {
			rememberBest(bestRight, left, right, score);
			rememberBest(bestLeft, right, left, score);
		}
	}
}

function nameBestScores(
	lefts: readonly TreeRow[],
	rights: readonly TreeRow[],
	leftTokens: ReadonlyMap<TreeRow, Set<string>>,
	rightTokens: ReadonlyMap<TreeRow, Set<string>>,
	postings: ReadonlyMap<string, TreeRow[]>
): { bestLeft: Map<TreeRow, NamedScore>; bestRight: Map<TreeRow, NamedScore> } {
	const frequencyLimit = Math.max(32, Math.ceil(rights.length * 0.1));
	const bestRight = new Map<TreeRow, NamedScore>();
	const bestLeft = new Map<TreeRow, NamedScore>();
	for (let leftAt = 0; leftAt < lefts.length; leftAt++) {
		const left = lefts[leftAt];
		const tokens = tokenSetOf(leftTokens, left);
		const candidates = tokenCandidateScores(tokens, rightTokens, rights, postings, frequencyLimit);
		fillPositionAlternatives(candidates, tokens, leftAt, rights, rightTokens);
		rememberRankedCandidates(bestRight, bestLeft, left, candidates);
	}
	return { bestLeft, bestRight };
}

function mutualBest(
	picked: NamedScore | undefined,
	left: TreeRow,
	bestLeft: ReadonlyMap<TreeRow, NamedScore>
): picked is NamedScore {
	return picked !== undefined && bestLeft.get(picked.node)?.node === left;
}

function nameSeed(left: TreeRow, right: TreeRow, score: number): SemanticPair {
	return {
		left,
		right,
		score,
		reasons: { children: 0, name: round(score), position: 0, substitution: 0 },
	};
}

function nameSeeds(
	lefts: readonly TreeRow[],
	bestLeft: ReadonlyMap<TreeRow, NamedScore>,
	bestRight: ReadonlyMap<TreeRow, NamedScore>,
	substitutions: ReadonlyMap<string, string>
): SemanticPair[] {
	const seeds: SemanticPair[] = [];
	for (const left of lefts) {
		const picked = bestRight.get(left);
		if (!mutualBest(picked, left, bestLeft)) {
			continue;
		}
		// Jaccard chooses the mutual-best pair; the full name score gates learning.
		const score = nameScore(left, picked.node, substitutions);
		if (score >= SEMANTIC_NAME_SEED_FLOOR) {
			seeds.push(nameSeed(left, picked.node, score));
		}
	}
	return seeds;
}

/** Learns token changes from mutual-best name pairs, before child values are scored. */
function learnNameSubstitutions(
	lefts: readonly TreeRow[],
	rights: readonly TreeRow[],
	substitutions: Map<string, string>
): boolean {
	const leftTokens = substitutionTokenSets(lefts, substitutions);
	const rightTokens = substitutionTokenSets(rights, substitutions);

	// Inverted index over the right side. A token shared by more than a tenth of
	// the bucket is a stop token; the unique ordinal token still gives a seed.
	const postings = buildTokenPostings(rights, (right) => tokenSetOf(rightTokens, right));
	const { bestLeft, bestRight } = nameBestScores(lefts, rights, leftTokens, rightTokens, postings);
	return learnSubstitutions(
		nameSeeds(lefts, bestLeft, bestRight, substitutions),
		substitutions,
		SEMANTIC_NAME_SEED_FLOOR,
		true
	);
}

function tokenJaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
	if (left.size === 0 || right.size === 0) {
		return 0;
	}
	const intersection = tokenIntersection(left, right);
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
	if (renamesToOneSide(leftName, rightName, substitutions)) {
		return 1;
	}
	const blob = `${leftName} ${rightName} ${childBlob(left)} ${childBlob(right)}`;
	return blobMentionsSubstitution(blob, substitutions) ? 0.5 : 0;
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

interface SubstitutionTally {
	counts: Map<string, Map<string, number>>;
	totals: Map<string, number>;
	/** True when this token came from a seed with exactly one usable token change. */
	sole: Map<string, boolean>;
}

interface SubstitutionCandidate {
	old: string;
	next: string;
	count: number;
}

function isNumericToken(text: string): boolean {
	return /^\d+$/.test(text);
}

function isUsableChange(old: string, next: string): boolean {
	return old.length >= 2 && next.length >= 2 && !isNumericToken(old) && !isNumericToken(next);
}

function usableTokenChanges(left: string, right: string): Array<[string, string]> {
	return tokenChanges(left, right).filter(([old, next]) => isUsableChange(old, next));
}

function recordTokenChange(tally: SubstitutionTally, old: string, next: string): void {
	tally.totals.set(old, (tally.totals.get(old) ?? 0) + 1);
	const byNext = tally.counts.get(old) ?? new Map<string, number>();
	byNext.set(next, (byNext.get(next) ?? 0) + 1);
	tally.counts.set(old, byNext);
}

function soleNotContradicted(tally: SubstitutionTally, old: string): boolean {
	return tally.sole.get(old) !== false;
}

function clearSoleFor(tally: SubstitutionTally, changes: ReadonlyArray<[string, string]>): void {
	for (const [old] of changes) {
		tally.sole.set(old, false);
	}
}

function noteSole(tally: SubstitutionTally, changes: ReadonlyArray<[string, string]>): void {
	if (changes.length === 1 && soleNotContradicted(tally, changes[0][0])) {
		tally.sole.set(changes[0][0], true);
		return;
	}
	if (changes.length > 1) {
		clearSoleFor(tally, changes);
	}
}

function tallySeed(tally: SubstitutionTally, seed: SemanticPair, minScore: number): void {
	if (seed.score < minScore) {
		return;
	}
	const leftName = nameOf(seed.left);
	const rightName = nameOf(seed.right);
	if (leftName === rightName) {
		return;
	}
	const changes = usableTokenChanges(leftName, rightName);
	for (const [old, next] of changes) {
		recordTokenChange(tally, old, next);
	}
	noteSole(tally, changes);
}

function isBetterNext(count: number, next: string, bestCount: number, bestNext: string): boolean {
	return count > bestCount || (count === bestCount && next < bestNext);
}

function bestNextOf(byNext: ReadonlyMap<string, number>): { next: string; count: number } {
	let bestNext = '';
	let bestCount = 0;
	for (const [next, count] of byNext) {
		if (isBetterNext(count, next, bestCount, bestNext)) {
			bestNext = next;
			bestCount = count;
		}
	}
	return { next: bestNext, count: bestCount };
}

function isConsistent(bestCount: number, total: number): boolean {
	return bestCount >= 2 && bestCount / Math.max(1, total) >= 0.6;
}

function isUniqueChange(count: number, total: number, byNextSize: number): boolean {
	return count === 1 && total === 1 && byNextSize === 1;
}

// A single mutual-best name pair is enough when it changed exactly one token.
function isSingleChange(
	allowSingle: boolean,
	count: number,
	total: number,
	byNextSize: number,
	sole: boolean | undefined
): boolean {
	return allowSingle && isUniqueChange(count, total, byNextSize) && sole === true;
}

function substitutionCandidate(
	old: string,
	byNext: ReadonlyMap<string, number>,
	tally: SubstitutionTally,
	allowSingle: boolean
): SubstitutionCandidate | undefined {
	const best = bestNextOf(byNext);
	const total = tally.totals.get(old) ?? 0;
	if (isConsistent(best.count, total) || isSingleChange(allowSingle, best.count, total, byNext.size, tally.sole.get(old))) {
		return { old, next: best.next, count: best.count };
	}
	return undefined;
}

function collectSubstitutionCandidates(tally: SubstitutionTally, allowSingle: boolean): SubstitutionCandidate[] {
	const candidates: SubstitutionCandidate[] = [];
	for (const [old, byNext] of tally.counts) {
		const candidate = substitutionCandidate(old, byNext, tally, allowSingle);
		if (candidate !== undefined) {
			candidates.push(candidate);
		}
	}
	return candidates;
}

function compareSubstitutionCandidates(a: SubstitutionCandidate, b: SubstitutionCandidate): number {
	return b.count - a.count || a.old.localeCompare(b.old);
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
	const tally: SubstitutionTally = { counts: new Map(), totals: new Map(), sole: new Map() };
	for (const seed of seeds) {
		tallySeed(tally, seed, minScore);
	}
	const candidates = collectSubstitutionCandidates(tally, allowSingle);
	candidates.sort(compareSubstitutionCandidates);
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
function applySubstitutions(text: string, substitutions: ReadonlyMap<string, string>): string {
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

function editDistanceAt(
	previous: readonly number[],
	current: readonly number[],
	left: string,
	right: string,
	row: number,
	column: number
): number {
	return Math.min(
		previous[column] + 1,
		current[column - 1] + 1,
		previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
	);
}

function copyRow(from: readonly number[], to: number[]): void {
	for (let at = 0; at < from.length; at++) {
		to[at] = from[at];
	}
}

function levenshtein(left: string, right: string): number {
	const previous = new Array<number>(right.length + 1);
	const current = new Array<number>(right.length + 1);
	for (let column = 0; column <= right.length; column++) {
		previous[column] = column;
	}
	for (let row = 1; row <= left.length; row++) {
		current[0] = row;
		for (let column = 1; column <= right.length; column++) {
			current[column] = editDistanceAt(previous, current, left, right, row, column);
		}
		copyRow(current, previous);
	}
	return previous[right.length];
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function cellMetaTexts(cell: DiffCell): string[] {
	return cell.meta ? cell.meta.map((part) => part.text) : [];
}

function haystackOf(cell: DiffCell | undefined): string {
	if (!cell) {
		return '';
	}
	return [cell.label, cell.shortName ?? '', cell.shownValue ?? '', ...cellMetaTexts(cell)]
		.filter((part) => part !== '')
		.join(' ');
}

function rowHaystack(left: DiffCell | undefined, right: DiffCell | undefined): string {
	return [haystackOf(left), haystackOf(right)].filter((part) => part !== '').join(' ').toLowerCase();
}

/** Added rows live in their own key namespace (see `sideNode`). */
const ADDED_KEY_PREFIX = 'right:';

function matchPart(match: DiffMatch | undefined): { match?: DiffMatch } {
	return match === undefined ? {} : { match };
}

function childContextFor(match: DiffMatch | undefined, context: PairContext): PairContext {
	return match?.kind === 'semantic' ? { ...context, relative: true } : context;
}

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
	const childContext = childContextFor(match, context);
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
		...matchPart(match),
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

function matchOfLeftMap(matchOfRight: ReadonlyMap<TreeRow, TreeRow>): Map<TreeRow, TreeRow> {
	const matchOfLeft = new Map<TreeRow, TreeRow>();
	for (const [right, left] of matchOfRight) {
		matchOfLeft.set(left, right);
	}
	return matchOfLeft;
}

/**
 * Right-only rows queue behind the nearest earlier right sibling that paired
 * with a left row; `null` is "before the first left child".
 */
function rightOnlyByPrevious(
	rightChildren: readonly TreeRow[],
	matchOfRight: ReadonlyMap<TreeRow, TreeRow>
): Map<string | null, TreeRow[]> {
	const groups = new Map<string | null, TreeRow[]>();
	let previousMatchedLeftId: string | null = null;
	for (const right of rightChildren) {
		const left = matchOfRight.get(right);
		if (left) {
			previousMatchedLeftId = left.row.id;
			continue;
		}
		pushGrouped(groups, previousMatchedLeftId, right);
	}
	return groups;
}

function pushSideNodes(
	out: MergedNode[],
	trees: readonly TreeRow[],
	status: 'added' | 'removed',
	ranges: RangeLookup,
	context: PairContext
): void {
	for (const tree of trees) {
		out.push(sideNode(tree, status, ranges, context));
	}
}

function additionsFor(
	groups: ReadonlyMap<string | null, TreeRow[]>,
	key: string | null
): readonly TreeRow[] {
	return groups.get(key) ?? [];
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
	const matchOfLeft = matchOfLeftMap(matchOfRight);
	const rightOnly = rightOnlyByPrevious(rightChildren, matchOfRight);

	const out: MergedNode[] = [];
	pushSideNodes(out, additionsFor(rightOnly, null), 'added', rightRanges, context);
	for (const left of leftChildren) {
		const right = matchOfLeft.get(left);
		if (right) {
			out.push(pairedNode(left, right, leftRanges, rightRanges, context, matches.get(left)));
		} else {
			out.push(sideNode(left, 'removed', leftRanges, context));
		}
		pushSideNodes(out, additionsFor(rightOnly, left.row.id), 'added', rightRanges, context);
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

const NO_RANGE: RangeLookup = () => undefined;

function limitPart(reason: SemanticLimitReason | undefined): { semanticLimitReason?: SemanticLimitReason } {
	return reason === undefined ? {} : { semanticLimitReason: reason };
}

function diffRowsWithMetrics(
	leftRows: readonly EcucRow[],
	rightRows: readonly EcucRow[],
	leftRanges?: RangeLookup,
	rightRanges?: RangeLookup,
	options: DiffOptions = {}
): DiffRowsResult {
	const leftLookup: RangeLookup = leftRanges ?? NO_RANGE;
	const rightLookup: RangeLookup = rightRanges ?? NO_RANGE;
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
		...limitPart(context.semanticLimitReason),
	};
}

/** Counts every row with a status, descendants included. */
function summarizeDiff(rows: readonly DiffRow[]): DiffSummary {
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

function keyIndexes(rows: readonly DiffRow[]): Map<string, number> {
	const byKey = new Map<string, number>();
	for (let i = 0; i < rows.length; i++) {
		byKey.set(rows[i].key, i);
	}
	return byKey;
}

function parentIndexOf(rows: readonly DiffRow[], byKey: ReadonlyMap<string, number>, index: number): number {
	const parentKey = rows[index].parentKey;
	return parentKey === null ? -1 : (byKey.get(parentKey) ?? -1);
}

function parentIndexes(rows: readonly DiffRow[]): Int32Array {
	const parentIndex = new Int32Array(rows.length).fill(-1);
	const byKey = keyIndexes(rows);
	for (let i = 0; i < rows.length; i++) {
		parentIndex[i] = parentIndexOf(rows, byKey, i);
	}
	return parentIndex;
}

function markVisibleWithAncestors(
	visible: boolean[],
	parentIndex: Int32Array,
	index: number
): void {
	visible[index] = true;
	let parent = parentIndex[index];
	while (parent >= 0 && !visible[parent]) {
		visible[parent] = true;
		parent = parentIndex[parent];
	}
}

function changeOrBelow(row: DiffRow, below: readonly boolean[], index: number): boolean {
	return row.status !== 'unchanged' || below[index];
}

function markChangesAndAncestors(rows: readonly DiffRow[], parentIndex: Int32Array): boolean[] {
	const visible = new Array<boolean>(rows.length).fill(false);
	const below = new Array<boolean>(rows.length).fill(false);
	for (let i = rows.length - 1; i >= 0; i--) {
		const show = changeOrBelow(rows[i], below, i);
		visible[i] = show;
		if (show && parentIndex[i] >= 0) {
			below[parentIndex[i]] = true;
		}
	}
	return visible;
}

function markWindow(
	visible: boolean[],
	parentIndex: Int32Array,
	index: number,
	context: number,
	count: number
): void {
	const start = Math.max(0, index - context);
	const end = Math.min(count, index + context + 1);
	for (let at = start; at < end; at++) {
		markVisibleWithAncestors(visible, parentIndex, at);
	}
}

function markContext(
	rows: readonly DiffRow[],
	visible: boolean[],
	parentIndex: Int32Array,
	contextLines: number
): void {
	const context = Math.max(0, Math.floor(contextLines));
	if (context <= 0) {
		return;
	}
	for (let i = 0; i < rows.length; i++) {
		if (rows[i].status === 'unchanged') {
			continue;
		}
		markWindow(visible, parentIndex, i, context, rows.length);
	}
}

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
	if (!changesOnly) {
		return new Array<boolean>(rows.length).fill(true);
	}
	const parentIndex = parentIndexes(rows);
	const visible = markChangesAndAncestors(rows, parentIndex);
	markContext(rows, visible, parentIndex, contextLines);
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
	/** Present only on the shared blank row between module groups. */
	moduleGap?: boolean;
	guidesLeft: { level: number; id: string }[];
	guidesRight: { level: number; id: string }[];
}

interface OpenGuide {
	level: number;
	id: string;
}

interface GapPlan {
	gaps: DiffGap[];
	effectiveVisible: readonly boolean[] | undefined;
	gapByStart: Map<number, DiffGap> | undefined;
}

interface DisplayWalk {
	rows: readonly DiffRow[];
	collapsed: ReadonlySet<string> | undefined;
	moduleGaps: boolean;
	gaps: ReadonlyMap<number, DiffGap> | undefined;
	visible: readonly boolean[] | undefined;
	subtreeEnd(index: number): number;
	hasVisibleDescendant(index: number): boolean;
	out: DiffDisplayRow[];
	hasModule: boolean;
}

function skipVisible(visible: readonly boolean[], index: number): number {
	let at = index;
	while (at < visible.length && visible[at]) {
		at++;
	}
	return at;
}

function hiddenRunEnd(visible: readonly boolean[], from: number): number {
	let to = from;
	while (to < visible.length && !visible[to]) {
		to++;
	}
	return to;
}

function gapAt(
	expandedGaps: ReadonlySet<string> | undefined,
	rows: readonly DiffRow[],
	from: number,
	to: number
): DiffGap {
	const key = `gap:${rows[from].key}`;
	return { key, from, to, count: to - from, expanded: expandedGaps?.has(key) === true };
}

function collectGaps(
	rows: readonly DiffRow[],
	visible: readonly boolean[],
	expandedGaps: ReadonlySet<string> | undefined
): DiffGap[] {
	const gaps: DiffGap[] = [];
	let index = 0;
	while (index < rows.length) {
		index = skipVisible(visible, index);
		const to = hiddenRunEnd(visible, index);
		if (to > index) {
			gaps.push(gapAt(expandedGaps, rows, index, to));
		}
		index = to;
	}
	return gaps;
}

function expandGaps(visible: readonly boolean[], gaps: readonly DiffGap[]): boolean[] {
	const next = visible.slice();
	for (const gap of gaps) {
		if (!gap.expanded) {
			continue;
		}
		for (let at = gap.from; at < gap.to; at++) {
			next[at] = true;
		}
	}
	return next;
}

function gapPlan(
	rows: readonly DiffRow[],
	visible: readonly boolean[] | undefined,
	expandedGaps: ReadonlySet<string> | undefined
): GapPlan {
	if (visible === undefined) {
		return { gaps: [], effectiveVisible: visible, gapByStart: undefined };
	}
	const gaps = collectGaps(rows, visible, expandedGaps);
	if (gaps.length === 0) {
		return { gaps, effectiveVisible: visible, gapByStart: undefined };
	}
	return {
		gaps,
		effectiveVisible: expandGaps(visible, gaps),
		gapByStart: new Map(gaps.map((gap) => [gap.from, gap])),
	};
}

function gapDisplayRow(
	rows: readonly DiffRow[],
	gap: DiffGap,
	leftOpen: readonly OpenGuide[],
	rightOpen: readonly OpenGuide[]
): DiffDisplayRow {
	return {
		rowIndex: gap.from,
		level: rows[gap.from].level,
		left: 'gap',
		right: 'gap',
		expanded: gap.expanded,
		gap,
		guidesLeft: leftOpen.slice(),
		guidesRight: rightOpen.slice(),
	};
}

function commentsOf(cell: DiffCell | undefined): readonly string[] {
	return cell?.comments ?? [];
}

function commentAt(items: readonly string[], at: number): string | undefined {
	return at < items.length ? items[at] : undefined;
}

function commentSide(items: readonly string[], at: number, kind: 'comment' | 'blank'): 'comment' | 'blank' {
	return at < items.length ? kind : 'blank';
}

function commentRows(
	index: number,
	row: DiffRow,
	leftOpen: readonly OpenGuide[],
	rightOpen: readonly OpenGuide[]
): DiffDisplayRow[] {
	const leftComments = commentsOf(row.left);
	const rightComments = commentsOf(row.right);
	const count = Math.max(leftComments.length, rightComments.length);
	const out: DiffDisplayRow[] = [];
	for (let at = 0; at < count; at++) {
		out.push({
			rowIndex: index,
			level: row.level,
			left: commentSide(leftComments, at, 'comment'),
			right: commentSide(rightComments, at, 'comment'),
			commentLeft: commentAt(leftComments, at),
			commentRight: commentAt(rightComments, at),
			expanded: false,
			guidesLeft: leftOpen.slice(),
			guidesRight: rightOpen.slice(),
		});
	}
	return out;
}

function nodeDisplayRow(
	index: number,
	row: DiffRow,
	expanded: boolean,
	leftOpen: readonly OpenGuide[],
	rightOpen: readonly OpenGuide[]
): DiffDisplayRow {
	return {
		rowIndex: index,
		level: row.level,
		left: row.left ? 'node' : 'blank',
		right: row.right ? 'node' : 'blank',
		expanded,
		guidesLeft: leftOpen.slice(),
		guidesRight: rightOpen.slice(),
	};
}

function braceDisplayRow(
	index: number,
	row: DiffRow,
	kind: 'brace-open' | 'brace-close',
	leftOpen: readonly OpenGuide[],
	rightOpen: readonly OpenGuide[]
): DiffDisplayRow {
	return {
		rowIndex: index,
		level: row.level,
		left: row.left ? kind : 'blank',
		right: row.right ? kind : 'blank',
		expanded: false,
		guidesLeft: leftOpen.slice(),
		guidesRight: rightOpen.slice(),
	};
}

function childGuides(hasSide: boolean, open: OpenGuide[], level: number, key: string): OpenGuide[] {
	return hasSide ? open.concat([{ level, id: key }]) : open;
}

function startsModule(
	row: DiffRow,
	leftOpen: readonly OpenGuide[],
	rightOpen: readonly OpenGuide[],
	moduleGaps: boolean
): boolean {
	return moduleGaps && row.kind === 'module' && leftOpen.length === 0 && rightOpen.length === 0;
}

function emitModuleGap(
	state: DisplayWalk,
	index: number,
	row: DiffRow,
	leftOpen: readonly OpenGuide[],
	rightOpen: readonly OpenGuide[]
): void {
	if (!startsModule(row, leftOpen, rightOpen, state.moduleGaps)) {
		return;
	}
	if (state.hasModule) {
		state.out.push({
			rowIndex: index,
			level: 1,
			left: 'blank',
			right: 'blank',
			expanded: false,
			moduleGap: true,
			guidesLeft: [],
			guidesRight: [],
		});
	}
	state.hasModule = true;
}

function emitCommentRows(
	state: DisplayWalk,
	index: number,
	row: DiffRow,
	leftOpen: readonly OpenGuide[],
	rightOpen: readonly OpenGuide[]
): void {
	for (const line of commentRows(index, row, leftOpen, rightOpen)) {
		state.out.push(line);
	}
}

function childEndOf(state: DisplayWalk, index: number, end: number): number {
	return Math.min(end, state.subtreeEnd(index));
}

function walkNode(
	state: DisplayWalk,
	index: number,
	end: number,
	leftOpen: OpenGuide[],
	rightOpen: OpenGuide[]
): number {
	const row = state.rows[index];
	emitModuleGap(state, index, row, leftOpen, rightOpen);
	emitCommentRows(state, index, row, leftOpen, rightOpen);
	const expanded = isExpandedRow(row, index, state.collapsed, state.hasVisibleDescendant);
	state.out.push(nodeDisplayRow(index, row, expanded, leftOpen, rightOpen));
	if (!expanded) {
		return childEndOf(state, index, end);
	}
	state.out.push(braceDisplayRow(index, row, 'brace-open', leftOpen, rightOpen));
	const childLeft = childGuides(row.left !== undefined, leftOpen, row.level, row.key);
	const childRight = childGuides(row.right !== undefined, rightOpen, row.level, row.key);
	const next = walkLevel(state, index + 1, childEndOf(state, index, end), childLeft, childRight);
	state.out.push(braceDisplayRow(index, row, 'brace-close', leftOpen, rightOpen));
	return next;
}

function gapStep(
	state: DisplayWalk,
	index: number,
	end: number,
	gap: DiffGap,
	leftOpen: OpenGuide[],
	rightOpen: OpenGuide[]
): number {
	state.out.push(gapDisplayRow(state.rows, gap, leftOpen, rightOpen));
	if (!gap.expanded) {
		return Math.min(end, gap.to);
	}
	return walkNode(state, index, end, leftOpen, rightOpen);
}

function walkStep(
	state: DisplayWalk,
	index: number,
	end: number,
	leftOpen: OpenGuide[],
	rightOpen: OpenGuide[]
): number {
	const gap = state.gaps?.get(index);
	if (gap !== undefined) {
		return gapStep(state, index, end, gap, leftOpen, rightOpen);
	}
	if (isHiddenRow(state.visible, index)) {
		return childEndOf(state, index, end);
	}
	return walkNode(state, index, end, leftOpen, rightOpen);
}

function walkLevel(
	state: DisplayWalk,
	start: number,
	end: number,
	leftOpen: OpenGuide[],
	rightOpen: OpenGuide[]
): number {
	let index = start;
	while (index < end) {
		index = walkStep(state, index, end, leftOpen, rightOpen);
	}
	return index;
}

/**
 * The structural display list: annotations, node rows and brace rows for both
 * sides, aligned into one list so the panes share row positions and the
 * virtual window. A side that lacks a structural row gets a blank cell.
 *
 * When a visibility map hides a run, the run becomes one expandable gap row.
 * An expanded gap keeps its header and walks the hidden rows, so the same row
 * can collapse them again.
 *
 * With `moduleGaps`, one shared blank row is inserted before the first visible
 * line of every module after the first. The gap is not a change row: it carries
 * no key, status or search candidate, and a hidden module neither shows a gap nor
 * counts as the first seen module.
 */
export function flattenDiffDocument(
	rows: readonly DiffRow[],
	options: {
		collapsed?: ReadonlySet<string>;
		visible?: readonly boolean[];
		expandedGaps?: ReadonlySet<string>;
		moduleGaps?: boolean;
	} = {}
): DiffDisplayRow[] {
	const plan = gapPlan(rows, options.visible, options.expandedGaps);
	const { subtreeEnd, hasVisibleDescendant } = visibleRows(rows, plan.effectiveVisible);
	const state: DisplayWalk = {
		rows,
		collapsed: options.collapsed,
		moduleGaps: options.moduleGaps === true,
		gaps: plan.gapByStart,
		visible: plan.effectiveVisible,
		subtreeEnd,
		hasVisibleDescendant,
		out: [],
		hasModule: false,
	};
	walkLevel(state, 0, rows.length, [], []);
	return state.out;
}

function isHiddenRow(visible: readonly boolean[] | undefined, index: number): boolean {
	return visible !== undefined && !visible[index];
}

function isExpandedRow(
	row: DiffRow,
	index: number,
	collapsed: ReadonlySet<string> | undefined,
	hasVisibleDescendant: (index: number) => boolean
): boolean {
	return row.hasChildren && hasVisibleDescendant(index) && !(collapsed?.has(row.key) ?? false);
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

	const { subtreeEnd, hasVisibleDescendant } = visibleRows(rows, visible);

	const out: FlatDiffRow[] = [];
	let i = 0;
	while (i < count) {
		if (isHiddenRow(visible, i)) {
			i = subtreeEnd(i);
			continue;
		}
		const row = rows[i];
		const expanded = isExpandedRow(row, i, collapsed, hasVisibleDescendant);
		out.push({ rowIndex: i, level: row.level, expanded });
		i = expanded ? i + 1 : subtreeEnd(i);
	}
	return out;
}

function changeOrigin(from: number, count: number, direction: 1 | -1): number {
	if (from >= 0 && from < count) {
		return from;
	}
	return direction === 1 ? -1 : 0;
}

function isVisibleChange(row: DiffRow, visible: readonly boolean[] | undefined, index: number): boolean {
	return row.status !== 'unchanged' && (visible === undefined || visible[index]);
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
	const origin = changeOrigin(from, count, direction);
	for (let step = 1; step <= count; step++) {
		const index = (((origin + direction * step) % count) + count) % count;
		if (isVisibleChange(rows[index], visible, index)) {
			return index;
		}
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

function sameLabelInput(a: FileLabel, b: FileLabel): boolean {
	return a.name !== b.name || a.path === b.path;
}

function needsDeeperSuffix(
	depth: number,
	maxDepth: number,
	aParts: readonly string[],
	bParts: readonly string[]
): boolean {
	return depth < maxDepth && sameSuffix(aParts, bParts, depth);
}

/**
 * Side labels for a pair of files: the basename, unless both sides share one —
 * then the shortest trailing path suffix that tells them apart.
 */
export function disambiguatedLabels(a: FileLabel, b: FileLabel): [string, string] {
	if (sameLabelInput(a, b)) {
		return [a.name, b.name];
	}
	const aParts = pathParts(a.path);
	const bParts = pathParts(b.path);
	const maxDepth = Math.max(aParts.length, bParts.length);
	let depth = 1;
	while (needsDeeperSuffix(depth, maxDepth, aParts, bParts)) {
		depth++;
	}
	return [suffixLabel(aParts, depth, a.name), suffixLabel(bParts, depth, b.name)];
}

/** The panel title, `<left> ↔ <right>`, with same-named files disambiguated. */
export function compareTitle(left: FileLabel, right: FileLabel): string {
	const [leftLabel, rightLabel] = disambiguatedLabels(left, right);
	return `${leftLabel} ↔ ${rightLabel}`;
}
