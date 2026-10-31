/**
 * The right sidebar shell: the Details/Conditions tab strip, the resizable
 * sidebar width, and the collapsible/resizable section panes.
 *
 * Owns the shell markup and the tab/width/pane state. The composition root
 * persists that state through a callback and seeds it from the page state.
 */
import './sidebar.css';
import { renderDetailsPanelHtml } from './detailsPanel/detailsPanel';
import { renderConditionsPanelHtml } from './conditionsPanel/conditionsPanel';


/** The resizer, the panel area and the vertical tab strip. */
export function renderSidebarHtml(): string {
	return `<div id="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" title="Drag to resize sidebar" tabindex="0"></div>
<aside id="sidebar" aria-label="ECUC sidebar">
${renderDetailsPanelHtml()}
${renderConditionsPanelHtml()}
</aside>
<div id="side-tabs" role="tablist" aria-label="Editor sidebar" aria-orientation="vertical">
<button id="stab-details" class="stab active" type="button" role="tab" aria-selected="true" aria-controls="sbp-details">Details</button>
<button id="stab-conditions" class="stab" type="button" role="tab" aria-selected="false" aria-controls="sbp-conditions" tabindex="-1">Conditions</button>
</div>`;
}
/** A 22px whole-header toggle, as in the VS Code PaneView model. */
export const HEADER_H = 22;
/** The smallest expanded pane keeps a usable body under its header. */
export const MIN_PANE = HEADER_H + 60;
/** The drag separator between two panes. */
export const SASH_H = 6;
/** One keyboard sash step. */
export const SASH_STEP = 10;

export const MIN_SIDEBAR_WIDTH = 260;
export const MAX_SIDEBAR_WIDTH = 900;
export const DEFAULT_SIDEBAR_WIDTH = 360;

export type SidebarTab = 'details' | 'conditions';

/** One section as the allocator sees it. */
export interface PaneSpec {
	id: string;
	saved: number | null;
	collapsed: boolean;
	user: boolean;
}

/** The layout state persisted through `vscode.setState`. */
export interface SidebarUiState {
	tab: SidebarTab;
	sidebarWidth: number;
	panes: Record<string, number>;
	collapsed: string[];
}

/**
 * Clamp the sidebar width to the user-visible bounds and to the space the
 * window actually has left of the tab strip. A non-finite width falls back to
 * the minimum; a viewport too small for the minimum keeps the minimum.
 *
 * The bounds are literals so the page copy is self-contained and the tests can
 * pin the same values the stylesheet uses.
 */
export function clampSidebarWidth(width: number, viewport: number, tabsWidth: number): number {
	const min = 260;
	const maxWidth = 900;
	// Keep at least this much room for the tree, matching the Hex Scope shell.
	const treeGutter = 220;
	const room = Math.round(viewport) - Math.round(tabsWidth) - treeGutter;
	const max = Math.max(min, Math.min(maxWidth, room));
	const wanted = Number.isFinite(width) ? Math.round(width) : min;
	return Math.min(max, Math.max(min, wanted));
}

/**
 * Split `free` px among the expanded panes. User-set sizes are claimed first
 * (clamped so every other pane still gets `MIN_PANE`), fresh panes split what
 * is left evenly, the last fresh pane absorbs rounding, and one expanded pane
 * always fills the pool. Collapsed panes are not in the result.
 *
 * `minPane` mirrors MIN_PANE (HEADER_H + 60) as a literal; the tests pin both
 * values.
 */
