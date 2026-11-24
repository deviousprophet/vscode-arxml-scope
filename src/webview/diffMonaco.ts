/**
 * The Monaco semantic-diff page.
 *
 * The host still owns the semantic comparison. This page turns each
 * `DiffDocument` row into the per-side synthetic ECUC document that owns it and
 * lets Monaco's built-in diff editor render the body: per-side line numbers,
 * inserted/deleted fills, word spans, indicators, diagonal gaps and unchanged
 * regions. Merge mode binds the built-in diff-margin arrow to the semantic copy
 * and adds the single copy-to-left arrow.
 */
import './styles/tokens.css';
import './styles/base.css';
import './components/diffView/diffView.css';
import './monaco/monaco.css';
import type { DiffDocument, DiffHeader } from '../core/diff/diffModel';
import { applyDiffPatch, type DiffPatch } from '../core/diff/diffPatch';
import type { DiffFindMatch, FindOptions } from '../core/searchModel';
import type { DiffProviderToWebview } from '../diffProtocol';
import type { MonacoSettings } from '../webviewProtocol';
import {
	buildDiffSyntheticDocuments,
	searchRangeOnLine,
	type DiffSyntheticDocuments,
	type SyntheticDocument
} from './monaco/synthetic';
import { defineEcucTheme, editorFontOptions, ensureMonacoEnvironment, monaco, setModelFolding } from './monaco/setup';
import { settingsOptions } from './monaco/settings';
import {
	buildDiffBody,
	cursorChangeIndex,
	linesOnSide,
	navigationTarget,
	semanticChanges,
	stepChange,
	type DiffBody,
	type DiffBodyRow,
	type DiffSide,
	type SemanticChange
} from './monaco/diffBody';
import { installFindBridge, startFindController, type MonacoFindMatch } from './monaco/findBridge';
import { DiffToolbar } from './components/toolbar/toolbar';
import { installNoticeErrors } from './render/pageError';
import { postToHost } from './vscodeApi';

let documentModel: DiffDocument | undefined;
let body: DiffBody | undefined;
let synthetic: DiffSyntheticDocuments | undefined;
let leftModel: monaco.editor.ITextModel | undefined;
let rightModel: monaco.editor.ITextModel | undefined;
let diffEditor: monaco.editor.IStandaloneDiffEditor | undefined;
let toolbar: DiffToolbar | undefined;
let swapped = false;
let mergeMode = false;
let changesOnly = false;
let contextActive = true;
let semantic = true;
let selectedKey: string | undefined;
/** The pane the user last put the caret in; toolbar clicks do not clear it. */
let focusedPane: 'original' | 'modified' = 'modified';
/** View-zone ids for the extra copy-to-left arrows in the modified margin. */
let leftArrowZones: string[] = [];
interface DiffNativeQuery {
	query: string;
	options: FindOptions;
	changesOnly: boolean;
}
interface DiffNativeMatches {
	left: MonacoFindMatch[];
	right: MonacoFindMatch[];
}
interface DiffFindController {
	getState?(): {
		isRevealed: boolean;
		isReplaceRevealed: boolean;
		searchString: string;
		replaceString: string;
		preserveCase: boolean;
		isRegex: boolean;
		wholeWord: boolean;
		matchCase: boolean;
	};
	start?(opts: unknown, state?: unknown): Promise<void>;
}
type DiffFindState = NonNullable<ReturnType<NonNullable<DiffFindController['getState']>>>;
let diffFindCache = new Map<string, DiffNativeMatches>();
let diffFindQueries = new Map<string, DiffNativeQuery>();
let diffFindRequested = new Set<string>();
let diffFindRequests = new Map<number, string>();
let diffFindRequestId = 0;
let mounted = false;
const pendingMessages: DiffProviderToWebview[] = [];

if (typeof window !== 'undefined') {
	window.addEventListener('message', function (event) {
		const message = event.data as DiffProviderToWebview;
		if (!mounted) {
			pendingMessages.push(message);
			return;
		}
		handleMessage(message);
	});
}

function originalKeys(): (string | undefined)[] {
	if (synthetic === undefined) {
		return [];
	}
	if (swapped) {
		return synthetic.rightLineKeys;
	}
	return synthetic.leftLineKeys;
}

function modifiedKeys(): (string | undefined)[] {
	if (synthetic === undefined) {
		return [];
	}
	if (swapped) {
		return synthetic.leftLineKeys;
	}
	return synthetic.rightLineKeys;
}

function originalEditor(): monaco.editor.ICodeEditor | undefined {
	return diffEditor?.getOriginalEditor();
}

function modifiedEditor(): monaco.editor.ICodeEditor | undefined {
	return diffEditor?.getModifiedEditor();
}

function lineFor(key: string | undefined, doc: SyntheticDocument | undefined): number | undefined {
	if (key === undefined || doc === undefined) {
		return undefined;
	}
	return doc.rowLine.get(key);
}

function keyAt(editor: monaco.editor.ICodeEditor | undefined, line: number, side: 'original' | 'modified'): string | undefined {
	if (editor === undefined) {
		return undefined;
	}
	const keys = side === 'original' ? originalKeys() : modifiedKeys();
	return keys[line - 1];
}

function sideDocument(side: DiffSide): SyntheticDocument | undefined {
	return side === 'left' ? synthetic?.left : synthetic?.right;
}

