/**
 * The minimal line edit the diff page applies after a copy patch.
 *
 * The page must not replace a whole model for a three-row change: that drops
 * scroll, folds and selection. These tests pin the splice and prove it
 * reproduces the target text exactly.
 */
import * as assert from 'assert';

import { applyLineEdit, minimalLineEdit } from '../../core/diff/minimalEdit';

const MODEL = ['module Mod', '{', '  Items', '  {', '    P.A = 1', '    P.B = 2', '  }', '}', ''].join('\n');

suite('minimal line edit', () => {
	test('MERGE-19 equal texts need no edit', () => {
		assert.strictEqual(minimalLineEdit(MODEL, MODEL), undefined);
	});

	test('MERGE-19 one changed line replaces only that line', () => {
		const next = MODEL.replace('P.A = 1', 'P.A = 9');
		const edit = minimalLineEdit(MODEL, next);
		assert.deepStrictEqual(edit, { startLine: 5, deleteCount: 1, text: '    P.A = 9\n' });
		assert.strictEqual(applyLineEdit(MODEL, edit!), next);
	});

	test('MERGE-19 inserted rows add lines at the change point', () => {
		const next = MODEL.replace('    P.B = 2', '    P.B = 2\n    P.C = 3');
		const edit = minimalLineEdit(MODEL, next);
		assert.deepStrictEqual(edit, { startLine: 7, deleteCount: 0, text: '    P.C = 3\n' });
		assert.strictEqual(applyLineEdit(MODEL, edit!), next);
	});

	test('MERGE-19 removed rows delete lines', () => {
		const next = MODEL.replace('    P.A = 1\n', '');
		const edit = minimalLineEdit(MODEL, next);
		assert.deepStrictEqual(edit, { startLine: 5, deleteCount: 1, text: '' });
		assert.strictEqual(applyLineEdit(MODEL, edit!), next);
	});

	test('MERGE-19 a trailing newline is preserved when the last line changes', () => {
		const next = `${MODEL}\n`;
		const edit = minimalLineEdit(MODEL, next);
		assert.deepStrictEqual(edit, { startLine: 10, deleteCount: 0, text: '\n' });
		assert.strictEqual(applyLineEdit(MODEL, edit!), next);
	});

	test('MERGE-19 a whole block replacement reproduces the target', () => {
		const next = ['module Mod', '{', '  Items', '  {', '    P.Z = 3', '  }', '}', ''].join('\n');
		const edit = minimalLineEdit(MODEL, next);
		assert.ok(edit !== undefined);
		assert.strictEqual(applyLineEdit(MODEL, edit!), next);
	});

	test('MERGE-19 the edit is the smallest one outside the shared edges', () => {
		const before = ['a', 'b', 'c', 'd', 'e', ''].join('\n');
		const after = ['a', 'b', 'X', 'Y', 'd', 'e', ''].join('\n');
		const edit = minimalLineEdit(before, after);
		assert.deepStrictEqual(edit, { startLine: 3, deleteCount: 1, text: 'X\nY\n' });
		assert.strictEqual(applyLineEdit(before, edit!), after);
	});
});
