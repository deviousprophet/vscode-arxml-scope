/**
 * The one owner of the webview API singleton.
 *
 * Both bundled pages call this instead of `acquireVsCodeApi()` directly, so a
 * page module can be imported by a test without a webview until it actually
 * mounts. `acquireVsCodeApi` is supplied by VS Code before the bundle runs.
 */
export interface WebviewApi<State = unknown> {
	postMessage(message: unknown): void;
	getState(): State | undefined;
	setState(state: State): void;
}

declare function acquireVsCodeApi<State = unknown>(): WebviewApi<State>;

let cached: WebviewApi<unknown> | undefined;

/** The API singleton, acquired on first use. */
export function vscodeApi(): WebviewApi<unknown> {
	if (!cached) {
		cached = acquireVsCodeApi<unknown>();
	}
	return cached;
}

/** A remount (a page reload in tests) acquires the API again. */
export function resetVsCodeApi(): void {
	cached = undefined;
}

/** Post one protocol message to the host. */
export function postToHost(message: unknown): void {
	vscodeApi().postMessage(message);
}

/** The persisted page state, or `undefined` on a first load. */
export function readPageState<T>(): T | undefined {
	return vscodeApi().getState() as T | undefined;
}

/** Persist the page state through the host. */
export function writePageState<T>(state: T): void {
	vscodeApi().setState(state);
}
