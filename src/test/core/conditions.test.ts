/**
 * Row integration of the evaluated SW-SYSCOND (task design §4, AC1–AC5/AC7/AC11).
 *
 * `buildRows` is the only place a condition is evaluated. The assertions below
 * are on the row values, not on markup: the page just renders `condition`,
 * `disabled` and `disabledBy`.
 */
import * as assert from 'assert';

import { ConditionValue, evaluateSyscond } from '../../core/ecuc/syscond';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { parseConditionEntries } from '../../host/conditionValues';
import { EcucRow, buildRows } from '../../core/ecuc/renderRows';
import { fixtureText } from '../core/modelTestUtils';

const FIXTURE = 'editor/syscond.arxml';

function rows(supplied: Record<string, ConditionValue> = {}): EcucRow[] {
	return buildRows(scanEcucValues(fixtureText(FIXTURE)), {
		conditions: new Map<string, ConditionValue>(Object.entries(supplied)),
	}).rows;
}

function rowNamed(all: readonly EcucRow[], label: string): EcucRow {
	const row = all.find((candidate) => candidate.label === label);
	assert.ok(row, `${label} is a row`);
	return row;
}

function conditionPart(row: EcucRow): EcucRow['meta'][number] | undefined {
	return row.meta.find((part) => part.cls === 'condition' && part.text === `[${row.condition?.text}]`);
}

