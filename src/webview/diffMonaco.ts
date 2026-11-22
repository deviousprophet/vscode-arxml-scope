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
import type { DiffCell, DiffDocument, DiffHeader, DiffRow } from '../core/diff/diffModel';import { applyDiffPatch, type DiffPatch } from '../core/diff/diffPatch';
import { DEFAULT_FIND_OPTIONS, type DiffFindMatch, type FindOptions } from '../core/searchModel';
import type { DiffProviderToWebview } from '../diffProtocol';
import {
	buildAlignedSyntheticDocuments,
	type AlignedSyntheticDocuments,
	type SyntheticDocument
} from './monaco/synthetic';
import { defineEcucTheme, ensureMonacoEnvironment, monaco, setModelFolding } from './monaco/setup';
import { DiffToolbar } from './components/toolbar/toolbar';
import { mountSearchBar, renderSearchCount } from './render/searchState';
import type { SearchBar } from './components/searchBar/searchBar';
import { findRanges } from './render/searchPattern';
import { installNoticeErrors } from './render/pageError';
import { postToHost } from './vscodeApi';

let documentModel: DiffDocument | undefined;
let aligned: AlignedSyntheticDocuments | undefined;
let leftModel: monaco.editor.ITextModel | undefined;
let rightModel: monaco.editor.ITextModel | undefined;
let diffEditor: monaco.editor.IStandaloneDiffEditor | undefined;
let toolbar: DiffToolbar | undefined;
let searchBar: SearchBar | undefined;
let swapped = false;
let mergeMode = false;
let changesOnly = false;
let contextActive = true;
let semantic = true;
let selectedKey: string | undefined;
let searchQuery = '';
let searchOptions: FindOptions = { ...DEFAULT_FIND_OPTIONS };
let searchMatches: DiffFindMatch[] = [];
let searchIndex = -1;
let searchRequestId = 0;
let searchRunning = false;
let originalDecorations: string[] = [];
let modifiedDecorations: string[] = [];
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
	return swapped ? aligned?.rightLineKeys ?? [] : aligned?.leftLineKeys ?? [];
}

