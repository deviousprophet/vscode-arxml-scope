/**
 * Client-side filter over the ECUC row model (child design §2.5; UX child design §7;
 * task design §4, §7).
 *
 * `haystack` is the single owner of "what a node is searched by" — label, short-name
 * and value. `renderRows` stores its result on each row, so the webview never
 * re-derives which fields are searched: it only compares the lower-cased query against
 * a row's haystack, and the two sides cannot drift.
 *
 * `matchRanges` is the single owner of "what counts as a match": filtering (here and in
 * the webview) and the `<mark>` highlighting both call it, so the two cannot disagree
 * about why a row is shown (UX child design §7).
 *
 * `filterTree` is the nested-shape helper retained for host-side callers/tests;
 * `filterRows`/`flattenRows` extend the same rules to the virtual row list: the page
 * filters the row index, keeps matches plus ancestors, and flattens the result through
 * the collapsed set. No DOM is scanned.
 */
export interface FilterFields {
	label: string;
	shortName?: string;
	value?: string;
}

/** Lower-cased search text: label, short-name and value, space separated. */
export function haystack(node: FilterFields): string {
	return [node.label, node.shortName ?? '', node.value ?? '']
		.filter((part) => part !== '')
		.join(' ')
		.toLowerCase();
}

/** An occurrence of the query, as `[start, end)` offsets into the searched text. */
export interface MatchRange {
	start: number;
	end: number;
}

/**
 * Every case-insensitive occurrence of `query` in `text`. The empty query matches
 * nothing, so the caller decides what "no filter" means. Serialized into the webview
 * with `toString()`, so filtering and highlighting share this one definition.
 */
export function matchRanges(text: string, query: string): MatchRange[] {
	const needle = query.trim().toLowerCase();
	if (needle === '') {
		return [];
	}
	const lower = text.toLowerCase();
	const ranges: MatchRange[] = [];
	let at = lower.indexOf(needle);
	while (at !== -1) {
		ranges.push({ start: at, end: at + needle.length });
		at = lower.indexOf(needle, at + needle.length);
	}
	return ranges;
}

/** True when `query` is empty, or appears in the node's label, short-name or value. */
export function matchesQuery(node: FilterFields, query: string): boolean {
	return query.trim() === '' || matchRanges(haystack(node), query).length > 0;
}

export interface FilterNode extends FilterFields {
	children?: FilterNode[];
}

/**
 * Keeps nodes that match, plus the ancestors of a match, at every level. An empty
 * query keeps the whole tree.
 */
export function filterTree(nodes: readonly FilterNode[], query: string): FilterNode[] {
	const kept: FilterNode[] = [];
	for (const node of nodes) {
		const children = node.children ? filterTree(node.children, query) : undefined;
		if (matchesQuery(node, query) || (children?.length ?? 0) > 0) {
			kept.push(children ? { ...node, children } : { ...node });
		}
	}
	return kept;
}

/**
 * Row-indexed filter/flatten engine (task design §7).
 *
 * The page no longer scans or toggles DOM nodes. A row set is indexed once
 * (`buildFilterIndex`), the query is matched against the lower-cased haystacks,
 * and the ancestors of a match are marked visible in the same backward pass.
 * `flattenRows` then turns the row order plus the collapsed set and the filter
 * visibility into the display list (nodes and, for the Document view, brace
 * rows).
 *
 * These types are structural: `renderRows.ts`'s `EcucRow` satisfies `FilterRow`
 * without importing this module's row builder, and the page can pass its own
 * row objects. No DOM is involved, so the whole engine is unit-testable and the
 * functions stay small enough to serialise into the page later.
 */

/** The row fields filtering and flattening need. `EcucRow` satisfies this. */
export interface FilterRow {
	id: string;
	parentId: string | null;
	/** 1-based tree level. */
	level: number;
	/** Descendants in display order, contiguous after the row. */
	subtreeSize: number;
	hasChildren: boolean;
	/** Lower-cased label + short name + value. */
	haystack: string;
}

/** Lower-cased haystacks, built once per row set/view. */
export interface FilterIndex {
	haystacks: string[];
}

/** The result of one query pass. */
export interface FilterResult {
	/** Rows whose own haystack contains the query. */
	matches: boolean[];
	/** Matches plus their ancestors: the rows the filter displays. */
	visible: boolean[];
	/** Number of rows that matched on their own text. */
	matchCount: number;
	/** Number of displayed rows (`matchCount` plus ancestors). */
	visibleCount: number;
}

/** Normalises every row haystack once; the query pass only lower-cases the query. */
export function buildFilterIndex(rows: readonly FilterRow[]): FilterIndex {
	return { haystacks: rows.map((row) => row.haystack.toLowerCase()) };
}

/**
 * Matches `query` against the row index and marks matches plus their ancestors
 * visible. An empty/blank query is the identity: every row matches and is
 * visible (the page keeps its existing "empty filter clears the count" rule).
 * A non-matching query leaves every flag false, so `visibleCount === 0` is the
 * explicit empty state.
 *
 * Rows must be in DFS/display order with parents before children; `parentId`
 * then gives the ancestor pass, and `subtreeSize` gives `flattenRows` its
 * collapse/filter skip.
 */
