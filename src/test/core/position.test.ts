import * as assert from 'assert';

import { positionAt } from '../../core/validation/position';

suite('validation positions (core)', () => {
	test('maps LF offsets to line and character', () => {
		const starts = [0, 6, 12];
		assert.deepStrictEqual(positionAt(starts, 0), { line: 0, character: 0 });
		assert.deepStrictEqual(positionAt(starts, 5), { line: 0, character: 5 });
		assert.deepStrictEqual(positionAt(starts, 6), { line: 1, character: 0 });
		assert.deepStrictEqual(positionAt(starts, 13), { line: 2, character: 1 });
	});

	test('maps CRLF offsets after the LF', () => {
		const starts = [0, 7];
		assert.deepStrictEqual(positionAt(starts, 6), { line: 0, character: 6 });
		assert.deepStrictEqual(positionAt(starts, 7), { line: 1, character: 0 });
	});

	test('a missing table falls back to the first line', () => {
		assert.deepStrictEqual(positionAt(undefined, 9), { line: 0, character: 9 });
	});
});
