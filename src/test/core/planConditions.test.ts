/**
 * Plan rows COND-01, 02, 05, 06 from `docs/TEST_PLAN.md`.
 *
 * COND-03 (both ambiguous candidates listed) and COND-04 (a cap notice for the
 * 201st entry) are re-scoped: the evaluator reports the symbol as missing and
 * `parseConditionEntries` drops the overflow silently. Both are recorded in the
 * plan's known gaps instead of being asserted as shipped.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { ConditionValue, evaluateSyscond } from '../../core/ecuc/syscond';

function values(entries: Record<string, ConditionValue>): Map<string, ConditionValue> {
	return new Map(Object.entries(entries));
}

suite('plan coverage: COND', () => {
	test('COND-01 !(A) && B and !A && B agree; unary binds tighter', () => {
		for (const [a, b] of [
			[false, true],
			[true, true],
			[true, false],
			[false, false]
		]) {
			const supplied = values({ A: a, B: b });
			assert.strictEqual(evaluateSyscond('!(A) && B', supplied).state, evaluateSyscond('!A && B', supplied).state);
		}
		assert.strictEqual(evaluateSyscond('!A && B', values({ A: false, B: true })).state, 'true');
		assert.strictEqual(evaluateSyscond('!(A && B)', values({ A: false, B: true })).state, 'true');
	});

	test('COND-02 string/number and boolean/number comparisons are unknown', () => {
		for (const text of ['"1" == 1', 'true == 1', '1 != "1"', 'false < 1']) {
			const result = evaluateSyscond(text, values({}));
			assert.strictEqual(result.state, 'unknown', text);
			assert.ok(result.error, `${text} carries a reason`);
		}
		// Both numeric spellings are numbers, so this equality is true, not mixed.
		assert.strictEqual(evaluateSyscond('1 == 1.0', values({})).state, 'true');
	});

	test('COND-05 quoted escapes decode; an unterminated quote is a parse reason', () => {
		const quoted = evaluateSyscond('"a\\"b" == "a\\"b"', values({}));
		assert.strictEqual(quoted.state, 'true');
		const unterminated = evaluateSyscond('"abc', values({}));
		assert.strictEqual(unterminated.state, 'unknown');
		assert.strictEqual(unterminated.error, 'unterminated string');
	});

	test('COND-06 a raw &amp; entity is decoded before evaluation', () => {
		const text = `<?xml version="1.0"?><AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/M</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/C</DEFINITION-REF><SW-SYSCOND>(1 == 1) &amp;&amp; (2 == 2)</SW-SYSCOND></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const condition = scanEcucValues(text).modules[0].containers[0].syscond;
		assert.strictEqual(condition, '(1 == 1) && (2 == 2)');
		assert.strictEqual(evaluateSyscond(condition!, values({})).state, 'true');
	});
});
