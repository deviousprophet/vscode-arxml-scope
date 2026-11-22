/**
 * The Monaco ECUC editor page.
 *
 * The host owns scanning, ordering and every write. This page serializes the
 * row store into the synthetic ECUC document, mounts the real VS Code editor on
 * it, and keeps the toolbar, Details/Conditions sidebar and find widget around
 * the editor surface.
 */
import './styles/tokens.css';
import './styles/base.css';
import './monaco/monaco.css';
import type { EcucRow, RowCondition } from '../core/ecuc/renderRows';
import type {
	EditorDocumentHeader,
	EditorProviderToWebview,
	EditorRowPatch,
	MonacoSettings
} from '../webviewProtocol';
import { DEFAULT_FIND_OPTIONS, type FindMatch, type FindOptions } from '../core/searchModel';
import {
	buildSyntheticDocument,
	rawFieldText,
	syntheticRowLine,
	type SyntheticDocument,
	type SyntheticLine,
	type FieldSpan
} from './monaco/synthetic';
import { createEcucEditor, defineEcucTheme, ensureMonacoEnvironment, monaco, setModelFolding } from './monaco/setup';
import { EditorToolbar } from './components/toolbar/toolbar';
import {
	getSidebarState,
	mountSidebarShell,
	setSidebarHidden,
	setSidebarPersistence,
	setSidebarState,
	showSidebarSection,
	showSidebarTab,
	type SidebarUiState
} from './components/sidebar/sidebar';
import {
	definitionRows,
	inspectorFields,
	refusalShownInDetails
} from './components/sidebar/detailsPanel/detailsPanel';
import type { InspectorFields } from './components/sidebar/detailsPanel/detailsPanel';
import {
	beginDetailsEdit,
	detailsContainerFields,
	detailsSelectionChanged,
	detailsValueInput,
	handleDetailsEditorMessage,
	resetDetailsEditorState,
	setDetailsEditorHost
} from './components/detailsEditor/detailsEditor';
import {
	applyDisabledCount,
	ensureDiscoveredConditionRows,
	mountConditionsPanel,
	renderConditionEntries,
	setConditionRows,
	setConditionsCallback,
	setConditionsErrorReporter,
	setConditionsStatus
} from './components/sidebar/conditionsPanel/conditionsPanel';
import { mountSearchBar, renderSearchCount } from './render/searchState';
import type { SearchBar } from './components/searchBar/searchBar';
import { inspectorElement } from './render/dom';
import { appendConditionTokens } from './render/rowView';
import { findRanges } from './render/searchPattern';
import { installConsoleErrors } from './render/pageError';
import { postToHost, readPageState, resetVsCodeApi, writePageState } from './vscodeApi';

let rows: EcucRow[] = [];
let rowById = new Map<string, EcucRow>();
let rowIndexById = new Map<string, number>();
let header: EditorDocumentHeader | undefined;
let documentModel: SyntheticDocument = buildSyntheticDocument([]);
let editor: monaco.editor.IStandaloneCodeEditor | undefined;
let model: monaco.editor.ITextModel | undefined;
let editorToolbar: EditorToolbar | undefined;
let searchBar: SearchBar;
let selectedId: string | undefined;
let subtreeIds = new Set<string>();
let searchQuery = '';
let searchOptions: FindOptions = { ...DEFAULT_FIND_OPTIONS };
let searchMatches: FindMatch[] = [];
let searchIndex = -1;
let searchRequestId = 0;
let searchRunning = false;
let applyingModel = false;
let pendingEdit = false;
let decorationIds: string[] = [];
let detailsBody: HTMLElement | null = null;
let detailsStatus: HTMLElement | null = null;
let reportError: (text: string) => void = function () {};
let mounted = false;
const pendingMessages: EditorProviderToWebview[] = [];

if (typeof window !== 'undefined') {
	window.addEventListener('message', function (event) {
		const message = event.data as EditorProviderToWebview;
		if (!mounted) {
			pendingMessages.push(message);
			return;
		}
		handleMessage(message);
	});
}

function indexRows(): void {
	rowById = new Map();
	rowIndexById = new Map();
	for (let at = 0; at < rows.length; at += 1) {
		rowById.set(rows[at].id, rows[at]);
		rowIndexById.set(rows[at].id, at);
	}
}

