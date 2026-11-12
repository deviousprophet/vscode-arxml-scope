/**
 * Row-view primitives: condition token segmentation, search marks, the
 * `= value` span and the quiet-source meta chips. The strings asserted here are
 * the observable DOM contract: one node per slice, the same classes and the
 * same order, with no empty text nodes added where the original skipped them.
 */
import * as assert from 'assert';

import {
	appendConditionTokens,
	appendHighlighted,
	conditionTokens,
	metaSpan,
	setHighlightQuery,
	valueSpan,
} from '../../../webview/render/rowView';
import { installMarkup } from '../pageTestUtils';
import type { InstalledDom } from '../pageTestUtils';

/** A compact, structural description of a node tree (closing tags are `</>`). */
function markup(node: Node): string {
	if (node.nodeType === 3) {
		return '#' + JSON.stringify(node.nodeValue ?? '');
	}
	const element = node as Element;
	const attrs = Array.from(element.attributes)
		.map((attr) => `${attr.name}=${JSON.stringify(attr.value)}`)
		.sort()
		.join(' ');
	const children = Array.from(element.childNodes).map(markup).join('');
	return `<${element.tagName.toLowerCase()}${attrs ? ' ' + attrs : ''}>${children}</>`;
}

function span(): HTMLElement {
	return document.createElement('span');
}

function tokenText(text: string): string[] {
	return conditionTokens(text).map((token) => text.slice(token.start, token.end));
}

