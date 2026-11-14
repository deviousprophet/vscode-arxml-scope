/**
 * Engine process seam tests.
 *
 * The engine is a standalone process: there is no TypeScript core fallback, so a
 * missing binary or a protocol mismatch is an activation error.
 */
import * as assert from 'assert';
import { spawn } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { buildNodeIndex } from '../../core/ecuc/nodeId';
import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { buildRows } from '../../core/ecuc/renderRows';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { buildEdit, buildFieldEdit } from '../../host/ecucEdit';
import { EXPECTED_PROTOCOL } from '../../host/engine/coreEngine';
import { EngineClient, EngineError } from '../../host/engine/engineClient';
import { oracleRows } from '../parity/oracleRows';
import { enginePath, resolveEngine, validateHandshake } from '../../host/engine/engineLoader';
import { repoRoot } from './testUtils';

suite('core engine process', () => {
	test('resolves the engine binary per platform and architecture', () => {
		assert.ok(
			enginePath(repoRoot, 'win32', 'x64').endsWith(
				path.join('dist', 'engine', 'win32-x64', 'arxml-engine.exe')
			)
		);
		assert.ok(
			enginePath(repoRoot, 'linux', 'arm64').endsWith(
				path.join('dist', 'engine', 'linux-arm64', 'arxml-engine')
			)
		);
	});

	test('a missing engine binary is an error, not a TypeScript fallback', async () => {
		const missingRoot = path.join(repoRoot, 'does-not-exist');
		await assert.rejects(() => resolveEngine(missingRoot), /not built/);
	});

	test('a protocol mismatch refuses activation and names both versions', () => {
		const result = validateHandshake({ protocol: EXPECTED_PROTOCOL + 1, engine: 'test' });
		assert.ok('diagnostic' in result);
		assert.match(result.diagnostic, /does not match/);
	});

	test('a handshake without a version is rejected', () => {
		const result = validateHandshake({ protocol: EXPECTED_PROTOCOL });
		assert.ok('diagnostic' in result);
	});

	test('a well-formed handshake yields the engine version', () => {
		const result = validateHandshake({ protocol: EXPECTED_PROTOCOL, engine: '1.2.3' });
		assert.ok('version' in result);
		assert.strictEqual(result.version, '1.2.3');
	});

	test('loads the built engine and answers a document round trip', async () => {
		const binary = enginePath(repoRoot);
		assert.ok(
			fs.existsSync(binary),
			'the engine is required by the test/package build; run npm run engine:build'
		);
		const started = performance.now();
		const engine = await resolveEngine(repoRoot);
		const loadMs = Math.round((performance.now() - started) * 100) / 100;
		console.log(`[engine] process ready in ${loadMs} ms`);
		try {
			assert.strictEqual(engine.kind, 'rust');
			assert.strictEqual(engine.protocol, EXPECTED_PROTOCOL);
			assert.ok(loadMs < 5000, `engine start took ${loadMs} ms`);

			const fixture = path.join(repoRoot, 'src', 'test', 'fixtures', 'basic.arxml');
			const text = fs.readFileSync(fixture, 'utf8');
			const client = await EngineClient.start({ binary, root: repoRoot });
			try {
				const opened = await client.request('doc.open', { uri: fixture }, text);
				const docId = opened.header.docId;
				assert.ok(typeof docId === 'number', 'the engine returns a document id');
				assert.ok(Number(opened.header.modules) > 0, 'the engine counts modules');

				const chunks = await client.requestStream('doc.rows', {
					docId,
					options: { sort: 'all', sortExcept: [] }
				});
				const rows: Array<{ id: string; kind: string }> = chunks.flatMap((chunk: { body: Buffer }) =>
					chunk.body.length === 0 ? [] : (JSON.parse(chunk.body.toString('utf8')) as Array<{ id: string; kind: string }>)
				);
				assert.ok(rows.length > 0, 'the engine returns rows for an ECUC fixture');
				assert.deepStrictEqual(
					rows,
					JSON.parse(oracleRows(fixture, 'all')),
					'engine rows match the TypeScript oracle'
				);
				const parameter = rows.find((row) => row.kind === 'parameter');
				assert.ok(parameter, 'the fixture has a parameter row');

				const planned = await client.request('doc.plan', {
					docId,
					kind: 'value',
					nodeId: parameter.id,
					value: '4242'
				});
				const plan = JSON.parse(planned.body.toString('utf8')) as {
					ok: boolean;
					record?: { newText: string };
				};
				assert.strictEqual(plan.ok, true);
				assert.ok(plan.record?.newText.includes('4242'));
				await client.request('doc.close', { docId });
			} finally {
				client.dispose();
			}
		} finally {
			engine.dispose();
		}
	});
});

