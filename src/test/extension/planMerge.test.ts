/**
 * MERGE plan rows at the copy-plan and engine-patch seams.
 *
 * The panel's arrow handler is a closure inside `DiffPanel.open`; `vscode-test`
 * cannot deliver a webview message to it. These tests cover what the handler
 * rests on: the pure copy planner (`planCopy` / `planDelete` / `wrapWithAncestors`),
 * and the engine's `diff.patch` answer (`applyDiffPatch(previous, patch)` equals a
 * full rebuild, or a stable fallback reason). The rows that need the panel's own
 * message path are pinned in `compare.test.ts`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'node:perf_hooks';

import { indentationAt, planCopy, planDelete, wrapWithAncestors } from '../../core/copy/planCopy';
import type { DiffDocument } from '../../core/diff/diffModel';
import { applyDiffPatch } from '../../core/diff/diffPatch';
import type { ContainerNode, EcucDocumentModel, ParameterNode } from '../../core/ecuc/model';
import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { scanEcucValues } from '../../core/ecuc/scanner';
import type { CoreEngine, EngineDiffEdit, EngineDiffSide } from '../../host/engine/coreEngine';
import { resolveEngine } from '../../host/engine/engineLoader';
import { buildEcucArxml } from '../benchmarks/ecucLargeFixture';
import { fixtureText } from '../core/modelTestUtils';
import { repoRoot } from './testUtils';

const LEFT_TEXT = fixtureText('diff/left.arxml');
const RIGHT_TEXT = fixtureText('diff/right.arxml');
const LEFT = scanEcucValues(LEFT_TEXT);
const RIGHT = scanEcucValues(RIGHT_TEXT);

function parametersOf(model: EcucDocumentModel): ParameterNode[] {
	const parameters: ParameterNode[] = [];
	const visit = (container: ContainerNode): void => {
		parameters.push(...container.parameters);
		container.containers.forEach(visit);
	};
	model.modules.forEach((module) => module.containers.forEach(visit));
	return parameters;
}

function parameterNamed(model: EcucDocumentModel, name: string): ParameterNode {
	const found = parametersOf(model).find((parameter) => parameter.name === name);
	assert.ok(found, `the fixture has parameter ${name}`);
	return found;
}

function containersOf(model: EcucDocumentModel): ContainerNode[] {
	const containers: ContainerNode[] = [];
	const visit = (container: ContainerNode): void => {
		containers.push(container);
		container.containers.forEach(visit);
	};
	model.modules.forEach((module) => module.containers.forEach(visit));
	return containers;
}

function containerNamed(model: EcucDocumentModel, shortName: string): ContainerNode {
	const found = containersOf(model).find((container) => container.shortName === shortName);
	assert.ok(found, `the fixture has container ${shortName}`);
	return found;
}

function replaceRange(
	text: string,
	range: { start: number; end: number },
	replacement: string
): string {
	return text.slice(0, range.start) + replacement + text.slice(range.end);
}

function elementSpan(text: string, openTag: string, closeTag: string): { start: number; end: number } {
	const start = text.indexOf(openTag);
	assert.ok(start >= 0, `the text has ${openTag}`);
	const end = text.indexOf(closeTag, start);
	assert.ok(end >= 0, `the text has ${closeTag}`);
	return { start, end: end + closeTag.length };
}

/** One replacement in a document, plus the edit the host would report for it. */
function replaceOnce(text: string, from: string, to: string): { text: string; edit: EngineDiffEdit } {
	const start = text.indexOf(from);
	assert.ok(start >= 0, `the text has ${from}`);
	return {
		text: text.slice(0, start) + to + text.slice(start + from.length),
		edit: { side: 'right', start, end: start + from.length, text: to }
	};
}

const ROW_OPTIONS = { sort: 'all' as const, sortExcept: SORT_EXCEPTIONS };

