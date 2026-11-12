/**
 * Pure Document display-state helpers: movement keys, focus resolution and
 * bracket guides. Each case is an observable rule the editor and diff share.
 */
import * as assert from 'assert';

import {
	guidesFor,
	moveTarget,
	resolveFocusId,
} from '../../../webview/components/documentTree/documentTreeState';
import type { FlatRow } from '../../../webview/render/treeQuery';

suite('Document tree state helpers', () => {
	test('moveTarget ignores an empty row set and a non-movement key', () => {
		assert.strictEqual(moveTarget('ArrowDown', 3, 0, 8), undefined, 'nothing to move to');
		assert.strictEqual(moveTarget('Escape', 3, 20, 8), undefined, 'a non-movement key reports no target');
		assert.strictEqual(moveTarget('ArrowDown', 19, 20, 8), 19, 'the last row clamps');
		assert.strictEqual(moveTarget('ArrowUp', 0, 20, 8), 0, 'the first row clamps');
		assert.strictEqual(moveTarget('PageDown', 18, 20, 8), 19, 'PageDown clamps at the last row');
		assert.strictEqual(moveTarget('PageUp', 2, 20, 8), 0, 'PageUp clamps at the first row');
	});

	test('resolveFocusId keeps a previous focus before the preferred and first rows', () => {
		assert.strictEqual(resolveFocusId(undefined, [], undefined), undefined, 'nothing rendered has no focus');
		assert.strictEqual(resolveFocusId('a', ['a', 'b'], 'b'), 'a', 'the previous row wins');
		assert.strictEqual(resolveFocusId('gone', ['a'], 'a'), 'a', 'the preferred row is next');
		assert.strictEqual(resolveFocusId('gone', ['a', 'b'], undefined), 'a', 'the first rendered row is the fallback');
		assert.strictEqual(resolveFocusId(undefined, ['a'], 'gone'), 'a', 'a missing preferred row falls back');
	});

	test('guidesFor closes only an open level and passes comments and gaps through', () => {
		const rows = [{ id: 'root' }, { id: 'a' }];
		const display: FlatRow[] = [
			{ type: 'node', rowIndex: 0, depth: 0, level: 1, expanded: true },
			{ type: 'brace-open', rowIndex: 0, level: 1 },
			{ type: 'comment', rowIndex: 1, level: 2, text: 'note' },
			{ type: 'module-gap', level: 1 },
			{ type: 'brace-close', rowIndex: 1, level: 2 },
			{ type: 'brace-close', rowIndex: 0, level: 1 },
		];
		assert.deepStrictEqual(guidesFor(display, rows), [
			[],
			[],
			[{ level: 1, id: 'root' }],
			[{ level: 1, id: 'root' }],
			[{ level: 1, id: 'root' }],
			[],
		]);

		const unmatched: FlatRow[] = [{ type: 'brace-close', rowIndex: 0, level: 9 }];
		assert.deepStrictEqual(guidesFor(unmatched, rows), [[]], 'an unmatched close leaves the open set alone');
	});
});
