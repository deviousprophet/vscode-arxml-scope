/**
 * The engine process client.
 *
 * One long-lived Rust process speaks a framed protocol over stdio:
 * `[u32 LE payload_len][u16 LE header_len][header JSON][body bytes]`. The body carries
 * document text and row JSON raw, so nothing is escaped twice.
 *
 * Pure Node: no `vscode` import. The host passes paths and text; the client owns
 * spawn, framing, correlation, streaming and restart.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** The protocol version this client speaks. */
export const EXPECTED_PROTOCOL = 1;

export class EngineError extends Error {
	constructor(
		message: string,
		readonly code?: string
	) {
		super(message);
		this.name = 'EngineError';
	}
}

export interface EngineFrame {
	id: number;
	ok?: boolean;
	code?: string;
	reason?: string;
	chunk?: { seq: number; last: boolean; total: number };
	[key: string]: unknown;
}

export interface EngineChunk {
	header: EngineFrame;
	body: Buffer<ArrayBufferLike>;
}

/** The packaged engine binary for one platform/architecture. */
export function engineBinaryPath(root: string, platform: string = process.platform, arch: string = process.arch): string {
	const name = platform === 'win32' ? 'arxml-engine.exe' : 'arxml-engine';
	return path.join(root, 'dist', 'engine', `${platform}-${arch}`, name);
}

export interface EngineClientOptions {
	/** The engine executable. */
	binary: string;
	/** Workspace root handed to the engine (used for relative diagnostics). */
	root?: string;
	/** Spawn implementation, for tests. */
	spawnProcess?: (binary: string) => ChildProcessWithoutNullStreams;
}

interface Pending {
	resolve: (chunks: EngineChunk[]) => void;
	reject: (error: Error) => void;
	streamed: EngineChunk[];
}

const MAX_FRAME = 64 * 1024 * 1024;

/**
 * A started engine process. Requests are correlated by id; a streaming request
 * collects every chunk until the engine marks the last one, so callers can ask for
 * a whole row document without knowing the chunk size.
 */
export class EngineClient {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly pending = new Map<number, Pending>();
	private nextId = 1;
	private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
	private closed = false;

	private constructor(child: ChildProcessWithoutNullStreams) {
		this.child = child;
		child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
		child.on('exit', (code, signal) => this.handleExit(code, signal));
		child.on('error', (error) => this.handleExit(null, String(error)));
	}

	/** Spawns the engine and completes the handshake. */
	public static async start(options: EngineClientOptions): Promise<EngineClient> {
		if (!existsSync(options.binary)) {
			throw new EngineError(
				`Rust engine is not built at ${options.binary}; run "npm run engine:build"`
			);
		}
		const child = options.spawnProcess
			? options.spawnProcess(options.binary)
			: spawn(options.binary, ['--stdio', ...(options.root ? ['--root', options.root] : [])], {
					stdio: ['pipe', 'pipe', 'pipe'],
					windowsHide: true
				});
		const client = new EngineClient(child);
		const hello = await client.request('hello', {}, undefined, 5000);
		const header = hello.header;
		if (header.protocol !== EXPECTED_PROTOCOL) {
			client.dispose();
			throw new EngineError(
				`engine protocol ${String(header.protocol)} does not match ${EXPECTED_PROTOCOL}`
			);
		}
		return client;
	}

	public get isClosed(): boolean {
		return this.closed;
	}

	/** One request; a streaming answer is collected until its last chunk. */
	public async request(
		op: string,
		header: Record<string, unknown> = {},
		body?: string | Buffer,
		timeoutMs = 30_000
	): Promise<EngineChunk> {
		const chunks = await this.send(op, header, body, timeoutMs);
		return chunks[chunks.length - 1] ?? { header: { id: 0, ok: false }, body: Buffer.alloc(0) };
	}