export function filterRows(
	rows: readonly FilterRow[],
	query: string,
	index?: FilterIndex
): FilterResult {
	const count = rows.length;
	const matches = new Array<boolean>(count).fill(false);
	const visible = new Array<boolean>(count).fill(false);
	const needle = query.trim().toLowerCase();
	if (needle === '') {
		matches.fill(true);
		visible.fill(true);
		return { matches, visible, matchCount: count, visibleCount: count };
	}

	const haystacks =
		index && index.haystacks.length === count
			? index.haystacks
			: rows.map((row) => row.haystack.toLowerCase());
	const parentIndex = new Int32Array(count).fill(-1);
	const byId = new Map<string, number>();
	for (let i = 0; i < count; i++) {
		byId.set(rows[i].id, i);
	}
	for (let i = 0; i < count; i++) {
		const parentId = rows[i].parentId;
		if (parentId !== null) {
			parentIndex[i] = byId.get(parentId) ?? -1;
		}
	}

	// Backward pass: a visible child makes its parent visible, so one pass marks
	// the whole ancestor chain. A matching container's unmatched children stay
	// hidden, matching the existing DOM filter semantics.
	const below = new Array<boolean>(count).fill(false);
	let matchCount = 0;
	let visibleCount = 0;
	for (let i = count - 1; i >= 0; i--) {
		const self = haystacks[i].includes(needle);
		matches[i] = self;
		const show = self || below[i];
		visible[i] = show;
		if (self) {
			matchCount++;
		}
		if (show) {
			visibleCount++;
			if (parentIndex[i] >= 0) {
				below[parentIndex[i]] = true;
			}
		}
	}
	return { matches, visible, matchCount, visibleCount };
}

/** A displayed node row: `rowIndex` refers to the source row array. */
export interface FlatNodeRow {
	type: 'node';
	rowIndex: number;
	/** 0-based indentation depth (`level - 1`). */
	depth: number;
	/** 1-based tree level. */
	level: number;
	/**
	 * The module's own descend decision: this row's children are shown below it.
	 * Callers read expansion here; they must not re-derive it from neighbouring rows.
	 */
	expanded: boolean;
}

/** A Document brace row around the visible descendants of `rowIndex`. */
export interface FlatBraceRow {
	type: 'brace-open' | 'brace-close';
	rowIndex: number;
	/** The owning node's 1-based level. */
	level: number;
}

export type FlatRow = FlatNodeRow | FlatBraceRow;

export interface FlattenOptions {
	/** The saved collapsed ids; never mutated by this function. */
	collapsed?: ReadonlySet<string>;
	/**
	 * Filter visibility flags (matches plus ancestors). When present, an
	 * invisible row hides its whole subtree, and a collapsed node with a visible
	 * descendant is force-expanded for the duration of the filter only.
	 */
	visible?: readonly boolean[];
	/**
	 * Whether `visible` is an active filter. Defaults to `visible !== undefined`;
	 * pass `false` when an empty query leaves an all-true visibility array, so
	 * the saved collapsed set still applies.
	 */
	filterActive?: boolean;
	/** Document view: emit brace-open/brace-close around expanded subtrees. */
	braces?: boolean;
}

/**
 * The display list: source rows in order, subtrees skipped when collapsed or
 * filtered out, plus optional Document brace rows. A row is expanded when it
 * has children and at least one visible descendant, and it is either not
 * collapsed or force-expanded by an active filter; the collapsed set itself is
 * never modified, so clearing the filter restores exactly the user's state.
 * Brace rows are only emitted when there is a visible descendant to wrap, so a
 * matching container with hidden children does not show empty braces.
 */
export function flattenRows(rows: readonly FilterRow[], options: FlattenOptions = {}): FlatRow[] {
	const count = rows.length;
	const collapsed = options.collapsed;
	const visible = options.visible;
	const filterActive = options.filterActive ?? visible !== undefined;
	const braces = options.braces === true;

	// Prefix sums of the filter flags answer "does this subtree contain a
	// visible row?" in O(1), without walking the subtree again. Without a
	// filter, `hasChildren` is the answer.
	let visiblePrefix: Int32Array | undefined;
	if (visible) {
		visiblePrefix = new Int32Array(count + 1);
		for (let i = 0; i < count; i++) {
			visiblePrefix[i + 1] = visiblePrefix[i] + (visible[i] ? 1 : 0);
		}
	}

	const subtreeEnd = (index: number): number =>
		Math.min(count, index + Math.max(0, rows[index].subtreeSize) + 1);
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

	const out: FlatRow[] = [];
	const open: Array<{ end: number; level: number; rowIndex: number }> = [];
	let i = 0;
	while (i < count) {
		if (braces) {
			while (open.length > 0 && open[open.length - 1].end <= i) {
				const closed = open.pop() as { end: number; level: number; rowIndex: number };
				out.push({ type: 'brace-close', rowIndex: closed.rowIndex, level: closed.level });
			}
		}
		if (visible && !visible[i]) {
			i = subtreeEnd(i);
			continue;
		}
		const row = rows[i];
		const hasVisible = hasVisibleDescendant(i);
		// While a filter is active its visible descendants force a collapsed
		// ancestor open; the saved collapsed set is only read, never written.
		const expanded =
			row.hasChildren && hasVisible && (filterActive || !(collapsed ? collapsed.has(row.id) : false));
		out.push({
			type: 'node',
			rowIndex: i,
			depth: Math.max(0, row.level - 1),
			level: row.level,
			expanded,
		});
		if (expanded) {
			if (braces) {
				out.push({ type: 'brace-open', rowIndex: i, level: row.level });
				open.push({ end: subtreeEnd(i), level: row.level, rowIndex: i });
			}
			i++;
		} else {
			i = subtreeEnd(i);
		}
	}
	while (open.length > 0) {
		const closed = open.pop() as { end: number; level: number; rowIndex: number };
		out.push({ type: 'brace-close', rowIndex: closed.rowIndex, level: closed.level });
	}
	return out;
}

