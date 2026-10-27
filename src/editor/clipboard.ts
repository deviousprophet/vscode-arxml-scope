/**
 * The one side effect the details inspector can request: putting text on the system
 * clipboard. It is kept separate from the provider so the exact-text contract is
 * testable with a stub, without a webview or a real clipboard.
 *
 * This is not a document write: nothing in the workspace is touched, and the text comes
 * from what the user can already see in the tree or the inspector.
 */
export interface ClipboardLike {
	writeText(text: string): Thenable<void>;
}

/** Writes `text` verbatim and returns the notice the webview should show. */
export async function copyText(clipboard: ClipboardLike, text: string): Promise<string> {
	await clipboard.writeText(text);
	return 'Copied to clipboard.';
}
