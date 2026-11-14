/**
 * The two-way copy planner (core).
 *
 * Each case is one arrow on one row: replace, insert, delete, stale, indentation.
 * The assertions are on the exact bytes the host would write, so a regression in
 * element text, line removal or re-indentation fails here rather than in a panel.
 */
import * as assert from 'assert';

import {
	indentationAt,
	planCopy,
	planDelete,
	reindent,
	removalSpan,
	wrapWithAncestors
} from '../../core/copy/planCopy';

const OURS = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <CONTAINERS>
    <ECUC-CONTAINER-VALUE>
      <SHORT-NAME>C</SHORT-NAME>
      <PARAMETER-VALUES>
        <ECUC-NUMERICAL-PARAM-VALUE>
          <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/C/P1</DEFINITION-REF>
          <VALUE>1</VALUE>
        </ECUC-NUMERICAL-PARAM-VALUE>
      </PARAMETER-VALUES>
    </ECUC-CONTAINER-VALUE>
  </CONTAINERS>
</AUTOSAR>
`;

function span(text: string, needle: string): { start: number; end: number } {
	const start = text.indexOf(needle);
	assert.ok(start >= 0, `the fixture has ${needle}`);
	const end = text.indexOf('</ECUC-NUMERICAL-PARAM-VALUE>', start) + '</ECUC-NUMERICAL-PARAM-VALUE>'.length;
	return { start, end };
}

const P1 = span(OURS, '<ECUC-NUMERICAL-PARAM-VALUE>');

function theirs(value: string): string {
	return OURS.replace('<VALUE>1</VALUE>', `<VALUE>${value}</VALUE>`);
}

suite('copy planner (core)', () => {
	test('replaces the target element with the source element bytes', () => {
		const sourceText = theirs('22');
		const sourceRange = span(sourceText, '<ECUC-NUMERICAL-PARAM-VALUE>');
		const planned = planCopy({
			targetText: OURS,
			sourceText,
			source: sourceRange,
			target: P1,
			targetIndent: indentationAt(OURS, P1.start)
		});
		assert.ok(planned.ok);
		assert.strictEqual(OURS.slice(0, planned.span.start) + planned.span.text + OURS.slice(planned.span.end), sourceText);
	});


	test('deletes an element with its line and leaves the neighbours intact', () => {
		const two = OURS.replace(
			'      </PARAMETER-VALUES>',
			`        <ECUC-NUMERICAL-PARAM-VALUE>
          <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/C/P2</DEFINITION-REF>
          <VALUE>2</VALUE>
        </ECUC-NUMERICAL-PARAM-VALUE>
      </PARAMETER-VALUES>`
		);
		const second = span(two, '<ECUC-NUMERICAL-PARAM-VALUE>\n          <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/C/P2</DEFINITION-REF>');
		const planned = planDelete({
			targetText: two,
			sourceText: '',
			target: second,
			targetIndent: '        '
		});
		assert.ok(planned.ok);
		assert.strictEqual(planned.span.text, '');
		const result = two.slice(0, planned.span.start) + two.slice(planned.span.end);
		assert.ok(result.includes('<VALUE>1</VALUE>'), 'the other parameter survives');
		assert.ok(!result.includes('<VALUE>2</VALUE>'), 'the deleted parameter is gone');
		assert.ok(!result.includes('\n\n'), 'no blank line left behind');
	});

	test('inserts after the anchor with the target indentation', () => {
		const source = theirs('22');
		const planned = planCopy({
			targetText: OURS,
			sourceText: source,
			source: P1,
			anchorAfter: P1,
			targetIndent: '        '
		});
		assert.ok(planned.ok);
		const result = OURS.slice(0, planned.span.start) + planned.span.text + OURS.slice(planned.span.end);
		assert.ok(result.includes('\n        <ECUC-NUMERICAL-PARAM-VALUE>'), 'the copy starts on its own indented line');
	});

	test('refuses an insertion with no sibling to anchor it', () => {
		const planned = planCopy({ targetText: OURS, sourceText: theirs('2'), source: P1, targetIndent: '  ' });
		assert.ok(!planned.ok);
		assert.match(planned.reason, /sibling/);
	});

	test('re-indents a block by the delta, not by a prefix assumption', () => {
		// Real element text: the opening tag starts at the range (no indent); every
		// other line carries the element's own indentation.
		const block = '<A>\n      <B/>\n    </A>';
		assert.strictEqual(reindent(block, '    ', '      '), '<A>\n        <B/>\n      </A>');
		assert.strictEqual(reindent(block, '      ', '    '), '<A>\n    <B/>\n  </A>');
	});

	test('a removal span keeps inline elements intact', () => {
		const inline = 'text <VALUE>x</VALUE> tail';
		const start = inline.indexOf('<VALUE>');
		const end = inline.indexOf('</VALUE>') + '</VALUE>'.length;
		assert.deepStrictEqual(removalSpan(inline, { start, end }), { start, end });
	});

	test('line endings follow the target document', () => {
		const crlf = OURS.replace(/\n/g, '\r\n');
		const start = crlf.indexOf('<ECUC-NUMERICAL-PARAM-VALUE>');
		const end = crlf.indexOf('</ECUC-NUMERICAL-PARAM-VALUE>') + '</ECUC-NUMERICAL-PARAM-VALUE>'.length;
		const planned = planCopy({
			targetText: crlf,
			sourceText: OURS,
			source: P1,
			anchorAfter: { start, end },
			targetIndent: '        '
		});
		assert.ok(planned.ok);
		assert.ok(planned.span.text.startsWith('\r\n'), 'the inserted line uses CRLF');
		assert.ok(!/[^\r]\n/.test(planned.span.text), 'an LF source block is converted to CRLF, with no mixed endings');
	});
});

suite('copy ancestors (core)', () => {
	const element = '<ECUC-NUMERICAL-PARAM-VALUE>\n          <VALUE>1</VALUE>\n        </ECUC-NUMERICAL-PARAM-VALUE>';

	test('wraps a copied parameter in a minimal container with one child list', () => {
		const wrapped = wrapWithAncestors(
			element,
			'        ',
			[{ shortName: 'B', definitionRef: '/P/A/B', definitionDest: 'ECUC-PARAM-CONF-CONTAINER-DEF', childKind: 'parameter' }],
			'    '
		);
		assert.ok(wrapped.startsWith('<ECUC-CONTAINER-VALUE>'));
		assert.ok(wrapped.includes('<SHORT-NAME>B</SHORT-NAME>'));
		assert.ok(wrapped.includes('DEST="ECUC-PARAM-CONF-CONTAINER-DEF"'));
		assert.ok(wrapped.includes('<PARAMETER-VALUES>'), 'a parameter goes in PARAMETER-VALUES');
		assert.ok(wrapped.includes('<VALUE>1</VALUE>'), 'the copied element is kept');
		assert.ok(!wrapped.includes('<SUB-CONTAINERS>'), 'no unrelated child list is invented');
		assert.ok(wrapped.trimEnd().endsWith('</ECUC-CONTAINER-VALUE>'));
	});

	test('nests the whole missing chain, innermost last', () => {
		const wrapped = wrapWithAncestors(
			element,
			'        ',
			[
				{ shortName: 'A', definitionRef: '/P/A', definitionDest: 'ECUC-PARAM-CONF-CONTAINER-DEF', childKind: 'container' },
				{ shortName: 'B', definitionRef: '/P/A/B', definitionDest: 'ECUC-PARAM-CONF-CONTAINER-DEF', childKind: 'parameter' }
			],
			'  '
		);
		const a = wrapped.indexOf('<SHORT-NAME>A</SHORT-NAME>');
		const b = wrapped.indexOf('<SHORT-NAME>B</SHORT-NAME>');
		assert.ok(a >= 0 && b > a, 'A wraps B');
		assert.ok(wrapped.includes('  <SUB-CONTAINERS>'), 'A holds B in SUB-CONTAINERS');
		assert.ok(wrapped.includes('      <PARAMETER-VALUES>'), 'B holds the parameter');
	});

	test('a CRLF target gets CRLF through the ancestor wrapper', () => {
		const wrapped = wrapWithAncestors(
			'<A>\n  <B/>\n</A>',
			'  ',
			[{ shortName: 'C', definitionRef: '/P/C', definitionDest: 'ECUC-PARAM-CONF-CONTAINER-DEF', childKind: 'container' }],
			'    ',
			'\r\n'
		);
		assert.ok(!/[^\r]\n/.test(wrapped), 'no bare LF remains');
		assert.ok(wrapped.split('\r\n').length > 3, 'the block is multi-line');
	});

	test('keeps a definition DEST when the ancestor has one', () => {
		const wrapped = wrapWithAncestors(
			element,
			'        ',
			[{ shortName: 'C', definitionRef: '/P/C', definitionDest: 'ECUC-PARAM-CONF-CONTAINER-DEF', childKind: 'parameter' }],
			'  '
		);
		assert.ok(wrapped.includes('DEST="ECUC-PARAM-CONF-CONTAINER-DEF"'));
	});
});
