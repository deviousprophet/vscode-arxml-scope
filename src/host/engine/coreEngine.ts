/**
 * The engine seam between the VS Code host and the Rust core process.
 *
 * There is no TypeScript core fallback and no embedded engine: the Rust engine is a
 * standalone process, and the host is a client. This module owns the contract the
 * rest of the host codes against.
 *
 * Pure: no `vscode` import and no DOM.
 */
import { EXPECTED_PROTOCOL, type EngineClient } from './engineClient';
import type { EcucRow } from '../../core/ecuc/renderRows';

export { EXPECTED_PROTOCOL };

export type EngineKind = 'rust';

/** One document's row options; the engine must build the same rows the page shows. */
export interface EngineRowOptions {
	sort: 'all' | 'declaration';
	sortExcept: readonly string[];
	conditions?: Record<string, string | number | boolean>;
}

/** One validated edit, ready for the host to apply as a `WorkspaceEdit`. */
export interface EngineEditPlan {
	ok: boolean;
	record?: {
		nodeId: string;
		region: string;
		/** The UTF-16 span to replace. */
		range: { start: number; end: number };
		oldText: string;
		newText: string;
	};
	nextNodeId?: string;
	reason?: string;
}

/** A contiguous row replacement in display order. */
export interface EngineRowPatch {
	at: number;
	remove: number;
	rows: EcucRow[];
	/** False when rows did not shift, so the page can replace them in place. */
	structural: boolean;
}

export interface EngineTextChange {
	start: number;
	end: number;
	text: string;
}

export interface CoreEngine {
	readonly kind: EngineKind;
	/** The protocol version the running engine reported during the handshake. */
	readonly protocol: number;
	/** Opens one document handle; the engine keeps the text, the model and the rows. */
	openDocument(uri: string, text: string, options: EngineRowOptions): Promise<number>;
	planEdit(docId: number, request: EngineEditRequest): Promise<EngineEditPlan>;
	/** Applies text changes; `patch` is absent when the answer was not a row patch. */
	updateDocument(docId: number, edits: readonly EngineTextChange[]): Promise<EngineRowPatch | undefined>;
	closeDocument(docId: number): Promise<void>;
	/** A side-effect-free probe used by diagnostics and tests. */
	engineVersion(): string;
	dispose(): void;
}

export type EngineEditRequest =
	| { kind: 'value'; nodeId: string; value: string }
	| { kind: 'field'; nodeId: string; field: 'shortName' | 'definitionRef'; value: string };

/** A protocol mismatch that must refuse activation, with both versions named. */
export function protocolDiagnostic(header: Record<string, unknown>): string | undefined {
	const protocol = header.protocol;
	if (protocol !== EXPECTED_PROTOCOL) {
		return `engine protocol ${String(protocol)} does not match ${EXPECTED_PROTOCOL}`;
	}
	return undefined;
}

function parseJson<T>(chunk: { body: Buffer }): T {
	return JSON.parse(chunk.body.toString('utf8')) as T;
}

export function createEngine(client: EngineClient, version: string): CoreEngine {
	return {
		kind: 'rust',
		protocol: EXPECTED_PROTOCOL,
		openDocument: async (uri, text, options) => {
			const opened = await client.request('doc.open', { uri, options }, text);
			const docId = opened.header.docId;
			if (typeof docId !== 'number' || !Number.isInteger(docId)) {
				throw new Error('engine did not return a document id');
			}
			return docId;
		},
		planEdit: async (docId, request) => {
			const planned = await client.request('doc.plan', { docId, ...request });
			return parseJson<EngineEditPlan>(planned);
		},
		updateDocument: async (docId, edits) => {
			const updated = await client.request('doc.update', { docId, edits });
			if (updated.body.length === 0) {
				return undefined;
			}
			return parseJson<EngineRowPatch>(updated);
		},
		closeDocument: async (docId) => {
			if (client.isClosed) {
				return;
			}
			await client.request('doc.close', { docId }, undefined, 2000);
		},
		engineVersion: () => version,
		dispose: () => client.dispose()
	};
}
