/**
 * Synthetic ECUC document builder.
 *
 * The Monaco editor is a text editor, but the ECUC surface is a row document.
 * This module is the single adapter between the two: it serializes the existing
 * `EcucRow` display model into one text line per display row and keeps the line
 * map the editor needs for selection, folding, search and field edits.
 */
import type { EcucRow } from '../../core/ecuc/renderRows';
import type { EditorDocumentHeader } from '../../webviewProtocol';
import type { DiffCell, DiffDocument, DiffRow } from '../../core/diff/diffModel';
import { flattenRows, type FlatRow } from '../render/treeQuery';

export type SyntheticLineKind =
	| 'header'
	| 'blank'
	| 'module-gap'
	| 'annotation'
	| 'brace'
	| 'module'
	| 'container'
	| 'parameter'
	| 'reference'
	| 'diff';

export type EditableField = 'value' | 'shortName' | 'definitionRef';

export interface FieldSpan {
	field: EditableField;
	nodeId: string;
	/** 1-based inclusive column. */
	startColumn: number;
	/** 1-based exclusive column. */
	endColumn: number;
	text: string;
}

/** One rendered field the Rust search engine reports offsets into. */
export interface SearchSpan {
	field: 'label' | 'value' | 'meta';
	/** Index into the row's meta parts, for `meta` spans. */
	part?: number;
	/** 1-based inclusive column. */
	startColumn: number;
	/** 1-based exclusive column. */
	endColumn: number;
}

export interface SyntheticLine {
	/** 1-based model line. */
	line: number;
	rowId?: string;
	kind: SyntheticLineKind;
	/** The exact text of the line, without the line break. */
	text: string;
	fieldSpans: FieldSpan[];
	searchSpans: SearchSpan[];
}

export interface FoldingRange {
	startLine: number;
	endLine: number;
}

export interface SyntheticDocument {
	text: string;
	lines: SyntheticLine[];
	/** Node row id -> 1-based model line. Comments/braces are not node rows. */
	rowLine: Map<string, number>;
	foldingRanges: FoldingRange[];
}

/**
 * The per-side documents the diff page feeds to Monaco's diff editor. Each side
 * holds only its own rows, so the built-in diff sees the real line counts.
 */
export interface DiffSyntheticDocuments {
	left: SyntheticDocument;
	right: SyntheticDocument;
	/** Model line -> merged diff row key, per side. */
	leftLineKeys: (string | undefined)[];
	rightLineKeys: (string | undefined)[];
}

interface LineBuilder {
	line: number;
	parts: string[];
	length: number;
	spans: FieldSpan[];
	searchSpans: SearchSpan[];
	lineKind: SyntheticLineKind;
	rowId?: string;
}

function indent(level: number): string {
	return '    '.repeat(Math.max(0, level - 1));
}

/** A synthetic row is one model line; show embedded newlines as a literal `\n`. */
export function escapeNewlines(text: string): string {
	return text.replace(/\r\n|\r|\n/g, '\\n');
}

function startLine(kind: SyntheticLineKind, rowId?: string): LineBuilder {
	return { line: 0, parts: [], length: 0, spans: [], searchSpans: [], lineKind: kind, rowId };
}

function append(builder: LineBuilder, text: string): void {
	builder.parts.push(text);
	builder.length += text.length;
}

/** Append one rendered field and remember where the engine's offsets land. */
function appendSearch(
	builder: LineBuilder,
	text: string,
	field: SearchSpan['field'],
	part?: number
): void {
	const start = builder.length + 1;
	append(builder, text);
	builder.searchSpans.push({
		field,
		...(part !== undefined ? { part } : {}),
		startColumn: start,
		endColumn: builder.length + 1
	});
}

function appendField(
	builder: LineBuilder,
	text: string,
	field: EditableField,
	nodeId: string
): void {
	const start = builder.length + 1;
	append(builder, text);
	const end = builder.length + 1;
	builder.spans.push({ field, nodeId, startColumn: start, endColumn: end, text });
}

function metaParts(row: EcucRow): string[] {
	return row.meta.filter((part) => part.cls !== 'annotation').map((part) => part.text);
}