function subtreeRowIdsOf(id: string | undefined): Set<string> {
	const out = new Set<string>();
	if (id === undefined) {
		return out;
	}
	const at = rowIndexById.get(id);
	const row = rowById.get(id);
	if (at === undefined || row === undefined) {
		return out;
	}
	for (let index = at; index <= at + row.subtreeSize && index < rows.length; index += 1) {
		out.add(rows[index].id);
	}
	return out;
}

function selectedRow(): EcucRow | undefined {
	return selectedId === undefined ? undefined : rowById.get(selectedId);
}

function lineOf(rowId: string | undefined): number | undefined {
	return rowId === undefined ? undefined : documentModel.rowLine.get(rowId);
}

function rowIdAtLine(line: number): string | undefined {
	return documentModel.lines[line - 1]?.rowId;
}

function setDetailsStatus(message: { message?: string; kind?: string }): void {
	if (!detailsStatus) {
		return;
	}
	detailsStatus.textContent = message.message || '';
	if (message.kind) {
		detailsStatus.dataset.kind = message.kind;
	} else {
		delete detailsStatus.dataset.kind;
	}
}

function clearDetailsStatus(): void {
	if (!detailsStatus) {
		return;
	}
	detailsStatus.textContent = '';
	delete detailsStatus.dataset.kind;
}

function inspectorRow(key: string, value: string): HTMLElement {
	const row = inspectorElement('div', 'inspector-row');
	row.appendChild(inspectorElement('span', 'inspector-key', key));
	row.appendChild(inspectorElement('div', 'inspector-code', value));
	return row;
}

function conditionCodeRow(key: string, text: string): HTMLElement {
	const row = inspectorElement('div', 'inspector-row');
	row.appendChild(inspectorElement('span', 'inspector-key', key));
	const code = inspectorElement('div', 'inspector-code condition-code');
	appendConditionTokens(code, text, '');
	row.appendChild(code);
	return row;
}

function paneActions(body: HTMLElement): HTMLElement {
	const actions = inspectorElement('div', 'inspector-actions');
	body.appendChild(actions);
	return actions;
}

function appendInspectorField(key: string, value: string): void {
	detailsBody?.appendChild(inspectorRow(key, value));
}

function renderEmptyInspector(): void {
	detailsSelectionChanged(undefined);
	const emptyPanel = inspectorElement('div', 'inspector-empty');
	emptyPanel.appendChild(inspectorElement('p', '', 'Select a line to see its details.'));
	emptyPanel.appendChild(inspectorElement('p', 'inspector-hint', 'Use the arrow keys to move through the document.'));
	detailsBody?.appendChild(emptyPanel);
}

function renderIdentityFields(row: EcucRow, data: InspectorFields): void {
	detailsBody?.appendChild(inspectorElement('div', 'inspector-kind', data.kind));
	detailsBody?.appendChild(inspectorElement('div', 'inspector-label', data.label));
	if (row.kind === 'container') {
		if (detailsBody) {
			detailsBody.appendChild(detailsContainerFields(row, data));
		}
		return;
	}
	if (data.definitionRef) {
		appendInspectorField('Definition', data.definitionRef);
	}
	if (data.shortName) {
		appendInspectorField('Short name', data.shortName);
	}
}

function renderTypeFields(data: InspectorFields): void {
	if (data.variant) {
		appendInspectorField('Variant', data.variant);
	}
	if (data.type) {
		appendInspectorField('Type', data.type);
	}
}

function renderParameterValue(row: EcucRow, data: InspectorFields): void {
	if (data.kind === 'parameter' && detailsBody) {
		detailsBody.appendChild(detailsValueInput(row, data));
	}
	for (const format of data.formats) {
		appendInspectorField(format.label, format.value);
	}
}

function renderReferenceFields(row: EcucRow, data: InspectorFields): void {
	if (data.target) {
		appendInspectorField('Target', data.target);
	}
	if (row.followReason !== undefined) {
		appendInspectorField('Target note', row.followReason);
	}
	if (data.context) {
		appendInspectorField('Context', data.context);
	}
}

