import * as assert from 'assert';

import { documentSymbols, refTokenAt, refTokens } from '../../core/text/arxmlFeatures';
import { buildNodeIndex } from '../../core/ecuc/nodeId';
import { scanFixture } from './modelTestUtils';

suite('ARXML text features (core)', () => {
	test('collects every definition ref and reference target', () => {
		const model = scanFixture('basic.arxml');
		const tokens = refTokens(model);
		assert.ok(tokens.length > 0);
		assert.ok(tokens.every((token) => token.rawPath !== '' && token.range.end > token.range.start));
		assert.ok(tokens.some((token) => token.kind === 'definition'));
		assert.ok(tokens.some((token) => token.kind === 'target'));
	});

	test('finds the token under an offset', () => {
		const model = scanFixture('basic.arxml');
		const reference = model.modules[0].containers[0].references[0];
		assert.ok(reference.targetRange);
		const token = refTokenAt(model, reference.targetRange!.start);
		assert.ok(token);
		assert.strictEqual(token!.kind, 'target');
		assert.strictEqual(token!.rawPath, reference.targetRawPath);
	});

	test('builds a module/container/parameter symbol tree in declaration order', () => {
		const model = scanFixture('basic.arxml');
		const symbols = documentSymbols(model);
		assert.strictEqual(symbols.length, model.modules.length);
		assert.strictEqual(symbols[0].kind, 'module');
		assert.strictEqual(symbols[0].children.length, model.modules[0].containers.length);
		const first = symbols[0].children[0];
		assert.strictEqual(first.kind, 'container');
		assert.ok(first.range.end >= first.selectionRange.end);
	});

	test('the node index carries the AR path of a nested container', () => {
		const model = scanFixture('index/values.arxml');
		const index = buildNodeIndex(model);
		const sub = model.modules[0].containers[0].containers[0];
		const id = index.idOf(sub);
		assert.ok(id);
		assert.strictEqual(index.byId.get(id!)?.path, '/Synthetic/SampleModule/Main/Sub');
	});
});
