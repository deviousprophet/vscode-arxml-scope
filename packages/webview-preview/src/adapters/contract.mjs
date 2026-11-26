/**
 * Adapter contract for the reusable preview core.
 *
 * The core owns: server, browser, state scheduling, screenshots, traces,
 * console capture, generic assertions, report JSON and exit codes.
 *
 * An adapter owns: build command, built asset root, entry page(s), state list,
 * product selectors/probes and product invariants. It must not be imported by
 * the core at build time; the CLI loads it dynamically.
 *
 * @typedef {object} PreviewState
 * @property {string} name Stable state id used by `--state` and artifact names.
 * @property {number} width Viewport width in CSS pixels.
 * @property {number} height Viewport height in CSS pixels.
 * @property {string} [entry] Page relative to `root`; defaults to `adapter.entry`.
 * @property {string} [urlQuery] Extra query string appended to the page URL.
 * @property {string} [ready] CSS selector that marks the state fully settled.
 * @property {number} [settleMs] Extra wait after `ready` (animation/debounce).
 * @property {boolean} [trace] Capture a Playwright trace for this state.
 * @property {import('@playwright/test').PageFunction?} [setup] Runs after `ready`
 *   and before assertions; receives `(page, helpers)`.
 * @property {string[]} [skipAssertions] Generic assertion ids to skip.
 *
 * @typedef {object} PreviewAdapter
 * @property {string} name
 * @property {string} root Absolute path to the built asset directory.
 * @property {string} [entry] Default entry page relative to `root`.
 * @property {PreviewState[]} states
 * @property {object} [build] `{ command, cwd }`; documentation only, the CLI
 *   never runs it implicitly.
 * @property {(page: import('@playwright/test').Page) => Promise<unknown>} [audit]
 *   Reads a project-owned audit document (for example a JSON script tag).
 * @property {(context: { page: import('@playwright/test').Page, audit: unknown }) => Promise<string[]>} [productAssertions]
 *   Project invariants over the audit. Return human-readable issues.
 * @property {string} [cspNonce] Nonce for the injected `acquireVsCodeApi` shim.
 * @property {boolean} [trace] Capture traces by default.
 */

/**
 * Identity helper: keeps adapters declarative and gives TypeScript users an
 * obvious import target. At runtime it changes nothing.
 * @template {PreviewAdapter} T
 * @param {T} adapter
 * @returns {T}
 */
export function definePreview(adapter) {
	if (!adapter || typeof adapter.name !== 'string' || !Array.isArray(adapter.states)) {
		throw new Error('definePreview requires a name and a states array');
	}
	return adapter;
}
