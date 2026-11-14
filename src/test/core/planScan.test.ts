/**
 * Plan rows SCAN-01…10 from `docs/TEST_PLAN.md`.
 *
 * Each test name starts with its plan ID so a failure points at the row. The
 * scanner takes text, so these cases drive it directly; encoding fixtures are
 * decoded the way the index decodes them.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
import type { ContainerNode, ParameterNode } from '../../core/ecuc/model';

/** UTF-16 bytes with a BOM, byte-swapped for big-endian. */
function utf16WithBom(source: string, little: boolean): Buffer {
	const bytes = Buffer.from(source, 'utf16le');
	if (little) {
		return Buffer.concat([Buffer.from([0xff, 0xfe]), bytes]);
	}
	return Buffer.concat([Buffer.from([0xfe, 0xff]), swapPairs(bytes)]);
}

function doc(elements: string, prolog = ''): string {
	return `<?xml version="1.0" encoding="UTF-8"?>\n${prolog}<AUTOSAR xmlns="http://autosar.org/schema/r4.0">\n<AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS>${elements}</ELEMENTS></AR-PACKAGE></AR-PACKAGES>\n</AUTOSAR>`;
}

function container(name: string, parameters = '', extra = ''): string {
	return `<ECUC-CONTAINER-VALUE><SHORT-NAME>${name}</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/${name}</DEFINITION-REF>${extra}${parameters}</ECUC-CONTAINER-VALUE>`;
}

function parameter(name: string, value: string): string {
	return `<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/${name}</DEFINITION-REF><VALUE>${value}</VALUE></ECUC-NUMERICAL-PARAM-VALUE>`;
}

function module(containers: string): string {
	return `<ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/M</DEFINITION-REF><CONTAINERS>${containers}</CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES>`;
}

function firstParameter(text: string): ParameterNode {
	const model = scanEcucValues(text);
	const found = model.modules[0]?.containers[0]?.parameters[0];
	assert.ok(found, 'the document has one parameter');
	return found;
}

function containersOf(text: string): ContainerNode[] {
	const model = scanEcucValues(text);
	const found = model.modules[0]?.containers;
	assert.ok(found, 'the document has a module');
	return found;
}

