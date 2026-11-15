/**
 * Engine health: the data the status command prints and the host tests assert on.
 *
 * Pure: no `vscode` import, so the formatter and the supervisor are testable without
 * an extension host.
 */

export type EngineProcessState = 'starting' | 'running' | 'restarting' | 'failed' | 'disposed';

/** One state transition; `error` is present when the transition follows a failure. */
export interface EngineStateChange {
	state: EngineProcessState;
	error?: string;
}

export type EngineStateListener = (change: EngineStateChange) => void;

export interface EngineHealth {
	state: EngineProcessState;
	/** Version reported by the handshake, when a process has run. */
	version?: string;
	protocol: number;
	pid?: number;
	uptimeMs: number;
	/** Processes spawned after the first one. */
	restarts: number;
	openDocuments: number;
	pendingRequests: number;
	/** Resident memory of the engine process when the platform exposes it. */
	memoryBytes?: number;
	lastError?: string;
}

function formatBytes(bytes: number): string {
	const mib = bytes / (1024 * 1024);
	return mib >= 10 ? `${Math.round(mib)} MiB` : `${mib.toFixed(1)} MiB`;
}

function formatUptime(uptimeMs: number): string {
	if (uptimeMs < 1000) {
		return `${Math.round(uptimeMs)} ms`;
	}
	const seconds = Math.floor(uptimeMs / 1000);
	if (seconds < 60) {
		return `${seconds} s`;
	}
	const minutes = Math.floor(seconds / 60);
	return `${minutes} min ${seconds % 60} s`;
}

/** The status command's text: stable field order, one field per line. */
export function formatEngineHealth(health: EngineHealth): string {
	const lines = [
		`state:            ${health.state}`,
		`engine version:   ${health.version ?? 'unknown'}`,
		`protocol:         ${health.protocol}`,
		`pid:              ${health.pid ?? 'none'}`,
		`uptime:           ${formatUptime(health.uptimeMs)}`,
		`restarts:         ${health.restarts}`,
		`open documents:   ${health.openDocuments}`,
		`pending requests: ${health.pendingRequests}`,
		`memory:           ${health.memoryBytes === undefined ? 'unavailable on this platform' : formatBytes(health.memoryBytes)}`,
		`last error:       ${health.lastError ?? 'none'}`
	];
	return lines.join('\n');
}
