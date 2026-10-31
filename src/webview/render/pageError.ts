/**
 * The guarded boot-error surface.
 *
 * Provenance: a page that dies while booting must not show an empty view with
 * no explanation. The editor reports to the webview console only (it has no
 * banner); the diff writes its notice strip and keeps the last good document.
 */

interface EventTargetLike {
	addEventListener(type: string, listener: (event: any) => void): void;
}

interface DocumentLike {
	getElementById(id: string): { textContent: string; dataset?: DOMStringMap } | null;
}

interface ConsoleLike {
	error(text: string): void;
}

export interface EditorErrorSurface {
	/** Report a message through the same path an uncaught error uses. */
	report(text: string): void;
}

/**
 * Install the editor's console-only reporter before anything that can throw.
 * Returns the reporter so the page (and tests) can send a message directly.
 */
export function installConsoleErrors(
	windowLike: EventTargetLike,
	consoleLike: ConsoleLike,
	label = 'ECUC editor'
): EditorErrorSurface {
	const report = (text: string): void => {
		consoleLike.error(`${label}: ${text}`);
	};
	windowLike.addEventListener('error', (event: any) => {
		report(
			(event && event.message ? String(event.message) : 'unknown error') +
				(event && event.lineno ? ` (line ${event.lineno})` : '')
		);
	});
	windowLike.addEventListener('unhandledrejection', (event: any) => {
		report(String(event && event.reason));
	});
	return { report };
}

export interface NoticeErrorSurfaceOptions {
	/** The notice element that receives the message. */
	noticeId: string;
	/** The human prefix, for example "The diff page failed". */
	label: string;
}

/**
 * Install the diff page's visible error surface. The notice keeps `data-kind`
 * so the stylesheet can mark it as a warning rather than a fatal error.
 */
export function installNoticeErrors(
	documentLike: DocumentLike,
	windowLike: EventTargetLike,
	options: NoticeErrorSurfaceOptions
): EditorErrorSurface {
	const show = (text: string, kind: 'warn' | 'error' = 'warn'): void => {
		const notice = documentLike.getElementById(options.noticeId);
		if (!notice) {
			return;
		}
		notice.textContent = text;
		if (notice.dataset) {
			notice.dataset.kind = kind;
		}
	};
	const hint = '. Open Developer: Open Webview Developer Tools for the stack.';
	windowLike.addEventListener('error', (event: any) => {
		show(
			`${options.label}: ${event && event.message ? String(event.message) : 'unknown error'}` +
				(event && event.lineno ? ` (line ${event.lineno})` : '') +
				hint
		);
	});
	windowLike.addEventListener('unhandledrejection', (event: any) => {
		show(`${options.label}: ${String(event && event.reason)}${hint}`);
	});
	return { report: (text: string) => show(text) };
}
