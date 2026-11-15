/**
 * Capture every preview state with headless Chrome or Edge.
 *
 *   node scripts/shotWebview.mjs [--state name] [--list]
 *
 * Starts the preview server on a free port, runs the local browser once per
 * state, and writes `artifacts/webview/<state>.png`. No browser dependency: the
 * first installed Chrome/Edge (or `CHROME_PATH`) is used.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { startPreview } from './previewWebview.mjs';

const root = process.cwd();
const outDir = path.join(root, 'artifacts', 'webview');

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

/** Runs one headless capture; async so the preview server keeps answering Chrome. */
function capture(browser, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`browser timed out
${stderr}`));
		}, 60_000);
		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString();
		});
		child.on('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on('exit', (code) => {
			clearTimeout(timer);
			if (code === 0) {
				resolve(stdout);
				return;
			}
			reject(new Error(`browser exited ${String(code)}
${stderr}`));
		});
	});
}

/** Reads the page's rendered-geometry audit out of the DOM dump. */
function auditFromDom(html) {
	const match = html.match(/<script[^>]*id="preview-audit"[^>]*>([\s\S]*?)<\/script>/);
	if (!match) {
		return undefined;
	}
	try {
		return JSON.parse(match[1]);
	} catch {
		return undefined;
	}
}

const captured = [];
try {
	for (const state of preview.states) {
		if (only !== undefined && state.name !== only) {
			continue;
		}
		const png = path.join(outDir, `${state.name}.png`);
		const url = `http://127.0.0.1:${preview.port}/?state=${state.name}`;
		const dom = await capture(
			browser,
			[
				'--headless=new',
				'--disable-gpu',
				'--hide-scrollbars',
				'--no-first-run',
				'--no-default-browser-check',
				`--user-data-dir=${profile}`,
				'--force-device-scale-factor=1',
				`--window-size=${state.width},${state.height}`,
				'--virtual-time-budget=5000',
				'--dump-dom',
				`--screenshot=${png}`,
				url
			]
		);
		if (!existsSync(png)) {
			throw new Error(`no screenshot written for ${state.name}`);
		}
		const audit = auditFromDom(dom);
		if (!audit) {
			throw new Error(`no rendered-geometry audit in ${state.name}`);
		}
		const auditPath = path.join(outDir, `${state.name}.audit.json`);
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
	preview.close();
	rmSync(profile, { recursive: true, force: true });
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
