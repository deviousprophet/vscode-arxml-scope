import * as assert from 'assert';

import { isArxmlPath, isEcucValues } from '../../core/ecuc/detect';
import { EcucDocumentModel } from '../../core/ecuc/model';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { expectedModel, fixtureText, plain, scanFixture, slice, stripRanges } from './modelTestUtils';

/** Fixtures with a committed expected model. */
const FIXTURES = [
	'basic.arxml',
	'namespaced.arxml',
	'deep.arxml',
	'suffixes.arxml',
	'value-ambiguity.arxml',
	'lexical.arxml',
	'exceptions.arxml',
	'references.arxml',
	'not-ecuc.arxml',
];

suite('scanner (core)', () => {
	test('AC1: every fixture matches its committed expected model', () => {
		for (const fixture of FIXTURES) {
			const expected = expectedModel(fixture.replace(/\.arxml$/, '.json'));
			assert.deepStrictEqual(plain(scanFixture(fixture)), expected, fixture);
		}
	});

	test('AC: an inline SYSC-REF in SW-SYSCOND keeps the constant name and drops formatting', () => {
		const source = `<AUTOSAR>
  <AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS>
    <ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME>
      <CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME>
        <PARAMETER-VALUES>
          <ECUC-NUMERICAL-PARAM-VALUE>
            <DEFINITION-REF DEST="ECUC-BOOLEAN-PARAM-DEF">/D/P/Plain</DEFINITION-REF>
            <VARIATION-POINT><SW-SYSCOND>(A == B)</SW-SYSCOND></VARIATION-POINT>
          </ECUC-NUMERICAL-PARAM-VALUE>
          <ECUC-NUMERICAL-PARAM-VALUE>
            <DEFINITION-REF DEST="ECUC-BOOLEAN-PARAM-DEF">/D/P/Ref</DEFINITION-REF>
            <VARIATION-POINT><SW-SYSCOND BINDING-TIME="CODE-GENERATION-TIME">
              (
              <SYSC-REF DEST="SW-SYSTEMCONST">/P/SwSystemconsts/CANIPCORETYPE_SC</SYSC-REF>
              ==0)
            </SW-SYSCOND></VARIATION-POINT>
          </ECUC-NUMERICAL-PARAM-VALUE>
          <ECUC-NUMERICAL-PARAM-VALUE>
            <DEFINITION-REF DEST="ECUC-BOOLEAN-PARAM-DEF">/D/P/LeadingRef</DEFINITION-REF>
            <VARIATION-POINT><SW-SYSCOND><SYSC-REF DEST="SW-SYSTEMCONST">/P/SwSystemconsts/CANIPCORETYPE_SC</SYSC-REF>==0</SW-SYSCOND></VARIATION-POINT>
          </ECUC-NUMERICAL-PARAM-VALUE>
        </PARAMETER-VALUES>
      </ECUC-CONTAINER-VALUE></CONTAINERS>
    </ECUC-MODULE-CONFIGURATION-VALUES>
  </ELEMENTS></AR-PACKAGE></AR-PACKAGES>
</AUTOSAR>`;
		const model = scanEcucValues(source);
		const parameters = model.modules[0].containers[0].parameters;
		assert.strictEqual(parameters[0].syscond, '(A == B)', 'a plain condition keeps its own spacing');
		assert.strictEqual(parameters[1].syscond, '(CANIPCORETYPE_SC==0)', 'the inline reference is its path tail');
		assert.strictEqual(
			parameters[2].syscond,
			'CANIPCORETYPE_SC==0',
			'a condition that opens with the reference keeps the trailing part'
		);
		const range = parameters[2].syscondRange;
		assert.ok(range, 'the condition carries a range');
		assert.strictEqual(
			source.slice(range.start, range.start + 'CANIPCORETYPE_SC'.length),
			'CANIPCORETYPE_SC',
			'the range starts at the reference tail, not at the `<SYSC-REF>` markup'
		);
		assert.ok(
			source.slice(range.start, range.end).endsWith('==0'),
			'the range ends past the trailing part of the condition'
		);
	});

	test('AC1: parameter DEFINITION-REF DEST is captured, including namespace prefixes', () => {
		const basic = scanFixture('basic.arxml');
		const parameters = basic.modules[0].containers[0].parameters;
		assert.strictEqual(parameters.find((p) => p.name === 'IniValue')?.definitionDest, 'ECUC-INTEGER-PARAM-DEF');
		assert.strictEqual(parameters.find((p) => p.name === 'Title')?.definitionDest, 'ECUC-STRING-PARAM-DEF');

		const namespaced = scanFixture('namespaced.arxml');
		assert.strictEqual(
			namespaced.modules[0].containers[0].parameters[0].definitionDest,
			'ECUC-INTEGER-PARAM-DEF'
		);

		const noDest = scanEcucValues(
			'<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS>' +
				'<ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME>' +
				'<DEFINITION-REF>/D/M</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE>' +
				'<SHORT-NAME>C</SHORT-NAME><DEFINITION-REF>/D/C</DEFINITION-REF><PARAMETER-VALUES>' +
				'<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF>/D/C/N</DEFINITION-REF><VALUE>1</VALUE>' +
				'</ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS>' +
				'</ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>'
		);
		assert.strictEqual(noDest.modules[0].containers[0].parameters[0].definitionDest, undefined);
	});

	test('AC1: every fixture parameter with a DEST carries it', () => {
		for (const fixture of FIXTURES) {
			const text = fixtureText(fixture);
			const dests = new Map<string, string>();
			const re = /<(?:[A-Za-z_][\w.-]*:)?DEFINITION-REF\b([^>]*)>([^<]+)<\/[^>]*>/g;
			let match: RegExpExecArray | null;
			while ((match = re.exec(text)) !== null) {
				const dest = /\bDEST="([^"]+)"/.exec(match[1]);
				if (dest) {
					dests.set(match[2].trim(), dest[1]);
				}
			}
			const model = scanFixture(fixture);
			const visit = (containers: EcucDocumentModel['modules'][number]['containers']): void => {
				for (const container of containers) {
					for (const parameter of container.parameters) {
						assert.strictEqual(
							parameter.definitionDest,
							dests.get(parameter.definitionRef),
							`${fixture} ${parameter.definitionRef}`
						);
					}
					visit(container.containers);
				}
			};
			for (const module of model.modules) {
				visit(module.containers);
			}
		}
	});

	test('AC1: the deep fixture nests a container six levels down', () => {
		const model = scanFixture('deep.arxml');
		let node = model.modules[0].containers[0];
		let depth = 1;
		while (node.containers.length > 0) {
			node = node.containers[0];
			depth++;
		}
		assert.strictEqual(depth, 6);
		assert.strictEqual(node.shortName, 'C6');
		assert.deepStrictEqual(node.containerPath, ['P', 'M', 'C1', 'C2', 'C3', 'C4', 'C5']);
	});

	test('AC1: ranges point at the exact source text', () => {
		const text = fixtureText('lexical.arxml');
		const model = scanFixture('lexical.arxml');
		const parameters = model.modules[0].containers[0].parameters;
		// CDATA content, entity-decoded text, and a self-closing `<VALUE/>`.
		assert.strictEqual(slice(text, parameters[0].valueRange!), 'if a<b && c>d');
		assert.strictEqual(parameters[0].displayValue, 'if a<b && c>d');
		assert.strictEqual(slice(text, parameters[1].valueRange!), '&lt;b&gt;bold&lt;/b&gt; &amp; more');
		assert.strictEqual(parameters[1].displayValue, '<b>bold</b> & more');
		assert.strictEqual(parameters[2].valueRange !== undefined, true, 'an empty <VALUE/> still gets a range');
		assert.strictEqual(slice(text, parameters[2].valueRange!), '<VALUE/>');
		assert.ok(text.startsWith('<ECUC-NUMERICAL-PARAM-VALUE>', parameters[2].range.start));
		const empty = slice(text, parameters[2].range);
		assert.ok(empty.startsWith('<ECUC-NUMERICAL-PARAM-VALUE>'));
		assert.ok(empty.endsWith('</ECUC-NUMERICAL-PARAM-VALUE>'));
		// An attribute value containing `>` did not terminate the tag.
		assert.strictEqual(model.modules[0].definitionRef, '/D/M');
	});

	test('AC1: an empty CDATA section does not widen a captured range', () => {
		// `<![CDATA[]]>` carries no text, so it must not register as the start (or end) of
		// an element's text: the range has to point at the real value only, or a write
		// would replace the marker itself and corrupt the element.
		const shapes = ['<VALUE><![CDATA[]]>abc</VALUE>', '<VALUE>abc<![CDATA[]]></VALUE>'];
		for (const value of shapes) {
			const text =
				'<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS>' +
				'<ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME>' +
				'<DEFINITION-REF>/D/M</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE>' +
				'<SHORT-NAME>C</SHORT-NAME><DEFINITION-REF>/D/C</DEFINITION-REF><PARAMETER-VALUES>' +
				'<ECUC-TEXTUAL-PARAM-VALUE><DEFINITION-REF>/D/C/A</DEFINITION-REF>' +
				value +
				'</ECUC-TEXTUAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS>' +
				'</ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>';
			const parameter = scanEcucValues(text).modules[0].containers[0].parameters[0];
			assert.strictEqual(parameter.displayValue, 'abc', value);
			assert.strictEqual(slice(text, parameter.valueRange!), 'abc', value);
		}
	});

	test('AC1: the module element range covers its closing tag', () => {
		const text = fixtureText('basic.arxml');
		const model = scanFixture('basic.arxml');
		const module = model.modules[0];
		assert.ok(text.startsWith('<ECUC-MODULE-CONFIGURATION-VALUES>', module.range.start));
		assert.ok(text.startsWith('</ECUC-MODULE-CONFIGURATION-VALUES>', module.range.end - 35));
		assert.strictEqual(text.slice(module.range.end - 1, module.range.end), '>');
	});

	test('AC1: the model retains no reference to the input text', () => {
		const text = fixtureText('basic.arxml');
		const model = scanFixture('basic.arxml');
		assert.ok(JSON.stringify(plain(model)).length > 0);
		const seen: unknown[] = [];
		const visit = (value: unknown): void => {
			if (typeof value === 'string') {
				seen.push(value);
				return;
			}
			if (Array.isArray(value)) {
				value.forEach(visit);
				return;
			}
			if (value && typeof value === 'object') {
				Object.values(value).forEach(visit);
			}
		};
		visit(plain(model));
		assert.ok(!seen.some((v) => v === text));
		assert.strictEqual(Object.prototype.hasOwnProperty.call(model, 'text'), false);
	});

	test('AC2: `<VALUE>` is resolved from its enclosing element in both contexts', () => {
		const text = fixtureText('value-ambiguity.arxml');
		const container = scanFixture('value-ambiguity.arxml').modules[0].containers[0];

		// Context 1: the value of an ECUC-NUMERICAL-PARAM-VALUE.
		assert.strictEqual(container.parameters.length, 1);
		const parameter = container.parameters[0];
		assert.strictEqual(parameter.name, 'IniValue');
		assert.strictEqual(parameter.displayValue, '63');
		assert.strictEqual(slice(text, parameter.valueRange!), '63');
		assert.ok(text.startsWith('<VALUE>', parameter.valueRange!.start - 7));

		// Context 2: the compared value inside a POST-BUILD-VARIANT-CONDITION.
		assert.deepStrictEqual(container.postBuildVariants, [{ criterion: 'Crit1', operator: '==', value: '63' }]);
		assert.strictEqual(container.parameters.length, 1, 'the condition VALUE must not become a parameter');
	});

	test('AC1: annotations are read from the layered LABEL/L-4 and ANNOTATION-TEXT/VERBATIM/L-5 shape', () => {
		const module = scanFixture('suffixes.arxml').modules[0];
		// Trimmed, and the first language layer in document order wins: the `.mm`
		// selects `child[?L-4]` / `child[?L-5]` with no language predicate.
		assert.strictEqual(module.annotations![0].label, 'Note');
		assert.strictEqual(module.annotations![0].text, 'module note');
		// The DE layer must not have been picked up.
		assert.notStrictEqual(module.annotations![0].label, 'Hinweis');
		assert.notStrictEqual(module.annotations![0].text, 'Modulnotiz');

		// An annotation with no LABEL still yields its text.
		const annotation = module.containers[0].annotations![0];
		assert.strictEqual(annotation.text, 'no label here');
		assert.strictEqual(annotation.label, undefined);
	});

	test('AC1: a flat annotation yields no label and no text', () => {
		// The legacy `\formatAnnotation` reads only `LABEL/L-4` and
		// `ANNOTATION-TEXT/VERBATIM/L-5`, so a flat `<LABEL>Note</LABEL>` contributes
		// nothing. Matching that, rather than inventing a fallback, is deliberate.
		const text =
			'<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS>' +
			'<ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME>' +
			'<DEFINITION-REF>/D/M</DEFINITION-REF><ANNOTATIONS><ANNOTATION>' +
			'<LABEL>Note</LABEL><ANNOTATION-TEXT><VERBATIM>flat body</VERBATIM></ANNOTATION-TEXT>' +
			'</ANNOTATION></ANNOTATIONS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS>' +
			'</AR-PACKAGE></AR-PACKAGES></AUTOSAR>';
		const annotation = scanEcucValues(text).modules[0].annotations![0];
		assert.strictEqual(annotation.label, undefined);
		assert.strictEqual(annotation.text, undefined);
		// Nothing was captured, so only the range remains.
		assert.deepStrictEqual(Object.keys(annotation), ['range']);
	});

	test('AC3: detection is namespace-tolerant and gate-ordered', () => {
		assert.strictEqual(isEcucValues(fixtureText('basic.arxml'), 'basic.arxml'), true);
		assert.strictEqual(isEcucValues(fixtureText('namespaced.arxml'), 'namespaced.arxml'), true);
		assert.strictEqual(isEcucValues(fixtureText('not-ecuc.arxml'), 'not-ecuc.arxml'), false);
		assert.strictEqual(isEcucValues(fixtureText('deep.arxml'), 'deep.ARXML'), true);

		// A non-`.arxml` path is rejected without the content being consulted:
		// the text below is a valid ECUC file, only the path disqualifies it.
		assert.strictEqual(isArxmlPath('basic.arxml'), true);
		assert.strictEqual(isArxmlPath('basic.xml'), false);
		assert.strictEqual(isEcucValues(fixtureText('basic.arxml'), 'basic.xml'), false);
		assert.strictEqual(isEcucValues(fixtureText('basic.arxml'), 'folder.arxml/notes.txt'), false);
	});

	test('AC4: layout is irrelevant', () => {
		const basicText = fixtureText('basic.arxml');
		const formattingText = fixtureText('formatting.arxml');
		assert.ok(!basicText.includes('\r\n'));
		assert.ok(formattingText.includes('\r\n'));
		assert.notStrictEqual(basicText, formattingText);

		const basic = plain(scanFixture('basic.arxml'));
		const formatting = plain(scanFixture('formatting.arxml'));
		assert.deepStrictEqual(stripRanges(formatting), stripRanges(basic));
		// Comments and processing instructions contributed no text and no nodes.
		const rendered = JSON.stringify(formatting);
		assert.strictEqual(rendered.includes('the module package'), false);
		assert.strictEqual(rendered.includes('keepable'), false);
	});

	test('namespace prefixes are stripped from every tag, and the schema release is derived', () => {
		const model = scanFixture('namespaced.arxml') as EcucDocumentModel;
		assert.deepStrictEqual(model.schema, { release: '00048' });
		assert.strictEqual(model.modules[0].shortName, 'M');
		assert.strictEqual(model.modules[0].definitionRef, '/P/M');
		assert.ok(model.pathIndex.has('/P/M/C'));
	});
});
