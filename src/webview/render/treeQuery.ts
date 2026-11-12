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
 * (nodes, comments, brace rows and the optional module gap). No DOM is involved,
 * so the whole module is unit-testable and its functions stay small enough to
 * serialise into the page.
 */

import { haystack } from '../../core/ecuc/haystack';
export { haystack };

/** An occurrence of the query, as `[start, end)` offsets into the searched text. */
export interface MatchRange {
	start: number;
	end: number;
}

/**
 * Every case-insensitive occurrence of `query` in `text`. The empty query matches
 * nothing, so the caller decides what "no query" means. Searching and
 * highlighting share this one definition.
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
	/** The ECUC row kind; `module` starts a new module group. */
	kind?: string;
	/** Lower-cased label + short name + value. */
	haystack: string;
	/** Annotation lines shown above this row, in source order. */
	comments?: readonly string[];
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

/** A comment line above the node it annotates; not focusable and not a tree row. */
export interface FlatCommentRow {
	type: 'comment';
	rowIndex: number;
	/** The annotated node's 1-based level, so indentation and guides line up. */
	level: number;
	text: string;
}

/** A blank line between module groups; not focusable and not a tree row. */
export interface FlatModuleGapRow {
	type: 'module-gap';
	level: 1;
}

export type FlatRow = FlatNodeRow | FlatBraceRow | FlatCommentRow | FlatModuleGapRow;

export interface FlattenOptions {
	/** The saved collapsed ids; never mutated by this function. */
	collapsed?: ReadonlySet<string>;
	/** Document view: emit brace-open/brace-close around expanded subtrees. */
	braces?: boolean;
	/** Document view: emit one inert blank row before every module after the first. */
	moduleGaps?: boolean;
}

/** One open Document brace, closed when the walk reaches `end`. */
interface OpenBrace {
	end: number;
	level: number;
	rowIndex: number;
}

interface FlattenContext {
	rows: readonly TreeRow[];
	count: number;
	collapsed: ReadonlySet<string> | undefined;
	braces: boolean;
	moduleGaps: boolean;
	out: FlatRow[];
	open: OpenBrace[];
	hasModule: boolean;
	index: number;
}

function createFlattenContext(rows: readonly TreeRow[], options: FlattenOptions): FlattenContext {
	return {
		rows,
		count: rows.length,
		collapsed: options.collapsed,
		braces: options.braces === true,
		moduleGaps: options.moduleGaps === true,
		out: [],
		open: [],
		hasModule: false,
		index: 0,
	};
}

function subtreeEnd(context: FlattenContext, index: number): number {
	return Math.min(context.count, index + Math.max(0, context.rows[index].subtreeSize) + 1);
}

function isCollapsed(context: FlattenContext, row: TreeRow): boolean {
	return context.collapsed ? context.collapsed.has(row.id) : false;
}

function isExpanded(context: FlattenContext, row: TreeRow): boolean {
	return row.hasChildren && !isCollapsed(context, row);
}

/** Emits the module gap above a later module, before its comments. */
function pushModuleGap(context: FlattenContext, row: TreeRow): void {
	if (!context.moduleGaps || row.kind !== 'module') {
		return;
	}
	if (context.hasModule) {
		context.out.push({ type: 'module-gap', level: 1 });
	}
	context.hasModule = true;
}

function pushComments(context: FlattenContext, row: TreeRow, index: number): void {
	for (const text of row.comments ?? []) {
		context.out.push({ type: 'comment', rowIndex: index, level: row.level, text });
	}
}

function closeBrace(context: FlattenContext): void {
	const top = context.open[context.open.length - 1];
	context.open.pop();
	context.out.push({ type: 'brace-close', rowIndex: top.rowIndex, level: top.level });
}

function closeFinishedBraces(context: FlattenContext): void {
	while (context.open.length > 0 && context.open[context.open.length - 1].end <= context.index) {
		closeBrace(context);
	}
}

function closeOpenBraces(context: FlattenContext): void {
	while (context.open.length > 0) {
		closeBrace(context);
	}
}

function advanceRow(context: FlattenContext, row: TreeRow, expanded: boolean): void {
	if (!expanded) {
		context.index = subtreeEnd(context, context.index);
		return;
	}
	if (context.braces) {
		context.out.push({ type: 'brace-open', rowIndex: context.index, level: row.level });
		context.open.push({ end: subtreeEnd(context, context.index), level: row.level, rowIndex: context.index });
	}
	context.index++;
}

function appendRow(context: FlattenContext): void {
	if (context.braces) {
		closeFinishedBraces(context);
	}
	const row = context.rows[context.index];
	pushModuleGap(context, row);
	pushComments(context, row, context.index);
	const expanded = isExpanded(context, row);
	context.out.push({
		type: 'node',
		rowIndex: context.index,
		depth: Math.max(0, row.level - 1),
		level: row.level,
		expanded,
	});
	advanceRow(context, row, expanded);
}

/**
 * The display list: source rows in order, subtrees skipped when collapsed, plus
 * optional Document brace rows and one blank module gap before every module after
 * the first. A row is expanded when it has children and is not collapsed; the
 * collapsed set is only read, never modified. Brace rows are only emitted around
 * an expanded subtree, so a collapsed container does not show empty braces. A
 * module gap sits above the module's comments, exactly where the group separator
 * belongs.
 */
export function flattenRows(rows: readonly TreeRow[], options: FlattenOptions = {}): FlatRow[] {
	const context = createFlattenContext(rows, options);
	while (context.index < context.count) {
		appendRow(context);
	}
	closeOpenBraces(context);
	return context.out;
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
function isOutsideMatches(current: number, count: number): boolean {
	return current < 0 || current >= count;
}

export function stepMatch(
	matches: readonly number[],
	current: number,
	direction: 1 | -1
): number {
	const count = matches.length;
	if (count === 0) {
		return -1;
	}
	if (isOutsideMatches(current, count)) {
		return direction === 1 ? 0 : count - 1;
	}
	return (current + direction + count) % count;
}

/** Index the row store by id for the ancestor walk. */
function rowsById(rows: readonly TreeRow[]): Map<string, TreeRow> {
	const byId = new Map<string, TreeRow>();
	for (const row of rows) {
		byId.set(row.id, row);
	}
	return byId;
}

/**
 * The ancestors of `id` used to expand a revealed row, nearest parent first. A root
 * row or an id that is not in the list yields `[]`; a malformed parent cycle stops
 * instead of looping. This is the one owner of the walk expansion performs — the
 * display list decides what stays open, and nothing re-walks parents to find out.
 */
export function ancestorIds(rows: readonly TreeRow[], id: string): string[] {
	const byId = rowsById(rows);
	const out: string[] = [];
	const seen = new Set<string>([id]);
	let current = byId.get(id);
	while (current !== undefined && current.parentId !== null) {
		if (seen.has(current.parentId)) {
			break;
		}
		seen.add(current.parentId);
		out.push(current.parentId);
		current = byId.get(current.parentId);
	}
	return out;
}
