/**
 * Generic assertions. They only know about DOM geometry, visibility and browser
 * diagnostics; every product selector arrives from the adapter.
 *
 * Each factory returns `{ id, run(ctx) }` where `ctx` is
 * `{ page, diagnostics, state }` and `run` resolves to human-readable issues.
 */

/** Runs a DOM probe in the page with no closure over this module. */
async function probe(page, fn, arg) {
	return page.evaluate(fn, arg);
}

export function noHorizontalOverflow({ selector = 'html' } = {}) {
	return {
		id: 'no-horizontal-overflow',
		async run({ page }) {
			return probe(
				page,
				(rootSelector) => {
					const root = document.querySelector(rootSelector) ?? document.documentElement;
					const scrolling = document.scrollingElement ?? document.documentElement;
					const issues = [];
					if (scrolling.scrollWidth > scrolling.clientWidth + 1) {
						issues.push(
							`document scrollWidth ${scrolling.scrollWidth} exceeds clientWidth ${scrolling.clientWidth}`
						);
					}
					if (root.scrollWidth > root.clientWidth + 1) {
						issues.push(
							`${rootSelector} scrollWidth ${root.scrollWidth} exceeds clientWidth ${root.clientWidth}`
						);
					}
					return issues;
				},
				selector
			);
		}
	};
}

export function noClippedControls({ selector }) {
	return {
		id: `no-clipped-controls:${selector}`,
		async run({ page }) {
			return probe(
				page,
				(controlSelector) => {
					const visible = (element) => {
						const style = getComputedStyle(element);
						const rect = element.getBoundingClientRect();
						return (
							style.display !== 'none' &&
							style.visibility !== 'hidden' &&
							Number(style.opacity) > 0 &&
							rect.width > 0 &&
							rect.height > 0
						);
					};
					const issues = [];
					for (const element of document.querySelectorAll(controlSelector)) {
						if (!visible(element)) {
							continue;
						}
						if (element.scrollWidth > element.clientWidth + 1) {
							issues.push(
								`${controlSelector} content ${element.scrollWidth}px is clipped by ${element.clientWidth}px (${(element.textContent ?? '').trim().slice(0, 40)})`
							);
						}
						if (element.scrollHeight > element.clientHeight + 1) {
							issues.push(
								`${controlSelector} content ${element.scrollHeight}px is clipped vertically by ${element.clientHeight}px`
							);
						}
					}
					return issues;
				},
				selector
			);
		}
	};
}

export function noOverlap({ selector, tolerance = 4 } = {}) {
	return {
		id: `no-overlap:${selector}`,
		async run({ page }) {
			return probe(
				page,
				({ controlSelector, allowed }) => {
					const visible = (element) => {
						const style = getComputedStyle(element);
						const rect = element.getBoundingClientRect();
						return (
							style.display !== 'none' &&
							style.visibility !== 'hidden' &&
							Number(style.opacity) > 0 &&
							rect.width > 0 &&
							rect.height > 0
						);
					};
					const label = (element) =>
						(element.getAttribute('aria-label') ?? element.textContent ?? element.tagName)
							.trim()
							.slice(0, 40);
					const elements = [...document.querySelectorAll(controlSelector)].filter(visible);
					const issues = [];
					for (let i = 0; i < elements.length; i += 1) {
						for (let j = i + 1; j < elements.length; j += 1) {
							const a = elements[i];
							const b = elements[j];
							if (a.contains(b) || b.contains(a)) {
								continue;
							}
							const ra = a.getBoundingClientRect();
							const rb = b.getBoundingClientRect();
							const width = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
							const height = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
							if (width * height > allowed) {
								issues.push(
									`${controlSelector} "${label(a)}" overlaps "${label(b)}" by ${Math.round(width)}x${Math.round(height)}px`
								);
							}
						}
					}
					return issues;
				},
				{ controlSelector: selector, allowed: tolerance }
			);
		}
	};
}

export function allVisible({ selector, min = 1 } = {}) {
	return {
		id: `all-visible:${selector}`,
		async run({ page }) {
			return probe(
				page,
				({ controlSelector, minimum }) => {
					const issues = [];
					const elements = [...document.querySelectorAll(controlSelector)];
					if (elements.length < minimum) {
						issues.push(`${controlSelector} matched ${elements.length}, expected at least ${minimum}`);
					}
					for (const element of elements) {
						const style = getComputedStyle(element);
						const rect = element.getBoundingClientRect();
						if (
							style.display === 'none' ||
							style.visibility === 'hidden' ||
							Number(style.opacity) === 0 ||
							rect.width === 0 ||
							rect.height === 0
						) {
							issues.push(
								`${controlSelector} "${(element.textContent ?? '').trim().slice(0, 40)}" is not visible`
							);
						}
					}
					return issues;
				},
				{ controlSelector: selector, minimum: min }
			);
		}
	};
}

/** Turns captured browser diagnostics into an assertion result. */
export function noConsoleErrors({ allow = [], ignore = [] } = {}) {
	return {
		id: 'no-console-errors',
		async run({ diagnostics }) {
			const allowed = new Set(allow);
			const ignored = (message) => ignore.some((pattern) => pattern.test(message));
			const issues = [];
			for (const message of diagnostics.consoleErrors) {
				if (!allowed.has(message) && !ignored(message)) {
					issues.push(`console error: ${message}`);
				}
			}
			for (const message of diagnostics.pageErrors) {
				if (!allowed.has(message) && !ignored(message)) {
					issues.push(`page error: ${message}`);
				}
			}
			for (const failure of diagnostics.requestFailures) {
				issues.push(
					`request failure: ${failure.url} (${failure.status ?? failure.error ?? 'unknown'})`
				);
			}
			return issues;
		}
	};
}
