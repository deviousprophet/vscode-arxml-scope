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

/**
 * @param {import('../adapters/contract.mjs').PreviewAdapter} adapter
 */
export async function startStandalone(adapter) {
	const root = path.resolve(adapter.root);
	const server = createServer(async (request, response) => {
		try {
			const url = new URL(request.url ?? '/', 'http://preview.local');
			if (url.pathname === SHIM_PATH) {
				response.writeHead(200, {
					'content-type': 'text/javascript; charset=utf-8',
					'cache-control': 'no-store'
				});
				response.end(SHIM_SOURCE);
				return;
			}
			if (url.pathname === '/favicon.ico') {
				// Chrome asks for a favicon on every page; a browser-chrome 404 is not
				// a webview diagnostic.
				response.writeHead(204);
				response.end();
				return;
			}
			if (url.pathname === '/' || url.pathname === '/index.html') {
				const stateName = url.searchParams.get('state') ?? adapter.states[0].name;
				const state = adapter.states.find((candidate) => candidate.name === stateName);
				if (!state) {
					response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
					response.end('unknown state');
					return;
				}
				const entry = state.entry ?? adapter.entry;
				if (!entry) {
					response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
					response.end('adapter has no entry page');
					return;
				}
				const file = safeFile(root, `/${entry}`);
				if (!file) {
					response.writeHead(400);
					response.end('bad entry');
					return;
				}
				const html = await readFile(file, 'utf8');
				response.writeHead(200, {
					'content-type': 'text/html; charset=utf-8',
					'cache-control': 'no-store'
				});
				response.end(injectShim(html, adapter.cspNonce ?? 'preview'));
				return;
			}
			const file = safeFile(root, url.pathname);
			let isFile = false;
			if (file) {
				try {
					isFile = (await stat(file)).isFile();
				} catch {
					isFile = false;
				}
			}
			if (!file || !isFile) {
				response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
				response.end('not found');
				return;
			}
			response.writeHead(200, {
				'content-type': contentType(file),
				'cache-control': 'no-store'
			});
			response.end(await readFile(file));
		} catch (error) {
			response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
			response.end(error instanceof Error ? error.message : String(error));
		}
	});
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