function renderCondition(condition: RowCondition): void {
	detailsBody?.appendChild(conditionCodeRow('Condition', condition.text));
	appendInspectorField('Condition state', condition.state);
	if (condition.reason) {
		appendInspectorField('Condition note', condition.reason);
	}
}

function renderConditionFields(row: EcucRow, data: InspectorFields): void {
	if (data.condition) {
		renderCondition(data.condition);
	} else if (row.disabled && row.disabledBy === 'ancestor') {
		appendInspectorField('Disabled', 'Disabled by an ancestor condition.');
	}
}

function renderConditionSummary(data: InspectorFields): void {
	if (data.conditions && detailsBody) {
		detailsBody.appendChild(conditionCodeRow('Conditions', data.conditions));
	}
	if (data.annotations) {
		appendInspectorField('Annotations', data.annotations);
	}
}

function renderDefinitionFields(data: InspectorFields): void {
	if (data.definition) {
		for (const field of definitionRows(data.definition)) {
			appendInspectorField(field.label, field.value);
		}
		return;
	}
	if (data.definitionCount !== undefined && data.definitionCount >= 2) {
		appendInspectorField('Definition type', `${data.definitionCount} definitions found`);
	}
}

function isFollowableReference(row: EcucRow): boolean {
	return row.kind === 'reference' && row.followable === true;
}

function appendJumpAction(actions: HTMLElement, row: EcucRow): void {
	if (!isFollowableReference(row)) {
		return;
	}
	const jump = inspectorElement('button', 'sb-btn sb-btn-secondary', 'Jump to target') as HTMLButtonElement;
	jump.type = 'button';
	jump.addEventListener('click', function () {
		postToHost({ type: 'follow', nodeId: row.id });
	});
	actions.appendChild(jump);
}

function appendReferencesAction(actions: HTMLElement, row: EcucRow): void {
	if (row.kind !== 'module' && row.kind !== 'container') {
		return;
	}
	const references = inspectorElement('button', 'sb-btn sb-btn-secondary', 'Find references') as HTMLButtonElement;
	references.type = 'button';
	references.addEventListener('click', function () {
		postToHost({ type: 'references', nodeId: row.id });
	});
	actions.appendChild(references);
}

function appendRevealAction(actions: HTMLElement, row: EcucRow): void {
	const reveal = inspectorElement('button', 'sb-btn sb-btn-secondary', 'Reveal in source') as HTMLButtonElement;
	reveal.type = 'button';
	reveal.addEventListener('click', function () {
		postToHost({ type: 'reveal', nodeId: row.id });
	});
	actions.appendChild(reveal);
}

function renderInspectorActions(row: EcucRow): void {
	if (!detailsBody) {
		return;
	}
	const actions = paneActions(detailsBody);
	appendJumpAction(actions, row);
	appendReferencesAction(actions, row);
	appendRevealAction(actions, row);
}

function updateInspector(): void {
	if (!detailsBody) {
		return;
	}
	detailsBody.textContent = '';
	const row = selectedRow();
	if (row === undefined) {
		renderEmptyInspector();
		return;
	}
	detailsSelectionChanged(row.id);
	const data = inspectorFields(row);
	renderIdentityFields(row, data);
	renderTypeFields(data);
	renderParameterValue(row, data);
	renderReferenceFields(row, data);
	renderConditionFields(row, data);
	renderConditionSummary(data);
	renderDefinitionFields(data);
	renderInspectorActions(row);
}

function applyDecorations(): void {
	if (editor === undefined) {
		return;
	}
	const decorations: monaco.editor.IModelDeltaDecoration[] = [];
	const addWholeLine = (line: number | undefined, className: string, zIndex = 1): void => {
		if (line === undefined) {
			return;
		}
		decorations.push({
			range: new monaco.Range(line, 1, line, 1),
			options: { isWholeLine: true, className, zIndex }
		});
	};
	for (const id of subtreeIds) {
		if (id !== selectedId) {
			addWholeLine(lineOf(id), 'arxml-subtree');
		}
	}
	addWholeLine(lineOf(selectedId), 'arxml-selected');
	for (const row of rows) {
		if (row.disabled) {
			addWholeLine(lineOf(row.id), 'arxml-disabled');
		}
	}
	for (let at = 0; at < searchMatches.length; at += 1) {
		const match = searchMatches[at];
		const line = lineOf(match.rowId);
		const lineText = line === undefined ? undefined : documentModel.lines[line - 1]?.text;
		const ranges = lineText === undefined ? [] : findRanges(lineText, searchQuery, searchOptions);
		const className = at === searchIndex ? 'arxml-find-current' : 'arxml-find';
		if (line !== undefined && ranges.length > 0) {
			for (const range of ranges) {
				decorations.push({
					range: new monaco.Range(line, range.start + 1, line, range.end + 1),
					options: { inlineClassName: className }
				});
			}
		} else {
			addWholeLine(line, className, 2);
		}
	}
	decorationIds = editor.deltaDecorations(decorationIds, decorations);
}

