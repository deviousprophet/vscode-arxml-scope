/**
 * Supervisor tests: restart, replay, stable ids, give-up and disposal.
 *
 * The fake client speaks just enough of the protocol for `createEngine` to work, so
 * the test exercises the real supervisor and the real core-engine adapter without a
 * Rust binary. Restart timers are unref'd; dispose clears them.
 */
import * as assert from 'assert';

import { EngineError, type EngineChunk, type EngineClient, type EngineSpawner } from '../../host/engine/engineClient';
import { applyTextChanges, createEngineSupervisor, EngineSupervisor } from '../../host/engine/engineSupervisor';
import { formatEngineHealth } from '../../host/engine/engineHealth';

const ROW_OPTIONS = { sort: 'all' as const, sortExcept: [] };

class FakeClient {
	public closed = false;
	public readonly pid: number;
	public readonly opened = new Map<number, { uri: string; text: string }>();
	private nextDocument = 1;
	private readonly onExit: ((error: EngineError) => void) | undefined;

	public constructor(onExit?: (error: EngineError) => void, pid = 100) {
		this.onExit = onExit;
		this.pid = pid;
	}

	public get isClosed(): boolean {
		return this.closed;
	}

	public get pendingCount(): number {
		return 0;
	}

	private readonly handlers: Record<string, (header: Record<string, unknown>, body?: string | Buffer) => EngineChunk> = {
		hello: () => this.chunk({ protocol: 1, engine: 'fake-1' }),
		'doc.open': (header, body) => {
			const docId = this.nextDocument++;
			this.opened.set(docId, { uri: String(header.uri), text: String(body ?? '') });
			return this.chunk({ docId });
		},
		'doc.close': (header) => {
			this.opened.delete(Number(header.docId));
			return this.chunk({});
		},
		'doc.plan': () =>
			this.chunk(
				{},
				Buffer.from(
					JSON.stringify({
						ok: true,
						record: {
							nodeId: 'n',
							region: 'r',
							range: { start: 0, end: 0 },
							oldText: '',
							newText: 'x'
						}
					})
				)
			),
		'doc.update': () =>
			this.chunk({}, Buffer.from(JSON.stringify({ at: 0, remove: 0, rows: [], structural: false })))
	};

	public async request(op: string, header: Record<string, unknown> = {}, body?: string | Buffer): Promise<EngineChunk> {
		const handler = this.handlers[op];
		return handler === undefined ? this.chunk({ ok: true }) : handler(header, body);
	}

	public async requestStream(op: string, header: Record<string, unknown> = {}): Promise<EngineChunk[]> {
		return [await this.request(op, header)];
	}

	public crash(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.onExit?.(new EngineError('engine exited (1, crash)', 'exited'));
	}

	public dispose(): void {
		this.closed = true;
	}

	private chunk(header: Record<string, unknown>, body: Buffer = Buffer.alloc(0)): EngineChunk {
		return { header: { id: 1, ok: true, ...header }, body };
	}
}

function fakeSpawner(pidBase = 100): { clients: FakeClient[]; start: EngineSpawner } {
	const clients: FakeClient[] = [];
	const start: EngineSpawner = async (_binary, _root, onExit) => {
		const client = new FakeClient(onExit, pidBase + clients.length);
		clients.push(client);
		return client as unknown as EngineClient;
	};
	return { clients, start };
}

async function waitForClients(clients: FakeClient[], count: number): Promise<void> {
	for (let attempt = 0; attempt < 100 && clients.length < count; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	if (clients.length < count) {
		throw new Error(`expected ${count} clients, saw ${clients.length}`);
	}
}

async function waitForRunning(engine: { health?: () => Promise<{ state: string }> }): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (await isRunning(engine)) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error('the supervisor did not return to running');
}

async function isRunning(engine: { health?: () => Promise<{ state: string }> }): Promise<boolean> {
	const health = await engine.health?.();
	return health?.state === 'running';
}

