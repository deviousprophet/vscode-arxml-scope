/**
 * Attaches official Playwright to a running VS Code window over the Chromium
 * DevTools endpoint and probes the real webview frame.
 *
 * Run by `suite.cjs` inside the official `@vscode/test-electron` run.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const port = process.env.PREVIEW_CDP_PORT ?? '9222';
const outDir = process.env.PREVIEW_OUT ?? path.resolve('.out', 'extension-host');
const endpoint = `http://127.0.0.1:${port}`;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const result = {
	mode: 'extension-host',
	endpoint,
	startedAt: new Date().toISOString(),
	connectAttempts: 0,
	contexts: 0,
	pages: [],
	frames: [],
	webview: null,
	screenshots: [],
	trace: null,
	errors: []
};

function recordError(stage, error) {
	result.errors.push({ stage, message: error instanceof Error ? error.message : String(error) });
}

let browser;
for (let attempt = 0; attempt < 60 && !browser; attempt += 1) {
	result.connectAttempts = attempt + 1;
	try {
		browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
	} catch (error) {
		if (attempt === 0) {
			recordError('connect', error);
		}
		await delay(500);
	}
}
if (!browser) {
	result.fatal = 'Playwright could not connect over CDP';
	mkdirSync(outDir, { recursive: true });
	writeFileSync(path.join(outDir, 'playwright-cdp.json'), `${JSON.stringify(result, null, 2)}\n`);
	process.exit(1);
}

/** All pages across the connected contexts, refreshed as VS Code opens targets. */
function allPages() {
	return browser.contexts().flatMap((context) => context.pages());
}

let page;
let frame;
for (let attempt = 0; attempt < 80; attempt += 1) {
	result.contexts = browser.contexts().length;
	result.pages = allPages().map((candidate) => ({ url: candidate.url() }));
	for (const candidate of allPages()) {
		const webviewFrames = candidate.frames().filter((candidateFrame) =>
			candidateFrame.url().startsWith('vscode-webview://')
		);
		if (webviewFrames.length === 0) {
			continue;
		}
		// VS Code nests the extension document in an `active-frame` inside the
		// webview wrapper. The wrapper has the origin/handshake script but no page DOM.
		frame =
			webviewFrames.find((candidateFrame) => candidateFrame.name() === 'active-frame') ??
			webviewFrames[webviewFrames.length - 1];
		page = candidate;
		break;
	}
	if (frame) {
		break;
	}
	await delay(500);
}
if (!frame) {
	result.fatal = 'no vscode-webview:// frame appeared';
	mkdirSync(outDir, { recursive: true });
	writeFileSync(path.join(outDir, 'playwright-cdp.json'), `${JSON.stringify(result, null, 2)}\n`);
	process.exit(1);
}

result.frames = page.frames().map((candidate) => ({
	url: candidate.url(),
	name: candidate.name(),
	parent: candidate.parentFrame()?.url() ?? null
}));
result.webview = { url: frame.url(), pageUrl: page.url() };

try {
	mkdirSync(outDir, { recursive: true });
	const domStarted = Date.now();
	await frame.waitForSelector('.monaco-diff-editor, .monaco-editor', {
		state: 'attached',
		timeout: 30_000
	});
	result.webview.domWaitMs = Date.now() - domStarted;
	result.webview.acquireVsCodeApi = await frame.evaluate(() => typeof acquireVsCodeApi);
	result.webview.state = await frame.evaluate(() => {
		try {
			return acquireVsCodeApi().getState() ?? null;
		} catch (error) {
			return { error: String(error) };
		}
	});
	result.webview.text = (await frame.locator('body').innerText()).slice(0, 600);
	result.webview.monacoEditors = await frame.locator('.monaco-editor').count();
	result.webview.diffEditors = await frame.locator('.monaco-diff-editor').count();
	result.webview.buttons = await frame.locator('button').count();
	result.webview.buttonLabels = await frame.evaluate(() =>
		[...document.querySelectorAll('button')]
			.slice(0, 16)
			.map((button) => ({
				id: button.id,
				label: button.getAttribute('aria-label'),
				title: button.title
			}))
	);
	result.webview.renderedRows = await frame.evaluate(
		() => document.querySelectorAll('.view-line, .line-delete, .line-insert').length
	);

	const workbenchShot = path.join(outDir, 'workbench.png');
	await page.screenshot({ path: workbenchShot, animations: 'disabled' });
	result.screenshots.push(workbenchShot);
	const webviewShot = path.join(outDir, 'webview.png');
	await frame.locator('body').screenshot({ path: webviewShot, animations: 'disabled' });
	result.screenshots.push(webviewShot);

	// Drive a real control through an accessible selector. Swap is a local page
	// action, so it proves DOM interaction without inventing a host protocol.
	const swap = frame.locator('#diff-swap');
	result.webview.interaction = { selector: '#diff-swap', present: (await swap.count()) > 0 };
	if (result.webview.interaction.present) {
		const before = await frame.evaluate(() =>
			document.querySelector('#diff-swap')?.getAttribute('aria-pressed')
		);
		await swap.click();
		await frame.waitForFunction(
			() => document.querySelector('#diff-swap')?.getAttribute('aria-pressed') === 'true',
			null,
			{ timeout: 5000 }
		);
		result.webview.interaction.ariaPressed = {
			before,
			after: await frame.evaluate(() =>
				document.querySelector('#diff-swap')?.getAttribute('aria-pressed')
			)
		};
		const swappedShot = path.join(outDir, 'webview-swapped.png');
		await frame.locator('body').screenshot({ path: swappedShot, animations: 'disabled' });
		result.screenshots.push(swappedShot);
	}
} catch (error) {
	recordError('webview-probe', error);
}

try {
	const context = page.context();
	const tracePath = path.join(outDir, 'extension-host.trace.zip');
	await context.tracing.start({ screenshots: true, snapshots: true });
	await delay(500);
	await context.tracing.stop({ path: tracePath });
	result.trace = { path: tracePath, supported: true };
} catch (error) {
	result.trace = {
		supported: false,
		message: error instanceof Error ? error.message : String(error)
	};
}

result.finishedAt = new Date().toISOString();
writeFileSync(path.join(outDir, 'playwright-cdp.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ _type: 'playwright-cdp', webview: result.webview, screenshots: result.screenshots, trace: result.trace, errors: result.errors }));
// Do not call browser.close(): for CDP it would close the VS Code window the
// official runner still owns. Process exit releases the connection.
process.exit(0);
