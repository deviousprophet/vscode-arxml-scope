/**
 * AC13 — two sibling containers that share a `SHORT-NAME` must not share an identifier,
 * or a reveal or an edit can land on the wrong one.
 *
 * The fixture is synthetic (`src/test/fixtures/editor/sibling-collision.arxml`): two
 * `Twin` containers, each with its own `Mark` parameter (1 / 2) and its own nested `Leaf`
 * (11 / 22), so an id that resolves to the wrong node is visible in the value it slices.
 * The disambiguating ordinal is computed from the raw model's document order, which is
 * what makes the ids independent of the sort setting.
 */
import * as assert from 'assert';

import { ContainerNode, EcucDocumentModel } from '../../core/ecuc/model';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { innermostNodeIdAt } from '../../host/navigation';
import { buildNodeIndex } from '../../core/ecuc/nodeId';
import { buildRows } from '../../core/ecuc/renderRows';
import { fixtureText, slice } from '../core/modelTestUtils';

const FIXTURE = 'editor/sibling-collision.arxml';
/** Declaration order deliberately opposite to the order `sort all` produces. */
const SORT_FIXTURE = 'editor/sibling-sort-order.arxml';

/** The two sibling containers the fixture exists for. */
function twins(model: EcucDocumentModel): [ContainerNode, ContainerNode] {
	const found = model.modules[0].containers.filter((container) => container.shortName === 'Twin');
	assert.strictEqual(found.length, 2, 'the fixture has two sibling Twins');
	return [found[0], found[1]];
}

