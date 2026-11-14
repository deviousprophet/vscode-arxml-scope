/**
 * The semantic-diff webview seam.
 *
 * One static shell, one bundled page, one typed message union: the host posts
 * the complete `DiffDocument` on load and after every refresh, plus the mode
 * state when a toggle needs no new document; the page posts `ready`, a match
 * mode request and a reveal intent.
 */
import type { DiffDocument } from './core/diff/diffModel';

export type { DiffDocument } from './core/diff/diffModel';

/** Host → diff page. */
export type DiffProviderToWebview =
	/** Install (or replace) the compared document. */
	| { type: 'document'; document: DiffDocument; semantic: boolean }
	/** The mode changed but the same document is still displayed. */
	| { type: 'matchModeState'; semantic: boolean }
	/** The refresh failed; keep the last good document and show the banner. */
	| { type: 'error'; message: string }
	/** Merge mode is on: the page shows copy arrows and accepts copy gestures. */
	| { type: 'mergeMode'; enabled: boolean }
	/** A buffer was edited or saved: the pane labels gained or lost their dirty marker. */
	| { type: 'labels'; labels: [string, string] }
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
;

/** The message type, or `undefined` for a payload that is not a protocol message. */
export function diffMessageType(message: unknown): string | undefined {
	const type = (message as { type?: unknown } | null | undefined)?.type;
	return typeof type === 'string' ? type : undefined;
}

/** A host message with the diff protocol's shape; the page ignores anything else. */
export function isDiffProviderMessage(message: unknown): message is DiffProviderToWebview {
	const type = diffMessageType(message);
	return (
		type === 'document' ||
		type === 'matchModeState' ||
		type === 'error' ||
		type === 'mergeMode' ||
		type === 'labels'
	);
}