/** The value text shown and edited in the synthetic line. */
function displayValue(row: EcucRow): string | undefined {
	if (row.kind === 'parameter') {
		return shownOrFallback(row.shownValue, row.value);
	}
	if (row.kind === 'reference') {
		return shownOrFallback(row.shownValue, row.target);
	}
	return undefined;
}

function shownOrFallback(shown: string | undefined, fallback: string | undefined): string | undefined {
	return shown !== undefined ? shown : fallback;
}

/** True when a parameter renders its raw value inside syntax quotes. */
function quotedParameterValue(row: EcucRow): boolean {
	if (row.kind !== 'parameter') {
		return false;
	}
	if (row.valueKind !== undefined) {
		return row.valueKind === 'textual';
	}
	// A hand-built row may omit the kind; the quoted display is then the only hint.
	return hasQuotedDisplay(firstText(row.shownValue, row.value));
}

function firstText(shown: string | undefined, value: string | undefined): string {
	return shown ?? value ?? '';
}

function hasQuotedDisplay(shown: string): boolean {
	if (shown.length < 2) {
		return false;
	}
	return shown.startsWith('"') && shown.endsWith('"');
}

/** The complete synthetic line fragment a raw field value renders as. */
export function displayForRaw(row: EcucRow, field: string, raw: string): string {
	const text = spanTextForRaw(row, field, raw);
	return field === 'value' && quotedParameterValue(row) ? `"${text}"` : text;
}

/** The text the field span holds: the rendered fragment without its syntax quotes. */
export function spanTextForRaw(row: EcucRow, field: string, raw: string): string {
	if (field === 'value') {
		return quotedParameterValue(row) ? escapeNewlines(raw) : raw;
	}
	return field === 'shortName' ? escapeNewlines(raw) : raw;
}

function buildNodeLine(row: EcucRow): LineBuilder {
	const builder = startLine(row.kind, row.id);
	append(builder, indent(row.level));
	if (row.kind === 'module') {
		append(builder, 'module ');
	}
	appendSearch(builder, row.label, 'label');
	appendNodeValue(builder, row);
	appendMetaParts(builder, row);
	appendEmptyContainer(builder, row);
	return builder;
}

function appendNodeValue(builder: LineBuilder, row: EcucRow): void {
	const value = displayValue(row);
	if (!isShownValue(row, value)) {
		return;
	}
	const shown = escapeNewlines(value);
	append(builder, ' = ');
	appendValueSpan(builder, row, shown);
	appendSearchSpan(builder, shown);
}

function isShownValue(row: EcucRow, value: string | undefined): value is string {
	if (value === undefined) {
		return false;
	}
	return row.kind === 'parameter' || row.kind === 'reference';
}

function appendValueSpan(builder: LineBuilder, row: EcucRow, shown: string): void {
	const raw = row.value;
	if (raw !== undefined && quotedParameterValue(row)) {
		// Quotes are syntax, not part of the editable value span. Keeping them
		// outside the span stops a direct edit from multiplying or deleting them.
		append(builder, '"');
		appendField(builder, escapeNewlines(raw), 'value', row.id);
		append(builder, '"');
		return;
	}
	if (row.kind === 'parameter') {
		appendField(builder, shown, 'value', row.id);
		return;
	}
	append(builder, shown);
}

function appendMetaParts(builder: LineBuilder, row: EcucRow): void {
	for (let index = 0; index < row.meta.length; index += 1) {
		appendMetaPart(builder, row, index);
	}
}

function appendMetaPart(builder: LineBuilder, row: EcucRow, index: number): void {
	const part = row.meta[index];
	if (part.cls === 'annotation') {
		return;
	}
	append(builder, ' ');
	const shortName = row.shortName;
	if (showsShortNameSpan(row, part, shortName)) {
		appendShortNameSpan(builder, row.id, shortName, part.text, index);
		return;
	}
	appendMetaSearchPart(builder, part.text, index);
}

function showsShortNameSpan(
	row: EcucRow,
	part: EcucRow['meta'][number],
	shortName: string | undefined
): shortName is string {
	if (part.cls !== 'short') {
		return false;
	}
	if (row.kind !== 'container') {
		return false;
	}
	return shortName !== undefined;
}

