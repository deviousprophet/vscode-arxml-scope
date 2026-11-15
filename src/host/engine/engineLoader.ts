/**
 * Starts and validates the Rust engine process.
 *
 * A missing, unstartable or wrong-protocol engine is an activation error: there is
 * no TypeScript fallback and no engine-selection setting. Once started, the
 * supervisor owns restarts, so the rest of the host keeps one `CoreEngine`.
 */
import {
	engineBinaryPath,
	EngineClient,
	EngineError,
	type EngineSpawner
} from './engineClient';
import { createEngineSupervisor } from './engineSupervisor';
import { EXPECTED_PROTOCOL, type CoreEngine } from './coreEngine';
import { validateHandshake } from './engineHandshake';

export type { EngineSpawner };
export { validateHandshake };

/** Platforms this build ships an engine binary for. */
const SUPPORTED_TARGETS = ['linux-x64', 'win32-x64', 'darwin-x64', 'darwin-arm64'] as const;

/** The packaged engine binary for one platform/architecture. */
export function enginePath(
	root: string,
	platform: string = process.platform,
	arch: string = process.arch
): string {
	return engineBinaryPath(root, platform, arch);
}

/** True when this build has an engine for the target. */
function isSupportedTarget(platform: string, arch: string): boolean {
	return (SUPPORTED_TARGETS as readonly string[]).includes(`${platform}-${arch}`);
}

async function startProcess(
	binary: string,
	root: string,
	onExit?: (error: EngineError) => void
): Promise<EngineClient> {
	return EngineClient.start({ binary, root, onExit });
}

/** Starts the process and turns every failure into one activation error. */
async function startClient(
	start: EngineSpawner,
	binary: string,
	root: string,
	onExit?: (error: EngineError) => void
): Promise<EngineClient> {
	try {
		return await start(binary, root, onExit);
	} catch (error) {
		throw startFailure(error, binary);
	}
}

function startFailure(error: unknown, binary: string): Error {
	if (error instanceof EngineError && /not built/.test(error.message)) {
		return new Error(
			`Rust engine is not built at ${binary}; run "npm run engine:build" (${EXPECTED_PROTOCOL} is the host protocol)`
		);
	}
	return new Error(
		`Rust engine failed to start: ${error instanceof Error ? error.message : String(error)}`
	);
}

/**
 * Resolves the required engine. Spawns the process and completes the handshake, so
 * a bad binary or a protocol drift fails activation before any service starts.
 */
export async function resolveEngine(
	root: string,
	platform: string = process.platform,
	arch: string = process.arch,
	start: EngineSpawner = startProcess
): Promise<CoreEngine> {
	if (!isSupportedTarget(platform, arch)) {
		throw new Error(
			`ARXML Scope has no Rust engine for ${platform}-${arch}. ` +
				`Supported: ${SUPPORTED_TARGETS.join(', ')}. ` +
				'Build from source with "npm run engine:build" on a supported platform.'
		);
	}
	const binary = enginePath(root, platform, arch);
	const spawn: EngineSpawner = (target, workspace, onExit) =>
		startClient(start, target, workspace, onExit);
	return createEngineSupervisor({ binary, root, start: spawn });
}
