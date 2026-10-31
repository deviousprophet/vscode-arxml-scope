/**
 * The editor webview seam.
 *
 * The host and the bundled editor page only ever exchange these messages. The
 * page never parses a JSON document out of the HTML shell and the host never
 * writes page script: the shell is static and every payload travels over
 * `postMessage`.
 */
import type { ConditionEntry } from './core/ecuc/conditionEntry';
import type { EcucDocumentModel } from './core/ecuc/model';
import type { EcucRow } from './core/ecuc/renderRows';

/** The schema/packages the Document header shows. */
export interface EditorDocumentHeader {
	schema?: string;
	packages: string[];
}

/** The row document the page installs: initial load and every re-scan. */
export interface EditorDocumentPayload {
	rows: EcucRow[];
	selectedId?: string;
	header?: EditorDocumentHeader;
}

/** Host → editor page. */
export type EditorProviderToWebview =
	/** Replace the row store (first load and every re-scan). */
	| { type: 'document'; document: EditorDocumentPayload }
	/** Replace the workspace condition values (first load and a page reload). */
	| { type: 'conditions'; entries: ConditionEntry[] }
	/** Select one row, expanding its ancestors when needed. */
	| { type: 'select'; nodeId: string }
	/** A recoverable warning for the Details or Conditions status line. */
	| { type: 'notice'; message: string; kind?: 'warn' | 'info'; inline?: boolean; scope?: 'details' | 'conditions' }
	/** A fatal refresh failure; the page keeps showing the last good rows. */
	| { type: 'error'; message: string };

/** Editor page → host. */
export type EditorWebviewToProvider =
	/** The page mounted and is listening; the host answers with `document` and `conditions`. */
	| { type: 'ready' }
	| { type: 'select'; nodeId: string }
	| { type: 'reveal'; nodeId: string }
	| { type: 'follow'; nodeId: string }
	| { type: 'edit'; nodeId: string; field?: 'value' | 'shortName' | 'definitionRef'; value: string }
	| { type: 'delete'; nodeId: string }
	| { type: 'duplicate'; nodeId: string }
	| { type: 'conditions'; entries: ConditionEntry[] };

/** The schema/packages payload for one model. One owner for both host paths. */
export function documentHeader(model: EcucDocumentModel): EditorDocumentHeader {
	return {
		...(model.schema ? { schema: model.schema.release } : {}),
		packages: model.packages.map((pkg) => pkg.path.join('.')),
	};
}

/** The message type, or `undefined` for a payload that is not a protocol message. */
export function editorMessageType(message: unknown): string | undefined {
	const type = (message as { type?: unknown } | null | undefined)?.type;
	return typeof type === 'string' ? type : undefined;
}

/** A host message with the editor protocol's shape; the page ignores anything else. */
export function isEditorProviderMessage(message: unknown): message is EditorProviderToWebview {
	const type = editorMessageType(message);
	return (
		type === 'document' ||
		type === 'conditions' ||
		type === 'select' ||
		type === 'notice' ||
		type === 'error'
	);
}
