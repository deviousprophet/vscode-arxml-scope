/**
 * The `hello` check, shared by the first start and every supervisor restart.
 *
 * Pure: no `vscode` import. The loader re-exports `validateHandshake` so existing
 * tests keep one entry point.
 */
import { protocolDiagnostic } from './coreEngine';

/** The handshake result, or the diagnostic that must refuse activation. */
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
