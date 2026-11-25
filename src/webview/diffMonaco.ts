/**
 * The Monaco semantic-diff page.
 *
 * The host still owns the semantic comparison. This page turns the aligned
 * `DiffDocument` rows into two line-aligned synthetic ECUC documents and lets
 * Monaco render the real diff editor, including hidden unchanged regions and
 * word-level changes.
 */
import './styles/tokens.css';
import './styles/base.css';
import './components/diffView/diffView.css';
import './monaco/monaco.css';
import type { DiffCell, DiffDocument, DiffHeader, DiffRow } from '../core/diff/diffModel';
import { applyDiffPatch, type DiffPatch } from '../core/diff/diffPatch';
import type { DiffFindMatch, FindOptions } from '../core/searchModel';
import type { DiffProviderToWebview } from '../diffProtocol';
import {
	buildDiffSyntheticDocuments,
	searchRangeOnLine,
	type DiffSyntheticDocuments,
	type SyntheticDocument
} from './monaco/synthetic';
import { defineEcucTheme, ensureMonacoEnvironment, monaco, setModelFolding } from './monaco/setup';
import { installDiffGutterActions, type DiffGutterContext, type DiffGutterDirection, type DiffGutterMapping, type DiffGutterRange } from './monaco/diffGutterActions';
import { firstKeyInRange, rangeHasSource, type DiffSide } from './monaco/diffBody';
import { installGutterAvailability } from './monaco/diffGutterAvailability';
import { installFindBridge, startFindController, type MonacoFindMatch } from './monaco/findBridge';
import {
	adjacentChangeIndex,
	displayedChangeLine,
	originalChangeLine,
	type DiffNavigationChange
} from './monaco/diffNavigation';
import {
	collapsedRowKeys,
	foldTogglePlan,
	type FoldModel,
	type FoldingContribution
} from './monaco/diffFolding';
import { DiffToolbar } from './components/toolbar/toolbar';
import { installNoticeErrors } from './render/pageError';
import { postToHost } from './vscodeApi';

let documentModel: DiffDocument | undefined;
let aligned: DiffSyntheticDocuments | undefined;
let leftModel: monaco.editor.ITextModel | undefined;
let rightModel: monaco.editor.ITextModel | undefined;
let diffEditor: monaco.editor.IStandaloneDiffEditor | undefined;
let toolbar: DiffToolbar | undefined;
let swapped = false;
let mergeMode = false;
let changesOnly = false;
let contextActive = true;
let semantic = true;
let gutterAvailability: { sync(): void; dispose(): void } | undefined;
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
	if (aligned === undefined) {
		return [];
	}
	if (swapped) {
		return aligned.rightLineKeys;
	}
	return aligned.leftLineKeys;
}

function modifiedKeys(): (string | undefined)[] {
	if (aligned === undefined) {
		return [];
	}
	if (swapped) {
		return aligned.leftLineKeys;
	}
	return aligned.rightLineKeys;
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
	return side === 'left' ? aligned?.left : aligned?.right;
}

function originalEditor(): monaco.editor.ICodeEditor | undefined {
	return diffEditor?.getOriginalEditor();
}