export function allocatePanes(free: number, panes: readonly PaneSpec[]): Map<string, number> {
	const minPane = 82;
	const expanded = panes.filter((pane) => !pane.collapsed);
	const out = new Map<string, number>();
	const n = expanded.length;
	if (n === 0) {
		return out;
	}
	const pool = Math.max(free, n * minPane);
	if (n === 1) {
		out.set(expanded[0].id, pool);
		return out;
	}
	let remaining = pool;
	for (const pane of expanded) {
		if (!pane.user || pane.saved === null) {
			continue;
		}
		const others = n - out.size - 1;
		const max = Math.max(minPane, remaining - others * minPane);
		const want = Math.max(minPane, Math.min(pane.saved, max));
		out.set(pane.id, want);
		remaining -= want;
	}
	const fresh = expanded.filter((pane) => !(pane.user && pane.saved !== null));
	const equal = fresh.length > 0 ? Math.floor(remaining / fresh.length) : 0;
	for (let at = 0; at < fresh.length; at++) {
		const want = at === fresh.length - 1 ? remaining : equal;
		out.set(fresh[at].id, want);
		remaining -= want;
	}
	let sum = 0;
	for (const px of out.values()) {
		sum += px;
	}
	if (sum > 0 && sum < pool) {
		// Every pane was user-set and their saved sizes under-fill the pool.
		// Scale up proportionally; the last pane absorbs the rounding remainder.
		const scale = pool / sum;
		const entries = [...out.entries()];
		let used = 0;
		for (let at = 0; at < entries.length; at++) {
			const want = at === entries.length - 1 ? pool - used : Math.floor(entries[at][1] * scale);
			out.set(entries[at][0], want);
			used += want;
		}
	}
	return out;
}

/**
 * Validate a saved page state. A missing/invalid state falls back to Details,
 * the default width and no saved panes or collapsed sections. The legacy
 * `inspectorHidden` flag is ignored (not carried forward, not written back).
 */
export function loadUiState(saved: unknown): SidebarUiState {
	// The default width is a literal; DEFAULT_SIDEBAR_WIDTH is asserted to match
	// in the tests.
	const defaultWidth = 360;
	const minWidth = 260;
	const maxWidth = 900;
	const state: SidebarUiState = {
		tab: 'details',
		sidebarWidth: defaultWidth,
		panes: {},
		collapsed: [],
	};
	if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
		return state;
	}
	const source = saved as Record<string, unknown>;
	if (source.tab === 'conditions') {
		state.tab = 'conditions';
	}
	if (typeof source.sidebarWidth === 'number' && Number.isFinite(source.sidebarWidth)) {
		state.sidebarWidth = Math.max(minWidth, Math.min(maxWidth, Math.round(source.sidebarWidth)));
	}
	if (source.panes && typeof source.panes === 'object' && !Array.isArray(source.panes)) {
		for (const [id, value] of Object.entries(source.panes as Record<string, unknown>)) {
			if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
				state.panes[id] = value;
			}
		}
	}
	if (Array.isArray(source.collapsed)) {
		state.collapsed = source.collapsed.filter((id): id is string => typeof id === 'string');
	}
	return state;
}

/**
 * The page half of the shell. It binds the static markup the host shell writes:
 * tab buttons, the sidebar resizer, section headers and sashes.
 *
 * `mountSidebarShell()` is called at boot, after `setSidebarState` has seeded
 * `uiState`. It reads `uiState`/`persistUiState` and never touches rows or
 * Conditions values.
 */

let sidebarPaneViews: SidebarPaneView[] = [];
let uiState: SidebarUiState = loadUiState(undefined);
let persistUiState: () => void = function () {};





export function sidebarTabName(button: any): SidebarTab {
	const controls = button.getAttribute('aria-controls');
	return controls === 'sbp-conditions' ? 'conditions' : 'details';
}

export function setSidebarState(savedState: unknown): void {
	uiState = loadUiState(savedState);
}

export function setSidebarPersistence(persist: () => void): void {
	persistUiState = persist;
}

export function layoutSidebarPanes(): void {
	for (let at = 0; at < sidebarPaneViews.length; at++) {
		sidebarPaneViews[at].layout();
	}
}

export function getSidebarState(): SidebarUiState {
	return uiState;
}

