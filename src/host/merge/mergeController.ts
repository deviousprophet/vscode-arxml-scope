/**
 * What the diff panel needs from a merge session.
 *
 * The command owns the plan, the documents and the write; the panel only shows the
 * state and forwards the two user intents. Keeping the contract this small is what
 * lets the read-only diff stay read-only: merge mode exists only when a controller
 * is passed in.
 */
import type { MergeViewState } from '../../diffProtocol';

export interface MergeWriteResult {
	ok: boolean;
	message: string;
}

export interface MergeController {
	/** The current conflicts, resolutions and write target. */
	state(): MergeViewState;
	/** Applies one resolution and returns the new state. */
	resolve(nodeId: string, side: 'ours' | 'theirs'): MergeViewState;
	/** Composes and writes the merged file; refuses while a conflict is unresolved. */
	write(): Promise<MergeWriteResult>;
}
