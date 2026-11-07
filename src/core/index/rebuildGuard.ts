/**
 * Rebuild generation guard for the workspace index.
 *
 * A file read can start before a full rebuild and finish after the rebuild's
 * snapshot is applied. The read's content is older than the snapshot, so it must
 * not overwrite it. The guard gives every read a generation token and lets the
 * rebuild invalidate every token issued before it started.
 */
export class RebuildGuard {
	private generation = 0;

	/** Starts a rebuild and invalidates every read that began before it. */
	beginRebuild(): number {
		this.generation++;
		return this.generation;
	}

	/** Captures the generation a read is about to use. */
	beginRead(): number {
		return this.generation;
	}

	/** True when a rebuild started after the read began. */
	isStale(read: number): boolean {
		return read !== this.generation;
	}
}
