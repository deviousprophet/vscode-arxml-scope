/**
 * The engine process client.
 *
 * One long-lived Rust process speaks a framed protocol over stdio:
 * `[u32 LE payload_len][u16 LE header_len][header JSON][body bytes]`. The body carries
 * document text and row JSON raw, so nothing is escaped twice.
 *
 * Pure Node: no `vscode` import. The host passes paths and text; the client owns
 * spawn, framing, correlation and streaming.
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
	id?: number;
	ok?: boolean;
	code?: string;
	reason?: string;
	fatal?: string;
	chunk?: { seq: number; last: boolean; total: number };
	[key: string]: unknown;
}

export interface EngineChunk {
	header: EngineFrame;
	body: Buffer<ArrayBufferLike>;
}

/** The packaged engine binary for one platform/architecture. */
export function engineBinaryPath(
	root: string,
	platform: string = process.platform,
	arch: string = process.arch
): string {
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
const MAX_HEADER = 0xffff;

function assertBuilt(binary: string): void {
	if (!existsSync(binary)) {
		throw new EngineError(`Rust engine is not built at ${binary}; run "npm run engine:build"`);
	}
}

function spawnEngine(options: EngineClientOptions): ChildProcessWithoutNullStreams {
	if (options.spawnProcess) {
		return options.spawnProcess(options.binary);
	}
	const args = options.root ? ['--stdio', '--root', options.root] : ['--stdio'];
	return spawn(options.binary, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
}

function assertProtocol(header: EngineFrame): void {
	if (header.protocol !== EXPECTED_PROTOCOL) {
		throw new EngineError(
			`engine protocol ${String(header.protocol)} does not match ${EXPECTED_PROTOCOL}`
		);
	}
}

/** The request frame, or the reason it cannot be sent. */
function buildFrame(
	id: number,
	op: string,
	header: Record<string, unknown>,
	body: string | Buffer | undefined
): Buffer | string {
	const json = Buffer.from(JSON.stringify({ id, op, ...header }), 'utf8');
	if (json.length > MAX_HEADER) {
		return 'request header is too large';
	}
	const payloadLength = 2 + json.length + bodyLength(body);
	if (payloadLength > MAX_FRAME) {
		return 'request exceeds the frame limit';
	}
	const prefix = Buffer.alloc(6);
	prefix.writeUInt32LE(payloadLength, 0);
	prefix.writeUInt16LE(json.length, 4);
	return Buffer.concat([prefix, json, bodyBuffer(body)]);
}

function bodyLength(body: string | Buffer | undefined): number {
	return body === undefined ? 0 : Buffer.byteLength(body);
}

function bodyBuffer(body: string | Buffer | undefined): Buffer {
	return body === undefined ? Buffer.alloc(0) : Buffer.from(body);
}

function isLastChunk(header: EngineFrame): boolean {
	return header.chunk === undefined || header.chunk.last === true;
}

function isCorrelated(header: EngineFrame): header is EngineFrame & { id: number } {
	return typeof header.id === 'number';
}

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
		assertBuilt(options.binary);
		const client = new EngineClient(spawnEngine(options));
		await client.handshake();
		return client;
	}

	private async handshake(): Promise<void> {
		const hello = await this.request('hello', {}, undefined, 5000);
		assertProtocol(hello.header);
	}

	/** One request; a streaming answer is collected until its last chunk. */
	public async request(
		op: string,
		header: Record<string, unknown> = {},
		body?: string | Buffer,
		timeoutMs = 30_000
	): Promise<EngineChunk> {
		const chunks = await this.send(op, header, body, timeoutMs);
		return chunks[chunks.length - 1] ?? { header: { ok: false }, body: Buffer.alloc(0) };
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
		const frame = buildFrame(id, op, header, body);
		if (typeof frame === 'string') {
			return Promise.reject(new EngineError(frame, 'protocol'));
		}
		return this.awaitReply(id, op, timeoutMs, frame);
	}

	private awaitReply(
		id: number,
		op: string,
		timeoutMs: number,
		frame: Buffer
	): Promise<EngineChunk[]> {
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
			this.child.stdin.write(frame);
		});
	}

	private receive(chunk: Buffer): void {
		this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
		this.drain();
	}

	/** Parses every complete frame in the buffer. */
	private drain(): void {
		while (this.buffer.length >= 6) {
			const frame = this.nextFrame();
			if (frame === undefined) {
				return;
			}
			this.deliver(frame.header, frame.body);
		}
	}

	/** The next complete frame, or `undefined` while the buffer is short or bad. */
	private nextFrame(): { header: EngineFrame; body: Buffer } | undefined {
		const payloadLength = this.buffer.readUInt32LE(0);
		if (!isValidPayload(payloadLength)) {
			this.fail(new EngineError('engine sent an invalid frame', 'protocol'));
			return undefined;
		}
		if (this.buffer.length < 4 + payloadLength) {
			return undefined;
		}
		const headerLength = this.buffer.readUInt16LE(4);
		const header = this.parseHeader(this.buffer.subarray(6, 6 + headerLength));
		const body = Buffer.from(this.buffer.subarray(6 + headerLength, 4 + payloadLength));
		this.buffer = this.buffer.subarray(4 + payloadLength);
		return header === undefined ? undefined : { header, body };
	}

	private parseHeader(bytes: Buffer): EngineFrame | undefined {
		try {
			return JSON.parse(bytes.toString('utf8')) as EngineFrame;
		} catch {
			this.fail(new EngineError('engine sent a malformed header', 'protocol'));
			return undefined;
		}
	}

	private deliver(header: EngineFrame, body: Buffer): void {
		if (!isCorrelated(header)) {
			this.deliverNotification(header);
			return;
		}
		const entry = this.pending.get(header.id);
		if (entry !== undefined) {
			this.complete(header.id, entry, header, body);
		}
	}

	private deliverNotification(header: EngineFrame): void {
		if (header.fatal !== undefined) {
			this.fail(new EngineError(String(header.reason ?? 'engine fatal error'), 'fatal'));
		}
	}

	private complete(id: number, entry: Pending, header: EngineFrame, body: Buffer): void {
		if (header.ok === false) {
			this.pending.delete(id);
			entry.reject(new EngineError(String(header.reason ?? 'engine request failed'), header.code));
			return;
		}
		entry.streamed.push({ header, body });
		if (isLastChunk(header)) {
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

function isValidPayload(payloadLength: number): boolean {
	return payloadLength >= 2 && payloadLength <= MAX_FRAME;
}
