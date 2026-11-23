import * as assert from 'assert';

import { localValueError } from '../../core/ecuc/valueValidation';
import { isXmlRepresentable } from '../../core/ecuc/validate';

const integer = { kind: 'parameter' as const, parameterType: 'Integer' };
const float = { kind: 'parameter' as const, parameterType: 'Float' };
const boolean = { kind: 'parameter' as const, parameterType: 'Boolean' };
const textual = { kind: 'parameter' as const, parameterType: 'String' };
const container = { kind: 'container' as const, parameterType: undefined };

type ValueRow = Parameters<typeof localValueError>[0];

/** Assert every value is accepted, with a per-value message. */
function assertAllValid(
	row: ValueRow,
	field: string,
	values: readonly string[],
	describe: (value: string) => string
): void {
	for (const value of values) {
		assert.strictEqual(localValueError(row, field, value), undefined, describe(value));
	}
}

/** Assert every value is rejected with `expected`, with a per-value message. */
function assertAllInvalid(
	row: ValueRow,
	field: string,
	values: readonly string[],
	expected: string,
	describe: (value: string) => string
): void {
	for (const value of values) {
		assert.strictEqual(localValueError(row, field, value), expected, describe(value));
	}
}

suite('ECUC local value validation', () => {
	test('Integer accepts decimal, hexadecimal and binary, and rejects intermediates', () => {
		for (const value of ['0', '42', '-42', '-7', '0xFF', '0X1f', '0b1010', '-0x1']) {
			assert.strictEqual(localValueError(integer, 'value', value), undefined, `${value} is a valid integer`);
		}
		for (const value of ['', '-', '+', '+7', '0x', '0b', '0b2', 'tru', '1.0', ' 42']) {
			assert.strictEqual(localValueError(integer, 'value', value), 'Invalid integer value', `"${value}" is invalid`);
		}
	});

	test('Float follows the host decimal/fraction/exponent grammar', () => {
		for (const value of ['0', '1', '-2', '3.25', '1.5e-3', '-1E+10', '1e3']) {
			assert.strictEqual(localValueError(float, 'value', value), undefined, `${value} is a valid float`);
		}
		for (const value of ['', '-', '.', '1.', '.5', '+3', '1e', '0x', 'Infinity', 'NaN', '1,5']) {
			assert.strictEqual(localValueError(float, 'value', value), 'Invalid float value', `"${value}" is invalid`);
		}
	});

	test('Boolean accepts only lowercase true/false and rejects partial typing', () => {
		for (const value of ['true', 'false']) {
			assert.strictEqual(localValueError(boolean, 'value', value), undefined, `${value} is a valid boolean`);
		}
		for (const value of ['', 'tru', 'fals', 'TRUE', 'False', '1', 'yes']) {
			assert.strictEqual(localValueError(boolean, 'value', value), 'Invalid boolean value', `"${value}" is invalid`);
		}
	});

	test('a textual value is valid when empty and keeps quotes as content', () => {
		for (const value of ['', 'hello', 'say "hi"', 'a\\nb']) {
			assert.strictEqual(localValueError(textual, 'value', value), undefined);
		}
	});

	test('short names and definition refs follow the host grammar', () => {
		assertAllValid(
			container,
			'shortName',
			['BranchX123456', '_internal', 'a1'],
			(value) => `${value} is a valid short name`
		);
		assertAllInvalid(
			container,
			'shortName',
			['', '1abc', 'a-b', 'a b', 'a/b', 'a.b'],
			'Invalid short name',
			(value) => `"${value}" is invalid`
		);
		assertAllValid(container, 'definitionRef', ['/P/M/C', '/A_B/C1'], (value) => `${value} is an absolute path`);
		assertAllInvalid(
			container,
			'definitionRef',
			['', '/', 'P/M', '/P//M', '/P/M ', '/P/M&', '/P/M<', '/P/M"'],
			'Invalid definition reference',
			(value) => `"${value}" is invalid`
		);
		assert.strictEqual(localValueError(container, 'shortName', 'bad\u0001name'), 'XML cannot represent this character');
		assert.strictEqual(isXmlRepresentable('ok'), true);
		assert.strictEqual(isXmlRepresentable('tab\tnewline\n'), true, 'tab and newline are representable');
		assert.strictEqual(isXmlRepresentable('\u0000'), false);
		assert.strictEqual(localValueError(textual, 'value', '\u0000'), 'XML cannot represent this character');
	});
});
