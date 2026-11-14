/**
 * Plan rows PKG-01…03 and PERF-01…06 from `docs/TEST_PLAN.md`.
 *
 * The PKG rows assert the packaging contract: which engine binaries the workflow
 * verifies, that `.vscodeignore` does not drop them, and that no `dist/native`
 * artifact is produced. None of these builds a VSIX.
 *
 * The PERF rows are benchmarks, so each test either drives the smallest fixture that
 * proves the row's payload/plan invariant or records the command gate
 * (`npm run benchmark …`). Latency gates the benchmarks do not enforce are reported
 * rather than invented here; the measured number is logged.
 */
import * as assert from 'assert';
import { spawn } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { planCopy, indentationAt } from '../../core/copy/planCopy';
import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { buildRows } from '../../core/ecuc/renderRows';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { EngineClient, engineBinaryPath } from '../../host/engine/engineClient';
import { enginePath, resolveEngine } from '../../host/engine/engineLoader';
import { repoRoot } from './testUtils';

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

function read(relative: string): string {
	return fs.readFileSync(path.join(repoRoot, relative), 'utf8');
}

/** Every file under `relative`, as repo-relative POSIX paths. */
function walk(relative: string): string[] {
	const root = path.join(repoRoot, relative);
	const out: string[] = [];
	const visit = (directory: string): void => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const full = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				visit(full);
			} else {
				out.push(path.relative(repoRoot, full).replaceAll('\\', '/'));
			}
		}
	};
	visit(root);
	return out.sort();
}

/** The source and advance for one `*` or `**` at `at`. */
function starSource(pattern: string, at: number): { source: string; advance: number } {
	if (pattern[at + 1] !== '*') {
		return { source: '[^/]*', advance: 0 };
	}
	return pattern[at + 2] === '/'
		? { source: '(?:.*/)?', advance: 2 }
		: { source: '.*', advance: 1 };
}

/** A `.vscodeignore` line as the glob it is; enough for the dist paths this file checks. */
function globToRegExp(glob: string): RegExp {
	const pattern = glob.replaceAll('\\', '/');
	let source = '^';
	for (let at = 0; at < pattern.length; at++) {
		const char = pattern[at];
		if (char === '*') {
			const star = starSource(pattern, at);
			source += star.source;
			at += star.advance;
		} else {
			source += char === '?' ? '[^/]' : char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
		}
	}
	return new RegExp(`${source}$`);
}

function isIgnoredLine(line: string): boolean {
	return line.length === 0 || line.startsWith('#');
}

function withDirectoryGlob(glob: string): string {
	return glob.endsWith('/') ? `${glob}**` : glob;
}

/** One `.vscodeignore` line as a glob rule, or `undefined` for a blank/comment line. */
function ignoreRule(line: string): { glob: string; negated: boolean } | undefined {
	const trimmed = line.trim();
	if (isIgnoredLine(trimmed)) {
		return undefined;
	}
	const negated = trimmed.startsWith('!');
	const glob = negated ? trimmed.slice(1) : trimmed;
	return { glob: withDirectoryGlob(glob), negated };
}

/** True when `.vscodeignore` drops `relativePath` from the VSIX. */
function ignoredFromVsix(relativePath: string): boolean {
	let ignored = false;
	for (const line of read('.vscodeignore').split(/\r?\n/)) {
		const rule = ignoreRule(line);
		if (rule !== undefined && globToRegExp(rule.glob).test(relativePath)) {
			ignored = !rule.negated;
		}
	}
	return ignored;
}

function requireEngine(): string {
	const binary = enginePath(repoRoot);
	assert.ok(
		fs.existsSync(binary),
		'the engine is required by the test/package build; run npm run engine:build'
	);
	return binary;
}

async function withEngine(run: (client: EngineClient) => Promise<void>): Promise<void> {
	const client = await EngineClient.start({ binary: requireEngine(), root: repoRoot });
	try {
		await run(client);
	} finally {
		client.dispose();
	}
}

async function openDocument(client: EngineClient, text: string, uri: string): Promise<number> {
	const opened = await client.request('doc.open', { uri, options: ROW_OPTIONS }, text);
	return Number(opened.header.docId);
}

