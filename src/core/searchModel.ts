/**
 * Search and replace contracts shared by the host, the engine seam and the pages.
 *
 * Offsets are UTF-16 code units inside the named field text. A row match carries the
 * display offsets the page highlights and, when replaceable, the raw offsets the
 * edit planner uses; for quoted textual values they differ by one.
 */

export interface FindOptions {
	caseSensitive: boolean;
	wholeWord: boolean;
	regex: boolean;
}

export type FindField = 'label' | 'value' | 'meta';

export interface FindMatch {
	rowId: string;
	field: FindField;
	part?: number;
	start: number;
	end: number;
	rawStart?: number;
	rawEnd?: number;
	replaceable: boolean;
}

export interface FindResult {
	matches: FindMatch[];
	total: number;
	limited: boolean;
}

export interface DiffFindMatch {
	key: string;
	side: 'left' | 'right';
	field: FindField;
	part?: number;
	start: number;
	end: number;
}

export interface DiffFindResult {
	matches: DiffFindMatch[];
	total: number;
	limited: boolean;
}

/** The current match a replace-one action targets. */
export interface ReplaceTarget {
	rowId: string;
	field: FindField;
	start: number;
	end: number;
}

export interface ReplaceRequest {
	query: string;
	options: FindOptions;
	replacement: string;
	preserveCase: boolean;
	all: boolean;
	match?: ReplaceTarget;
}

export interface ReplaceEditRecord {
	nodeId: string;
	region: string;
	range: { start: number; end: number };
	oldText: string;
	newText: string;
}

export interface ReplacePlan {
	record: ReplaceEditRecord;
	nextNodeId?: string;
}

export interface ReplaceResult {
	ok: boolean;
	plans: ReplacePlan[];
	reason?: string;
	replacedFields: number;
	replacedOccurrences: number;
	stopped: boolean;
}

/** The default options: case-insensitive literal search, as VS Code starts. */
export const DEFAULT_FIND_OPTIONS: FindOptions = {
	caseSensitive: false,
	wholeWord: false,
	regex: false
};
