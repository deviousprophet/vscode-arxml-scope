/**
 * Engine seam and native-loader tests.
 *
 * There is no TypeScript core fallback: a missing or incompatible addon is an
 * activation error. The built-addon test is mandatory.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { EXPECTED_ENGINE_ABI } from '../../host/engine/coreEngine';
import {
	nativeModulePath,
	resolveEngine,
	validateNativeModule,
} from '../../host/engine/nativeLoader';
import { repoRoot } from './testUtils';

function fakeRoot(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arxml-engine-'));
	const dir = path.join(root, 'dist', 'native', 'win32-x64');
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'arxml_node.node'), '', 'utf8');
	return root;
}

suite('core engine seam', () => {
	test('resolves the native addon path per platform and architecture', () => {
		assert.ok(
			nativeModulePath(repoRoot, 'win32', 'x64').endsWith(
				path.join('dist', 'native', 'win32-x64', 'arxml_node.node')
			)
		);
		assert.ok(
			nativeModulePath(repoRoot, 'linux', 'arm64').endsWith(
				path.join('dist', 'native', 'linux-arm64', 'arxml_node.node')
			)
		);
	});

	test('a missing Rust addon is an error, not a TypeScript fallback', () => {
		const missingRoot = path.join(repoRoot, 'does-not-exist');
		assert.throws(() => resolveEngine(missingRoot), /not built/);
	});

	test('a throwing native loader is an activation error', () => {
		const root = fakeRoot();
		try {
			assert.throws(
				() =>
					resolveEngine(root, 'win32', 'x64', () => {
						throw new Error('boom-loader');
					}),
				/failed to load/
			);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('a wrong-ABI native module is an activation error', () => {
		const root = fakeRoot();
		try {
			assert.throws(
				() =>
					resolveEngine(root, 'win32', 'x64', () => ({
						engineHello: () => 'arxml-core test',
						engineVersion: () => 'test',
						engineAbi: () => EXPECTED_ENGINE_ABI + 1,
					})),
				/ABI/
			);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('rejects malformed and wrong-ABI native exports', () => {
		assert.ok(validateNativeModule({}).diagnostic);
		const wrongAbi = validateNativeModule({
			engineHello: () => 'arxml-core test',
			engineVersion: () => 'test',
			engineAbi: () => EXPECTED_ENGINE_ABI + 1,
		});
		assert.ok(wrongAbi.diagnostic?.includes('ABI'), 'the ABI mismatch is explained');
		const valid = validateNativeModule({
			engineHello: () => 'arxml-core test',
			engineVersion: () => 'test',
			engineAbi: () => EXPECTED_ENGINE_ABI,
		});
		assert.ok(valid.module, 'a valid module passes validation');
		assert.strictEqual(valid.diagnostic, undefined);
	});

	test('loads the built Rust addon', () => {
		assert.ok(
			fs.existsSync(nativeModulePath(repoRoot)),
			'the Rust addon is required by the test/package build; run npm run rust:build'
		);
		const started = performance.now();
		const engine = resolveEngine(repoRoot);
		const loadMs = Math.round((performance.now() - started) * 100) / 100;
		console.log(`[engine] Rust addon loaded in ${loadMs} ms`);
		assert.strictEqual(engine.kind, 'rust');
		assert.ok(loadMs < 1000, `native engine load took ${loadMs} ms`);
		assert.ok(engine.hello().startsWith('arxml-core '));
	});
});