/** Show one tab panel and move the roving focus when a key asked for it. */
export function activateSidebarTab(name: string, focusTab?: boolean): void {
	const next = name === 'conditions' ? 'conditions' : 'details';
	const changed = uiState.tab !== next;
	uiState.tab = next;
	const tabs = document.getElementById('side-tabs');
	if (tabs) {
		const buttons = tabs.querySelectorAll('.stab') as unknown as any[];
		for (let at = 0; at < buttons.length; at++) {
			const button = buttons[at];
			const active = sidebarTabName(button) === next;
			button.classList.toggle('active', active);
			button.setAttribute('aria-selected', active ? 'true' : 'false');
			button.tabIndex = active ? 0 : -1;
			if (active && focusTab) {
				button.focus();
			}
		}
	}
	const panels = document.querySelectorAll('.sb-tab-panel') as unknown as any[];
	for (let at = 0; at < panels.length; at++) {
		const panel = panels[at];
		const active = panel.id === 'sbp-' + next;
		panel.classList.toggle('active', active);
		if (active) {
			panel.removeAttribute('hidden');
		} else {
			panel.setAttribute('hidden', '');
		}
	}
	if (changed) {
		persistUiState();
	}
	// A panel that was display:none has no height; lay it out once it is shown.
	requestAnimationFrame(layoutSidebarPanes);
}

/** The details editor calls this so a hidden tab cannot swallow an edit. */
export function showSidebarTab(name: string): void {
	if (uiState.tab !== (name === 'conditions' ? 'conditions' : 'details')) {
		activateSidebarTab(name, false);
	}
}

/** Expand a Details section before focusing a field inside it. */
export function showSidebarSection(id: string): void {
	for (let at = 0; at < sidebarPaneViews.length; at++) {
		if (sidebarPaneViews[at].showSection(id)) {
			return;
		}
	}
}

function sidebarTabsWidth(): number {
	const tabs = document.getElementById('side-tabs');
	return tabs ? tabs.getBoundingClientRect().width || 28 : 28;
}

/**
 * The width actually shown right now: the saved preference clamped to the room
 * this window has. The preference itself stays untouched, so widening the
 * window restores it instead of baking in the transient clamp.
 */
function displayedSidebarWidth(): number {
	return clampSidebarWidth(uiState.sidebarWidth, window.innerWidth, sidebarTabsWidth());
}

/**
 * Apply a width to the page. The persist flag writes it as the new user
 * preference; mount/resize apply a clamped display width and leave the
 * preference alone.
 */
function applySidebarWidth(width: number, persist: boolean): void {
	const sidebar = document.getElementById('sidebar');
	const resizer = document.getElementById('sidebar-resizer');
	if (!sidebar) {
		return;
	}
	// At <=720px the layout stacks, #sidebar fills the width and the resizer is
	// hidden. Leave the saved preference alone so widening the window restores it
	// instead of baking in the strip-clamped width.
	if (resizer && resizer.offsetParent === null) {
		return;
	}
	const clamped = clampSidebarWidth(width, window.innerWidth, sidebarTabsWidth());
	sidebar.style.setProperty('--sidebar-w', clamped + 'px');
	if (persist) {
		uiState.sidebarWidth = clamped;
		persistUiState();
	}
}

export function onTabKeydown(event: any, button: any): void {
	const tabs = document.getElementById('side-tabs');
	if (!tabs) {
		return;
	}
	const buttons = tabs.querySelectorAll('.stab') as unknown as any[];
	let index = -1;
	for (let at = 0; at < buttons.length; at++) {
		if (buttons[at] === button) {
			index = at;
		}
	}
	if (index < 0) {
		return;
	}
	let next = -1;
	if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
		next = index === 0 ? buttons.length - 1 : index - 1;
	} else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
		next = index === buttons.length - 1 ? 0 : index + 1;
	} else if (event.key === 'Home') {
		next = 0;
	} else if (event.key === 'End') {
		next = buttons.length - 1;
	}
	if (next < 0 || !buttons[next]) {
		return;
	}
	event.preventDefault();
	activateSidebarTab(sidebarTabName(buttons[next]), true);
}

/**
 * One pane view: per-section collapse state plus the pane allocation. A view
 * can be hidden (an inactive tab), in which case clientHeight is 0 and the
 * layout is deferred until the tab is shown.
 */
export class SidebarPaneView {
	root: any;
	sections: any[];
	sizing: Map<string, any>;
	collapsed: Map<string, boolean>;
	collapseAnimating: boolean;
	observer: ResizeObserver | null;

