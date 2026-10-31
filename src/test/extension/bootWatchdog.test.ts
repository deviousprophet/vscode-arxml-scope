/**
 * AC3 — the host-side boot watchdog, driven directly so the timeout path has a
 * test of its own: a page that never reports `ready` is warned about once, and a
 * page that reports in (or a panel that closes) is not.
 */
import * as assert from 'assert';

import { watchBoot } from '../../host/bootWatchdog';

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

suite('boot watchdog (editor)', () => {
	test('AC3: a page that never reports in is warned about once', async () => {
		let warnings = 0;
		const boot = watchBoot(() => warnings++, 5);
		await wait(60);
		assert.strictEqual(warnings, 1, 'the silent page is reported exactly once');
		boot.dispose();
		assert.strictEqual(warnings, 1, 'disposal after the warning reports nothing more');
	});

	test('AC3: a page that reports ready is never warned about', async () => {
		let warnings = 0;
		const boot = watchBoot(() => warnings++, 5);
		boot.settle();
		await wait(60);
		assert.strictEqual(warnings, 0, 'the ready message cancels the warning');
	});

	test('AC3: a panel disposed before boot is never warned about', async () => {
		let warnings = 0;
		const boot = watchBoot(() => warnings++, 5);
		boot.dispose();
		await wait(60);
		assert.strictEqual(warnings, 0, 'a closed panel is not a failed page');
	});
});