function modifiedKeys(): (string | undefined)[] {
	return swapped ? aligned?.leftLineKeys ?? [] : aligned?.rightLineKeys ?? [];
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

function keyAt(editor: monaco.editor.ICodeEditor | undefined, line: number, side: 'original' | 'modified'): string | undefined {
	if (editor === undefined) {
		return undefined;
	}
	const keys = side === 'original' ? originalKeys() : modifiedKeys();
	return keys[line - 1];
}

function subtreeKeys(key: string | undefined): Set<string> {
	const out = new Set<string>();
	if (documentModel === undefined || key === undefined) {
		return out;
	}
	const at = documentModel.rows.findIndex((row) => row.key === key);
	if (at < 0) {
		return out;
	}
	const row = documentModel.rows[at];
	for (let index = at; index <= at + row.subtreeSize && index < documentModel.rows.length; index += 1) {
		out.add(documentModel.rows[index].key);
	}
	return out;
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

function setTitles(): void {
	if (documentModel === undefined) {
		return;
	}
	const labels = swapped ? [documentModel.labels[1], documentModel.labels[0]] : documentModel.labels;
	const leftHeader = swapped ? documentModel.rightHeader : documentModel.leftHeader;
	const rightHeader = swapped ? documentModel.leftHeader : documentModel.rightHeader;
	const left = document.getElementById('diff-title-left');
	const right = document.getElementById('diff-title-right');
	if (left !== null) {
		left.textContent = labels[0] + (leftHeader.schema !== undefined ? ` · ${leftHeader.schema}` : '');
		left.title = [swapped ? documentModel.right.path : documentModel.left.path, headerTooltip(leftHeader)]
			.filter((part) => part !== '')
			.join('\n');
	}
	if (right !== null) {
		right.textContent = labels[1] + (rightHeader.schema !== undefined ? ` · ${rightHeader.schema}` : '');
		right.title = [swapped ? documentModel.left.path : documentModel.right.path, headerTooltip(rightHeader)]
			.filter((part) => part !== '')
			.join('\n');
	}
}

function applyDocument(next: DiffDocument, nextSemantic: boolean): void {
	documentModel = next;
	semantic = nextSemantic;
	aligned = buildAlignedSyntheticDocuments(next);
	if (leftModel !== undefined) {
		leftModel.setValue(aligned.left.text);
		setModelFolding(leftModel, aligned.left.foldingRanges);
	}
	if (rightModel !== undefined) {
		rightModel.setValue(aligned.right.text);
		setModelFolding(rightModel, aligned.right.foldingRanges);
	}
	if (diffEditor !== undefined && leftModel !== undefined && rightModel !== undefined) {
		diffEditor.setModel({
			original: swapped ? rightModel : leftModel,
			modified: swapped ? leftModel : rightModel
		});
	}
	selectedKey = undefined;
	setTitles();
	toolbar?.setMatchMode(semantic, false);
	toolbar?.setViewMode(changesOnly);
	toolbar?.setContext(contextActive);
	toolbar?.setSwapped(swapped);
	toolbar?.setMergeMode(mergeMode);
	updateDiffOptions();
	setEmpty(next.summary.changed + next.summary.added + next.summary.removed === 0);
	const skip = document.getElementById('diff-semantic-skip');
	if (skip !== null) {
		if (next.semanticSkipped > 0) {
			skip.hidden = false;
			skip.textContent = `${next.semanticSkipped} container(s) could not be paired semantically.`;
		} else {
			skip.hidden = true;
			skip.textContent = '';
		}
	}
	clearNotice();
	renderDecorations();
}

function identifyRow(key: string): DiffRow | undefined {
	return documentModel?.rows.find((row) => row.key === key);
}

function renderDecorations(): void {
	if (diffEditor === undefined || aligned === undefined) {
		return;
	}
	const original = originalEditor();
	const modified = modifiedEditor();
	if (original === undefined || modified === undefined) {
		return;
	}
	const selected = subtreeKeys(selectedKey);
	const originalRanges: monaco.editor.IModelDeltaDecoration[] = [];
	const modifiedRanges: monaco.editor.IModelDeltaDecoration[] = [];
	const add = (
		target: monaco.editor.IModelDeltaDecoration[],
		line: number | undefined,
		className: string,
		zIndex = 1
	): void => {
		if (line === undefined) {
			return;
		}
		target.push({
			range: new monaco.Range(line, 1, line, 1),
			options: { isWholeLine: true, className, zIndex }
		});
	};

	for (const key of selected) {
		add(originalRanges, lineFor(key, originalDocument()), key === selectedKey ? 'arxml-selected' : 'arxml-subtree');
		add(modifiedRanges, lineFor(key, modifiedDocument()), key === selectedKey ? 'arxml-selected' : 'arxml-subtree');
	}
	for (let at = 0; at < searchMatches.length; at += 1) {
		const match = searchMatches[at];
		const target = match.side === 'left' ? originalRanges : modifiedRanges;
		const doc = match.side === 'left' ? originalDocument() : modifiedDocument();
		const line = lineFor(match.key, doc);
		const lineText = line === undefined ? undefined : doc?.lines[line - 1]?.text;
		const ranges = lineText === undefined ? [] : findRanges(lineText, searchQuery, searchOptions);
		const className = at === searchIndex ? 'arxml-find-current' : 'arxml-find';
		if (line !== undefined && ranges.length > 0) {
			for (const range of ranges) {
				target.push({
					range: new monaco.Range(line, range.start + 1, line, range.end + 1),
					options: { inlineClassName: className }
				});
			}
		} else {
			add(target, line, className, 3);
		}
	}

	if (mergeMode && documentModel !== undefined) {
		for (const row of documentModel.rows) {
			if (row.status === 'unchanged') {
				continue;
			}
			const originalLine = lineFor(row.key, originalDocument());
			const modifiedLine = lineFor(row.key, modifiedDocument());
			const originalIsLeft = !swapped;
			const originalSource = originalIsLeft ? row.left : row.right;
			const modifiedSource = originalIsLeft ? row.right : row.left;
			if (originalLine !== undefined) {
				originalRanges.push({
					range: new monaco.Range(originalLine, 1, originalLine, 1),
					options: {
						glyphMarginClassName: originalSource !== undefined
							? originalIsLeft ? 'arxml-merge-arrow-right' : 'arxml-merge-arrow-left'
							: originalIsLeft ? 'arxml-merge-arrow-left' : 'arxml-merge-arrow-right',
						glyphMarginHoverMessage: { value: originalSource !== undefined ? 'Copy this element to the other side' : 'Delete this element from the other side' }
					}
				});
			}
			if (modifiedLine !== undefined) {
				modifiedRanges.push({
					range: new monaco.Range(modifiedLine, 1, modifiedLine, 1),
					options: {
						glyphMarginClassName: modifiedSource !== undefined
							? originalIsLeft ? 'arxml-merge-arrow-left' : 'arxml-merge-arrow-right'
							: originalIsLeft ? 'arxml-merge-arrow-right' : 'arxml-merge-arrow-left',
						glyphMarginHoverMessage: { value: modifiedSource !== undefined ? 'Copy this element to the other side' : 'Delete this element from the other side' }
					}
				});
			}
		}
	}

	originalDecorations = original.deltaDecorations(originalDecorations, originalRanges);
	modifiedDecorations = modified.deltaDecorations(modifiedDecorations, modifiedRanges);
}

function revealKey(key: string | undefined): void {
	if (key === undefined) {
		return;
	}
	const line = lineFor(key, modifiedDocument());
	if (line === undefined) {
		return;
	}
	modifiedEditor()?.revealLineInCenter(line);
	modifiedEditor()?.setPosition({ lineNumber: line, column: 1 });
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
	if (diffEditor !== undefined && leftModel !== undefined && rightModel !== undefined) {
		diffEditor.setModel({
			original: swapped ? rightModel : leftModel,
			modified: swapped ? leftModel : rightModel
		});
	}
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

function navigate(direction: 1 | -1): void {
	const changes = changeList();
	if (changes.length === 0) {
		setNotice('No differences to navigate');
		return;
	}
	const current = modifiedEditor()?.getPosition()?.lineNumber ?? 0;
	let index = changes.findIndex((change) => (change.modifiedStartLineNumber || change.originalStartLineNumber) >= current);
	if (direction < 0) {
		index = -1;
		for (let at = changes.length - 1; at >= 0; at -= 1) {
			if ((changes[at].modifiedStartLineNumber || changes[at].originalStartLineNumber) < current) {
				index = at;
				break;
			}
		}
	}
	if (index < 0) {
		index = direction > 0 ? 0 : changes.length - 1;
	}
	const change = changes[index];
	const line = change.modifiedStartLineNumber || change.originalStartLineNumber;
	modifiedEditor()?.revealLineInCenter(line);
	modifiedEditor()?.setPosition({ lineNumber: line, column: 1 });
}

function renderSearchUi(): void {
	if (searchBar === undefined) {
		return;
	}
	renderSearchCount(searchBar, searchQuery.trim() !== '', searchQuery, searchMatches.length, searchIndex, searchRunning);
}

function resetSearch(): void {
	searchMatches = [];
	searchIndex = -1;
	searchQuery = '';
	searchRunning = false;
	renderSearchUi();
	renderDecorations();
}

function startSearch(query: string): void {
	const text = (query || '').trim();
	if (text === '') {
		resetSearch();
		return;
	}
	searchQuery = query;
	searchMatches = [];
	searchIndex = -1;
	const requestId = (searchRequestId += 1);
	searchRunning = true;
	renderSearchUi();
	postToHost({ type: 'find', requestId, query, options: searchOptions, changesOnly });
}

function applyFindResult(requestId: number, result: { matches: DiffFindMatch[] }, error?: string): void {
	if (requestId !== searchRequestId) {
		return;
	}
	if (error !== undefined) {
		searchMatches = [];
		searchIndex = -1;
		searchRunning = false;
		renderSearchUi();
		setNotice(error);
		return;
	}
	searchMatches = result.matches;
	searchIndex = searchMatches.length > 0 ? 0 : -1;
	searchRunning = false;
	renderSearchUi();
	renderDecorations();
	const match = searchMatches[searchIndex];
	revealKey(match?.key);
}

function cycleSearch(direction: number): void {
	if (searchMatches.length === 0) {
		return;
	}
	const step = direction < 0 ? -1 : 1;
	searchIndex = (searchIndex + step + searchMatches.length) % searchMatches.length;
	renderSearchUi();
	renderDecorations();
	revealKey(searchMatches[searchIndex]?.key);
}

function handleMessage(message: DiffProviderToWebview): void {
	if (!message || typeof message.type !== 'string') {
		return;
	}
	if (message.type === 'document') {
		applyDocument(message.document, message.semantic);
		return;
	}
	if (message.type === 'documentPatch') {
		if (documentModel !== undefined) {
			applyDocument(applyDiffPatch(documentModel, message.patch), semantic);
		}
		return;
	}
	if (message.type === 'matchModeState') {
		semantic = message.semantic;
		toolbar?.setMatchMode(semantic, false);
		return;
	}
	if (message.type === 'mergeMode') {
		mergeMode = message.enabled;
		toolbar?.setMergeMode(mergeMode);
		renderDecorations();
		return;
	}
	if (message.type === 'labels') {
		if (documentModel !== undefined) {
			documentModel = { ...documentModel, labels: message.labels };
			setTitles();
		}
		return;
	}
	if (message.type === 'theme') {
		defineEcucTheme();
		monaco.editor.setTheme('arxml-ecuc-theme');
		return;
	}
	if (message.type === 'findResult') {
		applyFindResult(message.requestId, message.result, message.error);
		return;
	}
	if (message.type === 'error') {
		setNotice(message.message, 'error');
	}
}

function openSearch(expandReplace: boolean): void {
	if (searchBar === undefined) {
		return;
	}
	searchBar.show(expandReplace);
	requestAnimationFrame(function () {
		searchBar?.focus();
	});
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

function wireMergeClicks(): void {
	const original = originalEditor();
	const modified = modifiedEditor();
	if (original === undefined || modified === undefined) {
		return;
	}
	const click = (side: 'original' | 'modified') => (event: monaco.editor.IEditorMouseEvent) => {
		if (!mergeMode || event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
			return;
		}
		const line = event.target.position?.lineNumber;
		if (line === undefined) {
			return;
		}
		const key = keyAt(side === 'original' ? original : modified, line, side);
		const row = key === undefined ? undefined : identifyRow(key);
		if (row === undefined) {
			return;
		}
		const originalIsLeft = !swapped;
		const displayedSource = side === 'original'
			? originalIsLeft ? row.left : row.right
			: originalIsLeft ? row.right : row.left;
		const hostSide = displayedSource !== undefined
			? side === 'original'
				? originalIsLeft ? 'left' : 'right'
				: originalIsLeft ? 'right' : 'left'
			: side === 'original'
				? originalIsLeft ? 'right' : 'left'
				: originalIsLeft ? 'left' : 'right';
		postToHost({ type: 'copy', side: hostSide, key: row.key });
	};
	original.onMouseDown(click('original'));
	modified.onMouseDown(click('modified'));
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

export async function mountDiff(): Promise<void> {
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
	diffEditor.getOriginalEditor().updateOptions({ glyphMargin: true, lineNumbers: 'on', minimap: { enabled: false } });
	diffEditor.getModifiedEditor().updateOptions({ glyphMargin: true, lineNumbers: 'on', minimap: { enabled: false } });
	diffEditor.onDidUpdateDiff(function () {
		renderDecorations();
	});

	mountToolbar();
	searchBar = mountSearchBar(
		'diff-',
		function () {
			return searchQuery;
		},
		function () {
			return searchMatches.length > 0;
		},
		resetSearch,
		startSearch,
		cycleSearch,
		renderSearchUi,
		function () {},
		false,
		function () {
			modifiedEditor()?.focus();
		},
		{
			onOptions: function (options) {
				searchOptions = options;
				if (searchQuery.trim() !== '') {
					startSearch(searchQuery);
				}
			}
		}
	);
	wireSelection();
	wireMergeClicks();
	document.addEventListener(
		'keydown',
		function (event) {
			const command = event.ctrlKey || event.metaKey;
			if (command && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
				event.preventDefault();
				event.stopPropagation();
				openSearch(false);
				return;
			}
			if (command && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'h') {
				event.preventDefault();
				event.stopPropagation();
				openSearch(true);
				return;
			}
			if (event.key === 'F3' && searchQuery.trim() !== '') {
				event.preventDefault();
				cycleSearch(event.shiftKey ? -1 : 1);
				return;
			}
			if (event.key === 'Escape' && searchBar?.visible === true) {
				event.preventDefault();
				searchBar.hide();
				resetSearch();
			}
		},
		true
	);
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