	constructor(root: any) {
		this.root = root;
		this.sections = [];
		this.sizing = new Map();
		this.collapsed = new Map();
		this.collapseAnimating = false;
		this.observer = null;
		const nodes = root.querySelectorAll('.sb-section') as unknown as any[];
		for (let at = 0; at < nodes.length; at++) {
			const section = nodes[at];
			const id = section.dataset ? section.dataset.paneId : undefined;
			const head = section.querySelector('.sb-section-head');
			const body = section.querySelector('.sb-body');
			if (!id || !head || !body) {
				continue;
			}
			const saved = this.savedPane(id);
			const collapsed = uiState.collapsed.indexOf(id) >= 0;
			this.sections.push({ id: id, section: section, head: head, body: body });
			this.sizing.set(id, { saved: saved, px: HEADER_H, user: saved !== null });
			this.collapsed.set(id, collapsed);
			section.classList.toggle('collapsed', collapsed);
			head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
			this.bindHead(section, head, id);
		}
		this.bindSashes();
		if (typeof ResizeObserver !== 'undefined') {
			this.observer = new ResizeObserver(() => this.layout());
			this.observer.observe(root);
		}
		this.layout();
	}

	savedPane(id: string): number | null {
		const saved = uiState.panes[id];
		return typeof saved === 'number' && Number.isFinite(saved) && saved > 0 ? Math.max(MIN_PANE, saved) : null;
	}

	sectionEntry(id: string): any {
		for (let at = 0; at < this.sections.length; at++) {
			if (this.sections[at].id === id) {
				return this.sections[at];
			}
		}
		return undefined;
	}

	/** Expand one section of this view; false when the view does not own it. */
	showSection(id: string): boolean {
		const entry = this.sectionEntry(id);
		if (!entry) {
			return false;
		}
		if (this.isCollapsed(id)) {
			this.setCollapsed(id, false, true);
		}
		return true;
	}

	isCollapsed(id: string): boolean {
		return this.collapsed.get(id) === true;
	}

	persistCollapsed(id: string, collapsed: boolean): void {
		const list = uiState.collapsed.filter((other) => other !== id);
		if (collapsed) {
			list.push(id);
		}
		uiState.collapsed = list;
		persistUiState();
	}

