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
import type { DiffCell, DiffChange, DiffDocument, DiffHeader, DiffRow } from '../core/diff/diffModel';
import { applyDiffPatch, type DiffPatch } from '../core/diff/diffPatch';
import { wordDiffSpans, type WordSpan, type WordSpanPair } from '../core/diff/wordDiff';
import type { DiffFindMatch, FindOptions } from '../core/searchModel';
import type { DiffProviderToWebview } from '../diffProtocol';
import type { MonacoSettings } from '../webviewProtocol';
import {
	buildAlignedSyntheticDocuments,
	searchRangeOnLine,
	type AlignedSyntheticDocuments,
	type SearchSpan,
	type SyntheticDocument,
	type SyntheticLine
} from './monaco/synthetic';
import { defineEcucTheme, editorFontOptions, ensureMonacoEnvironment, monaco, setModelFolding } from './monaco/setup';
import { settingsOptions } from './monaco/settings';
import {
	buildDiffBody,
	cellOnSide,
	lineOnSide,
	linesOnSide,
	mergeSourceSide,
	otherSide,
	type DiffBody,
	type DiffBodyRow,
	type DiffSide
} from './monaco/diffBody';
import { installFindBridge, startFindController, type MonacoFindMatch } from './monaco/findBridge';
import { DiffToolbar } from './components/toolbar/toolbar';
import { installNoticeErrors } from './render/pageError';
import { postToHost } from './vscodeApi';

let documentModel: DiffDocument | undefined;
let body: DiffBody | undefined;
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
	body = buildDiffBody(next, docs);
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
	syncBodyState();
	renderDecorations();
}

