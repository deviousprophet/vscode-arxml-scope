/**
 * Which side a page save gesture targets.
 *
 * The host owns dirtiness; the page only decides where the user's `Ctrl+S`
 * points. The pane label's trailing marker is the page's copy of that state.
 */
import type { DiffSide } from './diffBody';

/** The unsaved-edit marker the host appends to a pane label. */
const DIRTY_SUFFIX = ' •';

/** Whether one pane label shows the host's unsaved marker. */
export function labelIsDirty(label: string | undefined): boolean {
	return label !== undefined && label.endsWith(DIRTY_SUFFIX);
}

/**
 * The side one save gesture should save: the focused pane when it is dirty,
 * else the receiving side of the last accepted copy while that side is still
 * dirty. Two dirty sides save only the focused one; a clean side is a no-op.
 */
export function saveTargetSide(
	focused: DiffSide | undefined,
	lastReceiving: DiffSide | undefined,
	isDirty: (side: DiffSide) => boolean
): DiffSide | undefined {
	if (focused !== undefined && isDirty(focused)) {
		return focused;
	}
	if (lastReceiving !== undefined && isDirty(lastReceiving)) {
		return lastReceiving;
	}
	return undefined;
}
