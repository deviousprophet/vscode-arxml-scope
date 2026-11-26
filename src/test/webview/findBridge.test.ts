import * as assert from 'assert';

import { installFindBridge } from '../../webview/monaco/findBridge';

suite('native find bridge', () => {
	test('an empty query does not ask the host or return a match', () => {
		let matches = 0;
		let requests = 0;
		const model = {
			findMatches: (..._args: unknown[]) => [] as unknown[],
			findNextMatch: (..._args: unknown[]) => null,
			findPreviousMatch: (..._args: unknown[]) => null
		};
		installFindBridge(
			model as never,
			{
				options: () => ({}) as never,
				matches: () => {
					matches += 1;
					return [];
				},
				request: () => {
					requests += 1;
				}
			}
		);

		assert.deepStrictEqual(model.findMatches('', null, false, false, null, false, 100), []);
		assert.strictEqual(matches, 0);
		assert.strictEqual(requests, 0);
		assert.strictEqual(model.findNextMatch('', null, false, false, null, false), null);
		assert.strictEqual(model.findPreviousMatch('', null, false, false, null, false), null);
		assert.strictEqual(matches, 0);
		assert.strictEqual(requests, 0);
	});
});