interface RowLike {
	id: string;
	kind: string;
	label?: string;
	value?: string;
	valueKind?: string;
	[key: string]: unknown;
}

interface RowPatch {
	at: number;
	remove: number;
	rows: RowLike[];
	structural: boolean;
}

const ROW_OPTIONS = { sort: 'all' as const, sortExcept: [...SORT_EXCEPTIONS] };

function fixture(name: string): string {
	return path.join(repoRoot, 'src', 'test', 'fixtures', name);
}

function engineBinary(): string {
	const binary = enginePath(repoRoot);
	assert.ok(
		fs.existsSync(binary),
		'the engine is required by the test/package build; run npm run engine:build'
	);
	return binary;
}

async function withEngine(run: (client: EngineClient) => Promise<void>): Promise<void> {
	const client = await EngineClient.start({ binary: engineBinary(), root: repoRoot });
	try {
		await run(client);
	} finally {
		client.dispose();
	}
}

async function openText(client: EngineClient, text: string, uri: string): Promise<number> {
	const opened = await client.request('doc.open', { uri, options: ROW_OPTIONS }, text);
	return Number(opened.header.docId);
}

async function readRows(client: EngineClient, docId: number): Promise<RowLike[]> {
	const chunks = await client.requestStream('doc.rows', { docId, options: ROW_OPTIONS });
	return chunks.flatMap((chunk) =>
		chunk.body.length === 0 ? [] : (JSON.parse(chunk.body.toString('utf8')) as RowLike[])
	);
}

/** The path-based id of the parameter named `name`, from the file's first container. */
function parameterIdIn(text: string, name: string): string {
	const model = scanEcucValues(text);
	const index = buildNodeIndex(model);
	const parameter = model.modules[0].containers[0].parameters.find((candidate) => candidate.name === name);
	assert.ok(parameter, name);
	const id = index.idOf(parameter);
	assert.ok(id, name);
	return id;
}

/** The path-based id of the container whose SHORT-NAME is `shortName`. */
function containerIdIn(text: string, shortName: string): string {
	const model = scanEcucValues(text);
	const index = buildNodeIndex(model);
	const container = model.modules[0].containers.find((candidate) => candidate.shortName === shortName);
	assert.ok(container, shortName);
	const id = index.idOf(container);
	assert.ok(id, shortName);
	return id;
}

function moduleIdIn(text: string): string {
	const model = scanEcucValues(text);
	const id = buildNodeIndex(model).idOf(model.modules[0]);
	assert.ok(id);
	return id;
}

