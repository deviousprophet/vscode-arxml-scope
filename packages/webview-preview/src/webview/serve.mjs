/**
 * Generic static server for a built webview. The core never imports extension
 * source: `adapter.root` is an output directory produced by the adapter's build
 * command, and every request below it is served verbatim.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { SHIM_PATH, SHIM_SOURCE, injectShim } from './vscodeApiShim.mjs';
const MIME = new Map([
	['.html', 'text/html; charset=utf-8'],
	['.js', 'text/javascript; charset=utf-8'],
	['.mjs', 'text/javascript; charset=utf-8'],
	['.css', 'text/css; charset=utf-8'],
	['.json', 'application/json; charset=utf-8'],
	['.map', 'application/json; charset=utf-8'],
	['.ttf', 'font/ttf'],
	['.woff', 'font/woff'],
	['.woff2', 'font/woff2'],
	['.svg', 'image/svg+xml'],
	['.png', 'image/png'],
	['.webp', 'image/webp']
]);
function contentType(file) {
	return MIME.get(path.extname(file).toLowerCase()) ?? 'application/octet-stream';
}
/**
 * @param {string} root
 * @param {string} pathname
 */
function safeFile(root, pathname) {
	const file = path.resolve(root, `.${pathname}`);
	const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
	if (!file.startsWith(prefix)) {
		return undefined;
	}
	return file;
}
/** A plain-text response for an error or a small fixed payload. */
function sendText(response, status, text, type = 'text/plain; charset=utf-8') {
	response.writeHead(status, { 'content-type': type });
	response.end(text);
}
/** The `acquireVsCodeApi` shim the page loads before its bundle. */
function serveShim(response) {
	sendText(response, 200, SHIM_SOURCE, 'text/javascript; charset=utf-8');
}
/** The seeded state, or undefined when the query names an unknown one. */
function stateByName(adapter, name) {
	return adapter.states.find((candidate) => candidate.name === (name ?? adapter.states[0].name));
}
/** The entry document a state asked for. */
function entryFor(adapter, state) {
	return state.entry ?? adapter.entry;
}
/** The CSP nonce the shim is injected with. */
function nonceFor(adapter) {
	return adapter.cspNonce ?? 'preview';
}
/** The seeded entry document for one state, with the shim injected. */
async function serveEntry(response, { adapter, root, url }) {
	const state = stateByName(adapter, url.searchParams.get('state'));
	if (!state) {
		sendText(response, 404, 'unknown state');
		return;
	}
	const entry = entryFor(adapter, state);
	if (!entry) {
		sendText(response, 500, 'adapter has no entry page');
		return;
	}
	const file = safeFile(root, `/${entry}`);
	if (!file) {
		sendText(response, 400, 'bad entry');
		return;
	}
	const html = await readFile(file, 'utf8');
	response.writeHead(200, {
		'content-type': 'text/html; charset=utf-8',
		'cache-control': 'no-store'
	});
	response.end(injectShim(html, nonceFor(adapter)));
}
/** True when the path is a readable file below the adapter root. */
async function isReadableFile(file) {
	if (!file) {
		return false;
	}
	try {
		return (await stat(file)).isFile();
	} catch {
		return false;
	}
}
/** One built asset below the adapter root. */
async function serveAsset(response, { root, pathname }) {
	const file = safeFile(root, pathname);
	if (!(await isReadableFile(file))) {
		sendText(response, 404, 'not found');
		return;
	}
	response.writeHead(200, {
		'content-type': contentType(file),
		'cache-control': 'no-store'
	});
	response.end(await readFile(file));
}
/** True for the two paths the seeded entry page answers. */
function isEntryPath(pathname) {
	return pathname === '/' || pathname === '/index.html';
}
/** The request URL, with a safe placeholder origin for relative request URLs. */
function requestUrl(request) {
	return new URL(request.url ?? '/', 'http://preview.local');
}
/** Routes one request; the shim, favicon, entry page or a built asset. */
async function route(request, response, { adapter, root }) {
	const url = requestUrl(request);
	if (url.pathname === SHIM_PATH) {
		serveShim(response);
		return;
	}
	if (url.pathname === '/favicon.ico') {
		// Chrome asks for a favicon on every page; a browser-chrome 404 is not
		// a webview diagnostic.
		response.writeHead(204);
		response.end();
		return;
	}
	if (isEntryPath(url.pathname)) {
		await serveEntry(response, { adapter, root, url });
		return;
	}
	await serveAsset(response, { root, pathname: url.pathname });
}
/** Every request, with server failures turned into a generic plain-text 500. */
async function handleRequest(request, response, context) {
	try {
		await route(request, response, context);
	} catch (error) {
		// Keep the detail local: an HTTP client must not receive internal paths
		// or stack-trace text (CodeQL: information exposure through a stack trace).
		console.error('preview server error:', error);
		sendText(response, 500, 'internal preview server error');
	}
}
/**
 * @param {import('../adapters/contract.mjs').PreviewAdapter} adapter
 */
export async function startStandalone(adapter) {
	const root = path.resolve(adapter.root);
	const server = createServer((request, response) =>
		handleRequest(request, response, { adapter, root })
	);
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (address === null || typeof address === 'string') {
		server.close();
		throw new Error('preview server did not bind a TCP port');
	}
	return {
		root,
		port: address.port,
		url: `http://127.0.0.1:${address.port}`,
		close() {
			server.close();
		}
	};
}