suite('copy merge planner (MERGE rows)', () => {
	test('MERGE-02 copying left→right replaces the changed parameter with the left bytes', () => {
		const source = parameterNamed(LEFT, 'Changed');
		const target = parameterNamed(RIGHT, 'Changed');
		const sourceElement = LEFT_TEXT.slice(source.range.start, source.range.end);
		const planned = planCopy({
			targetText: RIGHT_TEXT,
			sourceText: LEFT_TEXT,
			source: source.range,
			target: target.range,
			targetIndent: indentationAt(RIGHT_TEXT, target.range.start),
		});
		assert.ok(planned.ok);
		assert.strictEqual(planned.span.start, target.range.start, 'one contiguous replace starts at the target');
		assert.strictEqual(planned.span.end, target.range.end, 'one contiguous replace ends at the target');
		const result = replaceRange(RIGHT_TEXT, target.range, planned.span.text);
		assert.strictEqual(result, replaceRange(RIGHT_TEXT, target.range, sourceElement));
		assert.ok(result.includes('<VALUE>10</VALUE>'), 'the right value becomes the left one');
		assert.ok(!result.includes('<VALUE>11</VALUE>'), 'the old right value is gone');
	});

	test('MERGE-03 copying right→left is mirrored and copies the same element bytes', () => {
		const source = parameterNamed(RIGHT, 'Changed');
		const target = parameterNamed(LEFT, 'Changed');
		const sourceElement = RIGHT_TEXT.slice(source.range.start, source.range.end);
		const planned = planCopy({
			targetText: LEFT_TEXT,
			sourceText: RIGHT_TEXT,
			source: source.range,
			target: target.range,
			targetIndent: indentationAt(LEFT_TEXT, target.range.start),
		});
		assert.ok(planned.ok);
		assert.strictEqual(planned.span.start, target.range.start);
		assert.strictEqual(planned.span.end, target.range.end);
		assert.strictEqual(planned.span.text, sourceElement, 'the target receives the source element bytes');
		const result = replaceRange(LEFT_TEXT, target.range, planned.span.text);
		assert.strictEqual(result, replaceRange(LEFT_TEXT, target.range, sourceElement));
		assert.ok(result.includes('<VALUE>11</VALUE>'));
		assert.ok(!result.includes('<VALUE>10</VALUE>'));
	});

	test('MERGE-04 copying a container replaces the whole subtree and drops target-only children', () => {
		const source = containerNamed(LEFT, 'ContParentB');
		const target = containerNamed(RIGHT, 'ContParentB');
		assert.ok(!source.containers.length, 'the source container has no children');
		assert.ok(target.containers.some((child) => child.shortName === 'ContMoved'), 'the target has a target-only child');
		const planned = planCopy({
			targetText: RIGHT_TEXT,
			sourceText: LEFT_TEXT,
			source: source.range,
			target: target.range,
			targetIndent: indentationAt(RIGHT_TEXT, target.range.start),
		});
		assert.ok(planned.ok);
		const result = replaceRange(RIGHT_TEXT, target.range, planned.span.text);
		assert.strictEqual(
			result,
			replaceRange(RIGHT_TEXT, target.range, LEFT_TEXT.slice(source.range.start, source.range.end)),
			'the whole source container replaces the target element'
		);
		assert.strictEqual(result.split('ContMoved').length - 1, 0, 'the target-only child is removed with the subtree');
		assert.ok(result.includes('<SHORT-NAME>ContParentB</SHORT-NAME>'), 'the target container itself remains');
	});

	test('MERGE-05 a placeholder arrow deletes the element from the side that has it', () => {
		const target = containerNamed(LEFT, 'ContRemoved');
		const planned = planDelete({
			targetText: LEFT_TEXT,
			sourceText: '',
			target: target.range,
			targetIndent: indentationAt(LEFT_TEXT, target.range.start),
		});
		assert.ok(planned.ok);
		assert.strictEqual(planned.span.text, '');
		const result = LEFT_TEXT.slice(0, planned.span.start) + LEFT_TEXT.slice(planned.span.end);
		assert.ok(!result.includes('ContRemoved'), 'the container is gone');
		assert.ok(!result.includes('ContRemovedNested'), 'its subtree is gone');
		assert.ok(!result.includes('RemovedChild'), 'its parameter is gone');
		assert.ok(result.includes('<SHORT-NAME>ContKeep</SHORT-NAME>'), 'the neighbour survives');
		assert.ok(!result.includes('\n\n'), 'the element line is removed without a blank line');
	});

	test('MERGE-06 a missing parent is synthesized minimally; source siblings are not imported', () => {
		const source = parameterNamed(RIGHT, 'AddedParam');
		const missing = containerNamed(RIGHT, 'ContAdded');
		const anchor = containerNamed(LEFT, 'ContKeep');
		const targetIndent = indentationAt(LEFT_TEXT, anchor.range.start);
		const wrapped = wrapWithAncestors(
			RIGHT_TEXT.slice(source.range.start, source.range.end),
			indentationAt(RIGHT_TEXT, source.range.start),
			[
				{
					shortName: missing.shortName,
					definitionRef: missing.definitionRef,
					definitionDest: 'ECUC-PARAM-CONF-CONTAINER-DEF',
					childKind: 'parameter'
				}
			],
			targetIndent
		);
		assert.ok(wrapped.startsWith('<ECUC-CONTAINER-VALUE>'), 'the chain is a minimal container');
		assert.ok(wrapped.includes('<SHORT-NAME>ContAdded</SHORT-NAME>'));
		assert.ok(wrapped.includes('<PARAMETER-VALUES>'), 'the parameter goes in PARAMETER-VALUES');
		assert.ok(wrapped.includes('/Pkg/Diff/ModAlpha/ContAdded/AddedParam'), 'the copied element is kept');
		assert.ok(!wrapped.includes('ContAddedNested'), 'no unrelated source container is imported');
		assert.ok(!wrapped.includes('NestedText'), 'no unrelated source parameter is imported');
		assert.ok(!wrapped.includes('<SUB-CONTAINERS>'), 'no child list is invented');

		// The insertion the host intends: after a sibling inside the existing module.
		const inserted =
			LEFT_TEXT.slice(0, anchor.range.end) + `\n${targetIndent}${wrapped}` + LEFT_TEXT.slice(anchor.range.end);
		const model = scanEcucValues(inserted);
		const module = model.modules.find((candidate) => candidate.shortName === 'ModAlpha');
		assert.ok(module, 'the existing module still parses');
		const added = module.containers.find((candidate) => candidate.shortName === 'ContAdded');
		assert.ok(added, 'the missing container now exists on the target');
		assert.strictEqual(added.parameters.length, 1, 'the new container holds only the copied parameter');
		assert.strictEqual(added.parameters[0].name, 'AddedParam');
		assert.strictEqual(added.containers.length, 0, 'the new container holds no unrelated children');
	});
});

