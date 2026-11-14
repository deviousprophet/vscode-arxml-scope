/**
 * Three-way merge planner (core).
 *
 * Each test is one row of the design's decision matrix, with digests standing in for
 * the engine's own-field hashes: two sides that changed different children of one
 * container must both merge, and only a genuine divergence may conflict.
 */
import * as assert from 'assert';

import { applyResolution, planMerge, resolveAll } from '../../core/merge/plan';
import type { MergePlan } from '../../core/merge/model';
import { mergeDoc, moduleTree } from '../merge/mergeTestUtils';

const MODULE = 'm1';
const CONTAINER = 'c1';

function scenario(
	baseParameters: Record<string, string>,
	oursParameters: Record<string, string>,
	theirsParameters: Record<string, string>,
	containerOverrides: { base?: string; ours?: string; theirs?: string } = {}
): MergePlan {
	return planMerge({
		base: mergeDoc('base', moduleTree(MODULE, containerOverrides.base ?? CONTAINER, baseParameters)),
		ours: mergeDoc('ours', moduleTree(MODULE, containerOverrides.ours ?? CONTAINER, oursParameters)),
		theirs: mergeDoc('theirs', moduleTree(MODULE, containerOverrides.theirs ?? CONTAINER, theirsParameters))
	});
}

function decisionOf(plan: MergePlan, suffix: string) {
	const decision = plan.decisions.find((candidate) => candidate.id.endsWith(suffix));
	assert.ok(decision, `a decision for ${suffix}`);
	return decision;
}