function findFlag(value: boolean): string {
	return value ? '1' : '0';
}

function diffFindKey(query: string, options: FindOptions, onlyChanges: boolean): string {
	return `${findFlag(onlyChanges)}|${findFlag(options.caseSensitive)}|${findFlag(options.wholeWord)}|${findFlag(
		options.regex
	)}|${query}`;
}

function diffFindOptions(isRegex: boolean, matchCase: boolean, wordSeparators: string | null): FindOptions {
	return {
		caseSensitive: matchCase,
		wholeWord: wordSeparators !== null && wordSeparators !== undefined,
		regex: isRegex
	};
}

function requestDiffFind(query: string, options: FindOptions): void {
	if (query === '') {
		return;
	}
	const key = diffFindKey(query, options, changesOnly);
	if (diffFindCache.has(key) || diffFindRequested.has(key)) {
		return;
	}
	diffFindRequested.add(key);
	diffFindQueries.set(key, { query, options, changesOnly });
	const requestId = (diffFindRequestId += 1);
	diffFindRequests.set(requestId, key);
	postToHost({ type: 'find', requestId, query, options, changesOnly });
}

function diffMatchesFor(side: DiffSide, query: string, options: FindOptions): MonacoFindMatch[] {
	return diffFindCache.get(diffFindKey(query, options, changesOnly))?.[side] ?? [];
}

/** One host match projected onto its synthetic line, when both resolve. */
function toMonacoFindMatch(match: DiffFindMatch, doc: SyntheticDocument): MonacoFindMatch | undefined {
	const line = lineFor(match.key, doc);
	if (line === undefined) {
		return undefined;
	}
	const lineText = doc.lines[line - 1];
	if (lineText === undefined) {
		return undefined;
	}
	const range = searchRangeOnLine(lineText, match);
	if (range === undefined) {
		return undefined;
	}
	return {
		range: new monaco.Range(line, range.startColumn, line, range.endColumn),
		matches: [lineText.text.slice(range.startColumn - 1, range.endColumn - 1)]
	} as unknown as MonacoFindMatch;
}

function mapSideMatches(
	result: { matches: DiffFindMatch[] },
	side: DiffSide,
	doc: SyntheticDocument
): MonacoFindMatch[] {
	const out: MonacoFindMatch[] = [];
	for (const match of result.matches) {
		if (match.side !== side) {
			continue;
		}
		const mapped = toMonacoFindMatch(match, doc);
		if (mapped === undefined) {
			continue;
		}
		out.push(mapped);
	}
	return out;
}

