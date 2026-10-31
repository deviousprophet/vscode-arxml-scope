/**
 * Pure display-state helpers for the Document tree.
 *
 * These decide re-scan state, focus, subtree highlighting and bracket guides.
 * The editor and diff keep their own host state; both import the same rules.
 */
import type { FlatRow } from '../../render/treeQuery';

/** The state a re-scan keeps, pruned to the rows that still exist. */
export interface RowState {
	selectedId?: string;
	collapsed: string[];
}

/** Drops the ids that no longer exist, leaving the rest of the set alone. */
export function pruneCollapsed(collapsed: readonly string[], present: readonly string[]): string[] {
	const alive = new Set(present);
	return collapsed.filter((id) => alive.has(id));
}

/** Adds or removes `id`; a node without children can never be collapsed. */
export function toggleCollapsed(collapsed: readonly string[], id: string, hasChildren: boolean): string[] {
	if (!hasChildren) {
		return collapsed.slice();
	}
	return collapsed.includes(id) ? collapsed.filter((other) => other !== id) : collapsed.concat([id]);
}

/** Collapse-all: every node that has something to hide. */
export function collapsedIdsFor(items: readonly { id: string; hasChildren: boolean }[]): string[] {
	return items.filter((item) => item.hasChildren).map((item) => item.id);
}

/**
 * The index a movement key moves focus to, or `undefined` when the key is not a
 * move. `page` is how many rows fit in the viewport.
 */
export function moveTarget(key: string, from: number, count: number, page: number): number | undefined {
	if (count === 0) {
		return undefined;
	}
	if (key === 'ArrowDown') {
		return Math.min(from + 1, count - 1);
	}
	if (key === 'ArrowUp') {
		return Math.max(from - 1, 0);
	}
	if (key === 'Home') {
		return 0;
	}
	if (key === 'End') {
		return count - 1;
	}
	if (key === 'PageUp') {
		return Math.max(from - page, 0);
	}
	if (key === 'PageDown') {
		return Math.min(from + page, count - 1);
	}
	return undefined;
}

/**
 * Keeps the selection when its row survived and prunes collapse ids that are gone.
 */
export function reconcileRowState(state: RowState, rows: readonly { id: string }[]): RowState {
	const present = new Set(rows.map((row) => row.id));
	const selectedId =
		state.selectedId !== undefined && present.has(state.selectedId) ? state.selectedId : undefined;
	return {
		selectedId,
		collapsed: pruneCollapsed(state.collapsed, rows.map((row) => row.id)),
	};
}

/**
 * The roving/focused row after a window update: keep the previous focus if it
 * is still rendered, else the selected row if it is, else the first rendered
 * row. `undefined` only when nothing is rendered.
 */
export function resolveFocusId(
	previousFocusId: string | undefined,
	renderedIds: readonly string[],
	preferredId?: string
): string | undefined {
	if (previousFocusId !== undefined && renderedIds.includes(previousFocusId)) {
		return previousFocusId;
	}
	if (preferredId !== undefined && renderedIds.includes(preferredId)) {
		return preferredId;
	}
	return renderedIds.length > 0 ? renderedIds[0] : undefined;
}

/** The selected row plus every descendant, in display order. */
export function subtreeRowIds(
	selectedId: string | undefined,
	rows: readonly { id: string; subtreeSize: number }[]
): string[] {
	if (selectedId === undefined) {
		return [];
	}
	const start = rows.findIndex((row) => row.id === selectedId);
	if (start < 0) {
		return [];
	}
	const end = Math.min(rows.length, start + 1 + Math.max(0, rows[start].subtreeSize));
	return rows.slice(start, end).map((row) => row.id);
}

/** One open container guide at a display row: its level and owning row id. */
export interface GuideSegment {
	level: number;
	id: string;
}

/**
 * The bracket guides for each display row. A container's opening brace starts a
 * guide for its body; its closing brace ends it. Nested containers add their own
 * segment, so a row inside both carries both guides.
 */
export function guidesFor(
	displayRows: readonly FlatRow[],
	rows: readonly { id: string }[]
): GuideSegment[][] {
	const guides: GuideSegment[][] = [];
	const open: GuideSegment[] = [];
	for (const flat of displayRows) {
		if (flat.type === 'brace-close') {
			const at = open.map((segment) => segment.level).lastIndexOf(flat.level);
			if (at >= 0) {
				open.splice(at, 1);
			}
			guides.push(open.slice());
		} else if (flat.type === 'brace-open') {
			guides.push(open.slice());
			open.push({ level: flat.level, id: rows[flat.rowIndex].id });
		} else {
			guides.push(open.slice());
		}
	}
	return guides;
}
