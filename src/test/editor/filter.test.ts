/**
 * AC7 — the filter hides non-matching nodes at every level, matches on label,
 * short-name and value, and restoring the empty filter restores the full tree.
 *
 * `filterTree` is the same algorithm the webview runs over the DOM; the last test
 * asserts that the rendered tree carries the haystack the view compares against, so
 * the two halves cannot drift.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { FilterNode, filterTree, haystack, matchesQuery } from '../../editor/filter';
import { renderHtml } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';

const TREE: FilterNode[] = [
	{
		label: 'PkgA.PkgB.ModDefs.ModX',
		shortName: 'ModX',
		children: [
			{
				label: 'ContA',
				shortName: 'ContA',
				children: [
					{ label: 'IniValue', value: '63' },
					{ label: 'Title', value: 'hello' },
				],
			},
		],
	},
];

suite('editor filter (AC7)', () => {
	test('AC7: a match keeps the node and every ancestor', () => {
		const kept = filterTree(TREE, 'IniValue');
		assert.strictEqual(kept.length, 1, 'the module stays as the ancestor of the match');
		assert.strictEqual(kept[0].children?.length, 1, 'the container stays as its ancestor');
		assert.deepStrictEqual(kept[0].children?.[0].children?.map((n) => n.label), ['IniValue']);
	});

	test('AC7: non-matching nodes are hidden at every level', () => {
		const kept = filterTree(TREE, 'hello');
		assert.deepStrictEqual(kept[0].children?.[0].children?.map((n) => n.label), ['Title']);
		assert.deepStrictEqual(filterTree(TREE, 'nothing-matches-this'), []);
	});

	test('AC7: label, short-name and value all match', () => {
		const node = { label: 'IniValue', shortName: 'ContA', value: '63' };
		assert.ok(matchesQuery(node, 'inivalue'));
		assert.ok(matchesQuery(node, 'conta'));
		assert.ok(matchesQuery(node, '63'));
		assert.ok(!matchesQuery(node, 'nope'));
		assert.strictEqual(haystack(node), 'inivalue conta 63');
	});

	test('AC7: restoring the empty filter restores the full tree', () => {
		assert.deepStrictEqual(filterTree(TREE, ''), TREE);
		assert.deepStrictEqual(filterTree(TREE, '   '), TREE);
	});

	test('AC7: the rendered tree carries the filter box and a haystack per node', () => {
		const page = renderHtml(scanEcucValues(fixtureText('editor/render.arxml')), { nonce: 'test-nonce' });
		assert.ok(page.includes('id="filter"'));
		assert.ok(page.includes('aria-label="Filter the ECUC tree"'));
		assert.ok(page.includes('data-haystack="inivalue 63"'), 'the value is searchable');
		assert.ok(page.includes('data-haystack="conta conta"'), 'the short name is searchable');
		assert.ok(page.includes('applyFilter()'));
	});
});
