/**
 * Copy latency benchmark: plan, apply, refresh and the page patch.
 *
 * A copy used to end in a full re-scan, a full `buildDiffDocument` and a
 * `setValue` on both page models. It now ends in the engine patch and a
 * line-level model edit. This records both paths for 1, 10 and 100 copied rows
 * so the next change can be judged against numbers, not a feeling.
 *
 * Test-only: nothing here runs at import time in the extension.
 */
import { buildDiffDocument } from '../../core/diff/diffModel';
import type { DiffDocument } from '../../core/diff/diffModel';
import { applyLineEdit, minimalLineEdit, type LineEdit } from '../../core/diff/minimalEdit';
import { planCopy } from '../../core/copy/planCopy';
import type { CopySpan } from '../../core/copy/copyTypes';
import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { buildNodeIndex } from '../../core/ecuc/nodeId';
import { buildRows } from '../../core/ecuc/renderRows';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { buildDiffSyntheticDocuments } from '../../webview/monaco/synthetic';
import { measureStage } from './benchmarkUtils';
import { buildEcucArxml } from './ecucLargeFixture';

/** The copy-plan budget from the previous branch; the plan must stay O(element). */
const MAX_PLAN_MS = 100;
/** The page patch must not grow with the document for a small hunk. */
const MAX_PATCH_MS = 50;
/** Parameters on the left; the right side stops short so a block can be copied. */
const PARAMETERS = 400;
const COPIED = [1, 10, 100];

function parameter(name: string, value: string): string {
	return `<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/Mod/Items/${name}</DEFINITION-REF><VALUE>${value}</VALUE></ECUC-NUMERICAL-PARAM-VALUE>`;
}

