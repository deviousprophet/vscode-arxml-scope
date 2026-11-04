/**
 * Toolbar component: the editor and diff control strips.
 *
 * Owns the markup, the shared width/order rules, the button classes and the
 * click wiring. It holds no document, selection or search state: every action
 * is reported through a callback the composition root provides.
 */
import './toolbar.css';

export interface EditorToolbarCallbacks {
	onCollapseAll?(): void;
	onExpandAll?(): void;
}

/** Editor strip: flexible slot (grow), Collapse, Expand, then the Search slot. */
export function renderEditorToolbarHtml(searchHtml: string): string {
	return `<div class="toolbar">
<span class="grow"></span>
<button id="collapse-all" class="sb-btn sb-btn-secondary icon-tool" type="button" title="Collapse every container" aria-label="Collapse every container"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2.25l4 4 4-4M4 13.75l4-4 4 4"/></svg><span class="lbl">Collapse</span></button>
<button id="expand-all" class="sb-btn sb-btn-secondary icon-tool" type="button" title="Expand every container" aria-label="Expand every container"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.25 8 2.25l4 4M4 9.75l4 4 4-4"/></svg><span class="lbl">Expand</span></button>
${searchHtml}
</div>`;
}

export class EditorToolbar {
	private callbacks: EditorToolbarCallbacks;
	mounted: boolean;

	constructor(callbacks: EditorToolbarCallbacks = {}) {
		this.callbacks = callbacks;
		this.mounted = false;
	}

	mount(): void {
		if (this.mounted) {
			return;
		}
		this.mounted = true;
		const collapse = document.getElementById('collapse-all');
		if (collapse) {
			collapse.addEventListener('click', () => {
				if (this.callbacks.onCollapseAll) {
					this.callbacks.onCollapseAll();
				}
			});
		}
		const expand = document.getElementById('expand-all');
		if (expand) {
			expand.addEventListener('click', () => {
				if (this.callbacks.onExpandAll) {
					this.callbacks.onExpandAll();
				}
			});
		}
	}
}

export interface DiffToolbarCallbacks {
	onViewAll?(): void;
	onViewDiff?(): void;
	onPrev?(): void;
	onNext?(): void;
	onSwap?(): void;
	onMatchMode?(semantic: boolean): void;
	onContext?(active: boolean): void;
}

