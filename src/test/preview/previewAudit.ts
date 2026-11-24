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
	/** Show diff was selected after mounting; the native unchanged widgets were on. */
	view?: 'all' | 'diff';
	/** Next-diff presses; semantic navigation ran. */
	jump?: number;
	/** Prev-diff presses after the Next presses. */
	jumpBack?: number;
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

interface NativeDiffPaint {
	lineInsert: number;
	lineDelete: number;
	charInsert: number;
	charDelete: number;
	insertSigns: number;
	deleteSigns: number;
	diagonalFills: number;
}

/**
 * The built-in diff-margin arrows. Monaco renders the right arrow for a
 * left-only block; the page adds one left arrow per right-side change.
 */
interface CopyArrowAudit {
	count: number;
	/** Built-in right-pointing arrows (`codicon-arrow-right`). */
	builtIn: number;
	/** The extra copy-to-left arrows (`codicon-arrow-left`). */
	copyLeft: number;
	/** Every arrow has a painted, non-empty box. */
	visible: boolean;
	/** Every arrow sits in the modified editor's left gutter. */
	atGutter: boolean;
	/** The host copy message a clicked arrow posted. */
	copy: { side: string; key: string; direction: string; swapped: boolean } | null;
	/** The clicked arrow posted the semantic side/key for its direction. */
	copyValid: boolean;
}

/** Monaco's native diff overview, not a semantic decoration layer. */
interface NativeOverviewAudit {
	present: boolean;
}

/** Actual per-side models and built-in diff paint for the one-sided fixture. */
export interface OneSidedAudit {
	originalLines: number;
	modifiedLines: number;
	missingSideHasRemoved: boolean;
	missingSideHasAdded: boolean;
	owningSideBraces: number;
	emptyOwningLines: number;
	native: NativeDiffPaint;
	margin: CopyArrowAudit;
	customPaint: number;
	lineChanges: number;
	removedNavigable: boolean;
	addedNavigable: boolean;
}

/** The stable body contract, native paint and semantic margin for one diff page. */
export interface DiffBodyAudit {
	host: boolean;
	gutter: boolean;
	status: boolean;
	rows: number;
	statuses: { changed: number; added: number; removed: number; renamed: number };
	lineCounts: { original: number; modified: number };
	native: NativeDiffPaint;
	margin: CopyArrowAudit;
	/** Any old custom body fill/sign/word/placeholder paint left anywhere. */
	customPaint: number;
	/** Monaco's built-in diff overview. */
	overview: NativeOverviewAudit;
	/** Monaco's native hide-unchanged-region widgets and the toggle probe. */
	unchanged: {
		centers: number;
		height: number;
		labels: string[];
		unfold: number;
		handles: number;
		showDiff: number;
		showAll: number;
		restored: number;
		contextOnLines: number;
		contextOffLines: number;
		withoutContext: number;
		contextRestored: number;
	};
	/** The semantic Next/Prev target recorded by the preview page. */
	nav?: {
		history: Array<{
			key: string;
			status: string;
			order: number;
			renamed: boolean;
			side: string;
			line: number;
		}>;
		positionSide?: string;
		positionLine?: number;
		lineChangeLines: number[];
		lineChangeKeys: string[];
	};
	density: {
		fontFamily: string;
		fontSize: number;
		lineHeight: number;
		lineNumberWidth: number;
		glyphMarginWidth: number;
		decorationsWidth: number;
	};
}

interface PaneBounds {
	side: string;
	rect?: Rect;
	left: number;
	right: number;
}

interface PreviewModelDecoration {
	range: { startLineNumber: number; endLineNumber: number };
	options: {
		className?: string | null;
		marginClassName?: string | null;
		glyphMarginClassName?: string | null;
		linesDecorationsClassName?: string | null;
		inlineClassName?: string | null;
		description?: string | null;
		overviewRuler?: {
			color?: string | { id?: string };
			position?: number;
			zIndex?: number;
		} | null;
	};
}

interface PreviewDiffModel {
	getLineCount(): number;
	getLinesContent(): string[];
	getAllDecorations(): PreviewModelDecoration[];
}

interface PreviewLineChange {
	originalStartLineNumber: number;
	originalEndLineNumber: number;
	modifiedStartLineNumber: number;
	modifiedEndLineNumber: number;
}

interface PreviewDiffSideEditor {
	getModel(): PreviewDiffModel | null;
	getDomNode(): HTMLElement | null;
	getPosition(): { lineNumber: number; column: number } | null;
}

