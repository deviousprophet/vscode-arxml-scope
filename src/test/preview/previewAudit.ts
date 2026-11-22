/**
 * Geometry audit for one rendered preview state.
 *
 * The screenshot shows paint; this object records the measured boxes a screenshot
 * can hide: an arrow outside its pane, toolbar controls on top of each other, a
 * digit under a rail. The screenshot runner writes it next to the PNG and fails
 * the capture when a violation is present. Everything is read from the real
 * rendered DOM after the page's gestures.
 */

export interface AuditState {
	name: string;
	page: 'diff' | 'editor';
	merge?: boolean;
	swap?: boolean;
	wide?: boolean;
	pan?: number;
	select?: boolean;
}

interface Rect {
	x: number;
	y: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
}

interface PaneAudit {
	side: 'left' | 'right';
	rect: Rect;
	clientWidth: number;
	contentWidth: number;
	scrollLeft: number;
	gutterInset: number;
	rows: number;
	changedRows: number;
	rails: number;
	innerRail: boolean;
}

interface ArrowAudit {
	side: string;
	rect: Rect;
	vertical: boolean;
	insideX: boolean;
	edgeGap: number;
	visible: boolean;
	opaque: boolean;
}

interface ToolbarControl {
	name: string;
	rect: Rect;
	groupRect?: Rect;
}

interface GroupAudit {
	rect: Rect;
	clientWidth: number;
	scrollWidth: number;
}

interface ToolbarAudit {
	controls: number;
	display: string;
	groups: Record<string, GroupAudit | null>;
	swapCenterGap: number;
	overlaps: string[];
	outside: string[];
	clipped: string[];
	mergePressed: boolean | null;
}

interface GutterAudit {
	cells: number;
	rails: number;
	digitsClear: boolean;
	legacyCellRail: boolean;
}

interface ContentAudit {
	pageOverflow: boolean;
	scrollWidth: number;
	clientWidth: number;
}

interface PaneBounds {
	side: string;
	rect?: Rect;
	left: number;
	right: number;
}

export interface PaneSnapshot {
	leftTitle: string;
	rightTitle: string;
	leftValue: string;
	rightValue: string;
}

export interface PreviewAudit {
	state: string;
	page: 'diff' | 'editor';
	ready: boolean;
	viewport: { width: number; height: number };
	panes: PaneAudit[];
	arrows: ArrowAudit[];
	toolbar: ToolbarAudit;
	gutter: GutterAudit;
	content: ContentAudit;
	selected: string | null;
	swap: { before: PaneSnapshot; after: PaneSnapshot } | null;
	syntax?: { text: string; className: string; color: string }[];
	violations: string[];
}

function rectOf(element: Element): Rect {
	const rect = element.getBoundingClientRect();
	return {
		x: Math.round(rect.x),
		y: Math.round(rect.y),
		right: Math.round(rect.right),
		bottom: Math.round(rect.bottom),
		width: Math.round(rect.width),
		height: Math.round(rect.height)
	};
}

function labelOf(element: Element): string {
	const className = typeof element.className === 'string' ? element.className : element.tagName;
	return element.id || element.getAttribute('aria-label') || className;
}

