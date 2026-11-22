import * as assert from 'assert';

import { tokenizeEcucLine } from '../../webview/monaco/tokens';

function types(line: string): string[] {
	return tokenizeEcucLine(line).map((token) => token.type);
}

suite('semantic tokens for the synthetic ECUC document', () => {
	test('module, container and parameter labels use distinct token types', () => {
		assert.deepStrictEqual(types('module P.Preview "Preview"'), ['keyword', 'variable', 'string']);
		assert.deepStrictEqual(types('    Items "Items"'), ['type', 'string']);
		assert.deepStrictEqual(types('        P0000 = 42'), ['variable', 'operator', 'number']);
		assert.deepStrictEqual(types('        Flag = true'), ['variable', 'operator', 'keyword']);
		assert.deepStrictEqual(types('        Ref = /Pkg/Items'), ['variable', 'operator', 'function']);
	});

	test('values, comments, headers, braces and meta stay separate', () => {
		assert.deepStrictEqual(types('        Text = hello "quoted"'), ['variable', 'operator', 'string', 'string']);
		assert.deepStrictEqual(types('        Flags = 0b00000001'), ['variable', 'operator', 'number']);
		assert.deepStrictEqual(types('        Flags = 0B1010'), ['variable', 'operator', 'number']);
		assert.deepStrictEqual(types('        Next = PkgManual.ManualMod.Row002'), [
			'variable',
			'operator',
			'function'
		]);
		assert.deepStrictEqual(types('        Next = /PkgManual/ManualMod/Row002'), [
			'variable',
			'operator',
			'function'
		]);
		assert.deepStrictEqual(types('    /* note */'), ['comment']);
		assert.deepStrictEqual(types('schema 00048'), ['keyword', 'number']);
		assert.deepStrictEqual(types('package PkgA.Mod'), ['keyword', 'namespace']);
		assert.deepStrictEqual(types('{'), ['delimiter']);
		assert.deepStrictEqual(types('    Items "Items" { }'), ['type', 'string', 'delimiter']);
		assert.deepStrictEqual(types('        Condition = 1 [FEATURE == true]'), [
			'variable',
			'operator',
			'number',
			'delimiter',
			'variable',
			'keyword',
			'keyword',
			'delimiter'
		]);
		assert.deepStrictEqual(types('        Condition = 1 [CANIPCORETYPE_SC==0]'), [
			'variable',
			'operator',
			'number',
			'delimiter',
			'variable',
			'keyword',
			'number',
			'delimiter'
		]);
		assert.deepStrictEqual(types('        Condition = 1 (CANIPCORETYPE_SC == 0)'), [
			'variable',
			'operator',
			'number',
			'delimiter',
			'variable',
			'keyword',
			'number',
			'delimiter'
		]);
		assert.deepStrictEqual(types('        Condition = 1 [FLAG==0b1010]'), [
			'variable',
			'operator',
			'number',
			'delimiter',
			'variable',
			'keyword',
			'number',
			'delimiter'
		]);
	});

	test('token offsets point at the original line', () => {
		const tokens = tokenizeEcucLine('        P0000 = 42');
		assert.deepStrictEqual(tokens, [
			{ start: 8, length: 5, type: 'variable' },
			{ start: 14, length: 1, type: 'operator' },
			{ start: 16, length: 2, type: 'number' }
		]);
	});
});
