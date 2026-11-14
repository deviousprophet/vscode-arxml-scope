/**
 * Plan rows ROW-01…09 from `docs/TEST_PLAN.md` (ROW-06 and ROW-08 stay open:
 * annotation shape and the tail-exception ordering need their own fixtures).
 */
import * as assert from 'assert';

import { EcucRow, buildRows, parameterFormats } from '../../core/ecuc/renderRows';
import { scanEcucValues } from '../../core/ecuc/scanner';

function doc(elements: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>\n<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS>${elements}</ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
}

function module(containers: string, name = 'M'): string {
	return `<ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>${name}</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/${name}</DEFINITION-REF><CONTAINERS>${containers}</CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES>`;
}

function container(name: string, body = ''): string {
	return `<ECUC-CONTAINER-VALUE><SHORT-NAME>${name}</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/${name}</DEFINITION-REF>${body}</ECUC-CONTAINER-VALUE>`;
}

function numeric(name: string, value: string, dest = 'ECUC-INTEGER-PARAM-DEF'): string {
	return `<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="${dest}">/P/${name}</DEFINITION-REF><VALUE>${value}</VALUE></ECUC-NUMERICAL-PARAM-VALUE>`;
}

function rowsOf(text: string): EcucRow[] {
	return buildRows(scanEcucValues(text), { sort: 'all' }).rows;
}

suite('plan coverage: ROW', () => {
	test('ROW-01 negative, hex, binary, 64-bit and padded values format exactly', () => {
		const formats = (value: string) => parameterFormats(value, 'Numeric').map((entry) => `${entry.label}=${entry.value}`);
		assert.deepStrictEqual(formats('-5'), ['Decimal=-5', 'Hexadecimal=-0x05', 'Binary=-0b00000101']);
		assert.deepStrictEqual(formats('0x1F'), ['Decimal=31', 'Hexadecimal=0x1F', 'Binary=0b00011111']);
		assert.deepStrictEqual(formats('0b101'), ['Decimal=5', 'Hexadecimal=0x05', 'Binary=0b00000101']);
		assert.deepStrictEqual(formats('9223372036854775807'), [
			'Decimal=9223372036854775807',
			'Hexadecimal=0x7FFFFFFFFFFFFFFF',
			'Binary=0b111111111111111111111111111111111111111111111111111111111111111'
		]);
		assert.deepStrictEqual(formats('00042'), ['Decimal=42', 'Hexadecimal=0x2A', 'Binary=0b00101010']);
	});

	test('ROW-02 TRUE and False are boolean rows with no numeric formats', () => {
		const text = doc(module(container('C', `<PARAMETER-VALUES>${numeric('A', 'TRUE', 'ECUC-BOOLEAN-PARAM-DEF')}${numeric('B', 'False', 'ECUC-BOOLEAN-PARAM-DEF')}</PARAMETER-VALUES>`)));
		const [a, b] = rowsOf(text).filter((row) => row.kind === 'parameter');
		assert.strictEqual(a.valueKind, 'boolean');
		assert.strictEqual(a.shownValue, 'TRUE');
		assert.deepStrictEqual(a.formats, []);
		assert.strictEqual(b.valueKind, 'boolean');
		assert.strictEqual(b.shownValue, 'False');
		assert.deepStrictEqual(b.formats, []);
	});

	test('ROW-03 an empty container and a reference-only container differ by children', () => {
		const reference = `<ECUC-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/P/R</DEFINITION-REF><VALUE-REF DEST="ECUC-CONTAINER-VALUE">/P/C</VALUE-REF></ECUC-REFERENCE-VALUE>`;
		const text = doc(module(`${container('Empty')}${container('RefOnly', `<REFERENCE-VALUES>${reference}</REFERENCE-VALUES>`)}`));
		const rows = rowsOf(text);
		const empty = rows.find((row) => row.label === 'Empty')!;
		const refOnly = rows.find((row) => row.label === 'RefOnly')!;
		assert.strictEqual(empty.empty, true);
		assert.strictEqual(empty.subtreeSize, 0);
		assert.strictEqual(refOnly.empty, false);
		assert.strictEqual(refOnly.subtreeSize, 1);
	});

	test('ROW-04 a module with no containers has no children and no span', () => {
		const text = doc(module(''));
		const [first] = rowsOf(text);
		assert.strictEqual(first.kind, 'module');
		assert.strictEqual(first.hasChildren, false);
		assert.strictEqual(first.subtreeSize, 0);
	});

	test('ROW-05 two context paths are kept in source order', () => {
		const reference = `<ECUC-INSTANCE-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-INSTANCE-REFERENCE-DEF">/P/I</DEFINITION-REF><VALUE-IREF><TARGET-REF DEST="ECUC-CONTAINER-VALUE">/P/A/Target</TARGET-REF><CONTEXT-ELEMENT-REF DEST="ECUC-CONTAINER-VALUE">/P/A</CONTEXT-ELEMENT-REF><CONTEXT-ELEMENT-REF DEST="ECUC-CONTAINER-VALUE">/P/A/B</CONTEXT-ELEMENT-REF></VALUE-IREF></ECUC-INSTANCE-REFERENCE-VALUE>`;
		const text = doc(module(container('C', `<REFERENCE-VALUES>${reference}</REFERENCE-VALUES>`)));
		const row = rowsOf(text).find((entry) => entry.kind === 'reference')!;
		assert.deepStrictEqual(row.contextPaths, ['P.A', 'P.A.B']);
		assert.ok(row.meta.some((part) => part.cls === 'context'), 'the context chip is present');
	});

	test('ROW-07 a false ancestor marks the child disabled by the ancestor', () => {
		const text = doc(
			module(
				container(
					'C',
					`<PARAMETER-VALUES>${numeric('A', '1')}</PARAMETER-VALUES>`
				).replace(
					'<PARAMETER-VALUES>',
					'<SW-SYSCOND>(false)</SW-SYSCOND><PARAMETER-VALUES>'
				)
			)
		);
		const rows = rowsOf(text);
		const parameter = rows.find((row) => row.kind === 'parameter')!;
		assert.strictEqual(parameter.disabledBy, 'ancestor');
	});

	test('ROW-09 identical sort keys keep declaration order', () => {
		const text = doc(
			module(
				container(
					'C',
					`<PARAMETER-VALUES>${numeric('Dup', '1')}${numeric('Dup', '2')}</PARAMETER-VALUES>`
				)
			)
		);
		const duplicates = rowsOf(text).filter((row) => row.label === 'Dup');
		assert.deepStrictEqual(duplicates.map((row) => row.value), ['1', '2']);
	});
});
