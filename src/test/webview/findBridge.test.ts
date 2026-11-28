import * as assert from 'assert';

import { installFindBridge, startFindController } from '../../webview/monaco/findBridge';

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

	test('restarting the widget selects the nearest match so the count is numeric', () => {
		let starts = 0;
		let moves = 0;
		const controller = {
			start: async () => {
				starts += 1;
			},
			moveToNextMatch: () => {
				moves += 1;
				return true;
			}
		};
		startFindController(
			controller,
			{
				isRevealed: true,
				isReplaceRevealed: false,
				searchString: '',
				replaceString: '',
				preserveCase: false,
				isRegex: false,
				wholeWord: false,
				matchCase: false
			},
			'ContKeep',
			{ caseSensitive: false, wholeWord: false, regex: false }
		);
		assert.strictEqual(starts, 1);
		assert.strictEqual(moves, 1, 'the closest match is selected after the engine result restarts the search');
	});

	test('a controller without match navigation still restarts the query', () => {
		let starts = 0;
		startFindController(
			{ start: async () => {
				starts += 1;
			} },
			{
				isRevealed: true,
				isReplaceRevealed: false,
				searchString: '',
				replaceString: '',
				preserveCase: false,
				isRegex: false,
				wholeWord: false,
				matchCase: false
			},
			'ContKeep',
			{ caseSensitive: false, wholeWord: false, regex: false }
		);
		assert.strictEqual(starts, 1);
	});
});