function setSelection(id: string | undefined, reveal = false): void {
	selectedId = id;
	subtreeIds = subtreeRowIdsOf(id);
	updateInspector();
	applyDecorations();
	if (reveal) {
		revealRow(id);
	}
}

function revealRow(id: string | undefined, focus = false, column = 1): void {
	if (editor === undefined || id === undefined) {
		return;
	}
	const line = lineOf(id);
	if (line === undefined) {
		return;
	}
	editor.revealLineInCenter(line);
	const maxColumn = editor.getModel()?.getLineMaxColumn(line) ?? 1;
	editor.setPosition({ lineNumber: line, column: Math.min(column, maxColumn) });
	if (focus) {
		editor.focus();
	}
}

function applyRows(nextRows: EcucRow[], nextHeader?: EditorDocumentHeader, nextSelectedId?: string): void {
	pendingEdit = false;
	rows = Array.isArray(nextRows) ? nextRows : [];
	indexRows();
	if (nextHeader !== undefined) {
		header = nextHeader;
	}
	documentModel = buildSyntheticDocument(rows, header);
	const previousColumn = editor?.getPosition()?.column ?? 1;
	if (model !== undefined) {
		applyingModel = true;
		model.setValue(documentModel.text);
		applyingModel = false;
		setModelFolding(model, documentModel.foldingRanges);
	}
	if (nextSelectedId !== undefined) {
		selectedId = nextSelectedId;
	}
	if (selectedId !== undefined && !rowById.has(selectedId)) {
		selectedId = undefined;
	}
	subtreeIds = subtreeRowIdsOf(selectedId);
	setConditionRows(rows);
	ensureDiscoveredConditionRows();
	applyDisabledCount();
	updateInspector();
	applyDecorations();
	if (selectedId !== undefined) {
		revealRow(selectedId, false, previousColumn);
	}
}

function applyPatch(patch: EditorRowPatch, nextHeader?: EditorDocumentHeader, nextSelectedId?: string): void {
	if (!patch.structural && patch.remove === 1 && patch.rows.length === 1) {
		const existing = rows[patch.at];
		const incoming = patch.rows[0];
		if (existing !== undefined && incoming !== undefined && existing.id === incoming.id) {
			const row = { ...existing, ...incoming };
			rows[patch.at] = row;
			indexRows();
			const line = documentModel.rowLine.get(row.id);
			if (line !== undefined && model !== undefined) {
				const built = syntheticRowLine(row);
				documentModel.lines[line - 1] = {
					line,
					rowId: row.id,
					kind: row.kind,
					text: built.text,
					fieldSpans: built.fieldSpans
				};
				applyingModel = true;
				model.pushEditOperations(
					[],
					[{ range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)), text: built.text }],
					function () {
						return null;
					}
				);
				applyingModel = false;
			}
			if (nextHeader !== undefined) {
				header = nextHeader;
			}
			if (nextSelectedId !== undefined) {
				selectedId = nextSelectedId;
			}
			subtreeIds = subtreeRowIdsOf(selectedId);
			applyDisabledCount();
			updateInspector();
			applyDecorations();
			return;
		}
	}
	const next = rows.slice();
	next.splice(patch.at, patch.remove, ...patch.rows);
	applyRows(next, nextHeader, nextSelectedId);
}

function currentMatchId(): string | undefined {
	return searchMatches[searchIndex]?.rowId;
}

function renderSearchUi(): void {
	if (!searchBar) {
		return;
	}
	renderSearchCount(
		searchBar,
		searchQuery.trim() !== '',
		searchQuery,
		searchMatches.length,
		searchIndex,
		searchRunning
	);
}