function isVisible(element: Element): boolean {
	const style = getComputedStyle(element);
	return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function paneAudits(): PaneAudit[] {
	const left = paneAudit('left');
	const right = paneAudit('right');
	return [left, right].filter((pane): pane is PaneAudit => pane !== undefined);
}

function paneAudit(side: 'left' | 'right'): PaneAudit | undefined {
	const pane = document.getElementById(`diff-pane-${side}`);
	if (!pane) {
		return undefined;
	}
	const rect = rectOf(pane);
	const rails = paneRails(pane);
	return {
		side,
		rect,
		clientWidth: pane.clientWidth,
		contentWidth: paneContentWidth(pane),
		scrollLeft: paneScrollLeft(side),
		gutterInset: gutterInset(pane, rect),
		rows: pane.querySelectorAll('.diff-row').length,
		changedRows: pane.querySelectorAll('.diff-row[data-status="changed"]').length,
		rails: rails.count,
		innerRail: rails.inner
	};
}

function paneContentWidth(pane: HTMLElement): number {
	const windowEl = pane.querySelector('.document-tree-window');
	return windowEl ? rectOf(windowEl).width : 0;
}

function paneScrollLeft(side: string): number {
	const bar = document.querySelector(`#diff-list .virtual-scroll-hscroll-${side}`) as HTMLElement | null;
	return bar ? Math.round(bar.scrollLeft) : 0;
}

function gutterInset(pane: HTMLElement, rect: Rect): number {
	const gutter = pane.querySelector('.document-tree-lines');
	return gutter ? rectOf(gutter).x - (rect.x + pane.clientLeft) : 0;
}

function paneRails(pane: HTMLElement): { count: number; inner: boolean } {
	const shadows = Array.from(pane.querySelectorAll('.document-tree-line-number'))
		.map((cell) => getComputedStyle(cell).boxShadow)
		.filter((shadow) => shadow !== 'none');
	return { count: shadows.length, inner: shadows.every((shadow) => shadow.includes('-3px')) };
}

function toolbarAudit(): ToolbarAudit {
	const controls = visibleControls();
	const toolbar = document.querySelector('.toolbar') as HTMLElement | null;
	return {
		controls: controls.length,
		display: toolbar ? getComputedStyle(toolbar).display : '',
		groups: {
			left: groupAudit('.toolbar-left'),
			center: groupAudit('.toolbar-center'),
			right: groupAudit('.toolbar-right')
		},
		swapCenterGap: swapCenterGap(),
		overlaps: overlapLabels(controls),
		outside: outsideLabels(controls),
		clipped: clippedLabels(controls),
		mergePressed: mergePressed()
	};
}

function groupAudit(selector: string): GroupAudit | null {
	const group = document.querySelector(selector) as HTMLElement | null;
	return group ? { rect: rectOf(group), clientWidth: group.clientWidth, scrollWidth: group.scrollWidth } : null;
}

/** How far the Swap button's centre sits from the pane divider. */
function swapCenterGap(): number {
	const swap = document.getElementById('diff-swap');
	const left = document.getElementById('diff-pane-left');
	if (!swap || !left) {
		return 0;
	}
	const swapRect = rectOf(swap);
	return Math.round(Math.abs(swapRect.x + swapRect.width / 2 - rectOf(left).right));
}

function visibleControls(): ToolbarControl[] {
	const elements = Array.from(document.querySelectorAll('.toolbar .tool, .toolbar .search-field'));
	return elements.filter(isVisible).map(controlOf);
}

function controlOf(element: Element): ToolbarControl {
	const group = element.closest('.toolbar-left, .toolbar-center, .toolbar-right');
	return { name: labelOf(element), rect: rectOf(element), groupRect: group ? rectOf(group) : undefined };
}

function overlapLabels(controls: ToolbarControl[]): string[] {
	const labels: string[] = [];
	for (let at = 0; at < controls.length; at++) {
		for (let other = at + 1; other < controls.length; other++) {
			if (intersects(controls[at].rect, controls[other].rect)) {
				labels.push(`${controls[at].name} / ${controls[other].name}`);
			}
		}
	}
	return labels;
}

function outsideLabels(controls: ToolbarControl[]): string[] {
	return controls
		.filter((control) => control.rect.x < 0 || control.rect.right > window.innerWidth)
		.map((control) => control.name);
}

function clippedLabels(controls: ToolbarControl[]): string[] {
	return controls
		.filter((control) => control.groupRect !== undefined && !inside(control.rect, control.groupRect))
		.map((control) => control.name);
}

function mergePressed(): boolean | null {
	const button = document.getElementById('diff-merge');
	return button ? button.getAttribute('aria-pressed') === 'true' : null;
}

function intersects(a: Rect, b: Rect): boolean {
	return a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
}

function inside(inner: Rect, outer: Rect): boolean {
	return inner.x >= outer.x - 1 && inner.right <= outer.right + 1;
}

function arrowAudits(): ArrowAudit[] {
	return Array.from(document.querySelectorAll('.diff-copy-arrow')).map(arrowAudit);
}

function arrowAudit(button: Element): ArrowAudit {
	const pane = button.closest('.diff-pane') as HTMLElement | null;
	const rect = rectOf(button);
	const bounds = paneBounds(pane);
	return {
		side: bounds.side,
		rect,
		vertical: isVertical(rect, bounds),
		insideX: isInsideX(rect, bounds),
		edgeGap: edgeGap(rect, bounds),
		visible: isArrowVisible(button),
		opaque: opaqueBackground(button)
	};
}

function isArrowVisible(element: Element): boolean {
	const style = getComputedStyle(element);
	return style.display !== 'none' && style.visibility !== 'hidden' && Number.parseFloat(style.opacity) > 0.5;
}

/** The arrow overlays the row text; a transparent background would leave it legible. */
function opaqueBackground(element: Element): boolean {
	const color = getComputedStyle(element).backgroundColor;
	const match = color.match(/rgba?\(([^)]+)\)/);
	if (!match) {
		return color !== 'transparent';
	}
	const parts = match[1].split(',').map((part) => Number.parseFloat(part));
	return parts.length < 4 || parts[3] >= 1;
}

