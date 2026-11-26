/** Report writing plus a compact stdout summary. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function writeReport(outDir, report) {
	await mkdir(outDir, { recursive: true });
	const file = path.join(outDir, 'report.json');
	await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
	return file;
}

export function summarize(report) {
	return {
		_type: 'webview-preview-report',
		mode: report.mode,
		adapter: report.adapter,
		browser: report.browser,
		durationMs: report.durationMs,
		outDir: report.outDir,
		states: report.states.map((state) => ({
			state: state.name,
			ok: state.ok,
			durationMs: state.durationMs,
			failedAssertions: state.assertions
				.filter((assertion) => !assertion.ok)
				.map((assertion) => assertion.id),
			genericIssues: state.assertions.flatMap((assertion) => assertion.issues).length,
			productIssues: (state.productViolations ?? []).length,
			consoleErrors: state.diagnostics.consoleErrors.length,
			pageErrors: state.diagnostics.pageErrors.length,
			requestFailures: state.diagnostics.requestFailures.length
		})),
		failed: report.failed
	};
}