const BODY_CLASSES = [
	'arxml-diff-body',
	'arxml-diff-gutter',
	'arxml-diff-status',
	'arxml-diff-merge-margin'
] as const;

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
	if ((window as unknown as { __PREVIEW__?: unknown }).__PREVIEW__ !== undefined) {
		(window as unknown as { __ARXML_DIFF_BODY__?: unknown }).__ARXML_DIFF_BODY__ = {
			rows: previewBodyRows()
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

type BodyPaint = 'added' | 'removed';

interface BodyPane {
	ranges: monaco.editor.IModelDeltaDecoration[];
	side: DiffSide;
	paint: BodyPaint;
}

/** The whole-line fill class for one semantic side. */
function pushBodyFill(target: monaco.editor.IModelDeltaDecoration[], line: number, paint: BodyPaint): void {
	target.push({
		range: new monaco.Range(line, 1, line, 1),
		options: { isWholeLine: true, className: `arxml-diff-line arxml-diff-line-${paint}`, zIndex: 0 }
	});
}

/** The VS Code diff gutter sign for one semantic side. */
function pushBodySign(target: monaco.editor.IModelDeltaDecoration[], line: number, paint: BodyPaint): void {
	const glyph = paint === 'added' ? 'insert-sign codicon codicon-add' : 'delete-sign codicon codicon-remove';
	target.push({
		range: new monaco.Range(line, 1, line, 1),
		options: { linesDecorationsClassName: `arxml-diff-sign arxml-diff-sign-${paint} ${glyph}`, zIndex: 1 }
	});
}

/** The VS Code merge margin affordance: one arrow pointing at the other pane. */
function pushMergeDecoration(
	target: monaco.editor.IModelDeltaDecoration[],
	line: number,
	direction: 'left' | 'right'
): void {
	target.push({
		range: new monaco.Range(line, 1, line, 1),
		options: {
			glyphMarginClassName: `arxml-merge-arrow arxml-merge-arrow-${direction} codicon codicon-arrow-${direction}`,
			glyphMarginHoverMessage: { value: 'Copy this element to the other side' },
			glyphMargin: { position: monaco.editor.GlyphMarginLane.Right },
			zIndex: 1
		}
	});
}

const META_CLASSES: Readonly<Record<string, 'short' | 'variant' | 'condition' | 'context'>> = {
	'short name': 'short',
	variant: 'variant',
	condition: 'condition',
	context: 'context'
};

function metaClassForField(field: DiffChange['field']): 'short' | 'variant' | 'condition' | 'context' | undefined {
	return META_CLASSES[field];
}

/** The unique meta part for a semantic field; ambiguous duplicates are skipped. */
function metaPartIndex(cell: DiffCell, cls: 'short' | 'variant' | 'condition' | 'context'): number | undefined {
	let found: number | undefined;
	for (let at = 0; at < cell.meta.length; at += 1) {
		if (cell.meta[at].cls !== cls) {
			continue;
		}
		if (found !== undefined) {
			return undefined;
		}
		found = at;
	}
	return found;
}

interface ChangeSpanSpec {
	field: SearchSpan['field'];
	part?: number;
}

function isValueField(field: DiffChange['field']): boolean {
	return field === 'value' || field === 'shown value' || field === 'target';
}

function metaSpec(cell: DiffCell, field: DiffChange['field']): ChangeSpanSpec | undefined {
	const cls = metaClassForField(field);
	if (cls === undefined) {
		return undefined;
	}
	const part = metaPartIndex(cell, cls);
	return part === undefined ? undefined : { field: 'meta', part };
}

function spanSpecForChange(change: DiffChange, cell: DiffCell): ChangeSpanSpec | undefined {
	if (isValueField(change.field)) {
		return { field: 'value' };
	}
	return metaSpec(cell, change.field);
}

/** The synthetic search span that renders this semantic field on its line. */
function spanForChange(
	line: SyntheticLine | undefined,
	cell: DiffCell | undefined,
	change: DiffChange
): SearchSpan | undefined {
	if (line === undefined || cell === undefined) {
		return undefined;
	}
	const spec = spanSpecForChange(change, cell);
	if (spec === undefined) {
		return undefined;
	}
	return line.searchSpans.find((span) => span.field === spec.field && span.part === spec.part);
}

function spanText(line: SyntheticLine, span: SearchSpan): string {
	return line.text.slice(span.startColumn - 1, span.endColumn - 1);
}

function pushWordDecoration(
	target: monaco.editor.IModelDeltaDecoration[],
	line: number,
	span: SearchSpan,
	word: { start: number; end: number },
	paint: BodyPaint
): void {
	const startColumn = span.startColumn + word.start;
	const endColumn = span.startColumn + word.end;
	if (endColumn <= startColumn) {
		return;
	}
	target.push({
		range: new monaco.Range(line, startColumn, line, endColumn),
		options: { inlineClassName: `arxml-diff-word arxml-diff-word-${paint}`, zIndex: 2 }
	});
}

/** One pane's line text for the same semantic row on the other side. */
function otherSideLine(row: DiffBodyRow, paneSide: DiffSide): SyntheticLine | undefined {
	const other = otherSide(paneSide);
	const line = lineOnSide(row, other);
	const doc = sideDocument(other);
	return line === undefined || doc === undefined ? undefined : doc.lines[line - 1];
}

interface WordLineParts {
	line: SyntheticLine;
	otherLine: SyntheticLine;
	cell: DiffCell;
	otherCell: DiffCell;
}

interface WordPaint {
	span: SearchSpan;
	words: readonly WordSpan[];
}

function isDefined<T>(value: T | undefined): value is T {
	return value !== undefined;
}

function wordLineParts(row: DiffBodyRow, paneSide: DiffSide, nodeLine: number): WordLineParts | undefined {
	const doc = sideDocument(paneSide);
	const line = doc?.lines[nodeLine - 1];
	const otherLine = otherSideLine(row, paneSide);
	const cell = cellOnSide(row, paneSide);
	const otherCell = cellOnSide(row, otherSide(paneSide));
	if (![line, otherLine, cell, otherCell].every(isDefined)) {
		return undefined;
	}
	return { line: line!, otherLine: otherLine!, cell: cell!, otherCell: otherCell! };
}

function wordPairFor(
	parts: WordLineParts,
	paneSpan: SearchSpan,
	otherSpan: SearchSpan,
	paneSide: DiffSide
): WordSpanPair {
	return paneSide === 'left'
		? wordDiffSpans(spanText(parts.line, paneSpan), spanText(parts.otherLine, otherSpan))
		: wordDiffSpans(spanText(parts.otherLine, otherSpan), spanText(parts.line, paneSpan));
}

function wordPaintForChange(
	parts: WordLineParts,
	paneSide: DiffSide,
	change: DiffChange
): WordPaint | undefined {
	const paneSpan = spanForChange(parts.line, parts.cell, change);
	const otherSpan = spanForChange(parts.otherLine, parts.otherCell, change);
	if (paneSpan === undefined || otherSpan === undefined) {
		return undefined;
	}
	const pair = wordPairFor(parts, paneSpan, otherSpan, paneSide);
	return { span: paneSpan, words: paneSide === 'left' ? pair.left : pair.right };
}

function paintWords(
	target: monaco.editor.IModelDeltaDecoration[],
	nodeLine: number,
	paint: WordPaint,
	paintSide: BodyPaint
): void {
	for (const word of paint.words) {
		pushWordDecoration(target, nodeLine, paint.span, word, paintSide);
	}
}

function addWordSpans(
	target: monaco.editor.IModelDeltaDecoration[],
	row: DiffBodyRow,
	paneSide: DiffSide,
	nodeLine: number,
	paint: BodyPaint
): void {
	const parts = wordLineParts(row, paneSide, nodeLine);
	if (parts === undefined) {
		return;
	}
	for (const change of row.changes) {
		const wordPaint = wordPaintForChange(parts, paneSide, change);
		if (wordPaint === undefined) {
			continue;
		}
		paintWords(target, nodeLine, wordPaint, paint);
	}
}

/**
 * Paint the semantic status on the pane that shows the owning cell. Colors and
 * signs follow the displayed pane (original = removed, modified = added), so a
 * swapped side keeps the VS Code diff grammar. Missing-side placeholders have no
 * cell here and are never painted.
 */
function paintedLines(row: DiffBodyRow, side: DiffSide, nodeLine: number): readonly number[] {
	return row.status === 'changed' ? [nodeLine] : linesOnSide(row, side);
}

interface DecoratedPosition {
	cell: DiffCell;
	nodeLine: number;
}

function decoratedPosition(row: DiffBodyRow, side: DiffSide): DecoratedPosition | undefined {
	const cell = cellOnSide(row, side);
	const nodeLine = lineOnSide(row, side);
	if (cell === undefined || nodeLine === undefined) {
		return undefined;
	}
	return { cell, nodeLine };
}

function addRowDecorations(row: DiffBodyRow, pane: BodyPane): void {
	const position = decoratedPosition(row, pane.side);
	if (position === undefined) {
		return;
	}
	for (const line of paintedLines(row, pane.side, position.nodeLine)) {
		pushBodyFill(pane.ranges, line, pane.paint);
		pushBodySign(pane.ranges, line, pane.paint);
	}
	if (row.status === 'changed') {
		addWordSpans(pane.ranges, row, pane.side, position.nodeLine, pane.paint);
	}
}

function changedRows(): readonly DiffBodyRow[] {
	if (body === undefined) {
		return [];
	}
	return body.rows.filter((row) => row.status !== 'unchanged');
}

function addBodyDecorations(
	originalRanges: monaco.editor.IModelDeltaDecoration[],
	modifiedRanges: monaco.editor.IModelDeltaDecoration[]
): void {
	const panes: BodyPane[] = [
		{ ranges: originalRanges, side: displayedSide('original'), paint: 'removed' },
		{ ranges: modifiedRanges, side: displayedSide('modified'), paint: 'added' }
	];
	for (const row of changedRows()) {
		for (const pane of panes) {
			addRowDecorations(row, pane);
		}
	}
}

function pushMergeForSide(
	target: monaco.editor.IModelDeltaDecoration[],
	row: DiffBodyRow,
	side: DiffSide,
	direction: 'left' | 'right'
): void {
	const line = lineOnSide(row, side);
	if (line !== undefined) {
		pushMergeDecoration(target, line, direction);
	}
}

function addMergeRow(
	originalRanges: monaco.editor.IModelDeltaDecoration[],
	modifiedRanges: monaco.editor.IModelDeltaDecoration[],
	row: DiffBodyRow,
	originalSide: DiffSide,
	modifiedSide: DiffSide
): void {
	if (row.status === 'unchanged') {
		return;
	}
	pushMergeForSide(originalRanges, row, originalSide, 'right');
	pushMergeForSide(modifiedRanges, row, modifiedSide, 'left');
}

function addMergeDecorations(
	originalRanges: monaco.editor.IModelDeltaDecoration[],
	modifiedRanges: monaco.editor.IModelDeltaDecoration[]
): void {
	if (!mergeMode || body === undefined) {
		return;
	}
	const originalSide = displayedSide('original');
	const modifiedSide = displayedSide('modified');
	for (const row of body.rows) {
		addMergeRow(originalRanges, modifiedRanges, row, originalSide, modifiedSide);
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
	addBodyDecorations(originalRanges, modifiedRanges);
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
	syncBodyState();
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
		toolbar?.setMergeMode(mergeMode);
		syncBodyState();
		renderDecorations();
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
			mergeMode = !mergeMode;
			toolbar?.setMergeMode(mergeMode);
			postToHost({ type: 'mergeMode', enabled: mergeMode });
			syncBodyState();
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

function handleMergeClick(
	editor: monaco.editor.ICodeEditor,
	pane: 'original' | 'modified',
	line: number
): void {
	const key = keyAt(editor, line, pane);
	if (key === undefined) {
		return;
	}
	const row = body?.byKey.get(key);
	if (row === undefined) {
		return;
	}
	// The clicked owning pane is the source; the host keeps its copy/delete
	// semantics for a side that owns no cell.
	postToHost({ type: 'copy', side: mergeSourceSide(row, displayedSide(pane)), key: row.key });
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

function diffEditorOptions(
	font: ReturnType<typeof editorFontOptions>
): monaco.editor.IStandaloneDiffEditorConstructionOptions {
	return {
		theme: 'arxml-ecuc-theme',
		automaticLayout: true,
		readOnly: true,
		originalEditable: false,
		renderSideBySide: true,
		useInlineViewWhenSpaceIsLimited: false,
		enableSplitViewResizing: false,
		// Semantic signs replace Monaco's text-diff indicators: the aligned body
		// owns the meaning, so no second +/- column may disagree with it.
		renderIndicators: false,
		renderMarginRevertIcon: false,
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
		glyphMargin: true,
		lineNumbers: 'on',
		minimap: { enabled: false }
	});
	diffEditor.getModifiedEditor().updateOptions({
		glyphMargin: true,
		lineNumbers: 'on',
		minimap: { enabled: false }
	});
	syncBodyState();
	diffEditor.onDidUpdateDiff(function () {
		renderDecorations();
	});

	mountToolbar();
	wireSelection();
	wireMergeClicks();
	mounted = true;
	flushPendingMessages();
	postToHost({ type: 'ready' });
}

if (typeof document !== 'undefined' && document.getElementById('diff-list')) {
	void mountDiff();
}
