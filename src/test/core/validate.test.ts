import * as assert from 'assert';

import { ParameterNode } from '../../core/ecuc/model';
import { escapeXml, isNumericLiteral, validateValue } from '../../core/ecuc/validate';

function parameter(numeric: boolean, displayValue: string, definitionDest?: string): ParameterNode {
	return {
		kind: 'parameter',
		numeric,
		definitionDest,
		definitionRef: '/D/C/Value',
		name: 'Value',
		displayValue,
		range: { start: 0, end: 0 },
	};
}

suite('validate (core)', () => {
	test('AC8: numerical literals are accepted', () => {
		const accepted = ['true', 'false', '0', '63', '-7', '0x3F', '0Xff', '3.5', '-3.5', '3.5e10', '1.0E-3'];
		for (const value of accepted) {
			const result = validateValue(parameter(true, 'unrelated'), value);
			assert.deepStrictEqual(result, { ok: true, text: value }, value);
			assert.strictEqual(isNumericLiteral(value), true, value);
		}
	});

	test('AC8: other forms are refused for a numerical parameter', () => {
		const refused = ['', 'abc', '1.5.2', '0x', '0xG1', 'trueish', ' 1', '1 ', '1e5', '+1', '1,5', '- 1', 'NaN', '0b1010'];
		for (const value of refused) {
			const result = validateValue(parameter(true, 'unrelated'), value);
			assert.strictEqual(result.ok, false, value);
			assert.strictEqual(isNumericLiteral(value), false, value);
		}
	});

	test('AC8: a textual parameter accepts any XML-representable string', () => {
		assert.deepStrictEqual(validateValue(parameter(false, 'unrelated'), 'anything at all'), {
			ok: true,
			text: 'anything at all',
		});
		assert.deepStrictEqual(validateValue(parameter(false, 'x'), ''), { ok: true, text: '' });
		assert.deepStrictEqual(validateValue(parameter(false, 'x'), '1.5.2'), { ok: true, text: '1.5.2' });
		assert.strictEqual(validateValue(parameter(false, 'x'), '\t tab and \n newline').ok, true);
	});

	test('AC8: AUTOSAR DEST types narrow the accepted literals', () => {
		const integer = parameter(true, 'unrelated', 'ECUC-INTEGER-PARAM-DEF');
		for (const value of ['0', '63', '-7', '0x3F', '0b00111111', '-0b10']) {
			assert.strictEqual(validateValue(integer, value).ok, true, value);
		}
		for (const value of ['1.5', '1e5', 'true', 'abc', '0x']) {
			assert.strictEqual(validateValue(integer, value).ok, false, value);
		}

		const float = parameter(true, 'unrelated', 'ECUC-FLOAT-PARAM-DEF');
		for (const value of ['0', '1', '1.5', '-3.5', '1e5', '3.5e10']) {
			assert.strictEqual(validateValue(float, value).ok, true, value);
		}
		for (const value of ['0x3F', '0b11', 'true', 'abc']) {
			assert.strictEqual(validateValue(float, value).ok, false, value);
		}

		const boolean = parameter(true, 'unrelated', 'ECUC-BOOLEAN-PARAM-DEF');
		assert.strictEqual(validateValue(boolean, 'true').ok, true);
		assert.strictEqual(validateValue(boolean, 'false').ok, true);
		for (const value of ['TRUE', 'False', '1', '0x1', 'yes']) {
			assert.strictEqual(validateValue(boolean, value).ok, false, value);
		}

		const text = parameter(false, 'unrelated', 'ECUC-STRING-PARAM-DEF');
		assert.strictEqual(validateValue(text, 'anything at all').ok, true);
		assert.strictEqual(validateValue(text, '1.5.2').ok, true);
	});

	test('AC8: an unchanged value is refused', () => {
		assert.deepStrictEqual(validateValue(parameter(true, '63'), '63'), {
			ok: false,
			reason: 'the value is unchanged',
		});
		assert.deepStrictEqual(validateValue(parameter(false, 'hello'), 'hello'), {
			ok: false,
			reason: 'the value is unchanged',
		});
		// A self-closing `<VALUE/>` has an empty display value, so `''` is unchanged.
		assert.strictEqual(validateValue(parameter(true, ''), '').ok, false);
	});

	test('AC8: the escaped text to write is reported', () => {
		assert.deepStrictEqual(validateValue(parameter(false, 'unrelated'), 'a & b < c > d'), {
			ok: true,
			text: 'a &amp; b &lt; c &gt; d',
		});
		// Escaping is not doubled, and `&` is escaped first.
		assert.deepStrictEqual(validateValue(parameter(false, 'unrelated'), 'a&amp;b'), {
			ok: true,
			text: 'a&amp;amp;b',
		});
		assert.strictEqual(escapeXml('<&>'), '&lt;&amp;&gt;');
	});

	test('AC8: characters XML cannot represent are refused', () => {
		for (const value of ['\u0000', '\u0001', '\u000b', '\u001f', '\uFFFE']) {
			const result = validateValue(parameter(false, 'unrelated'), value);
			assert.strictEqual(result.ok, false, JSON.stringify(value));
			assert.strictEqual(validateValue(parameter(true, 'unrelated'), value).ok, false, JSON.stringify(value));
		}
		// Tab, newline and carriage return remain legal.
		assert.strictEqual(validateValue(parameter(false, 'unrelated'), '\r\n\t').ok, true);
	});
});