function appendShortNameSpan(
	builder: LineBuilder,
	nodeId: string,
	shortName: string,
	text: string,
	index: number
): void {
	// `shortPart` renders `"name"`; the editable span is the name inside.
	const displayed = escapeNewlines(text);
	if (!hasQuotedDisplay(displayed)) {
		appendMetaSearchPart(builder, text, index);
		return;
	}
	const searchStart = builder.length + 1;
	append(builder, '"');
	appendField(builder, escapeNewlines(shortName), 'shortName', nodeId);
	append(builder, '"');
	builder.searchSpans.push({
		field: 'meta',
		part: index,
		startColumn: searchStart,
		endColumn: builder.length + 1
	});
}

function appendMetaSearchPart(builder: LineBuilder, text: string, index: number): void {
	const displayed = escapeNewlines(text);
	append(builder, displayed);
	appendSearchSpan(builder, displayed, 'meta', index);
}

function appendEmptyContainer(builder: LineBuilder, row: EcucRow): void {
	if (row.kind === 'container' && row.empty) {
		append(builder, ' { }');
	}
}

/** Record the span of text already appended immediately before this call. */
function appendSearchSpan(
	builder: LineBuilder,
	text: string,
	field: SearchSpan['field'] = 'value',
	part?: number
): void {
	builder.searchSpans.push({
		field,
		...(part !== undefined ? { part } : {}),
		startColumn: builder.length - text.length + 1,
		endColumn: builder.length + 1
	});
}

function buildCommentLine(text: string, level: number, rowId: string): LineBuilder {
	const builder = startLine('annotation', rowId);
	append(builder, indent(level));
	append(builder, `/* ${escapeNewlines(text)} */`);
	return builder;
}

function buildBraceLine(open: boolean, level: number, rowId: string): LineBuilder {
	const builder = startLine('brace', rowId);
	append(builder, indent(level));
	append(builder, open ? '{' : '}');
	return builder;
}

function headerLines(header: EditorDocumentHeader | undefined): LineBuilder[] {
	const out: LineBuilder[] = [];
	if (header === undefined) {
		return out;
	}
	appendSchemaLine(out, header.schema);
	appendPackageLines(out, header.packages);
	if (out.length > 0) {
		out.push(startLine('blank'));
	}
	return out;
}

function appendSchemaLine(out: LineBuilder[], schema: string | undefined): void {
	if (schema === undefined || schema === '') {
		return;
	}
	const line = startLine('header');
	append(line, `schema ${schema}`);
	out.push(line);
}

function appendPackageLines(out: LineBuilder[], packages: readonly string[]): void {
	for (const pkg of packages) {
		const line = startLine('header');
		append(line, `package ${pkg}`);
		out.push(line);
	}
}

/** Build the complete synthetic text and its line map. */
export function buildSyntheticDocument(
	rows: readonly EcucRow[],
	header?: EditorDocumentHeader
): SyntheticDocument {
	const builders = headerLines(header);
	const flat = flattenRows(rows, { braces: true, moduleGaps: true });
	const state: DocumentBuildState = {
		rows,
		builders,
		openBraceLines: new Map<string, number>(),
		rowLine: new Map<string, number>(),
		folding: []
	};

	for (const item of flat) {
		appendFlatItem(state, item);
	}

	builders.forEach((builder, index) => {
		builder.line = index + 1;
	});

	const text = builders
		.map((builder) => builder.parts.join(''))
		.join('\n');
	state.folding.sort((left, right) => left.startLine - right.startLine);
	const lines: SyntheticLine[] = builders.map(toSyntheticLine);

	return { text, lines, rowLine: state.rowLine, foldingRanges: state.folding };
}

interface DocumentBuildState {
	rows: readonly EcucRow[];
	builders: LineBuilder[];
	openBraceLines: Map<string, number>;
	rowLine: Map<string, number>;
	folding: FoldingRange[];
}

function appendFlatItem(state: DocumentBuildState, item: FlatRow): void {
	if (item.type === 'module-gap') {
		state.builders.push(startLine('module-gap'));
		return;
	}
	if (item.type === 'comment') {
		appendCommentRow(state, item);
		return;
	}
	if (item.type === 'node') {
		appendNodeRow(state, item);
		return;
	}
	appendBraceRow(state, item);
}

