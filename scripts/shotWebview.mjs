/**
 * Capture every preview state with headless Chrome or Edge.
 *
 *   node scripts/shotWebview.mjs [--state name] [--list]
 *
 * Starts the preview server on a free port, drives one headless browser over the
 * DevTools protocol, and writes `artifacts/webview/<state>.png` plus the page's
 * rendered-geometry audit. No browser dependency: the first installed
 * Chrome/Edge (or `CHROME_PATH`) is used.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { startPreview } from './previewWebview.mjs';

const root = process.cwd();
const outDir = path.join(root, 'artifacts', 'webview');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function candidates() {
	if (process.env.CHROME_PATH) {
		return [process.env.CHROME_PATH];
	}
	if (process.platform === 'win32') {
		return [
			'C:/Program Files/Google/Chrome/Application/chrome.exe',
			'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
			'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
			'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
		];
	}
	if (process.platform === 'darwin') {
		return [
			'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
			'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
		];
	}
	return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
}

function findBrowser() {
	for (const candidate of candidates()) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	console.error('No Chrome or Edge found. Set CHROME_PATH to a headless-capable browser.');
	console.error(`Searched:\n  ${candidates().join('\n  ')}`);
	process.exit(1);
}

async function freePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address !== null ? address.port : 0;
			server.close(() => resolve(port));
		});
	});
}

async function waitForCdp(port) {
	for (let at = 0; at < 100; at += 1) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/version`);
			return await response.json();
		} catch {
			await sleep(100);
		}
	}
	return undefined;
}

/** Kill the browser and every child it spawned, on every platform. */
function canKill(child) {
	return child !== undefined && child.pid !== undefined && child.exitCode === null;
}

function killOnWindows(pid) {
	try {
		execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
	} catch {
		// The tree may already be gone; the caller still closes the profile.
	}
}

function killChild(child) {
	try {
		child.kill('SIGKILL');
	} catch {
		// Already exited.
	}
}

function killOnPosix(child) {
	try {
		process.kill(-child.pid, 'SIGKILL');
	} catch {
		killChild(child);
	}
}

function killBrowserTree(child) {
	if (!canKill(child)) {
		return;
	}
	if (process.platform === 'win32') {
		killOnWindows(child.pid);
		return;
	}
	killOnPosix(child);
}

async function startBrowser(browser, profile) {
	const port = await freePort();
	const child = spawn(browser, [
		'--headless=new',
		'--disable-gpu',
		'--hide-scrollbars',
		'--no-first-run',
		'--no-default-browser-check',
		`--user-data-dir=${profile}`,
		`--remote-debugging-port=${port}`,
		'--force-device-scale-factor=1',
		'about:blank'
	], {
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: process.platform !== 'win32',
		windowsHide: true
	});
	const version = await waitForCdp(port);
	if (version === undefined) {
		killBrowserTree(child);
		throw new Error('the headless browser did not open its DevTools endpoint');
	}
	return { child, port, version };
}

async function openTarget(port, url) {
	const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
	return response.json();
}

function awaitSocket(socket) {
	return new Promise((resolve, reject) => {
		if (socket.readyState === WebSocket.OPEN) {
			resolve();
			return;
		}
		socket.addEventListener('open', resolve, { once: true });
		socket.addEventListener('error', reject, { once: true });
	});
}

async function connect(url) {
	const socket = new WebSocket(url);
	await awaitSocket(socket);
	const pending = new Map();
	const events = [];
	let nextId = 0;
	socket.addEventListener('message', (event) => {
		const message = JSON.parse(event.data);
		if (message.id === undefined) {
			events.push(message);
			return;
		}
		const waiter = pending.get(message.id);
		if (waiter === undefined) {
			return;
		}
		pending.delete(message.id);
		if (message.error) {
			waiter.reject(new Error(JSON.stringify(message.error)));
		} else {
			waiter.resolve(message.result);
		}
	});
	function send(method, params = {}) {
		const id = (nextId += 1);
		socket.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) => {
			pending.set(id, { resolve, reject });
		});
	}
	return { send, events, close: () => socket.close() };
}

async function evaluate(send, expression) {
	const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
	if (result.exceptionDetails) {
		throw new Error(result.exceptionDetails.text ?? 'page evaluation failed');
	}
	return result.result.value;
}

