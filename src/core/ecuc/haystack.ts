/**
 * The one owner of "what a node is searched by".
 *
 * `renderRows` stores the result on each row, so the webview never re-derives
 * which fields are searched: it only compares the lower-cased query against a
 * row's haystack, and the two sides cannot drift. Pure: no DOM, no `vscode`.
 */

export interface QueryFields {
	label: string;
	shortName?: string;
	value?: string;
	/** Visible meta fragments (short name, variant, context, condition, annotation). */
	meta?: readonly { text: string }[];
}

/** Lower-cased search text: label, short-name, value and every visible meta fragment. */
export function haystack(node: QueryFields): string {
	return [
		node.label,
		node.shortName ?? '',
		node.value ?? '',
		...(node.meta ? node.meta.map((part) => part.text) : []),
	]
		.filter((part) => part !== '')
		.join(' ')
		.toLowerCase();
}