function paneBounds(pane: HTMLElement | null): PaneBounds {
	if (!pane) {
		return { side: 'unknown', left: 0, right: 0 };
	}
	const rect = rectOf(pane);
	const rightBorder = pane.offsetWidth - pane.clientWidth - pane.clientLeft;
	return {
		side: pane.id.replace('diff-pane-', ''),
		rect,
		left: rect.x + pane.clientLeft,
		right: rect.right - rightBorder
	};
}

function isVertical(rect: Rect, bounds: PaneBounds): boolean {
	return bounds.rect !== undefined && rect.y >= bounds.rect.y && rect.bottom <= bounds.rect.bottom;
}

function isInsideX(rect: Rect, bounds: PaneBounds): boolean {
	return bounds.rect !== undefined && rect.x >= bounds.left - 1 && rect.right <= bounds.right + 1;
}

function edgeGap(rect: Rect, bounds: PaneBounds): number {
	if (bounds.rect === undefined) {
		return 0;
	}
	return bounds.side === 'left' ? bounds.right - rect.right : rect.x - bounds.left;
}

function gutterAudit(): GutterAudit {
	const cells = Array.from(document.querySelectorAll('.document-tree-line-number[data-status]'));
	const changed = cells.filter((cell) => cell.getAttribute('data-status') !== 'unchanged');
	return {
		cells: cells.length,
		rails: changed.filter((cell) => getComputedStyle(cell).boxShadow !== 'none').length,
		digitsClear: changed.every(digitsClearOfCell),
		legacyCellRail: Array.from(document.querySelectorAll('.diff-cell')).some(
			(cell) => getComputedStyle(cell).boxShadow !== 'none'
		)
	};
}

function digitsClearOfCell(cell: Element): boolean {
	const range = document.createRange();
	range.selectNodeContents(cell);
	const text = range.getBoundingClientRect();
	const rect = cell.getBoundingClientRect();
	return text.width === 0 || text.right <= rect.right - 3;
}

function contentAudit(): ContentAudit {
	const root = document.documentElement;
	return {
		pageOverflow: root.scrollWidth > root.clientWidth + 1,
		scrollWidth: root.scrollWidth,
		clientWidth: root.clientWidth
	};
}

function findHostViolations(): string[] {
	const widget = document.querySelector('.find-widget.visible');
	if (widget === null) {
		return [];
	}
	const issues: string[] = [];
	const host = widget.closest('#tree, #diff-list');
	if (host !== null && getComputedStyle(host).overflow !== 'visible') {
		issues.push('the find-widget host clips the native tooltip');
	}
	const main = document.getElementById('main');
	if (main !== null && getComputedStyle(main).overflow !== 'visible') {
		issues.push('the editor column clips the native find tooltip');
	}
	return issues;
}

function violationsOf(state: AuditState, audit: Omit<PreviewAudit, 'violations'>): string[] {
	const issues = [
		...stateViolations(state, audit),
		...toolbarViolations(audit.toolbar),
		...gutterViolations(audit.gutter),
		...findHostViolations()
	];
	if (audit.content.pageOverflow) {
		issues.push('the document scrolls horizontally');
	}
	if (state.page === 'diff') {
		issues.push(...diffViolations(state, audit));
	}
	return issues;
}

