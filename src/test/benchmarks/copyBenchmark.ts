/**
 * Copy-plan benchmark.
 *
 * A copy is one element splice plus the host's text read; this records both on the large
 * synthetic document. The plan itself must stay O(element), never O(document).
 */
import { planCopy } from '../../core/copy/planCopy';
import { buildEcucArxml } from './ecucLargeFixture';
import { measureStage } from './benchmarkUtils';

const MAX_PLAN_MS = 100;

function main(): void {
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
			target: { start: range.start + 0, end: range.end },
			targetIndent: '          '
		})
	);
	if (!plan.value.ok) {
		throw new Error(`copy refused: ${plan.value.reason}`);
	}
	if (plan.elapsedMs > MAX_PLAN_MS) {
		throw new Error(`copy plan took ${plan.elapsedMs} ms, over ${MAX_PLAN_MS} ms`);
	}
	console.log(
		JSON.stringify({
			_type: 'copy',
			sourceMiB: Math.round(Buffer.byteLength(text) / 1048576),
			elementBytes: read.value,
			planMs: plan.elapsedMs,
			writtenBytes: plan.value.span.text.length
		})
	);
}

main();