suite('engine supervisor', () => {
	test('reopens live documents after a process crash and keeps their ids', async () => {
		const { clients, start } = fakeSpawner();
		const engine = await createEngineSupervisor({ binary: 'fake', root: '/', start });
		try {
			const docId = await engine.openDocument('mem://left.arxml', '<A/>', ROW_OPTIONS);
			assert.strictEqual(docId, 1);
			assert.strictEqual(clients.length, 1);

			clients[0].crash();
			const planned = await engine.planEdit(docId, { kind: 'value', nodeId: 'n', value: '2' });
			assert.strictEqual(planned.ok, true);
			assert.strictEqual(clients.length, 2, 'a second process replaced the crashed one');
			assert.deepStrictEqual(clients[1].opened.get(1), {
				uri: 'mem://left.arxml',
				text: '<A/>'
			});

			const second = await engine.openDocument('mem://right.arxml', '<B/>', ROW_OPTIONS);
			assert.strictEqual(second, 2, 'host ids are stable across processes');
			assert.strictEqual((await engine.health?.())?.openDocuments, 2);
		} finally {
			engine.dispose();
		}
	});

	test('replays the edited text, not the original text', async () => {
		const { clients, start } = fakeSpawner();
		const engine = await createEngineSupervisor({ binary: 'fake', root: '/', start });
		try {
			const docId = await engine.openDocument('mem://left.arxml', 'abcd', ROW_OPTIONS);
			await engine.updateDocument(docId, [{ start: 1, end: 2, text: 'XY' }]);
			clients[0].crash();
			await engine.planEdit(docId, { kind: 'value', nodeId: 'n', value: '2' });
			assert.strictEqual(clients[1].opened.get(1)?.text, 'aXYcd');
		} finally {
			engine.dispose();
		}
	});

	test('gives up after the restart limit with an actionable error', async () => {
		const start: EngineSpawner = async () => {
			throw new EngineError('spawn failed', 'spawn');
		};
		const supervisor = new EngineSupervisor({ binary: 'fake', root: '/', start, maxRestarts: 2 });
		await assert.rejects(() => supervisor.start(), /spawn failed/);
		await assert.rejects(() => supervisor.openDocument('mem://x.arxml', '', ROW_OPTIONS), /unavailable/);
		const health = await supervisor.health();
		assert.strictEqual(health.state, 'failed');
		assert.match(health.lastError ?? '', /spawn failed/);
		supervisor.dispose();
	});

	test('counts rapid process crashes and gives up at the limit', async () => {
		const { clients, start } = fakeSpawner();
		const engine = await createEngineSupervisor({ binary: 'fake', root: '/', start, maxRestarts: 3 });
		try {
			const docId = await engine.openDocument('mem://left.arxml', '<A/>', ROW_OPTIONS);
			clients[0].crash();
			await waitForClients(clients, 2);
			await waitForRunning(engine);
			clients[1].crash();
			await waitForClients(clients, 3);
			await waitForRunning(engine);
			clients[2].crash();
			await new Promise((resolve) => setTimeout(resolve, 100));
			const health = await engine.health!();
			assert.strictEqual(health.state, 'failed');
			assert.match(health.lastError ?? '', /exited/);
			await assert.rejects(
				() => engine.planEdit(docId, { kind: 'value', nodeId: 'n', value: '2' }),
				/unavailable/
			);
		} finally {
			engine.dispose();
		}
	});

	test('a successful request clears the last error', async () => {
		const { clients, start } = fakeSpawner();
		const engine = await createEngineSupervisor({ binary: 'fake', root: '/', start });
		try {
			const docId = await engine.openDocument('mem://left.arxml', '<A/>', ROW_OPTIONS);
			clients[0].crash();
			await waitForClients(clients, 2);
			await waitForRunning(engine);
			assert.match((await engine.health!()).lastError ?? '', /exited/);
			await engine.planEdit(docId, { kind: 'value', nodeId: 'n', value: '2' });
			const health = await engine.health!();
			assert.strictEqual(health.lastError, undefined);
			assert.strictEqual(health.state, 'running');
		} finally {
			engine.dispose();
		}
	});

	test('dispose stops restarts', async () => {
		const { clients, start } = fakeSpawner();
		const engine = await createEngineSupervisor({ binary: 'fake', root: '/', start });
		await engine.openDocument('mem://left.arxml', '<A/>', ROW_OPTIONS);
		engine.dispose();
		await new Promise((resolve) => setTimeout(resolve, 200));
		assert.strictEqual(clients.length, 1, 'no process was spawned after dispose');
	});

	test('applies UTF-16 edits in descending order', () => {
		assert.strictEqual(
			applyTextChanges('abcd', [
				{ start: 0, end: 1, text: 'X' },
				{ start: 2, end: 3, text: 'YZ' }
			]),
			'XbYZd'
		);
	});

	test('formats every health field', async () => {
		const { start } = fakeSpawner(4242);
		const engine = await createEngineSupervisor({ binary: 'fake', root: '/', start });
		try {
			const health = await engine.health?.();
			assert.ok(health);
			const text = formatEngineHealth(health);
			assert.match(text, /state:\s+running/);
			assert.match(text, /engine version:\s+fake-1/);
			assert.match(text, /pid:\s+4242/);
			assert.match(text, /open documents:\s+0/);
			assert.match(text, /memory:\s+(unavailable|\d)/);
			assert.match(text, /last error:\s+none/);
		} finally {
			engine.dispose();
		}
	});
});