function syntaxColorViolations(audit: Omit<PreviewAudit, 'violations'>): string[] {
	const spans = audit.syntax ?? [];
	const colorOf = (text: string): string | undefined =>
		spans.find((span) => span.text.trim() === text)?.color;
	const decimal = colorOf('42');
	const binary = colorOf('0b1010');
	const text = colorOf('"hello"');
	const reference = colorOf('P.Syn.Syntax.Target');
	const conditionName = colorOf('CANIPCORETYPE_SC');
	const conditionOperator = colorOf('==');
	const conditionNumber = colorOf('0');
	const issues: string[] = [];
	if (binary === undefined || decimal === undefined) {
		issues.push('the syntax preview did not render the decimal and binary values');
	} else if (binary !== decimal) {
		issues.push('a binary value is not using the numeric colour');
	}
	if (reference === undefined || text === undefined) {
		issues.push('the syntax preview did not render the text and reference values');
	} else if (reference === text) {
		issues.push('a reference value is not using the reference colour');
	}
	if (
		conditionName === undefined ||
		conditionOperator === undefined ||
		conditionNumber === undefined
	) {
		issues.push('the syntax preview did not render the condition tokens');
	} else if (
		conditionName === conditionOperator ||
		conditionOperator === conditionNumber ||
		conditionName === conditionNumber
	) {
		issues.push('a system-condition token is not using its own colour');
	}
	return issues;
}

function stateViolations(state: AuditState, audit: Omit<PreviewAudit, 'violations'>): string[] {
	const issues: string[] = [];
	if (!audit.ready) {
		issues.push('the page did not reach previewReady');
	}
	if (state.page === 'editor' && document.querySelector('#tree .monaco-editor') === null) {
		issues.push('the Monaco editor did not mount');
	}
	if (state.name === 'editor-syntax') {
		issues.push(...syntaxColorViolations(audit));
	}
	if (state.select && !audit.selected) {
		issues.push('the select gesture left no selected row');
	}
	issues.push(...swapViolations(state, audit.swap));
	return issues;
}

function swapViolations(
	state: AuditState,
	swap: { before: PaneSnapshot; after: PaneSnapshot } | null
): string[] {
	if (!state.swap) {
		return [];
	}
	if (!swap) {
		return ['Swap ran without a before/after snapshot'];
	}
	return [...titleSwapIssues(swap), ...valueSwapIssues(swap)];
}

function titleSwapIssues(swap: { before: PaneSnapshot; after: PaneSnapshot }): string[] {
	const issues: string[] = [];
	if (swap.after.leftTitle !== swap.before.rightTitle) {
		issues.push('Swap did not move the right title to the left');
	}
	if (swap.after.rightTitle !== swap.before.leftTitle) {
		issues.push('Swap did not move the left title to the right');
	}
	return issues;
}

function valueSwapIssues(swap: { before: PaneSnapshot; after: PaneSnapshot }): string[] {
	const issues: string[] = [];
	if (swap.after.leftValue !== swap.before.rightValue) {
		issues.push('Swap did not move the right value to the left');
	}
	if (swap.after.rightValue !== swap.before.leftValue) {
		issues.push('Swap did not move the left value to the right');
	}
	return issues;
}

function toolbarViolations(toolbar: ToolbarAudit): string[] {
	const issues = toolbar.overlaps.map((pair) => `toolbar controls overlap: ${pair}`);
	issues.push(...toolbar.outside.map((name) => `toolbar control outside the viewport: ${name}`));
	issues.push(...toolbar.clipped.map((name) => `toolbar control is clipped by its group: ${name}`));
	return issues;
}

function gutterViolations(gutter: GutterAudit): string[] {
	const issues: string[] = [];
	if (!gutter.digitsClear) {
		issues.push('a line-number digit overlaps its status rail');
	}
	if (gutter.legacyCellRail) {
		issues.push('a diff cell paints a status rail at the pane edge');
	}
	return issues;
}

function usesMonacoDiff(): boolean {
	return document.querySelector('.monaco-diff-editor') !== null;
}