function setSearchBusy(busy: boolean): void {
	searchRunning = busy;
	renderSearchUi();
}

function resetSearchResults(): void {
	searchMatches = [];
	searchIndex = -1;
	searchQuery = '';
	searchRunning = false;
	renderSearchUi();
	applyDecorations();
}

function startSearch(query: string): void {
	const text = (query || '').trim();
	if (text === '') {
		resetSearchResults();
		return;
	}
	searchQuery = query;
	searchIndex = -1;
	searchMatches = [];
	const requestId = (searchRequestId += 1);
	setSearchBusy(true);
	postToHost({ type: 'find', requestId, query, options: searchOptions });
}

function applyFindResult(requestId: number, result: { matches: FindMatch[] }, error?: string): void {
	if (requestId !== searchRequestId) {
		return;
	}
	if (error !== undefined) {
		searchMatches = [];
		searchIndex = -1;
		setSearchBusy(false);
		setDetailsStatus({ message: error, kind: 'warn' });
		return;
	}
	searchMatches = result.matches;
	searchIndex = searchMatches.length > 0 ? 0 : -1;
	setSearchBusy(false);
	applyDecorations();
	revealRow(currentMatchId());
}

function cycleSearch(direction: number): void {
	if (searchMatches.length === 0) {
		return;
	}
	searchIndex = (searchIndex + direction + searchMatches.length) % searchMatches.length;
	renderSearchUi();
	applyDecorations();
	revealRow(currentMatchId());
}

function requestReplace(replacement: string, all: boolean): void {
	const match = searchMatches[searchIndex];
	if (match === undefined) {
		return;
	}
	const requestId = (searchRequestId += 1);
	postToHost({
		type: 'replace',
		requestId,
		query: searchQuery,
		options: searchOptions,
		replacement,
		preserveCase: searchBar?.preserveCase() === true,
		all,
		match: {
			rowId: match.rowId,
			field: match.field,
			start: match.rawStart !== undefined ? match.rawStart : match.start,
			end: match.rawEnd !== undefined ? match.rawEnd : match.end
		}
	});
}

function applyReplaceResult(requestId: number, result: { ok: boolean; reason?: string; replacedFields: number }): void {
	if (requestId !== searchRequestId) {
		return;
	}
	if (!result.ok) {
		setDetailsStatus({ message: result.reason || 'Replace refused', kind: 'warn' });
		return;
	}
	setDetailsStatus({ message: `Replaced ${result.replacedFields} field(s)`, kind: 'info' });
	startSearch(searchQuery);
}

function applySidebarVisibility(hidden: boolean): void {
	setSidebarHidden(hidden);
	editorToolbar?.setSidebarHidden(hidden);
}

function foldAll(): void {
	editor?.trigger('toolbar', 'editor.foldAll', null);
}

function unfoldAll(): void {
	editor?.trigger('toolbar', 'editor.unfoldAll', null);
}

function focusAdjacentParameter(fromId: string, direction: string): string | undefined {
	const parameters = rows.filter((row) => row.kind === 'parameter');
	const at = parameters.findIndex((row) => row.id === fromId);
	if (at < 0) {
		return undefined;
	}
	const next = parameters[direction === 'next' ? at + 1 : at - 1];
	if (next === undefined) {
		return undefined;
	}
	revealRow(next.id);
	return next.id;
}

