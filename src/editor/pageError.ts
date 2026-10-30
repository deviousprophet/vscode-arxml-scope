/**
 * The guarded boot-error surface used by the diff page.
 *
 * The page script is emitted first and installed before anything that can throw:
 * without it a page that dies while booting shows an empty view with no
 * explanation. The installer name is a parameter because the tests drive each
 * page's own copy by name.
 */
export interface PageErrorOptions {
	/** The function the page script calls to install the handlers. */
	installerName: string;
	/** The `window` property the page's own code calls to report an error. */
	reporterName: string;
	/** The notice element that receives the message. */
	noticeId: string;
	/** The human prefix, for example "The diff page failed". */
	label: string;
	/** Append the installer call, for pages that emit the block as their first script. */
	install?: boolean;
}

export function pageErrorScript(options: PageErrorOptions): string {
	const install = options.install === true ? `${options.installerName}();` : '';
	return `
function ${options.installerName}() {
	function show(text) {
		var notice = document.getElementById('${options.noticeId}');
		if (!notice) {
			return;
		}
		notice.textContent = text;
		notice.dataset.kind = 'warn';
	}
	function devToolsHint() {
		return '. Open Developer: Open Webview Developer Tools for the stack.';
	}
	window.${options.reporterName} = show;
	window.addEventListener('error', function (event) {
		show('${options.label}: ' + (event.message || 'unknown error') +
			(event.lineno ? ' (line ' + event.lineno + ')' : '') + devToolsHint());
	});
	window.addEventListener('unhandledrejection', function (event) {
		show('${options.label}: ' + String(event.reason) + devToolsHint());
	});
}
${install}
`;
}

/** The console-only counterpart: page errors never paint a UI surface. */
export interface ConsoleErrorOptions {
	installerName: string;
	reporterName: string;
	/** The prefix each console line starts with. */
	label: string;
	install?: boolean;
}

export function consoleErrorScript(options: ConsoleErrorOptions): string {
	const install = options.install === true ? `${options.installerName}();` : '';
	const prefix = JSON.stringify(`${options.label}: `);
	return `
function ${options.installerName}() {
	function report(text) {
		console.error(${prefix} + text);
	}
	window.${options.reporterName} = report;
	window.addEventListener('error', function (event) {
		report((event.message || 'unknown error') +
			(event.lineno ? ' (line ' + event.lineno + ')' : ''));
	});
	window.addEventListener('unhandledrejection', function (event) {
		report(String(event.reason));
	});
}
${install}
`;
}