/**
 * The rows whose haystack contains `query`, in row order, as indices into `rows`.
 *
 * The candidate set is the filter's displayed set, not the collapsed set: pass
 * `filterResult.visible` to search only what the filter shows (matches plus their
 * ancestors), or omit it to search the whole tree. A collapsed container is still a
 * candidate, because search may expand its ancestors when it jumps; hiding is the
 * display list's job. A blank query matches nothing, and matching is case-insensitive
 * like `filterRows`.
 */
export function searchRows(
	rows: readonly FilterRow[],
	query: string,
	visible?: readonly boolean[]
): number[] {
	const needle = query.trim().toLowerCase();
	if (needle === '') {
		return [];
	}
	const matches: number[] = [];
	for (let i = 0; i < rows.length; i++) {
		if (visible && visible[i] === false) {
			continue;
		}
		if (rows[i].haystack.toLowerCase().includes(needle)) {
			matches.push(i);
		}
	}
	return matches;
}

/**
 * The next position in a match list, wrapping at both ends. `current = -1` means
 * "nothing selected yet": forward starts at the first match, backward at the last.
 * An empty list always yields -1 so the caller can keep its count/disabled state.
 */
export function stepMatch(
	matches: readonly number[],
	current: number,
	direction: 1 | -1
): number {
	const count = matches.length;
	if (count === 0) {
		return -1;
	}
	if (current < 0 || current >= count) {
		return direction === 1 ? 0 : count - 1;
	}
	return (current + direction + count) % count;
}

/**
 * The ancestors of `id` used to expand a revealed row, nearest parent first. A root
 * row or an id that is not in the list yields `[]`; a malformed parent cycle stops
 * instead of looping. This is the one owner of the walk expansion performs — the
 * display list decides what stays open, and nothing re-walks parents to find out.
 */
export function ancestorIds(rows: readonly FilterRow[], id: string): string[] {
	const byId = new Map<string, FilterRow>();
	for (const row of rows) {
		byId.set(row.id, row);
	}
	const out: string[] = [];
	const seen = new Set<string>([id]);
	let current = byId.get(id);
	while (current && current.parentId !== null) {
		if (seen.has(current.parentId)) {
			break;
		}
		seen.add(current.parentId);
		out.push(current.parentId);
		current = byId.get(current.parentId);
	}
	return out;
}

/** Debounced query runner state: one pending timer and one generation token. */
export interface FilterDebouncer {
	/** Cancels the pending run, bumps the generation and schedules `run` after the delay. */
	schedule(query: string, run: (query: string, generation: number) => void): number;
	/** Cancels the pending run and invalidates any dispatched work. */
	cancel(): void;
	/** True when `generation` is still the newest query. */
	isCurrent(generation: number): boolean;
}

/**
 * Debounced query runner with a generation token, suitable for serialising into
 * the page. `schedule` bumps the token immediately (so a chunked scan from an
 * older query can be abandoned), replaces any pending timer, and invokes `run`
 * with the newest token after `delayMs`. `isCurrent(token)` lets an in-flight
 * scan check whether its result is still wanted; `cancel` also bumps the token.
 *
 * The timer functions are injectable so tests need no wall clock; the defaults
 * use the host globals and keep the function self-contained when serialised.
 */
export function createFilterDebouncer(
	delayMs = 120,
	setTimer: (callback: () => void, delayMs: number) => unknown = (callback, ms) => setTimeout(callback, ms),
	clearTimer: (handle: unknown) => void = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
): FilterDebouncer {
	let generation = 0;
	let handle: unknown = null;
	let pending: (() => void) | null = null;

	const cancelPending = (): void => {
		if (pending !== null) {
			clearTimer(handle);
			pending = null;
			handle = null;
		}
	};

	return {
		schedule(query: string, run: (query: string, generation: number) => void): number {
			cancelPending();
			const token = ++generation;
			pending = () => {
				pending = null;
				handle = null;
				if (token === generation) {
					run(query, token);
				}
			};
			handle = setTimer(pending, delayMs);
			return token;
		},
		cancel(): void {
			cancelPending();
			generation++;
		},
		isCurrent(token: number): boolean {
			return token === generation;
		},
	};
}
