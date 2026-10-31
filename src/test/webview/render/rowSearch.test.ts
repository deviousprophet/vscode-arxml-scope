/**
 * The chunked row-search engine: timing, cancellation, progress and large-row
 * performance. The page serializes this exact class into the webview.
 */
import * as assert from 'assert';

import {
	RowSearchEngine,
	SEARCH_CHUNK_BUDGET_MS,
	SEARCH_DEBOUNCE_MS,
	SEARCH_PROGRESS_THROTTLE_MS,
	SEARCH_ROW_BATCH,
	rowSearchScript,
} from '../../../webview/render/rowSearch';
import { TreeRow } from '../../../webview/render/treeQuery';

function row(at: number, text = 'row ' + at): TreeRow {
	return {
		id: 'r' + at,
		parentId: null,
		level: 1,
		subtreeSize: 0,
		hasChildren: false,
		haystack: text,
	};
}

function complete(engine: RowSearchEngine, rows: readonly TreeRow[], query: string, immediate = true): Promise<number[]> {
	return new Promise((resolve) => {
		engine.search(rows, query, { onComplete: resolve }, immediate);
	});
}

suite('row search engine', () => {
	test('matches row haystacks case-insensitively and returns row indices', async () => {
		const rows = [row(0, 'alpha'), row(1, 'cont a'), row(2, 'alpine'), row(3, 'cont b')];
		assert.deepStrictEqual(await complete(new RowSearchEngine(), rows, 'CONT'), [1, 3]);
		assert.deepStrictEqual(await complete(new RowSearchEngine(), rows, 'nope'), []);
		assert.deepStrictEqual(await complete(new RowSearchEngine(), rows, '   '), []);
	});

	test('the timing model mirrors the reference engine', () => {
		assert.strictEqual(SEARCH_DEBOUNCE_MS, 120);
		assert.strictEqual(SEARCH_CHUNK_BUDGET_MS, 24);
		assert.strictEqual(SEARCH_PROGRESS_THROTTLE_MS, 150);
		assert.strictEqual(SEARCH_ROW_BATCH, 512);
		const script = rowSearchScript();
		assert.ok(script.includes('class RowSearchEngine'));
		assert.ok(script.includes('SEARCH_DEBOUNCE_MS = 120'));
		assert.ok(script.includes('SEARCH_CHUNK_BUDGET_MS = 24'));
	});

	test('progress streams partial matches and always finishes with the full set', async () => {
		const rows = Array.from({ length: 1000 }, (_, at) => row(at, at % 500 === 0 ? 'needle ' + at : 'row ' + at));
		const updates: number[][] = [];
		const engine = new RowSearchEngine({ budgetMs: 0, progressMs: 0, batchSize: 100 });
		const final = await new Promise<number[]>((resolve) => {
			engine.search(rows, 'needle', {
				onProgressUpdate: (matches) => updates.push(matches),
				onComplete: resolve,
			});
		});
		assert.ok(updates.length > 1, 'the scan yields between chunks');
		assert.ok(updates.some((matches) => matches.length > 0 && matches.length < 2), 'partial progress is reported');
		assert.deepStrictEqual(final, [0, 500]);
		assert.deepStrictEqual(updates.at(-1), [0, 500], 'the last progress is the full set');
	});

	test('a new query cancels the previous run', async () => {
		const engine = new RowSearchEngine({ debounceMs: 1, budgetMs: 0, batchSize: 100 });
		let firstDone = 0;
		let secondDone = 0;
		engine.search(Array.from({ length: 5000 }, (_, at) => row(at)), 'never', {
			onComplete: () => {
				firstDone++;
			},
		});
		const second = new Promise<number[]>((resolve) => {
			engine.search(Array.from({ length: 20 }, (_, at) => row(at)), 'row 19', {
				onComplete: (matches) => {
					secondDone++;
					resolve(matches);
				},
			});
		});
		assert.deepStrictEqual(await second, [19]);
		assert.strictEqual(firstDone, 0, 'the cancelled run never completes');
		assert.strictEqual(secondDone, 1);
	});

	test('a 150k-row scan completes without per-row clock overhead', async () => {
		const rows = Array.from({ length: 150_000 }, (_, at) =>
			row(at, at === 149_999 ? 'needle at the end' : 'row ' + at)
		);
		const started = performance.now();
		const matches = await complete(new RowSearchEngine(), rows, 'needle');
		const elapsed = performance.now() - started;
		assert.deepStrictEqual(matches, [149_999]);
		assert.ok(elapsed < 1500, `150k rows took ${Math.round(elapsed)} ms`);
	});
});
