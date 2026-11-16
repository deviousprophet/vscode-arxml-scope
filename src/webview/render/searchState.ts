/**
 * Search plumbing shared by the editor and diff pages.
 *
 * Each page owns its candidate model and row rendering. What both pages spell
 * identically is the SearchBar state, Enter/Clear, the input reset guard and the
 * post-search index choice; keeping those here stops the count text and reset
 * rules from drifting apart.
 */
import { SearchBar } from '../components/searchBar/searchBar';
import type { FindOptions } from '../../core/searchModel';

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

export interface SearchBarActions {
	onOptions?(options: FindOptions): void;
	onReplace?(text: string, all: boolean): void;
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
	leaveSearch: () => void,
	actions: SearchBarActions = {}
): SearchBar {
	const close = (): void => {
		bar.hide();
		clearSearchField(bar, reset, clearFocus);
		leaveSearch();
	};
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
		onClose: close,
		onOptions: (options) => {
			setHighlight(bar.value());
			actions.onOptions?.(options);
		},
		onReplace: (text, all) => {
			actions.onReplace?.(text, all);
		},
		onInput: (value) => {
			searchInputChanged(value, query(), hasMatches(), setHighlight, renderUi, reset);
		},
	});
	bar.mount();
	return bar;
}
