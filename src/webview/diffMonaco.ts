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
	buildAlignedSyntheticDocuments,
	searchRangeOnLine,
	type AlignedSyntheticDocuments,
	type SyntheticDocument
} from './monaco/synthetic';
import { defineEcucTheme, ensureMonacoEnvironment, monaco, setModelFolding } from './monaco/setup';
import { installFindBridge, startFindController, type MonacoFindMatch } from './monaco/findBridge';
import { DiffToolbar } from './components/toolbar/toolbar';
import { installNoticeErrors } from './render/pageError';
import { postToHost } from './vscodeApi';

let documentModel: DiffDocument | undefined;
let aligned: AlignedSyntheticDocuments | undefined;
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
let originalDecorations: string[] = [];
let modifiedDecorations: string[] = [];
/** Model lines whose cell is missing on that side; the whole one-sided block. */
let leftPlaceholderLines = new Set<number>();
let rightPlaceholderLines = new Set<number>();
type DiffSide = 'left' | 'right';
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

function originalDocument(): SyntheticDocument | undefined {
	return swapped ? aligned?.right : aligned?.left;
}

function modifiedDocument(): SyntheticDocument | undefined {
	return swapped ? aligned?.left : aligned?.right;
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

/**
 * Every model line belonging to a row that has no cell on `side`: the node line,
 * its brace lines and a one-sided subtree's children. The line counts stay
 * aligned, so these are the blank placeholder lines Monaco sees as an insertion
 * or deletion.
 */
function rowsByKey(document: DiffDocument): Map<string, DiffRow> {
	const byKey = new Map<string, DiffRow>();
	for (const row of document.rows) {
		byKey.set(row.key, row);
	}
	return byKey;
}

/** True when the row has no cell on `side`, including rows missing from the tree. */
function rowMissingCell(row: DiffRow | undefined, side: DiffSide): boolean {
	if (row === undefined) {
		return false;
	}
	return (side === 'left' ? row.left : row.right) === undefined;
}

function placeholderLines(
	document: DiffDocument,
	keys: readonly (string | undefined)[],
	side: DiffSide
): Set<number> {
	const byKey = rowsByKey(document);
	const lines = new Set<number>();
	for (let at = 0; at < keys.length; at += 1) {
		const key = keys[at];
		if (key === undefined) {
			// A module gap is a display-only blank line with no owning cell. Treat
			// it as neutral on both sides so Monaco's blank-line alignment cannot
			// turn it into an added/removed row.
			lines.add(at + 1);
			continue;
		}
		if (rowMissingCell(byKey.get(key), side)) {
			lines.add(at + 1);
		}
	}
	return lines;
}

/** The placeholder set for the model line's own side, or undefined when unknown. */
function placeholderLinesFor(doc: SyntheticDocument | undefined): Set<number> | undefined {
	if (aligned === undefined) {
		return undefined;
	}
	if (doc === undefined) {
		return undefined;
	}
	return doc === aligned.left ? leftPlaceholderLines : rightPlaceholderLines;
}

/** True when this model line carries no cell on its own side. */
function placeholderOn(doc: SyntheticDocument | undefined, line: number | undefined): boolean {
	if (line === undefined) {
		return false;
	}
	const lines = placeholderLinesFor(doc);
	return lines !== undefined && lines.has(line);
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

function collectSubtree(rows: readonly DiffRow[], at: number): Set<string> {
	const out = new Set<string>();
	const end = at + rows[at].subtreeSize;
	for (let index = at; index <= end && index < rows.length; index += 1) {
		out.add(rows[index].key);
	}
	return out;
}

function subtreeKeys(key: string | undefined): Set<string> {
	if (documentModel === undefined) {
		return new Set<string>();
	}
	if (key === undefined) {
		return new Set<string>();
	}
	const at = documentModel.rows.findIndex((row) => row.key === key);
	if (at < 0) {
		return new Set<string>();
	}
	return collectSubtree(documentModel.rows, at);
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

function setPlaceholderLines(document: DiffDocument, docs: AlignedSyntheticDocuments): void {
	leftPlaceholderLines = placeholderLines(document, docs.leftLineKeys, 'left');
	rightPlaceholderLines = placeholderLines(document, docs.rightLineKeys, 'right');
}

function setModelText(model: monaco.editor.ITextModel | undefined, source: SyntheticDocument): void {
	if (model === undefined) {
		return;
	}
	model.setValue(source.text);
	setModelFolding(model, source.foldingRanges);
}

function setModelTexts(docs: AlignedSyntheticDocuments): void {
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
	const docs = buildAlignedSyntheticDocuments(next);
	aligned = docs;
	setPlaceholderLines(next, docs);
	setModelTexts(docs);
	setDiffModel();
	selectedKey = undefined;
	setTitles();
	syncToolbarState();
	updateDiffOptions();
	setEmpty(isEmptyDocument(next));
	showSemanticSkip(next.semanticSkipped);
	clearNotice();
	renderDecorations();
}

function identifyRow(key: string): DiffRow | undefined {
	return documentModel?.rows.find((row) => row.key === key);
}

/** Both editors when the diff editor and its panes exist. */
function diffEditors():
	| { original: monaco.editor.ICodeEditor; modified: monaco.editor.ICodeEditor }
	| undefined {
	if (diffEditor === undefined) {
		return undefined;
	}
	const original = originalEditor();
	const modified = modifiedEditor();
	if (original === undefined || modified === undefined) {
		return undefined;
	}
	return { original, modified };
}

function pushLineDecoration(
	target: monaco.editor.IModelDeltaDecoration[],
	line: number,
	className: string
): void {
	target.push({
		range: new monaco.Range(line, 1, line, 1),
		options: { isWholeLine: true, className, zIndex: 1 }
	});
}

function selectionClass(key: string): string {
	return key === selectedKey ? 'arxml-selected' : 'arxml-subtree';
}

function addSelectedRow(
	target: monaco.editor.IModelDeltaDecoration[],
	doc: SyntheticDocument | undefined,
	key: string
): void {
	// The node line gets the selected class; its brace and annotation lines
	// keep the subtree tint, matching the old Document. A placeholder line has
	// no cell, so it stays neutral instead of joining the selection tint.
	const line = lineFor(key, doc);
	if (line === undefined) {
		return;
	}
	if (placeholderOn(doc, line)) {
		return;
	}
	pushLineDecoration(target, line, selectionClass(key));
}

function addSelectedRows(
	target: monaco.editor.IModelDeltaDecoration[],
	doc: SyntheticDocument | undefined,
	selected: Set<string>
): void {
	for (const key of selected) {
		addSelectedRow(target, doc, key);
	}
}

function isSubtreeLine(
	keys: readonly (string | undefined)[],
	at: number,
	doc: SyntheticDocument | undefined,
	selected: Set<string>
): boolean {
	const key = keys[at];
	if (key === undefined) {
		return false;
	}
	if (!selected.has(key)) {
		return false;
	}
	if (doc?.rowLine.get(key) === at + 1) {
		return false;
	}
	return !placeholderOn(doc, at + 1);
}

function addSubtreeLines(
	target: monaco.editor.IModelDeltaDecoration[],
	keys: readonly (string | undefined)[],
	doc: SyntheticDocument | undefined,
	selected: Set<string>
): void {
	for (let at = 0; at < keys.length; at += 1) {
		if (!isSubtreeLine(keys, at, doc, selected)) {
			continue;
		}
		pushLineDecoration(target, at + 1, 'arxml-subtree');
	}
}

function addSelectionDecorations(
	originalRanges: monaco.editor.IModelDeltaDecoration[],
	modifiedRanges: monaco.editor.IModelDeltaDecoration[]
): void {
	const selected = subtreeKeys(selectedKey);
	const originalDoc = originalDocument();
	const modifiedDoc = modifiedDocument();
	addSelectedRows(originalRanges, originalDoc, selected);
	addSelectedRows(modifiedRanges, modifiedDoc, selected);
	addSubtreeLines(originalRanges, originalKeys(), originalDoc, selected);
	addSubtreeLines(modifiedRanges, modifiedKeys(), modifiedDoc, selected);
}

// Monaco's line diff still classifies a blank placeholder opposite a real
// line as inserted/deleted. An opaque editor-background layer outranks that
// fill (zIndex above Monaco's default 0), so the missing side reads blank;
// the real side keeps its own change fill. The margin class neutralizes the
// gutter fill and sign in the stylesheet.
function placeholderDecorations(
	doc: SyntheticDocument | undefined
): monaco.editor.IModelDeltaDecoration[] {
	const lines = placeholderLinesFor(doc);
	if (lines === undefined) {
		return [];
	}
	const out: monaco.editor.IModelDeltaDecoration[] = [];
	for (const line of lines) {
		out.push({
			range: new monaco.Range(line, 1, line, 1),
			options: {
				isWholeLine: true,
				className: 'arxml-diff-placeholder',
				marginClassName: 'arxml-diff-placeholder-margin',
				zIndex: 2
			}
		});
	}
	return out;
}

function mergeArrowClass(sourcePresent: boolean, pointsRight: boolean): string {
	if (sourcePresent) {
		return pointsRight ? 'arxml-merge-arrow-right' : 'arxml-merge-arrow-left';
	}
	return pointsRight ? 'arxml-merge-arrow-left' : 'arxml-merge-arrow-right';
}

function mergeArrowMessage(sourcePresent: boolean): string {
	return sourcePresent ? 'Copy this element to the other side' : 'Delete this element from the other side';
}

function pushMergeDecoration(
	target: monaco.editor.IModelDeltaDecoration[],
	line: number | undefined,
	sourcePresent: boolean,
	pointsRight: boolean
): void {
	if (line === undefined) {
		return;
	}
	target.push({
		range: new monaco.Range(line, 1, line, 1),
		options: {
			glyphMarginClassName: mergeArrowClass(sourcePresent, pointsRight),
			glyphMarginHoverMessage: { value: mergeArrowMessage(sourcePresent) }
		}
	});
}

function addMergeRow(
	originalRanges: monaco.editor.IModelDeltaDecoration[],
	modifiedRanges: monaco.editor.IModelDeltaDecoration[],
	row: DiffRow
): void {
	if (row.status === 'unchanged') {
		return;
	}
	const originalLine = lineFor(row.key, originalDocument());
	const modifiedLine = lineFor(row.key, modifiedDocument());
	const originalIsLeft = !swapped;
	const originalSource = originalIsLeft ? row.left : row.right;
	const modifiedSource = originalIsLeft ? row.right : row.left;
	pushMergeDecoration(originalRanges, originalLine, originalSource !== undefined, originalIsLeft);
	pushMergeDecoration(modifiedRanges, modifiedLine, modifiedSource !== undefined, !originalIsLeft);
}

function addMergeDecorations(
	originalRanges: monaco.editor.IModelDeltaDecoration[],
	modifiedRanges: monaco.editor.IModelDeltaDecoration[]
): void {
	if (!mergeMode) {
		return;
	}
	if (documentModel === undefined) {
		return;
	}
	for (const row of documentModel.rows) {
		addMergeRow(originalRanges, modifiedRanges, row);
	}
}

function renderDecorations(): void {
	if (aligned === undefined) {
		return;
	}
	const editors = diffEditors();
	if (editors === undefined) {
		return;
	}
	const originalRanges: monaco.editor.IModelDeltaDecoration[] = [];
	const modifiedRanges: monaco.editor.IModelDeltaDecoration[] = [];
	addSelectionDecorations(originalRanges, modifiedRanges);
	originalRanges.push(...placeholderDecorations(originalDocument()));
	modifiedRanges.push(...placeholderDecorations(modifiedDocument()));
	addMergeDecorations(originalRanges, modifiedRanges);
	originalDecorations = editors.original.deltaDecorations(originalDecorations, originalRanges);
	modifiedDecorations = editors.modified.deltaDecorations(modifiedDecorations, modifiedRanges);
}

function selectKey(key: string | undefined): void {
	if (key === selectedKey) {
		return;
	}
	selectedKey = key;
	renderDecorations();
}

function swapSides(): void {
	swapped = !swapped;
	setDiffModel();
	toolbar?.setSwapped(swapped);
	setTitles();
	selectedKey = undefined;
	renderDecorations();
}

function foldAll(): void {
	originalEditor()?.trigger('toolbar', 'editor.foldAll', null);
	modifiedEditor()?.trigger('toolbar', 'editor.foldAll', null);
}

function unfoldAll(): void {
	originalEditor()?.trigger('toolbar', 'editor.unfoldAll', null);
	modifiedEditor()?.trigger('toolbar', 'editor.unfoldAll', null);
}

function changeList(): monaco.editor.ILineChange[] {
	return diffEditor?.getLineChanges() ?? [];
}

function changeLine(change: monaco.editor.ILineChange): number {
	return change.modifiedStartLineNumber || change.originalStartLineNumber;
}

function currentModifiedLine(): number {
	return modifiedEditor()?.getPosition()?.lineNumber ?? 0;
}

function findForwardChange(changes: monaco.editor.ILineChange[], current: number): number {
	return changes.findIndex((change) => changeLine(change) >= current);
}

function findBackwardChange(changes: monaco.editor.ILineChange[], current: number): number {
	for (let at = changes.length - 1; at >= 0; at -= 1) {
		if (changeLine(changes[at]) < current) {
			return at;
		}
	}
	return -1;
}

function changeIndex(changes: monaco.editor.ILineChange[], current: number, direction: 1 | -1): number {
	const index = direction > 0 ? findForwardChange(changes, current) : findBackwardChange(changes, current);
	if (index >= 0) {
		return index;
	}
	return direction > 0 ? 0 : changes.length - 1;
}

function revealChange(change: monaco.editor.ILineChange): void {
	const editor = modifiedEditor();
	if (editor === undefined) {
		return;
	}
	const line = changeLine(change);
	editor.revealLineInCenter(line);
	editor.setPosition({ lineNumber: line, column: 1 });
}

function navigate(direction: 1 | -1): void {
	const changes = changeList();
	if (changes.length === 0) {
		setNotice('No differences to navigate');
		return;
	}
	revealChange(changes[changeIndex(changes, currentModifiedLine(), direction)]);
}

type DiffMessageHandler = (message: DiffProviderToWebview) => void;

/**
 * A map instead of an object so a message named after an inherited member
 * (`toString`, `constructor`) cannot resolve to a handler.
 */
function createMessageHandlers(): Map<string, DiffMessageHandler> {
	const handlers = new Map<string, DiffMessageHandler>();
	handlers.set('document', function (message) {
		const typed = message as Extract<DiffProviderToWebview, { type: 'document' }>;
		applyDocument(typed.document, typed.semantic);
	});
	handlers.set('documentPatch', function (message) {
		const typed = message as Extract<DiffProviderToWebview, { type: 'documentPatch' }>;
		if (documentModel !== undefined) {
			applyDocument(applyDiffPatch(documentModel, typed.patch), semantic);
		}
	});
	handlers.set('matchModeState', function (message) {
		const typed = message as Extract<DiffProviderToWebview, { type: 'matchModeState' }>;
		semantic = typed.semantic;
		toolbar?.setMatchMode(semantic, false);
	});
	handlers.set('mergeMode', function (message) {
		const typed = message as Extract<DiffProviderToWebview, { type: 'mergeMode' }>;
		mergeMode = typed.enabled;
		toolbar?.setMergeMode(mergeMode);
		renderDecorations();
	});
	handlers.set('labels', function (message) {
		const typed = message as Extract<DiffProviderToWebview, { type: 'labels' }>;
		if (documentModel !== undefined) {
			documentModel = { ...documentModel, labels: typed.labels };
			setTitles();
		}
	});
	handlers.set('findResult', function (message) {
		const typed = message as Extract<DiffProviderToWebview, { type: 'findResult' }>;
		applyDiffFindResult(typed.requestId, typed.result, typed.error);
	});
	handlers.set('theme', function () {
		defineEcucTheme();
		monaco.editor.setTheme('arxml-ecuc-theme');
	});
	handlers.set('error', function (message) {
		const typed = message as Extract<DiffProviderToWebview, { type: 'error' }>;
		setNotice(typed.message, 'error');
	});
	return handlers;
}

const messageHandlers = createMessageHandlers();

function handleMessage(message: DiffProviderToWebview): void {
	if (!message || typeof message.type !== 'string') {
		return;
	}
	const handler = messageHandlers.get(message.type);
	if (handler === undefined) {
		return;
	}
	handler(message);
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
			toolbar?.setMergeMode(mergeMode);
			postToHost({ type: 'mergeMode', enabled: mergeMode });
			renderDecorations();
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

function wireSelection(): void {
	const original = originalEditor();
	const modified = modifiedEditor();
	if (original === undefined || modified === undefined) {
		return;
	}
	original.onDidChangeCursorPosition(function (event) {
		selectKey(keyAt(original, event.position.lineNumber, 'original'));
	});
	modified.onDidChangeCursorPosition(function (event) {
		selectKey(keyAt(modified, event.position.lineNumber, 'modified'));
	});
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
	diffEditor = monaco.editor.createDiffEditor(container, {
		theme: 'arxml-ecuc-theme',
		automaticLayout: true,
		readOnly: true,
		originalEditable: false,
		renderSideBySide: true,
		useInlineViewWhenSpaceIsLimited: false,
		enableSplitViewResizing: false,
		renderIndicators: true,
		renderMarginRevertIcon: false,
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
	diffEditor.onDidUpdateDiff(function () {
		renderDecorations();
	});

	mountToolbar();
	wireSelection();
	wireMergeClicks();
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