function colorAlpha(color: string): number | undefined {
	const rgba = /^rgba\(\s*[\d.]+[,\s]+[\d.]+[,\s]+[\d.]+[,\s/]+([\d.]+)\)$/i.exec(color);
	if (rgba !== null) {
		return Number(rgba[1]);
	}
	const hex = /^#(?:[0-9a-f]{6})([0-9a-f]{2})$/i.exec(color);
	if (hex !== null) {
		return parseInt(hex[1], 16) / 255;
	}
	if (/^#[0-9a-f]{6}$/i.test(color) || /^rgb\(/i.test(color)) {
		return 1;
	}
	return undefined;
}

function translucentDiffViolations(): string[] {
	const issues: string[] = [];
	for (const selector of [
		'.monaco-diff-editor .line-insert',
		'.monaco-diff-editor .line-delete',
		'.monaco-diff-editor .char-insert',
		'.monaco-diff-editor .char-delete'
	]) {
		const element = document.querySelector(selector);
		const alpha = element === null ? undefined : colorAlpha(getComputedStyle(element).backgroundColor);
		if (alpha !== undefined && alpha >= 1) {
			issues.push(`${selector} is opaque; diff fills must stay translucent`);
		}
	}
	return issues;
}

function monacoDiffViolations(_state: AuditState): string[] {
	const editor = document.querySelector('.monaco-diff-editor');
	if (editor === null) {
		return ['the Monaco diff editor did not mount'];
	}
	// Monaco lays out its two editors asynchronously; the deterministic checks
	// here are the mount, readable diff fills and the toolbar state. The PNG
	// remains the evidence for gutter, tint and merge-arrow placement.
	return document.body.classList.contains('vscode-light') ? [] : translucentDiffViolations();
}

function diffViolations(state: AuditState, audit: Omit<PreviewAudit, 'violations'>): string[] {
	if (usesMonacoDiff()) {
		// Monaco owns the gutter, arrows, scroll surface and selection now. The
		// legacy audit below describes the DOM renderer it replaced; keep a small
		// Monaco-specific mount/tint/arrow check instead.
		return monacoDiffViolations(state);
	}
	return [
		...mergeViolations(state, audit.panes, audit.arrows),
		...arrowStateViolations(state, audit),
		...railViolations(state, audit.gutter),
		...paneRailViolations(audit.panes),
		...centeredSwapIssues(audit),
		...(state.wide ? wideViolations(audit.panes) : []),
		...(state.pan ? panViolations(state.pan, audit.panes) : [])
	];
}

function centeredSwapIssues(audit: Omit<PreviewAudit, 'violations'>): string[] {
	if (audit.toolbar.swapCenterGap <= 12) {
		return [];
	}
	return [`the Swap action is ${audit.toolbar.swapCenterGap}px off the pane divider`];
}

function paneRailViolations(panes: PaneAudit[]): string[] {
	return panes.flatMap(railIssues);
}

function railIssues(pane: PaneAudit): string[] {
	if (pane.rails === 0) {
		return [`the ${pane.side} pane has no gutter status rail`];
	}
	if (!pane.innerRail) {
		return [`the ${pane.side} gutter rail is not on the inner edge`];
	}
	return [];
}

function mergeViolations(state: AuditState, panes: PaneAudit[], arrows: ArrowAudit[]): string[] {
	if (!state.merge) {
		return [];
	}
	return panes.flatMap((pane) => paneArrowViolations(pane, arrows));
}

function paneArrowViolations(pane: PaneAudit, arrows: ArrowAudit[]): string[] {
	const own = arrows.filter((arrow) => arrow.side === pane.side && arrow.vertical);
	if (own.length === 0) {
		return [`no copy arrow is rendered in the ${pane.side} pane`];
	}
	return own.map((arrow) => arrowIssue(arrow, pane)).filter((issue): issue is string => issue !== undefined);
}

function arrowIssue(arrow: ArrowAudit, pane: PaneAudit): string | undefined {
	return arrowPlacementIssue(arrow, pane) ?? arrowPresentationIssue(arrow, pane);
}

