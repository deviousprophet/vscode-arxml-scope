/**
 * Smoke test for the engine process: spawn, handshake, open a fixture, rows, plan.
 *
 * Replaces `rust-smoke.mjs`. Runs against the staged binary and fails loudly when
 * the protocol version or an operation contract drifts.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const target = `${process.platform}-${process.arch}`;
const name = process.platform === 'win32' ? 'arxml-engine.exe' : 'arxml-engine';
const binary = path.join(root, 'dist', 'engine', target, name);
if (!existsSync(binary)) {
	console.error(`Engine binary not found: ${binary}. Run "npm run engine:build" first.`);
	process.exit(1);
}

// The protocol frame codec lives in TypeScript; this smoke test speaks it directly.
const { spawn } = await import('node:child_process');
const child = spawn(binary, ['--stdio'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let buffer = Buffer.alloc(0);
const pending = new Map();
let nextId = 1;

function deliver(header, body) {
	const entry = pending.get(header.id);
	if (!entry) return;
	entry.chunks.push({ header, body: Buffer.from(body) });
	if (header.chunk === undefined || header.chunk.last) {
		pending.delete(header.id);
		entry.resolve(entry.chunks);
	}
}

function readFrame() {
	const length = buffer.readUInt32LE(0);
	if (buffer.length < 4 + length) return false;
	const headerLength = buffer.readUInt16LE(4);
	const header = JSON.parse(buffer.subarray(6, 6 + headerLength).toString('utf8'));
	const body = buffer.subarray(6 + headerLength, 4 + length);
	buffer = buffer.subarray(4 + length);
	deliver(header, body);
	return true;
}

function readFrames() {
	while (buffer.length >= 6) {
		if (!readFrame()) return;
	}
}

child.stdout.on('data', (chunk) => {
	buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
	readFrames();
});

function request(op, header = {}, body, timeout = 15000) {
	const id = nextId++;
	const frame = Buffer.from(JSON.stringify({ id, op, ...header }), 'utf8');
	const payload = 2 + frame.length + (body === undefined ? 0 : Buffer.byteLength(body));
	const prefix = Buffer.alloc(6);
	prefix.writeUInt32LE(payload, 0);
	prefix.writeUInt16LE(frame.length, 4);
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${op} timed out`)), timeout);
		pending.set(id, {
			chunks: [],
			resolve: (chunks) => {
				clearTimeout(timer);
				resolve(chunks);
			}
		});
		child.stdin.write(Buffer.concat([prefix, frame, body === undefined ? Buffer.alloc(0) : Buffer.from(body)]));
	});
}

const started = performance.now();
const [hello] = await request('hello');
const protocol = hello.header.protocol;
if (protocol !== 1) {
	console.error(`engine protocol ${protocol} does not match 1`);
	process.exit(1);
}

const fixture = path.join(root, 'src', 'test', 'fixtures', 'basic.arxml');
const text = (await import('node:fs')).readFileSync(fixture, 'utf8');
const [opened] = await request('doc.open', { uri: fixture }, text);
if (opened.header.ecuc !== true) {
	console.error('engine did not recognise the ECUC fixture');
	process.exit(1);
}
const docId = opened.header.docId;
const rowChunks = await request('doc.rows', { docId, options: { sort: 'all' } });
const rows = rowChunks.flatMap((chunk) => JSON.parse(chunk.body.toString('utf8')));

const target_row = rows.find((row) => row.kind === 'parameter' && row.valueKind === 'numeric');
let planned = 0;
if (target_row) {
	const [plan] = await request('doc.plan', { docId, kind: 'value', nodeId: target_row.id, value: '4242' });
	planned = plan.header.ok === true ? 1 : 0;
}

// The engine owns the comparison: two open documents, streamed rows, final envelope.
const otherPath = path.join(root, 'src', 'test', 'fixtures', 'deep.arxml');
const [other] = await request('doc.open', { uri: otherPath }, readFileSync(otherPath, 'utf8'));
const diffChunks = await request(
	'diff.compute',
	{
		left: { docId, name: 'basic.arxml', path: fixture },
		right: { docId: other.header.docId, name: 'deep.arxml', path: otherPath },
		options: { semanticMatching: true }
	},
	undefined,
	60000
);
const diffRows = diffChunks
	.filter((chunk) => chunk.body.length > 0)
	.flatMap((chunk) => JSON.parse(chunk.body.toString('utf8')));
const envelope = diffChunks.map((chunk) => chunk.header.document).find(Boolean);
const diffOk = Boolean(envelope) && diffRows.length === envelope.summary.changed + envelope.summary.added + envelope.summary.removed + envelope.summary.unchanged;

// One copy: move the engine text with the same edit the host applied, then ask for
// the rows it changed instead of the whole document.
const leftSource = readFileSync(fixture, 'utf8');
const valueAt = leftSource.indexOf('<VALUE>');
const valueEnd = leftSource.indexOf('</VALUE>', valueAt);
const valueStart = valueAt + '<VALUE>'.length;
const replacement = leftSource.slice(valueStart, valueEnd) === '0' ? '1' : '0';
await request('doc.update', {
	docId,
	edits: [{ start: valueStart, end: valueEnd, text: replacement }]
});
const [patchAnswer] = await request(
	'diff.patch',
	{
		left: { docId, name: 'basic.arxml', path: fixture },
		right: { docId: other.header.docId, name: 'deep.arxml', path: otherPath },
		edit: { side: 'left', start: valueStart, end: valueEnd, text: replacement }
	},
	undefined,
	60000
);
const patch =
	patchAnswer.header.patch === true
		? JSON.parse(patchAnswer.body.toString('utf8'))
		: undefined;
const patchOk = patch !== undefined && Array.isArray(patch.rows) && patch.at >= 0;

await request('shutdown');
const exitCode = await new Promise((resolve) => child.on('exit', resolve));
console.log(
	JSON.stringify({
		_type: 'engine-smoke',
		protocol,
		engine: hello.header.engine,
		rows: rows.length,
		planned,
		diffRows: diffRows.length,
		diffOk,
		patchRows: patch === undefined ? 0 : patch.rows.length,
		patchReason: patchAnswer.header.reason,
		patchOk,
		exitCode,
		loadMs: Math.round(performance.now() - started)
	})
);
process.exit(exitCode === 0 && planned === 1 && diffOk && patchOk ? 0 : 1);