/** Diff strip: left view groups, centred navigation, right status + Search. */
/** One 18px inline icon for the icon-over-label diff toolbar. */
function diffIcon(paths: string): string {
	return `<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const ICON_SHOW_ALL = diffIcon('<path d="M2 3.5h12M2 8h12M2 12.5h12"/>');
const ICON_SHOW_DIFF = diffIcon(
	'<rect x="2" y="2.5" width="5" height="11" rx="0.5"/><rect x="9" y="2.5" width="5" height="11" rx="0.5"/><path d="M7 5h2M7 8h2M7 11h2"/>'
);
const ICON_SEMANTIC = diffIcon(
	'<circle cx="4" cy="3.5" r="1.5"/><circle cx="4" cy="12.5" r="1.5"/><circle cx="12" cy="5.5" r="1.5"/><path d="M4 5v6M4 8h4a4 4 0 0 0 4-4"/>'
);
const ICON_STRICT = diffIcon('<path d="M3 5.5h10M3 10.5h10"/>');
const ICON_PREV = diffIcon('<path d="M8 12V4M4 8l4-4 4 4"/>');
const ICON_NEXT = diffIcon('<path d="M8 4v8M4 8l4 4 4-4"/>');
const ICON_SWAP = diffIcon(
	'<path d="M3 5h9m0 0-2.5-2.5M12 5 9.5 7.5M13 11H4m0 0 2.5-2.5M4 11l2.5 2.5"/>'
);
const ICON_CONTEXT = diffIcon(
	'<path d="M2 3.5h12M2 12.5h12M5 8h2M9 8h2"/><path d="M6.5 6.8l1.5 1.4 1.5-1.4"/>'
);

export function renderDiffToolbarHtml(searchHtml: string): string {
	return `<div class="toolbar">
<div class="toolbar-left">
<div class="view-switch" role="group" aria-label="Diff view">
<button id="diff-view-all" class="tool diff-tool" type="button" aria-pressed="true" aria-label="Show every row" title="Show every row">${ICON_SHOW_ALL}<span class="lbl">Show all</span></button>
<button id="diff-view-diff" class="tool diff-tool" type="button" aria-pressed="false" aria-label="Show differences only" title="Show only differences and their context">${ICON_SHOW_DIFF}<span class="lbl">Show diff only</span></button>
</div>
<div class="view-switch" role="group" aria-label="Diff matching">
<button id="diff-mode-semantic" class="tool diff-tool" type="button" aria-pressed="true" aria-label="Semantic matching" title="Semantic matching pairs renamed containers">${ICON_SEMANTIC}<span class="lbl">Semantic</span></button>
<button id="diff-mode-strict" class="tool diff-tool" type="button" aria-pressed="false" aria-label="Strict matching" title="Strict matching reproduces the previous diff">${ICON_STRICT}<span class="lbl">Strict</span></button>
</div>
</div>
<div class="toolbar-center">
<button id="diff-prev" class="tool diff-tool" type="button" title="Previous difference (Shift+F7)" aria-label="Previous difference">${ICON_PREV}<span class="lbl">Prev diff</span></button>
<button id="diff-next" class="tool diff-tool" type="button" title="Next difference (F7)" aria-label="Next difference">${ICON_NEXT}<span class="lbl">Next diff</span></button>
<button id="diff-context" class="tool diff-tool" type="button" aria-pressed="true" aria-label="Show 5 lines of context" title="Show 5 unchanged lines above and below each difference">${ICON_CONTEXT}<span class="lbl">Context</span></button>
<button id="diff-swap" class="tool diff-tool" type="button" title="Swap the displayed sides" aria-label="Swap sides" aria-pressed="false">${ICON_SWAP}<span class="lbl">Swap sides</span></button>
</div>
<div class="toolbar-right">
<span id="diff-match-status" class="match-status" role="status" aria-live="polite"></span>
${searchHtml}
</div>
</div>`;
}

export class DiffToolbar {
	private callbacks: DiffToolbarCallbacks;
	mounted: boolean;

	constructor(callbacks: DiffToolbarCallbacks = {}) {
		this.callbacks = callbacks;
		this.mounted = false;
	}

	mount(): void {
		if (this.mounted) {
			return;
		}
		this.mounted = true;
		this.bind('diff-view-all', () => this.callbacks.onViewAll && this.callbacks.onViewAll());
		this.bind('diff-view-diff', () => this.callbacks.onViewDiff && this.callbacks.onViewDiff());
		this.bind('diff-prev', () => this.callbacks.onPrev && this.callbacks.onPrev());
		this.bind('diff-next', () => this.callbacks.onNext && this.callbacks.onNext());
		this.bind('diff-swap', () => this.callbacks.onSwap && this.callbacks.onSwap());
		this.bind('diff-mode-semantic', () => this.callbacks.onMatchMode && this.callbacks.onMatchMode(true));
		this.bind('diff-mode-strict', () => this.callbacks.onMatchMode && this.callbacks.onMatchMode(false));
		this.bind('diff-context', () => {
			if (!this.callbacks.onContext) {
				return;
			}
			const button = document.getElementById('diff-context');
			if (!button || button.hasAttribute('disabled')) {
				return;
			}
			this.callbacks.onContext(button.getAttribute('aria-pressed') !== 'true');
		});
	}

	setViewMode(changesOnly: boolean): void {
		const all = document.getElementById('diff-view-all');
		if (all) {
			all.setAttribute('aria-pressed', changesOnly ? 'false' : 'true');
		}
		const diff = document.getElementById('diff-view-diff');
		if (diff) {
			diff.setAttribute('aria-pressed', changesOnly ? 'true' : 'false');
		}
		const context = document.getElementById('diff-context');
		if (context) {
			if (changesOnly) {
				context.removeAttribute('disabled');
			} else {
				context.setAttribute('disabled', '');
			}
			context.title = changesOnly
				? 'Show 5 unchanged lines above and below each difference'
				: 'Context applies to Show diff only';
			context.setAttribute('aria-label', changesOnly ? 'Show 5 lines of context' : 'Context applies to Show diff only');
		}
	}

	setSwapped(swapped: boolean): void {
		const swap = document.getElementById('diff-swap');
		if (swap) {
			swap.setAttribute('aria-pressed', swapped ? 'true' : 'false');
		}
	}

	setMatchMode(semantic: boolean, pending = false): void {
		const semanticButton = document.getElementById('diff-mode-semantic');
		if (semanticButton) {
			semanticButton.setAttribute('aria-pressed', semantic ? 'true' : 'false');
			semanticButton.setAttribute('aria-busy', pending && semantic ? 'true' : 'false');
		}
		const strictButton = document.getElementById('diff-mode-strict');
		if (strictButton) {
			strictButton.setAttribute('aria-pressed', semantic ? 'false' : 'true');
			strictButton.setAttribute('aria-busy', pending && !semantic ? 'true' : 'false');
		}
		const status = document.getElementById('diff-match-status');
		if (status) {
			status.textContent = pending ? `Switching to ${semantic ? 'Semantic' : 'Strict'}…` : '';
		}
	}

	setContext(active: boolean): void {
		const button = document.getElementById('diff-context');
		if (button) {
			button.setAttribute('aria-pressed', active ? 'true' : 'false');
		}
	}

	private bind(id: string, action: () => void): void {
		const button = document.getElementById(id);
		if (button) {
			button.addEventListener('click', action);
		}
	}
}