suite('copy merge patch (engine MERGE rows)', () => {
	const DOC = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Pkg</SHORT-NAME>
      <ELEMENTS>
        <ECUC-MODULE-CONFIGURATION-VALUES>
          <SHORT-NAME>Mod</SHORT-NAME>
          <DEFINITION-REF DEST="ECUC-MODULE-DEF">/Pkg/Mod</DEFINITION-REF>
          <CONTAINERS>
            <ECUC-CONTAINER-VALUE>
              <SHORT-NAME>Cont</SHORT-NAME>
              <DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Pkg/Mod/Cont</DEFINITION-REF>
              <PARAMETER-VALUES>
                <ECUC-NUMERICAL-PARAM-VALUE>
                  <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Pkg/Mod/Cont/P</DEFINITION-REF>
                  <VALUE>1000</VALUE>
                </ECUC-NUMERICAL-PARAM-VALUE>
                <ECUC-NUMERICAL-PARAM-VALUE>
                  <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Pkg/Mod/Cont/Q</DEFINITION-REF>
                  <VALUE>2</VALUE>
                </ECUC-NUMERICAL-PARAM-VALUE>
              </PARAMETER-VALUES>
            </ECUC-CONTAINER-VALUE>
          </CONTAINERS>
        </ECUC-MODULE-CONFIGURATION-VALUES>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>
`;

	interface EnginePair {
		left: EngineDiffSide;
		right: EngineDiffSide;
		leftId: number;
		rightId: number;
	}

	let engine: CoreEngine;
	let sequence = 0;

	suiteSetup(async function () {
		this.timeout(30000);
		engine = await resolveEngine(repoRoot);
	});

	suiteTeardown(() => {
		engine.dispose();
	});

	async function openPair(leftText: string, rightText: string): Promise<EnginePair> {
		sequence += 1;
		const leftId = await engine.openDocument(`mem://merge-left-${sequence}.arxml`, leftText, ROW_OPTIONS);
		const rightId = await engine.openDocument(`mem://merge-right-${sequence}.arxml`, rightText, ROW_OPTIONS);
		return {
			left: { docId: leftId, name: `left-${sequence}.arxml`, path: `/mem/left-${sequence}.arxml` },
			right: { docId: rightId, name: `right-${sequence}.arxml`, path: `/mem/right-${sequence}.arxml` },
			leftId,
			rightId
		};
	}

	async function closePair(pair: EnginePair): Promise<void> {
		await engine.closeDocument(pair.leftId);
		await engine.closeDocument(pair.rightId);
	}

	function diffOf(pair: EnginePair): Promise<DiffDocument> {
		return engine.computeDiff(pair.left, pair.right, { semanticMatching: false });
	}

	test('MERGE-11 a copy patch equals a full rebuild and carries the rows plus a range shift', async () => {
		const rightText = DOC.replace('<VALUE>1000</VALUE>', '<VALUE>3</VALUE>');
		const pair = await openPair(DOC, rightText);
		try {
			const before = await diffOf(pair);
			const at = rightText.indexOf('<VALUE>3</VALUE>') + '<VALUE>'.length;
			const edit: EngineDiffEdit = { side: 'right', start: at, end: at + 1, text: '1000' };
			await engine.updateDocument(pair.rightId, [edit]);
			const answer = await engine.patchDiff(pair.left, pair.right, edit);
			assert.ok(answer.patch !== undefined, `the engine patched the copy (${answer.reason ?? 'no reason'})`);
			const patch = answer.patch;

			assert.ok(patch.rows.length > 0, 'the answer carries the changed rows');
			assert.ok(patch.shift !== undefined, 'the answer carries a range shift');
			assert.strictEqual(patch.shift?.side, 'right');
			assert.strictEqual(patch.shift?.by, 3, '3 → 1000 grows the document by three UTF-16 units');

			const patched = applyDiffPatch(before, patch);
			const rebuilt = await diffOf(pair);
			assert.deepStrictEqual(patched.rows, rebuilt.rows, 'the patched panel equals a full rebuild');
			assert.deepStrictEqual(patched.summary, rebuilt.summary, 'the counters equal the rebuild');
			assert.strictEqual(patched.semanticSkipped, rebuilt.semanticSkipped);
		} finally {
			await closePair(pair);
		}
	});

	test('MERGE-12 every fallback reason rebuilds instead of applying a wrong row', async () => {
		/** Opens a matching pair, computes the baseline, applies `edit`, and asserts the fallback. */
		async function assertFallback(
			reason: string,
			edit: EngineDiffEdit,
			verify: (rebuilt: DiffDocument, before: DiffDocument) => void,
			leftText = DOC
		): Promise<void> {
			const pair = await openPair(leftText, DOC);
			try {
				const before = await diffOf(pair);
				await engine.updateDocument(pair.rightId, [edit]);
				const answer = await engine.patchDiff(pair.left, pair.right, edit);
				assert.strictEqual(answer.patch, undefined, `${reason}: no patch is applied`);
				assert.strictEqual(answer.reason, reason, `${reason}: the stable reason is returned`);
				const rebuilt = await diffOf(pair);
				verify(rebuilt, before);
			} finally {
				await closePair(pair);
			}
		}

		// No baseline has ever been recorded for this pair.
		const noBaseline = await openPair(DOC, DOC);
		try {
			const valueAt = DOC.indexOf('<VALUE>1000</VALUE>') + '<VALUE>'.length;
			const answer = await engine.patchDiff(noBaseline.left, noBaseline.right, {
				side: 'right',
				start: valueAt,
				end: valueAt + 4,
				text: '1'
			});
			assert.strictEqual(answer.patch, undefined);
			assert.strictEqual(answer.reason, 'no-baseline');
			const rebuilt = await diffOf(noBaseline);
			assert.strictEqual(rebuilt.summary.changed, 0, 'the rebuild shows the unchanged pair, not a wrong row');
		} finally {
			await closePair(noBaseline);
		}

		const renamed = replaceOnce(DOC, '<SHORT-NAME>Mod</SHORT-NAME>', '<SHORT-NAME>ModX</SHORT-NAME>');
		await assertFallback('top-level-order', renamed.edit, (rebuilt) => {
			assert.ok(
				rebuilt.rows.some((row) => row.right?.shortName === 'ModX'),
				'the rebuild shows the renamed module'
			);
		});

		const moduleSpan = elementSpan(DOC, '<ECUC-MODULE-CONFIGURATION-VALUES>', '</ECUC-MODULE-CONFIGURATION-VALUES>');
		const moduleText = DOC.slice(moduleSpan.start, moduleSpan.end);
		await assertFallback(
			'module-row',
			{
				side: 'right',
				start: moduleSpan.start,
				end: moduleSpan.end,
				text: moduleText.replace('<VALUE>1000</VALUE>', '<VALUE>9</VALUE>')
			},
			(rebuilt) => {
				assert.ok(
					rebuilt.rows.some((row) => row.right?.value === '9'),
					'the rebuild shows the copied module bytes'
				);
			}
		);

		await assertFallback(
			'outside-elements',
			{ side: 'right', start: 0, end: 0, text: '\n' },
			(rebuilt, before) => {
				assert.deepStrictEqual(
					rebuilt.rows.map((row) => row.key),
					before.rows.map((row) => row.key),
					'the whitespace edit changes no row identity'
				);
				assert.deepStrictEqual(rebuilt.summary, before.summary, 'the counters are unchanged');
			}
		);

		const containerSpan = elementSpan(DOC, '<ECUC-CONTAINER-VALUE>', '</ECUC-CONTAINER-VALUE>');
		const withoutContainer = DOC.slice(0, containerSpan.start) + DOC.slice(containerSpan.end);
		await assertFallback(
			'parent-created',
			{ side: 'right', start: containerSpan.start, end: containerSpan.end, text: '' },
			(rebuilt) => {
				assert.ok(!rebuilt.rows.some((row) => row.kind === 'container'), 'the deleted container stays gone');
				assert.ok(rebuilt.rows.some((row) => row.kind === 'module'), 'the module row survives');
			},
			withoutContainer
		);

		// Two changes reached the document; the copy reports only the first one.
		const stalePair = await openPair(DOC, DOC);
		try {
			const before = await diffOf(stalePair);
			const first = replaceOnce(DOC, '<VALUE>1000</VALUE>', '<VALUE>10000</VALUE>');
			await engine.updateDocument(stalePair.rightId, [first.edit]);
			const second = replaceOnce(first.text, '<VALUE>2</VALUE>', '<VALUE>20</VALUE>');
			await engine.updateDocument(stalePair.rightId, [second.edit]);
			const answer = await engine.patchDiff(stalePair.left, stalePair.right, first.edit);
			assert.strictEqual(answer.patch, undefined);
			assert.strictEqual(answer.reason, 'stale-baseline');
			const rebuilt = await diffOf(stalePair);
			assert.ok(rebuilt.rows.some((row) => row.right?.value === '10000'), 'the first edit is visible after the rebuild');
			assert.ok(rebuilt.rows.some((row) => row.right?.value === '20'), 'the second edit is visible after the rebuild');
			assert.ok(before.rows.length > 0);
		} finally {
			await closePair(stalePair);
		}

		// The stable code list and the host's notice are the contract the six cases above share.
		const read = (file: string): string => fs.readFileSync(path.join(repoRoot, file), 'utf8');
		const patchSource = read('rust/arxml-core/src/diff/patch.rs');
		for (const reason of ['top-level-order', 'module-row', 'outside-elements', 'parent-created', 'ancestor-changed']) {
			assert.ok(patchSource.includes(`"${reason}"`), `${reason} is a stable patch reason`);
		}
		const engineSource = read('rust/arxml-engine/src/main.rs');
		for (const reason of ['no-baseline', 'stale-baseline']) {
			assert.ok(engineSource.includes(`"${reason}"`), `${reason} is a stable engine reason`);
		}
		const panelSource = read('src/host/diffPanel.ts');
		assert.ok(
			panelSource.includes('The comparison was rebuilt after this copy (${result.reason ?? \'unknown\'}).'),
			'the host names the fallback reason in its notice'
		);
		assert.ok(panelSource.includes('await refreshNow();'), 'the host rebuilds after a refused patch');
	});
});

