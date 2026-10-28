/**
 * Host-side boot watchdog for the ECUC webview.
 *
 * A page whose script never runs cannot report its own failure, so the absence of
 * the `ready` message is the only signal the host has. Kept out of the provider so
 * the timeout path is testable without a live panel.
 */
export interface BootWatchdog {
	/** The page reported that it booted; no warning is due. */
	settle(): void;
	/** The panel went away before the page reported in. */
	dispose(): void;
}

/**
 * Calls `onSilent` once when nothing settles the watchdog within `timeoutMs`.
 * `settle` and `dispose` both cancel the pending warning; a settled or disposed
 * watchdog never fires.
 */
export function watchBoot(onSilent: () => void, timeoutMs: number): BootWatchdog {
	let done = false;
	const timer = setTimeout(() => {
		if (done) {
			return;
		}
		done = true;
		onSilent();
	}, timeoutMs);
	const stop = (): void => {
		if (done) {
			return;
		}
		done = true;
		clearTimeout(timer);
	};
	return { settle: stop, dispose: stop };
}
