import * as assert from 'assert';

import { Range } from '../../core/ecuc/model';
import { resolvePath } from '../../core/ecuc/resolve';
import { scanFixture } from './modelTestUtils';

suite('resolve (core)', () => {
	test('AC7: exact match wins', () => {
		const index = scanFixture('references.arxml').pathIndex;
		assert.deepStrictEqual(resolvePath(index, '/P/M/C1'), { start: 365, end: 518 });
		assert.deepStrictEqual(resolvePath(index, '/P/M/X/Dup'), { start: 694, end: 863 });
	});

	test('AC7: a unique suffix resolves', () => {
		const index = scanFixture('references.arxml').pathIndex;
		// `/M/C1` matches only `/P/M/C1`.
		assert.deepStrictEqual(resolvePath(index, '/M/C1'), { start: 365, end: 518 });
		// `/Y/Dup` matches only `/P/M/Y/Dup`.
		assert.deepStrictEqual(resolvePath(index, '/Y/Dup'), { start: 1107, end: 1276 });
		assert.deepStrictEqual(resolvePath(index, '/X/Dup'), { start: 694, end: 863 });
	});

	test('AC7: an ambiguous suffix resolves to nothing', () => {
		const index = scanFixture('references.arxml').pathIndex;
		assert.strictEqual(resolvePath(index, '/Dup'), undefined);
		assert.strictEqual(resolvePath(index, 'Dup'), undefined);
		assert.strictEqual(index.has('/P/M/X/Dup') && index.has('/P/M/Y/Dup'), true, 'fixture must be ambiguous');
	});

	test('AC7: an absent path resolves to nothing', () => {
		const index = scanFixture('references.arxml').pathIndex;
		assert.strictEqual(resolvePath(index, '/P/M/NotThere'), undefined);
		assert.strictEqual(resolvePath(index, '/Nope/Nope'), undefined);
		assert.strictEqual(resolvePath(index, ''), undefined);
		assert.strictEqual(resolvePath(index, '/'), undefined);
	});

	test('the dotted display path is never resolved', () => {
		const index = scanFixture('basic.arxml').pathIndex;
		assert.ok(index.has('/PkgA/ModA/ContA'), 'the raw path is indexed');
		assert.strictEqual(resolvePath(index, 'PkgA.ModA.ContA'), undefined);
		assert.strictEqual(resolvePath(index, 'PkgA/ModA/ContA'), index.get('/PkgA/ModA/ContA'));
	});

	test('the longest matching suffix of the target wins', () => {
		const index = new Map<string, Range>([
			['/A/B', { start: 1, end: 2 }],
			['/C/A/B', { start: 3, end: 4 }],
		]);
		// `/X/Y/C/A/B` -> the longest suffix that is an index key is `/C/A/B`.
		assert.deepStrictEqual(resolvePath(index, '/X/Y/C/A/B'), { start: 3, end: 4 });
		assert.deepStrictEqual(resolvePath(index, '/Q/A/B'), { start: 1, end: 2 });
		assert.deepStrictEqual(resolvePath(index, '/A/B'), { start: 1, end: 2 });
	});

	test('an ambiguous suffix refuses even when a shorter suffix would be unique', () => {
		const index = new Map<string, Range>([
			['/C/A/B', { start: 3, end: 4 }],
			['/D/A/B', { start: 5, end: 6 }],
		]);
		assert.strictEqual(resolvePath(index, '/Z/A/B'), undefined);
	});
});