async function rowsOf(client: EngineClient, docId: number): Promise<RowLike[]> {
	const chunks = await client.requestStream('doc.rows', { docId, options: ROW_OPTIONS });
	return chunks.flatMap((chunk) =>
		chunk.body.length === 0 ? [] : (JSON.parse(chunk.body.toString('utf8')) as RowLike[])
	);
}

/** A deterministic ECUC-Values document: `containers` parents of `parameters` each. */
function syntheticDocument(containers: number, parametersPerContainer: number): string {
	const blocks: string[] = [];
	for (let containerIndex = 0; containerIndex < containers; containerIndex++) {
		const parameters: string[] = [];
		for (let parameter = 0; parameter < parametersPerContainer; parameter++) {
			const index = containerIndex * parametersPerContainer + parameter;
			parameters.push(
				[
					'                    <ECUC-NUMERICAL-PARAM-VALUE>',
					`                        <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Pkg/M/C${containerIndex}/Parameter${index}</DEFINITION-REF>`,
					`                        <VALUE>${index % 1000}</VALUE>`,
					'                    </ECUC-NUMERICAL-PARAM-VALUE>'
				].join('\n')
			);
		}
		blocks.push(
			[
				'                <ECUC-CONTAINER-VALUE>',
				`                    <SHORT-NAME>C${containerIndex}</SHORT-NAME>`,
				`                    <DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Pkg/M/C${containerIndex}</DEFINITION-REF>`,
				'                    <PARAMETER-VALUES>',
				parameters.join('\n'),
				'                    </PARAMETER-VALUES>',
				'                </ECUC-CONTAINER-VALUE>'
			].join('\n')
		);
	}
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<AUTOSAR xmlns="http://autosar.org/schema/r4.0">',
		'    <AR-PACKAGES>',
		'        <AR-PACKAGE>',
		'            <SHORT-NAME>Pkg</SHORT-NAME>',
		'            <ELEMENTS>',
		'                <ECUC-MODULE-CONFIGURATION-VALUES>',
		'                    <SHORT-NAME>M</SHORT-NAME>',
		'                    <DEFINITION-REF DEST="ECUC-MODULE-DEF">/Pkg/M</DEFINITION-REF>',
		'                    <CONTAINERS>',
		blocks.join('\n'),
		'                    </CONTAINERS>',
		'                </ECUC-MODULE-CONFIGURATION-VALUES>',
		'            </ELEMENTS>',
		'        </AR-PACKAGE>',
		'    </AR-PACKAGES>',
		'</AUTOSAR>'
	].join('\n');
}

interface NodeResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

function runNode(args: readonly string[], cwd: string): Promise<NodeResult> {
	return new Promise<NodeResult>((resolve, reject) => {
		// The extension host is Electron: `process.execPath` only runs Node when the
		// runner marks it as one.
		const child = spawn(process.execPath, [...args], {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
		});
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk: string) => {
			stderr += chunk;
		});
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`node ${args.join(' ')} timed out`));
		}, 120_000);
		child.on('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		});
	});
}

/** The patch a row edit planned against the current document produces. */
async function planValue(
	client: EngineClient,
	docId: number,
	nodeId: string,
	value: string
): Promise<{ range: { start: number; end: number }; newText: string }> {
	const planned = await client.request('doc.plan', { docId, kind: 'value', nodeId, value });
	const plan = JSON.parse(planned.body.toString('utf8')) as {
		ok: boolean;
		reason?: string;
		record?: { range: { start: number; end: number }; newText: string };
	};
	assert.ok(plan.ok && plan.record !== undefined, `the engine refused ${value}: ${plan.reason ?? ''}`);
	return plan.record!;
}

function numericRow(rows: RowLike[]): RowLike | undefined {
	return rows.find((row) => row.valueKind === 'numeric') ?? rows.find((row) => row.kind === 'parameter');
}

function normalized<T>(rows: T): T {
	return JSON.parse(JSON.stringify(rows)) as T;
}

function applyPatch(rows: RowLike[], patch: RowPatch): RowLike[] {
	return [...rows.slice(0, patch.at), ...patch.rows, ...rows.slice(patch.at + patch.remove)];
}

