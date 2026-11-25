/**
 * Row-key fold synchronization for the two diff panes.
 *
 * Monaco folds by line range in each text model. The diff sides can have
 * different line numbers for the same semantic row, so the only stable bridge
 * is the row key attached to the node line. These helpers are pure; the page
 * adapter supplies Monaco's folding contribution.
 */

export interface FoldRegions {
	readonly length: number;
	getStartLineNumber(index: number): number;
	isCollapsed(index: number): boolean;
	findRange(line: number): number;
}

export interface FoldModel {
	readonly regions: FoldRegions;
	toggleCollapseState(regions: readonly { regionIndex: number }[]): void;
}

export interface FoldingContribution {
	getFoldingModel(): FoldModel | null | Promise<FoldModel | null>;
}

/** The semantic keys whose region starts on a collapsed line. */
export function collapsedRowKeys(
	regions: FoldRegions,
	lineKeys: readonly (string | undefined)[]
): Set<string> {
	const keys = new Set<string>();
	for (let index = 0; index < regions.length; index += 1) {
		if (!regions.isCollapsed(index)) {
			continue;
		}
		const key = lineKeys[regions.getStartLineNumber(index) - 1];
		if (key !== undefined) {
			keys.add(key);
		}
	}
	return keys;
}

/**
 * The target region index whose start is exactly the key's node line.
 * Missing keys, ancestors and zero-height matches are skipped.
 */
function targetRegionIndex(
	key: string,
	targetLineByKey: ReadonlyMap<string, number>,
	targetRegions: FoldRegions
): number | undefined {
	const line = targetLineByKey.get(key);
	if (line === undefined) {
		return undefined;
	}
	const index = targetRegions.findRange(line);
	if (index < 0 || targetRegions.getStartLineNumber(index) !== line) {
		return undefined;
	}
	return index;
}

function sharedKey(
	key: string,
	sourceLineByKey: ReadonlyMap<string, number>,
	targetLineByKey: ReadonlyMap<string, number>
): boolean {
	return sourceLineByKey.has(key) && targetLineByKey.has(key);
}

function needsToggle(
	key: string,
	sourceCollapsed: ReadonlySet<string>,
	targetCollapsed: ReadonlySet<string>
): boolean {
	return sourceCollapsed.has(key) !== targetCollapsed.has(key);
}

function toggleIndexFor(
	key: string,
	sourceCollapsed: ReadonlySet<string>,
	targetCollapsed: ReadonlySet<string>,
	sourceLineByKey: ReadonlyMap<string, number>,
	targetLineByKey: ReadonlyMap<string, number>,
	targetRegions: FoldRegions
): number | undefined {
	if (!needsToggle(key, sourceCollapsed, targetCollapsed)) {
		return undefined;
	}
	if (!sharedKey(key, sourceLineByKey, targetLineByKey)) {
		return undefined;
	}
	return targetRegionIndex(key, targetLineByKey, targetRegions);
}

/**
 * The target region indexes to toggle so both panes hide the same row keys.
 * Keys missing from either side are skipped; a one-sided row can never be
 * folded or unfolded on the pane that does not carry it.
 */
export function foldTogglePlan(
	sourceCollapsed: ReadonlySet<string>,
	targetCollapsed: ReadonlySet<string>,
	sourceLineByKey: ReadonlyMap<string, number>,
	targetLineByKey: ReadonlyMap<string, number>,
	targetRegions: FoldRegions
): number[] {
	const indexes = new Set<number>();
	for (const key of new Set([...sourceCollapsed, ...targetCollapsed])) {
		const index = toggleIndexFor(
			key,
			sourceCollapsed,
			targetCollapsed,
			sourceLineByKey,
			targetLineByKey,
			targetRegions
		);
		if (index !== undefined) {
			indexes.add(index);
		}
	}
	return [...indexes];
}
