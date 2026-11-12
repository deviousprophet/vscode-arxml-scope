import * as assert from 'assert';

import { LineIndex, LineStartBuilder, positionAtLineStarts } from '../../core/text/offsets';

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

	test('the stream builder matches LineIndex across CRLF, LF and lone CR', () => {
		const text = 'a\r\nb\rc\nd';
		const expected = new LineIndex(text).starts;
		for (const chunks of [
			[text],
			['a\r', '\nb', '\rc', '\nd'],
			['a', '\r', '\n', 'b\r', 'c\n', 'd'],
		]) {
			const builder = new LineStartBuilder();
			for (const chunk of chunks) {
				builder.write(chunk);
			}
			assert.deepStrictEqual(builder.finish(), expected, JSON.stringify(chunks));
		}
	});

	test('astral characters count as two UTF-16 units', () => {
		const text = '😀x\n😀';
		assert.strictEqual(text.length, 6);
		const index = new LineIndex(text);
		assert.strictEqual(index.lineCount, 2);
		assert.deepStrictEqual(index.positionAt(0), { line: 0, character: 0 });
		// Between the surrogate halves, as VS Code reports it.
		assert.deepStrictEqual(index.positionAt(1), { line: 0, character: 1 });
		assert.deepStrictEqual(index.positionAt(2), { line: 0, character: 2 });
		assert.deepStrictEqual(index.positionAt(4), { line: 1, character: 0 });
		assert.deepStrictEqual(index.positionAt(6), { line: 1, character: 2 });
	});

	test('a trailing CR at a chunk boundary is flushed by finish', () => {
		const split = new LineStartBuilder();
		split.write('a\r');
		split.write('\nb');
		assert.deepStrictEqual(split.finish(), [0, 3]);

		const trailing = new LineStartBuilder();
		trailing.write('a\r');
		assert.deepStrictEqual(trailing.finish(), [0, 2]);

		const pendingOnly = new LineStartBuilder();
		pendingOnly.write('\r');
		assert.deepStrictEqual(pendingOnly.finish(), [0, 1]);
	});

	test('a missing or empty line table degrades to line zero', () => {
		assert.deepStrictEqual(positionAtLineStarts(undefined, 5), { line: 0, character: 5 });
		assert.deepStrictEqual(positionAtLineStarts(undefined, -5, 10), { line: 0, character: 0 });
		assert.deepStrictEqual(positionAtLineStarts([], 999, 6), { line: 0, character: 6 });
		assert.deepStrictEqual(positionAtLineStarts([0, 4], 999, 6), { line: 1, character: 2 });
	});
});
