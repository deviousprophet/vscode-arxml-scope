/**
 * Standalone mode: serve built assets, drive each state with official
 * Playwright, capture artifacts and run generic + adapter assertions.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { noConsoleErrors } from '../assertions/generic.mjs';
import { captureDiagnostics } from '../runner/console.mjs';
import { launchBrowser } from '../runner/playwright.mjs';
import { writeReport } from '../runner/report.mjs';
import { startStandalone } from '../webview/serve.mjs';
function settle(page, ms) {
	return page.evaluate(
		(waitMs) =>
			new Promise((resolve) => {
				requestAnimationFrame(() =>
					requestAnimationFrame(() => setTimeout(resolve, waitMs))
				);
			}),
		ms
	);
}
/** The state's page URL, including its adapter-declared query values. */
function stateUrl(baseUrl, state) {
	const url = new URL('/', baseUrl);
	url.searchParams.set('state', state.name);
	for (const [key, value] of new URLSearchParams(state.urlQuery)) {
		url.searchParams.set(key, value);
	}
	return url;
}
/** The callbacks an adapter setup function receives. */
function setupHelpers(page, state, url, outDir) {
	return {
		state,
		url: url.href,
		outDir,
		/** Generic protocol injection: a webview receives `message` events. */
		async post(message) {
			await page.evaluate((payload) => window.postMessage(payload, '*'), message);
		},
		/** Reads traffic posted through the shim's `acquireVsCodeApi`. */
		async posted() {
			return page.evaluate(() => window.__previewPosted?.() ?? []);
		}
	};
}
/** The adapter assertions plus the default console guard. */
function assertionsFor(adapter) {
	const configured = adapter.assertions ?? [];
	const hasConsoleAssertion = configured.some((assertion) => assertion.id === 'no-console-errors');
	return hasConsoleAssertion
		? configured
		: [...configured, noConsoleErrors({ allow: adapter.consoleAllow ?? [] })];
}
/** Runs the assertions one state did not explicitly skip. */
async function runAssertions(adapter, state, context) {
	const assertions = [];
	for (const assertion of assertionsFor(adapter)) {
		if (state.skipAssertions?.includes(assertion.id)) {
			continue;
		}
		const issues = await assertion.run(context);
		assertions.push({ id: assertion.id, ok: issues.length === 0, issues });
	}
	return assertions;
}
/** A fresh context and page at the state's viewport. */
async function openPage(browser, state) {
	const context = await browser.newContext({
		viewport: { width: state.width, height: state.height },
		deviceScaleFactor: 1,
		colorScheme: 'dark'
	});
	const page = await context.newPage();
	return { context, page };
}
/** Starts a trace when the state or adapter asked for one. */
async function startTrace(context, trace) {
	if (trace) {
		await context.tracing.start({ screenshots: true, snapshots: true });
	}
}
/** Stops a trace and returns its artifact path, or undefined when it failed. */
async function stopTrace(context, trace, outDir, state) {
	if (!trace) {
		return undefined;
	}
	const tracePath = path.join(outDir, `${state.name}.trace.zip`);
	await context.tracing.stop({ path: tracePath }).catch(() => undefined);
	return tracePath;
}
/** Whether this state asked for a trace. */
function traceEnabled(adapter, state) {
	return state.trace ?? adapter.trace ?? false;
}
/** The adapter's product audit, when it has one. */
async function readAudit(adapter, page) {
	return adapter.audit ? adapter.audit(page) : undefined;
}
/** The adapter's product violations, when it has a product assertion. */
async function readViolations(adapter, context) {
	return adapter.productAssertions ? adapter.productAssertions(context) : [];
}
/** The assertion wait before setup. */
function settleMs(adapter, state) {
	return state.settleMs ?? adapter.settleMs ?? 100;
}
/** The wait after setup. */
function setupSettleMs(adapter) {
	return adapter.setupSettleMs ?? 100;
}
/** Loads the page, waits for readiness, then applies the state's setup. */
async function prepare(page, adapter, state, url, outDir) {
	await page.goto(url.href, { waitUntil: 'load', timeout: 30_000 });
	if (state.ready) {
		await page.waitForSelector(state.ready, { state: 'attached', timeout: 30_000 });
	}
	await settle(page, settleMs(adapter, state));
	if (state.setup) {
		await state.setup(page, setupHelpers(page, state, url, outDir));
		await settle(page, setupSettleMs(adapter));
	}
}
/** The state screenshot after the assertions have run. */
async function capture(page, outDir, state) {
	const screenshot = path.join(outDir, `${state.name}.png`);
	await page.screenshot({ path: screenshot, animations: 'disabled', caret: 'hide' });
	return screenshot;
}
/** The diagnostics the report keeps. */
function diagnosticsPayload(diagnostics) {
	return {
		consoleErrors: diagnostics.consoleErrors,
		consoleWarnings: diagnostics.consoleWarnings,
		pageErrors: diagnostics.pageErrors,
		requestFailures: diagnostics.requestFailures
	};
}
/** One state: fresh context, readiness wait, product audit, assertions, artifacts. */
async function runState({ browser, adapter, server, state, outDir }) {
	const stateStarted = Date.now();
	const { context, page } = await openPage(browser, state);
	const diagnostics = captureDiagnostics(page, server.url);
	const trace = traceEnabled(adapter, state);
	await startTrace(context, trace);
	const url = stateUrl(server.url, state);
	let assertions = [];
	let productViolations = [];
	let productAudit;
	let screenshot;
	try {
		await prepare(page, adapter, state, url, outDir);
		productAudit = await readAudit(adapter, page);
		assertions = await runAssertions(adapter, state, {
			page,
			diagnostics,
			state,
			productAudit
		});
		productViolations = await readViolations(adapter, { page, audit: productAudit, state });
		screenshot = await capture(page, outDir, state);
	} catch (error) {
		assertions.push({
			id: 'state-render',
			ok: false,
			issues: [error instanceof Error ? error.message : String(error)]
		});
	}
	diagnostics.stop();
	const tracePath = await stopTrace(context, trace, outDir, state);
	const ok =
		assertions.every((assertion) => assertion.ok) && productViolations.length === 0;
	const result = {
		name: state.name,
		width: state.width,
		height: state.height,
		ok,
		durationMs: Date.now() - stateStarted,
		url: url.href,
		screenshot,
		trace: tracePath,
		assertions,
		productAudit,
		productViolations,
		diagnostics: diagnosticsPayload(diagnostics)
	};
	await context.close();
	return result;
}
/** @param {import('../adapters/contract.mjs').PreviewAdapter} adapter */
export async function runStandalone({ adapter, outDir, only, executablePath }) {
	const started = Date.now();
	await mkdir(outDir, { recursive: true });
	const server = await startStandalone(adapter);
	const { browser, executablePath: chrome } = await launchBrowser({ executablePath });
	const states = adapter.states.filter((state) => only === undefined || state.name === only);
	if (states.length === 0) {
		await browser.close();
		server.close();
		throw new Error(`Unknown state: ${only}. Use --list to see ${adapter.states.length} states.`);
	}
	const results = [];
	try {
		for (const state of states) {
			results.push(await runState({ browser, adapter, server, state, outDir }));
		}
	} finally {
		await browser.close();
		server.close();
	}
	const report = {
		mode: 'standalone',
		adapter: adapter.name,
		generatedAt: new Date().toISOString(),
		durationMs: Date.now() - started,
		outDir: path.resolve(outDir),
		browser: { executablePath: chrome, headless: true },
		server: { port: server.port },
		states: results,
		failed: results.filter((state) => !state.ok).length
	};
	report.reportPath = await writeReport(outDir, report);
	return report;
}
/** Writes a manifest when `--list` is requested, without launching a browser. */
export function listStates(adapter) {
	return adapter.states.map((state) => ({
		name: state.name,
		width: state.width,
		height: state.height,
		entry: state.entry ?? adapter.entry
	}));
}
