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
 * (`diffVisibility`, `flattenDiffRows`, `nextChangeIndex`) are serialized with
 * `toString()` and unit-tested directly.
 */
import { Range } from '../core/ecuc/model';
import { EcucRow, MetaPart } from '../editor/renderRows';

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
	/** Lower-cased label + short name + shown value from both sides. */
	haystack: string;
}

export interface DiffSummary {
	changed: number;
	added: number;
	removed: number;
	unchanged: number;
}

/** A file label plus its path, the pair the title disambiguation needs. */
export interface FileLabel {
	name: string;
	path: string;
}

export interface DiffDocument {
	left: FileLabel;
	right: FileLabel;
	/** Pre-order, children contiguous. */
	rows: DiffRow[];
	summary: DiffSummary;
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
		meta: row.meta.map((part) => ({ cls: part.cls, text: part.text, title: part.title })),
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

function groupByBase(children: readonly TreeRow[]): Map<string, TreeRow[]> {
	const groups = new Map<string, TreeRow[]>();
	for (const child of children) {
		const base = baseId(child.row.id);
		const list = groups.get(base);
		if (list) {
			list.push(child);
		} else {
			groups.set(base, [child]);
		}
	}
	return groups;
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
 * design's fallback, widened to embedded parent ordinals). Returns right -> left.
 */
function pairLevel(leftChildren: readonly TreeRow[], rightChildren: readonly TreeRow[]): Map<TreeRow, TreeRow> {
	const matchOfRight = new Map<TreeRow, TreeRow>();
	const matchedLeft = new Set<TreeRow>();
	const tryPair = (right: TreeRow, left: TreeRow): boolean => {
		if (matchOfRight.has(right) || matchedLeft.has(left)) {
			return false;
		}
		matchOfRight.set(right, left);
		matchedLeft.add(left);
		return true;
	};

	const leftByBase = groupByBase(leftChildren);
	const rightByBase = groupByBase(rightChildren);
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

	const rightById = new Map<string, TreeRow>();
	for (const right of rightChildren) {
		rightById.set(right.row.id, right);
	}
	for (const left of leftChildren) {
		if (matchedLeft.has(left)) {
			continue;
		}
		const right = rightById.get(left.row.id);
		if (right) {
			tryPair(right, left);
		}
	}

	const leftRestByBase = new Map<string, TreeRow[]>();
	for (const left of leftChildren) {
		if (matchedLeft.has(left)) {
			continue;
		}
		const base = baseId(left.row.id);
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
		const base = baseId(right.row.id);
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
	return matchOfRight;
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

function pairedNode(left: TreeRow, right: TreeRow, leftRanges: RangeLookup, rightRanges: RangeLookup): MergedNode {
	const leftCell = toDiffCell(left.row, rangeOf(leftRanges, left.row.id));
	const rightCell = toDiffCell(right.row, rangeOf(rightRanges, right.row.id));
	const changes = diffChanges(leftCell, rightCell);
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
		children: mergeChildren(left.children, right.children, leftRanges, rightRanges),
	};
}

function sideNode(tree: TreeRow, status: 'added' | 'removed', ranges: RangeLookup): MergedNode {
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
		children: tree.children.map((child) => sideNode(child, status, ranges)),
	};
}

/** The merged sibling order: left order preserved, additions next to their right context. */
function mergeChildren(
	leftChildren: readonly TreeRow[],
	rightChildren: readonly TreeRow[],
	leftRanges: RangeLookup,
	rightRanges: RangeLookup
): MergedNode[] {
	const matchOfRight = pairLevel(leftChildren, rightChildren);
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
		out.push(sideNode(right, 'added', rightRanges));
	}
	for (const left of leftChildren) {
		const right = matchOfLeft.get(left);
		if (right) {
			out.push(pairedNode(left, right, leftRanges, rightRanges));
		} else {
			out.push(sideNode(left, 'removed', leftRanges));
		}
		for (const addition of rightOnlyByPrevious.get(left.row.id) ?? []) {
			out.push(sideNode(addition, 'added', rightRanges));
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
	rightRanges?: RangeLookup
): DiffRow[] {
	const leftLookup: RangeLookup = leftRanges ?? (() => undefined);
	const rightLookup: RangeLookup = rightRanges ?? (() => undefined);
	const merged = mergeChildren(treeOf(leftRows), treeOf(rightRows), leftLookup, rightLookup);
	const out: DiffRow[] = [];
	flattenMerged(merged, null, 1, out);
	return out;
}

/** Counts every row with a status, descendants included. */
export function summarizeDiff(rows: readonly DiffRow[]): DiffSummary {
	const summary: DiffSummary = { changed: 0, added: 0, removed: 0, unchanged: 0 };
	for (const row of rows) {
		summary[row.status]++;
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
	rightRanges?: RangeLookup
): DiffDocument {
	const rows = diffRows(leftRows, rightRows, leftRanges, rightRanges);
	return { left, right, rows, summary: summarizeDiff(rows) };
}

/** The page helpers below are serialized into the diff webview. */

/**
 * Changes-only visibility. Every row is visible in Show all; Show diff only keeps
 * changed/added/removed rows and marks their ancestors. Search is a jump control,
 * so it never removes a row from this list.
 */
export function diffVisibility(rows: readonly DiffRow[], changesOnly: boolean): boolean[] {
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

	const below = new Array<boolean>(count).fill(false);
	for (let i = count - 1; i >= 0; i--) {
		const self = rows[i].status !== 'unchanged';
		const show = self || below[i];
		visible[i] = show;
		if (show && parentIndex[i] >= 0) {
			below[parentIndex[i]] = true;
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

/**
 * The display list: source rows in order, subtrees skipped when collapsed or
 * hidden by the current view. `forceExpand` opens an ancestor with a visible
 * descendant without writing the collapsed set, so switching back restores
 * exactly the user's state.
 */
export function flattenDiffRows(
	rows: readonly DiffRow[],
	options: { collapsed?: ReadonlySet<string>; visible?: readonly boolean[]; forceExpand?: boolean } = {}
): FlatDiffRow[] {
	const count = rows.length;
	const collapsed = options.collapsed;
	const visible = options.visible;
	const forceExpand = options.forceExpand ?? visible !== undefined;

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
			(forceExpand || !(collapsed ? collapsed.has(row.key) : false));
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
