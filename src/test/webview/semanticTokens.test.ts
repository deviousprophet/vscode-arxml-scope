import * as assert from 'assert';

import { webviewSource } from './cssTestUtils';
import { tokenizeEcucLine } from '../../webview/monaco/tokens';

function types(line: string): string[] {
	return tokenizeEcucLine(line).map((token) => token.type);
}

/** One exact token: start, length and type, as the provider emits it. */
type ExpectedToken = [start: number, length: number, type: string];

function expectTokens(line: string, expected: ExpectedToken[]): void {
	assert.deepStrictEqual(
		tokenizeEcucLine(line),
		expected.map(([start, length, type]) => ({ start, length, type })),
		line
	);
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
			'syscond',
			'parameter',
			'constant',
			'delimiter'
		]);
		assert.deepStrictEqual(types('        Condition = 1 [CANIPCORETYPE_SC==0]'), [
			'variable',
			'operator',
			'number',
			'delimiter',
			'syscond',
			'parameter',
			'number',
			'delimiter'
		]);
		assert.deepStrictEqual(types('        Condition = 1 (CANIPCORETYPE_SC == 0)'), [
			'variable',
			'operator',
			'number',
			'delimiter',
			'syscond',
			'parameter',
			'number',
			'delimiter'
		]);
		assert.deepStrictEqual(types('        Condition = 1 [FLAG==0b1010]'), [
			'variable',
			'operator',
			'number',
			'delimiter',
			'syscond',
			'parameter',
			'number',
			'delimiter'
		]);
	});

	test('every condition lexer class maps to its own editor token type', () => {
		// Name, operator, string, punctuation, number and literal each keep a
		// distinct token type, so no condition expression collapses to one colour.
		assert.deepStrictEqual(types('        Condition = 1 [NAME != "x" && (FLAG) == true]'), [
			'variable',
			'operator',
			'number',
			'delimiter',
			'syscond',
			'parameter',
			'string',
			'parameter',
			'delimiter',
			'syscond',
			'delimiter',
			'parameter',
			'constant',
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

	test('every synthetic row shape maps to its exact token matrix', () => {
		// One row per Document/diff shape. A quoted short name with no definition
		// label is the first token of the no-label container line, so it must be a
		// string, never the definition `type` colour.
		const matrix: [string, ExpectedToken[]][] = [
			['    "EmptyDef" { }', [[4, 10, 'string'], [15, 3, 'delimiter']]],
			['    SharedContainerDef "MissingDefOnRight" { }', [[4, 18, 'type'], [23, 19, 'string'], [43, 3, 'delimiter']]],
			['module P.Syn "Syn"', [[0, 6, 'keyword'], [7, 5, 'variable'], [13, 5, 'string']]],
			['        Label = 42', [[8, 5, 'variable'], [14, 1, 'operator'], [16, 2, 'number']]],
			['        Label = "text"', [[8, 5, 'variable'], [14, 1, 'operator'], [16, 6, 'string']]],
			['        Next = P.Syn.Target', [[8, 4, 'variable'], [13, 1, 'operator'], [15, 12, 'function']]],
			['        Ref = /Pkg/Items', [[8, 3, 'variable'], [12, 1, 'operator'], [14, 10, 'function']]],
			[
				'        Condition = 1 [(CANIPCORETYPE_SC==0)]',
				[
					[8, 9, 'variable'],
					[18, 1, 'operator'],
					[20, 1, 'number'],
					[22, 1, 'delimiter'],
					[23, 1, 'delimiter'],
					[24, 16, 'syscond'],
					[40, 2, 'parameter'],
					[42, 1, 'number'],
					[43, 1, 'delimiter'],
					[44, 1, 'delimiter']
				]
			],
			['    /* comment */', [[4, 13, 'comment']]],
			['@annotation', [[0, 11, 'comment']]],
			['schema 00048', [[0, 6, 'keyword'], [7, 5, 'number']]],
			['package P.Syn', [[0, 7, 'keyword'], [8, 5, 'namespace']]],
			['context Pkg/Path', [[0, 7, 'keyword'], [8, 8, 'variable']]],
			['        Label = true', [[8, 5, 'variable'], [14, 1, 'operator'], [16, 4, 'keyword']]],
			['        Label = ""', [[8, 5, 'variable'], [14, 1, 'operator'], [16, 2, 'string']]],
			['        Label = "a\\"b"', [[8, 5, 'variable'], [14, 1, 'operator'], [16, 6, 'string']]],
			['        Label = ', [[8, 5, 'variable'], [14, 1, 'operator']]],
			['    "" { }', [[4, 2, 'string'], [7, 3, 'delimiter']]],
			['    EmptyLabel "" { }', [[4, 10, 'type'], [15, 2, 'string'], [18, 3, 'delimiter']]],
			['    EmptyLabel "Short" { }', [[4, 10, 'type'], [15, 7, 'string'], [23, 3, 'delimiter']]],
			['    {', [[4, 1, 'delimiter']]],
			['    }', [[4, 1, 'delimiter']]]
		];
		for (const [line, expected] of matrix) {
			expectTokens(line, expected);
		}
	});

	test('a trailing backslash before the closing quote stays in the string', () => {
		// The synthetic display does not escape a trailing backslash; the quote
		// after it is still the closing quote, not an escaped character.
		assert.deepStrictEqual(types('Text = "C:\\"'), ['variable', 'operator', 'string']);
	});

	test('a parameter named context stays a label, not a context keyword', () => {
		// The leading-context branch must not swallow a value row whose label
		// happens to be `context`.
		assert.deepStrictEqual(types('context = 5'), ['variable', 'operator', 'number']);
	});

	test('the editor and the Monaco diff share one token provider', () => {
		// Both pages create models with the `arxml-ecuc` language; only
		// `monaco/setup.ts` registers the provider, and it maps every line through
		// `tokenizeEcucLine`. There is no second tokenizer for the diff to drift.
		const setup = webviewSource('monaco', 'setup.ts');
		assert.ok(/setTokensProvider\('arxml-ecuc'/.test(setup), 'the shared setup owns the provider');
		assert.ok(/tokens:\s*tokenizeEcucLine\(line\)\.map/.test(setup), 'the provider maps the shared lexer');
		for (const page of ['editorMonaco.ts', 'diffMonaco.ts']) {
			assert.ok(webviewSource(page).includes("from './monaco/setup'"), `${page} imports the shared setup`);
			assert.ok(webviewSource(page).includes("createModel('', 'arxml-ecuc')"), `${page} uses the shared language`);
		}
	});
});
