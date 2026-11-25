import * as assert from 'assert';

import {
	adjacentChangeIndex,
	displayedChangeLine,
	nextChangeIndex,
	originalChangeLine,
	previousChangeIndex,
	type DiffNavigationChange
} from '../../webview/monaco/diffNavigation';

const LINES = [7, 10, 14, 25];
const CHANGE: DiffNavigationChange = { originalStartLineNumber: 13, modifiedStartLineNumber: 5 };

suite('diff navigation', () => {
	test('Next moves strictly forward and wraps', () => {
		assert.strictEqual(nextChangeIndex(LINES, 0), 0);
		assert.strictEqual(nextChangeIndex(LINES, 7), 1);
		assert.strictEqual(nextChangeIndex(LINES, 10), 2);
		assert.strictEqual(nextChangeIndex(LINES, 25), 0);
	});

	test('Prev moves strictly backward and wraps', () => {
		assert.strictEqual(previousChangeIndex(LINES, 0), 3);
		assert.strictEqual(previousChangeIndex(LINES, 7), 3);
		assert.strictEqual(previousChangeIndex(LINES, 10), 0);
		assert.strictEqual(previousChangeIndex(LINES, 25), 2);
	});

	test('the adjacent selector handles one change and an empty list', () => {
		assert.strictEqual(adjacentChangeIndex([4], 4, 1), 0);
		assert.strictEqual(adjacentChangeIndex([4], 4, -1), 0);
		assert.strictEqual(adjacentChangeIndex([], 4, 1), -1);
	});

	test('swap changes which line each pane reveals', () => {
		assert.strictEqual(displayedChangeLine(CHANGE, false), 5);
		assert.strictEqual(originalChangeLine(CHANGE, false), 13);
		assert.strictEqual(displayedChangeLine(CHANGE, true), 13);
		assert.strictEqual(originalChangeLine(CHANGE, true), 5);
	});

	test('a pure insertion or deletion falls back to the other side', () => {
		assert.strictEqual(displayedChangeLine({ originalStartLineNumber: 0, modifiedStartLineNumber: 8 }, false), 8);
		assert.strictEqual(displayedChangeLine({ originalStartLineNumber: 8, modifiedStartLineNumber: 0 }, false), 8);
		assert.strictEqual(displayedChangeLine({ originalStartLineNumber: 8, modifiedStartLineNumber: 0 }, true), 8);
	});
});
