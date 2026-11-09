import { existsSync } from 'node:fs';
import path from 'node:path';

import { EXPECTED_ENGINE_ABI, type CoreEngine } from './coreEngine';
import { createRustEngine, type NativeEngineModule } from './rustEngine';

export type NativeModuleLoader = (modulePath: string) => unknown;

/** The packaged native-addon path for one platform/architecture. */
export function nativeModulePath(
	root: string,
	platform: string = process.platform,
	arch: string = process.arch
): string {
	return path.join(root, 'dist', 'native', `${platform}-${arch}`, 'arxml_node.node');
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
	return candidate !== null && (typeof candidate === 'object' || typeof candidate === 'function');
}

function hasNativeProbe(record: Record<string, unknown>): boolean {
	return (
		typeof record.engineHello === 'function' &&
		typeof record.engineVersion === 'function' &&
		typeof record.engineAbi === 'function'
	);
}

function callProbe<T>(record: Record<string, unknown>, name: string): T {
	return (record[name] as () => T).call(record);
}

function nativeFunctions(candidate: unknown): NativeEngineModule | undefined {
	if (!isRecord(candidate) || !hasNativeProbe(candidate)) {
		return undefined;
	}
	return {
		engineHello: () => callProbe<string>(candidate, 'engineHello'),
		engineVersion: () => callProbe<string>(candidate, 'engineVersion'),
		engineAbi: () => callProbe<number>(candidate, 'engineAbi'),
	};
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function probeDiagnostic(native: NativeEngineModule): string | undefined {
	const abi = native.engineAbi();
	if (abi !== EXPECTED_ENGINE_ABI) {
		return `native engine ABI ${String(abi)} does not match ${EXPECTED_ENGINE_ABI}`;
	}
	if (!isNonEmptyString(native.engineHello()) || !isNonEmptyString(native.engineVersion())) {
		return 'native engine returned an empty probe';
	}
	return undefined;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Validates the native exports and ABI before any host code uses the engine. */
export function validateNativeModule(candidate: unknown): { module?: NativeEngineModule; diagnostic?: string } {
	try {
		const native = nativeFunctions(candidate);
		if (native === undefined) {
			return { diagnostic: 'native engine does not export engineHello, engineVersion and engineAbi' };
		}
		const diagnostic = probeDiagnostic(native);
		if (diagnostic !== undefined) {
			return { diagnostic };
		}
		return { module: native };
	} catch (error) {
		return { diagnostic: `native engine probe failed: ${errorText(error)}` };
	}
}

function defaultValueLoader(modulePath: string): unknown {
	// The extension host bundle is CommonJS; the require is local to the loader
	// so nothing else in the host can reach into the native package directly.
	return require(modulePath) as unknown;
}

function requireModulePath(root: string, platform: string, arch: string): string {
	const modulePath = nativeModulePath(root, platform, arch);
	if (!existsSync(modulePath)) {
		throw new Error(`Rust core engine is not built at ${modulePath}; run npm run rust:build`);
	}
	return modulePath;
}

function loadCandidate(modulePath: string, loadModule: NativeModuleLoader): unknown {
	try {
		return loadModule(modulePath);
	} catch (error) {
		throw new Error(
			`Rust core engine failed to load: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Loads the Rust core. There is no TypeScript core fallback: a missing,
 * unloadable or incompatible addon is an activation error.
 */
export function resolveEngine(
	root: string,
	platform: string = process.platform,
	arch: string = process.arch,
	loadModule: NativeModuleLoader = defaultValueLoader
): CoreEngine {
	const modulePath = requireModulePath(root, platform, arch);
	const candidate = loadCandidate(modulePath, loadModule);
	const validated = validateNativeModule(candidate);
	if (validated.module === undefined) {
		throw new Error(validated.diagnostic ?? 'Rust core engine failed validation');
	}
	return createRustEngine(validated.module);
}
