/**
 * The rebuild guard: a read issued before a rebuild must not apply its result.
 */
import * as assert from 'assert';

import { RebuildGuard } from '../../core/index/rebuildGuard';

suite('rebuild guard', () => {
	test('a rebuild invalidates reads that began before it', () => {
		const guard = new RebuildGuard();
		const read = guard.beginRead();
		assert.strictEqual(guard.isStale(read), false);
		guard.beginRebuild();
		assert.strictEqual(guard.isStale(read), true);
	});

	test('a read that starts after a rebuild is current', () => {
		const guard = new RebuildGuard();
		guard.beginRebuild();
		const read = guard.beginRead();
		assert.strictEqual(guard.isStale(read), false);
	});

	test('each rebuild invalidates the previous generation', () => {
		const guard = new RebuildGuard();
		guard.beginRebuild();
		const read = guard.beginRead();
		guard.beginRebuild();
		assert.strictEqual(guard.isStale(read), true);
	});
});