suite('editor node identity (AC13)', () => {
	test('AC13: two siblings sharing a SHORT-NAME get distinct ids, from the document order', () => {
		const model = scanEcucValues(fixtureText(FIXTURE));
		const index = buildNodeIndex(model);
		const [first, second] = twins(model);
		const a = index.idOf(first);
		const b = index.idOf(second);

		assert.ok(a && b, 'both twins are indexed');
		assert.notStrictEqual(a, b, 'the shared short-name is not the whole id');
		assert.ok(a!.startsWith('container:') && b!.startsWith('container:'), 'the kind and path are kept');
		assert.ok(a!.endsWith('#0') && b!.endsWith('#1'), `the ordinal is the declaration order: ${a} / ${b}`);
		assert.strictEqual(index.byId.size, 9, 'every node of the fixture is indexed exactly once');
	});

	test('AC13: each twin resolves to its own range, its own value and its own reveal', () => {
		const text = fixtureText(FIXTURE);
		const model = scanEcucValues(text);
		const index = buildNodeIndex(model);
		const [first, second] = twins(model);
		const a = index.idOf(first)!;
		const b = index.idOf(second)!;

		assert.ok(slice(text, index.byId.get(a)!.range).includes('<VALUE>1</VALUE>'), 'the first twin');
		assert.ok(slice(text, index.byId.get(b)!.range).includes('<VALUE>2</VALUE>'), 'the second twin');

		// A reveal is an offset → id lookup, so this is the mapping a click on either one
		// uses; if the ids collided it would land on whichever the map kept.
		assert.strictEqual(innermostNodeIdAt(index, first.shortNameRange!.start + 1), a);
		assert.strictEqual(innermostNodeIdAt(index, second.shortNameRange!.start + 1), b);
	});

	test('AC13: the collision is disambiguated at every level, not just the top one', () => {
		const text = fixtureText(FIXTURE);
		const model = scanEcucValues(text);
		const index = buildNodeIndex(model);
		const [first, second] = twins(model);
		const [leftLeaf, rightLeaf] = [first.containers[0], second.containers[0]];
		assert.strictEqual(leftLeaf.shortName, 'Leaf');
		assert.strictEqual(rightLeaf.shortName, 'Leaf');

		const leafA = index.idOf(leftLeaf)!;
		const leafB = index.idOf(rightLeaf)!;
		assert.notStrictEqual(leafA, leafB, 'the nested twins are distinct too');
		assert.ok(slice(text, index.byId.get(leafA)!.range).includes('<VALUE>11</VALUE>'));
		assert.ok(slice(text, index.byId.get(leafB)!.range).includes('<VALUE>22</VALUE>'));

		const parameterA = index.idOf(leftLeaf.parameters[0])!;
		const parameterB = index.idOf(rightLeaf.parameters[0])!;
		assert.notStrictEqual(parameterA, parameterB, 'and so are their parameters');
		assert.ok(slice(text, index.byId.get(parameterA)!.range).includes('<VALUE>11</VALUE>'));
		assert.ok(slice(text, index.byId.get(parameterB)!.range).includes('<VALUE>22</VALUE>'));
	});

	test('AC13: the ids are unchanged by the sort setting', () => {
		const model = scanEcucValues(fixtureText(FIXTURE));
		const [first, second] = twins(model);
		const before = buildNodeIndex(model);
		const keys = [...before.byId.keys()];
		const a = before.idOf(first)!;
		const b = before.idOf(second)!;

		buildRows(model, { sort: 'all' });
		buildRows(model, { sort: 'declaration' });

		const after = buildNodeIndex(model);
		assert.deepStrictEqual([...after.byId.keys()], keys, 'ordering is pure: the ids did not move');
		assert.strictEqual(after.idOf(first), a, 'the first twin keeps its id');
		assert.strictEqual(after.idOf(second), b, 'and the second keeps its own');

		for (const rows of [
			buildRows(model, { sort: 'all' }).rows,
			buildRows(model, { sort: 'declaration' }).rows,
		]) {
			assert.ok(rows.some((row) => row.id === a) && rows.some((row) => row.id === b));
		}
	});

	test('AC13: the ordinal follows the document order, not the displayed order', () => {
		// This fixture is the one that can tell the two apart: its two `Twin` siblings
		// share a SHORT-NAME and are declared in the opposite order to the one `sort all`
		// puts them in, so an implementation that numbered the containers *after* ordering
		// them would hand `#0` to the other sibling. The collision fixture above cannot
		// show that, because its twins sort to the order they are declared in.
		const model = scanEcucValues(fixtureText(SORT_FIXTURE));
		const [declaredFirst, declaredSecond] = model.modules[0].containers;
		assert.strictEqual(declaredFirst.shortName, 'Twin');
		assert.strictEqual(declaredSecond.shortName, 'Twin');
		assert.ok(declaredFirst.definitionRef.endsWith('/Zeta'), 'the first declared sorts last');
		assert.ok(declaredSecond.definitionRef.endsWith('/Alpha'), 'the second declared sorts first');

		const index = buildNodeIndex(model);
		const a = index.idOf(declaredFirst)!;
		const b = index.idOf(declaredSecond)!;
		assert.ok(a.endsWith('#0'), `the declaration order numbers them: ${a}`);
		assert.ok(b.endsWith('#1'), `and the second declared is #1: ${b}`);

		// The display order really is the other way round, which is what makes the
		// assertion above falsifiable rather than a restatement of the input.
		const at = (rows: readonly { id: string }[], id: string): number => rows.findIndex((row) => row.id === id);
		const byDeclaration = buildRows(model, { sort: 'declaration' }).rows;
		const sorted = buildRows(model, { sort: 'all' }).rows;
		assert.ok(at(byDeclaration, a) < at(byDeclaration, b), 'declaration order shows the first twin first');
		assert.ok(at(sorted, b) < at(sorted, a), 'the sorted order shows them the other way round');

		// …and neither render moved an id: the ordinal is the model's, not the view's.
		const rebuilt = buildNodeIndex(model);
		assert.strictEqual(rebuilt.idOf(declaredFirst), a, 'the id does not follow the displayed order');
		assert.strictEqual(rebuilt.idOf(declaredSecond), b);
	});

	test('AC13: the ids are unchanged by a re-scan, including one that edits a twin', () => {
		const text = fixtureText(FIXTURE);
		const before = buildNodeIndex(scanEcucValues(text));
		const a = [...before.byId.keys()][1];
		const edited = text.replace('<VALUE>1</VALUE>', '<VALUE>123456</VALUE>');
		assert.notStrictEqual(edited, text, 'the fixture really holds the value being edited');

		const after = buildNodeIndex(scanEcucValues(edited));
		assert.deepStrictEqual([...after.byId.keys()], [...before.byId.keys()], 'the same ids, in the same order');
		assert.ok(
			slice(edited, after.byId.get(a)!.range).includes('<VALUE>123456</VALUE>'),
			'and the id still points at the edited node, not at its twin'
		);
	});
});
