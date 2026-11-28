/**
 * The semantic-diff webview seam.
 *
 * One static shell, one bundled page, one typed message union: the host posts
 * the complete `DiffDocument` on load and after every refresh, plus the mode
 * state when a toggle needs no new document; the page posts `ready`, a match
 * mode request and a reveal intent.
 */
import type { CopyDirtyRows } from './core/copy/copyDirty';
import type { DiffDocument } from './core/diff/diffModel';
import type { DiffPatch } from './core/diff/diffPatch';
import type { DiffFindResult, FindOptions } from './core/searchModel';

export type { DiffDocument } from './core/diff/diffModel';

/**
 * One action attached to the diff notice. `reveal` reuses the page's reveal
 * message; `reload` asks the host for one fresh comparison.
 */
export type DiffNoticeAction =
	| { kind: 'reveal'; label: string; side: 'left' | 'right'; key: string }
	| { kind: 'reload'; label: string };

/** Host → diff page. */
export type DiffProviderToWebview =
	/** Install (or replace) the compared document. */
	| { type: 'document'; document: DiffDocument; semantic: boolean }
	/** The mode changed but the same document is still displayed. */
	| { type: 'matchModeState'; semantic: boolean }
	/** The refresh failed; keep the last good document and show the banner. */
	| { type: 'error'; message: string; action?: DiffNoticeAction }
	/** Merge mode is on: the page shows copy arrows and accepts copy gestures. */
	| { type: 'mergeMode'; enabled: boolean }
	/** A buffer was edited or saved: the pane labels gained or lost their dirty marker. */
	| { type: 'labels'; labels: [string, string] }
	/** A copy was answered with the rows it changed, not the whole document. */
	| { type: 'documentPatch'; patch: DiffPatch }
	/** The rows each side owns that a copy wrote and the user has not saved. */
	| { type: 'copyDirty'; rows: CopyDirtyRows }
	/** The host applied (or refused) one copy; `side` and `key` echo the request. */
	| { type: 'copyResult'; ok: boolean; side: 'left' | 'right'; key: string; requestId?: number }
	/** The engine answer for one find request. */
	| { type: 'findResult'; requestId: number; result: DiffFindResult; error?: string }
	/** The active VS Code colour theme changed. */
	| { type: 'theme' }
;

/** Diff page → host. */
export type DiffWebviewToProvider =
	/** The page mounted and is listening; the host answers with `document`. */
	| { type: 'ready' }
	/** Toggle semantic matching for this panel only. */
	| { type: 'matchMode'; semantic: boolean }
	/** Reveal one row in its source file; `side` is the host row side (the page maps the displayed pane through `hostSide`). */
	| { type: 'reveal'; side: 'left' | 'right'; key: string }
	/** Turn merge mode on or off for this panel. */
	| { type: 'mergeMode'; enabled: boolean }
	/** Copy one row's element into the other document; `side` is the host source side. */
	| { type: 'copy'; side: 'left' | 'right'; key: string }
	/** The page painted the answer to one copy; the host closes its timing record. */
	| { type: 'painted'; requestId: number }
	/** Ask the engine for occurrences in the displayed diff. */
	| { type: 'find'; requestId: number; query: string; options: FindOptions; changesOnly: boolean }
	/** Save one side through the host's normal save path; the host re-checks the side and its dirty state. */
	| { type: 'save'; side: 'left' | 'right' }
	/** The notice's Reload action: rebuild the comparison from the current documents. */
	| { type: 'reload' }
;

/** The message type, or `undefined` for a payload that is not a protocol message. */
export function diffMessageType(message: unknown): string | undefined {
	const type = (message as { type?: unknown } | null | undefined)?.type;
	return typeof type === 'string' ? type : undefined;
}

/** Whether a value is one of the two compared sides. */
export function isDiffSide(value: unknown): value is 'left' | 'right' {
	return value === 'left' || value === 'right';
}

/** Every host message the page knows; one place to add the next one. */
const PROVIDER_MESSAGE_TYPES: ReadonlySet<string> = new Set([
	'document',
	'matchModeState',
	'error',
	'mergeMode',
	'labels',
	'documentPatch',
	'copyDirty',
	'copyResult',
	'findResult',
	'theme'
]);

/** A host message with the diff protocol's shape; the page ignores anything else. */
export function isDiffProviderMessage(message: unknown): message is DiffProviderToWebview {
	const type = diffMessageType(message);
	return type !== undefined && PROVIDER_MESSAGE_TYPES.has(type);
}

/** Every intent the page sends; one place to add the next one. */
const WEBVIEW_MESSAGE_TYPES: ReadonlySet<string> = new Set([
	'ready',
	'matchMode',
	'reveal',
	'mergeMode',
	'copy',
	'painted',
	'find',
	'save',
	'reload'
]);

/**
 * A page message with the diff protocol's shape; the host drops anything else.
 * `save` carries an invalid side as a malformed payload, not as a save request.
 */
export function isDiffWebviewMessage(message: unknown): message is DiffWebviewToProvider {
	const type = diffMessageType(message);
	if (type === undefined || !WEBVIEW_MESSAGE_TYPES.has(type)) {
		return false;
	}
	if (type === 'save') {
		return isDiffSide((message as { side?: unknown }).side);
	}
	return true;
}
