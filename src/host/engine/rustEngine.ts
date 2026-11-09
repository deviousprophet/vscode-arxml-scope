import type { CoreEngine } from './coreEngine';

/** The functions the native module must export for the foundation probe. */
export interface NativeEngineModule {
	engineHello(): string;
	engineVersion(): string;
	engineAbi(): number;
}

/**
 * Wraps a validated native module. Later engine operations are added here and
 * delegate to coarse native calls; no Rust records leak into the host.
 */
export function createRustEngine(native: NativeEngineModule): CoreEngine {
	return {
		kind: 'rust',
		hello: () => native.engineHello(),
		// The foundation owns no native resources yet; keep the lifecycle hook so
		// later engine handles are released through the same contract.
		dispose: () => undefined,
	};
}