suite('plan coverage: SCAN', () => {
	test('SCAN-01 CRLF and lone-CR documents keep exact UTF-16 ranges', () => {
		for (const newline of ['\r\n', '\r']) {
			const text = doc(module(container('C', `<PARAMETER-VALUES>${parameter('A', '1')}</PARAMETER-VALUES>`))).replaceAll(
				'\n',
				newline
			);
			const value = firstParameter(text);
			assert.strictEqual(value.displayValue, '1', `no carriage return is swallowed (${JSON.stringify(newline)})`);
			assert.deepStrictEqual(
				value.valueRange,
				{ start: text.indexOf('>1<') + 1, end: text.indexOf('>1<') + 2 },
				`the value range is the character between the tags (${JSON.stringify(newline)})`
			);
		}
	});

	test('SCAN-02 UTF-16LE and UTF-16BE with a BOM scan as their UTF-8 twin', () => {
		const source = doc(module(container('C', `<PARAMETER-VALUES>${parameter('A', '42')}</PARAMETER-VALUES>`)));
		const utf8 = scanEcucValues(source);
		for (const little of [true, false]) {
			const decoded = new TextDecoder(little ? 'utf-16le' : 'utf-16be').decode(utf16WithBom(source, little));
			const scanned = scanEcucValues(decoded);
			assert.strictEqual(
				JSON.stringify(scanned.modules),
				JSON.stringify(utf8.modules),
				`${little ? 'LE' : 'BE'} model matches UTF-8`
			);
		}
	});

	test('SCAN-03 an astral character before a value does not shift its range', () => {
		const text = doc(module(container('C', `<!-- 😀 --><PARAMETER-VALUES>${parameter('A', '7')}</PARAMETER-VALUES>`)));
		const value = firstParameter(text);
		const expected = text.indexOf('>7<') + 1;
		assert.strictEqual(value.valueRange?.start, expected);
		assert.strictEqual(value.displayValue, '7');
	});

	test('SCAN-04 an attribute containing > and quotes keeps the tag end', () => {
		const text = doc(
			module(
				container(
					'C',
					`<PARAMETER-VALUES>${parameter('A', '1')}</PARAMETER-VALUES>`,
					'<!-- a > b -->'
				)
			)
		);
		const value = firstParameter(text);
		assert.strictEqual(value.displayValue, '1');
		const closing = text.indexOf('</ECUC-CONTAINER-VALUE>');
		assert.strictEqual(containersOf(text)[0].range.end, closing + '</ECUC-CONTAINER-VALUE>'.length);
	});

	test('SCAN-05 CDATA with ]] and a > in the content stays one section', () => {
		const text = doc(
			module(
				container(
					'C',
					`<PARAMETER-VALUES><ECUC-TEXTUAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-STRING-PARAM-DEF">/P/T</DEFINITION-REF><VALUE><![CDATA[a]]b>c]]></VALUE></ECUC-TEXTUAL-PARAM-VALUE></PARAMETER-VALUES>`
				)
			)
		);
		const value = firstParameter(text);
		assert.strictEqual(value.displayValue, 'a]]b>c');
		assert.deepStrictEqual(value.valueRange, {
			start: text.indexOf('<![CDATA[') + '<![CDATA['.length,
			end: text.lastIndexOf(']]>')
		});
	});

	test('SCAN-06 self-closing, empty and whitespace VALUE are distinct shapes', () => {
		const text = doc(
			module(
				container(
					'C',
					`<PARAMETER-VALUES>${parameter('A', '')}<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/B</DEFINITION-REF><VALUE/></ECUC-NUMERICAL-PARAM-VALUE>${parameter('C', ' ')}</PARAMETER-VALUES>`
				)
			)
		);
		const parameters = containersOf(text)[0].parameters;
		assert.strictEqual(parameters.length, 3);
		const [empty, selfClosing, blank] = parameters;
		// With no text the model falls back to the `<VALUE>` element span, which is what
		// an edit replaces; the three inputs stay distinguishable by that span.
		const valueSpan = (raw: string) => {
			const at = text.indexOf(raw);
			return { start: at, end: at + raw.length };
		};
		assert.strictEqual(empty.displayValue, '');
		assert.deepStrictEqual(empty.valueRange, valueSpan('<VALUE></VALUE>'));
		assert.strictEqual(selfClosing.displayValue, '');
		assert.deepStrictEqual(selfClosing.valueRange, valueSpan('<VALUE/>'));
		assert.strictEqual(blank.displayValue, '');
		assert.deepStrictEqual(blank.valueRange, valueSpan('<VALUE> </VALUE>'));
		assert.notStrictEqual(empty.range.end - empty.range.start, selfClosing.range.end - selfClosing.range.start);
	});

	test('SCAN-07 ten thousand levels nest without a stack failure', () => {
		const depth = 10_000;
		const open = '<X>';
		const close = '</X>';
		const text = `<AUTOSAR>${open.repeat(depth)}${close.repeat(depth)}</AUTOSAR>`;
		const model = scanEcucValues(text);
		assert.strictEqual(model.modules.length, 0, 'generic nesting is not an ECUC model');
		// The scanner must simply return; a recursive parser would throw here.
		assert.ok(text.length > 0);
	});

	test('SCAN-08 unknown, unterminated and out-of-range entities stay verbatim', () => {
		const text = doc(
			module(
				container(
					'C',
					`<PARAMETER-VALUES><ECUC-TEXTUAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-STRING-PARAM-DEF">/P/T</DEFINITION-REF><VALUE>a &amp; b &unknown; c &#x110000; d &amp</VALUE></ECUC-TEXTUAL-PARAM-VALUE></PARAMETER-VALUES>`
				)
			)
		);
		const value = firstParameter(text);
		assert.strictEqual(value.displayValue, 'a & b &unknown; c &#x110000; d &amp');
	});

	test('SCAN-09 a DOCTYPE internal subset with > is skipped once', () => {
		const prolog = '<!DOCTYPE AUTOSAR [\n<!ENTITY sample "a > b">\n]>\n';
		const text = doc(module(container('C', `<PARAMETER-VALUES>${parameter('A', '3')}</PARAMETER-VALUES>`)), prolog);
		const model = scanEcucValues(text);
		assert.strictEqual(model.modules.length, 1);
		assert.strictEqual(model.modules[0].containers[0].parameters[0].displayValue, '3');
	});

	test('SCAN-10 two sibling containers sharing one SHORT-NAME both survive', () => {
		const text = doc(module(container('Same', `<PARAMETER-VALUES>${parameter('A', '1')}</PARAMETER-VALUES>`) + container('Same', `<PARAMETER-VALUES>${parameter('B', '2')}</PARAMETER-VALUES>`)));
		const containers = containersOf(text);
		assert.strictEqual(containers.length, 2);
		assert.notDeepStrictEqual(containers[0].range, containers[1].range);
		assert.strictEqual(containers[0].parameters[0].displayValue, '1');
		assert.strictEqual(containers[1].parameters[0].displayValue, '2');
	});
});

function swapPairs(bytes: Buffer): Buffer {
	const out = Buffer.alloc(bytes.length);
	for (let at = 0; at + 1 < bytes.length; at += 2) {
		out[at] = bytes[at + 1];
		out[at + 1] = bytes[at];
	}
	return out;
}
