/**
 * AC9 — the filter reports what it did: how many of how many, an explicit empty state,
 * matches highlighted, and the ancestors of a match shown while the collapsed set is
 * restored when the filter is cleared.
 *
 * There is no webview DOM here, so the assertions are on `matchRanges` itself and on the
 * inlined script, with the inlined `matchRanges` compiled and driven so the view's copy
 * is the one under test. The `<mark>` elements a live webview would build, and the
 * visibility pass it would run, are not exercised — that is recorded in
 * `implement.md` §Manual verification.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { filterScript, haystack, matchRanges, matchesQuery } from '../../editor/filter';
import { renderHtml } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';
import { evaluateFunction, functionSource } from './scriptTestUtils';

const FIXTURE = 'editor/render.arxml';

function page(): string {
	return renderHtml(scanEcucValues(fixtureText(FIXTURE)), { nonce: 'test-nonce' });
}

suite('editor filter feedback (AC9)', () => {
	test('AC9: matchRanges finds every occurrence, case-insensitively', () => {
		assert.deepStrictEqual(matchRanges('IniValue', 'inivalue'), [{ start: 0, end: 8 }]);
		assert.deepStrictEqual(matchRanges('IniValue', 'i'), [
			{ start: 0, end: 1 },
			{ start: 2, end: 3 },
		]);
		assert.deepStrictEqual(matchRanges('aba', 'a'), [
			{ start: 0, end: 1 },
			{ start: 2, end: 3 },
		]);
		assert.deepStrictEqual(matchRanges('abc', 'zzz'), [], 'no match');
		assert.deepStrictEqual(matchRanges('abc', ''), [], 'the empty query matches nothing here');
		assert.deepStrictEqual(matchRanges('abc', '   '), [], 'and neither does a blank one');
	});

	test('AC9: filtering and highlighting share the one definition of a match', () => {
		const node = { label: 'IniValue', shortName: 'ContA', value: '63' };
		for (const query of ['inivalue', 'conta', '63', '', 'nope']) {
			assert.strictEqual(
				matchesQuery(node, query),
				query.trim() === '' || matchRanges(haystack(node), query).length > 0,
				query
			);
		}
		assert.ok(matchesQuery(node, 'IniValue'), 'the label matches');
		assert.ok(matchesQuery(node, 'conta'), 'the short-name matches');
		assert.ok(matchesQuery(node, '63'), 'the value matches');
		assert.ok(matchesQuery(node, '   '), 'an empty query keeps everything');
		assert.ok(!matchesQuery(node, 'zzz'));

		// The page's own matchRanges is the same function, so the highlight cannot
		// disagree with the visibility pass about why a row is shown.
		const inlined = evaluateFunction<typeof matchRanges>(page(), 'matchRanges');
		for (const [text, query] of [
			['IniValue', 'i'],
			['aba', 'a'],
			['abc', 'zzz'],
			['abc', ''],
		] as Array<[string, string]>) {
			assert.deepStrictEqual(inlined(text, query), matchRanges(text, query), `${text} / ${query}`);
		}
	});

	test('AC9: the view reports shown-of-total and an explicit empty state', () => {
		const apply = functionSource(filterScript(), 'applyFilter');
		assert.ok(apply.includes("'No matches'"), 'an empty result says so');
		assert.ok(apply.includes("shown + ' of ' + items.length"), 'otherwise shown of total');
		assert.ok(
			apply.includes("document.querySelectorAll('#tree [role=\"treeitem\"]')"),
			'the total is every item, not the number of matches'
		);
		assert.ok(apply.includes('if (shown === 0)'), 'the empty state is its own branch');
		assert.ok(apply.includes("if (needle === '')"), 'and an empty filter clears the count');

		const html = page();
		assert.ok(html.includes('id="count"'), 'the count has a home');
		assert.ok(html.includes('role="status" aria-live="polite"'), 'and is announced politely');
	});

	test('AC9: matches are wrapped in a highlight element, and the original is kept', () => {
		const highlight = functionSource(filterScript(), 'highlightSpan');
		assert.ok(highlight.includes("document.createElement('mark')"), 'a real highlight element');
		assert.ok(highlight.includes('matchRanges('), 'the ranges come from the shared definition');
		assert.ok(highlight.includes('span.dataset.text'), 'the original text is preserved');
		assert.ok(highlight.includes('span.dataset.highlighted'), 'so re-applying does not wrap twice');
		assert.ok(highlight.includes('delete span.dataset.highlighted'), 'and clearing restores the text');
	});

	test('AC9: the ancestors of a match are shown, and the collapsed set is left alone', () => {
		const script = filterScript();
		const apply = functionSource(script, 'applyFilter');
		assert.ok(apply.includes('ancestors.add('), 'an ancestor of a match is collected');
		assert.ok(apply.includes('applyCollapsed(ancestors)'), 'and expanded through the override');
		assert.ok(apply.includes('if (show && descendant && !self)'), 'only a pure ancestor is overridden');
		assert.ok(
			!/\bcollapsed\s*=/.test(script),
			'the filter never writes the collapsed set, which is what makes clearing restore it'
		);
		// The override is passed on every pass, so clearing it (the empty query) restores
		// exactly the collapsed set the user built.
		assert.strictEqual((apply.match(/applyCollapsed\(/g) ?? []).length, 1, 'one visibility pass, one override');
	});

	test('AC9: Escape clears the filter and the filter runs on load', () => {
		const script = filterScript();
		assert.ok(script.includes("event.key === 'Escape'"));
		assert.ok(script.includes("filterInput.value = ''"), 'Escape empties the box');
		assert.ok(script.includes('filterInput.addEventListener('), 'and the clear re-runs the pass');
		assert.ok(page().includes('applyFilter();'), 'the filter is applied when the page loads');
	});
});
