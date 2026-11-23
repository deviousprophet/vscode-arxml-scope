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
import { flattenRows } from '../render/treeQuery';

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

/** The aligned pair the diff page feeds to Monaco's diff editor. */
export interface AlignedSyntheticDocuments {
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
		return row.shownValue !== undefined ? row.shownValue : row.value;
	}
	if (row.kind === 'reference') {
		return row.shownValue !== undefined ? row.shownValue : row.target;
	}
	return undefined;
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
	const shown = row.shownValue ?? row.value ?? '';
	return shown.length >= 2 && shown.startsWith('"') && shown.endsWith('"');
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

	const value = displayValue(row);
	if (value !== undefined && (row.kind === 'parameter' || row.kind === 'reference')) {
		const shown = escapeNewlines(value);
		append(builder, ' = ');
		if (quotedParameterValue(row) && row.value !== undefined) {
			// Quotes are syntax, not part of the editable value span. Keeping them
			// outside the span stops a direct edit from multiplying or deleting them.
			append(builder, '"');
			appendField(builder, escapeNewlines(row.value), 'value', row.id);
			append(builder, '"');
		} else if (row.kind === 'parameter') {
			appendField(builder, shown, 'value', row.id);
		} else {
			append(builder, shown);
		}
		appendSearchSpan(builder, shown);
	}

	for (let index = 0; index < row.meta.length; index += 1) {
		const part = row.meta[index];
		if (part.cls === 'annotation') {
			continue;
		}
		append(builder, ' ');
		if (part.cls === 'short' && row.kind === 'container' && row.shortName !== undefined) {
			// `shortPart` renders `"name"`; the editable span is the name inside.
			const displayed = escapeNewlines(part.text);
			const quoted = displayed.startsWith('"') && displayed.endsWith('"');
			if (quoted) {
				const searchStart = builder.length + 1;
				append(builder, '"');
				appendField(builder, escapeNewlines(row.shortName), 'shortName', row.id);
				append(builder, '"');
				builder.searchSpans.push({
					field: 'meta',
					part: index,
					startColumn: searchStart,
					endColumn: builder.length + 1
				});
			} else {
				append(builder, displayed);
				appendSearchSpan(builder, displayed, 'meta', index);
			}
		} else {
			const displayed = escapeNewlines(part.text);
			append(builder, displayed);
			appendSearchSpan(builder, displayed, 'meta', index);
		}
	}

	if (row.kind === 'container' && row.empty) {
		append(builder, ' { }');
	}
	return builder;
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
	if (header.schema !== undefined && header.schema !== '') {
		const line = startLine('header');
		append(line, `schema ${header.schema}`);
		out.push(line);
	}
	for (const pkg of header.packages) {
		const line = startLine('header');
		append(line, `package ${pkg}`);
		out.push(line);
	}
	if (out.length > 0) {
		out.push(startLine('blank'));
	}
	return out;
}

/** Build the complete synthetic text and its line map. */
export function buildSyntheticDocument(
	rows: readonly EcucRow[],
	header?: EditorDocumentHeader
): SyntheticDocument {
	const builders = headerLines(header);
	const flat = flattenRows(rows, { braces: true, moduleGaps: true });
	const openBraceLines = new Map<string, number>();
	const rowLine = new Map<string, number>();
	const folding: FoldingRange[] = [];

	for (const item of flat) {
		if (item.type === 'module-gap') {
			builders.push(startLine('module-gap'));
			continue;
		}
		if (item.type === 'comment') {
			builders.push(buildCommentLine(item.text, item.level, rows[item.rowIndex].id));
			continue;
		}
		if (item.type === 'node') {
			const row = rows[item.rowIndex];
			const builder = buildNodeLine(row);
			builders.push(builder);
			const line = builders.length;
			rowLine.set(row.id, line);
			if (row.hasChildren && !row.empty) {
				openBraceLines.set(row.id, line);
			}
			continue;
		}
		// brace-open / brace-close
		const row = rows[item.rowIndex];
		const builder = buildBraceLine(item.type === 'brace-open', item.level, row.id);
		builders.push(builder);
		const line = builders.length;
		if (item.type === 'brace-open') {
			// The range starts on the owning node line, which is where Monaco's
			// folding and sticky-scroll headings belong.
		} else {
			const start = openBraceLines.get(row.id);
			if (start !== undefined) {
				folding.push({ startLine: start, endLine: line });
				openBraceLines.delete(row.id);
			}
		}
	}

	builders.forEach((builder, index) => {
		builder.line = index + 1;
	});

	const text = builders
		.map((builder) => builder.parts.join(''))
		.join('\n');
	folding.sort((left, right) => left.startLine - right.startLine);
	const lines: SyntheticLine[] = builders.map((builder) => ({
		line: builder.line,
		...(builder.rowId !== undefined ? { rowId: builder.rowId } : {}),
		kind: builder.lineKind,
		text: builder.parts.join(''),
		fieldSpans: builder.spans,
		searchSpans: builder.searchSpans
	}));

	return { text, lines, rowLine, foldingRanges: folding };
}

/** Find the synthetic line for one row id. */
export function lineForRow(document: SyntheticDocument, rowId: string): number | undefined {
	return document.rowLine.get(rowId);
}

