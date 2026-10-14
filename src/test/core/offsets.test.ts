import * as assert from 'assert';

import { LineIndex } from '../../core/text/offsets';

suite('offsets (core)', () => {
	test('LF document: first line, boundaries, last line', () => {
		const text = 'a\nbb\nccc';
		const index = new LineIndex(text);
		assert.strictEqual(index.lineCount, 3);
		assert.deepStrictEqual(index.positionAt(0), { line: 0, character: 0 });
		assert.deepStrictEqual(index.positionAt(1), { line: 0, character: 1 });
		// Offset at a line boundary belongs to the line it starts.
		assert.deepStrictEqual(index.positionAt(2), { line: 1, character: 0 });
		assert.deepStrictEqual(index.positionAt(4), { line: 1, character: 2 });
		assert.deepStrictEqual(index.positionAt(5), { line: 2, character: 0 });
		assert.deepStrictEqual(index.positionAt(8), { line: 2, character: 3 });
		// Beyond the end clamps to the end of the last line.
		assert.deepStrictEqual(index.positionAt(999), { line: 2, character: 3 });
		assert.deepStrictEqual(index.positionAt(-5), { line: 0, character: 0 });
	});

	test('CRLF document: the break counts as two offsets', () => {
		const text = 'a\r\nbb\r\nccc';
		assert.strictEqual(text.length, 10);
		const index = new LineIndex(text);
		assert.strictEqual(index.lineCount, 3);
		assert.deepStrictEqual(index.positionAt(0), { line: 0, character: 0 });
		assert.deepStrictEqual(index.positionAt(1), { line: 0, character: 1 });
		assert.deepStrictEqual(index.positionAt(2), { line: 0, character: 2 });
		// Line 1 starts after the two-character break.
		assert.deepStrictEqual(index.positionAt(3), { line: 1, character: 0 });
		assert.deepStrictEqual(index.positionAt(5), { line: 1, character: 2 });
		assert.deepStrictEqual(index.positionAt(6), { line: 1, character: 3 });
		assert.deepStrictEqual(index.positionAt(7), { line: 2, character: 0 });
		assert.deepStrictEqual(index.positionAt(10), { line: 2, character: 3 });
		assert.deepStrictEqual(index.positionAt(11), { line: 2, character: 3 });
	});

	test('the same text position yields the same line for LF and CRLF', () => {
		const lf = new LineIndex('one\ntwo\n');
		const crlf = new LineIndex('one\r\ntwo\r\n');
		for (const doc of [lf, crlf]) {
			assert.deepStrictEqual(doc.positionAt(0), { line: 0, character: 0 });
			assert.deepStrictEqual(doc.positionAt(2), { line: 0, character: 2 });
			assert.deepStrictEqual(doc.positionAt(doc === lf ? 4 : 5), { line: 1, character: 0 });
		}
		assert.strictEqual(lf.lineCount, 3);
		assert.strictEqual(crlf.lineCount, 3);
	});

	test('a lone carriage return starts a new line, and an empty document has one line', () => {
		const lone = new LineIndex('a\rb');
		assert.strictEqual(lone.lineCount, 2);
		assert.deepStrictEqual(lone.positionAt(2), { line: 1, character: 0 });
		const empty = new LineIndex('');
		assert.strictEqual(empty.lineCount, 1);
		assert.deepStrictEqual(empty.positionAt(0), { line: 0, character: 0 });
	});
});
