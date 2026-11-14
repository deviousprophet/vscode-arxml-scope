/**
 * Starts and validates the Rust engine process.
 *
 * A missing, unstartable or wrong-protocol engine is an activation error: there is
 * no TypeScript fallback and no engine-selection setting.
 */
import { engineBinaryPath, EngineClient, EngineError } from './engineClient';
import { createEngine, EXPECTED_PROTOCOL, protocolDiagnostic, type CoreEngine } from './coreEngine';

export type EngineSpawner = (binary: string, root: string) => Promise<EngineClient>;

/** The packaged engine binary for one platform/architecture. */
export function enginePath(
	root: string,
	platform: string = process.platform,
	arch: string = process.arch
): string {
	return engineBinaryPath(root, platform, arch);
}

/** The handshake check, split out so the loader test can drive it without a process. */
export function validateHandshake(
	header: Record<string, unknown>
): { version: string } | { diagnostic: string } {
	const diagnostic = protocolDiagnostic(header);
	if (diagnostic !== undefined) {
		return { diagnostic };
	}
	const version = header.engine;
	if (typeof version !== 'string' || version.length === 0) {
		return { diagnostic: 'engine handshake did not report a version' };
	}
	return { version };
}

async function startProcess(binary: string, root: string): Promise<EngineClient> {
	return EngineClient.start({ binary, root });
}

/** Starts the process and turns every failure into one activation error. */
async function startClient(
	start: EngineSpawner,
	binary: string,
	root: string
): Promise<EngineClient> {
	try {
		return await start(binary, root);
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

/** Completes the handshake and refuses a protocol drift. */
async function requireHandshake(client: EngineClient): Promise<string> {
	const hello = await client.request('hello');
	const validated = validateHandshake(hello.header as Record<string, unknown>);
	if ('diagnostic' in validated) {
		client.dispose();
		throw new Error(`Rust engine rejected: ${validated.diagnostic}`);
	}
	return validated.version;
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
	const binary = enginePath(root, platform, arch);
	const client = await startClient(start, binary, root);
	const version = await requireHandshake(client);
	return createEngine(client, version);
}
