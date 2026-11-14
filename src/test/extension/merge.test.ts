/**
 * Three-way merge against the running engine (extension).
 *
 * The engine supplies the ids, element ranges and own-field digests; the host
 * planner and composer turn them into text. These tests assert the bytes, not just
 * the decisions, so the composition and re-indentation are covered end to end.
 */
import * as assert from 'assert';

import { composeMerge } from '../../core/merge/compose';
import { applyResolution, planMerge, resolveAll } from '../../core/merge/plan';
import type { MergeDoc, MergePlan } from '../../core/merge/model';
import type { CoreEngine } from '../../host/engine/coreEngine';
import { resolveEngine } from '../../host/engine/engineLoader';
import { repoRoot } from './testUtils';

const OPTIONS = { sort: 'all' as const, sortExcept: [] as string[] };

interface Values {
	p1: string;
	p2?: string;
	p3?: string;
	container?: string;
}

/** A complete ECUC file; every scenario and every expectation is built from it. */
function docText(values: Values): string {
	const container = values.container ?? 'Cont';
	const parameters = [
		`          <ECUC-NUMERICAL-PARAM-VALUE>\n            <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Pkg/Mod/${container}/P1</DEFINITION-REF>\n            <VALUE>${values.p1}</VALUE>\n          </ECUC-NUMERICAL-PARAM-VALUE>`,
		values.p2 === undefined
			? undefined
			: `          <ECUC-NUMERICAL-PARAM-VALUE>\n            <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Pkg/Mod/${container}/P2</DEFINITION-REF>\n            <VALUE>${values.p2}</VALUE>\n          </ECUC-NUMERICAL-PARAM-VALUE>`,
		values.p3 === undefined
			? undefined
			: `          <ECUC-NUMERICAL-PARAM-VALUE>\n            <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Pkg/Mod/${container}/P3</DEFINITION-REF>\n            <VALUE>${values.p3}</VALUE>\n          </ECUC-NUMERICAL-PARAM-VALUE>`
	]
		.filter((block): block is string => block !== undefined)
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0">
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Pkg</SHORT-NAME>
      <ELEMENTS>
        <ECUC-MODULE-CONFIGURATION-VALUES>
          <SHORT-NAME>Mod</SHORT-NAME>
          <DEFINITION-REF DEST="ECUC-MODULE-DEF">/Pkg/Mod</DEFINITION-REF>
          <CONTAINERS>
            <ECUC-CONTAINER-VALUE>
              <SHORT-NAME>${container}</SHORT-NAME>
              <DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Pkg/Mod/${container}</DEFINITION-REF>
              <PARAMETER-VALUES>
${parameters}
              </PARAMETER-VALUES>
            </ECUC-CONTAINER-VALUE>
          </CONTAINERS>
        </ECUC-MODULE-CONFIGURATION-VALUES>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>
`;
}

async function openDoc(engine: CoreEngine, name: string, text: string): Promise<MergeDoc> {
	const docId = await engine.openDocument(name, text, OPTIONS);
	const [rows, nodes] = await Promise.all([engine.rows(docId, OPTIONS), engine.mergeIndex(docId)]);
	await engine.closeDocument(docId);
	return { uri: name, text, rows, nodes };
}

function compose(plan: MergePlan, docs: { base: MergeDoc; ours: MergeDoc; theirs: MergeDoc }) {
	return composeMerge({ base: docs.base, ours: docs.ours, theirs: docs.theirs }, plan);
}

suite('merge configs (extension)', function () {
	let engine: CoreEngine;
	suiteSetup(async () => {
		engine = await resolveEngine(repoRoot);
	});
	suiteTeardown(() => {
		engine.dispose();
	});

	async function merge(
		baseValues: Values,
		oursValues: Values,
		theirsValues: Values
	): Promise<{ plan: MergePlan; docs: { base: MergeDoc; ours: MergeDoc; theirs: MergeDoc } }> {
		const [base, ours, theirs] = await Promise.all([
			openDoc(engine, 'base.arxml', docText(baseValues)),
			openDoc(engine, 'ours.arxml', docText(oursValues)),
			openDoc(engine, 'theirs.arxml', docText(theirsValues))
		]);
		return { plan: planMerge({ base, ours, theirs }), docs: { base, ours, theirs } };
	}

	test('merges values changed on different sides and writes expected bytes', async () => {
		const { plan, docs } = await merge({ p1: '1', p2: '2' }, { p1: '11', p2: '2' }, { p1: '1', p2: '22' });
		assert.strictEqual(plan.conflicts.length, 0);
		const result = compose(plan, docs);
		assert.ok(result.ok);
		assert.strictEqual(result.text, docText({ p1: '11', p2: '22' }));
	});

	test('accept-all-left and accept-all-right reproduce each side', async () => {
		const { plan, docs } = await merge({ p1: '1' }, { p1: '11' }, { p1: '111' });
		assert.strictEqual(plan.conflicts.length, 1);
		const refused = compose(plan, docs);
		assert.ok(!refused.ok, 'an unresolved conflict blocks the write');

		resolveAll(plan, 'ours');
		const left = compose(plan, docs);
		assert.ok(left.ok);
		assert.strictEqual(left.text, docs.ours.text);

		resolveAll(plan, 'theirs');
		const right = compose(plan, docs);
		assert.ok(right.ok);
		assert.strictEqual(right.text, docs.theirs.text);
	});

	test('inserts a parameter only theirs added, at the right indentation', async () => {
		const { plan, docs } = await merge({ p1: '1' }, { p1: '11' }, { p1: '11', p3: '3' });
		assert.strictEqual(plan.conflicts.length, 0);
		const result = compose(plan, docs);
		assert.ok(result.ok);
		assert.strictEqual(result.text, docText({ p1: '11', p3: '3' }));
	});

	test('deletes a parameter theirs removed and keeps the ours edit', async () => {
		const { plan, docs } = await merge({ p1: '1', p2: '2' }, { p1: '11', p2: '2' }, { p1: '1' });
		assert.strictEqual(plan.conflicts.length, 0);
		const result = compose(plan, docs);
		assert.ok(result.ok);
		assert.strictEqual(result.text, docText({ p1: '11' }));
	});

	test('a delete against a modification is a conflict resolved per side', async () => {
		const { plan, docs } = await merge({ p1: '1', p2: '2' }, { p1: '1' }, { p1: '1', p2: '22' });
		assert.strictEqual(plan.conflicts.length, 1);
		const conflict = plan.conflicts[0];
		assert.strictEqual(conflict.reason, 'delete-modify');
		assert.strictEqual(applyResolution(plan, conflict.id, 'theirs'), 0);
		const result = compose(plan, docs);
		assert.ok(result.ok);
		assert.strictEqual(result.text, docText({ p1: '1', p2: '22' }));
	});

	test('a container renamed on ours only merges without a conflict', async () => {
		const { plan, docs } = await merge(
			{ p1: '1', p2: '2' },
			{ p1: '11', p2: '2', container: 'Renamed' },
			{ p1: '1', p2: '2' }
		);
		assert.strictEqual(plan.conflicts.length, 0);
		const result = compose(plan, docs);
		assert.ok(result.ok);
		assert.strictEqual(result.text, docText({ p1: '11', p2: '2', container: 'Renamed' }));
	});

	test('the same new container name added on both sides with different children conflicts', async () => {
		const { plan, docs } = await merge(
			{ p1: '1', p2: '2' },
			{ p1: '11', p2: '2', container: 'Renamed' },
			{ p1: '1', p2: '22', container: 'Renamed' }
		);
		assert.strictEqual(plan.conflicts.length, 1);
		assert.strictEqual(plan.conflicts[0].reason, 'add-add');
		assert.strictEqual(applyResolution(plan, plan.conflicts[0].id, 'theirs'), 0);
		const result = compose(plan, docs);
		assert.ok(result.ok);
		assert.strictEqual(result.text, docText({ p1: '1', p2: '22', container: 'Renamed' }));
	});
});
