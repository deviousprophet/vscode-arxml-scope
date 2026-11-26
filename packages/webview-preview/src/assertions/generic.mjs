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
/** Shared visible/clipped/overlap probe; the page owns the geometry rules. */
async function geometryProbe(page, { selector, mode, tolerance = 0 }) {
	return probe(
		page,
		({ controlSelector, probeMode, allowed }) => {
			const shownByStyle = (style) =>
				style.display !== 'none' &&
				style.visibility !== 'hidden' &&
				Number(style.opacity) > 0;
			const shownByRect = (rect) => rect.width > 0 && rect.height > 0;
			const visible = (element) =>
				shownByStyle(getComputedStyle(element)) && shownByRect(element.getBoundingClientRect());
			const clippedIssues = (element) => {
				const issues = [];
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
				return issues;
			};
			const label = (element) =>
				(element.getAttribute('aria-label') ?? element.textContent ?? element.tagName)
					.trim()
					.slice(0, 40);
			const overlapOf = (a, b) => {
				const ra = a.getBoundingClientRect();
				const rb = b.getBoundingClientRect();
				const width = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
				const height = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
				return width * height > allowed ? { width, height } : undefined;
			};
			const overlapIssues = (a, b) => {
				const area = a.contains(b) || b.contains(a) ? undefined : overlapOf(a, b);
				return area === undefined
					? []
					: [
							`${controlSelector} "${label(a)}" overlaps "${label(b)}" by ${Math.round(area.width)}x${Math.round(area.height)}px`
						];
			};
			const clipped = () =>
				[...document.querySelectorAll(controlSelector)].filter(visible).flatMap(clippedIssues);
			const overlapping = () => {
				const elements = [...document.querySelectorAll(controlSelector)].filter(visible);
				return elements.flatMap((a, index) =>
					elements.slice(index + 1).flatMap((b) => overlapIssues(a, b))
				);
			};
			return probeMode === 'clip' ? clipped() : overlapping();
		},
		{ controlSelector: selector, probeMode: mode, allowed: tolerance }
	);
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
					const overflow = (label, element) =>
						element.scrollWidth > element.clientWidth + 1
							? [
									`${label} scrollWidth ${element.scrollWidth} exceeds clientWidth ${element.clientWidth}`
								]
							: [];
					return [...overflow('document', scrolling), ...overflow(rootSelector, root)];
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
			return geometryProbe(page, { selector, mode: 'clip' });
		}
	};
}
export function noOverlap({ selector, tolerance = 4 } = {}) {
	return {
		id: `no-overlap:${selector}`,
		async run({ page }) {
			return geometryProbe(page, { selector, mode: 'overlap', tolerance });
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
					const hiddenByStyle = (style) =>
						style.display === 'none' ||
						style.visibility === 'hidden' ||
						Number(style.opacity) === 0;
					const hiddenByRect = (rect) => rect.width === 0 || rect.height === 0;
					const hidden = (element) =>
						hiddenByStyle(getComputedStyle(element)) ||
						hiddenByRect(element.getBoundingClientRect());
					const elements = [...document.querySelectorAll(controlSelector)];
					const countIssue =
						elements.length < minimum
							? [`${controlSelector} matched ${elements.length}, expected at least ${minimum}`]
							: [];
					return [
						...countIssue,
						...elements
							.filter(hidden)
							.map(
								(element) =>
									`${controlSelector} "${(element.textContent ?? '').trim().slice(0, 40)}" is not visible`
							)
					];
				},
				{ controlSelector: selector, minimum: min }
			);
		}
	};
}
/** True when a diagnostic message is explicitly allowed or ignored. */
function suppressed(message, allowed, ignore) {
	return allowed.has(message) || ignore.some((pattern) => pattern.test(message));
}
/** Every diagnostic that the caller asked to report, with its kind. */
function diagnosticIssues(diagnostics, allowed, ignore) {
	const reported = (message) => !suppressed(message, allowed, ignore);
	return [
		...diagnostics.consoleErrors.filter(reported).map((message) => `console error: ${message}`),
		...diagnostics.pageErrors.filter(reported).map((message) => `page error: ${message}`),
		...diagnostics.requestFailures.map(
			(failure) =>
				`request failure: ${failure.url} (${failure.status ?? failure.error ?? 'unknown'})`
		)
	];
}
/** Turns captured browser diagnostics into an assertion result. */
export function noConsoleErrors({ allow = [], ignore = [] } = {}) {
	return {
		id: 'no-console-errors',
		async run({ diagnostics }) {
			return diagnosticIssues(diagnostics, new Set(allow), ignore);
		}
	};
}
