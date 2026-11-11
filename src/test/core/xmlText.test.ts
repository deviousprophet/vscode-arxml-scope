/**
 * XML text helpers: entity decoding and markup declaration scanning.
 */
import * as assert from 'assert';

import { decodeXml, markupDeclarationEnd } from '../../core/text/xmlText';

suite('xml text (core)', () => {
	test('decodes the predefined entities and numeric references', () => {
		assert.strictEqual(decodeXml('&amp;&lt;&gt;&quot;&apos;'), '&<>"\'');
		assert.strictEqual(decodeXml('&#65;&#x41;&#00065;&#x0041;'), 'AAAA');
		assert.strictEqual(decodeXml('&#X41;'), '&#X41;'); // the regex only accepts a lowercase `x`
		assert.strictEqual(decodeXml('a &amp; b'), 'a & b');
		assert.strictEqual(decodeXml('plain text'), 'plain text');
	});

	test('leaves custom, unterminated and malformed entities verbatim', () => {
		for (const raw of ['&unknown;', '&nbsp;', '&amp', '&#xZZ;', '&#;', '&#x;', '&&amp;', '&;']) {
			assert.strictEqual(decodeXml(raw), raw === '&&amp;' ? '&&' : raw, raw);
		}
	});

	test('a declaration ends at its closing angle bracket', () => {
		assert.strictEqual(markupDeclarationEnd('<!DOCTYPE A>rest', 0), 12);
		assert.strictEqual(markupDeclarationEnd('x<!DOCTYPE A>', 1), 13);
		assert.strictEqual(markupDeclarationEnd('<!', 0), -1);
	});

	test('an internal subset ends at the bracket close, not an entity close', () => {
		const subset = '<!DOCTYPE A [<!ENTITY x "y">]>rest';
		assert.strictEqual(markupDeclarationEnd(subset, 0), subset.indexOf(']>') + 2);
		assert.ok(markupDeclarationEnd(subset, 0) > subset.indexOf('>'));
	});

	test('quotes protect an angle bracket in a declaration', () => {
		const quoted = "<!DOCTYPE A [<!ENTITY x '>'>]>rest";
		assert.strictEqual(markupDeclarationEnd(quoted, 0), quoted.indexOf(']>') + 2);
		const doubleQuoted = '<!DOCTYPE A [<!ENTITY x ">">]>rest';
		assert.strictEqual(markupDeclarationEnd(doubleQuoted, 0), doubleQuoted.indexOf(']>') + 2);
	});

	test('nested brackets and an unterminated declaration', () => {
		const nested = '<!DOCTYPE A [[x]]>rest';
		assert.strictEqual(markupDeclarationEnd(nested, 0), nested.indexOf('>rest') + 1);
		assert.strictEqual(markupDeclarationEnd('<!DOCTYPE A [ <!ENTITY x "y">', 0), -1);
	});

	test('the scan ends at the first unquoted greater-than', () => {
		assert.strictEqual(markupDeclarationEnd('<!-- comment > -->rest', 0), 14);
		const instruction = '<?pi data?>rest';
		assert.strictEqual(markupDeclarationEnd(instruction, 0), instruction.indexOf('>') + 1);
	});
});