	/** A request whose answer may arrive in several chunks (rows, diff, diagnostics). */
	public async requestStream(
		op: string,
		header: Record<string, unknown> = {},
		body?: string | Buffer,
		timeoutMs = 30_000
	): Promise<EngineChunk[]> {
		return this.send(op, header, body, timeoutMs);
	}

	private send(
		op: string,
		header: Record<string, unknown>,
		body: string | Buffer | undefined,
		timeoutMs: number
	): Promise<EngineChunk[]> {
		if (this.closed) {
			return Promise.reject(new EngineError('engine is not running', 'closed'));
		}
		const id = this.nextId++;
		const frame = Buffer.from(JSON.stringify({ id, op, ...header }), 'utf8');
		if (frame.length > 0xffff) {
			return Promise.reject(new EngineError('request header is too large', 'protocol'));
		}
		const payloadLength = 2 + frame.length + (body === undefined ? 0 : Buffer.byteLength(body));
		if (payloadLength > MAX_FRAME) {
			return Promise.reject(new EngineError('request exceeds the frame limit', 'protocol'));
		}
		const prefix = Buffer.alloc(6);
		prefix.writeUInt32LE(payloadLength, 0);
		prefix.writeUInt16LE(frame.length, 4);
		const parts = [prefix, frame, body === undefined ? Buffer.alloc(0) : Buffer.from(body)];

		return new Promise<EngineChunk[]>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new EngineError(`engine request "${op}" timed out`, 'timeout'));
			}, timeoutMs);
			this.pending.set(id, {
				streamed: [],
				resolve: (chunks) => {
					clearTimeout(timer);
					resolve(chunks);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				}
			});
			this.child.stdin.write(Buffer.concat(parts));
		});
	}

	/** Parses every complete frame in the buffer. */
	private receive(chunk: Buffer): void {
		this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
		while (this.buffer.length >= 6) {
			const payloadLength = this.buffer.readUInt32LE(0);
			if (payloadLength < 2 || payloadLength > MAX_FRAME) {
				this.fail(new EngineError('engine sent an invalid frame', 'protocol'));
				return;
			}
			if (this.buffer.length < 4 + payloadLength) {
				return;
			}
			const headerLength = this.buffer.readUInt16LE(4);
			const headerBytes = this.buffer.subarray(6, 6 + headerLength);
			const body = this.buffer.subarray(6 + headerLength, 4 + payloadLength);
			this.buffer = this.buffer.subarray(4 + payloadLength);
			let header: EngineFrame;
			try {
				header = JSON.parse(headerBytes.toString('utf8')) as EngineFrame;
			} catch {
				this.fail(new EngineError('engine sent a malformed header', 'protocol'));
				return;
			}
			this.deliver(header, Buffer.from(body));
		}
	}

	private deliver(header: EngineFrame, body: Buffer): void {
		const id = typeof header.id === 'number' ? header.id : undefined;
		if (id === undefined) {
			return; // notification (log/fatal) without a correlation id
		}
		const entry = this.pending.get(id);
		if (!entry) {
			return; // cancelled or timed out
		}
		if (header.ok === false) {
			this.pending.delete(id);
			entry.reject(new EngineError(String(header.reason ?? 'engine request failed'), header.code));
			return;
		}
		entry.streamed.push({ header, body });
		if (header.chunk === undefined || header.chunk.last) {
			this.pending.delete(id);
			entry.resolve(entry.streamed);
		}
	}

	private handleExit(code: number | null, signal: string | null): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		const reason = `engine exited (${code ?? 'null'}${signal ? `, ${signal}` : ''})`;
		this.fail(new EngineError(reason, 'exited'));
	}

	private fail(error: Error): void {
		for (const entry of this.pending.values()) {
			entry.reject(error);
		}
		this.pending.clear();
	}

	public dispose(): void {
		this.closed = true;
		this.fail(new EngineError('engine disposed', 'disposed'));
		this.child.kill();
	}
}