suite('condition rows (design §4)', () => {
	test('AC1: a false parameter condition disables only that parameter', () => {
		const all = rows({ CANIPCORETYPE_SC: 1 });
		const selfOff = rowNamed(all, 'SelfOff');
		assert.strictEqual(selfOff.condition?.text, '(CANIPCORETYPE_SC==0)');
		assert.strictEqual(selfOff.condition?.state, 'false');
		assert.strictEqual(selfOff.disabled, true);
		assert.strictEqual(selfOff.disabledBy, 'self');

		const sibling = rowNamed(all, 'Sibling');
		assert.strictEqual(sibling.disabled, undefined, 'an unconditioned sibling stays normal');
		assert.strictEqual(rowNamed(all, 'ContA').disabled, undefined, 'the parent container stays normal');
		assert.deepStrictEqual(selfOff.condition?.symbols, ['CANIPCORETYPE_SC'], 'the evaluator symbols travel on the row');
		assert.deepStrictEqual(
			rowNamed(rows({}), 'LiteralOff').condition?.symbols,
			[],
			'a literal-only condition has no symbols'
		);
	});

	test('AC1: the same condition is true (and not disabled) with 0', () => {
		const all = rows({ CANIPCORETYPE_SC: 0 });
		const selfOff = rowNamed(all, 'SelfOff');
		assert.strictEqual(selfOff.condition?.state, 'true');
		assert.strictEqual(selfOff.disabled, false);
		assert.strictEqual(selfOff.disabledBy, undefined);
	});

	test('AC2: a false container disables its whole subtree, ancestor wins', () => {
		const all = rows({ CANIPCORETYPE_SC: 1 });
		const contB = rowNamed(all, 'ContB');
		assert.strictEqual(contB.condition?.state, 'false');
		assert.strictEqual(contB.disabledBy, 'self');

		for (const label of ['InsideNoCond', 'InsideTrue']) {
			const descendant = rowNamed(all, label);
			assert.strictEqual(descendant.disabled, true, `${label} is dimmed by its container`);
			assert.strictEqual(descendant.disabledBy, 'ancestor');
		}
		const insideTrue = rowNamed(all, 'InsideTrue');
		assert.strictEqual(insideTrue.condition?.state, 'true', 'a true child condition does not re-enable it');

		const contA = rowNamed(all, 'ContA');
		assert.strictEqual(contA.disabled, undefined, 'the ancestor container itself is unaffected');
	});

	test('AC2: a false module disables every row below it', () => {
		const all = rows({ CANIPCORETYPE_SC: 1 });
		const moduleRow = rowNamed(all, 'Pkg.ModDefs.ModCond');
		assert.strictEqual(moduleRow.kind, 'module');
		assert.strictEqual(moduleRow.condition?.state, 'false');
		assert.strictEqual(moduleRow.disabledBy, 'self');
		for (const label of ['UnderMod', 'UnderModParam']) {
			const descendant = rowNamed(all, label);
			assert.strictEqual(descendant.disabled, true, label);
			assert.strictEqual(descendant.disabledBy, 'ancestor');
		}
	});

	test('AC1/AC2: a true condition dims neither itself nor its subtree, and the same nodes dim when it turns false', () => {
		const on = rows({ CANIPCORETYPE_SC: 1 });
		for (const label of ['TrueCond', 'ContTrue', 'Plain']) {
			assert.notStrictEqual(rowNamed(on, label).disabled, true, `${label} stays normal with a true condition`);
		}
		assert.strictEqual(rowNamed(on, 'ContTrue').condition?.state, 'true');
		assert.strictEqual(rowNamed(on, 'TrueCond').condition?.state, 'true');

		const off = rows({ CANIPCORETYPE_SC: 0 });
		const trueCond = rowNamed(off, 'TrueCond');
		assert.strictEqual(trueCond.disabled, true, 'the parameter dims on its own false condition');
		assert.strictEqual(trueCond.disabledBy, 'self');
		const contTrue = rowNamed(off, 'ContTrue');
		assert.strictEqual(contTrue.disabled, true, 'the container dims on its own false condition');
		assert.strictEqual(contTrue.disabledBy, 'self');
		const plain = rowNamed(off, 'Plain');
		assert.strictEqual(plain.disabled, true, 'the unconditioned child inherits the container');
		assert.strictEqual(plain.disabledBy, 'ancestor');
	});

	test('AC3: a false reference condition disables only the reference', () => {
		const all = rows({ CANIPCORETYPE_SC: 1 });
		const ref = rowNamed(all, 'RefOff');
		assert.strictEqual(ref.kind, 'reference');
		assert.strictEqual(ref.disabled, true);
		assert.strictEqual(ref.disabledBy, 'self');
		assert.strictEqual(rowNamed(all, 'Sibling').disabled, undefined);
	});

	test('AC4: a missing constant is unknown, lists every missing symbol and dims nothing', () => {
		const all = rows({});
		const missing = rowNamed(all, 'Missing');
		assert.strictEqual(missing.condition?.state, 'unknown');
		assert.deepStrictEqual(missing.condition?.missing, ['MISSING_SC']);
		assert.ok(missing.condition?.reason?.includes('MISSING_SC'), missing.condition?.reason);
		assert.notStrictEqual(missing.disabled, true, 'unknown never dims');
		assert.strictEqual(conditionPart(missing)?.state, 'unknown');
	});

	test('AC5: a malformed condition is unknown with a syntax reason and dims nothing', () => {
		const malformed = rowNamed(rows({ A: 1 }), 'Malformed');
		assert.strictEqual(malformed.condition?.state, 'unknown');
		assert.ok(malformed.condition?.reason, 'a syntax reason is reported');
		assert.notStrictEqual(malformed.disabled, true, 'unknown never dims');
	});

	test('AC7/AC11: a literal false disables even with no values; unknown never does', () => {
		const all = rows({});
		const literal = rowNamed(all, 'LiteralOff');
		assert.strictEqual(literal.condition?.state, 'false');
		assert.strictEqual(literal.disabled, true);
		assert.strictEqual(literal.disabledBy, 'self');

		for (const label of ['SelfOff', 'ContB', 'RefOff', 'Pkg.ModDefs.ModCond']) {
			assert.notStrictEqual(rowNamed(all, label).disabled, true, `${label} is not dimmed by an unknown`);
		}
	});

	test('AC2: an empty discovered value is unknown and never disables a row', () => {
		const parsed = parseConditionEntries([
			{ name: 'CANIPCORETYPE_SC', value: '' },
			{ name: 'MISSING_SC', value: '' },
		]);
		assert.deepStrictEqual(
			parsed.entries,
			[
				{ name: 'CANIPCORETYPE_SC', value: '' },
				{ name: 'MISSING_SC', value: '' },
			],
			'the discovered entries stay visible'
		);
		const all = buildRows(scanEcucValues(fixtureText(FIXTURE)), { conditions: parsed.values }).rows;
		for (const label of ['SelfOff', 'ContB', 'RefOff', 'Pkg.ModDefs.ModCond', 'Missing']) {
			const row = rowNamed(all, label);
			assert.strictEqual(row.condition?.state, 'unknown', `${label} is unknown without a value`);
			assert.notStrictEqual(row.disabled, true, `${label} is not dimmed`);
		}
		assert.strictEqual(rowNamed(all, 'LiteralOff').disabled, true, 'a literal condition still evaluates');
	});

	test('AC11: with no values the symbolic conditions are unknown and nothing else changes', () => {
		const all = rows({});
		for (const row of all) {
			if (row.condition === undefined) {
				assert.strictEqual(row.disabled, undefined, row.label);
			}
		}
		const labels = all.map((row) => row.label);
		assert.deepStrictEqual(labels.slice(0, 1), ['Pkg.ModDefs.ModCond'], 'display order is untouched');
	});

	test('the condition chip carries the evaluated state and its input values as the title', () => {
		const trueRow = rowNamed(rows({ CANIPCORETYPE_SC: 0 }), 'SelfOff');
		assert.strictEqual(conditionPart(trueRow)?.state, 'true');
		assert.strictEqual(conditionPart(trueRow)?.text, '[(CANIPCORETYPE_SC==0)]');
		assert.strictEqual(conditionPart(trueRow)?.title, 'CANIPCORETYPE_SC = 0');

		const falseRow = rowNamed(rows({ CANIPCORETYPE_SC: 1 }), 'SelfOff');
		assert.strictEqual(conditionPart(falseRow)?.state, 'false');
		assert.strictEqual(conditionPart(falseRow)?.title, 'CANIPCORETYPE_SC = 1');

		const unknownRow = rowNamed(rows({}), 'Missing');
		assert.strictEqual(conditionPart(unknownRow)?.title, 'MISSING_SC = (not set)');

		const malformed = rowNamed(rows({}), 'Malformed');
		assert.ok(conditionPart(malformed)?.title.includes('A = (not set)'), conditionPart(malformed)?.title);
	});

	test('AC1: the fixture reports the manual CANIPCORETYPE_SC case the design names', () => {
		const withOne = rowNamed(rows({ CANIPCORETYPE_SC: 1 }), 'SelfOff');
		assert.strictEqual(withOne.condition?.state, 'false');
		assert.strictEqual(withOne.disabled, true);
		const withZero = rowNamed(rows({ CANIPCORETYPE_SC: 0 }), 'SelfOff');
		assert.strictEqual(withZero.condition?.state, 'true');
		assert.strictEqual(withZero.disabled, false);

		// The exact condition text the fixture stores is the one the PRD names.
		const source = fixtureText(FIXTURE);
		assert.ok(source.includes('<SW-SYSCOND>(CANIPCORETYPE_SC==0)</SW-SYSCOND>'));
		assert.deepStrictEqual(evaluateSyscond('(CANIPCORETYPE_SC==0)', new Map([['CANIPCORETYPE_SC', 1]])).state, 'false');
	});

	test('manual sanity check: 1 dims the conditioned container and its subtree; 0 restores them', () => {
		const on = rows({ CANIPCORETYPE_SC: 1 });
		const contB = rowNamed(on, 'ContB');
		assert.strictEqual(contB.condition?.text, '(CANIPCORETYPE_SC==0)');
		assert.strictEqual(contB.disabled, true, 'the conditioned container row is disabled');
		const at = on.indexOf(contB);
		const descendants = on.slice(at + 1, at + 1 + contB.subtreeSize);
		assert.ok(descendants.length > 0, 'the fixture has a subtree under it');
		for (const descendant of descendants) {
			assert.strictEqual(descendant.disabled, true, `${descendant.label} is disabled with the container`);
		}

		const off = rows({ CANIPCORETYPE_SC: 0 });
		const restored = rowNamed(off, 'ContB');
		assert.strictEqual(restored.disabled, false, 'the container row returns');
		assert.notStrictEqual(rowNamed(off, 'InsideNoCond').disabled, true, 'the unconditioned descendant returns');
		const insideTrue = rowNamed(off, 'InsideTrue');
		assert.strictEqual(insideTrue.condition?.state, 'false', 'its own condition is false with 0');
		assert.strictEqual(insideTrue.disabledBy, 'self', 'so it remains disabled on its own');
	});
});