function handleMultiChange(event: monaco.editor.IModelContentChangedEvent): void {
	if (model === undefined) {
		return;
	}
	const seenLines = new Set<number>();
	const edits: { span: FieldSpan; lineText: SyntheticLine; text: string; row: EcucRow }[] = [];
	for (const change of event.changes) {
		if (change.range.startLineNumber !== change.range.endLineNumber || /[\r\n]/.test(change.text)) {
			rebuildModel();
			return;
		}
		const line = change.range.startLineNumber;
		if (seenLines.has(line)) {
			// Two edits on one line cannot be mapped to independent fields safely.
			rebuildModel();
			return;
		}
		seenLines.add(line);
		const spans = documentModel.lines[line - 1]?.fieldSpans ?? [];
		const span = spans.find(
			(candidate) =>
				change.range.startColumn >= candidate.startColumn &&
				change.range.endColumn <= candidate.endColumn
		);
		const lineText = documentModel.lines[line - 1];
		if (span === undefined || lineText === undefined) {
			rebuildModel();
			return;
		}
		const current = model.getLineContent(line);
		const suffix = lineText.text.slice(span.endColumn - 1);
		const text = current.slice(span.startColumn - 1, current.length - suffix.length);
		const row = rowById.get(span.nodeId);
		if (text === '' || /[\r\n]/.test(text) || row === undefined) {
			rebuildModel();
			return;
		}
		edits.push({ span, lineText, text, row });
	}
	if (edits.length === 0) {
		return;
	}
	for (const edit of edits) {
		edit.lineText.text = model.getLineContent(edit.lineText.line);
		edit.span.text = edit.text;
		edit.span.endColumn = edit.span.startColumn + edit.text.length;
		pendingEdit = true;
		postToHost({
			type: 'edit',
			nodeId: edit.span.nodeId,
			field: edit.span.field,
			value: edit.span.field === 'value' ? rawFieldText(edit.row, edit.text) : edit.text
		});
	}
}

function handleEdit(event: monaco.editor.IModelContentChangedEvent): void {
	if (applyingModel || model === undefined) {
		return;
	}
	if (event.changes.length > 1) {
		handleMultiChange(event);
		return;
	}
	const change = event.changes[0];
	if (change.range.startLineNumber !== change.range.endLineNumber || /[\r\n]/.test(change.text)) {
		rebuildModel();
		return;
	}
	const line = change.range.startLineNumber;
	const spans = documentModel.lines[line - 1]?.fieldSpans ?? [];
	const span = spans.find(
		(candidate) =>
			change.range.startColumn >= candidate.startColumn &&
			change.range.endColumn <= candidate.endColumn
	);
	if (span === undefined || model === undefined) {
		rebuildModel();
		return;
	}
	const lineText = documentModel.lines[line - 1];
	if (lineText === undefined) {
		rebuildModel();
		return;
	}
	const current = model.getLineContent(line);
	const suffix = lineText.text.slice(span.endColumn - 1);
	const text = current.slice(span.startColumn - 1, current.length - suffix.length);
	if (text === '' || /[\r\n]/.test(text)) {
		rebuildModel();
		return;
	}
	const row = rowById.get(span.nodeId);
	if (row === undefined) {
		rebuildModel();
		return;
	}
	// Keep the local map in sync while the host round-trip is in flight.
	lineText.text = current;
	span.text = text;
	span.endColumn = span.startColumn + text.length;
	pendingEdit = true;
	postToHost({
		type: 'edit',
		nodeId: span.nodeId,
		field: span.field,
		value: span.field === 'value' ? rawFieldText(row, text) : text
	});
}

function rebuildModel(): void {
	if (model === undefined) {
		return;
	}
	documentModel.text = documentModel.lines.map((line) => line.text).join('\n');
	applyingModel = true;
	model.setValue(documentModel.text);
	applyingModel = false;
}

function openSearch(expandReplace: boolean): void {
	searchBar.show(expandReplace);
	// Monaco can take focus back in the same keydown turn; focus the widget
	// after the editor's own handler has run.
	requestAnimationFrame(function () {
		searchBar.focus();
	});
}

function installShortcuts(): void {
	if (editor === undefined) {
		return;
	}
	editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, function () {
		postToHost({ type: 'undo' });
	});
	editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ, function () {
		postToHost({ type: 'redo' });
	});
	editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, function () {
		postToHost({ type: 'redo' });
	});
	editor.addCommand(monaco.KeyCode.F2, function () {
		if (selectedId !== undefined) {
			beginDetailsEdit(selectedId);
		}
	});
	editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, function () {
		if (selectedId !== undefined) {
			postToHost({ type: 'reveal', nodeId: selectedId });
		}
	});
	editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.Enter, function () {
		if (selectedId !== undefined) {
			postToHost({ type: 'reveal', nodeId: selectedId });
		}
	});
	editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyZ, function () {
		const current = editor?.getOption(monaco.editor.EditorOption.wordWrap);
		editor?.updateOptions({ wordWrap: current === 'off' ? 'on' : 'off' });
	});
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
			}
		},
		true
	);
}

