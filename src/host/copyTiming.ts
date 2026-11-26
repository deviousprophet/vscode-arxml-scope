/**
 * Copy-phase timing.
 *
 * A copy crosses the engine, the text document, the diff patch and the page.
 * Recording each phase keeps "it feels slow" out of the next change: the split
 * says which half to fix. Quiet by default; set `ARXML_COPY_TIMING=1` to log.
 */

/** One copy, split by phase. */
export interface CopyTiming {
	/** Absorption: every lap, in the order it was taken. */
	phases: Record<string, number>;
	rows: number;
	totalMs: number;
}

/** Round to a tenth of a millisecond; sub-0.1 noise is not actionable. */
function tenths(ms: number): number {
	return Math.round(ms * 10) / 10;
}

/** A lap timer around one copy. */
export class CopyClock {
	private readonly started = performance.now();
	private at = this.started;
	private readonly laps: Record<string, number> = {};

	/** Records the time since the previous lap under `phase`. */
	lap(phase: string): void {
		const now = performance.now();
		this.laps[phase] = tenths(now - this.at);
		this.at = now;
	}

	/** Ends the copy; a lap that never ran is absent rather than zero. */
	finish(rows: number): CopyTiming {
		return { phases: { ...this.laps }, rows, totalMs: tenths(performance.now() - this.started) };
	}
}

/** Whether copy timing should be logged for this session. */
export function copyTimingEnabled(): boolean {
	return process.env.ARXML_COPY_TIMING === '1';
}

/** Logs one copy's split when the environment asks for it. */
export function logCopyTiming(timing: CopyTiming): void {
	if (!copyTimingEnabled()) {
		return;
	}
	console.log(`[arxml] copy ${timing.rows} row(s) in ${timing.totalMs} ms`, timing.phases);
}
