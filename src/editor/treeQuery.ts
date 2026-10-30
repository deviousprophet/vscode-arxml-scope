/**
 * Row-indexed search and flatten helpers for the ECUC tree.
 *
 * `haystack` is the single owner of "what a node is searched by" — label,
 * short-name and value. `renderRows` stores its result on each row, so the
 * webview never re-derives which fields are searched: it only compares the
 * lower-cased query against a row's haystack, and the two sides cannot drift.
 *
 * `matchRanges` is the single owner of "what counts as a match": Search and the
 * `<mark>` highlighting both call it, so the two cannot disagree about why a
 * row matched.
 *
 * `flattenRows` turns the row order and the collapsed set into the display list
 * (nodes and, for the Document view, brace rows). No DOM is involved, so the
 * whole module is unit-testable and its functions stay small enough to serialise
 * into the page.
 */

export interface QueryFields {
	label: string;
	shortName?: string;
	value?: string;
}

/** Lower-cased search text: label, short-name and value, space separated. */
export function haystack(node: QueryFields): string {
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
 * nothing, so the caller decides what "no query" means. Serialized into the
 * webview with `toString()`, so searching and highlighting share this one
 * definition.
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

/**
 * The row fields search and flattening need. `EcucRow` satisfies this.
 *
 * Rows must be in DFS/display order with parents before children; `parentId`
 * gives the ancestor walk, and `subtreeSize` gives `flattenRows` its collapse
 * skip.
 */
export interface TreeRow {
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
	/** Document view: emit brace-open/brace-close around expanded subtrees. */
	braces?: boolean;
}

/**
 * The display list: source rows in order, subtrees skipped when collapsed, plus
 * optional Document brace rows. A row is expanded when it has children and is
 * not collapsed; the collapsed set is only read, never modified. Brace rows are
 * only emitted around an expanded subtree, so a collapsed container does not
 * show empty braces.
 */
export function flattenRows(rows: readonly TreeRow[], options: FlattenOptions = {}): FlatRow[] {
	const count = rows.length;
	const collapsed = options.collapsed;
	const braces = options.braces === true;
	const subtreeEnd = (index: number): number =>
		Math.min(count, index + Math.max(0, rows[index].subtreeSize) + 1);

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
		const row = rows[i];
		const expanded = row.hasChildren && !(collapsed ? collapsed.has(row.id) : false);
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
 * The whole row store is the candidate set: a collapsed container is still a
 * candidate, because Search may expand its ancestors when it jumps; hiding is
 * the display list's job. A blank query matches nothing, and matching is
 * case-insensitive.
 */
export function searchRows(rows: readonly TreeRow[], query: string): number[] {
	const needle = query.trim().toLowerCase();
	if (needle === '') {
		return [];
	}
	const matches: number[] = [];
	for (let i = 0; i < rows.length; i++) {
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
export function ancestorIds(rows: readonly TreeRow[], id: string): string[] {
	const byId = new Map<string, TreeRow>();
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
