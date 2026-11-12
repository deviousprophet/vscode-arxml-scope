/**
 * Chunked, cancellable search over the ECUC row store.
 *
 * The timing model is the one used by the reference search engine: a 120 ms
 * debounce, 24 ms scanning slices, a generation token that invalidates stale
 * runs, progress throttled to 150 ms and index-only navigation after completion.
 * Rows are small, so the scanner batches rows between clock checks instead of
 * checking the clock for every comparison.
 *
 * Runs over any store whose rows carry a lower-cased `haystack`, so the editor
 * and the semantic diff share one chunked engine.
 */

export interface RowSearchHandlers {
	onProgressUpdate?(matches: number[], percentComplete: number): void;
	onComplete(matches: number[]): void;
}

export interface RowSearchOptions {
	debounceMs?: number;
	budgetMs?: number;
	progressMs?: number;
	batchSize?: number;
	now?: () => number;
	setTimer?: (callback: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
}

export const SEARCH_DEBOUNCE_MS = 120;
export const SEARCH_CHUNK_BUDGET_MS = 24;
export const SEARCH_PROGRESS_THROTTLE_MS = 150;
export const SEARCH_ROW_BATCH = 512;

/** A numeric option, or the engine's default when the caller omitted it. */
function numberOption(value: number | undefined, fallback: number): number {
	return typeof value === 'number' ? value : fallback;
}

/** The per-run state the chunked scanner closes over. */
interface ChunkRun {
	readonly rows: readonly { haystack: string }[];
	readonly needle: string;
	readonly handlers: RowSearchHandlers;
	readonly token: number;
	readonly total: number;
	readonly matches: number[];
	scanned: number;
	lastProgress: number;
}

/** The completion percentage, with an empty store reported as complete. */
function progressPercent(scanned: number, total: number): number {
	return total === 0 ? 100 : Math.min(100, Math.floor((scanned / total) * 100));
}

export class RowSearchEngine {
	private token = 0;
	private debounceHandle: unknown = null;
	private chunkHandle: unknown = null;
	private debounceMs: number;
	private budgetMs: number;
	private progressMs: number;
	private batchSize: number;
	private now: () => number;
	private setTimer: (callback: () => void, ms: number) => unknown;
	private clearTimer: (handle: unknown) => void;

	constructor(options: RowSearchOptions = {}) {
		this.debounceMs = numberOption(options.debounceMs, SEARCH_DEBOUNCE_MS);
		this.budgetMs = numberOption(options.budgetMs, SEARCH_CHUNK_BUDGET_MS);
		this.progressMs = numberOption(options.progressMs, SEARCH_PROGRESS_THROTTLE_MS);
		this.batchSize = Math.max(1, numberOption(options.batchSize, SEARCH_ROW_BATCH));
		this.now = options.now ?? (() => performance.now());
		this.setTimer =
			options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
		this.clearTimer =
			options.clearTimer ??
			((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
	}

	/**
	 * Start a new search. The previous run is cancelled immediately; a blank
	 * query completes with no matches. `immediate` skips only the debounce, not
	 * the time slicing.
	 */
	search(
		rows: readonly { haystack: string }[],
		query: string,
		handlers: RowSearchHandlers,
		immediate = false
	): void {
		this.cancelPending();

		const needle = (query ?? '').trim().toLowerCase();
		if (needle === '') {
			handlers.onComplete([]);
			return;
		}

		const token = ++this.token;
		const start = () => {
			this.debounceHandle = null;
			if (token !== this.token) {
				return;
			}
			this.runChunked(rows, needle, handlers, token);
		};
		if (immediate) {
			start();
		} else {
			this.debounceHandle = this.setTimer(start, this.debounceMs);
		}
	}

	/** Cancel the pending debounce/chunk and invalidate any in-flight result. */
	clear(): void {
		this.cancelPending();
	}

	private cancelPending(): void {
		this.token++;
		if (this.debounceHandle !== null) {
			this.clearTimer(this.debounceHandle);
			this.debounceHandle = null;
		}
		if (this.chunkHandle !== null) {
			this.clearTimer(this.chunkHandle);
			this.chunkHandle = null;
		}
	}

	private runChunked(
		rows: readonly { haystack: string }[],
		needle: string,
		handlers: RowSearchHandlers,
		token: number
	): void {
		const run: ChunkRun = {
			rows,
			needle,
			handlers,
			token,
			total: rows.length,
			matches: [],
			scanned: 0,
			lastProgress: this.now(),
		};

		const step = (): void => {
			if (token !== this.token) {
				return;
			}
			this.scanSlice(run);
			const complete = run.scanned >= run.total;
			this.reportChunk(run, complete);
			if (complete) {
				handlers.onComplete(run.matches.slice());
				return;
			}
			this.chunkHandle = this.setTimer(step, 0);
		};

		step();
	}

	/** Scan batches until the chunk budget is spent or the store is exhausted. */
	private scanSlice(run: ChunkRun): void {
		const deadline = this.now() + this.budgetMs;
		do {
			this.scanBatch(run);
			if (run.scanned >= run.total) {
				return;
			}
		} while (this.now() < deadline);
	}

	/** Scan one bounded batch, batching rows between clock checks. */
	private scanBatch(run: ChunkRun): void {
		const end = Math.min(run.total, run.scanned + this.batchSize);
		for (; run.scanned < end; run.scanned++) {
			if (run.rows[run.scanned].haystack.includes(run.needle)) {
				run.matches.push(run.scanned);
			}
		}
	}

	/** Publish a progress snapshot when the throttle allows it or the run finished. */
	private reportChunk(run: ChunkRun, complete: boolean): void {
		const now = this.now();
		if (!this.progressDue(complete, now, run.lastProgress)) {
			return;
		}
		run.handlers.onProgressUpdate?.(run.matches.slice(), progressPercent(run.scanned, run.total));
		run.lastProgress = now;
	}

	private progressDue(complete: boolean, now: number, lastProgress: number): boolean {
		return complete || now - lastProgress >= this.progressMs;
	}
}