/** One module with `count` parameters; a shorter copy exists only on the left. */
function arxml(count: number): string {
	const values = Array.from({ length: count }, (_, at) =>
		parameter(`P${String(at).padStart(4, '0')}`, String(at))
	).join('');
	return `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0"><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>Mod</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/Mod</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>Items</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/Mod/Items</DEFINITION-REF><PARAMETER-VALUES>${values}</PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
}

interface Side {
	rows: ReturnType<typeof buildRows>['rows'];
	rangeOf: (id: string) => { start: number; end: number } | undefined;
}

function sideOf(text: string): Side {
	const model = scanEcucValues(text);
	const index = buildNodeIndex(model);
	return {
		rows: buildRows(model, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows,
		rangeOf: (id) => index.byId.get(id)?.range
	};
}

interface Fixture {
	left: Side;
	right: Side;
	leftText: string;
	rightText: string;
	/** The left parameters, in document order. */
	source: { start: number; end: number }[];
	/** The right parameters, in document order. */
	target: { start: number; end: number }[];
}

function fixture(): Fixture {
	const leftText = arxml(PARAMETERS);
	const rightText = arxml(PARAMETERS - 100);
	return {
		left: sideOf(leftText),
		right: sideOf(rightText),
		leftText,
		rightText,
		source: parameterRanges(leftText),
		target: parameterRanges(rightText)
	};
}

/** The parameter element offsets in a document, in order. */
function parameterRanges(text: string): { start: number; end: number }[] {
	const ranges: { start: number; end: number }[] = [];
	const open = '<ECUC-NUMERICAL-PARAM-VALUE>';
	const close = '</ECUC-NUMERICAL-PARAM-VALUE>';
	let at = text.indexOf(open);
	while (at >= 0) {
		const end = text.indexOf(close, at);
		ranges.push({ start: at, end: end + close.length });
		at = text.indexOf(open, end + close.length);
	}
	return ranges;
}

/** The whole span from the first to the last of `rows` parameters. */
function blockRange(
	ranges: readonly { start: number; end: number }[],
	from: number,
	rows: number
): { start: number; end: number } {
	return { start: ranges[from].start, end: ranges[from + rows - 1].end };
}

/** A synthetic diff document for the pair; the page rebuilds exactly this shape. */
function diffOf(left: Side, right: Side): DiffDocument {
	return buildDiffDocument(
		{ name: 'left.arxml', path: '/bench/left.arxml' },
		{ name: 'right.arxml', path: '/bench/right.arxml' },
		left.rows,
		right.rows,
		left.rangeOf,
		right.rangeOf,
		{ left: { packages: ['P'] }, right: { packages: ['P'] } },
		{ semanticMatching: true }
	);
}

/** One measured copy plan for `rows` parameters. */
function planBlock(fixture: Fixture, rows: number): { span: CopySpan; planMs: number } {
	const from = PARAMETERS - rows;
	const plan = measureStage(() =>
		planCopy({
			targetText: fixture.rightText,
			sourceText: fixture.leftText,
			source: blockRange(fixture.source, from, rows),
			anchorAfter: fixture.target[fixture.target.length - 1],
			targetIndent: '    '
		})
	);
	if (!plan.value.ok) {
		throw new Error(`copy of ${rows} rows refused: ${plan.value.reason}`);
	}
	return { span: plan.value.span, planMs: plan.elapsedMs };
}

/** The host-style text splice a copy applies. */
function spliced(text: string, span: CopySpan): string {
	return text.slice(0, span.start) + span.text + text.slice(span.end);
}

function withinBudget(name: string, value: number, budget: number, rows: number): void {
	if (value > budget) {
		throw new Error(`${name} of ${rows} rows took ${value} ms, over ${budget} ms`);
	}
}

/** The page patch: rebuild the synthetic pair, then splice the changed lines. */
function pagePatch(before: DiffDocument, after: DiffDocument): { edit?: LineEdit; elapsedMs: number } {
	const beforeDocs = buildDiffSyntheticDocuments(before);
	const afterDocs = buildDiffSyntheticDocuments(after);
	const patch = measureStage(() => {
		const edit = minimalLineEdit(beforeDocs.right.text, afterDocs.right.text);
		return edit === undefined ? beforeDocs.right.text : applyLineEdit(beforeDocs.right.text, edit);
	});
	withinBudget('page patch', patch.elapsedMs, MAX_PATCH_MS, before.rows.length);
	return {
		edit: minimalLineEdit(beforeDocs.right.text, afterDocs.right.text),
		elapsedMs: patch.elapsedMs
	};
}

/** Applies one copy and records every phase for the report. */
function measureRows(fixture: Fixture, rows: number): Record<string, unknown> {
	const { span, planMs } = planBlock(fixture, rows);
	withinBudget('copy plan', planMs, MAX_PLAN_MS, rows);
	const applied = measureStage(() => spliced(fixture.rightText, span));
	// The old path: re-scan, rebuild the rows and the whole comparison.
	const refreshed = measureStage(() => diffOf(fixture.left, sideOf(applied.value)));
	const before = diffOf(fixture.left, fixture.right);
	const patch = pagePatch(before, refreshed.value);
	const beforeDocs = buildDiffSyntheticDocuments(before);
	return {
		_type: 'copy',
		rows,
		bytes: span.text.length,
		planMs,
		applyMs: applied.elapsedMs,
		refreshMs: refreshed.elapsedMs,
		pageRebuildMs: patch.elapsedMs,
		replacedLines: patch.edit?.deleteCount ?? 0,
		addedLines: patch.edit === undefined ? 0 : patch.edit.text.split('\n').length - 1,
		totalModelLines: beforeDocs.right.text.split('\n').length
	};
}

function main(): void {
	const bench = fixture();
	for (const rows of COPIED) {
		console.log(JSON.stringify(measureRows(bench, rows)));
	}
	largeDocumentPlan();
}

/** The previous branch's guard: one plan on the ~26 MiB pair stays O(element). */
function largeDocumentPlan(): void {
	const text = buildEcucArxml('left');
	const open = text.indexOf('<ECUC-NUMERICAL-PARAM-VALUE>');
	const close = text.indexOf('</ECUC-NUMERICAL-PARAM-VALUE>', open);
	const range = { start: open, end: close + '</ECUC-NUMERICAL-PARAM-VALUE>'.length };
	const read = measureStage(() => text.length);
	const plan = measureStage(() =>
		planCopy({
			targetText: text,
			sourceText: text,
			source: range,
			target: { start: range.start, end: range.end },
			targetIndent: '          '
		})
	);
	if (!plan.value.ok) {
		throw new Error(`large copy refused: ${plan.value.reason}`);
	}
	withinBudget('large copy plan', plan.elapsedMs, MAX_PLAN_MS, 1);
	console.log(
		JSON.stringify({
			_type: 'copy',
			fixture: 'large',
			sourceMiB: Math.round(Buffer.byteLength(text) / 1048576),
			elementBytes: read.value,
			planMs: plan.elapsedMs,
			writtenBytes: plan.value.span.text.length
		})
	);
}

main();