function appendCommentRow(state: DocumentBuildState, item: Extract<FlatRow, { type: 'comment' }>): void {
	state.builders.push(buildCommentLine(item.text, item.level, state.rows[item.rowIndex].id));
}

function appendNodeRow(state: DocumentBuildState, item: Extract<FlatRow, { type: 'node' }>): void {
	const row = state.rows[item.rowIndex];
	state.builders.push(buildNodeLine(row));
	const line = state.builders.length;
	state.rowLine.set(row.id, line);
	if (row.hasChildren && !row.empty) {
		state.openBraceLines.set(row.id, line);
	}
}

function appendBraceRow(
	state: DocumentBuildState,
	item: Extract<FlatRow, { type: 'brace-open' | 'brace-close' }>
): void {
	const row = state.rows[item.rowIndex];
	state.builders.push(buildBraceLine(item.type === 'brace-open', item.level, row.id));
	const line = state.builders.length;
	if (item.type === 'brace-open') {
		// The range starts on the owning node line, which is where Monaco's
		// folding and sticky-scroll headings belong.
		return;
	}
	closeBraceRange(state, row.id, line);
}

function closeBraceRange(state: DocumentBuildState, rowId: string, line: number): void {
	const start = state.openBraceLines.get(rowId);
	if (start === undefined) {
		return;
	}
	state.folding.push({ startLine: start, endLine: line });
	state.openBraceLines.delete(rowId);
}

function toSyntheticLine(builder: LineBuilder): SyntheticLine {
	return {
		line: builder.line,
		...(builder.rowId !== undefined ? { rowId: builder.rowId } : {}),
		kind: builder.lineKind,
		text: builder.parts.join(''),
		fieldSpans: builder.spans,
		searchSpans: builder.searchSpans
	};
}

/** Build one node line and its spans; used for a one-row host patch. */
export function syntheticRowLine(row: EcucRow): {
	text: string;
	fieldSpans: FieldSpan[];
	searchSpans: SearchSpan[];
} {
	const builder = buildNodeLine(row);
	return { text: builder.parts.join(''), fieldSpans: builder.spans, searchSpans: builder.searchSpans };
}

/** Map one Rust match's field offsets to 1-based columns on a synthetic line. */
export function searchRangeOnLine(
	line: SyntheticLine,
	match: { field: SearchSpan['field']; part?: number; start: number; end: number }
): { startColumn: number; endColumn: number } | undefined {
	const span = line.searchSpans.find(
		(candidate) => candidate.field === match.field && candidate.part === match.part
	);
	if (span === undefined) {
		return undefined;
	}
	const startColumn = span.startColumn + match.start;
	const endColumn = span.startColumn + match.end;
	if (endColumn <= startColumn || endColumn > span.endColumn) {
		return undefined;
	}
	return { startColumn, endColumn };
}

interface DiffLineText {
	text: string;
	searchSpans: SearchSpan[];
}

function cellLine(cell: DiffCell | undefined, row: DiffRow, hasChildren: boolean): DiffLineText {
	if (cell === undefined) {
		return { text: '', searchSpans: [] };
	}
	const line: DiffLineText = { text: cellPrefix(cell, row), searchSpans: [] };
	appendCellLabel(line, cell);
	appendCellValue(line, cell);
	appendCellMeta(line, cell);
	appendEmptyCellContainer(line, cell, hasChildren);
	appendChangedDefinition(line, cell, row);
	return line;
}

function cellPrefix(cell: DiffCell, row: DiffRow): string {
	return indent(row.level) + (cell.kind === 'module' ? 'module ' : '');
}

function appendCellLabel(line: DiffLineText, cell: DiffCell): void {
	const labelStart = line.text.length + 1;
	line.text += cell.label;
	line.searchSpans.push({ field: 'label', startColumn: labelStart, endColumn: line.text.length + 1 });
}

function appendCellValue(line: DiffLineText, cell: DiffCell): void {
	const value = cellValue(cell);
	if (!showsCellValue(cell, value)) {
		return;
	}
	line.text += ' = ';
	const shown = escapeNewlines(value);
	const valueStart = line.text.length + 1;
	line.text += shown;
	line.searchSpans.push({ field: 'value', startColumn: valueStart, endColumn: line.text.length + 1 });
}