function dedupeFindMatches(matches: MonacoFindMatch[]): MonacoFindMatch[] {
	const out: MonacoFindMatch[] = [];
	const seen = new Set<string>();
	for (const match of matches) {
		const { range } = match;
		const key = `${range.startLineNumber}:${range.startColumn}:${range.endColumn}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(match);
	}
	return out;
}

function mapDiffSideMatches(
	result: { matches: DiffFindMatch[] },
	side: DiffSide
): MonacoFindMatch[] {
	const doc = sideDocument(side);
	if (doc === undefined) {
		return [];
	}
	const out = dedupeFindMatches(mapSideMatches(result, side, doc));
	out.sort((left, right) => monaco.Range.compareRangesUsingStarts(left.range, right.range));
	return out;
}

/** The find contribution when it exists and can start a search. */
function findController(editor: monaco.editor.ICodeEditor | undefined): DiffFindController | undefined {
	const controller = editor?.getContribution('editor.contrib.findController') as DiffFindController | null;
	if (controller === null || controller === undefined || controller.start === undefined) {
		return undefined;
	}
	return controller;
}

/** The controller's live search state, only while the find widget is open. */
function revealedFindState(controller: DiffFindController): DiffFindState | undefined {
	const state = controller.getState?.();
	if (state === undefined || !state.isRevealed) {
		return undefined;
	}
	return state;
}

function findStateMatches(state: DiffFindState, query: string, options: FindOptions): boolean {
	if (state.searchString !== query) {
		return false;
	}
	if (state.isRegex !== options.regex) {
		return false;
	}
	if (state.wholeWord !== options.wholeWord) {
		return false;
	}
	return state.matchCase === options.caseSensitive;
}

function restartDiffFind(
	controller: DiffFindController,
	state: DiffFindState,
	query: string,
	options: FindOptions
): void {
	startFindController(controller, state, query, options);
}

function refreshEditorDiffFind(
	editor: monaco.editor.ICodeEditor | undefined,
	query: string,
	options: FindOptions
): void {
	const controller = findController(editor);
	if (controller === undefined) {
		return;
	}
	const state = revealedFindState(controller);
	if (state === undefined) {
		return;
	}
	if (!findStateMatches(state, query, options)) {
		return;
	}
	restartDiffFind(controller, state, query, options);
}

function refreshDiffFind(query: string, options: FindOptions): void {
	if (query === '') {
		return;
	}
	for (const editor of [originalEditor(), modifiedEditor()]) {
		refreshEditorDiffFind(editor, query, options);
	}
}

interface PendingDiffFind {
	key: string;
	query: DiffNativeQuery;
}

function takeDiffFindQuery(requestId: number): PendingDiffFind | undefined {
	const key = diffFindRequests.get(requestId);
	if (key === undefined) {
		return undefined;
	}
	diffFindRequests.delete(requestId);
	diffFindRequested.delete(key);
	const query = diffFindQueries.get(key);
	if (query === undefined) {
		return undefined;
	}
	return { key, query };
}

function diffFindMatches(result: { matches: DiffFindMatch[] }, error?: string): DiffNativeMatches {
	if (error !== undefined) {
		return { left: [], right: [] };
	}
	return {
		left: mapDiffSideMatches(result, 'left'),
		right: mapDiffSideMatches(result, 'right')
	};
}

function applyDiffFindResult(requestId: number, result: { matches: DiffFindMatch[] }, error?: string): void {
	const pending = takeDiffFindQuery(requestId);
	if (pending === undefined) {
		return;
	}
	if (error !== undefined) {
		setNotice(error, 'error');
	}
	diffFindCache.set(pending.key, diffFindMatches(result, error));
	refreshDiffFind(pending.query.query, pending.query.options);
}

function resetDiffFindCache(): void {
	diffFindCache.clear();
	diffFindQueries.clear();
	diffFindRequested.clear();
	diffFindRequests.clear();
}

function resumeEditorDiffFind(editor: monaco.editor.ICodeEditor | undefined): void {
	const controller = findController(editor);
	if (controller === undefined) {
		return;
	}
	const state = revealedFindState(controller);
	if (state === undefined) {
		return;
	}
	if (state.searchString === '') {
		return;
	}
	refreshDiffFind(state.searchString, {
		caseSensitive: state.matchCase,
		wholeWord: state.wholeWord,
		regex: state.isRegex
	});
}

function invalidateDiffFind(): void {
	resetDiffFindCache();
	if (synthetic === undefined) {
		return;
	}
	for (const editor of [originalEditor(), modifiedEditor()]) {
		resumeEditorDiffFind(editor);
	}
}

/** Wire one pane's engine matches into Monaco's native find hooks. */
function installSideFindBridge(target: monaco.editor.ITextModel, side: DiffSide): void {
	installFindBridge(target, {
		options: diffFindOptions,
		matches: function (searchString, options) {
			return diffMatchesFor(side, searchString, options);
		},
		request: requestDiffFind
	});
}

function updateDiffOptions(): void {
	if (diffEditor === undefined) {
		return;
	}
	diffEditor.updateOptions({
		hideUnchangedRegions: {
			enabled: changesOnly,
			contextLineCount: contextActive ? 5 : 0,
			minimumLineCount: 3
		}
	});
	// The Rust diff search is scoped to the current view, so a view toggle
	// needs a fresh query instead of last view's match set.
	invalidateDiffFind();
	syncBodyState();
}

function setNotice(text: string, kind: 'warn' | 'error' = 'warn'): void {
	const notice = document.getElementById('diff-notice');
	if (notice === null) {
		return;
	}
	notice.textContent = text;
	notice.dataset.kind = kind;
}

function clearNotice(): void {
	const notice = document.getElementById('diff-notice');
	if (notice === null) {
		return;
	}
	notice.textContent = '';
	delete notice.dataset.kind;
}

function setEmpty(visible: boolean): void {
	const empty = document.getElementById('diff-empty');
	const text = document.getElementById('diff-empty-text');
	if (empty !== null) {
		empty.hidden = !visible;
	}
	if (visible && text !== null) {
		text.textContent = 'No differences';
	}
}

function headerTooltip(header: DiffHeader): string {
	const lines: string[] = [];
	if (header.schema !== undefined && header.schema !== '') {
		lines.push(`schema ${header.schema}`);
	}
	for (const pkg of header.packages) {
		lines.push(`package ${pkg}`);
	}
	return lines.join('\n');
}

function labelFor(model: DiffDocument, index: 0 | 1): string {
	if (swapped) {
		return model.labels[index === 0 ? 1 : 0];
	}
	return model.labels[index];
}

function headerFor(model: DiffDocument, side: DiffSide): DiffHeader {
	if (side === 'left') {
		return swapped ? model.rightHeader : model.leftHeader;
	}
	return swapped ? model.leftHeader : model.rightHeader;
}

function pathFor(model: DiffDocument, side: DiffSide): string {
	if (side === 'left') {
		return swapped ? model.right.path : model.left.path;
	}
	return swapped ? model.left.path : model.right.path;
}

function setTitle(id: string, label: string, header: DiffHeader, path: string): void {
	const element = document.getElementById(id);
	if (element === null) {
		return;
	}
	element.textContent = label + (header.schema !== undefined ? ` · ${header.schema}` : '');
	element.title = [path, headerTooltip(header)].filter((part) => part !== '').join('\n');
}

function setTitles(): void {
	if (documentModel === undefined) {
		return;
	}
	const model = documentModel;
	setTitle('diff-title-left', labelFor(model, 0), headerFor(model, 'left'), pathFor(model, 'left'));
	setTitle('diff-title-right', labelFor(model, 1), headerFor(model, 'right'), pathFor(model, 'right'));
}

function setModelText(model: monaco.editor.ITextModel | undefined, source: SyntheticDocument): void {
	if (model === undefined) {
		return;
	}
	model.setValue(source.text);
	setModelFolding(model, source.foldingRanges);
}

function setModelTexts(docs: DiffSyntheticDocuments): void {
	setModelText(leftModel, docs.left);
	setModelText(rightModel, docs.right);
}

/** The model shown in `pane`, following the swap state. */
function paneModel(
	pane: 'original' | 'modified',
	left: monaco.editor.ITextModel,
	right: monaco.editor.ITextModel
): monaco.editor.ITextModel {
	const showRight = pane === 'original' ? swapped : !swapped;
	return showRight ? right : left;
}

function setDiffModel(): void {
	if (diffEditor === undefined) {
		return;
	}
	if (leftModel === undefined || rightModel === undefined) {
		return;
	}
	const left = leftModel;
	const right = rightModel;
	diffEditor.setModel({
		original: paneModel('original', left, right),
		modified: paneModel('modified', left, right)
	});
}

function isEmptyDocument(doc: DiffDocument): boolean {
	return doc.summary.changed + doc.summary.added + doc.summary.removed === 0;
}

function showSemanticSkip(count: number): void {
	const skip = document.getElementById('diff-semantic-skip');
	if (skip === null) {
		return;
	}
	skip.hidden = count === 0;
	skip.textContent = count === 0 ? '' : `${count} container(s) could not be paired semantically.`;
}

function syncToolbarState(): void {
	toolbar?.setMatchMode(semantic, false);
	toolbar?.setViewMode(changesOnly);
	toolbar?.setContext(contextActive);
	toolbar?.setSwapped(swapped);
	toolbar?.setMergeMode(mergeMode);
}

function applyDocument(next: DiffDocument, nextSemantic: boolean): void {
	documentModel = next;
	semantic = nextSemantic;
	const docs = buildDiffSyntheticDocuments(next);
	synthetic = docs;
	body = buildDiffBody(next, docs);
	setModelTexts(docs);
	setDiffModel();
	selectedKey = undefined;
	setTitles();
	syncToolbarState();
	updateDiffOptions();
	setEmpty(isEmptyDocument(next));
	showSemanticSkip(next.semanticSkipped);
	clearNotice();
	syncBodyState();
	renderCopyArrows();
}

const BODY_CLASSES = ['arxml-diff-body', 'arxml-diff-gutter', 'arxml-diff-status'] as const;

function addBodyClasses(element: Element | null | undefined): void {
	element?.classList.add(...BODY_CLASSES);
}

function applyBodyClasses(): void {
	addBodyClasses(document.getElementById('diff-monaco'));
	addBodyClasses(originalEditor()?.getDomNode());
	addBodyClasses(modifiedEditor()?.getDomNode());
}

function setSummaryData(host: HTMLElement, summary: DiffDocument['summary'] | undefined): void {
	if (summary === undefined) {
		return;
	}
	host.dataset.bodyChanged = String(summary.changed);
	host.dataset.bodyAdded = String(summary.added);
	host.dataset.bodyRemoved = String(summary.removed);
	host.dataset.bodyRenamed = String(summary.renamed);
}

function setBodyRowCount(host: HTMLElement, current: DiffBody | undefined): void {
	if (current === undefined) {
		return;
	}
	host.dataset.bodyRows = String(current.rows.length);
}

function setBodyData(host: HTMLElement): void {
	host.dataset.merge = mergeMode ? 'true' : 'false';
	host.dataset.swapped = swapped ? 'true' : 'false';
	setSummaryData(host, documentModel?.summary);
	setBodyRowCount(host, body);
}

function previewBodyRows(): Array<Omit<DiffBodyRow, 'leftCell' | 'rightCell'>> {
	return (body?.rows ?? []).map((row) => ({
		key: row.key,
		status: row.status,
		...(row.leftLine === undefined ? {} : { leftLine: row.leftLine }),
		...(row.rightLine === undefined ? {} : { rightLine: row.rightLine }),
		leftLines: row.leftLines,
		rightLines: row.rightLines,
		changes: row.changes,
		renamed: row.renamed
	}));
}

function previewMode(): { changesOnly: boolean; contextActive: boolean; swapped: boolean; merge: boolean } {
	return { changesOnly, contextActive, swapped, merge: mergeMode };
}

function isPreview(): boolean {
	return (window as unknown as { __PREVIEW__?: unknown }).__PREVIEW__ !== undefined;
}

function publishNavigation(change: SemanticChange, target: { side: DiffSide; line: number }): void {
	if (!isPreview()) {
		return;
	}
	const windowWithPreview = window as unknown as {
		__ARXML_DIFF_NAV__?: unknown;
		__ARXML_DIFF_NAV_HISTORY__?: unknown[];
	};
	const entry = {
		key: change.key,
		status: change.status,
		order: change.order,
		renamed: change.renamed,
		side: target.side,
		line: target.line
	};
	windowWithPreview.__ARXML_DIFF_NAV__ = entry;
	windowWithPreview.__ARXML_DIFF_NAV_HISTORY__ = [
		...(windowWithPreview.__ARXML_DIFF_NAV_HISTORY__ ?? []),
		entry
	];
}

/**
 * Publish the body classes, mode data and (in the preview) the semantic rows.
 * The decorations and the DOM both derive from the same adapter, so a child
 * audit never has to re-map a display line to a semantic row.
 */
function syncBodyState(): void {
	const host = document.getElementById('diff-monaco');
	if (host === null) {
		return;
	}
	host.classList.toggle('arxml-diff-merge', mergeMode);
	applyBodyClasses();
	setBodyData(host);
	if (isPreview()) {
		(window as unknown as { __ARXML_DIFF_BODY__?: unknown }).__ARXML_DIFF_BODY__ = {
			rows: previewBodyRows(),
			mode: previewMode()
		};
	}
}

/** Apply the host's curated editor settings to both diff editors. */
function applyDiffSettings(settings: MonacoSettings): void {
	if (diffEditor !== undefined) {
		diffEditor.updateOptions({
			...settingsOptions(settings),
			// The diff body never grows a minimap, whatever the editor preference is.
			minimap: { enabled: false },
			wordWrap: settings.wordWrap ?? 'off'
		});
	}
	applyBodyTypography(settings);
}

/** Mirror the editor typography into the body CSS hooks. */
function bodyLineHeight(settings: MonacoSettings): number | undefined {
	if (settings.lineHeight !== undefined && settings.lineHeight > 0) {
		return settings.lineHeight;
	}
	if (settings.fontSize === undefined) {
		return undefined;
	}
	return Math.round(settings.fontSize * 1.55);
}

function setBodyFontSize(host: HTMLElement, fontSize: number | undefined): void {
	if (fontSize !== undefined) {
		host.style.setProperty('--ecuc-fs', `${fontSize}px`);
	}
}

function applyBodyTypography(settings: MonacoSettings): void {
	const host = document.getElementById('diff-monaco');
	if (host === null) {
		return;
	}
	setBodyFontSize(host, settings.fontSize);
	const lineHeight = bodyLineHeight(settings);
	if (lineHeight !== undefined) {
		host.style.setProperty('--ecuc-lh', `${lineHeight}px`);
	}
}

function changedRows(): readonly DiffBodyRow[] {
	if (body === undefined) {
		return [];
	}
	return body.rows.filter((row) => row.status !== 'unchanged');
}

function selectKey(key: string | undefined): void {
	selectedKey = key;
}

function swapSides(): void {
	swapped = !swapped;
	setDiffModel();
	toolbar?.setSwapped(swapped);
	setTitles();
	selectedKey = undefined;
	syncBodyState();
	renderCopyArrows();
}

function foldAll(): void {
	originalEditor()?.trigger('toolbar', 'editor.foldAll', null);
	modifiedEditor()?.trigger('toolbar', 'editor.foldAll', null);
}

function unfoldAll(): void {
	originalEditor()?.trigger('toolbar', 'editor.unfoldAll', null);
	modifiedEditor()?.trigger('toolbar', 'editor.unfoldAll', null);
}

function changeRows(): readonly SemanticChange[] {
	return body === undefined ? [] : semanticChanges(body.rows);
}

interface ActivePane {
	side: DiffSide;
	editor: monaco.editor.ICodeEditor | undefined;
}

/** The pane the user is working in; a missing side falls back to its owner. */
function activePane(): ActivePane {
	const editor = focusedPane === 'original' ? originalEditor() : modifiedEditor();
	return { side: displayedSide(focusedPane), editor };
}

function selectedChangeIndex(changes: readonly SemanticChange[]): number {
	return selectedKey === undefined ? -1 : changes.findIndex((change) => change.key === selectedKey);
}

function changeAnchor(changes: readonly SemanticChange[], active: ActivePane): number | undefined {
	const selected = selectedChangeIndex(changes);
	if (selected >= 0) {
		return selected;
	}
	const line = active.editor?.getPosition()?.lineNumber;
	return line === undefined ? undefined : cursorChangeIndex(changes, line, active.side);
}

function editorForSide(side: DiffSide): monaco.editor.ICodeEditor | undefined {
	return side === displayedSide('original') ? originalEditor() : modifiedEditor();
}

function revealChangeTarget(target: { side: DiffSide; line: number }): void {
	const editor = editorForSide(target.side);
	if (editor === undefined) {
		return;
	}
	editor.revealLineInCenter(target.line);
	editor.setPosition({ lineNumber: target.line, column: 1 });
	editor.focus();
}

/**
 * Step through the semantic change rows, not Monaco's line diff on the
 * pre-synthetic synthetic text: a rename, a semantic pair and a one-sided block
 * each move one semantic step, and the owning pane receives the cursor.
 */
function navigate(direction: 1 | -1): void {
	const changes = changeRows();
	if (changes.length === 0) {
		setNotice('No differences to navigate');
		return;
	}
	clearNotice();
	const active = activePane();
	const index = stepChange(changes.length, changeAnchor(changes, active), direction);
	if (index === undefined) {
		return;
	}
	const change = changes[index];
	const target = navigationTarget(change, active.side);
	if (target === undefined) {
		return;
	}
	revealChangeTarget(target);
	selectKey(change.key);
	publishNavigation(change, target);
}

function applyLabelsMessage(labels: DiffDocument['labels']): void {
	if (documentModel !== undefined) {
		documentModel = { ...documentModel, labels };
		setTitles();
	}
}

function dispatchDocumentMessage(message: DiffProviderToWebview): boolean {
	if (message.type === 'document') {
		applyDocument(message.document, message.semantic);
		return true;
	}
	if (message.type === 'documentPatch') {
		if (documentModel !== undefined) {
			applyDocument(applyDiffPatch(documentModel, message.patch), semantic);
		}
		return true;
	}
	return false;
}

function dispatchViewMessage(message: DiffProviderToWebview): boolean {
	if (message.type === 'matchModeState') {
		semantic = message.semantic;
		toolbar?.setMatchMode(semantic, false);
		return true;
	}
	if (message.type === 'mergeMode') {
		setMergeMode(message.enabled);
		return true;
	}
	if (message.type === 'labels') {
		applyLabelsMessage(message.labels);
		return true;
	}
	return false;
}

function dispatchFindMessage(message: DiffProviderToWebview): boolean {
	if (message.type === 'findResult') {
		applyDiffFindResult(message.requestId, message.result, message.error);
		return true;
	}
	return false;
}

function dispatchChromeMessage(message: DiffProviderToWebview): boolean {
	if (message.type === 'theme') {
		defineEcucTheme();
		monaco.editor.setTheme('arxml-ecuc-theme');
		return true;
	}
	if (message.type === 'settings') {
		applyDiffSettings(message.settings);
		return true;
	}
	if (message.type === 'error') {
		setNotice(message.message, 'error');
		return true;
	}
	return false;
}

function dispatchDiffMessage(message: DiffProviderToWebview): void {
	if (dispatchDocumentMessage(message)) {
		return;
	}
	if (dispatchViewMessage(message)) {
		return;
	}
	if (dispatchFindMessage(message)) {
		return;
	}
	dispatchChromeMessage(message);
}

function handleMessage(message: DiffProviderToWebview): void {
	if (!message || typeof message.type !== 'string') {
		return;
	}
	dispatchDiffMessage(message);
}

function mountToolbar(): void {
	toolbar = new DiffToolbar({
		onViewAll: function () {
			changesOnly = false;
			toolbar?.setViewMode(false);
			updateDiffOptions();
		},
		onViewDiff: function () {
			changesOnly = true;
			contextActive = true;
			toolbar?.setViewMode(true);
			toolbar?.setContext(true);
			updateDiffOptions();
		},
		onContext: function (active) {
			contextActive = active;
			toolbar?.setContext(active);
			updateDiffOptions();
		},
		onPrev: function () {
			navigate(-1);
		},
		onNext: function () {
			navigate(1);
		},
		onCollapseAll: foldAll,
		onExpandAll: unfoldAll,
		onSwap: swapSides,
		onMergeMode: function () {
			setMergeMode(!mergeMode);
			postToHost({ type: 'mergeMode', enabled: mergeMode });
		},
		onMatchMode: function (nextSemantic) {
			semantic = nextSemantic;
			toolbar?.setMatchMode(nextSemantic, true);
			postToHost({ type: 'matchMode', semantic: nextSemantic });
		}
	});
	toolbar.mount();
	toolbar.setViewMode(false);
	toolbar.setContext(true);
	toolbar.setMatchMode(true);
	toolbar.setSwapped(false);
	toolbar.setMergeMode(false);
}

/** The stored side currently shown in `pane`, following the swap state. */
function displayedSide(pane: 'original' | 'modified'): DiffSide {
	const originalIsLeft = !swapped;
	const onOriginal = pane === 'original';
	return originalIsLeft === onOriginal ? 'left' : 'right';
}

function rowOwnsSide(row: DiffBodyRow, side: DiffSide): boolean {
	return side === 'left' ? row.leftCell !== undefined : row.rightCell !== undefined;
}

interface CopyTarget {
	side: DiffSide;
	key: string;
}

/** The copy-to-left source is the stored side currently shown on the right. */
function copyLeftTarget(row: DiffBodyRow): CopyTarget | undefined {
	const side = displayedSide('modified');
	if (!rowOwnsSide(row, side)) {
		return undefined;
	}
	return { side, key: row.key };
}

/** One extra arrow in the built-in diff-margin view-zone lane. */
function addLeftArrowZone(
	accessor: monaco.editor.IViewZoneChangeAccessor,
	row: DiffBodyRow,
	target: CopyTarget
): void {
	const firstLine = linesOnSide(row, displayedSide('modified'))[0];
	if (firstLine === undefined) {
		return;
	}
	const wrapper = document.createElement('div');
	wrapper.className = 'arxml-copy-left-margin';
	const arrow = document.createElement('div');
	arrow.className = 'arrow-revert-change codicon codicon-arrow-left';
	arrow.dataset.copyKey = target.key;
	arrow.dataset.copySide = target.side;
	arrow.title = 'Copy this element to the left side';
	arrow.setAttribute('aria-label', arrow.title);
	wrapper.appendChild(arrow);
	const zone = accessor.addZone({
		afterLineNumber: Math.max(0, firstLine - 1),
		heightInPx: 0,
		domNode: document.createElement('div'),
		marginDomNode: wrapper,
		showInHiddenAreas: true,
		suppressMouseDown: true
	});
	leftArrowZones.push(zone);
}

function clearLeftArrowZones(accessor: monaco.editor.IViewZoneChangeAccessor): void {
	for (const zone of leftArrowZones) {
		accessor.removeZone(zone);
	}
	leftArrowZones = [];
}

function addLeftArrowZones(accessor: monaco.editor.IViewZoneChangeAccessor): void {
	for (const row of changedRows()) {
		const target = copyLeftTarget(row);
		if (target !== undefined) {
			addLeftArrowZone(accessor, row, target);
		}
	}
}

/**
 * Rebuild only the extra copy-left arrow. The right-pointing arrow is Monaco's
 * own diff-margin view zone; its click is rebound below.
 */
function renderCopyArrows(): void {
	const editor = modifiedEditor();
	if (editor === undefined) {
		return;
	}
	editor.changeViewZones(function (accessor) {
		clearLeftArrowZones(accessor);
		if (mergeMode && body !== undefined) {
			addLeftArrowZones(accessor);
		}
	});
}

function arrowTop(editor: monaco.editor.ICodeEditor, arrow: Element): number | undefined {
	const wrapper = arrow.parentElement;
	const node = editor.getDomNode();
	if (wrapper === null || node === null) {
		return undefined;
	}
	return wrapper.getBoundingClientRect().top - node.getBoundingClientRect().top;
}

function anchorTop(editor: monaco.editor.ICodeEditor, anchor: number): number {
	if (anchor === 0) {
		return 0;
	}
	return (
		editor.getTopForLineNumber(anchor) +
		editor.getOption(monaco.editor.EditorOption.lineHeight) -
		editor.getScrollTop()
	);
}

function nearestLineChange(
	editor: monaco.editor.ICodeEditor,
	top: number
): monaco.editor.ILineChange | undefined {
	const changes = diffEditor?.getLineChanges();
	if (!changes) {
		return undefined;
	}
	let best: monaco.editor.ILineChange | undefined;
	let bestDelta = 8;
	for (const change of changes) {
		const delta = Math.abs(anchorTop(editor, change.modifiedEndLineNumber) - top);
		if (delta < bestDelta) {
			best = change;
			bestDelta = delta;
		}
	}
	return best;
}

/** The line change a built-in margin arrow belongs to, from its view-zone top. */
function lineChangeForArrow(
	editor: monaco.editor.ICodeEditor,
	arrow: Element
): monaco.editor.ILineChange | undefined {
	const top = arrowTop(editor, arrow);
	return top === undefined ? undefined : nearestLineChange(editor, top);
}

/** Fallback for the same mapping through Monaco's view-zone hit target. */
function lineChangeAtPoint(
	editor: monaco.editor.ICodeEditor,
	event: MouseEvent
): monaco.editor.ILineChange | undefined {
	const target = editor.getTargetAtClientPoint(event.clientX, event.clientY);
	if (target?.type !== monaco.editor.MouseTargetType.GUTTER_VIEW_ZONE) {
		return undefined;
	}
	const after = target.detail.afterLineNumber;
	return diffEditor?.getLineChanges()?.find((change) => change.modifiedEndLineNumber === after);
}

function rowIsChangedAndOwned(row: DiffBodyRow, side: DiffSide): boolean {
	return row.status !== 'unchanged' && rowOwnsSide(row, side);
}

function ownedRow(key: string | undefined, side: DiffSide): DiffBodyRow | undefined {
	if (key === undefined) {
		return undefined;
	}
	const row = body?.byKey.get(key);
	return row !== undefined && rowIsChangedAndOwned(row, side) ? row : undefined;
}

function firstOwnedRow(start: number, end: number, side: DiffSide): DiffBodyRow | undefined {
	const keys = originalKeys();
	for (let line = start; line <= end; line += 1) {
		const row = ownedRow(keys[line - 1], side);
		if (row !== undefined) {
			return row;
		}
	}
	return undefined;
}

/** A built-in deletion block maps to the first semantic row it contains. */
function builtInArrowTarget(change: monaco.editor.ILineChange | undefined): CopyTarget | undefined {
	if (change === undefined) {
		return undefined;
	}
	const side = displayedSide('original');
	const row = firstOwnedRow(change.originalStartLineNumber, change.originalEndLineNumber, side);
	return row === undefined ? undefined : { side, key: row.key };
}

function copyArrowElement(event: MouseEvent): HTMLElement | undefined {
	const target = event.target;
	if (!(target instanceof Element)) {
		return undefined;
	}
	return target.closest<HTMLElement>('.arrow-revert-change') ?? undefined;
}

function taggedTarget(arrow: HTMLElement): CopyTarget | undefined {
	const key = arrow.dataset.copyKey;
	const side = arrow.dataset.copySide;
	if (key === undefined || (side !== 'left' && side !== 'right')) {
		return undefined;
	}
	return { key, side };
}

function builtInTargetAt(arrow: HTMLElement, event: MouseEvent): CopyTarget | undefined {
	const editor = modifiedEditor();
	if (editor === undefined) {
		return undefined;
	}
	const change = lineChangeForArrow(editor, arrow) ?? lineChangeAtPoint(editor, event);
	return builtInArrowTarget(change);
}

function copyTargetForArrow(arrow: HTMLElement, event: MouseEvent): CopyTarget | undefined {
	return taggedTarget(arrow) ?? builtInTargetAt(arrow, event);
}

/**
 * Intercept the built-in arrow before Monaco's revert handler and post the
 * ARXML copy instead. The synthetic models are never edited from the page.
 */
function handleCopyArrow(event: MouseEvent): void {
	if (!mergeMode) {
		return;
	}
	const arrow = copyArrowElement(event);
	if (arrow === undefined) {
		return;
	}
	event.preventDefault();
	event.stopPropagation();
	const target = copyTargetForArrow(arrow, event);
	if (target !== undefined) {
		postToHost({ type: 'copy', side: target.side, key: target.key });
	}
}

function wireCopyArrows(): void {
	modifiedEditor()?.getDomNode()?.addEventListener('click', handleCopyArrow, true);
}

/** Merge mode is the only state that renders the two center arrows. */
function setMergeMode(enabled: boolean): void {
	mergeMode = enabled;
	toolbar?.setMergeMode(mergeMode);
	syncBodyState();
	renderCopyArrows();
}

function wireSelection(): void {
	const original = originalEditor();
	const modified = modifiedEditor();
	if (original === undefined || modified === undefined) {
		return;
	}
	original.onDidFocusEditorText(function () {
		focusedPane = 'original';
	});
	modified.onDidFocusEditorText(function () {
		focusedPane = 'modified';
	});
	original.onDidChangeCursorPosition(function (event) {
		selectKey(keyAt(original, event.position.lineNumber, 'original'));
	});
	modified.onDidChangeCursorPosition(function (event) {
		selectKey(keyAt(modified, event.position.lineNumber, 'modified'));
	});
}

function diffEditorOptions(
	font: ReturnType<typeof editorFontOptions>
): monaco.editor.IStandaloneDiffEditorConstructionOptions {
	return {
		theme: 'arxml-ecuc-theme',
		automaticLayout: true,
		// The built-in margin arrow only renders when the diff readOnly flag is
		// off. Both inner editors are set readOnly right after creation, so the
		// synthetic models stay non-editable while the arrow keeps VS Code's DOM.
		readOnly: false,
		originalEditable: false,
		renderSideBySide: true,
		useInlineViewWhenSpaceIsLimited: false,
		enableSplitViewResizing: false,
		// The built-in diff owns the body, so its +/− indicators, line fills,
		// word spans, diagonal gaps and overview ruler are the single paint layer.
		renderIndicators: true,
		// Keep Monaco's built-in margin arrow mounted; the merge class gates its
		// visibility so toggling Merge never rebuilds the diff view zones.
		renderMarginRevertIcon: true,
		renderGutterMenu: false,
		glyphMargin: true,
		lineNumbers: 'on',
		lineNumbersMinChars: 5,
		lineDecorationsWidth: 10,
		minimap: { enabled: false },
		diffAlgorithm: 'advanced',
		ignoreTrimWhitespace: false,
		renderOverviewRuler: true,
		hideUnchangedRegions: { enabled: false, contextLineCount: 5, minimumLineCount: 3 },
		scrollBeyondLastLine: false,
		wordWrap: 'off',
		fontFamily: font.fontFamily,
		fontSize: font.fontSize,
		fontWeight: font.fontWeight,
		...(font.lineHeight > 0 ? { lineHeight: font.lineHeight } : {})
	};
}

function exposePreviewEditor(editor: monaco.editor.IStandaloneDiffEditor): void {
	if ((window as unknown as { __PREVIEW__?: unknown }).__PREVIEW__ !== undefined) {
		(window as unknown as { __ARXML_DIFF_EDITOR__?: unknown }).__ARXML_DIFF_EDITOR__ = editor;
	}
}

function flushPendingMessages(): void {
	for (const message of pendingMessages) {
		handleMessage(message);
	}
	pendingMessages.length = 0;
}

async function mountDiff(): Promise<void> {
	const host = document.getElementById('diff-list');
	if (host === null) {
		return;
	}
	host.className = 'monaco-diff-host';
	host.textContent = '';
	const container = document.createElement('div');
	container.id = 'diff-monaco';
	host.appendChild(container);
	installNoticeErrors(document, window, { noticeId: 'diff-notice', label: 'Semantic diff failed' });
	await ensureMonacoEnvironment();
	defineEcucTheme();
	const font = editorFontOptions();
	leftModel = monaco.editor.createModel('', 'arxml-ecuc');
	rightModel = monaco.editor.createModel('', 'arxml-ecuc');
	installSideFindBridge(leftModel, 'left');
	installSideFindBridge(rightModel, 'right');
	diffEditor = monaco.editor.createDiffEditor(container, diffEditorOptions(font));
	diffEditor.setModel({
		original: leftModel,
		modified: rightModel
	});
	exposePreviewEditor(diffEditor);
	diffEditor.getOriginalEditor().updateOptions({
		readOnly: true,
		glyphMargin: true,
		lineNumbers: 'on',
		minimap: { enabled: false }
	});
	diffEditor.getModifiedEditor().updateOptions({
		readOnly: true,
		glyphMargin: true,
		lineNumbers: 'on',
		minimap: { enabled: false }
	});
	syncBodyState();
	diffEditor.onDidUpdateDiff(function () {
		renderCopyArrows();
	});

	mountToolbar();
	wireSelection();
	wireCopyArrows();
	mounted = true;
	flushPendingMessages();
	postToHost({ type: 'ready' });
}

if (typeof document !== 'undefined' && document.getElementById('diff-list')) {
	void mountDiff();
}
