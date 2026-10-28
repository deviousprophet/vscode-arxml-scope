/**
 * AC9 — the filter reports what it did: how many of how many, an explicit empty state,
 * matches highlighted, and the ancestors of a match shown while the collapsed set is
 * restored when the filter is cleared.
 *
 * There is no webview DOM here, so the assertions are on `matchRanges`/`filterRows`
 * themselves and on the inlined page script, with the page's own filtered/flattened
 * copy compiled and driven. The `<mark>` elements a live webview would build are
 * recorded in `implement.md` as browser-observed.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { buildFilterIndex, filterRows, flattenRows, haystack, matchRanges, matchesQuery } from '../../editor/filter';
import { RowPayload, renderHtml } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';
import { evaluateFunction, functionSource } from './scriptTestUtils';

const FIXTURE = 'editor/render.arxml';

function page(): string {
	return renderHtml(scanEcucValues(fixtureText(FIXTURE)), { nonce: 'test-nonce' });
}

function payload(source = page()): RowPayload {
	const match = /<script type="application\/json" id="ecuc-rows"[^>]*>([\s\S]*?)<\/script>/.exec(source);
	assert.ok(match, 'the page embeds the row document');
	return JSON.parse(match[1]) as RowPayload;
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

	test('AC9: the page reports shown-of-total and an explicit empty state', () => {
		const html = page();
		const apply = functionSource(html, 'updateFilterUi');
		assert.ok(apply.includes("'No matches'"), 'an empty result says so');
		assert.ok(apply.includes("filterResult.visibleCount + ' of ' + rows.length"), 'otherwise shown of total');
		assert.ok(apply.includes('filterResult.matchCount === 0'), 'the empty state is its own branch');
		assert.ok(apply.includes("if (!active)"), 'and an empty filter clears the count');
		assert.ok(html.includes('id="count"'), 'the count has a home');
		assert.ok(html.includes('role="status" aria-live="polite"'), 'and is announced politely');

		// The row engine's visible count is what that label shows: matches + ancestors.
		const rows = payload(html).rows;
		const result = filterRows(rows, 'IniValue', buildFilterIndex(rows));
		assert.strictEqual(result.matchCount, 1);
		assert.strictEqual(result.visibleCount, 3, 'the module and container are ancestors of the match');
	});

	test('AC9: matches are wrapped in a highlight element only while rendering rows', () => {
		const html = page();
		const highlight = functionSource(html, 'appendHighlighted');
		assert.ok(highlight.includes('matchRanges('), 'the ranges come from the shared definition');
		assert.ok(highlight.includes("document.createElement('mark')"), 'a real highlight element');
		const render = functionSource(html, 'renderWindow');
		assert.ok(render.includes('buildDisplayRow('), 'highlights are applied while the window is built');
		assert.ok(!html.includes('dataset.highlighted'), 'offscreen rows are never touched');
		const refresh = functionSource(html, 'refreshFilter');
		assert.ok(refresh.includes('filterRows(rows, query, filterIndex)'), 'the filter scans the row index');
		assert.ok(
			!refresh.includes('querySelectorAll') && !refresh.includes('getElementById'),
			'the filter never walks or toggles the rendered DOM'
		);
	});

	test('AC9: the ancestors of a match are shown, and the collapsed set is left alone', () => {
		const html = page();
		const rows = payload(html).rows;
		const collapsed = new Set([rows[0].id]);
		const result = filterRows(rows, 'IniValue', buildFilterIndex(rows));
		const flat = flattenRows(rows, { collapsed, visible: result.visible });
		const matchIndex = rows.findIndex((row) => row.label === 'IniValue');
		assert.ok(matchIndex >= 0);
		assert.ok(flat.some((row) => row.type === 'node' && row.rowIndex === matchIndex), 'the match is reachable');
		assert.deepStrictEqual(Array.from(collapsed), [rows[0].id], 'the saved collapsed set is untouched');

		const inlined = evaluateFunction<typeof filterRows>(html, 'filterRows');
		assert.deepStrictEqual(inlined(rows, 'IniValue', buildFilterIndex(rows)).visible, result.visible);

		const apply = functionSource(html, 'applyFilterQuery');
		assert.ok(!/\bcollapsed\s*=/.test(apply), 'the filter never writes the collapsed set');
		const clear = functionSource(html, 'clearFilter');
		assert.ok(clear.includes("filterInput.value = ''"), 'clearing restores the box');
		assert.ok(clear.includes("applyFilterQuery('')"), 'and re-runs the empty query');
	});

	test('AC9: Escape clears the filter and the input is debounced before it runs', () => {
		const html = page();
		assert.ok(html.includes("event.key === 'Escape'"));
		assert.ok(html.includes("filterInput.value = ''"), 'Escape empties the box');
		assert.ok(html.includes('filterDebouncer.schedule(filterInput.value'), 'typing is debounced');
		assert.ok(html.includes('createFilterDebouncer(120)'), 'with the 120 ms window');
		assert.ok(html.includes('filterDebouncer.isCurrent(generation)'), 'and stale generations are discarded');
		assert.ok(html.includes("event.target.closest('#empty-clear')"), 'the empty action clears the filter');
	});
});