/** A document whose 4,100 parameters straddle the engine's 4,000-row chunk size. */
function manyParameters(count: number): string {
	const blocks: string[] = [];
	for (let index = 0; index < count; index++) {
		blocks.push(
			`<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/M/C/P${index}</DEFINITION-REF><VALUE>${index}</VALUE></ECUC-NUMERICAL-PARAM-VALUE>`
		);
	}
	return `<?xml version="1.0" encoding="UTF-8"?><AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/M</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/M/C</DEFINITION-REF><PARAMETER-VALUES>${blocks.join('')}</PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
}

interface RawFrame {
	header: Record<string, unknown>;
	body: Buffer;
}

/** Parses the engine's reply frames from a captured stdout buffer. */
function parseFrames(bytes: Buffer): RawFrame[] {
	const frames: RawFrame[] = [];
	let at = 0;
	while (bytes.length - at >= 6) {
		const payloadLength = bytes.readUInt32LE(at);
		if (bytes.length - at < 4 + payloadLength) {
			break;
		}
		const headerLength = bytes.readUInt16LE(at + 4);
		const header = JSON.parse(bytes.subarray(at + 6, at + 6 + headerLength).toString('utf8')) as Record<
			string,
			unknown
		>;
		const body = Buffer.from(bytes.subarray(at + 6 + headerLength, at + 4 + payloadLength));
		frames.push({ header, body });
		at += 4 + payloadLength;
	}
	return frames;
}

/** Writes raw bytes to a real engine process and collects its frames and exit code. */
function runRawEngine(
	binary: string,
	input: Buffer
): Promise<{ frames: RawFrame[]; code: number | null; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(binary, ['--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
		const chunks: Buffer[] = [];
		let stderr = '';
		let settled = false;
		child.stdin.on('error', () => undefined);
		child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString('utf8');
		});
		const timer = setTimeout(() => {
			child.kill();
			if (!settled) {
				settled = true;
				reject(new Error(`the engine did not exit after a bad frame: ${stderr}`));
			}
		}, 5000);
		child.on('error', (error) => {
			clearTimeout(timer);
			if (!settled) {
				settled = true;
				reject(error);
			}
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			if (!settled) {
				settled = true;
				resolve({ frames: parseFrames(Buffer.concat(chunks)), code, stderr });
			}
		});
		child.stdin.end(input);
	});
}

/**
 * A scripted engine process. It speaks the real frame protocol so the host's
 * correlation can be driven without a product panic input (the Rust engine's panic
 * path is its own `catch_unwind` loop).
 */
const FAKE_ENGINE = `
function write(header, bodyText) {
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const body = Buffer.from(bodyText || '', 'utf8');
  const prefix = Buffer.alloc(6);
  prefix.writeUInt32LE(2 + headerBytes.length + body.length, 0);
  prefix.writeUInt16LE(headerBytes.length, 4);
  process.stdout.write(Buffer.concat([prefix, headerBytes, body]));
}
function malformed() {
  const prefix = Buffer.alloc(6);
  prefix.writeUInt32LE(2 + 3, 0);
  prefix.writeUInt16LE(3, 4);
  process.stdout.write(Buffer.concat([prefix, Buffer.from('{{{', 'utf8')]));
}
let buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    if (buffer.length < 6) return;
    const length = buffer.readUInt32LE(0);
    if (buffer.length < 4 + length) return;
    const headerLength = buffer.readUInt16LE(4);
    const header = JSON.parse(buffer.subarray(6, 6 + headerLength).toString('utf8'));
    buffer = buffer.subarray(4 + length);
    if (header.op === 'hello') write({ id: header.id, ok: true, protocol: 1, engine: 'fake' });
    else if (header.op === 'boom') write({ id: header.id, ok: false, code: 'panic', reason: 'engine error during this operation' });
    else if (header.op === 'malformed') malformed();
    else write({ id: header.id, ok: true });
  }
});
`;

async function startFakeEngine(): Promise<{ client: EngineClient; dispose: () => void }> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arxml-fake-engine-'));
	const script = path.join(dir, 'fake-engine.cjs');
	fs.writeFileSync(script, FAKE_ENGINE);
	// The extension host is Electron: `process.execPath` only runs Node when the
	// runner marks it as one, which is also how `@vscode/test-electron` starts it.
	const child = spawn(process.execPath, [script], {
		stdio: ['pipe', 'pipe', 'pipe'],
		env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
	});
	const dispose = (): void => {
		child.kill();
		fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
	};
	try {
		const client = await EngineClient.start({ binary: process.execPath, spawnProcess: () => child });
		return {
			client,
			dispose: () => {
				client.dispose();
				dispose();
			}
		};
	} catch (error) {
		dispose();
		throw error;
	}
}

suite('plan coverage: ENG', () => {
	test('ENG-02 an oversized frame and a malformed header are protocol errors that exit 1', async () => {
		const binary = engineBinary();

		// A length prefix above the 64 MiB frame limit fails before any body is read.
		const oversized = await runRawEngine(binary, Buffer.from([0xff, 0xff, 0xff, 0xff]));
		assert.strictEqual(oversized.code, 1, oversized.stderr);
		assert.strictEqual(oversized.frames.length, 1, oversized.stderr);
		assert.strictEqual(oversized.frames[0].header.fatal, 'protocol');
		assert.match(String(oversized.frames[0].header.reason), /bad frame length/);

		// payload 3 = two-byte header length + the one-byte header `{`, which is not JSON.
		const malformed = await runRawEngine(binary, Buffer.from([3, 0, 0, 0, 1, 0, 0x7b]));
		assert.strictEqual(malformed.code, 1, malformed.stderr);
		assert.strictEqual(malformed.frames.length, 1, malformed.stderr);
		assert.strictEqual(malformed.frames[0].header.fatal, 'protocol');

		// The host side: a malformed reply rejects the pending request as a protocol error.
		const fake = await startFakeEngine();
		try {
			await assert.rejects(
				() => fake.client.request('malformed'),
				(error: unknown) =>
					error instanceof EngineError && error.code === 'protocol' && /malformed header/.test(error.message)
			);
			assert.strictEqual(fake.client.isClosed, false, 'a malformed frame does not close the client by itself');
		} finally {
			fake.dispose();
		}
	});

	test('ENG-03 a panic reply rejects one operation and the process keeps serving', async () => {
		const fake = await startFakeEngine();
		try {
			await assert.rejects(
				() => fake.client.request('boom'),
				(error: unknown) =>
					error instanceof EngineError && error.code === 'panic' && /engine error during this operation/.test(error.message)
			);
			assert.strictEqual(fake.client.isClosed, false, 'the engine process survived the failed operation');
			const next = await fake.client.request('still-alive');
			assert.strictEqual(next.header.ok, true, 'the next call is served');
		} finally {
			fake.dispose();
		}
	});

	test('ENG-04 doc.rows reassembles 4,000-row chunk boundaries in order', async () => {
		await withEngine(async (client) => {
			const text = manyParameters(4100);
			const docId = await openText(client, text, '/chunks.arxml');
			const chunks = await client.requestStream('doc.rows', { docId, options: ROW_OPTIONS });
			assert.ok(chunks.length >= 2, `the engine chunked ${chunks.length} times`);

			const sizes = chunks.map((chunk) =>
				chunk.body.length === 0 ? 0 : (JSON.parse(chunk.body.toString('utf8')) as RowLike[]).length
			);
			assert.deepStrictEqual(sizes, [4000, 102], 'the boundary is 4,000 rows');
			assert.deepStrictEqual(chunks.map((chunk) => chunk.header.chunk?.seq), [0, 4000]);
			assert.ok(
				chunks.every((chunk) => chunk.header.chunk?.total === 4102),
				'every chunk reports the whole row count'
			);

			const rows = chunks.flatMap((chunk) =>
				chunk.body.length === 0 ? [] : (JSON.parse(chunk.body.toString('utf8')) as RowLike[])
			);
			assert.strictEqual(new Set(rows.map((row) => row.id)).size, rows.length, 'no row is duplicated');
			const expected = buildRows(scanEcucValues(text), ROW_OPTIONS).rows;
			assert.deepStrictEqual(rows, JSON.parse(JSON.stringify(expected)), 'reassembly keeps the row order');
		});
	});

	test('ENG-05 plan refusals are byte-identical to the TypeScript plan', async () => {
		await withEngine(async (client) => {
			const text = fs.readFileSync(fixture('editing/cdata.arxml'), 'utf8');
			const model = scanEcucValues(text);
			const docId = await openText(client, text, '/cdata.arxml');
			const pattern = parameterIdIn(text, 'Pattern');
			const container = containerIdIn(text, 'EditCont');
			const module = moduleIdIn(text);

			const cases: Array<{ name: string; request: Record<string, unknown>; plan: string }> = [
				{
					name: 'CDATA value',
					request: { kind: 'value', nodeId: pattern, value: 'x' },
					plan: JSON.stringify(buildEdit(model, text, pattern, 'x'))
				},
				{
					name: 'unknown node',
					request: { kind: 'value', nodeId: 'no/such#0', value: '1' },
					plan: JSON.stringify(buildEdit(model, text, 'no/such#0', '1'))
				},
				{
					name: 'module field edit',
					request: { kind: 'field', nodeId: module, field: 'shortName', value: 'Renamed' },
					plan: JSON.stringify(buildFieldEdit(model, text, module, 'shortName', 'Renamed'))
				},
				{
					name: 'unchanged short name',
					request: { kind: 'field', nodeId: container, field: 'shortName', value: 'EditCont' },
					plan: JSON.stringify(buildFieldEdit(model, text, container, 'shortName', 'EditCont'))
				}
			];

			for (const item of cases) {
				const answer = await client.request('doc.plan', { docId, ...item.request });
				const enginePlan = JSON.parse(answer.body.toString('utf8')) as { ok: boolean };
				assert.strictEqual(enginePlan.ok, false, item.name);
				assert.strictEqual(JSON.stringify(enginePlan), item.plan, item.name);
			}
		});
	});

	test('ENG-06 doc.update and a full doc.rows build agree on rows and bytes', async () => {
		await withEngine(async (client) => {
			const text = fs.readFileSync(fixture('basic.arxml'), 'utf8');
			const docId = await openText(client, text, '/basic.arxml');
			const rows = await readRows(client, docId);
			const target = rows.find((row) => row.kind === 'parameter');
			assert.ok(target, 'the fixture has a parameter row');

			const planned = await client.request('doc.plan', {
				docId,
				kind: 'value',
				nodeId: target!.id,
				value: '4242'
			});
			const plan = JSON.parse(planned.body.toString('utf8')) as {
				ok: boolean;
				record: { range: { start: number; end: number }; oldText: string; newText: string };
			};
			assert.strictEqual(plan.ok, true, 'the engine accepted the edit');
			const { range, oldText, newText } = plan.record;
			assert.strictEqual(text.slice(range.start, range.end), oldText, 'the plan names the bytes it replaces');
			const updatedText = text.slice(0, range.start) + newText + text.slice(range.end);

			const updated = await client.request('doc.update', {
				docId,
				edits: [{ start: range.start, end: range.end, text: newText }]
			});
			const patch = JSON.parse(updated.body.toString('utf8')) as RowPatch;
			const patched = [...rows.slice(0, patch.at), ...patch.rows, ...rows.slice(patch.at + patch.remove)];

			const fullDocId = await openText(client, updatedText, '/updated.arxml');
			const full = await readRows(client, fullDocId);
			assert.deepStrictEqual(patched, full, 'the fast path and the full path carry the same rows');

			const reopened = await client.request('doc.open', { uri: '/bytes.arxml', options: ROW_OPTIONS }, updatedText);
			assert.strictEqual(
				updatedText.length,
				Number(reopened.header.textLength),
				'the spliced bytes are the length a full open reports'
			);
		});
	});

	test('ENG-08 two document handles stay isolated when one is closed', async () => {
		await withEngine(async (client) => {
			const numeric = fs.readFileSync(fixture('editing/numeric.arxml'), 'utf8');
			const textual = fs.readFileSync(fixture('editing/textual.arxml'), 'utf8');
			const numericId = await openText(client, numeric, '/numeric.arxml');
			const textualId = await openText(client, textual, '/textual.arxml');
			assert.notStrictEqual(numericId, textualId, 'each panel has its own handle');

			const textualRows = await readRows(client, textualId);
			await client.request('doc.close', { docId: numericId });
			await assert.rejects(() => readRows(client, numericId), /unknown document/);
			assert.deepStrictEqual(await readRows(client, textualId), textualRows, 'the other panel still answers');
		});
	});
});