function registerEditorActions(): void {
	if (editor === undefined) {
		return;
	}
	editor.addAction({
		id: 'undo',
		label: 'Undo',
		run: function () {
			postToHost({ type: 'undo' });
		}
	});
	editor.addAction({
		id: 'redo',
		label: 'Redo',
		run: function () {
			postToHost({ type: 'redo' });
		}
	});
	editor.addAction({
		id: 'arxml.duplicateElement',
		label: 'Duplicate ECUC element',
		contextMenuGroupId: 'arxml',
		run: function () {
			if (selectedId !== undefined) {
				postToHost({ type: 'duplicate', nodeId: selectedId });
			}
		}
	});
	editor.addAction({
		id: 'arxml.deleteElement',
		label: 'Delete ECUC element',
		contextMenuGroupId: 'arxml',
		run: function () {
			if (selectedId !== undefined) {
				postToHost({ type: 'delete', nodeId: selectedId });
			}
		}
	});
}

function handleMessage(message: EditorProviderToWebview): void {
	if (!message || typeof message.type !== 'string') {
		return;
	}
	handleDetailsEditorMessage(message);
	if (message.type === 'document') {
		applySettings(message.document.settings);
		applyRows(message.document.rows, message.document.header, message.document.selectedId);
		return;
	}
	if (message.type === 'documentPatch') {
		pendingEdit = false;
		applyPatch(message.patch, message.header, message.selectedId);
		return;
	}
	if (message.type === 'settings') {
		applySettings(message.settings);
		return;
	}
	if (message.type === 'theme') {
		defineEcucTheme();
		monaco.editor.setTheme('arxml-ecuc-theme');
		return;
	}
	if (message.type === 'conditions') {
		renderConditionEntries(message.entries);
		return;
	}
	if (message.type === 'select') {
		if (rowById.has(message.nodeId)) {
			setSelection(message.nodeId, true);
		}
		return;
	}
	if (message.type === 'findResult') {
		applyFindResult(message.requestId, message.result, message.error);
		return;
	}
	if (message.type === 'replaceResult') {
		applyReplaceResult(message.requestId, message.result);
		return;
	}
	if (message.type === 'notice') {
		if (message.scope === 'conditions') {
			setConditionsStatus(message.message || '');
			return;
		}
		if (pendingEdit && message.kind === 'warn') {
			pendingEdit = false;
			rebuildModel();
		}
		if (!refusalShownInDetails(message, getSidebarState().tab !== 'details')) {
			setDetailsStatus(message);
		}
		return;
	}
	if (message.type === 'error') {
		setDetailsStatus({ message: message.message, kind: 'warn' });
	}
}

function applySettings(settings: MonacoSettings | undefined): void {
	if (editor === undefined || settings === undefined) {
		return;
	}
	editor.updateOptions({
		...(settings.fontFamily !== undefined ? { fontFamily: settings.fontFamily } : {}),
		...(settings.fontSize !== undefined ? { fontSize: settings.fontSize } : {}),
		...(settings.lineHeight !== undefined && settings.lineHeight > 0 ? { lineHeight: settings.lineHeight } : {}),
		...(settings.fontWeight !== undefined ? { fontWeight: settings.fontWeight } : {}),
		...(settings.wordWrap !== undefined ? { wordWrap: settings.wordWrap } : {}),
		...(settings.wordWrapColumn !== undefined ? { wordWrapColumn: settings.wordWrapColumn } : {}),
		...(settings.minimap !== undefined ? { minimap: { enabled: settings.minimap } } : {}),
		...(settings.stickyScroll !== undefined
			? { stickyScroll: { enabled: settings.stickyScroll, defaultModel: 'foldingProviderModel' } }
			: {}),
		...(settings.indentationGuides !== undefined || settings.bracketPairGuides !== undefined
			? {
				guides: {
					indentation: settings.indentationGuides ?? true,
					bracketPairs: settings.bracketPairGuides ?? false
				}
			}
			: {}),
		...(settings.cursorStyle !== undefined ? { cursorStyle: settings.cursorStyle } : {}),
		...(settings.cursorBlinking !== undefined ? { cursorBlinking: settings.cursorBlinking } : {}),
		...(settings.smoothScrolling !== undefined ? { smoothScrolling: settings.smoothScrolling } : {}),
		...(settings.renderWhitespace !== undefined ? { renderWhitespace: settings.renderWhitespace } : {})
	});
}

