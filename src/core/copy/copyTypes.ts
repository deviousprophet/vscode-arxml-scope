/**
 * Shared copy-planner types.
 *
 * The host and the engine seam import these; the TypeScript planner in
 * `planCopy.ts` is the parity oracle and re-exports them for its tests.
 */

export interface CopyRange {
	start: number;
	end: number;
}

export interface CopySpan {
	start: number;
	end: number;
	text: string;
}

export type CopyPlan = { ok: true; span: CopySpan } | { ok: false; reason: string };

/** One missing container between the copied element and the target parent. */
export interface MissingAncestor {
	shortName: string;
	definitionRef: string;
	definitionDest: string;
	/** The kind of the element nested inside this ancestor. */
	childKind: 'container' | 'parameter' | 'reference';
}
