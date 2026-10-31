/**
 * Task design §5 — the windowed renderer's maths are pure and deterministic:
 * cumulative heights, a clamped visible range with overscan, row offsets and
 * the total scroll height. Fixed and two-height rows are both covered because
 * the Document and Tree views use different height functions.
 */
import * as assert from 'assert';

import {
	VirtualState,
	calcRowOffset,
	calcTotalHeight,
	calcVisibleRange,
	fixedRowHeight,
} from '../../../webview/render/virtualScroll';

function state(overrides: Partial<VirtualState> = {}): VirtualState {
	return {
		rowCount: 100,
		rowHeight: fixedRowHeight(20),
		containerHeight: 100,
		scrollTop: 0,
		bufferSize: 2,
		...overrides,
	};
}

suite('virtual scroll (design §5)', () => {
	test('design §5: total height and row offsets are cumulative', () => {
		const view = state();
		assert.strictEqual(calcTotalHeight(view), 2000);
		assert.strictEqual(calcRowOffset(0, view), 0);
		assert.strictEqual(calcRowOffset(1, view), 20);
		assert.strictEqual(calcRowOffset(50, view), 1000);
		assert.strictEqual(calcRowOffset(100, view), 2000, 'the row count offset is the total');
		assert.strictEqual(calcRowOffset(500, view), 2000, 'clamped past the end');
		assert.strictEqual(calcRowOffset(-3, view), 0, 'clamped before the start');
	});

	test('design §5: an empty list has no rows, offset or height', () => {
		const empty = state({ rowCount: 0 });
		assert.deepStrictEqual(calcVisibleRange(empty), [0, 0]);
		assert.strictEqual(calcTotalHeight(empty), 0);
		assert.strictEqual(calcRowOffset(0, empty), 0);
		assert.strictEqual(calcRowOffset(7, empty), 0);
	});

	test('design §5: one row is rendered even with a zero-height viewport', () => {
		const one = state({ rowCount: 1, containerHeight: 0, bufferSize: 0 });
		assert.strictEqual(calcTotalHeight(one), 20);
		assert.deepStrictEqual(calcVisibleRange(one), [0, 1]);
	});

	test('design §5: the visible range includes buffer rows on both sides', () => {
		assert.deepStrictEqual(calcVisibleRange(state({ scrollTop: 0 })), [0, 7], 'rows 0-4 plus two after');
		assert.deepStrictEqual(calcVisibleRange(state({ scrollTop: 50 })), [0, 10], 'rows 2-7 plus buffer');
		assert.deepStrictEqual(calcVisibleRange(state({ scrollTop: 50, bufferSize: 0 })), [2, 8]);
		assert.deepStrictEqual(calcVisibleRange(state({ scrollTop: 500, bufferSize: 2 })), [23, 32]);
	});

	test('design §5: a row exactly at the viewport bottom is not visible', () => {
		const view = state({ scrollTop: 100, containerHeight: 60, bufferSize: 0 });
		// Row 5 starts at 100; rows 5,6,7 start at 100,120,140. A 60px viewport ends
		// at 160, so row 7 (140-160) is visible, row 8 (160-180) is not.
		assert.deepStrictEqual(calcVisibleRange(view), [5, 8]);
	});

	test('design §5: negative and over-scrolled positions are clamped to real rows', () => {
		assert.deepStrictEqual(calcVisibleRange(state({ scrollTop: -200 })), [0, 7]);
		assert.deepStrictEqual(calcVisibleRange(state({ scrollTop: 5000 })), [97, 100], 'the last row plus buffer, never an empty range');
		assert.deepStrictEqual(
			calcVisibleRange(state({ scrollTop: 2000 })),
			[97, 100],
			'the total offset maps to the last row plus buffer'
		);
	});

	test('design §5: an invalid or zero viewport still yields at least one row', () => {
		assert.deepStrictEqual(calcVisibleRange(state({ scrollTop: 40, containerHeight: 0, bufferSize: 0 })), [2, 3]);
		assert.deepStrictEqual(calcVisibleRange(state({ scrollTop: 40, containerHeight: Number.NaN, bufferSize: 0 })), [2, 3]);
	});

	test('design §5: fixed and variable row functions compose with the maths', () => {
		const fixed = fixedRowHeight(20);
		assert.strictEqual(fixed(0), 20);
		assert.strictEqual(fixed(999), 20);

		const twoHeight = (index: number): number => (index % 2 === 1 ? 40 : 20);
		assert.strictEqual(twoHeight(0), 20);
		assert.strictEqual(twoHeight(1), 40);

		const view = state({ rowCount: 4, rowHeight: twoHeight, containerHeight: 40, scrollTop: 50, bufferSize: 0 });
		assert.strictEqual(calcTotalHeight(view), 120, '20 + 40 + 20 + 40');
		assert.strictEqual(calcRowOffset(0, view), 0);
		assert.strictEqual(calcRowOffset(1, view), 20);
		assert.strictEqual(calcRowOffset(2, view), 60);
		assert.strictEqual(calcRowOffset(3, view), 80);
		assert.strictEqual(calcRowOffset(4, view), 120);
		assert.deepStrictEqual(calcVisibleRange(view), [1, 4], 'rows 1-3 cover 50-90');
		assert.deepStrictEqual(calcVisibleRange({ ...view, scrollTop: 60 }), [2, 4], 'row 2 starts at 60');
	});

	test('design §5: a changed height version invalidates the height cache', () => {
		let height = 20;
		let version = 'document';
		const view = state({ rowCount: 10, rowHeight: () => height, heightVersion: version });
		assert.strictEqual(calcTotalHeight(view), 200);
		height = 30;
		assert.strictEqual(calcTotalHeight(view), 200, 'the unchanged key reuses the same cache entry');
		version = 'tree';
		assert.strictEqual(calcTotalHeight({ ...view, heightVersion: version }), 300, 'a new version recomputes');
	});

	test('design §5: a different height function recomputes even at the same row count', () => {
		assert.strictEqual(calcTotalHeight(state({ rowCount: 10, rowHeight: fixedRowHeight(20) })), 200);
		assert.strictEqual(calcTotalHeight(state({ rowCount: 10, rowHeight: fixedRowHeight(30) })), 300);
	});

	test('design §5: zero, negative and NaN heights do not corrupt the cumulative list', () => {
		const heights = [20, 0, -5, Number.NaN, 10];
		const view = state({ rowCount: heights.length, rowHeight: (index) => heights[index], containerHeight: 100, bufferSize: 0 });
		assert.strictEqual(calcTotalHeight(view), 30, 'only finite positive heights count');
		assert.strictEqual(calcRowOffset(1, view), 20);
		assert.strictEqual(calcRowOffset(2, view), 20, 'a zero-height row starts at the same offset');
		assert.strictEqual(calcRowOffset(4, view), 20);
		assert.strictEqual(calcRowOffset(5, view), 30);
	});
});
