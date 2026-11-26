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
import { applyLineEdit, minimalLineEdit } from '../../core/diff/minimalEdit';
import { planCopy } from '../../core/copy/planCopy';
import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { buildNodeIndex } from '../../core/ecuc/nodeId';
import { buildRows } from '../../core/ecuc/renderRows';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { buildDiffSyntheticDocuments } from '../../webview/monaco/synthetic';
import { measureStage } from './benchmarkUtils';

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
	text: string;
	rows: ReturnType<typeof buildRows>['rows'];
	rangeOf: (id: string) => { start: number; end: number } | undefined;
}

function sideOf(text: string): Side {
	const model = scanEcucValues(text);
	const index = buildNodeIndex(model);
	return {
		text,
		rows: buildRows(model, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows,
		rangeOf: (id) => index.byId.get(id)?.range
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
function blockRange(ranges: readonly { start: number; end: number }[], from: number, rows: number) {
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

function main(): void {
	const leftText = arxml(PARAMETERS);
	const rightText = arxml(PARAMETERS - 100);
	const left = sideOf(leftText);
	const right = sideOf(rightText);
	const target = parameterRanges(rightText);
	const source = parameterRanges(leftText);

	for (const rows of COPIED) {
		const from = PARAMETERS - rows;
		const plan = measureStage(() =>
			planCopy({
				targetText: rightText,
				sourceText: leftText,
				source: blockRange(source, from, rows),
				anchorAfter: target[target.length - 1],
				targetIndent: '    '
			})
		);
		if (!plan.value.ok) {
			throw new Error(`copy of ${rows} rows refused: ${plan.value.reason}`);
		}
		const span = plan.value.span;
		const applied = measureStage(() =>
			rightText.slice(0, span.start) + span.text + rightText.slice(span.end)
		);
		// The old path: re-scan, rebuild the rows and the whole comparison.
		const refresh = measureStage(() => {
			const nextRight = sideOf(applied.value);
			return diffOf(left, nextRight);
		});
		const before = diffOf(left, right);
		const beforeDocs = buildDiffSyntheticDocuments(before);
		const afterDocs = buildDiffSyntheticDocuments(refresh.value);
		const patch = measureStage(() => {
			const edit = minimalLineEdit(beforeDocs.right.text, afterDocs.right.text);
			return edit === undefined ? beforeDocs.right.text : applyLineEdit(beforeDocs.right.text, edit);
		});
		if (plan.elapsedMs > MAX_PLAN_MS) {
			throw new Error(`copy plan of ${rows} rows took ${plan.elapsedMs} ms, over ${MAX_PLAN_MS} ms`);
		}
		if (patch.elapsedMs > MAX_PATCH_MS) {
			throw new Error(`page patch of ${rows} rows took ${patch.elapsedMs} ms, over ${MAX_PATCH_MS} ms`);
		}
		const edit = minimalLineEdit(beforeDocs.right.text, afterDocs.right.text);
		console.log(
			JSON.stringify({
				_type: 'copy',
				rows,
				bytes: span.text.length,
				planMs: plan.elapsedMs,
				applyMs: applied.elapsedMs,
				refreshMs: refresh.elapsedMs,
				pageRebuildMs: patch.elapsedMs,
				replacedLines: edit?.deleteCount ?? 0,
				addedLines: edit === undefined ? 0 : edit.text.split('\n').length - 1,
				totalModelLines: beforeDocs.right.text.split('\n').length
			})
		);
	}
}

main();
