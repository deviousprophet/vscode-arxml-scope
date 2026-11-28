/**
 * The shared native-find bridge for the Monaco pages.
 *
 * Monaco's find widget calls `findMatches` / `findNextMatch` / `findPreviousMatch`
 * on the text model. Both pages override those hooks so the real matches come
 * from the Rust engine and the widget's own line diff never sees the synthetic
 * text. The page supplies the three engine adapters; this module owns the
 * Monaco-side ordering and the "ask the host once" fallback.
 */
import type { FindOptions } from '../../core/searchModel';
import type { monaco } from './setup';

export type MonacoFindMatch = ReturnType<monaco.editor.ITextModel['findMatches']>[number];

/** The page-specific half of the bridge. */
export interface FindBridgeAdapter {
	options(isRegex: boolean, matchCase: boolean, wordSeparators: string | null): FindOptions;
	matches(searchString: string, options: FindOptions): MonacoFindMatch[];
	request(searchString: string, options: FindOptions): void;
}

/** The state fields both native find widgets expose. */
export interface FindControllerState {
	isRevealed: boolean;
	isReplaceRevealed: boolean;
	searchString: string;
	replaceString: string;
	preserveCase: boolean;
	isRegex: boolean;
	wholeWord: boolean;
	matchCase: boolean;
}

/** The controller surface both pages drive. */
export interface FindController {
	getState?(): FindControllerState;
	start?(opts: unknown, state?: unknown): Promise<void>;
	/** Present on Monaco's find controller; selects the next match and sets the count. */
	moveToNextMatch?(): boolean;
}

const FIND_START_OPTIONS = {
	forceRevealReplace: false,
	seedSearchStringFromSelection: 'none',
	seedSearchStringFromNonEmptySelection: false,
	seedSearchStringFromGlobalClipboard: false,
	shouldFocus: 0,
	shouldAnimate: false,
	updateSearchScope: false,
	loop: true
};

/** Restart the native widget on an engine query without touching its text search. */
export function startFindController(
	controller: FindController | null | undefined,
	state: FindControllerState,
	query: string,
	options: FindOptions
): void {
	if (controller?.start === undefined) {
		return;
	}
	void controller.start(
		{ ...FIND_START_OPTIONS },
		{
			searchString: query,
			isRegex: options.regex,
			matchCase: options.caseSensitive,
			wholeWord: options.wholeWord,
			replaceString: state.replaceString,
			preserveCase: state.preserveCase,
			isReplaceRevealed: state.isReplaceRevealed
		}
	);
	// The restart recomputes decorations without moving the cursor, so Monaco
	// cannot locate the current match and paints "? of N". Selecting the nearest
	// match makes the count numeric (1 of N) without changing which hit is next.
	controller.moveToNextMatch?.();
}

interface PatchedModel {
	findMatches(
		searchString: string,
		searchOnlyEditableRange: monaco.Range[] | null,
		isRegex: boolean,
		matchCase: boolean,
		wordSeparators: string | null,
		captureMatches: boolean,
		limitResultCount: number
	): MonacoFindMatch[];
	findNextMatch(
		searchString: string,
		searchStart: monaco.Position,
		isRegex: boolean,
		matchCase: boolean,
		wordSeparators: string | null,
		captureMatches: boolean
	): MonacoFindMatch | null;
	findPreviousMatch(
		searchString: string,
		searchStart: monaco.Position,
		isRegex: boolean,
		matchCase: boolean,
		wordSeparators: string | null,
		captureMatches: boolean
	): MonacoFindMatch | null;
}

/** The cached matches, or null when the page has just asked the host for them. */
function matchesOrRequest(
	adapter: FindBridgeAdapter,
	searchString: string,
	options: FindOptions
): MonacoFindMatch[] | null {
	if (searchString.length === 0) {
		return [];
	}
	const matches = adapter.matches(searchString, options);
	if (matches.length === 0) {
		adapter.request(searchString, options);
		return null;
	}
	return matches;
}

function comparePositions(left: monaco.Position, right: monaco.Position): number {
	if (left.lineNumber !== right.lineNumber) {
		return left.lineNumber - right.lineNumber;
	}
	return left.column - right.column;
}

function nextMatch(matches: readonly MonacoFindMatch[], searchStart: monaco.Position): MonacoFindMatch {
	return (
		matches.find(
			(match) => comparePositions(match.range.getStartPosition(), searchStart) >= 0
		) ?? matches[0]
	);
}

function endsBefore(match: MonacoFindMatch, searchStart: monaco.Position): boolean {
	const end = match.range.getEndPosition();
	if (end.lineNumber < searchStart.lineNumber) {
		return true;
	}
	if (end.lineNumber > searchStart.lineNumber) {
		return false;
	}
	return end.column <= searchStart.column;
}

function previousMatch(matches: readonly MonacoFindMatch[], searchStart: monaco.Position): MonacoFindMatch {
	for (let at = matches.length - 1; at >= 0; at -= 1) {
		if (endsBefore(matches[at], searchStart)) {
			return matches[at];
		}
	}
	return matches[matches.length - 1];
}

function findMatch(
	adapter: FindBridgeAdapter,
	searchString: string,
	searchStart: monaco.Position,
	isRegex: boolean,
	matchCase: boolean,
	wordSeparators: string | null,
	choose: (matches: readonly MonacoFindMatch[], start: monaco.Position) => MonacoFindMatch
): MonacoFindMatch | null {
	if (searchString.length === 0) {
		return null;
	}
	const options = adapter.options(isRegex, matchCase, wordSeparators);
	const matches = matchesOrRequest(adapter, searchString, options);
	return matches === null ? null : choose(matches, searchStart);
}

/** Install the engine-backed find hooks on one synthetic model. */
export function installFindBridge(target: monaco.editor.ITextModel, adapter: FindBridgeAdapter): void {
	const patched = target as unknown as PatchedModel;
	patched.findMatches = function (
		searchString,
		_searchOnlyEditableRange,
		isRegex,
		matchCase,
		wordSeparators,
		_captureMatches,
		limitResultCount
	) {
		if (searchString.length === 0) {
			return [];
		}
		const options = adapter.options(isRegex, matchCase, wordSeparators);
		const matches = adapter.matches(searchString, options);
		if (matches.length === 0) {
			adapter.request(searchString, options);
		}
		return Number.isFinite(limitResultCount) ? matches.slice(0, limitResultCount) : matches.slice();
	};
	patched.findNextMatch = function (
		searchString,
		searchStart,
		isRegex,
		matchCase,
		wordSeparators,
		_captureMatches
	) {
		return findMatch(adapter, searchString, searchStart, isRegex, matchCase, wordSeparators, nextMatch);
	};
	patched.findPreviousMatch = function (
		searchString,
		searchStart,
		isRegex,
		matchCase,
		wordSeparators,
		_captureMatches
	) {
		return findMatch(adapter, searchString, searchStart, isRegex, matchCase, wordSeparators, previousMatch);
	};
}
