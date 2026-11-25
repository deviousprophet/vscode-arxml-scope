import * as assert from 'assert';

import {
	collapsedRowKeys,
	foldTogglePlan,
	type FoldRegions
} from '../../webview/monaco/diffFolding';

function regionsOf(starts: number[], collapsed: number[]): FoldRegions {
	const folded = new Set(collapsed);
	return {
		length: starts.length,
		getStartLineNumber: (index) => starts[index],
		isCollapsed: (index) => folded.has(index),
		findRange: (line) => starts.findIndex((start, index) => {
			const end = index + 1 < starts.length ? starts[index + 1] - 1 : Number.MAX_SAFE_INTEGER;
			return line >= start && line <= end;
		})
	};
}

suite('diff folding', () => {
	test('collapsed row keys follow the node line keys', () => {
		const regions = regionsOf([1, 2, 3], [0, 2]);
		assert.deepStrictEqual([...collapsedRowKeys(regions, ['module', 'container', 'child'])], [
			'module',
			'child'
		]);
	});

	test('only differing keys are planned and one-sided keys are skipped', () => {
		const target = regionsOf([2, 10], []);
		const plan = foldTogglePlan(
			new Set(['module', 'missing']),
			new Set(),
			new Map([
				['module', 2],
				['container', 10]
			]),
			target
		);
		assert.deepStrictEqual(plan, [0]);
	});

	test('an expanded source plans the target expansion', () => {
		const target = regionsOf([2, 10], [0]);
		const plan = foldTogglePlan(new Set(), new Set(['module']), new Map([['module', 2]]), target);
		assert.deepStrictEqual(plan, [0]);
	});

	test('equal states plan no toggles', () => {
		const target = regionsOf([2, 10], [1]);
		assert.deepStrictEqual(
			foldTogglePlan(new Set(['container']), new Set(['container']), new Map([['container', 10]]), target),
			[]
		);
	});
});