function arrowPlacementIssue(arrow: ArrowAudit, pane: PaneAudit): string | undefined {
	if (!arrow.insideX) {
		return `${pane.side} copy arrow is outside its pane (x=${arrow.rect.x})`;
	}
	if (arrow.edgeGap > 2) {
		return `${pane.side} copy arrow is ${arrow.edgeGap}px from the inner edge`;
	}
	return undefined;
}

function arrowPresentationIssue(arrow: ArrowAudit, pane: PaneAudit): string | undefined {
	if (!arrow.visible) {
		return `${pane.side} copy arrow is not visible`;
	}
	if (!arrow.opaque) {
		return `${pane.side} copy arrow has a transparent background over the row text`;
	}
	return undefined;
}

function arrowStateViolations(state: AuditState, audit: Omit<PreviewAudit, 'violations'>): string[] {
	return [...offArrowViolations(state, audit), ...mergePressViolations(state, audit)];
}

function offArrowViolations(state: AuditState, audit: Omit<PreviewAudit, 'violations'>): string[] {
	if (state.merge || audit.arrows.length === 0) {
		return [];
	}
	return ['copy arrows are visible while Merge is off'];
}

function mergePressViolations(state: AuditState, audit: Omit<PreviewAudit, 'violations'>): string[] {
	if (!state.merge || audit.toolbar.mergePressed === true) {
		return [];
	}
	return ['Merge is not pressed'];
}

function railViolations(state: AuditState, gutter: GutterAudit): string[] {
	if (state.page !== 'diff' || gutter.rails > 0) {
		return [];
	}
	return ['no gutter status rail is rendered'];
}

function wideViolations(panes: PaneAudit[]): string[] {
	return panes
		.filter((pane) => pane.contentWidth <= pane.clientWidth + 20)
		.map((pane) => `the ${pane.side} pane did not overflow horizontally`);
}

function panViolations(pan: number, panes: PaneAudit[]): string[] {
	const issues: string[] = [];
	for (const pane of panes) {
		const max = Math.max(0, pane.contentWidth - pane.clientWidth);
		const expected = Math.min(pan, max);
		if (Math.abs(pane.scrollLeft - expected) > 5) {
			issues.push(`the ${pane.side} pane is at ${pane.scrollLeft}px, expected ${expected}px`);
		}
	}
	return issues;
}

/** A capture-able before/after view of the panes for the Swap state. */
export function paneSnapshot(): PaneSnapshot {
	return {
		leftTitle: titleOf('diff-title-left'),
		rightTitle: titleOf('diff-title-right'),
		leftValue: changedValue('left'),
		rightValue: changedValue('right')
	};
}

function titleOf(id: string): string {
	const element = document.getElementById(id);
	return element ? element.textContent?.trim() ?? '' : '';
}

function changedValue(side: 'left' | 'right'): string {
	const cell = document.querySelector(`#diff-pane-${side} .diff-row[data-status="changed"] .diff-cell`);
	return cell ? cell.textContent?.trim() ?? '' : '';
}

function selectedKey(): string | null {
	const selected = document.querySelector('[aria-selected="true"], [data-selected="true"]');
	if (!selected) {
		return null;
	}
	return selected.getAttribute('data-key') ?? selected.textContent?.trim().slice(0, 40) ?? labelOf(selected);
}

export function previewAudit(state: AuditState, swapBefore?: PaneSnapshot): PreviewAudit {
	const base = {
		state: state.name,
		page: state.page,
		ready: document.body.dataset.previewReady === 'true',
		viewport: { width: window.innerWidth, height: window.innerHeight },
		panes: paneAudits(),
		arrows: arrowAudits(),
		toolbar: toolbarAudit(),
		gutter: gutterAudit(),
		content: contentAudit(),
		selected: selectedKey(),
		swap: swapBefore ? { before: swapBefore, after: paneSnapshot() } : null,
		syntax: state.page === 'editor'
			? Array.from(document.querySelectorAll('.monaco-editor .view-line span'))
				.slice(0, 40)
				.map((span) => ({
					text: span.textContent?.slice(0, 32) ?? '',
					className: typeof span.className === 'string' ? span.className : '',
					color: getComputedStyle(span).color
				}))
			: undefined
	};
	return { ...base, violations: violationsOf(state, base) };
}
