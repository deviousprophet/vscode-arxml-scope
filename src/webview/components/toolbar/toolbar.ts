/**
 * Toolbar component: the editor and diff control strips.
 *
 * Owns the markup, the shared width/order rules, the button classes and the
 * click wiring. It holds no document, selection or search state: every action
 * is reported through a callback the composition root provides.
 */
import toolbarCss from './toolbar.css';

declare const document: any;

export function toolbarStyles(): string {
	return toolbarCss;
}

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
}

/** Diff strip: left view/nav group, centred Swap, right Search slot. */
export function renderDiffToolbarHtml(searchHtml: string): string {
	return `<div class="toolbar">
<div class="toolbar-left">
<div class="view-switch" role="group" aria-label="Diff view">
<button id="diff-view-all" class="tool view-tool" type="button" aria-pressed="true">Show all</button>
<button id="diff-view-diff" class="tool view-tool" type="button" aria-pressed="false">Show diff only</button>
</div>
<button id="diff-prev" class="tool icon-tool" type="button" title="Previous difference (Shift+F7)" aria-label="Previous difference"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg><span class="lbl">Prev diff</span></button>
<button id="diff-next" class="tool icon-tool" type="button" title="Next difference (F7)" aria-label="Next difference"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg><span class="lbl">Next diff</span></button>
</div>
<div class="toolbar-center">
<button id="diff-swap" class="tool icon-tool" type="button" title="Swap the displayed sides" aria-label="Swap sides" aria-pressed="false"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h9m0 0-2.5-2.5M12 5 9.5 7.5M13 11H4m0 0 2.5-2.5M4 11l2.5 2.5"/></svg><span class="lbl">Swap sides</span></button>
</div>
<div class="toolbar-right">
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
	}

	setSwapped(swapped: boolean): void {
		const swap = document.getElementById('diff-swap');
		if (swap) {
			swap.setAttribute('aria-pressed', swapped ? 'true' : 'false');
		}
	}

	private bind(id: string, action: () => void): void {
		const button = document.getElementById(id);
		if (button) {
			button.addEventListener('click', action);
		}
	}
}

/** The classes serialized into the page before the composition root runs. */
export function toolbarScript(): string {
	return `const EditorToolbar = (${EditorToolbar.toString()});
const DiffToolbar = (${DiffToolbar.toString()});`;
}
