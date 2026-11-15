/**
 * The engine supervisor.
 *
 * `EngineClient` owns one process. This module owns the lifetime: when the process
 * exits or answers with a protocol error, the next request spawns a new one, reopens
 * every live document and keeps the host's document ids stable. The rest of the host
 * only sees `CoreEngine`.
 *
 * Pure: no `vscode` import. State changes are reported through listeners so the
 * status bar can follow the process without polling.
 */
import { readFile } from 'node:fs/promises';

import type { DiffDocument } from '../../core/diff/diffModel';
import { EngineError, EXPECTED_PROTOCOL, type EngineClient, type EngineSpawner } from './engineClient';
import {
	createEngine,
	protocolDiagnostic,
	type CoreEngine,
	type EngineCopyPlan,
	type EngineCopyRequest,
	type EngineDiffEdit,
	type EngineDiffOptions,
	type EngineDiffPatchResult,
	type EngineDiffSide,
	type EngineEditPlan,
	type EngineEditRequest,
	type EngineRowOptions,
	type EngineRowPatch,
	type EngineTextChange
} from './coreEngine';
import type {
	EngineHealth,
	EngineProcessState,
	EngineStateChange,
	EngineStateListener
} from './engineHealth';

const DEFAULT_MAX_RESTARTS = 5;
const BASE_RESTART_DELAY_MS = 100;
const MAX_RESTART_DELAY_MS = 2_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;

export interface EngineSupervisorOptions {
	binary: string;
	root: string;
	start: EngineSpawner;
	/** Fail after this many consecutive unsuccessful spawns. */
	maxRestarts?: number;
}

interface LiveDocument {
	/** The id the host holds; never changes. */
	id: number;
	uri: string;
	/** Last text the host reported, so a replay reopens what the user sees. */
	text: string;
	options: EngineRowOptions;
	/** The current process's id; replaced after a replay. */
	processId?: number;
}

/** Sorts and applies UTF-16 edits the same way the engine does. */
export function applyTextChanges(text: string, edits: readonly EngineTextChange[]): string {
	const ordered = [...edits].sort((left, right) => right.start - left.start);
	let next = text;
	for (const edit of ordered) {
		next = `${next.slice(0, edit.start)}${edit.text}${next.slice(edit.end)}`;
	}
	return next;
}

function isProcessFailure(error: unknown): boolean {
	return (
		error instanceof EngineError &&
		(error.code === 'exited' ||
			error.code === 'protocol' ||
			error.code === 'fatal' ||
			error.code === 'disposed')
	);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		timer.unref?.();
	});
}

export class EngineSupervisor implements CoreEngine {
	public readonly kind = 'rust' as const;
	public readonly protocol = EXPECTED_PROTOCOL;

	private readonly binary: string;
	private readonly root: string;
	private readonly spawn: EngineSpawner;
	private readonly maxRestarts: number;
	private readonly listeners = new Set<EngineStateListener>();
	private readonly documents = new Map<number, LiveDocument>();

	private client: EngineClient | undefined;
	private engine: CoreEngine | undefined;
	private connecting: Promise<CoreEngine> | undefined;
	private warmTimer: NodeJS.Timeout | undefined;
	private nextDocumentId = 1;
	private spawns = 0;
	private failures = 0;
	private restarts = 0;
	private version = '';
	private startedAt = 0;
	private state: EngineProcessState = 'starting';
	private lastError: string | undefined;
	private disposed = false;

	public constructor(options: EngineSupervisorOptions) {
		this.binary = options.binary;
		this.root = options.root;
		this.spawn = options.start;
		this.maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
	}

	/** Starts the first process and completes the handshake. */
	public async start(): Promise<void> {
		await this.ensureEngine();
	}

	public get isClosed(): boolean {
		return this.disposed || this.state === 'failed';
	}

	/** The state the status bar shows. */
	public get processState(): EngineProcessState {
		return this.state;
	}

	public onDidChangeState(listener: EngineStateListener): { dispose(): void } {
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	}

	public async health(): Promise<EngineHealth> {
		return {
			state: this.state,
			version: this.version || undefined,
			protocol: EXPECTED_PROTOCOL,
			pid: this.client?.pid,
			uptimeMs: this.startedAt === 0 ? 0 : Date.now() - this.startedAt,
			restarts: this.restarts,
			openDocuments: this.documents.size,
			pendingRequests: this.client?.pendingCount ?? 0,
			memoryBytes: await this.engineMemory(),
			lastError: this.lastError
		};
	}

	public async restart(): Promise<void> {
		if (this.disposed) {
			throw new EngineError('engine is disposed', 'disposed');
		}
		const previous = this.client;
		this.client = undefined;
		this.engine = undefined;
		previous?.dispose();
		this.failures = 0;
		this.setState('restarting');
		await this.ensureEngine();
	}

