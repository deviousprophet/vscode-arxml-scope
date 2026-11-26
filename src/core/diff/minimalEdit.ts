/**
 * The smallest single text edit between two model texts.
 *
 * A copy patches a few diff rows, so the page must not call `setValue` on both
 * models: that drops scroll, folds and selection. Comparing line by line and
 * replacing only the changed block keeps the rest of the model, and Monaco's
 * own diff of the two panes, intact.
 *
 * Pure: no `monaco` import and no DOM.
 */

/** One line replacement: 1-based start line, lines removed, whole lines added. */
export interface LineEdit {
	startLine: number;
	deleteCount: number;
	/** The replacement text, already terminated when it is non-empty. */
	text: string;
}

/** The line edit that turns `before` into `after`, or `undefined` when equal. */
export function minimalLineEdit(before: string, after: string): LineEdit | undefined {
	if (before === after) {
		return undefined;
	}
	const beforeLines = before.split('\n');
	const afterLines = after.split('\n');
	const shared = Math.min(beforeLines.length, afterLines.length);
	const prefix = commonPrefix(beforeLines, afterLines, shared);
	const suffix = commonSuffix(beforeLines, afterLines, shared - prefix);
	const added = afterLines.slice(prefix, afterLines.length - suffix);
	return {
		startLine: prefix + 1,
		deleteCount: beforeLines.length - prefix - suffix,
		text: added.length === 0 ? '' : `${added.join('\n')}\n`
	};
}

function commonPrefix(before: readonly string[], after: readonly string[], limit: number): number {
	let at = 0;
	while (at < limit && before[at] === after[at]) {
		at += 1;
	}
	return at;
}

function commonSuffix(before: readonly string[], after: readonly string[], limit: number): number {
	let at = 0;
	while (
		at < limit &&
		before[before.length - 1 - at] === after[after.length - 1 - at]
	) {
		at += 1;
	}
	return at;
}

/** Applies a line edit to a text; the same splice Monaco performs. */
export function applyLineEdit(before: string, edit: LineEdit): string {
	const lines = before.split('\n');
	const inserted = edit.text === '' ? [] : edit.text.replace(/\n$/, '').split('\n');
	const kept = lines.slice(0, edit.startLine - 1).concat(inserted, lines.slice(edit.startLine - 1 + edit.deleteCount));
	return kept.join('\n');
}
