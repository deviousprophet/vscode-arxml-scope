/**
 * The engine seam between the VS Code host and the Rust core process.
 *
 * There is no TypeScript core fallback and no embedded engine: the Rust engine is a
 * standalone process, and the host is a client. This module owns the contract the
 * rest of the host codes against.
 *
 * Pure: no `vscode` import and no DOM.
 */
import { EXPECTED_PROTOCOL, type EngineClient } from './engineClient';
import { EngineDocument, type DocumentOptions } from './ecucDocument';

export type EngineKind = 'rust';

/** The protocol version the host speaks. Kept in step with `arxml_core::ENGINE_PROTOCOL`. */
export { EXPECTED_PROTOCOL };

export interface CoreEngine {
	readonly kind: EngineKind;
	/** The protocol version the running engine reported during the handshake. */
	readonly protocol: number;
	/** Opens one document handle; the engine keeps the text and the model. */
	openDocument(uri: string, text: string, options: DocumentOptions): Promise<EngineDocument>;
	/** A side-effect-free probe used by diagnostics and tests. */
	engineVersion(): string;
	dispose(): void;
}

/** A protocol mismatch that must refuse activation, with both versions named. */
export function protocolDiagnostic(header: Record<string, unknown>): string | undefined {
	const protocol = header.protocol;
	if (protocol !== EXPECTED_PROTOCOL) {
		return `engine protocol ${String(protocol)} does not match ${EXPECTED_PROTOCOL}`;
	}
	return undefined;
}

export function createEngine(client: EngineClient, version: string): CoreEngine {
	return {
		kind: 'rust',
		protocol: EXPECTED_PROTOCOL,
		openDocument: (uri, text, options) => EngineDocument.open(client, uri, text, options),
		engineVersion: () => version,
		dispose: () => client.dispose()
	};
}
