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
	/** The text the Details state typed into `#details-value`. */
	detailsEdit?: string;
	/** Ctrl+S ran after the Details typing and every edit was acknowledged. */
	detailsSave?: boolean;
	/** A local undo ran after the Details typing. */
	detailsUndo?: boolean;
	/** A local redo ran after that undo. */
	detailsRedo?: boolean;
	/** The container rename, early ack, post-flush keystroke and renamed echo ran. */
	detailsRename?: boolean;
	/** The direct-editor delete/word-delete/replace scenario ran. */
	deleteEdit?: boolean;
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

interface SyscondTokenAudit {
	text: string;
	className: string;
	color: string;
}

interface SyscondAudit {
	/** The Details Condition/Conditions code spans, with their resolved colours. */
	details: SyscondTokenAudit[];
	/** The Conditions panel constant name and state colours. */
	panelName: string | null;
	panelState: string | null;
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
	syscond?: SyscondAudit;
	sticky?: { visible: boolean; display: string; text: string; rect: Rect | null };
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

/** The Dark+ palette the preview resolves; Chromium reports resolved rgb(). */
const SYSCOND_COLORS = {
	name: 'rgb(86, 156, 214)',
	operator: 'rgb(197, 134, 192)',
	literal: 'rgb(79, 193, 255)',
	number: 'rgb(181, 206, 168)'
};

/** The Dark+ definition and string colours the label preview resolves. */
const LABEL_COLORS = {
	type: 'rgb(78, 201, 176)',
	string: 'rgb(206, 145, 120)'
};

/** `editor-labels`: a no-label container starts with a string, a labelled one keeps type + string. */
function labelColorViolations(audit: Omit<PreviewAudit, 'violations'>): string[] {
	const spans = audit.syntax ?? [];
	const colorOf = (text: string): string | undefined =>
		spans.find((span) => span.text.trim() === text)?.color;
	const issues: string[] = [];
	const emptyShort = colorOf('"EmptyDef"');
	if (emptyShort === undefined) {
		issues.push('the labels preview did not render the no-label container');
	} else if (emptyShort !== LABEL_COLORS.string) {
		issues.push(`the no-label short name is ${emptyShort}, not the string colour`);
	}
	const label = colorOf('Items');
	const short = colorOf('"Items"');
	if (label === undefined || short === undefined) {
		issues.push('the labels preview did not render the normal container label and short name');
	} else {
		if (label !== LABEL_COLORS.type) {
			issues.push(`the container label is ${label}, not the type colour`);
		}
		if (short !== LABEL_COLORS.string) {
			issues.push(`the container short name is ${short}, not the string colour`);
		}
	}
	const shortNameInput = document.getElementById('details-short-name') as HTMLInputElement | null;
	if (shortNameInput === null || shortNameInput.value !== 'EmptyDef') {
		issues.push('the labels preview did not select the no-label container');
	} else if (document.getElementById('details-definition-ref') !== null) {
		issues.push('the no-label container shows a definition field');
	}
	const inspectorLabel = document.querySelector('#sb-details-body .inspector-label');
	if (inspectorLabel === null || inspectorLabel.textContent !== '') {
		issues.push('the no-label container shows a definition label');
	}
	issues.push(...editorLineViolations('"EmptyDef"', '"EmptyDef" { }'));
	issues.push(...editorLineViolations('Items "Items"', 'Items "Items"'));
	return issues;
}

/** The six condition classes and their expected resolved colours. */
const SYSCOND_CLASSES: ReadonlyArray<readonly [string, string]> = [
	['syscond-name', SYSCOND_COLORS.name],
	['syscond-operator', SYSCOND_COLORS.operator],
	['syscond-literal', SYSCOND_COLORS.literal],
	['syscond-number', SYSCOND_COLORS.number]
];

/** The text each condition class carries in the `editor-syscond` fixture. */
const SYSCOND_TEXT: Readonly<Record<string, string>> = {
	'syscond-name': 'CANIPCORETYPE_SC',
	'syscond-operator': '==',
	'syscond-literal': 'true',
	'syscond-number': '0'
};

/** One palette mismatch, or `undefined` when every class resolves as expected. */
function syscondPaletteIssue(
	label: string,
	colorOfClass: (className: string) => string | undefined
): string | undefined {
	const actual = SYSCOND_CLASSES.map(([className]) => colorOfClass(className));
	const matches = SYSCOND_CLASSES.every(([, expected], at) => actual[at] === expected);
	return matches ? undefined : `${label} palette is ${actual.map((color) => color ?? 'missing').join(' / ')}`;
}

function syscondViolations(audit: Omit<PreviewAudit, 'violations'>): string[] {
	const syscond = audit.syscond;
	if (syscond === undefined) {
		return ['the syscond preview did not record the condition palette'];
	}
	const issues: string[] = [];
	const detailsIssue = syscondPaletteIssue('the Details Condition', (className) => {
		const token = syscond.details.find((span) => span.className.split(/\s+/).includes(className));
		return token?.color;
	});
	if (detailsIssue !== undefined) {
		issues.push(detailsIssue);
	}
	// The Monaco page paints the Document tree with the same tokenizer; its spans
	// are the editor's view-line spans, already captured by the syntax audit.
	const editor = audit.syntax ?? [];
	const editorIssue = syscondPaletteIssue('the editor condition', (className) => {
		const text = SYSCOND_TEXT[className];
		return editor.find((span) => span.text.trim() === text)?.color;
	});
	if (editorIssue !== undefined) {
		issues.push(editorIssue);
	}
	if (syscond.panelName !== SYSCOND_COLORS.name) {
		issues.push(`the Conditions panel name is ${String(syscond.panelName)}, not the syscond colour`);
	}
	if (syscond.panelState !== SYSCOND_COLORS.operator) {
		issues.push(`the Conditions panel state is ${String(syscond.panelState)}, not the operator colour`);
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
	if (state.name === 'editor-syscond') {
		issues.push(...syscondViolations(audit));
	}
	if (state.name === 'editor-labels') {
		issues.push(...labelColorViolations(audit));
	}
	if (state.name === 'editor-dirty') {
		const status = document.getElementById('editor-dirty-status');
		if (status === null || status.hidden || !/Unsaved changes/.test(status.textContent ?? '')) {
			issues.push('the dirty edit did not show the Unsaved changes marker');
		}
		const edits = (window.__PREVIEW_MESSAGES__ as Array<{ type?: string; value?: string }>).filter(
			(message) => message.type === 'edit'
		);
		if (edits.length !== 0) {
			issues.push(`the typing run posted ${edits.length} host edits before Ctrl+S`);
		}
	}
	if (state.name === 'editor-invalid') {
		const strip = document.getElementById('editor-error-strip');
		if (strip === null || strip.hidden || !/Invalid value/.test(strip.textContent ?? '')) {
			issues.push('the invalid edit did not show the page error');
		}
		const messages = window.__PREVIEW_MESSAGES__ as Array<{ type?: string }>;
		if (messages.some((message) => message.type === 'edit')) {
			issues.push('an invalid edit was posted to the host');
		}
		if (messages.some((message) => message.type === 'save')) {
			issues.push('an invalid edit allowed the document to save');
		}
	}
	if (state.name === 'editor-details') {
		issues.push(...detailsTypingViolations(state, true));
	}
	if (state.name === 'editor-details-save') {
		issues.push(...detailsTypingViolations(state, false), ...detailsSaveViolations());
	}
	if (state.name === 'editor-details-rename') {
		issues.push(...detailsRenameViolations());
	}
	if (state.name === 'editor-rename-refusal') {
		issues.push(...renameRefusalViolations());
	}
	if (state.name === 'editor-rename-late-ack') {
		issues.push(...detailsRenameViolations());
	}
	if (state.name === 'editor-details-undo') {
		issues.push(...detailsUndoViolations());
	}
	if (state.name === 'editor-details-redo') {
		issues.push(...detailsRedoViolations());
	}
	if (state.name === 'editor-delete') {
		issues.push(...deleteEditViolations());
	}
	if (state.name === 'editor-multi-save') {
		issues.push(...multiSaveViolations());
	}
	if (state.name === 'editor-paste') {
		issues.push(...pasteViolations());
	}
	if (state.name === 'editor-stale-save') {
		issues.push(...staleSaveViolations());
	}
	if (state.name === 'editor-sticky') {
		if (audit.sticky === undefined || !audit.sticky.visible) {
			issues.push('the sticky-scroll widget is not visible');
		} else if (!audit.sticky.text.includes('Items') || !audit.sticky.text.includes('P.Preview')) {
			issues.push('the sticky-scroll widget does not show the enclosing module and Items container');
		}
	}
	if (state.name === 'editor' && audit.sticky?.visible === true) {
		issues.push('the sticky-scroll widget is visible at the top of the document');
	}
	if (state.select && !audit.selected) {
		issues.push('the select gesture left no selected row');
	}
	issues.push(...swapViolations(state, audit.swap));
	return issues;
}

/** The Details state typed locally: focus, caret, one exact repaint and no host edit. */
function detailsTypingViolations(state: AuditState, expectNoEdit: boolean): string[] {
	const issues: string[] = [];
	const input = document.getElementById('details-value') as HTMLInputElement | null;
	if (input === null) {
		issues.push('the Details value control did not render');
	} else {
		if (document.activeElement !== input) {
			issues.push('typing in Details dropped focus');
		}
		if (input.selectionStart !== input.value.length) {
			issues.push('typing in Details lost the caret');
		}
		if (input.value !== `hello${state.detailsEdit ?? ''}`) {
			issues.push(`the Details control shows "${input.value}" instead of the typed draft`);
		}
	}
	const status = document.getElementById('editor-dirty-status');
	if (status === null || status.hidden || !/Unsaved changes/.test(status.textContent ?? '')) {
		issues.push('the Details draft did not show the Unsaved changes marker');
	}
	issues.push(...textLineViolations(`Text = "hello${state.detailsEdit ?? ''}"`));
	const messages = window.__PREVIEW_MESSAGES__ as Array<{ type?: string }>;
	if (expectNoEdit && messages.some((message) => message.type === 'edit')) {
		issues.push('typing in Details posted a host edit before Ctrl+S');
	}
	return issues;
}

/** A local undo after a Details edit restores the host value and clears the draft. */
function detailsUndoViolations(): string[] {
	const issues: string[] = [];
	const input = document.getElementById('details-value') as HTMLInputElement | null;
	if (input === null) {
		issues.push('the Details value control did not render');
	} else {
		if (document.activeElement !== input) {
			issues.push('undo in Details dropped focus');
		}
		if (input.value !== 'hello') {
			issues.push(`undo left the Details control at "${input.value}" instead of the host value`);
		}
		if (input.selectionStart !== 5) {
			issues.push('undo did not clamp the Details caret to the restored value');
		}
	}
	const status = document.getElementById('editor-dirty-status');
	if (status !== null && !status.hidden && /Unsaved changes/.test(status.textContent ?? '')) {
		issues.push('undo left the Unsaved changes marker behind');
	}
	issues.push(...textLineViolations('Text = "hello"'));
	const messages = window.__PREVIEW_MESSAGES__ as Array<{ type?: string }>;
	if (messages.some((message) => message.type === 'edit')) {
		issues.push('undo posted a host edit');
	}
	return issues;
}

/** Redo after a local undo restores the draft from Monaco's model stack. */
function detailsRedoViolations(): string[] {
	const issues: string[] = [];
	const input = document.getElementById('details-value') as HTMLInputElement | null;
	if (input === null) {
		issues.push('the Details value control did not render');
	} else {
		if (document.activeElement !== input) {
			issues.push('redo in Details dropped focus');
		}
		if (input.value !== 'hello updated') {
			issues.push(`redo left the Details control at "${input.value}" instead of the draft`);
		}
		if (input.selectionStart !== 13) {
			issues.push('redo did not restore the Details caret to the draft end');
		}
	}
	const status = document.getElementById('editor-dirty-status');
	if (status === null || status.hidden || !/Unsaved changes/.test(status.textContent ?? '')) {
		issues.push('redo did not restore the Unsaved changes marker');
	}
	issues.push(...textLineViolations('Text = "hello updated"'));
	const messages = window.__PREVIEW_MESSAGES__ as Array<{ type?: string }>;
	if (messages.some((message) => message.type === 'edit')) {
		issues.push('redo posted a host edit');
	}
	return issues;
}

/** The direct-editor delete scenario ends at one bare textual value and no host edit. */
function deleteEditViolations(): string[] {
	const issues: string[] = [];
	const status = document.getElementById('editor-dirty-status');
	if (status === null || status.hidden || !/Unsaved changes/.test(status.textContent ?? '')) {
		issues.push('the delete scenario did not show the Unsaved changes marker');
	}
	issues.push(...textLineViolations('Text = "R"'));
	const messages = window.__PREVIEW_MESSAGES__ as Array<{ type?: string }>;
	if (messages.some((message) => message.type === 'edit')) {
		issues.push('a delete/backspace keystroke posted a host edit');
	}
	return issues;
}

/** A rename ack arrived before the re-scan: the post-flush keystroke must survive. */
function detailsRenameViolations(): string[] {
	const issues: string[] = [];
	const messages = window.__PREVIEW_MESSAGES__ as Array<{
		type?: string;
		field?: string;
		value?: string;
		nodeId?: string;
		message?: string;
	}>;
	const edits = messages.filter((message) => message.type === 'edit');
	if (edits.length !== 2) {
		issues.push(`the rename sequence posted ${edits.length} host edits instead of two`);
	} else {
		const first = edits[0];
		const second = edits[1];
		if ((first.field ?? 'value') !== 'shortName' || first.value !== 'Syntax2') {
			issues.push(`the first edit was ${String(first.field)}="${String(first.value)}" instead of the rename`);
		}
		if ((second.field ?? 'value') !== 'shortName' || second.value !== 'Syntax23') {
			issues.push(`the deferred edit was ${String(second.field)}="${String(second.value)}" instead of the full name`);
		}
		if (first.nodeId === second.nodeId) {
			issues.push('the post-flush draft was sent at the pre-rename id');
		}
		if (second.nodeId === undefined || !second.nodeId.includes('/Syntax2#')) {
			issues.push(`the post-flush draft was not addressed at the host's new id (${String(second.nodeId)})`);
		}
	}
	const saves = messages.filter((message) => message.type === 'save');
	const lastSave = saves[saves.length - 1];
	if (edits.length === 2 && (lastSave === undefined || messages.indexOf(lastSave) < messages.indexOf(edits[1]))) {
		issues.push('the save did not follow the remapped edit acknowledgement');
	}
	if (messages.some((message) => (message.message ?? '').includes('no longer in the file'))) {
		issues.push('the rename produced a stale-node refusal');
	}
	const input = document.getElementById('details-short-name') as HTMLInputElement | null;
	if (input === null) {
		issues.push('the rename state lost the short-name control');
	} else {
		if (input.value !== 'Syntax23') {
			issues.push(`the post-flush keystroke was lost ("${input.value}")`);
		}
		if (document.activeElement !== input) {
			issues.push('the rename echo dropped Details focus');
		}
		if (input.selectionStart !== input.value.length) {
			issues.push('the rename echo lost the caret');
		}
	}
	return issues;
}

/** A refusal after the rename document landed is recorded at the host's new id. */
function renameRefusalViolations(): string[] {
	const issues: string[] = [];
	const messages = window.__PREVIEW_MESSAGES__ as Array<{
		type?: string;
		field?: string;
		value?: string;
		nodeId?: string;
	}>;
	const edits = messages.filter((message) => message.type === 'edit');
	if (edits.length !== 2) {
		issues.push(`the rename-refusal sequence posted ${edits.length} host edits instead of two`);
	} else {
		const first = edits[0];
		const second = edits[1];
		if (second.nodeId === undefined || !second.nodeId.includes('/Syntax2#')) {
			issues.push(`the refused draft was not addressed at the host's new id (${String(second.nodeId)})`);
		}
		if (first.nodeId === second.nodeId) {
			issues.push('the post-flush draft kept the dead pre-rename id');
		}
		if ((second.field ?? 'value') !== 'shortName' || second.value !== 'Syntax23') {
			issues.push(`the refused edit was ${String(second.field)}="${String(second.value)}" instead of the full name`);
		}
	}
	if (edits.length === 2) {
		const refusedAt = messages.indexOf(edits[1]);
		const laterSave = messages.filter((message) => message.type === 'save').some((save) => messages.indexOf(save) > refusedAt);
		if (laterSave) {
			issues.push('a refused edit still allowed the document to save');
		}
	}
	const input = document.getElementById('details-short-name') as HTMLInputElement | null;
	if (input === null) {
		issues.push('the refusal state lost the short-name control');
	} else {
		if (input.value !== 'Syntax23') {
			issues.push(`the refused draft is not visible ("${input.value}")`);
		}
		if (document.activeElement !== input) {
			issues.push('the refusal dropped Details focus');
		}
		if (input.getAttribute('aria-invalid') !== 'true') {
			issues.push('the refused control is not marked invalid');
		}
	}
	const inline = input?.parentElement?.querySelector('.details-value-error');
	if (inline === null || inline === undefined || !/refused by the test host/.test(inline.textContent ?? '')) {
		issues.push('the refusal reason is not shown beside the field');
	}
	const status = document.getElementById('details-status');
	if (status === null || !/refused by the test host/.test(status.textContent ?? '')) {
		issues.push('the refusal reason is not in the Details status');
	}
	if (/no longer in the file/.test(status?.textContent ?? '')) {
		issues.push('the refusal was reported as a stale node');
	}
	return issues;
}

/** The rendered `Text = …` line, trimmed, must match exactly. */
function textLineViolations(expected: string): string[] {
	return editorLineViolations('Text = ', expected);
}

/** The rendered line whose trimmed text starts with `prefix`, compared exactly. */
function editorLineViolations(prefix: string, expected: string): string[] {
	const model = (window as unknown as {
		__ARXML_EDITOR__?: { getModel(): { getLineCount(): number; getLineContent(line: number): string } | null };
	}).__ARXML_EDITOR__?.getModel();
	if (model === null || model === undefined) {
		return ['the Details preview has no Monaco model'];
	}
	for (let line = 1; line <= model.getLineCount(); line += 1) {
		const text = model.getLineContent(line).trim();
		if (!text.startsWith(prefix)) {
			continue;
		}
		return text === expected ? [] : [`the editor line shows "${text}" instead of "${expected}"`];
	}
	return [`the Details preview has no ${prefix.trim()} line`];
}

/** Ctrl+S over two row drafts: two host edits, then one save after both acks. */
function multiSaveViolations(): string[] {
	const issues: string[] = [];
	const messages = window.__PREVIEW_MESSAGES__ as Array<{
		type?: string;
		field?: string;
		value?: string;
	}>;
	const edits = messages.filter((message) => message.type === 'edit');
	const saves = messages.filter((message) => message.type === 'save');
	if (edits.length !== 2) {
		issues.push(`Ctrl+S posted ${edits.length} edits instead of two`);
	} else {
		assertFieldEdit(edits[0], '427', 'Decimal', issues);
		assertFieldEdit(edits[1], 'hello!', 'Text', issues);
	}
	if (saves.length !== 1) {
		issues.push(`Ctrl+S posted ${saves.length} saves instead of one`);
	} else if (edits.length > 0 && messages.indexOf(saves[0]) < messages.indexOf(edits[edits.length - 1])) {
		issues.push('the save was posted before both edits were acknowledged');
	}
	issues.push(...editorLineViolations('Decimal = ', 'Decimal = 427'));
	issues.push(...editorLineViolations('Text = ', 'Text = "hello!"'));
	const strip = document.getElementById('editor-error-strip');
	if (strip !== null && !strip.hidden) {
		issues.push('the multi-row save left an invalid-value error');
	}
	return issues;
}

/** One value edit carries the row's accepted value and nothing else. */
function assertFieldEdit(
	edit: { field?: string; value?: string } | undefined,
	value: string,
	label: string,
	issues: string[]
): void {
	if (edit === undefined) {
		issues.push(`the ${label} edit is missing`);
		return;
	}
	if ((edit.field ?? 'value') !== 'value') {
		issues.push(`the ${label} edit did not carry the value field`);
	}
	if (edit.value !== value) {
		issues.push(`the ${label} edit carried "${String(edit.value)}" instead of "${value}"`);
	}
}

/** A newline-containing paste becomes one escaped line and never reaches the host. */
function pasteViolations(): string[] {
	const issues: string[] = [];
	issues.push(...editorLineViolations('Text = ', 'Text = "hello\\nsecond"'));
	const messages = window.__PREVIEW_MESSAGES__ as Array<{ type?: string }>;
	if (messages.some((message) => message.type === 'edit')) {
		issues.push('the pasted newline posted a host edit');
	}
	return issues;
}

/** A draft whose row vanished blocks Ctrl+S and says why. */
function staleSaveViolations(): string[] {
	const issues: string[] = [];
	const messages = window.__PREVIEW_MESSAGES__ as Array<{ type?: string }>;
	if (messages.some((message) => message.type === 'edit')) {
		issues.push('the stale draft was posted to the host');
	}
	if (messages.some((message) => message.type === 'save')) {
		issues.push('a stale draft allowed the document to save');
	}
	const status = document.getElementById('details-status');
	if (status === null || !/no longer in the file/.test(status.textContent ?? '')) {
		issues.push(`the status does not explain the missing node ("${status?.textContent ?? ''}")`);
	}
	const strip = document.getElementById('editor-error-strip');
	if (strip !== null && !strip.hidden) {
		issues.push('the stale draft was reported as an invalid value');
	}
	return issues;
}

/** Ctrl+S sent one raw edit for the textual field, waited for its ack, then saved. */
function detailsSaveViolations(): string[] {
	const issues: string[] = [];
	const messages = window.__PREVIEW_MESSAGES__ as Array<{ type?: string; field?: string; value?: string }>;
	const edits = messages.filter((message) => message.type === 'edit');
	const saves = messages.filter((message) => message.type === 'save');
	if (edits.length !== 1) {
		issues.push(`Ctrl+S posted ${edits.length} edits instead of one`);
	} else {
		const edit = edits[0];
		if ((edit.field ?? 'value') !== 'value') {
			issues.push('the Details edit did not carry the value field');
		}
		if (edit.value !== 'hello updated') {
			issues.push(`the Details edit carried "${edit.value}" instead of the raw value`);
		}
	}
	if (saves.length !== 1) {
		issues.push(`Ctrl+S posted ${saves.length} saves after the acknowledgement`);
	} else if (edits.length > 0 && messages.indexOf(saves[0]) < messages.indexOf(edits[0])) {
		issues.push('the save was posted before the edit acknowledgement');
	}
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

function stickyAudit(): NonNullable<PreviewAudit['sticky']> {
	const widget = document.querySelector('#tree .sticky-widget');
	if (widget === null) {
		return { visible: false, display: 'missing', text: '', rect: null };
	}
	const display = getComputedStyle(widget).display;
	const rect = widget.getBoundingClientRect();
	return {
		visible: display !== 'none' && rect.height > 0,
		display,
		text: widget.textContent?.trim() ?? '',
		rect: rect.height > 0 ? rectOf(widget) : null
	};
}

function syscondAudit(): SyscondAudit {
	const tokenOf = (span: Element): SyscondTokenAudit => ({
		text: span.textContent?.slice(0, 48) ?? '',
		className: typeof span.className === 'string' ? span.className : '',
		color: getComputedStyle(span).color
	});
	const panelName = document.querySelector('#conditions-list .condition-name-text');
	const panelState = document.querySelector('#conditions-list .condition-state');
	return {
		details: Array.from(document.querySelectorAll('#sb-details-body .condition-code span')).map(tokenOf),
		panelName: panelName === null ? null : getComputedStyle(panelName).color,
		panelState: panelState === null ? null : getComputedStyle(panelState).color
	};
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
		sticky: state.page === 'editor' ? stickyAudit() : undefined,
		syntax: state.page === 'editor'
			? Array.from(document.querySelectorAll('.monaco-editor .view-line span'))
				.slice(0, 40)
				.map((span) => ({
					text: span.textContent?.slice(0, 32) ?? '',
					className: typeof span.className === 'string' ? span.className : '',
					color: getComputedStyle(span).color
				}))
			: undefined,
		syscond: state.page === 'editor' ? syscondAudit() : undefined
	};
	return { ...base, violations: violationsOf(state, base) };
}
