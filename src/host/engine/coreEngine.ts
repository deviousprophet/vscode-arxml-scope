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
import type { CopyPlan, CopyRange, MissingAncestor } from '../../core/copy/copyTypes';
import type { EcucRow } from '../../core/ecuc/renderRows';
import { EXPECTED_PROTOCOL, EngineError, type EngineClient } from './engineClient';
import type { EngineHealth, EngineStateListener } from './engineHealth';

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

export type EngineCopyRange = CopyRange;

/** One missing container the copy must synthesize around the element. */
export type EngineMissingAncestor = MissingAncestor;

/** One merge-mode arrow, addressed by the engine's document ids. */
export interface EngineCopyRequest {
	kind: 'copy' | 'delete';
	targetDocId: number;
	sourceDocId?: number;
	source?: EngineCopyRange;
	target?: EngineCopyRange;
	anchorAfter?: EngineCopyRange;
	anchorBefore?: EngineCopyRange;
	ancestors?: EngineMissingAncestor[];
}

export type EngineCopyPlan = CopyPlan;

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
	/** The span one merge arrow writes, computed against the engine's documents. */
	planCopy?(request: EngineCopyRequest): Promise<EngineCopyPlan>;
	closeDocument(docId: number): Promise<void>;
	/** A side-effect-free probe used by diagnostics and tests. */
	engineVersion(): string;
	/** Current process state; present on the supervisor-backed engine. */
	health?(): Promise<EngineHealth>;
	/** Replaces the process on demand; open documents are replayed. */
	restart?(): Promise<void>;
	/** State transitions, so the host can keep the status bar current. */
	onDidChangeState?(listener: EngineStateListener): { dispose(): void };
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

/** The largest body sent in one frame; the header and room for the prefix stay below 64 MiB. */
const DATAGRAM_LIMIT = 56 * 1024 * 1024;
/** Chunk size for a document above `DATAGRAM_LIMIT`. */
const UPLOAD_CHUNK = 8 * 1024 * 1024;
/** Hard cap for one document, matching the engine's assembled-buffer limit. */
const MAX_DOCUMENT = 512 * 1024 * 1024;

function documentId(chunk: { header: Record<string, unknown> }): number {
	const docId = chunk.header.docId;
	if (typeof docId !== 'number' || !Number.isInteger(docId)) {
		throw new Error('engine did not return a document id');
	}
	return docId;
}

/** Uploads one large document in raw byte chunks and returns its process document id. */
async function openChunked(
	client: EngineClient,
	uri: string,
	options: EngineRowOptions,
	bytes: Buffer
): Promise<number> {
	const begin = await client.request('doc.open.begin', { uri, options });
	const uploadId = begin.header.uploadId;
	if (typeof uploadId !== 'number') {
		throw new Error('engine did not return an upload id');
	}
	try {
		for (let seq = 0, at = 0; at < bytes.length; seq++, at += UPLOAD_CHUNK) {
			await client.request(
				'doc.open.chunk',
				{ uploadId, seq },
				bytes.subarray(at, Math.min(at + UPLOAD_CHUNK, bytes.length))
			);
		}
		const opened = await client.request('doc.open.end', { uploadId }, undefined, 120_000);
		return documentId(opened);
	} catch (error) {
		void client.request('upload.abort', { uploadId }, undefined, 2_000).catch(() => undefined);
		throw error;
	}
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
			const bytes = Buffer.from(text, 'utf8');
			if (bytes.length > MAX_DOCUMENT) {
				throw new EngineError(
					`document is ${Math.round(bytes.length / (1024 * 1024))} MiB; the engine accepts at most ${MAX_DOCUMENT / (1024 * 1024)} MiB`,
					'too_large'
				);
			}
			if (bytes.length > DATAGRAM_LIMIT) {
				return openChunked(client, uri, options, bytes);
			}
			const opened = await client.request('doc.open', { uri, options }, text);
			return documentId(opened);
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
		planCopy: async (request) => {
			const answer = await client.request('copy.plan', { ...request });
			return parseJson<EngineCopyPlan>(answer);
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
