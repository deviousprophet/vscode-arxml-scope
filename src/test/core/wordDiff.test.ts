/**
 * The pure word diff behind the diff page's inline changed-word highlight.
 *
 * The tokenizer and the LCS are asserted through the exported segment pair: a
 * token boundary is visible wherever two adjacent segments split, and the
 * changed flag is the only contract the renderer reads.
 */
import * as assert from 'assert';

import { diffWords } from '../../core/diff/wordDiff';

function text(segments: readonly { text: string; changed: boolean }[]): string {
	return segments.map((segment) => segment.text).join('');
}

suite('word diff', () => {
	test('an identical pair is one unchanged segment per side', () => {
		const pair = diffWords('Timeout', 'Timeout');
		assert.deepStrictEqual(pair.left, [{ text: 'Timeout', changed: false }]);
		assert.deepStrictEqual(pair.right, [{ text: 'Timeout', changed: false }]);
		assert.notStrictEqual(pair.left, pair.right, 'the two sides never share an array');
		const empty = diffWords('', '');
		assert.deepStrictEqual(empty, { left: [], right: [] });
	});

	test('changed tokens are marked and the surrounding text stays unchanged', () => {
		const pair = diffWords('Timeout 100', 'Timeout 200');
		assert.deepStrictEqual(pair.left, [
			{ text: 'Timeout ', changed: false },
			{ text: '100', changed: true },
		]);
		assert.deepStrictEqual(pair.right, [
			{ text: 'Timeout ', changed: false },
			{ text: '200', changed: true },
		]);
	});

	test('an empty side marks the whole other side changed', () => {
		assert.deepStrictEqual(diffWords('', 'Added'), {
			left: [],
			right: [{ text: 'Added', changed: true }],
		});
		assert.deepStrictEqual(diffWords('Gone', ''), {
			left: [{ text: 'Gone', changed: true }],
			right: [],
		});
	});

	test('each punctuation character is its own token', () => {
		const pair = diffWords('(a)', '(b)');
		assert.deepStrictEqual(pair.left, [
			{ text: '(', changed: false },
			{ text: 'a', changed: true },
			{ text: ')', changed: false },
		]);
		assert.deepStrictEqual(pair.right, [
			{ text: '(', changed: false },
			{ text: 'b', changed: true },
			{ text: ')', changed: false },
		]);
	});

	test('a path keeps the shared prefix and marks only the changed segment', () => {
		const pair = diffWords('/Pkg/Diff', '/Pkg/Other');
		assert.deepStrictEqual(pair.left, [{ text: '/Pkg/', changed: false }, { text: 'Diff', changed: true }]);
		assert.deepStrictEqual(pair.right, [{ text: '/Pkg/', changed: false }, { text: 'Other', changed: true }]);
		// The slashes are tokens: a changed identifier after the last slash does
		// not drag the prefix into the changed run.
		const inside = diffWords('/Pkg/Diff', '/PkgX/Diff');
		assert.deepStrictEqual(inside.left, [
			{ text: '/', changed: false },
			{ text: 'Pkg', changed: true },
			{ text: '/Diff', changed: false },
		]);
		assert.deepStrictEqual(inside.right, [
			{ text: '/', changed: false },
			{ text: 'PkgX', changed: true },
			{ text: '/Diff', changed: false },
		]);
	});

	test('a hex literal stays one identifier token', () => {
		const pair = diffWords('0x1F', '0x1E');
		assert.deepStrictEqual(pair.left, [{ text: '0x1F', changed: true }]);
		assert.deepStrictEqual(pair.right, [{ text: '0x1E', changed: true }]);
	});

	test('the longest common subsequence skips a removed word', () => {
		const pair = diffWords('A B C', 'A C');
		assert.deepStrictEqual(pair.left, [
			{ text: 'A ', changed: false },
			{ text: 'B ', changed: true },
			{ text: 'C', changed: false },
		]);
		assert.deepStrictEqual(pair.right, [{ text: 'A C', changed: false }]);
	});

	test('adjacent changed tokens merge into one segment', () => {
		const pair = diffWords('abc', 'xyz');
		assert.deepStrictEqual(pair.left, [{ text: 'abc', changed: true }]);
		assert.deepStrictEqual(pair.right, [{ text: 'xyz', changed: true }]);
	});

	test('whitespace is preserved exactly on both sides', () => {
		const pair = diffWords('a  b', 'a  c');
		assert.strictEqual(text(pair.left), 'a  b');
		assert.strictEqual(text(pair.right), 'a  c');
		assert.deepStrictEqual(pair.left, [
			{ text: 'a  ', changed: false },
			{ text: 'b', changed: true },
		]);
	});
});
