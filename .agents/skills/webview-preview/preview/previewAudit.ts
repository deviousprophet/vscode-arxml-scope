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
	sash?: boolean;
	foldLabel?: string;
	collapseAll?: boolean;
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
	/** The state posted copied-but-unsaved rows. */
	copied?: boolean;
}

interface Rect {
	x: number;
	y: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
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
	overlaps: string[];
	outside: string[];
	clipped: string[];
	mergePressed: boolean | null;
}

interface GutterAudit {
	cells: number;
	rails: number;
	digitsClear: boolean;
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

/** Actual per-side models and native paint for the one-sided diff states. */
export interface OneSidedAudit {
	originalLines: number;
	modifiedLines: number;
	placeholderDecorations: number;
	placeholderElements: number;
	legacyPaint: number;
	diagonalFills: number;
	owningFill: boolean;
	lineChanges: number;
	changes: PreviewLineChange[];
	hasDeletion: boolean;
	hasInsertion: boolean;
	removedNavigable: boolean;
	addedNavigable: boolean;
}

interface PreviewModelDecoration {
	range: { startLineNumber: number; endLineNumber: number };
	options: { className?: string | null; marginClassName?: string | null; glyphMarginClassName?: string | null };
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
	toolbar: ToolbarAudit;
	gutter: GutterAudit;
	gutterProbe?: GutterProbe;
	gutterAlignment?: GutterAlignment;
	navigation?: NavigationProbe;
	folded?: FoldedProbe;
	diffSticky?: StickyProbe;
	collapseAll?: CollapseAllProbe;
	folding?: FoldingProbe;
	sash?: SashProbe;
	content: ContentAudit;
	selected: string | null;
	swap: { before: PaneSnapshot; after: PaneSnapshot } | null;
	syntax?: { text: string; className: string; color: string }[];
	syscond?: SyscondAudit;
	oneSided?: OneSidedAudit;
	sticky?: { visible: boolean; display: string; text: string; rect: Rect | null };
	violations: string[];
}

export interface GutterAlignment {
	mergeActive: boolean;
	items: number;
	visible: number;
	checked: number;
	maxCenterOffset: number;
}

export interface NavigationProbe {
	changes: number[];
	swappedChanges: number[];
	forward: number[];
	backward: number[];
	afterSwap: number[];
}

export interface FoldedProbe {
	label: string;
	visible: string[];
	originalVisible: string[];
	markers: { modified: number; original: number };
	expandedMarkers: { modified: number; original: number };
	diagonalFills: { modified: number; original: number };
	expandedDiagonalFills: { modified: number; original: number };
	hint: string;
}

export interface StickyProbe {
	text: string;
	visible: boolean;
	height: number;
}

export interface CollapseAllProbe {
	original: string[];
	modified: string[];
}

interface GutterProbe {
	present: boolean;
	width: number;
	items: number;
	itemActions: string[][];
	buttons: string[];
	sash: boolean;
	mergeActive: boolean;
	itemDisplay: string;
	itemVisible: boolean;
	currentShowAlways: boolean;
	currentActions: string[];
	clicked: string | null;
	copy: { side?: string; key?: string } | null;
	overflowLabels: string[] | null;
	overflowDebug: string[];
	availability: GutterAvailabilitySnapshot[];
}

interface GutterAvailabilitySnapshot {
	hasItem: boolean;
	hasService: boolean;
	mapping: unknown;
	values: { left: boolean; right: boolean } | null;
	buttons: number;
}

interface SashProbe {
	present: boolean;
	gutterWidth: number;
	initial: [number, number];
	dragged: [number, number];
	afterDocument: [number, number];
	afterSwap: [number, number] | null;
	reset: [number, number] | null;
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

function toolbarAudit(): ToolbarAudit {
	const controls = visibleControls();
	const toolbar = document.querySelector('.toolbar') as HTMLElement | null;
	return {
		controls: controls.length,
		display: toolbar ? getComputedStyle(toolbar).display : '',
		groups: {
			left: groupAudit('.toolbar-left'),
			right: groupAudit('.toolbar-right')
		},
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

function visibleControls(): ToolbarControl[] {
	const elements = Array.from(document.querySelectorAll('.toolbar .tool, .toolbar .search-field'));
	return elements.filter(isVisible).map(controlOf);
}

function controlOf(element: Element): ToolbarControl {
	const group = element.closest('.toolbar-left, .toolbar-right');
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

function gutterProbeOf(): GutterProbe | undefined {
	return (window as unknown as { __GUTTER_PROBE__?: GutterProbe }).__GUTTER_PROBE__;
}

function gutterAlignmentOf(): GutterAlignment | undefined {
	return (window as unknown as { __GUTTER_ALIGNMENT__?: GutterAlignment }).__GUTTER_ALIGNMENT__;
}

function navigationOf(): NavigationProbe | undefined {
	return (window as unknown as { __DIFF_NAVIGATION__?: NavigationProbe }).__DIFF_NAVIGATION__;
}

function foldedOf(): FoldedProbe | undefined {
	return (window as unknown as { __DIFF_FOLDED__?: FoldedProbe }).__DIFF_FOLDED__;
}

function diffStickyOf(): StickyProbe | undefined {
	return (window as unknown as { __DIFF_STICKY__?: StickyProbe }).__DIFF_STICKY__;
}

function collapseAllOf(): CollapseAllProbe | undefined {
	return (window as unknown as { __COLLAPSE_ALL__?: CollapseAllProbe }).__COLLAPSE_ALL__;
}

interface FoldingProbe {
	originalBefore: number;
	originalCollapsed: number;
	originalExpanded: number;
	modifiedBefore: number;
	modifiedCollapsed: number;
	modifiedExpanded: number;
	chevrons: number;
}

function foldingProbeOf(): FoldingProbe | undefined {
	return (window as unknown as { __FOLDING_PROBE__?: FoldingProbe }).__FOLDING_PROBE__;
}

function sashProbeOf(): SashProbe | undefined {
	return (window as unknown as { __SASH_PROBE__?: SashProbe }).__SASH_PROBE__;
}

function gutterAudit(): GutterAudit {
	const cells = Array.from(document.querySelectorAll('.document-tree-line-number[data-status]'));
	const changed = cells.filter((cell) => cell.getAttribute('data-status') !== 'unchanged');
	return {
		cells: cells.length,
		rails: changed.filter((cell) => getComputedStyle(cell).boxShadow !== 'none').length,
		digitsClear: changed.every(digitsClearOfCell)
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
		...pageIssues(state, audit)
	];
}

function oneSidedStateIssues(state: AuditState, audit: Omit<PreviewAudit, 'violations'>): string[] {
	const oneSided = state.name === 'diff-one-sided' || state.name === 'diff-removed' || state.name === 'diff-added';
	if (!oneSided) {
		return [];
	}
	return audit.oneSided === undefined
		? ['the one-sided audit could not read the per-side diff models']
		: oneSidedViolations(audit.oneSided, state.name);
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

/** The one-sided fixture contract, so a fixture edit names the failing expectation. */
const ONE_SIDED_FIXTURE = {
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
		...copiedMarkerIssues(state),
		...stickyStateIssues(state, audit),
		...selectIssues(state, audit),
		...swapViolations(state, audit.swap)
	];
}

/** A copied row must paint its margin marker; the diff paint must not swallow it. */
function copiedMarkerIssues(state: AuditState): string[] {
	if (state.copied !== true) {
		return [];
	}
	const markers = document.querySelectorAll('.arxml-copied-line').length;
	return issueWhen(markers === 0, 'the copied rows did not paint their modified-line marker');
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

function decorationHasClass(options: PreviewModelDecoration['options'], name: string): boolean {
	const value = options.className;
	return typeof value === 'string' && value.split(/\s+/).includes(name);
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

function diffRoots(c: OneSidedContext): HTMLElement[] {
	return [c.originalEditor.getDomNode(), c.modifiedEditor.getDomNode()].filter(
		(root): root is HTMLElement => root !== null
	);
}

function hasVisibleFill(element: Element): boolean {
	const alpha = colorAlpha(getComputedStyle(element).backgroundColor);
	return alpha !== undefined && alpha > 0;
}

/** The owning side keeps its own removed/added fill; the missing side is native paint only. */
function owningFillVisible(root: HTMLElement | null, className: 'line-delete' | 'line-insert'): boolean {
	if (root === null) {
		return false;
	}
	return Array.from(root.querySelectorAll(`.view-overlays > div > .${className}`)).some(hasVisibleFill);
}

function owningFills(c: OneSidedContext, needsDeletion: boolean, needsInsertion: boolean): boolean {
	return (
		(!needsDeletion || owningFillVisible(c.originalEditor.getDomNode(), 'line-delete')) &&
		(!needsInsertion || owningFillVisible(c.modifiedEditor.getDomNode(), 'line-insert'))
	);
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

/**
 * Reads the actual aligned models and the rendered placeholder layers. The fake
 * brace regression lived in the model text, so this audit cannot pass on geometry
 * alone: it walks the exact lines of both one-sided blocks.
 */
function oneSidedAudit(): OneSidedAudit | undefined {
	const context = oneSidedContext();
	return context === undefined ? undefined : oneSidedValues(context);
}

function isPureDeletion(change: PreviewLineChange): boolean {
	return change.modifiedEndLineNumber === 0 && change.originalEndLineNumber >= change.originalStartLineNumber;
}

function isPureInsertion(change: PreviewLineChange): boolean {
	return change.originalEndLineNumber === 0 && change.modifiedEndLineNumber >= change.modifiedStartLineNumber;
}

function placeholderDecorationCount(model: PreviewDiffModel): number {
	return model
		.getAllDecorations()
		.filter((decoration) => decorationHasClass(decoration.options, 'arxml-diff-placeholder')).length;
}

const PLACEHOLDER_ELEMENT_SELECTOR = '.arxml-diff-placeholder, .arxml-diff-placeholder-margin';
const LEGACY_DIFF_LAYER_SELECTOR = [
	'.arxml-diff-merge-margin',
	'.arxml-copy-left-margin',
	'.arxml-copy-right-margin',
	'.arrow-revert-change',
	'.arxml-diff-selection',
	'.arxml-diff-ruler'
].join(', ');

function oneSidedValues(c: OneSidedContext): OneSidedAudit {
	const roots = diffRoots(c);
	const changes = lineChangesOf(c.editor);
	const hasDeletion = changes.some(isPureDeletion);
	const hasInsertion = changes.some(isPureInsertion);
	return {
		originalLines: c.originalModel.getLineCount(),
		modifiedLines: c.modifiedModel.getLineCount(),
		placeholderDecorations:
			placeholderDecorationCount(c.originalModel) + placeholderDecorationCount(c.modifiedModel),
		placeholderElements: roots.reduce(
			(total, root) => total + root.querySelectorAll(PLACEHOLDER_ELEMENT_SELECTOR).length,
			0
		),
		legacyPaint: roots.reduce(
			(total, root) => total + root.querySelectorAll(LEGACY_DIFF_LAYER_SELECTOR).length,
			0
		),
		diagonalFills: document.querySelectorAll('.monaco-diff-editor .diagonal-fill').length,
		owningFill: owningFills(c, hasDeletion, hasInsertion),
		lineChanges: changes.length,
		changes,
		hasDeletion,
		hasInsertion,
		removedNavigable: removedNavigable(c, changes),
		addedNavigable: addedNavigable(c, changes)
	};
}

function oneSidedViolations(audit: OneSidedAudit, stateName: string): string[] {
	const isRemoved = stateName === 'diff-removed';
	const isAdded = stateName === 'diff-added';
	const minimumChanges = isRemoved || isAdded ? 2 : ONE_SIDED_FIXTURE.minLineChanges;
	return [
		...issueWhen(
			audit.placeholderDecorations > 0,
			`the per-side models still carry ${audit.placeholderDecorations} placeholder decorations`
		),
		...issueWhen(
			audit.placeholderElements > 0,
			`the diff body still renders ${audit.placeholderElements} placeholder elements`
		),
		...issueWhen(
			audit.legacyPaint > 0,
			`the diff body still renders ${audit.legacyPaint} legacy merge/selection layers`
		),
		...issueWhen(
			audit.diagonalFills === 0,
			'the one-sided gap does not use the native diagonal fill'
		),
		...issueWhen(!audit.owningFill, 'the owning side lost its native inserted/deleted line fill'),
		...issueWhen(
			audit.lineChanges < minimumChanges,
			`the diff has ${audit.lineChanges} line changes, fewer than the ${minimumChanges} expected`
		),
		...issueWhen(isRemoved && !audit.hasDeletion, 'the removed module is not a deletion hunk'),
		...issueWhen(isAdded && !audit.hasInsertion, 'the added module is not an insertion hunk'),
		...issueWhen(
			!isAdded && !audit.removedNavigable,
			'the removed block is missing from the navigation change list'
		),
		...issueWhen(
			!isRemoved && !audit.addedNavigable,
			'the added block is missing from the navigation change list'
		),
		...issueWhen(
			(isRemoved || isAdded) && audit.originalLines === audit.modifiedLines,
			'the per-side models still have equal line counts'
		)
	];
}


function diffViolations(state: AuditState, audit: Omit<PreviewAudit, 'violations'>): string[] {
	if (!usesMonacoDiff()) {
		return ['the Monaco diff editor did not mount'];
	}
	return [
		...monacoDiffViolations(state),
		...gutterProbeViolations(state, audit.gutterProbe),
		...gutterAlignmentIssues(state, audit.gutterAlignment),
		...navigationIssues(state, audit.navigation),
		...foldedIssues(state, audit.folded),
		...diffStickyIssues(state, audit.diffSticky),
		...collapseAllIssues(state, audit.collapseAll),
		...foldingViolations(state, audit.folding),
		...sashViolations(state, audit.sash),
		...mergePressViolations(state, audit)
	];
}

const GUTTER_ACTION_LABELS = new Set(['Copy Block to Left', 'Copy Block to Right', 'More Actions...']);

function gutterProbeViolations(state: AuditState, probe: GutterProbe | undefined): string[] {
	if (state.page !== 'diff' || state.foldLabel !== undefined || state.collapseAll === true) {
		return [];
	}
	if (probe === undefined) {
		return ['the built-in diff gutter probe did not run'];
	}
	return [
		...issueWhen(!probe.present, 'the built-in diff gutter did not mount'),
		...issueWhen(
			probe.width < 30 || probe.width > 45,
			`the built-in diff gutter is ${probe.width}px wide`
		),
		...issueWhen(state.merge && probe.items === 0, 'the built-in diff gutter has no hunk items'),
		...issueWhen(!probe.sash, 'the built-in diff sash did not mount'),
		...issueWhen(
			probe.mergeActive !== Boolean(state.merge),
			`the Merge state is ${probe.mergeActive}, expected ${Boolean(state.merge)}`
		),
		...issueWhen(probe.buttons.includes('Revert Block'), 'the built-in Revert action is still visible'),
		...probe.buttons
			.filter((label) => !GUTTER_ACTION_LABELS.has(label))
			.map((label) => `unexpected gutter action ${label}`),
		...mergeGutterIssues(state, probe)
	];
}

function mergeGutterIssues(state: AuditState, probe: GutterProbe): string[] {
	if (!state.merge) {
		return [
			...issueWhen(
				probe.items > 0 && probe.itemVisible,
				'gutter copy actions are visible while Merge is off'
			),
			...issueWhen(probe.copy !== null, 'a gutter copy fired while Merge is off')
		];
	}
	return [
		...issueWhen(!probe.itemVisible, 'gutter copy actions are hidden inside Merge'),
		...issueWhen(
			state.name !== 'diff-removed' && !probe.currentShowAlways,
			'the current hunk is not marked showAlways'
		),
		...copyTargetIssues(state, probe),
		...renderedActionIssues(state, probe),
		...availabilityIssues(state, probe)
	];
}

const COPY_LEFT_LABEL = 'Copy Block to Left';
const COPY_RIGHT_LABEL = 'Copy Block to Right';

function renderedActionIssues(state: AuditState, probe: GutterProbe): string[] {
	if (state.name === 'diff-removed' || state.name === 'diff-added') {
		const first = probe.itemActions[0] ?? [];
		return [
			...issueWhen(
				!first.includes(COPY_LEFT_LABEL) || !first.includes(COPY_RIGHT_LABEL),
				'the one-sided hunk does not render both copy directions'
			)
		];
	}
	if (state.name === 'diff-merge' || state.name === 'diff-swap' || state.name === 'diff-sash') {
		return probe.itemActions
			.filter((actions) => actions.length === 1 && actions[0] !== 'More Actions...')
			.map(() => 'a changed hunk renders only one copy action');
	}
	return [];
}

function copyTargetIssues(state: AuditState, probe: GutterProbe): string[] {
	if (probe.clicked === 'More Actions...') {
		const labels = probe.overflowLabels ?? [];
		const hasBoth = labels.includes(COPY_LEFT_LABEL) && labels.includes(COPY_RIGHT_LABEL);
		return [
			...issueWhen(probe.overflowLabels === null, 'the gutter overflow menu did not open'),
			...issueWhen(
				state.name === 'diff-one-sided' && !hasBoth,
				'the overflow menu does not offer both copy actions'
			)
		];
	}
	const expected = expectedCopySide(state.swap === true, probe.clicked);
	return [
		...issueWhen(probe.clicked === null, 'no gutter copy action was available'),
		...issueWhen(probe.copy === null, 'clicking the gutter action did not post a host copy'),
		...issueWhen(
			probe.copy !== null && probe.copy.side !== expected,
			`the gutter copy posted side ${probe.copy?.side ?? '<none>'}, expected ${expected}`
		),
		...issueWhen(
			probe.copy !== null && !probe.copy.key?.includes(':'),
			'the gutter copy posted no semantic row key'
		)
	];
}

function expectedCopySide(swapped: boolean, action: string | null): 'left' | 'right' | undefined {
	if (action === 'Copy Block to Left') {
		return swapped ? 'left' : 'right';
	}
	if (action === 'Copy Block to Right') {
		return swapped ? 'right' : 'left';
	}
	return undefined;
}

function availabilityIssues(state: AuditState, probe: GutterProbe): string[] {
	if (
		state.name !== 'diff-merge' &&
		state.name !== 'diff-swap' &&
		state.name !== 'diff-sash' &&
		state.name !== 'diff-removed' &&
		state.name !== 'diff-added'
	) {
		return [];
	}
	return probe.availability
		.filter((item) => item.values !== null && (!item.values.left || !item.values.right))
		.map(() => 'a changed hunk hides a copy action');
}

function foldingViolations(state: AuditState, probe: FoldingProbe | undefined): string[] {
	if (state.page !== 'diff' || state.foldLabel !== undefined || state.collapseAll === true) {
		return [];
	}
	if (probe === undefined) {
		return ['the diff folding probe did not run'];
	}
	return [
		...issueWhen(
			probe.originalCollapsed >= probe.originalBefore,
			'Collapse All did not hide original-pane rows'
		),
		...issueWhen(
			probe.originalExpanded !== probe.originalBefore,
			'Expand All did not restore the original-pane rows'
		),
		...issueWhen(
			probe.modifiedCollapsed >= probe.modifiedBefore,
			'Collapse All did not hide modified-pane rows'
		),
		...issueWhen(
			probe.modifiedExpanded !== probe.modifiedBefore,
			'Expand All did not restore the modified-pane rows'
		)
	];
}

function widthPairMatches(left: [number, number], right: [number, number]): boolean {
	return Math.abs(left[0] - right[0]) <= 4 && Math.abs(left[1] - right[1]) <= 4;
}

function sashViolations(state: AuditState, probe: SashProbe | undefined): string[] {
	if (state.page !== 'diff' || !state.sash) {
		return [];
	}
	if (probe === undefined) {
		return ['the diff sash probe did not run'];
	}
	const issues = [
		...issueWhen(!probe.present, 'the diff sash was not found for the drag probe'),
		...issueWhen(
			Math.abs(probe.initial[0] + probe.gutterWidth - probe.initial[1]) > 4,
			`the diff panes start at ${probe.initial[0]}px and ${probe.initial[1]}px, not 50/50`
		),
		...issueWhen(
			probe.dragged[0] <= probe.initial[0] + 60,
			'dragging the sash did not widen the left pane'
		),
		...issueWhen(
			!widthPairMatches(probe.dragged, probe.afterDocument),
			'the sash ratio reset when the document was replaced'
		),
		...issueWhen(probe.reset === null, 'the sash double-click reset was not measured'),
		...issueWhen(
			probe.reset !== null &&
				Math.abs(probe.reset[0] + probe.gutterWidth - probe.reset[1]) > 4,
			'the sash double-click did not restore 50/50'
		)
	];
	if (state.swap) {
		issues.push(
			...issueWhen(probe.afterSwap === null, 'the sash ratio after Swap was not measured'),
			...issueWhen(
				probe.afterSwap !== null && !widthPairMatches(probe.dragged, probe.afterSwap),
				'the sash ratio reset when the panes were swapped'
			)
		);
	}
	return issues;
}


function mergePressViolations(state: AuditState, audit: Omit<PreviewAudit, 'violations'>): string[] {
	if (!state.merge || audit.toolbar.mergePressed === true) {
		return [];
	}
	return ['Merge is not pressed'];
}

function gutterAlignmentIssues(
	state: AuditState,
	alignment: GutterAlignment | undefined
): string[] {
	if (state.page !== 'diff' || state.name === 'diff-collapsed-onesided' || state.foldLabel !== undefined || state.collapseAll === true) {
		return [];
	}
	if (alignment === undefined) {
		return ['the gutter alignment probe did not run'];
	}
	if (alignment.mergeActive !== Boolean(state.merge)) {
		return [];
	}
	if (alignment.items === 0) {
		// The gutter probe later owns item existence; an early empty snapshot is a
		// render race, not a Merge-visibility regression.
		return [];
	}
	if (!state.merge) {
		return issueWhen(
			alignment.visible > 0,
			'gutter copy actions are visible while Merge is off'
		);
	}
	return [
		...issueWhen(alignment.visible === 0, 'gutter copy actions are hidden inside Merge'),
		...issueWhen(
			alignment.visible > 0 && alignment.checked === 0,
			'the gutter alignment probe found no compact hunk to measure'
		),
		...issueWhen(
			alignment.maxCenterOffset > 1,
			`the gutter copy buttons are ${alignment.maxCenterOffset}px off the hunk centre`
		)
	];
}

function navigationIssues(state: AuditState, navigation: NavigationProbe | undefined): string[] {
	if (state.page !== 'diff' || state.name !== 'diff-nav') {
		return [];
	}
	if (navigation === undefined) {
		return ['the navigation probe did not run'];
	}
	const issues: string[] = [];
	if (navigation.changes.length < 2) {
		issues.push(`the navigation fixture has ${navigation.changes.length} changes, not at least 2`);
	}
	if (new Set(navigation.changes).size !== navigation.changes.length) {
		issues.push('the navigation change list contains duplicate lines');
	}
	issues.push(
		...cyclicSequenceIssues('Next', navigation.forward, navigation.changes),
		...cyclicSequenceIssues('Prev', navigation.backward, [...navigation.changes].reverse()),
		...cyclicSequenceIssues('Next after Swap', navigation.afterSwap, navigation.swappedChanges)
	);
	return issues;
}

function cyclicSequenceIssues(label: string, sequence: number[], expected: number[]): string[] {
	const count = expected.length;
	if (count === 0) {
		return [`${label} has no expected change lines`];
	}
	if (sequence.length !== count + 1) {
		return [`${label} recorded ${sequence.length} steps for ${count} changes`];
	}
	if (new Set(sequence).size !== count) {
		return [`${label} did not cover every change exactly once before wrapping`];
	}
	const start = expected.indexOf(sequence[0]);
	if (start < 0) {
		return [`${label} starts at line ${sequence[0]}, outside the change list`];
	}
	for (let step = 0; step <= count; step += 1) {
		const wanted = expected[(start + step) % count];
		if (sequence[step] !== wanted) {
			return [
				`${label} step ${step} is line ${sequence[step]}, expected ${wanted}`
			];
		}
	}
	return [];
}

function diffStickyIssues(state: AuditState, sticky: StickyProbe | undefined): string[] {
	if (state.name !== 'diff-sticky') {
		return [];
	}
	if (sticky === undefined) {
		return ['the diff sticky probe did not run'];
	}
	return [
		...issueWhen(!sticky.visible, 'the diff sticky header is not visible'),
		...issueWhen(
			!sticky.text.includes('Items "Items"'),
			`the diff sticky header reads "${sticky.text}", not the Items header`
		),
		...issueWhen(
			sticky.text.trim() === '{',
			'the diff sticky header still shows only the opening brace'
		)
	];
}

function collapseAllIssues(
	state: AuditState,
	probe: CollapseAllProbe | undefined
): string[] {
	if (state.name !== 'diff-collapse-all') {
		return [];
	}
	if (probe === undefined) {
		return ['the Collapse All probe did not run'];
	}
	const has = (lines: string[], text: string): boolean =>
		lines.some((line) => line.includes(text));
	return [
		...issueWhen(
			!has(probe.original, 'module P.RemovedMod'),
			'the left-only module header is missing after Collapse All'
		),
		...issueWhen(
			has(probe.original, 'RemovedValue'),
			'Collapse All left the left-only container expanded'
		),
		...issueWhen(
			has(probe.original, 'ChangedValue') || has(probe.modified, 'ChangedValue'),
			'Collapse All left a shared container expanded'
		),
		...issueWhen(
			!has(probe.modified, 'module P.Shared'),
			'the shared module header is missing after Collapse All'
		)
	];
}

function foldedIssues(state: AuditState, folded: FoldedProbe | undefined): string[] {
	const oneSided = state.name === 'diff-collapsed-onesided';
	if (state.name !== 'diff-collapsed' && !oneSided) {
		return [];
	}
	if (folded === undefined) {
		return ['the collapsed-row probe did not run'];
	}
	const header = folded.visible.find((line) => line.includes(folded.label));
	const originalHeader = folded.originalVisible.find((line) => line.includes(folded.label));
	return [
		...issueWhen(header === undefined, `the collapsed row does not show ${folded.label}`),
		...issueWhen(
			originalHeader === undefined,
			`the other pane did not receive the ${folded.label} fold`
		),
		...issueWhen(
			folded.visible.some((line) => line.includes('P0000')),
			'the collapsed row still shows its child parameters'
		),
		...issueWhen(
			folded.originalVisible.some((line) => line.includes('P0000')),
			'the other pane still shows the collapsed child parameters'
		),
		...issueWhen(
			folded.markers.modified < 1 || folded.markers.original < 1,
			'the collapsed row has no hidden-difference marker in both panes'
		),
		...(!oneSided
			? [
					...issueWhen(
						folded.expandedMarkers.modified !== 0 ||
							folded.expandedMarkers.original !== 0,
						'the hidden-difference marker was not cleared after expansion'
					)
				]
			: []),
		...(oneSided
			? [
					...issueWhen(
						folded.diagonalFills.modified !== 0 || folded.diagonalFills.original !== 0,
						'the folded one-sided gap still renders a diagonal fill'
					)
				]
			: []),
		...issueWhen(
			!folded.hint.includes('⋯'),
			'the collapsed row has no fold hint'
		)
	];
}

interface PreviewSnapshotModel {
	getValue(): string;
}

interface PreviewSnapshotEditor {
	getModel(): PreviewSnapshotModel | null;
}

interface PreviewSnapshotDiff {
	getOriginalEditor(): PreviewSnapshotEditor;
	getModifiedEditor(): PreviewSnapshotEditor;
}

/** A capture-able before/after view of the panes for the Swap state. */
export function paneSnapshot(): PaneSnapshot {
	const diff = (window as unknown as { __ARXML_DIFF_EDITOR__?: PreviewSnapshotDiff })
		.__ARXML_DIFF_EDITOR__;
	const left = diff?.getOriginalEditor().getModel()?.getValue().slice(0, 400) ?? '';
	const right = diff?.getModifiedEditor().getModel()?.getValue().slice(0, 400) ?? '';
	return {
		leftTitle: titleOf('diff-title-left'),
		rightTitle: titleOf('diff-title-right'),
		leftValue: left,
		rightValue: right
	};
}

function titleOf(id: string): string {
	const element = document.getElementById(id);
	return element === null ? '' : textOf(element);
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
		toolbar: toolbarAudit(),
		gutter: gutterAudit(),
		gutterProbe: gutterProbeOf(),
		gutterAlignment: gutterAlignmentOf(),
		navigation: navigationOf(),
		folded: foldedOf(),
		diffSticky: diffStickyOf(),
		collapseAll: collapseAllOf(),
		folding: foldingProbeOf(),
		sash: sashProbeOf(),
		content: contentAudit(),
		selected: selectedKey(),
		swap: swapSnapshot(swapBefore),
		sticky: stickyOf(state),
		syntax: syntaxOf(state),
		syscond: syscondOf(state),
		oneSided: oneSidedOf(state)
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
	return state.name === 'diff-one-sided' || state.name === 'diff-removed' || state.name === 'diff-added'
		? oneSidedAudit()
		: undefined;
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
