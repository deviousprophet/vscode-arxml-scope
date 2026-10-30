/**
 * The SW-SYSCOND evaluator (task design §2). Pure core: no editor, no DOM.
 *
 * These assertions drive the evaluator directly; the row propagation that uses
 * them is covered by `editor/conditions.test.ts`.
 */
import * as assert from 'assert';

import { ConditionValue, evaluateSyscond, parseConditionValue } from '../../core/ecuc/syscond';

function values(entries: Record<string, ConditionValue>): Map<string, ConditionValue> {
	return new Map(Object.entries(entries));
}

function stateOf(text: string, supplied: Record<string, ConditionValue> = {}): string {
	return evaluateSyscond(text, values(supplied)).state;
}

suite('SW-SYSCOND evaluator (design §2)', () => {
	test('design §2.1: literals, parentheses and comparisons', () => {
		assert.strictEqual(stateOf('(1==0)'), 'false');
		assert.strictEqual(stateOf('(1==1)'), 'true');
		assert.strictEqual(stateOf('1 != 1'), 'false');
		assert.strictEqual(stateOf('(1 < 2)'), 'true');
		assert.strictEqual(stateOf('(2 <= 2)'), 'true');
		assert.strictEqual(stateOf('(2 > 3)'), 'false');
		assert.strictEqual(stateOf('(3 >= 3)'), 'true');
		assert.strictEqual(stateOf('true'), 'true');
		assert.strictEqual(stateOf('FALSE'), 'false', 'boolean keywords are case-insensitive');
		assert.strictEqual(stateOf('!false'), 'true');
		assert.strictEqual(stateOf('!(1 == 1)'), 'false');
	});

	test('design §2.1: precedence is || < && < equality < relational < unary < primary', () => {
		// && binds tighter than ||.
		assert.strictEqual(stateOf('true || false && false'), 'true');
		assert.strictEqual(stateOf('(true || false) && false'), 'false');
		// Relational binds tighter than equality.
		assert.strictEqual(stateOf('1 < 2 == true'), 'true');
		assert.strictEqual(stateOf('(1 < 2) == true'), 'true');
		// Unary binds tighter than relational.
		assert.strictEqual(stateOf('!false == true'), 'true');
		// Parentheses can override every level.
		assert.strictEqual(stateOf('!((1 == 1) || (2 == 3))'), 'false');
	});

	test('design §2.2: three-valued logic', () => {
		assert.strictEqual(stateOf('false && UNKNOWN_SC'), 'false', 'false && unknown is false');
		assert.strictEqual(stateOf('UNKNOWN_SC && false'), 'false');
		assert.strictEqual(stateOf('true || UNKNOWN_SC'), 'true', 'true || unknown is true');
		assert.strictEqual(stateOf('UNKNOWN_SC || true'), 'true');
		assert.strictEqual(stateOf('UNKNOWN_SC && true'), 'unknown', 'otherwise an unknown operand wins');
		assert.strictEqual(stateOf('true && UNKNOWN_SC'), 'unknown');
		assert.strictEqual(stateOf('UNKNOWN_SC || false'), 'unknown');
		assert.strictEqual(stateOf('!UNKNOWN_SC'), 'unknown');
		assert.strictEqual(stateOf('UNKNOWN_SC == 1'), 'unknown');
	});

	test('design §2.2/§2.3: missing identifiers are reported and never coerce', () => {
		const result = evaluateSyscond('(A==1 && B!=2)', values({}));
		assert.strictEqual(result.state, 'unknown');
		assert.deepStrictEqual(result.symbols, ['A', 'B'], 'symbols are in source order');
		assert.deepStrictEqual(result.missing, ['A', 'B']);
		assert.strictEqual(result.error, undefined, 'missing is not a syntax/type error');

		const partial = evaluateSyscond('(A==1 || B==2)', values({ A: 1 }));
		assert.strictEqual(partial.state, 'true', 'a supplied operand can settle the result');
		assert.deepStrictEqual(partial.missing, ['B'], 'and the unresolved symbol is still reported');
	});

	test('design §2.3: lookup is exact first, then the last / segment', () => {
		assert.strictEqual(stateOf('(CANIPCORETYPE_SC==0)', { CANIPCORETYPE_SC: 1 }), 'false');
		assert.strictEqual(
			stateOf('(CANIPCORETYPE_SC==0)', { '/Pkg/SwSystemconsts/CANIPCORETYPE_SC': 1 }),
			'false',
			'a full-path value matches the tail-shaped identifier the scanner produces'
		);
		assert.strictEqual(
			stateOf('(CANIPCORETYPE_SC==0)', {
				'/PkgA/SwSystemconsts/CANIPCORETYPE_SC': 0,
				'/PkgB/SwSystemconsts/CANIPCORETYPE_SC': 1,
			}),
			'unknown',
			'an ambiguous tail stays unknown rather than guessing'
		);
		assert.strictEqual(
			stateOf('(/Pkg/SwSystemconsts/CANIPCORETYPE_SC==0)', { CANIPCORETYPE_SC: 1 }),
			'false',
			'a full-path condition matches a tail key'
		);
		assert.strictEqual(
			stateOf('(/Pkg/SwSystemconsts/CANIPCORETYPE_SC==0)', {
				'/Pkg/SwSystemconsts/CANIPCORETYPE_SC': 1,
			}),
			'false',
			'a pasted full path works exactly'
		);
		assert.strictEqual(
			stateOf('(CANIPCORETYPE_SC==1)', {
				CANIPCORETYPE_SC: 0,
				'/Pkg/SwSystemconsts/CANIPCORETYPE_SC': 1,
			}),
			'false',
			'an exact key wins over the tail key'
		);
		assert.strictEqual(
			stateOf('(OTHER_SC==1)', { CANIPCORETYPE_SC: 1 }),
			'unknown',
			'lookup never drops the last segment of a bare name'
		);
	});

	test('design §2.1: numeric, hex, float, boolean and quoted-string literals', () => {
		assert.strictEqual(stateOf('(0x10 == 16)'), 'true');
		assert.strictEqual(stateOf('(0X10 == 16)'), 'true');
		assert.strictEqual(stateOf('(-1 < 0)'), 'true');
		assert.strictEqual(stateOf('(+2 == 2)'), 'true');
		assert.strictEqual(stateOf('(1.5 > 1)'), 'true');
		assert.strictEqual(stateOf('(.5 < 1)'), 'true');
		assert.strictEqual(stateOf('(1. == 1)'), 'true');
		assert.strictEqual(stateOf('(true == TRUE)'), 'true');
		assert.strictEqual(stateOf('(true != false)'), 'true');
		assert.strictEqual(stateOf('("a" == \'a\')'), 'true');
		assert.strictEqual(stateOf('("a" != "b")'), 'true');
		assert.strictEqual(stateOf('("a b" == "a b")'), 'true');
	});

	test('design §2.2: mixed types are unknown, never a silent disable', () => {
		const numberString = evaluateSyscond('(1 == "1")', values({}));
		assert.strictEqual(numberString.state, 'unknown');
		assert.ok(numberString.error, 'the comparison has a reason');
		assert.ok(numberString.error!.includes('number') && numberString.error!.includes('string'), numberString.error);

		const booleanNumber = evaluateSyscond('(true == 1)', values({}));
		assert.strictEqual(booleanNumber.state, 'unknown');

		const textOrder = evaluateSyscond('("a" < "b")', values({}));
		assert.strictEqual(textOrder.state, 'unknown');
		assert.ok(textOrder.error!.includes('requires numbers'), textOrder.error);
	});

	test('design §2.1: malformed and empty expressions are unknown with a reason', () => {
		for (const text of ['(A==', 'A B', '(', ')', '1 + 2', '1 == == 1', '"unterminated', '']) {
			const result = evaluateSyscond(text, values({ A: 1 }));
			assert.strictEqual(result.state, 'unknown', text);
			assert.ok(result.error, `a reason is reported for ${JSON.stringify(text)}`);
		}
		const empty = evaluateSyscond('   ', values({}));
		assert.strictEqual(empty.state, 'unknown');
		assert.ok(empty.error);
	});

	test('design §2.4: parseConditionValue classifies one raw value', () => {
		assert.strictEqual(parseConditionValue('true'), true);
		assert.strictEqual(parseConditionValue('TRUE'), true);
		assert.strictEqual(parseConditionValue('False'), false);
		assert.strictEqual(parseConditionValue('0x10'), 16);
		assert.strictEqual(parseConditionValue('-0x10'), -16);
		assert.strictEqual(parseConditionValue('42'), 42);
		assert.strictEqual(parseConditionValue('-2'), -2);
		assert.strictEqual(parseConditionValue('1.5'), 1.5);
		assert.strictEqual(parseConditionValue('.5'), 0.5);
		assert.strictEqual(parseConditionValue('"quoted text"'), 'quoted text');
		assert.strictEqual(parseConditionValue("'single'"), 'single');
		assert.strictEqual(parseConditionValue('"a\\"b"'), 'a"b');
		assert.strictEqual(parseConditionValue('plain text'), 'plain text');
		assert.strictEqual(parseConditionValue('  padded  '), 'padded');
		assert.strictEqual(parseConditionValue('"unclosed'), '"unclosed', 'an unmatched quote stays literal');
	});
});