function mountToolbar(): void {
	editorToolbar = new EditorToolbar({
		onCollapseAll: foldAll,
		onExpandAll: unfoldAll,
		onToggleSidebar: function () {
			applySidebarVisibility(!getSidebarState().hidden);
		}
	});
	editorToolbar.mount();
	editorToolbar.setSidebarHidden(getSidebarState().hidden);
}

function mountDetails(): void {
	detailsBody = document.getElementById('sb-details-body');
	detailsStatus = document.getElementById('details-status');
	setDetailsEditorHost({
		getRow: function (id) {
			return rowById.get(id);
		},
		getSelectedId: function () {
			return selectedId;
		},
		isDetailsTab: function () {
			return getSidebarState().tab === 'details';
		},
		showSidebar: function () {
			applySidebarVisibility(false);
		},
		showTab: showSidebarTab,
		showSection: showSidebarSection,
		renderedItem: function () {
			return undefined;
		},
		selectItem: function (item) {
			const id = item && item.dataset ? item.dataset.nodeId : undefined;
			if (typeof id === 'string') {
				setSelection(id, true);
			}
		},
		setSelection: function (id) {
			setSelection(id);
		},
		postSelect: function (id) {
			postToHost({ type: 'select', nodeId: id });
		},
		focusRow: function (id) {
			if (!rowById.has(id)) {
				return false;
			}
			revealRow(id, true);
			return true;
		},
		updateInspector,
		commitEdit: function (message) {
			postToHost(message);
		},
		focusAdjacentParameter
	});
}

export async function mountEditor(): Promise<void> {
	resetVsCodeApi();
	resetDetailsEditorState();
	reportError = installConsoleErrors(window, console, 'ECUC editor').report;
	const container = document.getElementById('tree');
	if (container === null) {
		return;
	}
	container.textContent = '';
	container.className = 'monaco-ecuc-host';
	container.removeAttribute('role');
	container.setAttribute('aria-label', 'ECUC values');

	await ensureMonacoEnvironment();
	defineEcucTheme();
	model = monaco.editor.createModel('', 'arxml-ecuc');
	setModelFolding(model, documentModel.foldingRanges);
	editor = createEcucEditor(container, model);
	editor.onDidChangeModelContent(handleEdit);
	editor.onDidChangeCursorPosition(function (event) {
		const id = rowIdAtLine(event.position.lineNumber);
		if (id !== undefined && id !== selectedId) {
			setSelection(id);
			postToHost({ type: 'select', nodeId: id });
		}
	});

	setSidebarState(readPageState<SidebarUiState>());
	setSidebarPersistence(function () {
		writePageState(getSidebarState());
	});
	mountSidebarShell();
	mountToolbar();
	mountDetails();
	mountConditionsPanel();
	setConditionRows([]);
	setConditionsCallback(function (entries) {
		postToHost({ type: 'conditions', entries });
	});
	setConditionsErrorReporter(reportError);

	searchBar = mountSearchBar(
		'',
		function () {
			return searchQuery;
		},
		function () {
			return searchMatches.length > 0;
		},
		resetSearchResults,
		startSearch,
		cycleSearch,
		renderSearchUi,
		function () {},
		false,
		function () {
			editor?.focus();
		},
		{
			onOptions: function (options) {
				searchOptions = options;
				if (searchQuery.trim() !== '') {
					startSearch(searchQuery);
				}
			},
			onReplace: function (text, all) {
				requestReplace(text, all);
			}
		}
	);

	installShortcuts();
	registerEditorActions();
	handleThemeChanges();
	mounted = true;
	for (const message of pendingMessages) {
		handleMessage(message);
	}
	pendingMessages.length = 0;
	postToHost({ type: 'ready' });
}

function handleThemeChanges(): void {
	const observer = new MutationObserver(function () {
		defineEcucTheme();
		monaco.editor.setTheme('arxml-ecuc-theme');
	});
	observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

export { handleMessage };

if (typeof document !== 'undefined' && document.getElementById('tree')) {
	void mountEditor();
}
