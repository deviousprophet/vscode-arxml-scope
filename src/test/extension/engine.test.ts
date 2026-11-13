/**
 * Engine process seam tests.
 *
 * The engine is a standalone process: there is no TypeScript core fallback, so a
 * missing binary or a protocol mismatch is an activation error.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { EXPECTED_PROTOCOL } from '../../host/engine/coreEngine';
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
			const document = await engine.openDocument(fixture, text, { sort: 'all', sortExcept: [] });
			const rows = document.rows();
			assert.ok(rows.length > 0, 'the engine returns rows for an ECUC fixture');
			assert.ok(document.counts().modules > 0, 'the engine counts modules');

			const parameter = rows.find((row) => row.kind === 'parameter');
			assert.ok(parameter, 'the fixture has a parameter row');
			const plan = await document.plan('value', parameter.id, '4242');
			assert.strictEqual(plan.ok, true, plan.reason);
			assert.ok(plan.record?.newText.includes('4242'));
			await document.close();
		} finally {
			engine.dispose();
		}
	});
});