/** Find the row id for one model line, if it is a node line. */
export function rowForLine(document: SyntheticDocument, line: number): string | undefined {
	return document.lines[line - 1]?.rowId;
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

/** All editable spans on a line. */
export function fieldSpansForLine(document: SyntheticDocument, line: number): readonly FieldSpan[] {
	return document.lines[line - 1]?.fieldSpans ?? [];
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

function cellLine(cell: DiffCell | undefined, row: DiffRow): { text: string; searchSpans: SearchSpan[] } {
	if (cell === undefined) {
		return { text: '', searchSpans: [] };
	}
	const pad = indent(row.level);
	let text = pad + (cell.kind === 'module' ? 'module ' : '');
	const searchSpans: SearchSpan[] = [];
	const labelStart = text.length + 1;
	text += cell.label;
	searchSpans.push({ field: 'label', startColumn: labelStart, endColumn: text.length + 1 });
	const value = cell.shownValue !== undefined ? cell.shownValue : cell.kind === 'reference' ? cell.target : cell.value;
	if ((cell.kind === 'parameter' || cell.kind === 'reference') && value !== undefined) {
		text += ' = ';
		const shown = escapeNewlines(value);
		const valueStart = text.length + 1;
		text += shown;
		searchSpans.push({ field: 'value', startColumn: valueStart, endColumn: text.length + 1 });
	}
	for (let index = 0; index < cell.meta.length; index += 1) {
		const part = cell.meta[index];
		if (part.cls === 'annotation') {
			continue;
		}
		text += ' ';
		const shown = escapeNewlines(part.text);
		const metaStart = text.length + 1;
		text += shown;
		searchSpans.push({ field: 'meta', part: index, startColumn: metaStart, endColumn: text.length + 1 });
	}
	if (cell.kind === 'container' && !row.hasChildren) {
		text += ' { }';
	}
	const changedFields = new Set(row.changes.map((change) => change.field));
	if (changedFields.has('definition ref') || changedFields.has('definition dest')) {
		// Monaco can only render a hunk when the text differs. These two fields
		// are part of the semantic change set but are not otherwise on the row.
		text += ` @${cell.definitionRef}`;
		if (cell.definitionDest !== undefined) {
			text += ` [${cell.definitionDest}]`;
		}
	}
	return { text, searchSpans };
}

function commentText(cell: DiffCell | undefined, index: number, level: number): string {
	const text = cell?.comments?.[index];
	return text === undefined ? '' : `${indent(level)}/* ${escapeNewlines(text)} */`;
}

/** Serialize the merged diff rows into two line-aligned synthetic documents. */
export function buildAlignedSyntheticDocuments(document: DiffDocument): AlignedSyntheticDocuments {
	const leftText: string[] = [];
	const rightText: string[] = [];
	const leftSearchSpans: SearchSpan[][] = [];
	const rightSearchSpans: SearchSpan[][] = [];
	const leftKeys: (string | undefined)[] = [];
	const rightKeys: (string | undefined)[] = [];
	const leftRowLine = new Map<string, number>();
	const rightRowLine = new Map<string, number>();
	const leftFolding: FoldingRange[] = [];
	const rightFolding: FoldingRange[] = [];

	const emit = (
		left: string,
		right: string,
		key?: string,
		leftSpans: SearchSpan[] = [],
		rightSpans: SearchSpan[] = []
	): void => {
		leftText.push(left);
		rightText.push(right);
		leftSearchSpans.push(leftSpans);
		rightSearchSpans.push(rightSpans);
		leftKeys.push(key);
		rightKeys.push(key);
	};

	let at = 0;
	let hasModule = false;

	const walk = (): void => {
		const row = document.rows[at];
		at += 1;
		if (row.kind === 'module') {
			if (hasModule) {
				emit('', '', undefined);
			}
			hasModule = true;
		}

		const leftComments = row.left?.comments?.length ?? 0;
		const rightComments = row.right?.comments?.length ?? 0;
		const commentCount = Math.max(leftComments, rightComments);
		for (let index = 0; index < commentCount; index += 1) {
			emit(commentText(row.left, index, row.level), commentText(row.right, index, row.level), row.key);
		}

		const leftLine = leftText.length + 1;
		const rightLine = rightText.length + 1;
		const leftCell = cellLine(row.left, row);
		const rightCell = cellLine(row.right, row);
		emit(leftCell.text, rightCell.text, row.key, leftCell.searchSpans, rightCell.searchSpans);
		leftRowLine.set(row.key, leftLine);
		rightRowLine.set(row.key, rightLine);

		if (!row.hasChildren) {
			return;
		}

		const leftStart = leftLine;
		const rightStart = rightLine;
		emit(`${indent(row.level)}{`, `${indent(row.level)}{`, row.key);
		const end = at + row.subtreeSize;
		while (at < end) {
			walk();
		}
		const leftEnd = leftText.length + 1;
		const rightEnd = rightText.length + 1;
		emit(`${indent(row.level)}}`, `${indent(row.level)}}`, row.key);
		if (row.left !== undefined) {
			leftFolding.push({ startLine: leftStart, endLine: leftEnd });
		}
		if (row.right !== undefined) {
			rightFolding.push({ startLine: rightStart, endLine: rightEnd });
		}
	};

	while (at < document.rows.length) {
		walk();
	}

	leftFolding.sort((a, b) => a.startLine - b.startLine);
	rightFolding.sort((a, b) => a.startLine - b.startLine);

	const toDocument = (
		lines: string[],
		keys: (string | undefined)[],
		rowLine: Map<string, number>,
		foldingRanges: FoldingRange[],
		spans: SearchSpan[][]
	): SyntheticDocument => ({
		text: lines.join('\n'),
		lines: lines.map((text, index) => ({
			line: index + 1,
			...(keys[index] !== undefined ? { rowId: keys[index] } : {}),
			kind: 'diff',
			text,
			fieldSpans: [],
			searchSpans: spans[index] ?? []
		})),
		rowLine,
		foldingRanges
	});

	return {
		left: toDocument(leftText, leftKeys, leftRowLine, leftFolding, leftSearchSpans),
		right: toDocument(rightText, rightKeys, rightRowLine, rightFolding, rightSearchSpans),
		leftLineKeys: leftKeys,
		rightLineKeys: rightKeys
	};
}
