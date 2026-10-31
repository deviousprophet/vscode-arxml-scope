/**
 * The semantic-diff webview seam.
 *
 * One static shell, one bundled page, one typed message union: the host posts
 * the complete `DiffDocument` on load and after every refresh; the page posts
 * only `ready` and a reveal intent.
 */
import type { DiffDocument } from './core/diff/diffModel';

export type { DiffDocument } from './core/diff/diffModel';

/** Host → diff page. */
export type DiffProviderToWebview =
	/** Install (or replace) the compared document. */
	| { type: 'document'; document: DiffDocument }
	/** The refresh failed; keep the last good document and show the banner. */
	| { type: 'error'; message: string };

/** Diff page → host. */
export type DiffWebviewToProvider =
	/** The page mounted and is listening; the host answers with `document`. */
	| { type: 'ready' }
	/** Reveal one row in its source file; `side` is the host row side (the page maps the displayed pane through `hostSide`). */
	| { type: 'reveal'; side: 'left' | 'right'; key: string };

/** The message type, or `undefined` for a payload that is not a protocol message. */
export function diffMessageType(message: unknown): string | undefined {
	const type = (message as { type?: unknown } | null | undefined)?.type;
	return typeof type === 'string' ? type : undefined;
}

/** A host message with the diff protocol's shape; the page ignores anything else. */
export function isDiffProviderMessage(message: unknown): message is DiffProviderToWebview {
	const type = diffMessageType(message);
	return type === 'document' || type === 'error';
}