	public async openDocument(uri: string, text: string, options: EngineRowOptions): Promise<number> {
		return this.withEngine(async (engine) => {
			const processId = await engine.openDocument(uri, text, options);
			const id = this.nextDocumentId++;
			this.documents.set(id, { id, uri, text, options, processId });
			return id;
		});
	}

	public async planEdit(docId: number, request: EngineEditRequest): Promise<EngineEditPlan> {
		return this.withDocument(docId, (document, engine) => engine.planEdit(document.processId as number, request));
	}

	public async updateDocument(
		docId: number,
		edits: readonly EngineTextChange[]
	): Promise<EngineRowPatch | undefined> {
		const document = this.requireDocument(docId);
		const previous = document.text;
		document.text = applyTextChanges(document.text, edits);
		try {
			return await this.withDocument(docId, (live, engine) =>
				engine.updateDocument(live.processId as number, edits)
			);
		} catch (error) {
			if (!isProcessFailure(error)) {
				document.text = previous;
			}
			throw error;
		}
	}

	public async computeDiff(
		left: EngineDiffSide,
		right: EngineDiffSide,
		options?: EngineDiffOptions
	): Promise<DiffDocument> {
		return this.withEngine(async (engine) => {
			return engine.computeDiff(this.translateSide(left), this.translateSide(right), options);
		});
	}

	public async patchDiff(
		left: EngineDiffSide,
		right: EngineDiffSide,
		edit: EngineDiffEdit
	): Promise<EngineDiffPatchResult> {
		return this.withEngine(async (engine) => {
			return engine.patchDiff(this.translateSide(left), this.translateSide(right), edit);
		});
	}

	public async planCopy(request: EngineCopyRequest): Promise<EngineCopyPlan> {
		return this.withEngine(async (engine) => {
			if (engine.planCopy === undefined) {
				throw new EngineError('the engine does not plan copies', 'unsupported');
			}
			const translated: EngineCopyRequest = {
				...request,
				targetDocId: this.translateDocumentId(request.targetDocId),
				...(request.sourceDocId === undefined
					? {}
					: { sourceDocId: this.translateDocumentId(request.sourceDocId) })
			};
			return engine.planCopy(translated);
		});
	}

	public async closeDocument(docId: number): Promise<void> {
		const document = this.documents.get(docId);
		if (document === undefined) {
			return;
		}
		this.documents.delete(docId);
		if (this.engine === undefined || this.client === undefined || this.client.isClosed) {
			return;
		}
		if (document.processId === undefined) {
			return;
		}
		try {
			await this.engine.closeDocument(document.processId);
		} catch {
			// A dead process already forgot the document; the restart will not replay it.
		}
	}

	public engineVersion(): string {
		return this.version || 'unknown';
	}