suite('copy merge budget (MERGE-15)', () => {
	test('MERGE-15 ten copies on the 20+ MiB pair stay inside the copy budget', () => {
		const left = buildEcucArxml('left');
		const right = buildEcucArxml('right');
		const sourceMiB = Math.round(Buffer.byteLength(left) / 1048576);
		assert.ok(sourceMiB >= 20, `the synthetic left side is 20 MiB or larger (${sourceMiB} MiB)`);
		assert.ok(Buffer.byteLength(right) >= 20 * 1024 * 1024, 'the right side is 20 MiB or larger');

		const open = left.indexOf('<ECUC-NUMERICAL-PARAM-VALUE>');
		assert.ok(open >= 0, 'the synthetic pair has a parameter');
		const close = left.indexOf('</ECUC-NUMERICAL-PARAM-VALUE>', open);
		const range = { start: open, end: close + '</ECUC-NUMERICAL-PARAM-VALUE>'.length };
		const expected = left.slice(range.start, range.end);
		const indent = indentationAt(left, range.start);

		const durations: number[] = [];
		const started = performance.now();
		for (let copy = 0; copy < 10; copy++) {
			const at = performance.now();
			const planned = planCopy({
				targetText: left,
				sourceText: left,
				source: range,
				target: range,
				targetIndent: indent,
			});
			durations.push(performance.now() - at);
			assert.ok(planned.ok);
			assert.strictEqual(planned.span.text, expected, 'the copied row keeps its bytes');
		}
		const total = performance.now() - started;
		const slowest = Math.max(...durations);

		const answer = planCopy({
			targetText: left,
			sourceText: left,
			source: range,
			target: range,
			targetIndent: indent
		});
		assert.ok(answer.ok);
		const applyStart = performance.now();
		const applied =
			left.slice(0, answer.span.start) + answer.span.text + left.slice(answer.span.end);
		const applyMs = performance.now() - applyStart;

		console.log(
			`[MERGE-15] ${sourceMiB} MiB: slowest copy ${slowest.toFixed(2)} ms, ` +
				`ten copies ${total.toFixed(2)} ms, apply ${applyMs.toFixed(2)} ms`
		);
		assert.ok(slowest < 100, `a row is ready in under 100 ms (${slowest.toFixed(2)} ms)`);
		assert.ok(applyMs < 250, `the answer is consistent in under 250 ms (${applyMs.toFixed(2)} ms)`);
		assert.ok(total < 10000, `ten copies finish in under 10 s (${total.toFixed(2)} ms)`);
		assert.strictEqual(applied, left, 'copying the same bytes leaves the document unchanged');
	});
});
