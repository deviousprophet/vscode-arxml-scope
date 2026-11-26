/**
 * Standalone mode: serve built assets, drive each state with official
 * Playwright, capture artifacts and run generic + adapter assertions.
 */
import { mkdir, writeFile } from 'node:fs/promises';
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
			const stateStarted = Date.now();
			const context = await browser.newContext({
				viewport: { width: state.width, height: state.height },
				deviceScaleFactor: 1,
				colorScheme: 'dark'
			});
			const page = await context.newPage();
			const diagnostics = captureDiagnostics(page, server.url);
			const trace = state.trace ?? adapter.trace ?? false;
			if (trace) {
				await context.tracing.start({ screenshots: true, snapshots: true });
			}
			const url = new URL('/', server.url);
			url.searchParams.set('state', state.name);
			if (state.urlQuery) {
				for (const [key, value] of new URLSearchParams(state.urlQuery)) {
					url.searchParams.set(key, value);
				}
			}
			const setupHelpers = {
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
			const assertions = [];
			let productViolations = [];
			let productAudit;
			let screenshot;
			let tracePath;
			try {
				await page.goto(url.href, { waitUntil: 'load', timeout: 30_000 });
				if (state.ready) {
					await page.waitForSelector(state.ready, { state: 'attached', timeout: 30_000 });
				}
				await settle(page, state.settleMs ?? adapter.settleMs ?? 100);
				if (state.setup) {
					await state.setup(page, setupHelpers);
					await settle(page, adapter.setupSettleMs ?? 100);
				}
				if (adapter.audit) {
					productAudit = await adapter.audit(page);
				}
				const configured = adapter.assertions ?? [];
				const hasConsoleAssertion = configured.some(
					(assertion) => assertion.id === 'no-console-errors'
				);
				const assertionsForState = hasConsoleAssertion
					? configured
					: [...configured, noConsoleErrors({ allow: adapter.consoleAllow ?? [] })];
				for (const assertion of assertionsForState) {
					if (state.skipAssertions?.includes(assertion.id)) {
						continue;
					}
					const issues = await assertion.run({ page, diagnostics, state, productAudit });
					assertions.push({ id: assertion.id, ok: issues.length === 0, issues });
				}
				if (adapter.productAssertions) {
					productViolations = await adapter.productAssertions({ page, audit: productAudit, state });
				}
				screenshot = path.join(outDir, `${state.name}.png`);
				await page.screenshot({ path: screenshot, animations: 'disabled', caret: 'hide' });
			} catch (error) {
				assertions.push({
					id: 'state-render',
					ok: false,
					issues: [error instanceof Error ? error.message : String(error)]
				});
			}
			diagnostics.stop();
			if (trace) {
				tracePath = path.join(outDir, `${state.name}.trace.zip`);
				await context.tracing.stop({ path: tracePath }).catch(() => {
					tracePath = undefined;
				});
			}
			const genericOk = assertions.every((assertion) => assertion.ok);
			const ok = genericOk && productViolations.length === 0;
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
				diagnostics: {
					consoleErrors: diagnostics.consoleErrors,
					consoleWarnings: diagnostics.consoleWarnings,
					pageErrors: diagnostics.pageErrors,
					requestFailures: diagnostics.requestFailures
				}
			};
			results.push(result);
			await context.close();
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

/** @param {string} file */
export async function writeJson(file, value) {
	await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