suite('row view primitives', () => {
	let dom: InstalledDom;

	suiteSetup(() => {
		dom = installMarkup('<body></body>');
	});

	suiteTeardown(() => {
		dom.restore();
	});

	setup(() => {
		setHighlightQuery('');
	});

	test('conditionTokens assigns the syntax class of every slice', () => {
		assert.deepStrictEqual(conditionTokens('A == 1 && B != "x"'), [
			{ cls: 'syscond-name', start: 0, end: 1 },
			{ cls: '', start: 1, end: 2 },
			{ cls: 'syscond-operator', start: 2, end: 4 },
			{ cls: '', start: 4, end: 5 },
			{ cls: 'syscond-number', start: 5, end: 6 },
			{ cls: '', start: 6, end: 7 },
			{ cls: 'syscond-operator', start: 7, end: 9 },
			{ cls: '', start: 9, end: 10 },
			{ cls: 'syscond-name', start: 10, end: 11 },
			{ cls: '', start: 11, end: 12 },
			{ cls: 'syscond-operator', start: 12, end: 14 },
			{ cls: '', start: 14, end: 15 },
			{ cls: 'syscond-string', start: 15, end: 18 },
		]);
	});

	test('conditionTokens keeps literals, signed numbers, hex and names together', () => {
		assert.deepStrictEqual(tokenText('true false TRUE False _x.y-1/2 +3 -4 .5 0x1F 0X2a 3.14'), [
			'true',
			' ',
			'false',
			' ',
			'TRUE',
			' ',
			'False',
			' ',
			'_x.y-1/2',
			' ',
			'+3',
			' ',
			'-4',
			' ',
			'.5',
			' ',
			'0x1F',
			' ',
			'0X2a',
			' ',
			'3.14',
		]);
		assert.deepStrictEqual(
			conditionTokens('true FALSE True').map((token) => token.cls),
			['syscond-literal', '', 'syscond-literal', '', 'syscond-name']
		);
	});

	test('conditionTokens treats lone signs, dots and repeated operators as punctuation', () => {
		assert.deepStrictEqual(
			conditionTokens('- + . === 0x 1. ..5').map((token) => token.cls),
			[
				'syscond-punct',
				'',
				'syscond-punct',
				'',
				'syscond-punct',
				'',
				'syscond-operator',
				'syscond-punct',
				'',
				'syscond-number',
				'',
				'syscond-number',
				'',
				'syscond-punct',
				'syscond-number',
			]
		);
		assert.deepStrictEqual(conditionTokens('<>!,=').map((token) => token.cls), [
			'syscond-operator',
			'syscond-operator',
			'syscond-operator',
			'syscond-punct',
			'syscond-punct',
		]);
	});

	test('conditionTokens honours quotes, escapes and an unterminated string', () => {
		const double = String.fromCharCode(34);
		const single = String.fromCharCode(39);
		const text =
			double + 'a\\' + double + 'b' + double + ' ' + single + 'c\\' + single + 'd' + single + ' ' + double + 'open';
		assert.deepStrictEqual(tokenText(text), [
			double + 'a\\' + double + 'b' + double,
			' ',
			single + 'c\\' + single + 'd' + single,
			' ',
			double + 'open',
		]);
		assert.deepStrictEqual(
			conditionTokens(text).map((token) => token.cls),
			['syscond-string', '', 'syscond-string', '', 'syscond-string']
		);
	});

	test('conditionTokens keeps one whitespace token and covers every character', () => {
		assert.deepStrictEqual(conditionTokens(' \t\r\n'), [{ cls: '', start: 0, end: 4 }]);
		for (const text of [
			'A == 1 && B != "x"',
			'true false TRUE False _x.y-1/2 +3 -4 .5 0x1F 0X2a 3.14 <>!,=',
			'- + . === 0x 1. ..5',
			'  ',
			'',
		]) {
			assert.strictEqual(tokenText(text).join(''), text, `every character of ${JSON.stringify(text)} is kept`);
		}
	});

	test('appendHighlighted splits text into plain and marked slices', () => {
		const banana = span();
		appendHighlighted(banana, 'banana', 'a');
		assert.strictEqual(markup(banana), '<span>#"b"<mark>#"a"</>#"n"<mark>#"a"</>#"n"<mark>#"a"</></>');

		const live = span();
		setHighlightQuery('Z');
		appendHighlighted(live, 'Zebra Z');
		assert.strictEqual(markup(live), '<span><mark>#"Z"</>#"ebra "<mark>#"Z"</></>');

		const explicit = span();
		appendHighlighted(explicit, 'Zebra Z', 'a');
		assert.strictEqual(markup(explicit), '<span>#"Zebr"<mark>#"a"</>#" Z"</>', 'an explicit query wins over the live one');
	});

	test('appendHighlighted trims the query and writes plain text for a blank one', () => {
		const padded = span();
		appendHighlighted(padded, 'banana', '  a  ');
		assert.strictEqual(markup(padded), '<span>#"b"<mark>#"a"</>#"n"<mark>#"a"</>#"n"<mark>#"a"</></>');

		const blank = span();
		appendHighlighted(blank, 'a b', '   ');
		assert.strictEqual(markup(blank), '<span>#"a b"</>');
	});

	test('appendConditionTokens marks each slice across token boundaries', () => {
		const parent = span();
		appendConditionTokens(parent, 'A == 1 && B != "x"', '1 && B');
		assert.strictEqual(
			markup(parent),
			'<span>' +
				'<span class="syscond-name">#"A"</>#" "' +
				'<span class="syscond-operator">#"=="</>#" "' +
				'<span class="syscond-number"><mark>#"1"</></><mark>#" "</>' +
				'<span class="syscond-operator"><mark>#"&&"</></><mark>#" "</>' +
				'<span class="syscond-name"><mark>#"B"</></>#" "' +
				'<span class="syscond-operator">#"!="</>#" "' +
				'<span class="syscond-string">#"\\"x\\""</></>'
		);

		const crossing = span();
		appendConditionTokens(crossing, 'A == 1', 'A =');
		assert.strictEqual(
			markup(crossing),
			'<span>' +
				'<span class="syscond-name"><mark>#"A"</></><mark>#" "</>' +
				'<span class="syscond-operator"><mark>#"="</></><span class="syscond-operator">#"="</>#" "' +
				'<span class="syscond-number">#"1"</></>'
		);
	});

	test('appendConditionTokens with a blank query writes the condition tokens unmarked', () => {
		const parent = span();
		appendConditionTokens(parent, 'A == 1', '');
		assert.strictEqual(
			markup(parent),
			'<span><span class="syscond-name">#"A"</>#" "<span class="syscond-operator">#"=="</>#" "<span class="syscond-number">#"1"</></>'
		);
	});

	test('valueSpan writes the punctuation, the value token and the kind/title', () => {
		assert.strictEqual(
			markup(valueSpan({ kind: 'parameter', valueKind: 'numeric', shownValue: '42', meta: [] })),
			'<span class="value" data-value-kind="numeric" title="Value: 42 - edit in Details">' +
				'<span class="punct">#"="</>#" "<span class="value-text">#"42"</></>'
		);
		assert.strictEqual(
			markup(valueSpan({ kind: 'parameter', shownValue: '42', meta: [] }, true)),
			'<span class="value" data-value-kind="textual" title="Value: 42">' +
				'<span class="punct">#"="</>#" "<span class="value-text">#"42"</></>'
		);
		assert.strictEqual(
			markup(valueSpan({ kind: 'reference', shownValue: '/Pkg/Ref', meta: [] })),
			'<span class="value" title="Target: /Pkg/Ref">' +
				'<span class="punct">#"="</>#" "<span class="value-text">#"/Pkg/Ref"</></>'
		);
		assert.strictEqual(
			markup(valueSpan({ kind: 'parameter', meta: [] })),
			'<span class="value" data-value-kind="textual" title="Value:  - edit in Details">' +
				'<span class="punct">#"="</>#" "<span class="value-text">#""</></>',
			'an absent value keeps the empty value text node'
		);
	});

	test('valueSpan delegates the value text to an explicit writer', () => {
		const node = valueSpan({ kind: 'parameter', shownValue: '42', meta: [] }, false, '4', (target, text) => {
			target.appendChild(document.createTextNode('W:' + text));
		});
		assert.strictEqual(
			markup(node),
			'<span class="value" data-value-kind="textual" title="Value: 42 - edit in Details">' +
				'<span class="punct">#"="</>#" "<span class="value-text">#"W:42"</></>',
			'the writer owns the value text, so the search query is not applied'
		);
	});

	test('metaSpan writes every part with its class, title and state', () => {
		const meta = metaSpan({
			kind: 'parameter',
			meta: [
				{ cls: 'name', text: 'ShortName', title: 'Short name' },
				{ cls: 'condition', text: 'A == 1', title: 'Condition', state: 'false' },
				{ cls: 'context', text: 'context Pkg', title: 'Context' },
				{ cls: 'annotation', text: 'note', title: 'Annotation' },
			],
		});
		assert.strictEqual(
			markup(meta),
			'<span class="row-meta">' +
				'<span class="name" title="Short name">#"ShortName"</>' +
				'<span class="condition" data-state="false" title="Condition"><span class="syscond-name">#"A"</>#" "<span class="syscond-operator">#"=="</>#" "<span class="syscond-number">#"1"</></>' +
				'<span class="context" title="Context"><span class="keyword">#"context"</>#" "#"Pkg"</>' +
				'<span class="annotation" title="Annotation">#"note"</></>'
		);
	});

	test('metaSpan lets an explicit writer take a part and falls back for the rest', () => {
		const meta = metaSpan(
			{
				kind: 'parameter',
				meta: [
					{ cls: 'name', text: 'Kept', title: 't' },
					{ cls: 'annotation', text: 'plain', title: 't2' },
				],
			},
			'a',
			(_span, part) => part.cls === 'name'
		);
		assert.strictEqual(
			markup(meta),
			'<span class="row-meta"><span class="name" title="t"></><span class="annotation" title="t2">#"pl"<mark>#"a"</>#"in"</></>'
		);
	});
});
