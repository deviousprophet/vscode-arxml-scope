/**
 * The engine seam between the VS Code host and the Rust core process.
 *
 * There is no TypeScript core fallback and no embedded engine: the Rust engine is a
 * standalone process, and the host is a client. This module owns the contract the
 * rest of the host codes against.
 *
 * Pure: no `vscode` import and no DOM.
 */
import type { DiffDocument, DiffRow, DiffSummary } from '../../core/diff/diffModel';
import type { DiffPatch } from '../../core/diff/diffPatch';
import type { EcucRow } from '../../core/ecuc/renderRows';
import { EXPECTED_PROTOCOL, type EngineClient } from './engineClient';

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

/** One compared document: its engine handle plus the pane label. */
export interface EngineDiffSide {
	docId: number;
	name: string;
	path: string;
}

export interface EngineDiffOptions {
	semanticMatching?: boolean;
	/** Deterministic scored-pair cap; tests set it, the host never does. */
	semanticPairBudget?: number;
}

/** The text change one copy applied, in UTF-16 offsets. */
export interface EngineDiffEdit {
	side: 'left' | 'right';
	start: number;
	end: number;
	text: string;
}

/** The engine's patch is the same shape the host and page apply. */
export type EngineDiffPatch = DiffPatch;

export interface EngineDiffPatchResult {
	patch?: EngineDiffPatch;
	/** Why the engine cannot patch; the host rebuilds instead. */
	reason?: string;
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
	/** The whole diff document: row chunks assembled, headers and summary from the last frame. */
	computeDiff(
		left: EngineDiffSide,
		right: EngineDiffSide,
		options?: EngineDiffOptions
	): Promise<DiffDocument>;
	/** The rows one copy changed, or the reason a full rebuild is required. */
	patchDiff(
		left: EngineDiffSide,
		right: EngineDiffSide,
		edit: EngineDiffEdit
	): Promise<EngineDiffPatchResult>;
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

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object';
}

function hasSides(envelope: Record<string, unknown>): boolean {
	return isObject(envelope.left) && isObject(envelope.right);
}

function hasCounters(envelope: Record<string, unknown>): boolean {
	return Array.isArray(envelope.labels) && isObject(envelope.summary);
}

/** The final frame's document envelope, checked before it is trusted. */
function isDiffEnvelope(value: unknown): value is Omit<DiffDocument, 'rows'> {
	return isObject(value) && hasSides(value) && hasCounters(value);
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
		computeDiff: async (left, right, options = {}) => {
			const chunks = await client.requestStream('diff.compute', { left, right, options }, undefined, 60_000);
			const envelope = chunks.map((chunk) => chunk.header.document).find((found) => found !== undefined);
			if (!isDiffEnvelope(envelope)) {
				throw new Error('engine returned no diff envelope');
			}
			const rows = chunks
				.filter((chunk) => chunk.body.length > 0)
				.flatMap((chunk) => parseJson<DiffDocument['rows']>(chunk));
			return { ...envelope, rows };
		},
		patchDiff: async (left, right, edit) => {
			const answer = await client.request('diff.patch', { left, right, edit }, undefined, 120_000);
			if (answer.header.patch === true) {
				const patch = JSON.parse(answer.body.toString('utf8')) as EngineDiffPatch;
				return { patch };
			}
			return { reason: typeof answer.header.reason === 'string' ? answer.header.reason : 'unknown' };
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
