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

export interface SyntheticLine {
	/** 1-based model line. */
	line: number;
	rowId?: string;
	kind: SyntheticLineKind;
	/** The exact text of the line, without the line break. */
	text: string;
	fieldSpans: FieldSpan[];
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
	lineKind: SyntheticLineKind;
	rowId?: string;
}

function indent(level: number): string {
	return '    '.repeat(Math.max(0, level - 1));
}

function startLine(kind: SyntheticLineKind, rowId?: string): LineBuilder {
	return { line: 0, parts: [], length: 0, spans: [], lineKind: kind, rowId };
}

function append(builder: LineBuilder, text: string): void {
	builder.parts.push(text);
	builder.length += text.length;
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

/** The raw value the host edit expects when the display added quotes. */
export function rawFieldText(row: EcucRow, display: string): string {
	if (row.kind === 'parameter' && row.value !== undefined && display !== row.value) {
		if (display.length >= 2 && display.startsWith('"') && display.endsWith('"')) {
			return display.slice(1, -1);
		}
	}
	return display;
}

function buildNodeLine(row: EcucRow): LineBuilder {
	const builder = startLine(row.kind, row.id);
	append(builder, indent(row.level));
	if (row.kind === 'module') {
		append(builder, 'module ');
	}
	append(builder, row.label);

	const value = displayValue(row);
	if (value !== undefined && (row.kind === 'parameter' || row.kind === 'reference')) {
		append(builder, ' = ');
		if (row.kind === 'parameter') {
			appendField(builder, value, 'value', row.id);
		} else {
			append(builder, value);
		}
	}

	for (const part of row.meta) {
		if (part.cls === 'annotation') {
			continue;
		}
		append(builder, ' ');
		if (part.cls === 'short' && row.kind === 'container' && row.shortName !== undefined) {
			// `shortPart` renders `"name"`; the editable span is the name inside.
			const displayed = part.text;
			const quoted = displayed.startsWith('"') && displayed.endsWith('"');
			if (quoted) {
				append(builder, '"');
				appendField(builder, row.shortName, 'shortName', row.id);
				append(builder, '"');
			} else {
				append(builder, displayed);
			}
		} else {
			append(builder, part.text);
		}
	}

	if (row.kind === 'container' && row.empty) {
		append(builder, ' { }');
	}
	if (row.kind === 'container' && row.definitionRef !== '') {
		// The full definition ref is normally only in Details; show it as a
		// compact suffix so the settled direct-edit rule has a real span.
		append(builder, ' @');
		appendField(builder, row.definitionRef, 'definitionRef', row.id);
	}
	return builder;
}

function buildCommentLine(text: string, level: number, rowId: string): LineBuilder {
	const builder = startLine('annotation', rowId);
	append(builder, indent(level));
	append(builder, `/* ${text} */`);
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
		fieldSpans: builder.spans
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
export function syntheticRowLine(row: EcucRow): { text: string; fieldSpans: FieldSpan[] } {
	const builder = buildNodeLine(row);
	return { text: builder.parts.join(''), fieldSpans: builder.spans };
}

/** All editable spans on a line. */
export function fieldSpansForLine(document: SyntheticDocument, line: number): readonly FieldSpan[] {
	return document.lines[line - 1]?.fieldSpans ?? [];
}

function cellLine(cell: DiffCell | undefined, row: DiffRow): string {
	if (cell === undefined) {
		return '';
	}
	const pad = indent(row.level);
	let text = pad + (cell.kind === 'module' ? 'module ' : '') + cell.label;
	const value = cell.shownValue !== undefined ? cell.shownValue : cell.kind === 'reference' ? cell.target : cell.value;
	if ((cell.kind === 'parameter' || cell.kind === 'reference') && value !== undefined) {
		text += ` = ${value}`;
	}
	for (const part of cell.meta) {
		if (part.cls !== 'annotation') {
			text += ` ${part.text}`;
		}
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
	return text;
}

function commentText(cell: DiffCell | undefined, index: number, level: number): string {
	const text = cell?.comments?.[index];
	return text === undefined ? '' : `${indent(level)}/* ${text} */`;
}

/** Serialize the merged diff rows into two line-aligned synthetic documents. */
export function buildAlignedSyntheticDocuments(document: DiffDocument): AlignedSyntheticDocuments {
	const leftText: string[] = [];
	const rightText: string[] = [];
	const leftKeys: (string | undefined)[] = [];
	const rightKeys: (string | undefined)[] = [];
	const leftRowLine = new Map<string, number>();
	const rightRowLine = new Map<string, number>();
	const leftFolding: FoldingRange[] = [];
	const rightFolding: FoldingRange[] = [];

	const emit = (left: string, right: string, key?: string): void => {
		leftText.push(left);
		rightText.push(right);
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
		emit(cellLine(row.left, row), cellLine(row.right, row), row.key);
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
		foldingRanges: FoldingRange[]
	): SyntheticDocument => ({
		text: lines.join('\n'),
		lines: lines.map((text, index) => ({
			line: index + 1,
			...(keys[index] !== undefined ? { rowId: keys[index] } : {}),
			kind: 'diff',
			text,
			fieldSpans: []
		})),
		rowLine,
		foldingRanges
	});

	return {
		left: toDocument(leftText, leftKeys, leftRowLine, leftFolding),
		right: toDocument(rightText, rightKeys, rightRowLine, rightFolding),
		leftLineKeys: leftKeys,
		rightLineKeys: rightKeys
	};
}