interface PreviewDiffEditor {
	getOriginalEditor(): PreviewDiffSideEditor;
	getModifiedEditor(): PreviewDiffSideEditor;
	getLineChanges(): PreviewLineChange[] | null;
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
	oneSided?: OneSidedAudit;
	body?: DiffBodyAudit;
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

/** One message the preview page posted to its fake VS Code host. */
interface PreviewMessage {
	type?: string;
	field?: string;
	value?: string;
	nodeId?: string;
	message?: string;
}

function previewMessages(): PreviewMessage[] {
	return window.__PREVIEW_MESSAGES__ as PreviewMessage[];
}

function messagesOfType(type: string): PreviewMessage[] {
	return previewMessages().filter((posted) => posted.type === type);
}

function isEditMessage(posted: PreviewMessage): boolean {
	return posted.type === 'edit';
}

function isSaveMessage(posted: PreviewMessage): boolean {
	return posted.type === 'save';
}

/** `[message]` when `condition` holds, otherwise no issue. */
function issueWhen(condition: boolean, message: string): string[] {
	return condition ? [message] : [];
}

/** The element's trimmed text, or an empty string when it rendered none. */
function textOf(element: Element): string {
	return element.textContent?.trim() ?? '';
}

/** Whether the element exists, is shown and its text matches `expected`. */
function elementShows(id: string, expected: RegExp): boolean {
	const element = document.getElementById(id);
	return element !== null && !element.hidden && expected.test(element.textContent ?? '');
}

function statusTextOf(id: string): string {
	return document.getElementById(id)?.textContent ?? '';
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
	const host = widget.closest('#tree, #diff-list');
	const main = document.getElementById('main');
	return [
		...issueWhen(
			host !== null && getComputedStyle(host).overflow !== 'visible',
			'the find-widget host clips the native tooltip'
		),
		...issueWhen(
			main !== null && getComputedStyle(main).overflow !== 'visible',
			'the editor column clips the native find tooltip'
		)
	];
}

function violationsOf(state: AuditState, audit: Omit<PreviewAudit, 'violations'>): string[] {
	return [
		...stateViolations(state, audit),
		...toolbarViolations(audit.toolbar),
		...gutterViolations(audit.gutter),
		...findHostViolations(),
		...issueWhen(audit.content.pageOverflow, 'the document scrolls horizontally'),
		...oneSidedStateIssues(state, audit),
		...bodyViolations(state, audit.body),
		...pageIssues(state, audit)
	];
}

function oneSidedStateIssues(state: AuditState, audit: Omit<PreviewAudit, 'violations'>): string[] {
	if (state.name !== 'diff-one-sided') {
		return [];
	}
	return audit.oneSided === undefined
		? ['the one-sided audit could not read the aligned diff models']
		: oneSidedViolations(audit.oneSided);
}

function pageIssues(state: AuditState, audit: Omit<PreviewAudit, 'violations'>): string[] {
	return state.page === 'diff' ? diffViolations(state, audit) : [];
}

type SyntaxSpan = NonNullable<PreviewAudit['syntax']>[number];

function syntaxColor(spans: SyntaxSpan[], text: string): string | undefined {
	return spans.find((span) => span.text.trim() === text)?.color;
}

function syntaxColorViolations(audit: Omit<PreviewAudit, 'violations'>): string[] {
	const spans = audit.syntax ?? [];
	return [
		...numericColorIssues(syntaxColor(spans, '42'), syntaxColor(spans, '0b1010')),
		...referenceColorIssues(syntaxColor(spans, '"hello"'), syntaxColor(spans, 'P.Syn.Syntax.Target')),
		...conditionTokenColorIssues(
			syntaxColor(spans, 'CANIPCORETYPE_SC'),
			syntaxColor(spans, '=='),
			syntaxColor(spans, '0')
		)
	];
}

function numericColorIssues(decimal: string | undefined, binary: string | undefined): string[] {
	if (binary === undefined || decimal === undefined) {
		return ['the syntax preview did not render the decimal and binary values'];
	}
	return binary === decimal ? [] : ['a binary value is not using the numeric colour'];
}

function referenceColorIssues(text: string | undefined, reference: string | undefined): string[] {
	if (reference === undefined || text === undefined) {
		return ['the syntax preview did not render the text and reference values'];
	}
	return reference === text ? ['a reference value is not using the reference colour'] : [];
}

function conditionTokenColorIssues(
	name: string | undefined,
	operator: string | undefined,
	number: string | undefined
): string[] {
	const tokens = [name, operator, number];
	if (!allDefined(tokens)) {
		return ['the syntax preview did not render the condition tokens'];
	}
	return conditionTokensDistinct(tokens[0], tokens[1], tokens[2])
		? []
		: ['a system-condition token is not using its own colour'];
}

function allDefined(values: Array<string | undefined>): values is string[] {
	return values.every((value) => value !== undefined);
}

function conditionTokensDistinct(name: string, operator: string, number: string): boolean {
	const doubled = name === operator || operator === number;
	return !doubled && name !== number;
}

/** The Dark+ palette the preview resolves; Chromium reports resolved rgb(). */
const SYSCOND_COLORS = {
	name: 'rgb(86, 156, 214)',
	operator: 'rgb(197, 134, 192)',
	literal: 'rgb(79, 193, 255)',
	number: 'rgb(181, 206, 168)',
	string: 'rgb(206, 145, 120)'
};

/** The `diff-one-sided` fixture contract, so a fixture edit names the failing expectation. */
const ONE_SIDED_FIXTURE = {
	owningBraces: 8,
	minLineChanges: 3
} as const;

/** The Dark+ definition and string colours the label preview resolves. */
const LABEL_COLORS = {
	type: 'rgb(78, 201, 176)',
	string: 'rgb(206, 145, 120)'
};

/** `editor-labels`: a no-label container starts with a string, a labelled one keeps type + string. */
function labelColorViolations(audit: Omit<PreviewAudit, 'violations'>): string[] {
	const spans = audit.syntax ?? [];
	return [
		...noLabelColorIssues(syntaxColor(spans, '"EmptyDef"')),
		...labelPairColorIssues(syntaxColor(spans, 'Items'), syntaxColor(spans, '"Items"')),
		...emptiedSelectionIssues(),
		...inspectorLabelIssues(),
		...editorLineViolations('"EmptyDef"', '"EmptyDef" { }'),
		...editorLineViolations('Items "Items"', 'Items "Items"')
	];
}

function noLabelColorIssues(short: string | undefined): string[] {
	if (short === undefined) {
		return ['the labels preview did not render the no-label container'];
	}
	return short === LABEL_COLORS.string ? [] : [`the no-label short name is ${short}, not the string colour`];
}

function labelPairColorIssues(label: string | undefined, short: string | undefined): string[] {
	if (label === undefined || short === undefined) {
		return ['the labels preview did not render the normal container label and short name'];
	}
	return [...labelTypeIssues(label), ...labelShortNameIssues(short)];
}

function labelTypeIssues(label: string): string[] {
	return label === LABEL_COLORS.type ? [] : [`the container label is ${label}, not the type colour`];
}

function labelShortNameIssues(short: string): string[] {
	return short === LABEL_COLORS.string ? [] : [`the container short name is ${short}, not the string colour`];
}

function emptiedSelectionIssues(): string[] {
	const shortNameInput = document.getElementById('details-short-name') as HTMLInputElement | null;
	if (shortNameInput === null || shortNameInput.value !== 'EmptyDef') {
		return ['the labels preview did not select the no-label container'];
	}
	return document.getElementById('details-definition-ref') !== null
		? ['the no-label container shows a definition field']
		: [];
}

function inspectorLabelIssues(): string[] {
	const inspectorLabel = document.querySelector('#sb-details-body .inspector-label');
	return inspectorLabel === null || inspectorLabel.textContent !== ''
		? ['the no-label container shows a definition label']
		: [];
}

/** The condition classes present in the fixture and their expected resolved colours.
 * Punctuation is surface-specific (the CSS theme mix vs Monaco's delimiter), so the
 * token-mapping and stylesheet tests cover it rather than this cross-surface audit. */
const SYSCOND_CLASSES: ReadonlyArray<readonly [string, string]> = [
	['syscond-name', SYSCOND_COLORS.name],
	['syscond-operator', SYSCOND_COLORS.operator],
	['syscond-literal', SYSCOND_COLORS.literal],
	['syscond-number', SYSCOND_COLORS.number],
	['syscond-string', SYSCOND_COLORS.string]
];

/** The text each condition class carries in the `editor-syscond` fixture. */
const SYSCOND_TEXT: Readonly<Record<string, string>> = {
	'syscond-name': 'CANIPCORETYPE_SC',
	'syscond-operator': '==',
	'syscond-literal': 'true',
	'syscond-number': '0',
	'syscond-string': '"A"'
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
	const editor = audit.syntax ?? [];
	// The Monaco page paints the Document tree with the same tokenizer; its spans
	// are the editor's view-line spans, already captured by the syntax audit.
	return [
		...definedIssue(syscondPaletteIssue('the Details Condition', detailsClassNameColor(syscond))),
		...definedIssue(syscondPaletteIssue('the editor condition', editorClassNameColor(editor))),
		...panelNameIssues(syscond.panelName),
		...panelStateIssues(syscond.panelState)
	];
}

function definedIssue(issue: string | undefined): string[] {
	return issue === undefined ? [] : [issue];
}

function detailsClassNameColor(syscond: SyscondAudit): (className: string) => string | undefined {
	return (className) => {
		const token = syscond.details.find((span) => span.className.split(/\s+/).includes(className));
		return token?.color;
	};
}

function editorClassNameColor(editor: SyntaxSpan[]): (className: string) => string | undefined {
	return (className) => editor.find((span) => span.text.trim() === SYSCOND_TEXT[className])?.color;
}

function panelNameIssues(name: string | null): string[] {
	return name === SYSCOND_COLORS.name
		? []
		: [`the Conditions panel name is ${String(name)}, not the syscond colour`];
}

function panelStateIssues(state: string | null): string[] {
	return state === SYSCOND_COLORS.literal
		? []
		: [`the Conditions panel state is ${String(state)}, not the literal colour`];
}

type EditorStateIssues = (state: AuditState) => string[];

/** The per-state checks, in the order the audit reports them. */
const EDITOR_STATE_ISSUES: ReadonlyArray<readonly [string, EditorStateIssues]> = [
	['editor-dirty', dirtyViolations],
	['editor-invalid', invalidViolations],
	['editor-details', (state) => detailsTypingViolations(state, true)],
	['editor-details-save', (state) => [...detailsTypingViolations(state, false), ...detailsSaveViolations()]],
	['editor-details-rename', detailsRenameViolations],
	['editor-rename-refusal', renameRefusalViolations],
	['editor-rename-late-ack', detailsRenameViolations],
	['editor-details-undo', detailsUndoViolations],
	['editor-details-redo', detailsRedoViolations],
	['editor-delete', deleteEditViolations],
	['editor-multi-save', multiSaveViolations],
	['editor-paste', pasteViolations],
	['editor-stale-save', staleSaveViolations]
];

function stateViolations(state: AuditState, audit: Omit<PreviewAudit, 'violations'>): string[] {
	return [
		...issueWhen(!audit.ready, 'the page did not reach previewReady'),
		...monacoMountIssues(state),
		...syntaxStateIssues(state, audit),
		...editorStateIssues(state),
		...stickyStateIssues(state, audit),
		...selectIssues(state, audit),
		...swapViolations(state, audit.swap)
	];
}

function monacoMountIssues(state: AuditState): string[] {
	const missing = state.page === 'editor' && document.querySelector('#tree .monaco-editor') === null;
	return issueWhen(missing, 'the Monaco editor did not mount');
}

function syntaxStateIssues(state: AuditState, audit: Omit<PreviewAudit, 'violations'>): string[] {
	if (state.name === 'editor-syntax') {
		return syntaxColorViolations(audit);
	}
	if (state.name === 'editor-syscond') {
		return syscondViolations(audit);
	}
	if (state.name === 'editor-labels') {
		return labelColorViolations(audit);
	}
	return [];
}

function editorStateIssues(state: AuditState): string[] {
	const entry = EDITOR_STATE_ISSUES.find(([name]) => name === state.name);
	return entry === undefined ? [] : entry[1](state);
}

function dirtyViolations(): string[] {
	const edits = messagesOfType('edit');
	return [
		...issueWhen(
			!elementShows('editor-dirty-status', /Unsaved changes/),
			'the dirty edit did not show the Unsaved changes marker'
		),
		...issueWhen(edits.length !== 0, `the typing run posted ${edits.length} host edits before Ctrl+S`)
	];
}

function invalidViolations(): string[] {
	const messages = previewMessages();
	return [
		...issueWhen(
			!elementShows('editor-error-strip', /Invalid value/),
			'the invalid edit did not show the page error'
		),
		...issueWhen(messages.some(isEditMessage), 'an invalid edit was posted to the host'),
		...issueWhen(messages.some(isSaveMessage), 'an invalid edit allowed the document to save')
	];
}

function stickyStateIssues(state: AuditState, audit: Omit<PreviewAudit, 'violations'>): string[] {
	if (state.name === 'editor-sticky') {
		return stickyViolations(audit.sticky);
	}
	return hiddenStickyIssues(state, audit.sticky);
}

function stickyViolations(sticky: PreviewAudit['sticky']): string[] {
	if (sticky === undefined || !sticky.visible) {
		return ['the sticky-scroll widget is not visible'];
	}
	return stickyTextIssues(sticky.text);
}

function stickyTextIssues(text: string): string[] {
	return issueWhen(
		!text.includes('Items') || !text.includes('P.Preview'),
		'the sticky-scroll widget does not show the enclosing module and Items container'
	);
}

function hiddenStickyIssues(state: AuditState, sticky: PreviewAudit['sticky']): string[] {
	const atTop = state.name === 'editor' && sticky?.visible === true;
	return issueWhen(atTop, 'the sticky-scroll widget is visible at the top of the document');
}

function selectIssues(state: AuditState, audit: Omit<PreviewAudit, 'violations'>): string[] {
	return issueWhen(state.select === true && !audit.selected, 'the select gesture left no selected row');
}

function detailsValueInput(): HTMLInputElement | null {
	return document.getElementById('details-value') as HTMLInputElement | null;
}

function missingDetailsValueIssues(input: HTMLInputElement | null): string[] {
	return issueWhen(input === null, 'the Details value control did not render');
}

function detailsFocusIssues(input: HTMLInputElement | null, message: string): string[] {
	return issueWhen(input !== null && document.activeElement !== input, message);
}

function detailsCaretIssues(input: HTMLInputElement | null, expected: number, message: string): string[] {
	return issueWhen(input !== null && input.selectionStart !== expected, message);
}

function detailsCaretAtEndIssues(input: HTMLInputElement | null, message: string): string[] {
	return issueWhen(input !== null && input.selectionStart !== input.value.length, message);
}

function detailsValueIssues(
	input: HTMLInputElement | null,
	expected: string,
	message: (actual: string) => string
): string[] {
	return input === null || input.value === expected ? [] : [message(input.value)];
}

function unsavedMarkerIssues(message: string): string[] {
	return issueWhen(!elementShows('editor-dirty-status', /Unsaved changes/), message);
}

function lingeringMarkerIssues(message: string): string[] {
	return issueWhen(elementShows('editor-dirty-status', /Unsaved changes/), message);
}

/** The Details state typed locally: focus, caret, one exact repaint and no host edit. */
function detailsTypingViolations(state: AuditState, expectNoEdit: boolean): string[] {
	const draft = `hello${state.detailsEdit ?? ''}`;
	const input = detailsValueInput();
	return [
		...missingDetailsValueIssues(input),
		...detailsFocusIssues(input, 'typing in Details dropped focus'),
		...detailsCaretAtEndIssues(input, 'typing in Details lost the caret'),
		...detailsValueIssues(
			input,
			draft,
			(actual) => `the Details control shows "${actual}" instead of the typed draft`
		),
		...unsavedMarkerIssues('the Details draft did not show the Unsaved changes marker'),
		...textLineViolations(`Text = "${draft}"`),
		...issueWhen(
			expectNoEdit && messagesOfType('edit').length > 0,
			'typing in Details posted a host edit before Ctrl+S'
		)
	];
}

/** A local undo after a Details edit restores the host value and clears the draft. */
function detailsUndoViolations(): string[] {
	const input = detailsValueInput();
	return [
		...missingDetailsValueIssues(input),
		...detailsFocusIssues(input, 'undo in Details dropped focus'),
		...detailsValueIssues(
			input,
			'hello',
			(actual) => `undo left the Details control at "${actual}" instead of the host value`
		),
		...detailsCaretIssues(input, 5, 'undo did not clamp the Details caret to the restored value'),
		...lingeringMarkerIssues('undo left the Unsaved changes marker behind'),
		...textLineViolations('Text = "hello"'),
		...issueWhen(messagesOfType('edit').length > 0, 'undo posted a host edit')
	];
}

/** Redo after a local undo restores the draft from Monaco's model stack. */
function detailsRedoViolations(): string[] {
	const input = detailsValueInput();
	return [
		...missingDetailsValueIssues(input),
		...detailsFocusIssues(input, 'redo in Details dropped focus'),
		...detailsValueIssues(
			input,
			'hello updated',
			(actual) => `redo left the Details control at "${actual}" instead of the draft`
		),
		...detailsCaretIssues(input, 13, 'redo did not restore the Details caret to the draft end'),
		...unsavedMarkerIssues('redo did not restore the Unsaved changes marker'),
		...textLineViolations('Text = "hello updated"'),
		...issueWhen(messagesOfType('edit').length > 0, 'redo posted a host edit')
	];
}

/** The direct-editor delete scenario ends at one bare textual value and no host edit. */
function deleteEditViolations(): string[] {
	return [
		...unsavedMarkerIssues('the delete scenario did not show the Unsaved changes marker'),
		...textLineViolations('Text = "R"'),
		...issueWhen(messagesOfType('edit').length > 0, 'a delete/backspace keystroke posted a host edit')
	];
}

function shortNameInput(): HTMLInputElement | null {
	return document.getElementById('details-short-name') as HTMLInputElement | null;
}

function editCountIssues(count: number, expected: number, message: (count: number) => string): string[] {
	return count === expected ? [] : [message(count)];
}

function expectedFieldEditIssues(
	edit: PreviewMessage,
	field: string,
	value: string,
	message: (pair: string) => string
): string[] {
	const actualField = edit.field ?? 'value';
	const matches = actualField === field && edit.value === value;
	return matches ? [] : [message(`${String(edit.field)}="${String(edit.value)}"`)];
}

function newNodeIdIssues(edit: PreviewMessage, message: (nodeId: string) => string): string[] {
	const nodeId = edit.nodeId;
	const addressed = nodeId !== undefined && nodeId.includes('/Syntax2#');
	return addressed ? [] : [message(String(nodeId))];
}

/** A rename ack arrived before the re-scan: the post-flush keystroke must survive. */
function detailsRenameViolations(): string[] {
	const messages = previewMessages();
	const edits = messagesOfType('edit');
	return [
		...editCountIssues(
			edits.length,
			2,
			(count) => `the rename sequence posted ${count} host edits instead of two`
		),
		...renameEditIssues(edits),
		...remapSaveIssues(messages, edits),
		...issueWhen(
			messages.some((posted) => (posted.message ?? '').includes('no longer in the file')),
			'the rename produced a stale-node refusal'
		),
		...renameShortNameIssues(shortNameInput())
	];
}

function renameEditIssues(edits: PreviewMessage[]): string[] {
	if (edits.length !== 2) {
		return [];
	}
	const [first, second] = edits;
	return [
		...expectedFieldEditIssues(
			first,
			'shortName',
			'Syntax2',
			(pair) => `the first edit was ${pair} instead of the rename`
		),
		...expectedFieldEditIssues(
			second,
			'shortName',
			'Syntax23',
			(pair) => `the deferred edit was ${pair} instead of the full name`
		),
		...issueWhen(first.nodeId === second.nodeId, 'the post-flush draft was sent at the pre-rename id'),
		...newNodeIdIssues(
			second,
			(nodeId) => `the post-flush draft was not addressed at the host's new id (${nodeId})`
		)
	];
}

function remapSaveIssues(messages: PreviewMessage[], edits: PreviewMessage[]): string[] {
	if (edits.length !== 2) {
		return [];
	}
	const saves = messages.filter(isSaveMessage);
	const lastSave = saves[saves.length - 1];
	const followed = lastSave !== undefined && messages.indexOf(lastSave) > messages.indexOf(edits[1]);
	return issueWhen(!followed, 'the save did not follow the remapped edit acknowledgement');
}

function renameShortNameIssues(input: HTMLInputElement | null): string[] {
	return [
		...shortNameValueIssues(input, 'Syntax23', {
			missing: 'the rename state lost the short-name control',
			value: (actual) => `the post-flush keystroke was lost ("${actual}")`,
			focus: 'the rename echo dropped Details focus'
		}),
		...detailsCaretAtEndIssues(input, 'the rename echo lost the caret')
	];
}

function shortNameValueIssues(
	input: HTMLInputElement | null,
	expected: string,
	messages: { missing: string; value: (actual: string) => string; focus: string }
): string[] {
	if (input === null) {
		return [messages.missing];
	}
	return [
		...detailsValueIssues(input, expected, messages.value),
		...detailsFocusIssues(input, messages.focus)
	];
}

/** A refusal after the rename document landed is recorded at the host's new id. */
function renameRefusalViolations(): string[] {
	const messages = previewMessages();
	const edits = messagesOfType('edit');
	const input = shortNameInput();
	return [
		...editCountIssues(
			edits.length,
			2,
			(count) => `the rename-refusal sequence posted ${count} host edits instead of two`
		),
		...refusalEditIssues(edits),
		...refusalSaveIssues(messages, edits),
		...refusalShortNameIssues(input),
		...inlineRefusalIssues(input),
		...refusalStatusIssues(),
		...staleRefusalStatusIssues()
	];
}

function refusalEditIssues(edits: PreviewMessage[]): string[] {
	if (edits.length !== 2) {
		return [];
	}
	const [first, second] = edits;
	return [
		...newNodeIdIssues(
			second,
			(nodeId) => `the refused draft was not addressed at the host's new id (${nodeId})`
		),
		...issueWhen(first.nodeId === second.nodeId, 'the post-flush draft kept the dead pre-rename id'),
		...expectedFieldEditIssues(
			second,
			'shortName',
			'Syntax23',
			(pair) => `the refused edit was ${pair} instead of the full name`
		)
	];
}

function refusalSaveIssues(messages: PreviewMessage[], edits: PreviewMessage[]): string[] {
	if (edits.length !== 2) {
		return [];
	}
	const refusedAt = messages.indexOf(edits[1]);
	const savedLater = messages.filter(isSaveMessage).some((save) => messages.indexOf(save) > refusedAt);
	return issueWhen(savedLater, 'a refused edit still allowed the document to save');
}

function refusalShortNameIssues(input: HTMLInputElement | null): string[] {
	return [
		...shortNameValueIssues(input, 'Syntax23', {
			missing: 'the refusal state lost the short-name control',
			value: (actual) => `the refused draft is not visible ("${actual}")`,
			focus: 'the refusal dropped Details focus'
		}),
		...ariaInvalidIssues(input)
	];
}

function ariaInvalidIssues(input: HTMLInputElement | null): string[] {
	const invalid = input !== null && input.getAttribute('aria-invalid') !== 'true';
	return issueWhen(invalid, 'the refused control is not marked invalid');
}

function inlineRefusalIssues(input: HTMLInputElement | null): string[] {
	const inline = input?.parentElement?.querySelector('.details-value-error');
	const shown =
		inline !== null && inline !== undefined && /refused by the test host/.test(inline.textContent ?? '');
	return issueWhen(!shown, 'the refusal reason is not shown beside the field');
}

function refusalStatusIssues(): string[] {
	const shown = /refused by the test host/.test(statusTextOf('details-status'));
	return issueWhen(!shown, 'the refusal reason is not in the Details status');
}

function staleRefusalStatusIssues(): string[] {
	const stale = /no longer in the file/.test(statusTextOf('details-status'));
	return issueWhen(stale, 'the refusal was reported as a stale node');
}

/** The rendered `Text = …` line, trimmed, must match exactly. */
function textLineViolations(expected: string): string[] {
	return editorLineViolations('Text = ', expected);
}

interface PreviewEditorModel {
	getLineCount(): number;
	getLineContent(line: number): string;
}

function previewEditorModel(): PreviewEditorModel | null {
	const editor = (window as unknown as { __ARXML_EDITOR__?: { getModel(): PreviewEditorModel | null } })
		.__ARXML_EDITOR__;
	return editor?.getModel() ?? null;
}

function findModelLine(model: PreviewEditorModel, prefix: string): string | undefined {
	for (let line = 1; line <= model.getLineCount(); line += 1) {
		const text = model.getLineContent(line).trim();
		if (text.startsWith(prefix)) {
			return text;
		}
	}
	return undefined;
}

/** The rendered line whose trimmed text starts with `prefix`, compared exactly. */
function editorLineViolations(prefix: string, expected: string): string[] {
	const model = previewEditorModel();
	if (model === null) {
		return ['the Details preview has no Monaco model'];
	}
	return lineTextIssues(findModelLine(model, prefix), prefix, expected);
}

function lineTextIssues(text: string | undefined, prefix: string, expected: string): string[] {
	if (text === undefined) {
		return [`the Details preview has no ${prefix.trim()} line`];
	}
	return text === expected ? [] : [`the editor line shows "${text}" instead of "${expected}"`];
}

/** Ctrl+S over two row drafts: two host edits, then one save after both acks. */
function multiSaveViolations(): string[] {
	const messages = previewMessages();
	const edits = messages.filter(isEditMessage);
	const saves = messages.filter(isSaveMessage);
	return [
		...editCountIssues(edits.length, 2, (count) => `Ctrl+S posted ${count} edits instead of two`),
		...twoFieldEditsIssues(edits),
		...editCountIssues(saves.length, 1, (count) => `Ctrl+S posted ${count} saves instead of one`),
		...singleSaveOrderIssues(
			messages,
			saves,
			edits[edits.length - 1],
			'the save was posted before both edits were acknowledged'
		),
		...editorLineViolations('Decimal = ', 'Decimal = 427'),
		...editorLineViolations('Text = ', 'Text = "hello!"'),
		...shownStripIssues('the multi-row save left an invalid-value error')
	];
}

function twoFieldEditsIssues(edits: PreviewMessage[]): string[] {
	if (edits.length !== 2) {
		return [];
	}
	return [...fieldEditIssues(edits[0], '427', 'Decimal'), ...fieldEditIssues(edits[1], 'hello!', 'Text')];
}

/** One value edit carries the row's accepted value and nothing else. */
function fieldEditIssues(edit: PreviewMessage | undefined, value: string, label: string): string[] {
	if (edit === undefined) {
		return [`the ${label} edit is missing`];
	}
	return [...fieldNameIssues(edit, label), ...fieldValueIssues(edit, value, label)];
}

function fieldNameIssues(edit: PreviewMessage, label: string): string[] {
	const field = edit.field ?? 'value';
	return issueWhen(field !== 'value', `the ${label} edit did not carry the value field`);
}

function fieldValueIssues(edit: PreviewMessage, value: string, label: string): string[] {
	return issueWhen(
		edit.value !== value,
		`the ${label} edit carried "${String(edit.value)}" instead of "${value}"`
	);
}

function singleSaveOrderIssues(
	messages: PreviewMessage[],
	saves: PreviewMessage[],
	lastEdit: PreviewMessage | undefined,
	message: string
): string[] {
	if (saves.length !== 1 || lastEdit === undefined) {
		return [];
	}
	const early = messages.indexOf(saves[0]) < messages.indexOf(lastEdit);
	return issueWhen(early, message);
}

function shownStripIssues(message: string): string[] {
	const strip = document.getElementById('editor-error-strip');
	return issueWhen(strip !== null && !strip.hidden, message);
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
	const messages = previewMessages();
	return [
		...issueWhen(messages.some(isEditMessage), 'the stale draft was posted to the host'),
		...issueWhen(messages.some(isSaveMessage), 'a stale draft allowed the document to save'),
		...staleStatusIssues(),
		...shownStripIssues('the stale draft was reported as an invalid value')
	];
}

function staleStatusIssues(): string[] {
	const text = statusTextOf('details-status');
	return issueWhen(
		!/no longer in the file/.test(text),
		`the status does not explain the missing node ("${text}")`
	);
}

/** Ctrl+S sent one raw edit for the textual field, waited for its ack, then saved. */
function detailsSaveViolations(): string[] {
	const messages = previewMessages();
	const edits = messages.filter(isEditMessage);
	const saves = messages.filter(isSaveMessage);
	return [
		...editCountIssues(edits.length, 1, (count) => `Ctrl+S posted ${count} edits instead of one`),
		...detailsEditIssues(edits),
		...editCountIssues(saves.length, 1, (count) => `Ctrl+S posted ${count} saves after the acknowledgement`),
		...singleSaveOrderIssues(messages, saves, edits[0], 'the save was posted before the edit acknowledgement')
	];
}

function detailsEditIssues(edits: PreviewMessage[]): string[] {
	if (edits.length !== 1) {
		return [];
	}
	const edit = edits[0];
	return [...fieldNameIssues(edit, 'Details'), ...detailsRawValueIssues(edit)];
}

function detailsRawValueIssues(edit: PreviewMessage): string[] {
	return issueWhen(
		edit.value !== 'hello updated',
		`the Details edit carried "${String(edit.value)}" instead of the raw value`
	);
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

const RGBA_COLOR = /^rgba\(\s*[\d.]+[,\s]+[\d.]+[,\s]+[\d.]+[,\s/]+([\d.]+)\)$/i;
const HEX_ALPHA_COLOR = /^#(?:[0-9a-f]{6})([0-9a-f]{2})$/i;
const OPAQUE_HEX_COLOR = /^#[0-9a-f]{6}$/i;
const OPAQUE_RGB_COLOR = /^rgb\(/i;

function colorAlpha(color: string): number | undefined {
	const rgba = RGBA_COLOR.exec(color);
	if (rgba !== null) {
		return Number(rgba[1]);
	}
	return hexAlpha(color) ?? opaqueAlpha(color);
}

function hexAlpha(color: string): number | undefined {
	const hex = HEX_ALPHA_COLOR.exec(color);
	return hex === null ? undefined : parseInt(hex[1], 16) / 255;
}

function opaqueAlpha(color: string): number | undefined {
	const opaque = OPAQUE_HEX_COLOR.test(color) || OPAQUE_RGB_COLOR.test(color);
	return opaque ? 1 : undefined;
}

const TRANSLUCENT_DIFF_SELECTORS = [
	'.monaco-diff-editor .line-insert',
	'.monaco-diff-editor .line-delete',
	'.monaco-diff-editor .char-insert',
	'.monaco-diff-editor .char-delete'
] as const;

function translucentDiffViolations(): string[] {
	return TRANSLUCENT_DIFF_SELECTORS.flatMap(opaqueFillIssues);
}

function opaqueFillIssues(selector: string): string[] {
	const alpha = elementAlpha(selector);
	return issueWhen(
		alpha !== undefined && alpha >= 1,
		`${selector} is opaque; diff fills must stay translucent`
	);
}

function elementAlpha(selector: string): number | undefined {
	const element = document.querySelector(selector);
	return element === null ? undefined : colorAlpha(getComputedStyle(element).backgroundColor);
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

/** The first non-empty run after `start`: one node line, its braces and children. */
function blockEnd(lines: readonly string[], start: number): number {
	let at = start;
	while (at < lines.length && lines[at] !== '') {
		at += 1;
	}
	return at;
}

function braceCount(lines: readonly string[], start: number, end: number): number {
	let count = 0;
	for (let at = Math.max(0, start); at < end; at += 1) {
		if (lines[at].includes('{') || lines[at].includes('}')) {
			count += 1;
		}
	}
	return count;
}

function decorationHasClass(options: PreviewModelDecoration['options'], name: string): boolean {
	const value = options.className;
	return typeof value === 'string' && value.split(/\s+/).includes(name);
}

/** Resolves a theme variable through a hidden probe, e.g. `var(--vscode-editor-background)`. */
function resolvedColor(expression: string): string {
	const probe = document.createElement('div');
	probe.style.color = expression;
	probe.style.display = 'none';
	document.body.appendChild(probe);
	const color = getComputedStyle(probe).color;
	probe.remove();
	return color;
}

interface OneSidedContext {
	editor: PreviewDiffEditor;
	originalEditor: PreviewDiffSideEditor;
	modifiedEditor: PreviewDiffSideEditor;
	originalModel: PreviewDiffModel;
	modifiedModel: PreviewDiffModel;
	left: string[];
	right: string[];
	removedAt: number;
	addedAt: number;
	removedEnd: number;
	addedEnd: number;
}

function previewDiffEditor(): PreviewDiffEditor | undefined {
	return (window as unknown as { __ARXML_DIFF_EDITOR__?: PreviewDiffEditor }).__ARXML_DIFF_EDITOR__;
}

function diffModels(editor: PreviewDiffEditor): {
	originalEditor: PreviewDiffSideEditor;
	modifiedEditor: PreviewDiffSideEditor;
	originalModel: PreviewDiffModel;
	modifiedModel: PreviewDiffModel;
} | undefined {
	const originalEditor = editor.getOriginalEditor();
	const modifiedEditor = editor.getModifiedEditor();
	const originalModel = originalEditor.getModel();
	const modifiedModel = modifiedEditor.getModel();
	if (originalModel === null || modifiedModel === null) {
		return undefined;
	}
	return { originalEditor, modifiedEditor, originalModel, modifiedModel };
}

function blockEndAt(lines: readonly string[], at: number): number {
	return at < 0 ? 0 : blockEnd(lines, at);
}

function oneSidedContext(): OneSidedContext | undefined {
	const editor = previewDiffEditor();
	if (editor === undefined) {
		return undefined;
	}
	const models = diffModels(editor);
	if (models === undefined) {
		return undefined;
	}
	const left = models.originalModel.getLinesContent();
	const right = models.modifiedModel.getLinesContent();
	const removedAt = left.indexOf('module P.RemovedMod "RemovedMod"');
	const addedAt = right.indexOf('module P.AddedMod "AddedMod"');
	return {
		editor,
		...models,
		left,
		right,
		removedAt,
		addedAt,
		removedEnd: blockEndAt(left, removedAt),
		addedEnd: blockEndAt(right, addedAt)
	};
}

function lineChangesOf(editor: PreviewDiffEditor): PreviewLineChange[] {
	return editor.getLineChanges() ?? [];
}

function covers(start: number, end: number, line: number): boolean {
	return start > 0 && line >= start && line <= Math.max(start, end);
}

function removedNavigable(c: OneSidedContext, changes: PreviewLineChange[]): boolean {
	if (c.removedAt < 0) {
		return false;
	}
	const line = c.removedAt + 1;
	return changes.some((change) => covers(change.originalStartLineNumber, change.originalEndLineNumber, line));
}

function addedNavigable(c: OneSidedContext, changes: PreviewLineChange[]): boolean {
	if (c.addedAt < 0) {
		return false;
	}
	const line = c.addedAt + 1;
	return changes.some((change) => covers(change.modifiedStartLineNumber, change.modifiedEndLineNumber, line));
}

function emptyLinesInBlock(lines: readonly string[], start: number, end: number): number {
	let count = 0;
	for (let at = Math.max(0, start); at < end; at += 1) {
		if (lines[at] === '') {
			count += 1;
		}
	}
	return count;
}

function countMatches(root: HTMLElement | null, selector: string): number {
	return root === null ? 0 : root.querySelectorAll(selector).length;
}

function nativePaintFromNodes(original: HTMLElement | null, modified: HTMLElement | null): NativeDiffPaint {
	return {
		lineInsert: countMatches(modified, '.line-insert'),
		lineDelete: countMatches(original, '.line-delete'),
		charInsert: countMatches(modified, '.char-insert'),
		charDelete: countMatches(original, '.char-delete'),
		insertSigns: countMatches(modified, '.insert-sign'),
		deleteSigns: countMatches(original, '.delete-sign'),
		diagonalFills: countMatches(original, '.diagonal-fill') + countMatches(modified, '.diagonal-fill')
	};
}

const CUSTOM_BODY_TOKENS = ['arxml-diff-line', 'arxml-diff-word', 'arxml-diff-sign', 'arxml-diff-placeholder'];

function isCustomPaintClass(value: string | null | undefined): boolean {
	const className = typeof value === 'string' ? value : '';
	return CUSTOM_BODY_TOKENS.some((token) => className.includes(token));
}

function isCustomPaintDecoration(options: PreviewModelDecoration['options']): boolean {
	return (
		isCustomPaintClass(options.className) ||
		isCustomPaintClass(options.inlineClassName) ||
		isCustomPaintClass(options.linesDecorationsClassName) ||
		isCustomPaintClass(options.marginClassName)
	);
}

function customPaintCount(roots: readonly HTMLElement[], models: readonly PreviewDiffModel[]): number {
	const dom = roots.reduce(
		(total, root) =>
			total +
			Array.from(
				root.querySelectorAll(
					'[class*="arxml-diff-line"], [class*="arxml-diff-word"], [class*="arxml-diff-sign"], [class*="arxml-diff-placeholder"]'
				)
			).length,
		0
	);
	const decorations = models.reduce(
		(total, model) =>
			total + model.getAllDecorations().filter((decoration) => isCustomPaintDecoration(decoration.options)).length,
		0
	);
	return dom + decorations;
}

function diffRoots(c: OneSidedContext): HTMLElement[] {
	return [c.originalEditor.getDomNode(), c.modifiedEditor.getDomNode()].filter(
		(root): root is HTMLElement => root !== null
	);
}

function copyArrowNodes(): HTMLElement[] {
	const modified = document.querySelector<HTMLElement>(
		'.monaco-editor.modified-in-monaco-diff-editor'
	);
	if (modified === null) {
		return [];
	}
	return Array.from(
		modified.querySelectorAll<HTMLElement>('.margin-view-zones .arrow-revert-change')
	).filter((arrow) => getComputedStyle(arrow).display !== 'none');
}

function arrowBoxVisible(arrow: HTMLElement): boolean {
	const rect = rectOf(arrow);
	return rect.width > 0 && rect.height > 0 && isArrowVisible(arrow);
}

function arrowAtGutter(arrow: HTMLElement, modified: HTMLElement | null): boolean {
	if (modified === null) {
		return false;
	}
	const rect = rectOf(arrow);
	const gutter = modified.getBoundingClientRect();
	return rect.x >= gutter.x - 1 && rect.x <= gutter.x + 48;
}


interface MergeProbe {
	side: string;
	key: string;
	direction: string;
	swapped: boolean;
}

function mergeProbe(): CopyArrowAudit['copy'] {
	const probe = (window as unknown as { __ARXML_DIFF_MERGE_PROBE__?: MergeProbe | null })
		.__ARXML_DIFF_MERGE_PROBE__;
	return probe === undefined || probe === null
		? null
		: { side: probe.side, key: probe.key, direction: probe.direction, swapped: probe.swapped };
}

const ARROW_SIDES = new Map<string, readonly ['left' | 'right', 'left' | 'right']>([
	['left', ['right', 'left']],
	['right', ['left', 'right']]
]);

function arrowSourceSide(direction: string, swapped: boolean): 'left' | 'right' | undefined {
	const sides = ARROW_SIDES.get(direction);
	if (sides === undefined) {
		return undefined;
	}
	return swapped ? sides[1] : sides[0];
}

function previewRowOwnsSide(row: PreviewBodyRow, side: 'left' | 'right'): boolean {
	const lines = side === 'left' ? row.leftLines : row.rightLines;
	return (lines?.length ?? 0) > 0;
}

function rowIsCopySource(row: PreviewBodyRow | undefined, side: 'left' | 'right'): boolean {
	return row !== undefined && row.status !== 'unchanged' && previewRowOwnsSide(row, side);
}

function copyTargetValid(probe: MergeProbe): boolean {
	const side = arrowSourceSide(probe.direction, probe.swapped);
	if (side === undefined) {
		return false;
	}
	const row = previewRows().find((candidate) => candidate.key === probe.key);
	return probe.side === side && rowIsCopySource(row, side);
}

function copyArrowAudit(modified: HTMLElement | null): CopyArrowAudit {
	const arrows = copyArrowNodes();
	const visibleArrows = arrows.filter(arrowBoxVisible);
	const copy = mergeProbe();
	return {
		count: arrows.length,
		builtIn: arrows.filter((arrow) => arrow.classList.contains('codicon-arrow-right')).length,
		copyLeft: arrows.filter((arrow) => arrow.classList.contains('codicon-arrow-left')).length,
		visible: visibleArrows.length > 0,
		atGutter: visibleArrows.every((arrow) => arrowAtGutter(arrow, modified)),
		copy,
		copyValid: copy === null || copyTargetValid(copy)
	};
}

function oneSidedAudit(): OneSidedAudit | undefined {
	const context = oneSidedContext();
	return context === undefined ? undefined : oneSidedValues(context);
}

function oneSidedValues(c: OneSidedContext): OneSidedAudit {
	const roots = diffRoots(c);
	const changes = lineChangesOf(c.editor);
	return {
		originalLines: c.originalModel.getLineCount(),
		modifiedLines: c.modifiedModel.getLineCount(),
		missingSideHasRemoved: c.right.some(
			(line) => line.includes('RemovedMod') || line.includes('RemovedItems') || line.includes('RemovedExtra')
		),
		missingSideHasAdded: c.left.some(
			(line) => line.includes('AddedMod') || line.includes('AddedItems') || line.includes('AddedValue')
		),
		owningSideBraces:
			braceCount(c.left, c.removedAt, c.removedEnd) + braceCount(c.right, c.addedAt, c.addedEnd),
		emptyOwningLines:
			emptyLinesInBlock(c.left, c.removedAt, c.removedEnd) +
			emptyLinesInBlock(c.right, c.addedAt, c.addedEnd),
		native: nativePaintFromNodes(c.originalEditor.getDomNode(), c.modifiedEditor.getDomNode()),
		margin: copyArrowAudit(c.modifiedEditor.getDomNode()),
		customPaint: customPaintCount(roots, [c.originalModel, c.modifiedModel]),
		lineChanges: changes.length,
		removedNavigable: removedNavigable(c, changes),
		addedNavigable: addedNavigable(c, changes)
	};
}

interface PreviewBodyRow {
	key: string;
	status: string;
	renamed?: boolean;
	leftLine?: number;
	rightLine?: number;
	leftLines?: number[];
	rightLines?: number[];
}

interface PreviewBodyData {
	rows: Array<PreviewBodyRow & { status: string; renamed?: boolean }>;
	mode?: { changesOnly: boolean; contextActive: boolean; swapped: boolean; merge: boolean };
}

interface PreviewNavTarget {
	key: string;
	status: string;
	order: number;
	renamed: boolean;
	side: string;
	line: number;
}

interface PreviewUnchangedCounts {
	centers: number;
	labels: string[];
}

interface PreviewUnchangedProbe {
	withContext: PreviewUnchangedCounts;
	afterShowAll: PreviewUnchangedCounts;
	restored: PreviewUnchangedCounts;
	withoutContext: PreviewUnchangedCounts;
	contextRestored: PreviewUnchangedCounts;
}

function previewBodyData(): PreviewBodyData | undefined {
	return (window as unknown as { __ARXML_DIFF_BODY__?: PreviewBodyData }).__ARXML_DIFF_BODY__;
}

function previewNavHistory(): PreviewNavTarget[] {
	const history = (window as unknown as { __ARXML_DIFF_NAV_HISTORY__?: PreviewNavTarget[] })
		.__ARXML_DIFF_NAV_HISTORY__;
	return history ?? [];
}

function previewUnchangedProbe(): PreviewUnchangedProbe | undefined {
	return (window as unknown as { __ARXML_DIFF_UNCHANGED__?: PreviewUnchangedProbe })
		.__ARXML_DIFF_UNCHANGED__;
}

function hasClass(element: Element | null | undefined, name: string): boolean {
	return element !== null && element !== undefined && element.classList.contains(name);
}

function bodyStatuses(rows: readonly PreviewBodyRow[]): DiffBodyAudit['statuses'] {
	return {
		changed: rows.filter((row) => row.status === 'changed').length,
		added: rows.filter((row) => row.status === 'added').length,
		removed: rows.filter((row) => row.status === 'removed').length,
		renamed: rows.filter((row) => row.renamed === true).length
	};
}

function pixelValue(value: string): number {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/** The editor font and gutter geometry the body CSS and Monaco options produce. */
function densityAudit(node: HTMLElement | null): DiffBodyAudit['density'] {
	if (node === null) {
		return emptyDensity();
	}
	const line = node.querySelector<HTMLElement>('.view-line');
	const style = getComputedStyle(line ?? node);
	return {
		fontFamily: style.fontFamily,
		fontSize: pixelValue(style.fontSize),
		lineHeight: pixelValue(style.lineHeight),
		lineNumberWidth: elementWidth(node.querySelector<HTMLElement>('.line-numbers')),
		glyphMarginWidth: elementWidth(node.querySelector<HTMLElement>('.glyph-margin')),
		decorationsWidth: elementWidth(node.querySelector<HTMLElement>('.cldr'))
	};
}

function emptyDensity(): DiffBodyAudit['density'] {
	return {
		fontFamily: '',
		fontSize: 0,
		lineHeight: 0,
		lineNumberWidth: 0,
		glyphMarginWidth: 0,
		decorationsWidth: 0
	};
}

function elementWidth(element: HTMLElement | null): number {
	return element === null ? 0 : Math.round(element.getBoundingClientRect().width);
}

function uniqueStrings(values: readonly string[]): string[] {
	return Array.from(new Set(values));
}

function nativeOverviewAudit(): NativeOverviewAudit {
	return {
		present: document.querySelector('.monaco-diff-editor .diffOverview') !== null
	};
}

function hiddenLineTotal(labels: readonly string[]): number {
	return labels.reduce((total, label) => {
		const count = /^(\d+)/.exec(label);
		return total + (count === null ? 0 : Number(count[1]));
	}, 0);
}

interface UnchangedToggles {
	showDiff: number;
	showAll: number;
	restored: number;
	contextOnLines: number;
	contextOffLines: number;
	withoutContext: number;
	contextRestored: number;
}

const NO_UNCHANGED_TOGGLES: UnchangedToggles = {
	showDiff: -1,
	showAll: -1,
	restored: -1,
	contextOnLines: -1,
	contextOffLines: -1,
	withoutContext: -1,
	contextRestored: -1
};

function unchangedToggles(): UnchangedToggles {
	const probe = previewUnchangedProbe();
	if (probe === undefined) {
		return NO_UNCHANGED_TOGGLES;
	}
	return {
		showDiff: probe.withContext.centers,
		showAll: probe.afterShowAll.centers,
		restored: probe.restored.centers,
		contextOnLines: hiddenLineTotal(probe.withContext.labels),
		contextOffLines: hiddenLineTotal(probe.withoutContext.labels),
		withoutContext: probe.withoutContext.centers,
		contextRestored: probe.contextRestored.centers
	};
}

/** The centered native unchanged widget, its labels and control counts. */
function unchangedAudit(): DiffBodyAudit['unchanged'] {
	const root: ParentNode = document.querySelector('.monaco-diff-editor') ?? document;
	const centers = Array.from(root.querySelectorAll<HTMLElement>('.diff-hidden-lines .center'));
	return {
		centers: centers.length,
		height: centers.length === 0 ? 0 : Math.round(centers[0].getBoundingClientRect().height),
		labels: uniqueStrings(
			centers.map((center) => (center.textContent ?? '').trim()).filter((label) => label !== '')
		),
		unfold: root.querySelectorAll('.diff-hidden-lines .default-control .codicon-unfold').length,
		handles: root.querySelectorAll('.diff-hidden-lines .top, .diff-hidden-lines .bottom').length,
		...unchangedToggles()
	};
}

function keyAtLine(
	rows: readonly PreviewBodyRow[],
	side: 'left' | 'right',
	line: number
): string | undefined {
	for (const row of rows) {
		const lines = side === 'left' ? row.leftLines : row.rightLines;
		if (lines?.includes(line) === true) {
			return row.key;
		}
	}
	return undefined;
}

/**
 * The navigation the page performed plus the row a line-change step would
 * have chosen. The display mapping turns the stored side back into the pane
 * the user sees, so a swapped capture is compared against its own panes.
 */
interface NavPosition {
	positionSide: string;
	positionLine: number | undefined;
}

function navPosition(
	history: readonly PreviewNavTarget[],
	models: NonNullable<ReturnType<typeof diffModels>>,
	swapped: boolean
): NavPosition {
	const last = history[history.length - 1];
	const onOriginal = last.side === (swapped ? 'right' : 'left');
	const position = onOriginal
		? models.originalEditor.getPosition()
		: models.modifiedEditor.getPosition();
	return { positionSide: last.side, positionLine: position?.lineNumber };
}

interface NavSources {
	editor: PreviewDiffEditor;
	models: NonNullable<ReturnType<typeof diffModels>>;
}

function navSources(): NavSources | undefined {
	const editor = previewDiffEditor();
	if (editor === undefined) {
		return undefined;
	}
	const models = diffPreviewModels();
	return models === undefined ? undefined : { editor, models };
}

/**
 * The navigation the page performed plus the row a line-change step would
 * have chosen. The old step always revealed the modified pane, including a
 * missing-side placeholder, so that line is what the keys map.
 */
function navAudit(
	rows: readonly PreviewBodyRow[],
	swapped: boolean
): DiffBodyAudit['nav'] | undefined {
	const history = previewNavHistory();
	if (history.length === 0) {
		return undefined;
	}
	const sources = navSources();
	if (sources === undefined) {
		return undefined;
	}
	const modifiedSide = swapped ? 'left' : 'right';
	const changes = lineChangesOf(sources.editor);
	return {
		history,
		...navPosition(history, sources.models, swapped),
		lineChangeLines: changes.map(
			(change) => change.modifiedStartLineNumber || change.originalStartLineNumber
		),
		lineChangeKeys: changes.map(
			(change) =>
				keyAtLine(
					rows,
					modifiedSide,
					change.modifiedStartLineNumber || change.originalStartLineNumber
				) ?? ''
		)
	};
}

/** Reads the stable body contract and the semantic paint on the real Monaco page. */
function previewRows(): readonly PreviewBodyRow[] {
	return previewBodyData()?.rows ?? [];
}

function previewSwapped(): boolean {
	return previewBodyData()?.mode?.swapped === true;
}

function diffBodyAudit(): DiffBodyAudit | undefined {
	const models = diffPreviewModels();
	if (models === undefined) {
		return undefined;
	}
	const host = document.getElementById('diff-monaco');
	const originalNode = models.originalEditor.getDomNode();
	const modifiedNode = models.modifiedEditor.getDomNode();
	const rows = previewRows();
	return {
		host: hasClass(host, 'arxml-diff-body'),
		gutter: bodyClassOn('arxml-diff-gutter', host, originalNode, modifiedNode),
		status: bodyClassOn('arxml-diff-status', host, originalNode, modifiedNode),
		rows: rows.length,
		statuses: bodyStatuses(rows),
		lineCounts: {
			original: models.originalModel.getLineCount(),
			modified: models.modifiedModel.getLineCount()
		},
		native: nativePaintFromNodes(originalNode, modifiedNode),
		margin: copyArrowAudit(modifiedNode),
		customPaint: customPaintCount(
			[originalNode, modifiedNode].filter((node): node is HTMLElement => node !== null),
			[models.originalModel, models.modifiedModel]
		),
		overview: nativeOverviewAudit(),
		unchanged: unchangedAudit(),
		nav: navAudit(rows, previewSwapped()),
		density: densityAudit(originalNode)
	};
}

function diffPreviewModels(): ReturnType<typeof diffModels> {
	const editor = previewDiffEditor();
	return editor === undefined ? undefined : diffModels(editor);
}

function bodyClassOn(
	name: string,
	host: HTMLElement | null,
	originalNode: HTMLElement | null,
	modifiedNode: HTMLElement | null
): boolean {
	return hasClass(host, name) || (hasClass(originalNode, name) && hasClass(modifiedNode, name));
}

function bodyViolations(state: AuditState, audit: DiffBodyAudit | undefined): string[] {
	if (state.page !== 'diff') {
		return [];
	}
	if (audit === undefined) {
		return ['the diff body audit could not read the editor, models or body data'];
	}
	return [
		...bodySurfaceIssues(audit),
		...bodyCustomPaintIssues(audit),
		...bodyOverviewIssues(audit),
		...bodyUnchangedIssues(state, audit),
		...bodyNavIssues(state, audit),
		...bodyMergeStateIssues(state, audit),
		...bodyStateIssues(state, audit)
	];
}

function bodySurfaceIssues(audit: DiffBodyAudit): string[] {
	return [
		...issueWhen(!audit.host, 'the diff host is missing the arxml-diff-body class'),
		...issueWhen(!audit.gutter, 'a diff editor root is missing the arxml-diff-gutter class'),
		...issueWhen(!audit.status, 'a diff editor root is missing the arxml-diff-status class')
	];
}

function bodyCustomPaintIssues(audit: DiffBodyAudit): string[] {
	return issueWhen(
		audit.customPaint > 0,
		`${audit.customPaint} old custom body fill/sign/word/placeholder element(s)/decoration(s) remain`
	);
}

function bodyOverviewIssues(audit: DiffBodyAudit): string[] {
	return issueWhen(!audit.overview.present, 'the built-in diff overview is missing');
}

function unchangedWidgetIssues(unchanged: DiffBodyAudit['unchanged']): string[] {
	const labelsUseReference =
		unchanged.labels.length > 0 && unchanged.labels.every((label) => /^\d+ hidden lines$/.test(label));
	return [
		...issueWhen(unchanged.centers === 0, 'Show diff rendered no native unchanged widget'),
		...issueWhen(
			unchanged.height !== 24,
			`the unchanged widget center is ${unchanged.height}px high, not the 24px reference`
		),
		...issueWhen(
			!labelsUseReference,
			`the unchanged widgets do not use the "{n} hidden lines" label (${unchanged.labels.join(' | ')})`
		),
		...issueWhen(unchanged.unfold === 0, 'no native unchanged widget offers the unfold control'),
		...issueWhen(
			unchanged.handles !== unchanged.centers * 2,
			'the native unchanged widgets lost their top/bottom drag handles'
		)
	];
}

function unchangedToggleIssues(unchanged: DiffBodyAudit['unchanged']): string[] {
	const contextShrank =
		unchanged.contextOnLines >= 0 &&
		unchanged.contextOffLines >= 0 &&
		unchanged.contextOffLines < unchanged.contextOnLines;
	return [
		...issueWhen(
			unchanged.showAll !== 0,
			`Show all left ${unchanged.showAll} unchanged widget(s) visible`
		),
		...issueWhen(
			unchanged.restored <= 0,
			'Show diff did not restore the native unchanged widgets after Show all'
		),
		...issueWhen(contextShrank, 'Context off hid fewer unchanged rows than Context on'),
		...issueWhen(
			unchanged.contextRestored <= 0,
			'turning Context back on did not restore the unchanged widgets'
		)
	];
}

function bodyUnchangedIssues(state: AuditState, audit: DiffBodyAudit): string[] {
	if (state.view !== 'diff') {
		return issueWhen(
			audit.unchanged.centers > 0,
			"native unchanged widgets are visible while Show all is selected"
		);
	}
	return [
		...unchangedWidgetIssues(audit.unchanged),
		...unchangedToggleIssues(audit.unchanged)
	];
}

function navStepIssues(clicks: number, nav: NonNullable<DiffBodyAudit['nav']>): string[] {
	const issues = [
		...issueWhen(
			nav.history.length !== clicks,
			`${nav.history.length} semantic navigation step(s) ran for ${clicks} toolbar press(es)`
		)
	];
	const last = nav.history[nav.history.length - 1];
	if (last === undefined) {
		issues.push('semantic navigation recorded no target row');
		return issues;
	}
	issues.push(
		...issueWhen(
			nav.positionLine !== last.line,
			`the cursor is on line ${nav.positionLine ?? '?'}, not the semantic target line ${last.line}`
		)
	);
	return issues;
}

function navFixtureIssues(state: AuditState, nav: NonNullable<DiffBodyAudit['nav']>): string[] {
	if (state.name !== 'diff-nav') {
		return [];
	}
	const last = nav.history[nav.history.length - 1];
	const first = nav.history[0];
	return [
		...issueWhen(last !== undefined && !last.renamed, 'the semantic navigation did not reach the renamed row'),
		...issueWhen(
			first !== undefined && nav.lineChangeKeys[0] === first.key,
			'the first line change picks the same semantic row; the fixture does not prove the semantic source'
		)
	];
}

function countOrZero(value: number | undefined): number {
	return value ?? 0;
}

function pressCount(state: AuditState): number {
	return countOrZero(state.jump) + countOrZero(state.jumpBack);
}

function bodyNavIssues(state: AuditState, audit: DiffBodyAudit): string[] {
	const clicks = pressCount(state);
	if (clicks === 0) {
		return [];
	}
	const nav = audit.nav;
	if (nav === undefined) {
		return ['the semantic navigation audit recorded no target'];
	}
	return [...navStepIssues(clicks, nav), ...navFixtureIssues(state, nav)];
}

function bodyMergeStateIssues(state: AuditState, audit: DiffBodyAudit): string[] {
	return issueWhen(audit.margin.count > 0 && state.merge !== true, 'center copy arrows are visible while Merge is off');
}

function bodyStateIssues(state: AuditState, audit: DiffBodyAudit): string[] {
	if (state.name === 'diff-body') {
		return diffBodyStateIssues(audit);
	}
	if (state.name === 'diff-removed') {
		return diffRemovedIssues(audit);
	}
	if (state.name === 'diff-swap') {
		return marginIssues(audit.margin);
	}
	return [];
}

function diffRemovedIssues(audit: DiffBodyAudit): string[] {
	return [
		...marginIssues(audit.margin),
		...issueWhen(audit.margin.builtIn === 0, 'the removed block has no built-in right arrow'),
		...issueWhen(audit.margin.copyLeft === 0, 'the changed row has no copy-left arrow'),
		...issueWhen(
			audit.margin.copy?.direction !== 'right',
			'the built-in right arrow was not the probed arrow'
		)
	];
}

function diffBodyStateIssues(audit: DiffBodyAudit): string[] {
	return [
		...bodyRowIssues(audit),
		...bodyLineCountIssues(audit.lineCounts),
		...bodyNativeIssues(audit.native),
		...marginIssues(audit.margin),
		...diffBodyMarginIssues(audit.margin),
		...diffBodyDensityIssues(audit.density)
	];
}

function bodyLineCountIssues(counts: DiffBodyAudit['lineCounts']): string[] {
	return issueWhen(
		counts.original === 0 || counts.modified === 0,
		`a diff model has no lines (original ${counts.original}, modified ${counts.modified})`
	);
}

function bodyNativeIssues(native: NativeDiffPaint): string[] {
	return [
		...issueWhen(native.lineDelete === 0, 'the body is missing a built-in deleted line fill'),
		...issueWhen(native.lineInsert === 0, 'the body is missing a built-in inserted line fill'),
		...issueWhen(native.deleteSigns === 0, 'the body is missing a built-in delete indicator'),
		...issueWhen(native.insertSigns === 0, 'the body is missing a built-in insert indicator'),
		...issueWhen(native.diagonalFills === 0, 'the body is missing a built-in diagonal gap fill'),
		...issueWhen(native.charDelete === 0, 'the body is missing a built-in removed word span'),
		...issueWhen(native.charInsert === 0, 'the body is missing a built-in inserted word span')
	];
}

function diffBodyMarginIssues(margin: CopyArrowAudit): string[] {
	return [
		...issueWhen(margin.count === 0, 'the diff body state has no diff-margin arrow'),
		...issueWhen(margin.copyLeft === 0, 'the diff body state has no copy-left arrow')
	];
}

function bodyRowIssues(audit: DiffBodyAudit): string[] {
	const statuses = ['changed', 'added', 'removed'] as const;
	return [
		...issueWhen(audit.rows === 0, 'the diff body state published no semantic rows'),
		...statuses.flatMap((status) =>
			issueWhen(audit.statuses[status] === 0, `the diff body state has no ${status} row`)
		),
		...issueWhen(audit.statuses.renamed === 0, 'the diff body state has no renamed row')
	];
}

function diffBodyDensityIssues(density: DiffBodyAudit['density']): string[] {
	return [
		...issueWhen(density.fontSize !== 13, `the inherited editor font size is ${density.fontSize}px, not 13px`),
		...issueWhen(density.lineHeight !== 20, `the inherited line height is ${density.lineHeight}px, not 20px`),
		...issueWhen(density.lineNumberWidth <= 0, 'the line-number column has no width'),
		...issueWhen(density.glyphMarginWidth <= 0, 'the merge/glyph margin has no width'),
		...issueWhen(density.decorationsWidth <= 0, 'the gutter sign column has no width')
	];
}

function oneSidedViolations(audit: OneSidedAudit): string[] {
	return [
		...issueWhen(
			audit.originalLines === audit.modifiedLines,
			`the per-side models both have ${audit.originalLines} lines; a one-sided fixture must prove different counts`
		),
		...issueWhen(audit.missingSideHasRemoved, 'the missing side still renders the removed block'),
		...issueWhen(audit.missingSideHasAdded, 'the missing side still renders the added block'),
		...issueWhen(
			audit.owningSideBraces !== ONE_SIDED_FIXTURE.owningBraces,
			`the owning side has ${audit.owningSideBraces} brace lines, not the ${ONE_SIDED_FIXTURE.owningBraces} in the diff-one-sided fixture`
		),
		...issueWhen(audit.emptyOwningLines > 0, `${audit.emptyOwningLines} blank line(s) inside an owning block`),
		...issueWhen(
			audit.customPaint > 0,
			`${audit.customPaint} old custom body paint element(s)/decoration(s) remain`
		),
		...nativePaintIssues(audit.native),
		...marginIssues(audit.margin),
		...oneSidedNavigationIssues(audit)
	];
}

function nativePaintIssues(native: NativeDiffPaint): string[] {
	return [
		...issueWhen(native.lineDelete === 0, 'the built-in diff rendered no deleted line fill'),
		...issueWhen(native.lineInsert === 0, 'the built-in diff rendered no inserted line fill'),
		...issueWhen(native.deleteSigns === 0, 'the built-in diff rendered no delete indicator'),
		...issueWhen(native.insertSigns === 0, 'the built-in diff rendered no insert indicator'),
		...issueWhen(native.diagonalFills === 0, 'the built-in diff rendered no diagonal gap fill'),
		...issueWhen(native.charDelete === 0, 'the built-in diff rendered no removed word span'),
		...issueWhen(native.charInsert === 0, 'the built-in diff rendered no inserted word span')
	];
}

function marginIssues(margin: CopyArrowAudit): string[] {
	return [
		...issueWhen(margin.count === 0, 'the built-in diff margin rendered no copy arrow'),
		...issueWhen(margin.count > 0 && !margin.visible, 'a diff-margin arrow is not visible while Merge is on'),
		...issueWhen(margin.count > 0 && !margin.atGutter, 'a diff-margin arrow is outside the modified gutter'),
		...issueWhen(margin.copy === null, 'clicking a diff-margin arrow did not post the host copy action'),
		...issueWhen(margin.copy !== null && !margin.copyValid, 'the clicked arrow posted the wrong semantic side or key')
	];
}

function oneSidedNavigationIssues(audit: OneSidedAudit): string[] {
	return [
		...issueWhen(
			audit.lineChanges < ONE_SIDED_FIXTURE.minLineChanges,
			`the diff has ${audit.lineChanges} line changes, fewer than the ${ONE_SIDED_FIXTURE.minLineChanges} in the diff-one-sided fixture`
		),
		...issueWhen(audit.margin.copyLeft === 0, 'the added/changed rows have no copy-left arrow'),
		...issueWhen(!audit.removedNavigable, 'the removed block is missing from the navigation change list'),
		...issueWhen(!audit.addedNavigable, 'the added block is missing from the navigation change list')
	];
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
	return element === null ? '' : textOf(element);
}

function changedValue(side: 'left' | 'right'): string {
	const cell = document.querySelector(`#diff-pane-${side} .diff-row[data-status="changed"] .diff-cell`);
	return cell === null ? '' : textOf(cell);
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
	const visible = stickyVisible(display, rect);
	return {
		visible,
		display,
		text: textOf(widget),
		rect: visible ? rectOf(widget) : null
	};
}

function stickyVisible(display: string, rect: { height: number }): boolean {
	return display !== 'none' && rect.height > 0;
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
	const base = auditBase(state, swapBefore);
	return { ...base, violations: violationsOf(state, base) };
}

function auditBase(state: AuditState, swapBefore?: PaneSnapshot): Omit<PreviewAudit, 'violations'> {
	return {
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
		swap: swapSnapshot(swapBefore),
		sticky: stickyOf(state),
		syntax: syntaxOf(state),
		syscond: syscondOf(state),
		oneSided: oneSidedOf(state),
		body: bodyOf(state)
	};
}

function swapSnapshot(swapBefore: PaneSnapshot | undefined): { before: PaneSnapshot; after: PaneSnapshot } | null {
	return swapBefore === undefined ? null : { before: swapBefore, after: paneSnapshot() };
}

function stickyOf(state: AuditState): PreviewAudit['sticky'] {
	return state.page === 'editor' ? stickyAudit() : undefined;
}

function syscondOf(state: AuditState): SyscondAudit | undefined {
	return state.page === 'editor' ? syscondAudit() : undefined;
}

function oneSidedOf(state: AuditState): OneSidedAudit | undefined {
	return state.name === 'diff-one-sided' ? oneSidedAudit() : undefined;
}

function bodyOf(state: AuditState): DiffBodyAudit | undefined {
	return state.page === 'diff' ? diffBodyAudit() : undefined;
}

function syntaxOf(state: AuditState): PreviewAudit['syntax'] {
	if (state.page !== 'editor') {
		return undefined;
	}
	return Array.from(document.querySelectorAll('.monaco-editor .view-line span'))
		.slice(0, 40)
		.map((span) => ({
			text: span.textContent?.slice(0, 32) ?? '',
			className: typeof span.className === 'string' ? span.className : '',
			color: getComputedStyle(span).color
		}));
}