suite('merge plan (core)', () => {
	test('a value changed on one side only merges without a conflict', () => {
		const plan = scenario({ P1: '1', P2: '2' }, { P1: '11', P2: '2' }, { P1: '1', P2: '22' });
		assert.strictEqual(plan.conflicts.length, 0);
		assert.strictEqual(decisionOf(plan, 'param:P1#0').source, 'ours');
		assert.strictEqual(decisionOf(plan, 'param:P2#0').source, 'theirs');
	});

	test('two sides editing different children of one container both merge', () => {
		const plan = scenario({ P1: '1', P2: '2' }, { P1: '11', P2: '2' }, { P1: '1', P2: '22' });
		assert.strictEqual(
			plan.decisions.some((decision) => decision.kind === 'container'),
			false,
			'the container itself is not replaced'
		);
		assert.strictEqual(decisionOf(plan, 'param:P1#0').source, 'ours');
		assert.strictEqual(decisionOf(plan, 'param:P2#0').source, 'theirs');
	});

	test('a value changed differently on both sides is one conflict', () => {
		const plan = scenario({ P1: '1' }, { P1: '11' }, { P1: '111' });
		assert.strictEqual(plan.conflicts.length, 1);
		const conflict = plan.conflicts[0];
		assert.strictEqual(conflict.reason, 'both-changed');
		assert.strictEqual(conflict.ours?.value, '11');
		assert.strictEqual(conflict.theirs?.value, '111');
		assert.strictEqual(plan.unresolved, 1);
	});

	test('the same change on both sides is not a conflict', () => {
		const plan = scenario({ P1: '1' }, { P1: '5' }, { P1: '5' });
		assert.strictEqual(plan.conflicts.length, 0);
		assert.strictEqual(decisionOf(plan, 'param:P1#0').source, 'ours');
	});

	test('a node ours already lacks needs no decision, and one theirs drops is deleted', () => {
		const oursDeleted = scenario({ P1: '1', P2: '2' }, { P1: '1' }, { P1: '1', P2: '2' });
		assert.strictEqual(oursDeleted.conflicts.length, 0);
		assert.strictEqual(
			oursDeleted.decisions.some((decision) => decision.id.endsWith('param:P2#0')),
			false,
			"ours' bytes already omit it"
		);

		const theirsDeleted = scenario({ P1: '1', P2: '2' }, { P1: '11', P2: '2' }, { P1: '1' });
		assert.strictEqual(theirsDeleted.conflicts.length, 0);
		assert.strictEqual(decisionOf(theirsDeleted, 'param:P2#0').source, 'none');
	});

	test('a delete on ours against a changed theirs is a delete/modify conflict', () => {
		const plan = scenario({ P1: '1', P2: '2' }, { P1: '1' }, { P1: '1', P2: '22' });
		assert.strictEqual(plan.conflicts.length, 1);
		assert.strictEqual(plan.conflicts[0].reason, 'delete-modify');
		assert.strictEqual(plan.conflicts[0].ours, undefined);
		assert.strictEqual(plan.conflicts[0].theirs?.value, '22');
	});

	test('a node only theirs added is inserted, and one added on both identically merges', () => {
		const inserted = scenario({ P1: '1' }, { P1: '11' }, { P1: '11', P3: '3' });
		assert.strictEqual(inserted.conflicts.length, 0);
		assert.strictEqual(decisionOf(inserted, 'param:P3#0').source, 'theirs');
		assert.strictEqual(decisionOf(inserted, 'param:P3#0').afterId, 'container:Pkg/Mod/Cont#0/param:P1#0');

		const same = scenario({ P1: '1' }, { P1: '11', P3: '3' }, { P1: '11', P3: '3' });
		assert.strictEqual(same.conflicts.length, 0);
		assert.strictEqual(decisionOf(same, 'param:P3#0').source, 'ours');
	});

	test('the same addition with different values is an add/add conflict', () => {
		const plan = scenario({ P1: '1' }, { P1: '11', P3: '3' }, { P1: '11', P3: '33' });
		assert.strictEqual(plan.conflicts.length, 1);
		assert.strictEqual(plan.conflicts[0].reason, 'add-add');
	});

	test('a container renamed on ours only keeps ours without a conflict', () => {
		const plan = scenario({ P1: '1' }, { P1: '1' }, { P1: '1' }, { ours: 'renamed' });
		assert.strictEqual(plan.conflicts.length, 0);
		assert.strictEqual(
			plan.decisions.some((decision) => decision.kind === 'container'),
			false,
			"ours' bytes already carry the rename"
		);
	});

	test('different renames on both sides conflict at the container', () => {
		const plan = scenario({ P1: '1' }, { P1: '1' }, { P1: '1' }, { ours: 'renamed-a', theirs: 'renamed-b' });
		assert.strictEqual(plan.conflicts.length, 1);
		assert.strictEqual(plan.conflicts[0].kind, 'container');
	});

	test('the same added id with the same subtree merges, with a different subtree conflicts', () => {
		const moduleId = 'module:/Pkg/Mod|Mod#0';
		const base = moduleTree('m1', 'c1', { P1: '1' });
		const added = (childDigest: string) => [
			...moduleTree('m1', 'c1', { P1: '11' }),
			{ id: 'container:Pkg/Mod/New#0', kind: 'container' as const, parentId: moduleId, order: 1, digest: 'n1', shortName: 'New' },
			{ id: 'container:Pkg/Mod/New#0/param:Q#0', kind: 'parameter' as const, parentId: 'container:Pkg/Mod/New#0', order: 0, digest: childDigest }
		];
		const identical = planMerge({
			base: mergeDoc('base', base),
			ours: mergeDoc('ours', added('q1')),
			theirs: mergeDoc('theirs', added('q1'))
		});
		assert.strictEqual(identical.conflicts.length, 0, 'the same addition merges once');

		const different = planMerge({
			base: mergeDoc('base', base),
			ours: mergeDoc('ours', added('q1')),
			theirs: mergeDoc('theirs', added('q2'))
		});
		assert.strictEqual(different.conflicts.length, 1);
		assert.strictEqual(different.conflicts[0].reason, 'add-add');
	});

	test('resolving one conflict updates the source and the unresolved count', () => {
		const plan = scenario({ P1: '1' }, { P1: '11' }, { P1: '111' });
		assert.strictEqual(applyResolution(plan, plan.conflicts[0].id, 'theirs'), 0);
		assert.strictEqual(decisionOf(plan, 'param:P1#0').source, 'theirs');
	});

	test('resolve-all picks one side for every conflict', () => {
		const plan = scenario({ P1: '1', P2: '2' }, { P1: '11', P2: '22' }, { P1: '111', P2: '222' });
		assert.strictEqual(plan.conflicts.length, 2);
		resolveAll(plan, 'ours');
		assert.strictEqual(plan.unresolved, 0);
		assert.strictEqual(decisionOf(plan, 'param:P1#0').source, 'ours');
		assert.strictEqual(decisionOf(plan, 'param:P2#0').source, 'ours');
	});
});