	bindHead(section: any, head: any, id: string): void {
		const view = this;
		head.addEventListener('click', function (event: any) {
			if (event.target instanceof Element && event.target.closest('.sb-section-actions')) {
				return;
			}
			view.setCollapsed(id, !view.isCollapsed(id), true);
		});
		head.addEventListener('keydown', function (event: any) {
			if (event.target !== head) {
				return;
			}
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				view.setCollapsed(id, !view.isCollapsed(id), true);
			} else if (event.key === 'ArrowLeft') {
				event.preventDefault();
				view.setCollapsed(id, true, true);
			} else if (event.key === 'ArrowRight') {
				event.preventDefault();
				view.setCollapsed(id, false, true);
			}
		});
	}

	setCollapsed(id: string, collapsed: boolean, persist: boolean): void {
		const entry = this.sectionEntry(id);
		if (!entry) {
			return;
		}
		const was = this.isCollapsed(id);
		if (was !== collapsed) {
			this.collapsed.set(id, collapsed);
			entry.section.classList.toggle('collapsed', collapsed);
			entry.head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
			// Drop a stale no-transition class from the previous layout so a
			// collapse/expand always animates; other layout passes stay instant.
			this.root.classList.remove('no-transition');
			this.collapseAnimating = true;
			this.layout();
			this.collapseAnimating = false;
			if (persist) {
				this.persistCollapsed(id, collapsed);
			}
		} else if (persist) {
			this.persistCollapsed(id, collapsed);
		}
	}

	neighbors(sash: any): { aboveId: string; belowId: string } | null {
		const above = sash.previousElementSibling;
		const below = sash.nextElementSibling;
		const aboveId = above && above.classList && above.classList.contains('sb-section') ? above.dataset.paneId : undefined;
		const belowId = below && below.classList && below.classList.contains('sb-section') ? below.dataset.paneId : undefined;
		if (!aboveId || !belowId || this.isCollapsed(aboveId) || this.isCollapsed(belowId)) {
			return null;
		}
		return { aboveId: aboveId, belowId: belowId };
	}

	bindSashes(): void {
		const sashes = this.root.querySelectorAll('.sb-pane-sash') as unknown as any[];
		for (let at = 0; at < sashes.length; at++) {
			const sash = sashes[at];
			const view = this;
			sash.addEventListener('mousedown', function (event: any) {
				if (event.button !== 0) {
					return;
				}
				const pair = view.neighbors(sash);
				if (!pair) {
					return;
				}
				event.preventDefault();
				sash.classList.add('dragging');
				view.root.classList.add('dragging');
				document.body.classList.add('sb-row-resizing');
				let lastY = event.clientY;
				let moved = false;
				const onMove = function (moveEvent: any) {
					const delta = moveEvent.clientY - lastY;
					lastY = moveEvent.clientY;
					if (delta !== 0) {
						moved = true;
						view.shiftPane(pair.aboveId, pair.belowId, delta);
					}
				};
				const stopDrag = function (): void {
					sash.classList.remove('dragging');
					view.root.classList.remove('dragging');
					document.body.classList.remove('sb-row-resizing');
					window.removeEventListener('mousemove', onMove);
					window.removeEventListener('mouseup', stopDrag);
					if (moved) {
						view.persistPane(pair.aboveId);
						view.persistPane(pair.belowId);
						persistUiState();
					}
				};
				window.addEventListener('mousemove', onMove);
				window.addEventListener('mouseup', stopDrag);
			});
			sash.addEventListener('keydown', function (event: any) {
				const pair = view.neighbors(sash);
				if (!pair) {
					return;
				}
				// Arrow keys move the separator itself (the WAI-ARIA window-splitter
				// convention): ArrowUp moves the sash up, so the pane above shrinks.
				const delta = event.key === 'ArrowUp' ? -SASH_STEP : event.key === 'ArrowDown' ? SASH_STEP : 0;
				if (delta === 0) {
					return;
				}
				event.preventDefault();
				view.shiftPane(pair.aboveId, pair.belowId, delta);
				view.persistPane(pair.aboveId);
				view.persistPane(pair.belowId);
				persistUiState();
			});
			sash.addEventListener('dblclick', function () {
				const pair = view.neighbors(sash);
				if (!pair) {
					return;
				}
				const above = view.sizing.get(pair.aboveId);
				const below = view.sizing.get(pair.belowId);
				const combined = above.px + below.px;
				const half = Math.floor(combined / 2);
				above.saved = half;
				below.saved = combined - half;
				above.user = true;
				below.user = true;
				view.layout();
				view.persistPane(pair.aboveId);
				view.persistPane(pair.belowId);
				persistUiState();
			});
		}
	}

	/** Resize the pane above a sash; the pane below absorbs the delta. */
	shiftPane(aboveId: string, belowId: string, delta: number): void {
		const above = this.sizing.get(aboveId);
		const below = this.sizing.get(belowId);
		if (!above || !below) {
			return;
		}
		const combined = above.px + below.px;
		const next = Math.max(MIN_PANE, Math.min(above.px + delta, combined - MIN_PANE));
		above.saved = next;
		below.saved = combined - next;
		above.user = true;
		below.user = true;
		this.layout();
	}

	persistPane(id: string): void {
		const sizing = this.sizing.get(id);
		if (!sizing || sizing.saved === null) {
			return;
		}
		uiState.panes[id] = Math.round(sizing.saved);
	}

	paintSashStates(): void {
		const sashes = this.root.querySelectorAll('.sb-pane-sash') as unknown as any[];
		for (let at = 0; at < sashes.length; at++) {
			const sash = sashes[at];
			const pair = this.neighbors(sash);
			const disabled = pair === null;
			sash.classList.toggle('disabled', disabled);
			if (disabled) {
				sash.setAttribute('aria-disabled', 'true');
				sash.tabIndex = -1;
			} else {
				sash.removeAttribute('aria-disabled');
				sash.tabIndex = 0;
			}
		}
	}

	/** Allocate every pane. Non-collapse passes are instant (no animation). */
	layout(): void {
		const height = this.root.clientHeight;
		if (height <= 0) {
			// An inactive tab panel (display:none) has no height; its panes keep
			// their bases and are laid out when the tab is shown.
			return;
		}
		if (!this.collapseAnimating) {
			this.root.classList.add('no-transition');
		}
		const ids = [];
		const specs = [];
		let collapsedCount = 0;
		for (let at = 0; at < this.sections.length; at++) {
			const id = this.sections[at].id;
			const sizing = this.sizing.get(id);
			const collapsed = this.collapsed.get(id) === true;
			ids.push(id);
			if (collapsed) {
				collapsedCount++;
			}
			specs.push({ id: id, saved: sizing.saved, collapsed: collapsed, user: sizing.user });
		}
		const sashCount = this.root.querySelectorAll('.sb-pane-sash').length;
		const free = Math.max(0, height - collapsedCount * HEADER_H - sashCount * SASH_H);
		const allocated = allocatePanes(free, specs);
		for (let at = 0; at < ids.length; at++) {
			const id = ids[at];
			const entry = this.sections[at];
			const collapsed = this.collapsed.get(id) === true;
			const px = collapsed ? HEADER_H : allocated.get(id) || HEADER_H;
			this.sizing.get(id).px = px;
			entry.section.style.setProperty('--sb-pane-h', px + 'px');
		}
		this.paintSashStates();
		if (!this.collapseAnimating) {
			const root = this.root;
			requestAnimationFrame(function () {
				root.classList.remove('no-transition');
			});
		}
	}
}

