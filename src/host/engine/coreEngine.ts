/**
 * The engine seam between the VS Code host and the Rust core.
 *
 * There is no TypeScript core fallback: the native addon is the engine. The
 * TypeScript side is the VS Code host/UI layer only.
 *
 * Pure: no `vscode` import and no DOM.
 */

export type EngineKind = 'rust';

/** The ABI the TypeScript loader accepts from the native engine. */
export const EXPECTED_ENGINE_ABI = 1;

export interface CoreEngine {
	readonly kind: EngineKind;
	/** A side-effect-free probe used by activation tests and diagnostics. */
	hello(): string;
	dispose(): void;
}