async function waitForReady(send, events = []) {
	// The wide/merge states compute a 60-row native diff and run the audit; the
	// page can take well over 20s on a loaded CI runner.
	for (let at = 0; at < 1200; at += 1) {
		await sleep(50);
		try {
			if (await evaluate(send, 'document.body.dataset.previewReady === "true"')) {
				return;
			}
		} catch {
			// The page is still navigating; retry.
		}
	}
	const state = await evaluate(
		send,
		'({ href: location.href, ready: document.readyState, stage: document.body?.dataset?.previewStage ?? "", body: document.body?.innerText?.slice(0, 120) ?? "", failure: window.__PREVIEW_FAILURE__ ?? null })'
	).catch(() => ({}));
	const exceptions = events
		.filter((event) => event.method === 'Runtime.exceptionThrown')
		.map((event) => event.params?.exceptionDetails?.exception?.description ?? event.params?.exceptionDetails?.text);
	throw new Error(`the preview page did not become ready: ${JSON.stringify({ state, exceptions })}`);
}

function waitForExit(child) {
	if (child === undefined || child.exitCode !== null) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		child.once('exit', resolve);
		setTimeout(resolve, 2000);
	});
}

async function captureState(cdpPort, previewPort, state) {
	const url = `http://127.0.0.1:${previewPort}/?state=${state.name}`;
	const target = await openTarget(cdpPort, 'about:blank');
	const page = await connect(target.webSocketDebuggerUrl);
	try {
		await page.send('Page.enable');
		await page.send('Runtime.enable');
		await page.send('Emulation.setDeviceMetricsOverride', {
			width: state.width,
			height: state.height,
			deviceScaleFactor: 1,
			mobile: false
		});
		await page.send('Page.addScriptToEvaluateOnNewDocument', {
			source: 'window.addEventListener("unhandledrejection", (event) => { window.__PREVIEW_FAILURE__ = String((event.reason && event.reason.stack) || event.reason); });'
		});
		await page.send('Page.navigate', { url });
		await waitForReady(page.send, page.events);
		await sleep(state.name === 'editor-syntax' ? 2000 : 500);
		const audit = await evaluate(
			page.send,
			'JSON.parse(document.getElementById("preview-audit").textContent)'
		);
		const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
		return { audit, png: Buffer.from(screenshot.data, 'base64') };
	} finally {
		page.close();
		await fetch(`http://127.0.0.1:${cdpPort}/json/close/${target.id}`);
	}
}

const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const stateAt = args.indexOf('--state');
const only = stateAt >= 0 ? args[stateAt + 1] : undefined;

const preview = await startPreview({ port: 0 });
if (listOnly) {
	console.log(JSON.stringify({ _type: 'webview-preview-states', states: preview.states }));
	preview.close();
	process.exit(0);
}

const browser = findBrowser();
const profile = mkdtempSync(path.join(tmpdir(), 'arxml-shot-'));
mkdirSync(outDir, { recursive: true });
let headless;
let cleanedUp = false;

function closePreview() {
	try {
		preview.close();
	} catch {
		// The server may already be closed.
	}
}

function removeProfile() {
	try {
		rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	} catch {
		// The browser may still hold its temp profile; it is safe to leave behind.
	}
}

/** Every exit path kills the browser tree, closes the server and removes the profile. */
function cleanup() {
	if (cleanedUp) {
		return;
	}
	cleanedUp = true;
	killBrowserTree(headless?.child);
	closePreview();
	removeProfile();
}

process.once('SIGINT', () => {
	cleanup();
	process.exit(130);
});
process.once('SIGTERM', () => {
	cleanup();
	process.exit(143);
});
process.once('uncaughtException', (error) => {
	cleanup();
	console.error(error);
	process.exit(1);
});
process.once('unhandledRejection', (error) => {
	cleanup();
	console.error(error);
	process.exit(1);
});

const captured = [];
try {
	headless = await startBrowser(browser, profile);
	for (const state of preview.states) {
		if (only !== undefined && state.name !== only) {
			continue;
		}
		const png = path.join(outDir, `${state.name}.png`);
		const auditPath = path.join(outDir, `${state.name}.audit.json`);
		const { audit, png: image } = await captureState(headless.port, preview.port, state);
		writeFileSync(png, image);
		writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
		captured.push({
			state: state.name,
			width: state.width,
			height: state.height,
			png,
			audit: auditPath,
			violations: audit.violations ?? []
		});
	}
} finally {
	cleanup();
	await waitForExit(headless?.child);
}

if (only !== undefined && captured.length === 0) {
	console.error(`Unknown state: ${only}. Use --list to see the states.`);
	process.exit(1);
}
const failed = captured.filter((capture) => capture.violations.length > 0);
console.log(
	JSON.stringify({
		_type: 'webview-shots',
		browser,
		captured: captured.map((capture) => ({
			...capture,
			ok: capture.violations.length === 0
		})),
		failed: failed.length
	})
);
if (failed.length > 0) {
	for (const capture of failed) {
		console.error(`${capture.state}:\n  ${capture.violations.join('\n  ')}`);
	}
	process.exitCode = 1;
}
