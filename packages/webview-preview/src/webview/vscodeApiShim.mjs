/**
 * Minimal `acquireVsCodeApi` shim injected into every standalone page before
 * the webview bundle runs. It records `postMessage` traffic so a state setup
 * can assert on the extension protocol without a real extension host.
 *
 * `setState`/`getState` are kept in memory; reloading a page resets them, which
 * is the same behaviour a real webview gets on reload.
 */
export const SHIM_SOURCE = `(() => {
	if (window.__previewApiShimInstalled) { return; }
	window.__previewApiShimInstalled = true;
	const posted = [];
	let hostState;
	const api = {
		postMessage(message) { posted.push(message); },
		getState() { return hostState; },
		setState(value) { hostState = value; }
	};
	// The preview shell deliberately remounts pages (and calls resetVsCodeApi),
	// so the shim returns the same API instead of enforcing VS Code's
	// one-acquisition rule. The real host still enforces it; the extension-host
	// probe records that difference.
	window.acquireVsCodeApi = () => api;
	window.__previewPosted = () => posted.slice();
})();\n`;

export const SHIM_PATH = '/__preview_vscode_api.js';

/**
 * Injects the shim as the first head script. The nonce is required because the
 * production shell ships `script-src 'nonce-<nonce>'`.
 * @param {string} html
 * @param {string} nonce
 */
export function injectShim(html, nonce = 'preview') {
	const tag = `<script nonce="${nonce}" src="${SHIM_PATH}"></script>`;
	const head = /<head[^>]*>/i.exec(html);
	if (head) {
		const at = head.index + head[0].length;
		return `${html.slice(0, at)}${tag}${html.slice(at)}`;
	}
	return `${tag}${html}`;
}
