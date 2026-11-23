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
import type {
	FindOptions,
	FindResult,
	ReplaceRequest,
	ReplaceResult
} from './core/searchModel';

/** The schema/packages the Document header shows. */
export interface EditorDocumentHeader {
	schema?: string;
	packages: string[];
}

/** The curated VS Code editor settings the Monaco surface inherits. */
export interface MonacoSettings {
	fontFamily?: string;
	fontSize?: number;
	lineHeight?: number;
	fontWeight?: string;
	wordWrap?: 'on' | 'off' | 'wordWrapColumn' | 'bounded';
	wordWrapColumn?: number;
	minimap?: boolean;
	stickyScroll?: boolean;
	indentationGuides?: boolean;
	bracketPairGuides?: boolean | 'active';
	cursorStyle?: 'block' | 'block-outline' | 'line' | 'line-thin' | 'underline' | 'underline-thin';
	cursorBlinking?: 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';
	smoothScrolling?: boolean;
	renderWhitespace?: 'none' | 'boundary' | 'selection' | 'trailing' | 'all';
}

/** The row document the page installs: initial load and every re-scan. */
export interface EditorDocumentPayload {
	rows: EcucRow[];
	selectedId?: string;
	header?: EditorDocumentHeader;
	settings?: MonacoSettings;
	/** Host TextDocument version after the payload was built. */
	revision?: number;
	/** True when the TextDocument has unsaved changes. */
	dirty?: boolean;
}

/** One contiguous row replacement the engine computed for a text change. */
export interface EditorRowPatch {
	at: number;
	remove: number;
	rows: EcucRow[];
	/** False when rows did not shift, so the page can replace them in place. */
	structural: boolean;
}

/** Host → editor page. */
export type EditorProviderToWebview =
	/** Replace the row store (first load and every re-scan). */
	| { type: 'document'; document: EditorDocumentPayload }
	/** Replace a contiguous row span after one edit; the rest of the store is untouched. */
	| {
			type: 'documentPatch';
			patch: EditorRowPatch;
			header?: EditorDocumentHeader;
			selectedId?: string;
			revision?: number;
			dirty?: boolean;
	  }
	/** The host confirms or refuses one optimistic edit. */
	| {
			type: 'editResult';
			editId: number;
			ok: boolean;
			reason?: string;
			revision: number;
			/** The host's id for the edited node after the write; only a rename changes it. */
			nextNodeId?: string;
	  }
	/** The TextDocument's dirty state changed. */
	| { type: 'dirty'; dirty: boolean; revision: number }
	/** The host asks the page to submit pending edits before saving. */
	| { type: 'flushEdits'; requestId: number }
	/** Replace the workspace condition values (first load and a page reload). */
	| { type: 'conditions'; entries: ConditionEntry[] }
	/** Select one row, expanding its ancestors when needed. */
	| { type: 'select'; nodeId: string }
	/** A recoverable warning for the Details or Conditions status line. */
	| { type: 'notice'; message: string; kind?: 'warn' | 'info'; inline?: boolean; scope?: 'details' | 'conditions' }
	/** A fatal refresh failure; the page keeps showing the last good rows. */
	| { type: 'error'; message: string }
	/** The engine answer for one find request. */
	| { type: 'findResult'; requestId: number; result: FindResult; error?: string }
	/** The engine answer for one replace request. */
	| { type: 'replaceResult'; requestId: number; result: ReplaceResult }
	/** A curated `editor.*` setting changed. */
	| { type: 'settings'; settings: MonacoSettings }
	/** The active VS Code colour theme changed. */
	| { type: 'theme' };

/** Editor page → host. */
export type EditorWebviewToProvider =
	/** The page mounted and is listening; the host answers with `document` and `conditions`. */
	| { type: 'ready' }
	/** The page asks the host document to undo its last edit. */
	| { type: 'undo' }
	/** The page asks the host document to redo its last undone edit. */
	| { type: 'redo' }
	| { type: 'select'; nodeId: string }
	| { type: 'reveal'; nodeId: string }
	| { type: 'follow'; nodeId: string }
	| { type: 'references'; nodeId: string }
	| { type: 'edit'; editId?: number; nodeId: string; field?: 'value' | 'shortName' | 'definitionRef'; value: string; baseRevision?: number }
	/** The page asks the host to save the TextDocument after pending edits settle. */
	| { type: 'save' }
	| { type: 'flushed'; requestId: number }
	| { type: 'delete'; nodeId: string }
	| { type: 'duplicate'; nodeId: string }
	| { type: 'conditions'; entries: ConditionEntry[] }
	| { type: 'find'; requestId: number; query: string; options: FindOptions }
	| ({ type: 'replace'; requestId: number } & ReplaceRequest);

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

/** The message types a host → editor page payload may carry. */
const PROVIDER_MESSAGE_TYPES: ReadonlySet<string> = new Set([
	'document',
	'documentPatch',
	'editResult',
	'dirty',
	'flushEdits',
	'conditions',
	'select',
	'notice',
	'error',
	'findResult',
	'replaceResult',
	'settings',
	'theme'
]);

/** A host message with the editor protocol's shape; the page ignores anything else. */
export function isEditorProviderMessage(message: unknown): message is EditorProviderToWebview {
	const type = editorMessageType(message);
	return type !== undefined && PROVIDER_MESSAGE_TYPES.has(type);
}
