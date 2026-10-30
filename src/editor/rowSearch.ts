/**
 * Chunked, cancellable search over the ECUC row store.
 *
 * The timing model is the one used by the reference search engine: a 120 ms
 * debounce, 24 ms scanning slices, a generation token that invalidates stale
 * runs, progress throttled to 150 ms and index-only navigation after completion.
 * Rows are small, so the scanner batches rows between clock checks instead of
 * checking the clock for every comparison.
 *
 * `RowSearchEngine` is serialized into the page with `toString()`. Keep its body
 * self-contained: it may reference the constants emitted by `rowSearchScript()`
 * and the `haystack` field, nothing else.
 */
import type { TreeRow } from './treeQuery';

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
		this.debounceMs = typeof options.debounceMs === 'number' ? options.debounceMs : 120;
		this.budgetMs = typeof options.budgetMs === 'number' ? options.budgetMs : 24;
		this.progressMs = typeof options.progressMs === 'number' ? options.progressMs : 150;
		this.batchSize = Math.max(1, typeof options.batchSize === 'number' ? options.batchSize : 512);
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
		rows: readonly TreeRow[],
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
		rows: readonly TreeRow[],
		needle: string,
		handlers: RowSearchHandlers,
		token: number
	): void {
		const total = rows.length;
		const matches: number[] = [];
		let scanned = 0;
		let lastProgress = this.now();

		const step = (): void => {
			if (token !== this.token) {
				return;
			}
			const deadline = this.now() + this.budgetMs;
			do {
				const end = Math.min(total, scanned + this.batchSize);
				for (; scanned < end; scanned++) {
					if (rows[scanned].haystack.includes(needle)) {
						matches.push(scanned);
					}
				}
				if (scanned >= total) {
					break;
				}
			} while (this.now() < deadline);

			const complete = scanned >= total;
			const now = this.now();
			if (complete || now - lastProgress >= this.progressMs) {
				const percent = total === 0 ? 100 : Math.min(100, Math.floor((scanned / total) * 100));
				handlers.onProgressUpdate?.(matches.slice(), percent);
				lastProgress = now;
			}

			if (complete) {
				handlers.onComplete(matches.slice());
				return;
			}
			this.chunkHandle = this.setTimer(step, 0);
		};

		step();
	}
}

/** The page copy: timing constants plus the self-contained class. */
export function rowSearchScript(): string {
	const source = RowSearchEngine.toString();
	// A production minifier can turn the class declaration into an anonymous
	// class expression (`class { ... }`). Stop it from becoming a bare statement.
	const declaration = /^\s*class\s+RowSearchEngine\b/.test(source)
		? source
		: `const RowSearchEngine = ${source};`;
	return `const SEARCH_DEBOUNCE_MS = ${SEARCH_DEBOUNCE_MS};
const SEARCH_CHUNK_BUDGET_MS = ${SEARCH_CHUNK_BUDGET_MS};
const SEARCH_PROGRESS_THROTTLE_MS = ${SEARCH_PROGRESS_THROTTLE_MS};
const SEARCH_ROW_BATCH = ${SEARCH_ROW_BATCH};
${declaration}`;
}
