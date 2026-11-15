/**
 * Serve the production webview pages with seeded states.
 *
 *   node scripts/previewWebview.mjs [--port 4173]
 *
 * Bundles `src/test/preview/previewData.ts` for Node (fixtures + shell) and
 * `previewPage.ts` for the browser (the real page), then serves the shell with
 * the payload inlined. No CSP: this is a local development surface only.
 */
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const require = createRequire(import.meta.url);
const previewDir = path.join(root, 'dist', 'preview');

function buildData() {
	const dir = mkdtempSync(path.join(tmpdir(), 'arxml-preview-'));
	const outfile = path.join(dir, 'previewData.cjs');
	buildSync({
		entryPoints: [path.join(root, 'src', 'test', 'preview', 'previewData.ts')],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		outfile,
		logLevel: 'silent'
	});
	return { dir, module: require(outfile) };
}

function buildPage() {
	buildSync({
		entryPoints: [path.join(root, 'src', 'test', 'preview', 'previewPage.ts')],
		bundle: true,
		platform: 'browser',
		format: 'iife',
		outfile: path.join(previewDir, 'preview.js'),
		logLevel: 'silent'
	});
}

function contentType(file) {
	return file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
}

function sendFile(response, file) {
	if (!existsSync(file)) {
		response.writeHead(404);
		response.end('not found');
		return;
	}
	response.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
	response.end(readFileSync(file));
}

function isAsset(url) {
	return url.pathname === '/preview.js' || url.pathname === '/preview.css';
}

function sendAsset(response, url) {
	sendFile(response, path.join(previewDir, url.pathname.slice(1)));
}

function sendState(response, data, states, name) {
	const state = states.find((candidate) => candidate.name === name);
	if (!state) {
		// Never echo the query value: this is a localhost surface, but a reflected
		// state name is still an XSS sink under a strict scanner.
		response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
		response.end('unknown state');
		return;
	}
	response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
	response.end(data.module.previewHtml(state));
}

/** Starts the preview. Port 0 picks a free one; returns the bound port and states. */
export async function startPreview({ port = 4173, build = true } = {}) {
	if (build) {
		buildPage();
	}
	const data = buildData();
	const states = data.module.STATES;
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://preview.local');
		if (isAsset(url)) {
			sendAsset(response, url);
			return;
		}
		sendState(response, data, states, url.searchParams.get('state') ?? states[0].name);
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, '127.0.0.1', resolve);
	});
	const bound = server.address().port;
	return {
		port: bound,
		states,
		close() {
			server.close();
			rmSync(data.dir, { recursive: true, force: true });
		}
	};
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
	const portArg = process.argv.indexOf('--port');
	const requested = portArg >= 0 ? Number(process.argv[portArg + 1]) : 4173;
	const preview = await startPreview({ port: Number.isFinite(requested) ? requested : 4173 });
	console.log(
		JSON.stringify({
			_type: 'webview-preview',
			url: `http://127.0.0.1:${preview.port}/?state=${preview.states[0].name}`,
			states: preview.states.map((state) => state.name)
		})
	);
}