function cellValue(cell: DiffCell): string | undefined {
	if (cell.shownValue !== undefined) {
		return cell.shownValue;
	}
	return cell.kind === 'reference' ? cell.target : cell.value;
}

function showsCellValue(cell: DiffCell, value: string | undefined): value is string {
	if (value === undefined) {
		return false;
	}
	return cell.kind === 'parameter' || cell.kind === 'reference';
}

function appendCellMeta(line: DiffLineText, cell: DiffCell): void {
	for (let index = 0; index < cell.meta.length; index += 1) {
		const part = cell.meta[index];
		if (part.cls === 'annotation') {
			continue;
		}
		line.text += ' ';
		const shown = escapeNewlines(part.text);
		const metaStart = line.text.length + 1;
		line.text += shown;
		line.searchSpans.push({ field: 'meta', part: index, startColumn: metaStart, endColumn: line.text.length + 1 });
	}
}

function appendEmptyCellContainer(line: DiffLineText, cell: DiffCell, hasChildren: boolean): void {
	if (cell.kind === 'container' && !hasChildren) {
		line.text += ' { }';
	}
}

function appendChangedDefinition(line: DiffLineText, cell: DiffCell, row: DiffRow): void {
	const changedFields = new Set(row.changes.map((change) => change.field));
	if (!hasDefinitionChange(changedFields)) {
		return;
	}
	// Monaco can only render a hunk when the text differs. These two fields
	// are part of the semantic change set but are not otherwise on the row.
	line.text += ` @${cell.definitionRef}`;
	if (cell.definitionDest !== undefined) {
		line.text += ` [${cell.definitionDest}]`;
	}
}

function hasDefinitionChange(changedFields: ReadonlySet<string>): boolean {
	return changedFields.has('definition ref') || changedFields.has('definition dest');
}

function commentText(cell: DiffCell | undefined, index: number, level: number): string {
	const text = cell?.comments?.[index];
	return text === undefined ? '' : `${indent(level)}/* ${escapeNewlines(text)} */`;
}

/** Serialize each merged row into the side documents that actually own it. */
export function buildDiffSyntheticDocuments(document: DiffDocument): DiffSyntheticDocuments {
	const build: DiffBuild = {
		document,
		left: createDiffSide(),
		right: createDiffSide(),
		at: 0,
		hasModule: { left: false, right: false }
	};
	while (build.at < document.rows.length) {
		walkDiffRow(build, build.at);
	}
	build.left.folding.sort(byStartLine);
	build.right.folding.sort(byStartLine);
	return {
		left: toSyntheticDiffDocument(build.left),
		right: toSyntheticDiffDocument(build.right),
		leftLineKeys: build.left.keys,
		rightLineKeys: build.right.keys
	};
}

type DocumentSide = 'left' | 'right';

interface DiffSide {
	text: string[];
	searchSpans: SearchSpan[][];
	keys: (string | undefined)[];
	rowLine: Map<string, number>;
	folding: FoldingRange[];
}

interface DiffBuild {
	document: DiffDocument;
	left: DiffSide;
	right: DiffSide;
	at: number;
	hasModule: Record<DocumentSide, boolean>;
}

function createDiffSide(): DiffSide {
	return { text: [], searchSpans: [], keys: [], rowLine: new Map(), folding: [] };
}

function sideCell(row: DiffRow, side: DocumentSide): DiffCell | undefined {
	return side === 'left' ? row.left : row.right;
}

function emitSideLine(side: DiffSide, text: string, key?: string, spans: SearchSpan[] = []): void {
	side.text.push(text);
	side.searchSpans.push(spans);
	side.keys.push(key);
}

/**
 * True when the row has a direct child on `side`. A paired container can have a
 * child block on one side only, so the merged `hasChildren` flag is not enough:
 * the empty side must render `{ }` and no synthesized brace pair.
 */
function sideHasChildren(document: DiffDocument, index: number, side: DocumentSide): boolean {
	const row = document.rows[index];
	const end = Math.min(document.rows.length, index + 1 + Math.max(0, row.subtreeSize));
	let child = index + 1;
	while (child < end) {
		const childRow = document.rows[child];
		if (sideCell(childRow, side) !== undefined) {
			return true;
		}
		child += Math.max(0, childRow.subtreeSize) + 1;
	}
	return false;
}