function bindSidebarResizer(resizer: any): void {
	resizer.addEventListener('mousedown', function (event: any) {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = displayedSidebarWidth();
		let lastWidth = startWidth;
		let moved = false;
		resizer.classList.add('dragging');
		document.body.classList.add('sb-col-resizing');
		const onMove = function (moveEvent: any) {
			const delta = startX - moveEvent.clientX;
			if (delta !== 0) {
				moved = true;
			}
			lastWidth = startWidth + delta;
			applySidebarWidth(lastWidth, false);
		};
		const stopDrag = function (): void {
			resizer.classList.remove('dragging');
			document.body.classList.remove('sb-col-resizing');
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', stopDrag);
			if (moved) {
				// The drag previews with the display width; commit it once, on release.
				applySidebarWidth(lastWidth, true);
			}
		};
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', stopDrag);
	});
	resizer.addEventListener('keydown', function (event: any) {
		// The resizer is the sidebar's left edge, so ArrowLeft moves it left
		// (a wider sidebar) and ArrowRight narrows it: the same
		// move-the-separator rule as a pane sash.
		const delta = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0;
		if (delta === 0) {
			return;
		}
		event.preventDefault();
		applySidebarWidth(displayedSidebarWidth() + delta, true);
	});
}

/** Bind the static shell and apply the saved tab, width, panes and sections. */
export function mountSidebarShell(): void {
	const sidebar = document.getElementById('sidebar');
	const resizer = document.getElementById('sidebar-resizer');
	const tabs = document.getElementById('side-tabs');
	if (!sidebar || !resizer || !tabs) {
		return;
	}
	sidebarPaneViews = [];
	const views = document.querySelectorAll('.sb-pane-view') as unknown as any[];
	for (let at = 0; at < views.length; at++) {
		sidebarPaneViews.push(new SidebarPaneView(views[at]));
	}
	applySidebarWidth(uiState.sidebarWidth, false);
	const buttons = tabs.querySelectorAll('.stab') as unknown as any[];
	for (let at = 0; at < buttons.length; at++) {
		const button = buttons[at];
		button.addEventListener('click', function () {
			activateSidebarTab(sidebarTabName(button), false);
		});
		button.addEventListener('keydown', function (event: any) {
			onTabKeydown(event, button);
		});
	}
	activateSidebarTab(uiState.tab, false);
	bindSidebarResizer(resizer);
	// A window resize can make a saved width too wide for the remaining room;
	// re-clamp it (without a write) and re-lay the panes out.
	window.addEventListener('resize', function () {
		applySidebarWidth(uiState.sidebarWidth, false);
		layoutSidebarPanes();
	});
}