function modifiedEditor(): monaco.editor.ICodeEditor | undefined {
	return diffEditor?.getModifiedEditor();
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
	if (aligned === undefined) {
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
	// The diff editor rewrites sub-editor options on update; re-enable folding.
	applyDiffFolding();
	gutterAvailability?.sync();
	// The Rust diff search is scoped to the current view, so a view toggle
	// needs a fresh query instead of last view's match set.
	invalidateDiffFind();
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
	element.textContent = label;
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
	document.getElementById('diff-monaco')?.setAttribute('data-merge', mergeMode ? 'true' : 'false');
}

function applyDocument(next: DiffDocument, nextSemantic: boolean): void {
	documentModel = next;
	semantic = nextSemantic;
	const docs = buildDiffSyntheticDocuments(next);
	aligned = docs;
	setModelTexts(docs);
	setDiffModel();
	setTitles();
	syncToolbarState();
	updateDiffOptions();
	setEmpty(isEmptyDocument(next));
	showSemanticSkip(next.semanticSkipped);
	clearNotice();
}

function identifyRow(key: string): DiffRow | undefined {
	return documentModel?.rows.find((row) => row.key === key);
}

function gutterAvailabilityFor(mapping: DiffGutterMapping): { left: boolean; right: boolean } {
	if (documentModel === undefined || aligned === undefined) {
		return { left: true, right: true };
	}
	const rows = documentModel.rows;
	const hasEither =
		rangeHasSource(rows, modifiedKeys(), mapping.modified, displayedSide('modified')) ||
		rangeHasSource(rows, originalKeys(), mapping.original, displayedSide('original'));
	return { left: hasEither, right: hasEither };
}

function gutterCopyReady(mapping: DiffGutterContext['mapping']): mapping is DiffGutterMapping {
	return documentModel !== undefined && mapping !== undefined && mapping !== null;
}

interface CopySide {
	side: DiffSide;
	range: DiffGutterRange;
	keys: (string | undefined)[];
}

function copyTarget(
	direction: DiffGutterDirection,
	mapping: DiffGutterMapping
): { source: CopySide; target: CopySide } {
	const left = direction === 'left';
	const modified: CopySide = {
		side: displayedSide('modified'),
		range: mapping.modified,
		keys: modifiedKeys()
	};
	const original: CopySide = {
		side: displayedSide('original'),
		range: mapping.original,
		keys: originalKeys()
	};
	return left ? { source: modified, target: original } : { source: original, target: modified };
}

function copyContext(
	direction: DiffGutterDirection,
	context: DiffGutterContext | undefined
): { rows: readonly DiffRow[]; source: CopySide; target: CopySide } | undefined {
	const mapping = context?.mapping;
	if (!gutterCopyReady(mapping)) {
		return undefined;
	}
	if (documentModel === undefined) {
		return undefined;
	}
	const target = copyTarget(direction, mapping);
	return { rows: documentModel.rows, ...target };
}

/** The built-in hunk toolbar posts the same host copy as the old arrow overlay. */
function gutterCopyRequest(
	direction: DiffGutterDirection,
	context: DiffGutterContext | undefined
): { side: DiffSide; key: string } | undefined {
	const resolved = copyContext(direction, context);
	if (resolved === undefined) {
		return undefined;
	}
	const sourceKey = firstKeyInRange(
		resolved.rows,
		resolved.source.keys,
		resolved.source.range,
		resolved.source.side
	);
	const key =
		sourceKey ??
		firstKeyInRange(resolved.rows, resolved.target.keys, resolved.target.range, resolved.target.side);
	return key === undefined ? undefined : { side: resolved.source.side, key };
}

function copyFromGutter(direction: DiffGutterDirection, context: DiffGutterContext | undefined): void {
	const request = gutterCopyRequest(direction, context);
	if (request !== undefined) {
		postToHost({ type: 'copy', ...request });
	}
}

function swapSides(): void {
	swapped = !swapped;
	setDiffModel();
	toolbar?.setSwapped(swapped);
	setTitles();
	gutterAvailability?.sync();
}

function foldAll(): void {
	originalEditor()?.trigger('toolbar', 'editor.foldAll', null);
	modifiedEditor()?.trigger('toolbar', 'editor.foldAll', null);
}

function unfoldAll(): void {
	originalEditor()?.trigger('toolbar', 'editor.unfoldAll', null);
	modifiedEditor()?.trigger('toolbar', 'editor.unfoldAll', null);
}

let syncingFolds = false;
let foldSyncQueue: Promise<void> = Promise.resolve();

function scheduleFoldSync(editor: monaco.editor.ICodeEditor): void {
	foldSyncQueue = foldSyncQueue.then(() => syncFolds(editor)).catch(() => undefined);
}

function foldingContribution(
	editor: monaco.editor.ICodeEditor | undefined
): FoldingContribution | null {
	if (editor === undefined) {
		return null;
	}
	return (editor.getContribution('editor.contrib.folding') as unknown as FoldingContribution | null) ?? null;
}

async function foldingModel(editor: monaco.editor.ICodeEditor): Promise<FoldModel | null> {
	const contribution = foldingContribution(editor);
	if (contribution === null) {
		return null;
	}
	return contribution.getFoldingModel();
}

function sideOfModel(model: monaco.editor.ITextModel | null): 'left' | 'right' | undefined {
	if (model === leftModel) {
		return 'left';
	}
	if (model === rightModel) {
		return 'right';
	}
	return undefined;
}

/** Mirror the collapsed row keys of one pane onto the other. */
async function syncFolds(sourceEditor: monaco.editor.ICodeEditor): Promise<void> {
	if (syncingFolds || aligned === undefined) {
		return;
	}
	const source = sideOfModel(sourceEditor.getModel());
	const targetEditor =
		sourceEditor === originalEditor() ? modifiedEditor() : originalEditor();
	if (source === undefined || targetEditor === undefined) {
		return;
	}
	const sourceFold = await foldingModel(sourceEditor);
	const targetFold = await foldingModel(targetEditor);
	if (sourceFold === null || targetFold === null) {
		return;
	}
	const sourceKeys = source === 'left' ? aligned.leftLineKeys : aligned.rightLineKeys;
	const targetSide = source === 'left' ? 'right' : 'left';
	const targetKeys = targetSide === 'left' ? aligned.leftLineKeys : aligned.rightLineKeys;
	const targetRows = targetSide === 'left' ? aligned.left.rowLine : aligned.right.rowLine;
	const plan = foldTogglePlan(
		collapsedRowKeys(sourceFold.regions, sourceKeys),
		collapsedRowKeys(targetFold.regions, targetKeys),
		targetRows,
		targetFold.regions
	);
	if (plan.length === 0) {
		return;
	}
	syncingFolds = true;
	try {
		targetFold.toggleCollapseState(plan.map((regionIndex) => ({ regionIndex })));
	} finally {
		syncingFolds = false;
	}
}

/** The diff editor disables folding on its inner editors; the modified feature re-enables it. */
function applyDiffFolding(): void {
	for (const editor of [originalEditor(), modifiedEditor()]) {
		editor?.updateOptions({
			folding: true,
			showFoldingControls: 'mouseover'
		});
	}
}

function changeList(): monaco.editor.ILineChange[] {
	return diffEditor?.getLineChanges() ?? [];
}

function focusedOriginalPane(): boolean {
	return originalEditor()?.hasTextFocus() === true;
}

function currentDisplayedLine(fromOriginal: boolean): number {
	const editor = fromOriginal ? originalEditor() : modifiedEditor();
	return editor?.getPosition()?.lineNumber ?? 0;
}

function revealChange(change: monaco.editor.ILineChange): void {
	const original = originalEditor();
	const modified = modifiedEditor();
	if (original === undefined || modified === undefined) {
		return;
	}
	const navigation: DiffNavigationChange = {
		originalStartLineNumber: change.originalStartLineNumber,
		modifiedStartLineNumber: change.modifiedStartLineNumber
	};
	const originalLine = originalChangeLine(navigation, swapped);
	const modifiedLine = displayedChangeLine(navigation, swapped);
	original.setPosition({ lineNumber: originalLine, column: 1 });
	modified.setPosition({ lineNumber: modifiedLine, column: 1 });
	original.revealLineInCenter(originalLine);
	modified.revealLineInCenter(modifiedLine);
}

function navigate(direction: 1 | -1): void {
	const changes = changeList();
	if (changes.length === 0) {
		setNotice('No differences to navigate');
		return;
	}
	const fromOriginal = focusedOriginalPane();
	const lines = changes.map((change) => {
		const navigation: DiffNavigationChange = {
			originalStartLineNumber: change.originalStartLineNumber,
			modifiedStartLineNumber: change.modifiedStartLineNumber
		};
		return fromOriginal
			? originalChangeLine(navigation, swapped)
			: displayedChangeLine(navigation, swapped);
	});
	const index = adjacentChangeIndex(lines, currentDisplayedLine(fromOriginal), direction);
	if (index >= 0) {
		revealChange(changes[index]);
	}
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
		mergeMode = message.enabled;
		syncToolbarState();
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
			mergeMode = !mergeMode;
			syncToolbarState();
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

function cellOnSide(row: DiffRow, side: DiffSide): DiffCell | undefined {
	return side === 'left' ? row.left : row.right;
}

function oppositeSide(side: DiffSide): DiffSide {
	return side === 'left' ? 'right' : 'left';
}

/** The side to copy from: the displayed one when it has a cell, else its pair. */
function copyHostSide(pane: 'original' | 'modified', row: DiffRow): DiffSide {
	const source = displayedSide(pane);
	if (cellOnSide(row, source) !== undefined) {
		return source;
	}
	return oppositeSide(source);
}

function handleMergeClick(
	editor: monaco.editor.ICodeEditor,
	pane: 'original' | 'modified',
	line: number
): void {
	const key = keyAt(editor, line, pane);
	if (key === undefined) {
		return;
	}
	const row = identifyRow(key);
	if (row === undefined) {
		return;
	}
	postToHost({ type: 'copy', side: copyHostSide(pane, row), key: row.key });
}

function eventLine(event: monaco.editor.IEditorMouseEvent): number | undefined {
	const position = event.target.position;
	if (position === undefined || position === null) {
		return undefined;
	}
	return position.lineNumber;
}

function mergeClickHandler(
	editor: monaco.editor.ICodeEditor,
	pane: 'original' | 'modified'
): (event: monaco.editor.IEditorMouseEvent) => void {
	return function (event) {
		if (!mergeMode) {
			return;
		}
		if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
			return;
		}
		const line = eventLine(event);
		if (line === undefined) {
			return;
		}
		handleMergeClick(editor, pane, line);
	};
}

function wireMergeClicks(): void {
	const original = originalEditor();
	const modified = modifiedEditor();
	if (original === undefined || modified === undefined) {
		return;
	}
	original.onMouseDown(mergeClickHandler(original, 'original'));
	modified.onMouseDown(mergeClickHandler(modified, 'modified'));
}

interface ScrollSnapshot {
	editor: monaco.editor.ICodeEditor;
	top: number;
}

const FIND_SHORTCUT_KEYS = new Set(['f', 'h']);

function hasFindModifier(event: KeyboardEvent): boolean {
	return (event.ctrlKey || event.metaKey) && !event.repeat && !event.altKey;
}

function isFindShortcut(event: KeyboardEvent): boolean {
	return hasFindModifier(event) && FIND_SHORTCUT_KEYS.has(event.key.toLowerCase());
}

function scrollSnapshot(): ScrollSnapshot[] {
	return [originalEditor(), modifiedEditor()]
		.filter((editor): editor is monaco.editor.ICodeEditor => editor !== undefined)
		.map((editor) => ({ editor, top: editor.getScrollTop() }));
}

function wireFindScrollGuard(): void {
	document.addEventListener(
		'keydown',
		function (event) {
			if (!isFindShortcut(event)) {
				return;
			}
			const snapshot = scrollSnapshot();
			if (snapshot.length === 0) {
				return;
			}
			window.requestAnimationFrame(function () {
				snapshot.forEach(({ editor, top }) => editor.setScrollTop(top));
			});
		},
		true
	);
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
	leftModel = monaco.editor.createModel('', 'arxml-ecuc');
	rightModel = monaco.editor.createModel('', 'arxml-ecuc');
	installSideFindBridge(leftModel, 'left');
	installSideFindBridge(rightModel, 'right');
	installDiffGutterActions(copyFromGutter);
	(window as unknown as { __ARXML_GUTTER_AVAILABILITY__?: unknown }).__ARXML_GUTTER_AVAILABILITY__ =
		gutterAvailabilityFor;
	diffEditor = monaco.editor.createDiffEditor(container, {
		theme: 'arxml-ecuc-theme',
		automaticLayout: true,
		readOnly: true,
		originalEditable: false,
		renderSideBySide: true,
		useInlineViewWhenSpaceIsLimited: false,
		enableSplitViewResizing: true,
		renderGutterMenu: true,
		renderIndicators: true,
		lineNumbersMinChars: 3,
		lineDecorationsWidth: 14,
		glyphMargin: true,
		diffAlgorithm: 'advanced',
		ignoreTrimWhitespace: false,
		renderOverviewRuler: true,
		hideUnchangedRegions: { enabled: false, contextLineCount: 5, minimumLineCount: 3 },
		scrollBeyondLastLine: false,
		wordWrap: 'off'
	});
	diffEditor.setModel({
		original: leftModel,
		modified: rightModel
	});
	if ((window as unknown as { __PREVIEW__?: unknown }).__PREVIEW__ !== undefined) {
		(window as unknown as { __ARXML_DIFF_EDITOR__?: unknown }).__ARXML_DIFF_EDITOR__ = diffEditor;
	}
	diffEditor.getOriginalEditor().updateOptions({
		glyphMargin: true,
		lineNumbers: 'on',
		minimap: { enabled: false }
	});
	diffEditor.getModifiedEditor().updateOptions({
		glyphMargin: true,
		lineNumbers: 'on',
		minimap: { enabled: false }
	});
	applyDiffFolding();
	for (const editor of [diffEditor.getOriginalEditor(), diffEditor.getModifiedEditor()]) {
		editor.onDidChangeHiddenAreas(function () {
			scheduleFoldSync(editor);
		});
	}
	gutterAvailability = installGutterAvailability({
		availability: gutterAvailabilityFor
	});
	diffEditor.onDidUpdateDiff(function () {
		gutterAvailability?.sync();
	});

	mountToolbar();
	wireMergeClicks();
	wireFindScrollGuard();
	mounted = true;
	for (const message of pendingMessages) {
		handleMessage(message);
	}
	pendingMessages.length = 0;
	postToHost({ type: 'ready' });
}

if (typeof document !== 'undefined' && document.getElementById('diff-list')) {
	void mountDiff();
}