function walkDiffRow(build: DiffBuild, index: number): void {
	const row = build.document.rows[index];
	build.at = index + 1;
	const leftChildren = sideHasChildren(build.document, index, 'left');
	const rightChildren = sideHasChildren(build.document, index, 'right');
	appendSideModuleGap(build, row, 'left');
	appendSideModuleGap(build, row, 'right');
	appendSideComments(build, row, 'left');
	appendSideComments(build, row, 'right');
	const leftLine = appendSideCell(build, row, 'left', leftChildren);
	const rightLine = appendSideCell(build, row, 'right', rightChildren);
	if (!row.hasChildren) {
		return;
	}
	openSideBlock(build, row, 'left', leftLine, leftChildren);
	openSideBlock(build, row, 'right', rightLine, rightChildren);
	walkDiffRows(build, row.subtreeSize);
	closeSideBlock(build, row, 'left', leftLine, leftChildren);
	closeSideBlock(build, row, 'right', rightLine, rightChildren);
}

function walkDiffRows(build: DiffBuild, count: number): void {
	const end = Math.min(build.document.rows.length, build.at + Math.max(0, count));
	while (build.at < end) {
		walkDiffRow(build, build.at);
	}
}

function appendSideModuleGap(build: DiffBuild, row: DiffRow, sideName: DocumentSide): void {
	if (row.kind !== 'module' || sideCell(row, sideName) === undefined) {
		return;
	}
	const side = build[sideName];
	if (build.hasModule[sideName]) {
		emitSideLine(side, '');
	}
	build.hasModule[sideName] = true;
}

function appendSideComments(build: DiffBuild, row: DiffRow, sideName: DocumentSide): void {
	const cell = sideCell(row, sideName);
	const count = sideCommentCount(cell);
	const side = build[sideName];
	for (let index = 0; index < count; index += 1) {
		emitSideLine(side, commentText(cell, index, row.level), row.key);
	}
}

function appendSideCell(
	build: DiffBuild,
	row: DiffRow,
	sideName: DocumentSide,
	hasChildren: boolean
): number | undefined {
	const cell = sideCell(row, sideName);
	if (cell === undefined) {
		return undefined;
	}
	const content = cellLine(cell, row, hasChildren);
	const side = build[sideName];
	const line = side.text.length + 1;
	emitSideLine(side, content.text, row.key, content.searchSpans);
	side.rowLine.set(row.key, line);
	return line;
}

function openSideBlock(
	build: DiffBuild,
	row: DiffRow,
	sideName: DocumentSide,
	nodeLine: number | undefined,
	hasChildren: boolean
): void {
	if (!hasChildren || nodeLine === undefined) {
		return;
	}
	emitSideLine(build[sideName], `${indent(row.level)}{`, row.key);
}

function closeSideBlock(
	build: DiffBuild,
	row: DiffRow,
	sideName: DocumentSide,
	nodeLine: number | undefined,
	hasChildren: boolean
): void {
	if (!hasChildren || nodeLine === undefined) {
		return;
	}
	const side = build[sideName];
	const endLine = side.text.length + 1;
	emitSideLine(side, `${indent(row.level)}}`, row.key);
	side.folding.push({ startLine: nodeLine, endLine });
}

function sideCommentCount(cell: DiffCell | undefined): number {
	if (cell === undefined) {
		return 0;
	}
	const comments = cell.comments;
	if (comments === undefined) {
		return 0;
	}
	return comments.length;
}

function byStartLine(left: FoldingRange, right: FoldingRange): number {
	return left.startLine - right.startLine;
}

function toSyntheticDiffDocument(side: DiffSide): SyntheticDocument {
	return {
		text: side.text.join('\n'),
		lines: side.text.map((text, index) => ({
			line: index + 1,
			...(side.keys[index] !== undefined ? { rowId: side.keys[index] } : {}),
			kind: 'diff',
			text,
			fieldSpans: [],
			searchSpans: side.searchSpans[index] ?? []
		})),
		rowLine: side.rowLine,
		foldingRanges: side.folding
	};
}