	public dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		if (this.warmTimer !== undefined) {
			clearTimeout(this.warmTimer);
			this.warmTimer = undefined;
		}
		this.documents.clear();
		this.setState('disposed');
		this.listeners.clear();
		this.client?.dispose();
		this.client = undefined;
		this.engine = undefined;
	}

	// -----------------------------------------------------------------------
	// Process lifetime
	// -----------------------------------------------------------------------

	private ensureEngine(): Promise<CoreEngine> {
		if (this.disposed) {
			return Promise.reject(new EngineError('engine supervisor is disposed', 'disposed'));
		}
		if (this.engine !== undefined && this.client !== undefined && !this.client.isClosed) {
			return Promise.resolve(this.engine);
		}
		if (this.state === 'failed') {
			return Promise.reject(this.unavailableError());
		}
		if (this.connecting === undefined) {
			this.connecting = this.replaceProcess().finally(() => {
				this.connecting = undefined;
			});
		}
		return this.connecting;
	}

	private async replaceProcess(): Promise<CoreEngine> {
		if (this.failures > 0) {
			await delay(Math.min(BASE_RESTART_DELAY_MS * 2 ** (this.failures - 1), MAX_RESTART_DELAY_MS));
		}
		this.setState(this.spawns === 0 ? 'starting' : 'restarting');
		let client: EngineClient | undefined;
		try {
			client = await this.spawn(this.binary, this.root, (error) => this.handleClientExit(error));
			if (this.spawns === 0) {
				this.spawns = 1;
			} else {
				this.spawns += 1;
				this.restarts = this.spawns - 1;
			}
			const hello = await client.request('hello', {}, undefined, HANDSHAKE_TIMEOUT_MS);
			const version = this.validateHello(hello.header as Record<string, unknown>);
			const engine = createEngine(client, version);
			for (const document of this.documents.values()) {
				document.processId = await engine.openDocument(document.uri, document.text, document.options);
			}
			this.client?.dispose();
			this.client = client;
			this.engine = engine;
			this.version = version;
			this.startedAt = Date.now();
			this.setState('running');
			return engine;
		} catch (error) {
			client?.dispose();
			throw this.noteFailure(error);
		}
	}

	private validateHello(header: Record<string, unknown>): string {
		const diagnostic = protocolDiagnostic(header);
		if (diagnostic !== undefined) {
			throw new EngineError(diagnostic, 'protocol');
		}
		const version = header.engine;
		if (typeof version !== 'string' || version.length === 0) {
			throw new EngineError('engine handshake did not report a version', 'protocol');
		}
		return version;
	}

	private noteFailure(error: unknown): Error {
		this.failures += 1;
		this.lastError = error instanceof Error ? error.message : String(error);
		this.engine = undefined;
		this.client = undefined;
		if (this.failures >= this.maxRestarts) {
			this.setState('failed', this.lastError);
			return this.unavailableError();
		}
		this.setState('restarting', this.lastError);
		this.scheduleWarmRestart();
		return error instanceof Error ? error : new Error(this.lastError);
	}

	private unavailableError(): EngineError {
		const reason = this.lastError === undefined ? 'no engine process' : this.lastError;
		return new EngineError(
			`The Rust engine is unavailable after ${this.failures} attempts: ${reason}. ` +
				'Run "ARXML Scope: Show Engine Status" for details, then reload the window or reinstall the extension.',
			'unavailable'
		);
	}

	private scheduleWarmRestart(): void {
		if (this.disposed || this.warmTimer !== undefined || this.connecting !== undefined) {
			return;
		}
		const delayMs = Math.min(
			BASE_RESTART_DELAY_MS * 2 ** Math.max(0, this.failures - 1),
			MAX_RESTART_DELAY_MS
		);
		this.warmTimer = setTimeout(() => {
			this.warmTimer = undefined;
			if (this.disposed) {
				return;
			}
			void this.ensureEngine().catch(() => {
				// noteFailure scheduled the next attempt; stop at the limit.
			});
		}, delayMs);
		this.warmTimer.unref?.();
	}

	// -----------------------------------------------------------------------
	// Requests and documents
	// -----------------------------------------------------------------------

	private async withEngine<T>(run: (engine: CoreEngine) => Promise<T>): Promise<T> {
		const engine = await this.ensureEngine();
		try {
			const value = await run(engine);
			this.failures = 0;
			return value;
		} catch (error) {
			if (isProcessFailure(error)) {
				this.noteProcessFailure(error);
			}
			throw error;
		}
	}

	private async withDocument<T>(
		docId: number,
		run: (document: LiveDocument, engine: CoreEngine) => Promise<T>
	): Promise<T> {
		const document = this.requireDocument(docId);
		return this.withEngine((engine) => {
			if (document.processId === undefined) {
				throw new EngineError('document is not open in the engine', 'doc');
			}
			return run(document, engine);
		});
	}

	private requireDocument(docId: number): LiveDocument {
		const document = this.documents.get(docId);
		if (document === undefined) {
			throw new EngineError(`unknown document ${docId}`, 'doc');
		}
		return document;
	}

	private translateSide(side: EngineDiffSide): EngineDiffSide {
		const document = this.requireDocument(side.docId);
		if (document.processId === undefined) {
			throw new EngineError('document is not open in the engine', 'doc');
		}
		return { ...side, docId: document.processId };
	}

	private translateDocumentId(docId: number): number {
		const document = this.requireDocument(docId);
		if (document.processId === undefined) {
			throw new EngineError('document is not open in the engine', 'doc');
		}
		return document.processId;
	}

	private noteProcessFailure(error: unknown): void {
		this.lastError = error instanceof Error ? error.message : String(error);
		this.engine = undefined;
		this.client = undefined;
		if (this.disposed) {
			return;
		}
		this.setState('restarting', this.lastError);
		this.scheduleWarmRestart();
	}

	/** The process ended without a request waiting on it. */
	private handleClientExit(error: EngineError): void {
		if (this.disposed || this.state === 'failed') {
			return;
		}
		this.noteProcessFailure(error);
	}

	private async engineMemory(): Promise<number | undefined> {
		const pid = this.client?.pid;
		if (pid === undefined || process.platform !== 'linux') {
			return undefined;
		}
		try {
			const status = await readFile(`/proc/${pid}/status`, 'utf8');
			const match = /VmRSS:\s+(\d+)\s+kB/.exec(status);
			return match === null ? undefined : Number(match[1]) * 1024;
		} catch {
			return undefined;
		}
	}

	private setState(state: EngineProcessState, error?: string): void {
		const changed = this.state !== state || error !== undefined;
		this.state = state;
		if (!changed) {
			return;
		}
		const change: EngineStateChange = error === undefined ? { state } : { state, error };
		for (const listener of [...this.listeners]) {
			try {
				listener(change);
			} catch {
				// A status listener must never break the engine path.
			}
		}
	}
}

/** Starts the supervisor and one engine process. */
export async function createEngineSupervisor(options: EngineSupervisorOptions): Promise<CoreEngine> {
	const supervisor = new EngineSupervisor(options);
	try {
		await supervisor.start();
		return supervisor;
	} catch (error) {
		supervisor.dispose();
		throw error;
	}
}