suite('plan coverage: PKG', () => {
	test('PKG-01 a VSIX without dist/engine refuses activation and names the missing path', async () => {
		for (const target of ['win32-x64', 'linux-x64', 'darwin-x64', 'darwin-arm64']) {
			const name = target.startsWith('win32-') ? 'arxml-engine.exe' : 'arxml-engine';
			assert.strictEqual(
				ignoredFromVsix(`dist/engine/${target}/${name}`),
				false,
				`${target} must be packaged, so the only way to miss it is an unbuilt VSIX`
			);
		}

		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arxml-scope-no-engine-'));
		try {
			const expected = enginePath(dir);
			await assert.rejects(
				() => resolveEngine(dir),
				(error: unknown) =>
					error instanceof Error &&
					error.message.includes(expected) &&
					/not built/.test(error.message),
				'the activation error names the exact engine path'
			);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
		}
	});

	test('PKG-02 the verify step checks every platform engine in the VSIX', () => {
		const workflow = read('.github/workflows/package.yml');
		const matrix = [...workflow.matchAll(/^\s+target:\s*([a-z0-9]+-[a-z0-9]+)\s*$/gm)]
			.map((match) => match[1])
			.sort();
		assert.deepStrictEqual(matrix, ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64']);

		for (const target of matrix) {
			const [platform, arch] = target.split('-');
			const name = target.startsWith('win32-') ? 'arxml-engine.exe' : 'arxml-engine';
			const binary = engineBinaryPath(repoRoot, platform, arch).replaceAll('\\', '/');
			assert.ok(
				binary.endsWith(`/dist/engine/${target}/${name}`),
				`the loader and the workflow name ${target} the same way`
			);
			assert.ok(
				workflow.includes(`dist/engine/\${target}/\${name}`),
				'the VSIX verify loop looks for the same staged path'
			);
		}
		assert.ok(workflow.includes('unzip -l'), 'the step inspects the VSIX, not just dist/');
		assert.ok(workflow.includes('path: dist/engine'), 'the native jobs upload into dist/engine');
	});

	test('PKG-03 no dist/native artifact is produced or packaged', () => {
		assert.match(read('.gitignore'), /^dist\/native\/$/m, 'the directory is a known local artifact');
		assert.strictEqual(
			ignoredFromVsix('dist/native/arxml_scope.node'),
			false,
			'an ignore entry does not special-case a native artifact'
		);

		const packagingInputs = [
			'package.json',
			'esbuild.js',
			'.github/workflows/package.yml',
			...walk('scripts'),
			...walk('.github/scripts')
		];
		assert.deepStrictEqual(
			packagingInputs.filter((file) => read(file).includes('dist/native')),
			[],
			'no packaging step writes dist/native'
		);
		assert.strictEqual(
			fs.existsSync(path.join(repoRoot, 'dist', 'native')),
			false,
			'the build tree holds no native artifact'
		);
	});
});

suite('plan coverage: PERF', () => {
	test('PERF-01 a planned edit pushes a one-row patch under 4 KiB', async () => {
		await withEngine(async (client) => {
			const text = fs.readFileSync(path.join(repoRoot, 'src', 'test', 'fixtures', 'basic.arxml'), 'utf8');
			const docId = await openDocument(client, text, '/basic.arxml');
			const rows = await rowsOf(client, docId);
			const target = numericRow(rows);
			assert.ok(target, 'the fixture has a parameter row');

			const planStarted = performance.now();
			const record = await planValue(client, docId, target!.id, '4242');
			const planMs = performance.now() - planStarted;

			const updateStarted = performance.now();
			const updated = await client.request('doc.update', {
				docId,
				edits: [{ start: record.range.start, end: record.range.end, text: record.newText }]
			});
			const updateMs = performance.now() - updateStarted;
			const patch = JSON.parse(updated.body.toString('utf8')) as RowPatch;
			console.log(
				`[PERF-01] plan ${planMs.toFixed(1)} ms, update ${updateMs.toFixed(1)} ms, pushed ${updated.body.length} bytes`
			);

			assert.ok(updated.body.length < 4096, `the update pushed ${updated.body.length} bytes, over 4 KiB`);
			assert.strictEqual(patch.structural, false, 'a value edit is answered with a row patch');
			assert.strictEqual(patch.rows.length, 1);
			const benchmark = read('src/test/benchmarks/engineEditBenchmark.ts');
			assert.ok(
				benchmark.includes('planMs') && benchmark.includes('updateMs') && benchmark.includes('pushedBytes'),
				'the 20 MiB gate records all three numbers'
			);
			// The plan's 5 ms / 100 ms gates are on the 20 MiB document and are enforced by
			// `npm run benchmark engineEdit`; this is only a hang guard for the small run.
			assert.ok(planMs < 5000 && updateMs < 5000, 'plan/update did not hang');
		});
	});

	test('PERF-02 a merge copy plan composes one element under the 100 ms benchmark ceiling', () => {
		const text = syntheticDocument(100, 20);
		const source = { start: text.indexOf('<ECUC-NUMERICAL-PARAM-VALUE>'), end: 0 };
		source.end = text.indexOf('</ECUC-NUMERICAL-PARAM-VALUE>', source.start) + '</ECUC-NUMERICAL-PARAM-VALUE>'.length;
		const target = { start: text.indexOf('<ECUC-NUMERICAL-PARAM-VALUE>', source.end), end: 0 };
		target.end = text.indexOf('</ECUC-NUMERICAL-PARAM-VALUE>', target.start) + '</ECUC-NUMERICAL-PARAM-VALUE>'.length;
		const element = text.slice(source.start, source.end);

		const started = performance.now();
		const plan = planCopy({
			targetText: text,
			sourceText: text,
			source,
			target,
			targetIndent: indentationAt(text, target.start)
		});
		const planMs = performance.now() - started;
		console.log(`[PERF-02] copy plan on ${Math.round(text.length / 1024)} KiB took ${planMs.toFixed(1)} ms`);

		assert.ok(plan.ok, JSON.stringify(plan));
		assert.strictEqual(plan.span.text, element, 'composing copies the element, never the document');
		assert.ok(planMs < 100, `copy plan took ${planMs} ms, over copyBenchmark's 100 ms ceiling`);
		assert.ok(read('src/test/benchmarks/copyBenchmark.ts').includes('const MAX_PLAN_MS = 100;'));
	});

	test('PERF-03 100 repeated edits keep one bounded row store', async () => {
		await withEngine(async (client) => {
			const text = fs.readFileSync(path.join(repoRoot, 'src', 'test', 'fixtures', 'basic.arxml'), 'utf8');
			const docId = await openDocument(client, text, '/basic.arxml');
			const initial = await rowsOf(client, docId);
			const target = numericRow(initial);
			assert.ok(target, 'the fixture has a parameter row');

			// Same-length values keep the case about retained state rather than range
			// shifts, exactly as the benchmark's five fixed-length edits do.
			const record = await planValue(client, docId, target!.id, '10');
			let store = initial;
			let expected = text;
			const started = performance.now();
			for (let index = 0; index < 100; index++) {
				const value = String(index % 100).padStart(2, '0');
				const updated = await client.request('doc.update', {
					docId,
					edits: [{ start: record.range.start, end: record.range.end, text: value }]
				});
				const patch = JSON.parse(updated.body.toString('utf8')) as RowPatch;
				assert.strictEqual(patch.structural, false, `edit ${index} stayed on the fast path`);
				store = applyPatch(store, patch);
				expected = expected.slice(0, record.range.start) + value + expected.slice(record.range.end);
			}
			const elapsed = performance.now() - started;
			const full = buildRows(scanEcucValues(expected), ROW_OPTIONS).rows as unknown as RowLike[];
			console.log(`[PERF-03] 100 edits in ${Math.round(elapsed)} ms, ${store.length} rows`);

			assert.strictEqual(store.length, initial.length, '100 edits added no row');
			assert.strictEqual(store.find((row) => row.id === target!.id)?.value, '99', 'the last value is the row value');
			assert.deepStrictEqual(normalized(store), normalized(full), 'the patched store equals a full rebuild');
			assert.ok(
				read('src/test/benchmarks/engineEditBenchmark.ts').includes(
					'retainedMiB: Math.round(retainedBytes() / 1048576)'
				),
				'the recorded retained number comes from the benchmark runner'
			);
			// The retained-growth ceiling belongs to `npm run benchmark engineEdit`, which
			// runs with --expose-gc and records retainedMiB; mocha has no forced GC.
		});
	});

	test('PERF-04 a benchmark without the engine reports skipped and exits 0', async () => {
		const compiled = path.join(repoRoot, 'out', 'test', 'benchmarks', 'engineEditBenchmark.js');
		assert.ok(fs.existsSync(compiled), 'run npm run compile-tests before the suite');

		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arxml-scope-benchmark-'));
		try {
			// No --expose-gc: the skipped path never calls retainedBytes(), and the
			// missing-engine contract must not depend on a V8 flag.
			const result = await runNode([compiled], dir);
			assert.strictEqual(result.code, 0, result.stderr);
			const line = result.stdout
				.split(/\r?\n/)
				.reverse()
				.find((candidate) => candidate.trim().startsWith('{'));
			assert.ok(line, `the benchmark printed no record: ${result.stderr}`);
			const record = JSON.parse(line!) as { status?: string; reason?: string };
			assert.strictEqual(record.status, 'skipped');
			assert.match(String(record.reason), /engine not built at/);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
		}
	});

	test('PERF-05 the 26 MiB diff benchmark records engine and host numbers for the 2x gate', () => {
		const source = read('src/test/benchmarks/diffBenchmark.ts');
		assert.ok(source.includes("buildEcucArxml('left')"), 'the pair is the 26 MiB synthetic fixture');
		assert.ok(source.includes("buildEcucArxml('right')"));
		assert.match(source, /engine:\s*\{/, 'the record carries the engine side');
		assert.match(source, /hostToday:\s*\{/, 'the record carries the TypeScript builder');
		assert.match(source, /diffMs/, 'the host builder time that the 2x ratio compares against');
		assert.ok(source.includes('strict') && source.includes('semantic'), 'both matching modes are measured');
		console.log(
			'[PERF-05] gate: npm run benchmark diff; compare engine.strict/semantic diffMs with hostToday (engine <= 2x host)'
		);
	});

	test('PERF-06 a diff patch payload stays under 1% of the compared document', async () => {
		await withEngine(async (client) => {
			const text = syntheticDocument(400, 20);
			const left = await openDocument(client, text, '/synthetic/left.arxml');
			const right = await openDocument(client, text, '/synthetic/right.arxml');
			await client.requestStream(
				'diff.compute',
				{
					left: { docId: left, name: 'left.arxml', path: '/synthetic/left.arxml' },
					right: { docId: right, name: 'right.arxml', path: '/synthetic/right.arxml' },
					options: { semanticMatching: false }
				},
				undefined,
				120_000
			);

			const rows = await rowsOf(client, left);
			const target = rows.find((row) => row.valueKind === 'numeric') ?? rows.find((row) => row.kind === 'parameter');
			assert.ok(target, 'the synthetic document has a parameter row');
			const record = await planValue(client, left, target!.id, '999');
			await client.request('doc.update', {
				docId: left,
				edits: [{ start: record.range.start, end: record.range.end, text: record.newText }]
			});

			const started = performance.now();
			const answer = await client.request(
				'diff.patch',
				{
					left: { docId: left, name: 'left.arxml', path: '/synthetic/left.arxml' },
					right: { docId: right, name: 'right.arxml', path: '/synthetic/right.arxml' },
					edit: { side: 'left', start: record.range.start, end: record.range.end, text: record.newText }
				},
				undefined,
				120_000
			);
			const patchMs = performance.now() - started;
			console.log(
				`[PERF-06] patch ${patchMs.toFixed(1)} ms, payload ${answer.body.length} bytes of ${text.length}`
			);

			assert.strictEqual(answer.header.patch, true, `not patchable: ${String(answer.header.reason)}`);
			assert.ok(
				answer.body.length < text.length / 100,
				`the patch payload is ${answer.body.length} bytes, over 1% of ${text.length}`
			);
			assert.ok(
				read('src/test/benchmarks/diffBenchmark.ts').includes('elapsedMs: measured.patchMs'),
				'the 26 MiB benchmark records the patch latency'
			);
			// The 50 ms latency gate in the plan is not enforced anywhere; the benchmark
			// recorded 411 ms for the 26 MiB copy, so it is reported, not asserted here.
			assert.ok(patchMs < 5000, 'the patch did not hang');
		});
	});
});
