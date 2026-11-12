/**
 * Search plumbing shared by the editor and diff pages.
 *
 * Each page owns its candidate model and row rendering. What both pages spell
 * identically is the SearchBar state, Enter/Clear, the input reset guard and the
 * post-search index choice; keeping those here stops the count text and reset
 * rules from drifting apart.
 */
import { SearchBar } from '../components/searchBar/searchBar';

/** The SearchBar members the shared controller drives. */
export interface SearchBarState {
	value(): string;
	setValue(value: string): void;
	focus(): void;
	setBusy(busy: boolean): void;
	setClearVisible(visible: boolean): void;
	setNavigationEnabled(enabled: boolean): void;
	setCount(text: string): void;
}

/** Repaints the count, busy, clear and navigation state. */
export function renderSearchCount(
	bar: SearchBarState,
	hasText: boolean,
	query: string,
	matchCount: number,
	index: number,
	running: boolean
): void {
	const active = query.trim() !== '';
	const hasMatches = matchCount > 0;
	bar.setBusy(running);
	bar.setClearVisible(hasText);
	bar.setNavigationEnabled(hasMatches);
	if (!active) {
		bar.setCount('');
	} else if (!hasMatches) {
		bar.setCount('0 / 0');
	} else {
		bar.setCount((index + 1) + ' / ' + matchCount);
	}
}

/** Enter/F3: run a changed query, or step through the current result set. */
function executeSearchCommand(
	direction: number,
	bar: SearchBarState,
	query: string,
	reset: () => void,
	start: (query: string) => void,
	cycle: (direction: number) => void
): void {
	const value = bar.value();
	if (value.trim() === '') {
		reset();
		return;
	}
	if (value !== query) {
		start(value);
		return;
	}
	cycle(direction === -1 ? -1 : 1);
}

/** Clears the field and results; optionally returns focus to the input. */
function clearSearchField(bar: SearchBarState, reset: () => void, focusInput: boolean): void {
	bar.setValue('');
	reset();
	if (focusInput) {
		bar.focus();
	}
}

/** The result state a new query starts from. */
export interface SearchStart<T> {
	query: string;
	matches: T[];
	index: number;
	firstJumpDone: boolean;
}

/**
 * Validates a query and clears the previous run, or returns undefined for a blank
 * query so the caller can drop its results. A previous match means this is a
 * re-scan, not a first jump.
 */
export function beginSearch<T>(
	engine: { clear(): void },
	query: string,
	previous: string | undefined,
	setHighlight: (text: string) => void
): SearchStart<T> | undefined {
	const text = query || '';
	if (text.trim() === '') {
		return undefined;
	}
	engine.clear();
	setHighlight(text);
	return { query: text, matches: [], index: -1, firstJumpDone: previous !== undefined };
}

/** Keeps a surviving current match, otherwise applies the page's fallback. */
export function retainedSearchIndex<W>(
	wanted: W | undefined,
	matchCount: number,
	indexOf: (wanted: W) => number,
	fallback: number
): number {
	const kept = wanted === undefined ? -1 : indexOf(wanted);
	if (matchCount === 0) {
		return -1;
	}
	if (kept >= 0) {
		return kept;
	}
	return fallback;
}

/** Drops stale results when the typed query no longer matches the active one. */
function searchInputChanged(
	value: string,
	query: string,
	hasMatches: boolean,
	setHighlight: (value: string) => void,
	renderUi: () => void,
	reset: () => void
): void {
	if (value === query) {
		setHighlight(value);
		renderUi();
		return;
	}
	if (query === '' && !hasMatches) {
		renderUi();
		return;
	}
	reset();
}

/** Ends a search run: stop the busy state, repaint, then reveal the chosen match. */
export function finishSearch(
	index: number,
	setBusy: (busy: boolean) => void,
	renderUi: () => void,
	jump: (index: number) => void,
	renderWindow: () => void
): void {
	setBusy(false);
	renderUi();
	if (index >= 0) {
		jump(index);
	} else {
		renderWindow();
	}
}

/** Creates and mounts a SearchBar whose callbacks drive the shared search flow. */
export function mountSearchBar(
	prefix: string,
	query: () => string,
	hasMatches: () => boolean,
	reset: () => void,
	start: (query: string) => void,
	cycle: (direction: number) => void,
	renderUi: () => void,
	setHighlight: (value: string) => void,
	clearFocus: boolean,
	leaveSearch: () => void
): SearchBar {
	const bar = new SearchBar(prefix, {
		onExecute: (direction) => {
			executeSearchCommand(direction, bar, query(), reset, start, cycle);
		},
		onCycle: (direction) => {
			cycle(direction);
		},
		onClear: () => {
			reset();
		},
		onEscape: () => {
			clearSearchField(bar, reset, clearFocus);
			leaveSearch();
		},
		onInput: (value) => {
			searchInputChanged(value, query(), hasMatches(), setHighlight, renderUi, reset);
		},
	});
	bar.mount();
	return bar;
}
