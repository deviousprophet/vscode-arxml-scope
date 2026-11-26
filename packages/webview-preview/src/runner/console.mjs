/**
 * Browser diagnostics captured while a state renders. The runner attaches these
 * listeners before navigation so load-time errors are not lost.
 */
export function captureDiagnostics(page, origin) {
	const consoleErrors = [];
	const consoleWarnings = [];
	const pageErrors = [];
	const requestFailures = [];
	let aborted = false;

	page.on('console', (message) => {
		if (message.type() === 'error') {
			consoleErrors.push(message.text());
		} else if (message.type() === 'warning') {
			consoleWarnings.push(message.text());
		}
	});
	page.on('pageerror', (error) => {
		if (!aborted) {
			pageErrors.push(error instanceof Error ? error.message : String(error));
		}
	});
	page.on('requestfailed', (request) => {
		if (!request.url().startsWith(origin)) {
			return;
		}
		requestFailures.push({
			url: request.url(),
			error: request.failure()?.errorText ?? 'request failed'
		});
	});
	page.on('response', (response) => {
		if (response.status() < 400) {
			return;
		}
		if (!response.url().startsWith(origin)) {
			return;
		}
		requestFailures.push({ url: response.url(), status: response.status() });
	});

	return {
		consoleErrors,
		consoleWarnings,
		pageErrors,
		requestFailures,
		/** Playwright reports navigation aborts as page errors during teardown. */
		stop() {
			aborted = true;
		}
	};
}
