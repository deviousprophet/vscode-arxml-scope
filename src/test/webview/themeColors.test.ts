import * as assert from 'assert';

import { toMonacoColor } from '../../webview/monaco/colors';

suite('webview theme colors', () => {
	test('keeps eight-digit hex alpha intact', () => {
		assert.strictEqual(toMonacoColor('#347d3926', '#000000'), '#347d3926');
		assert.strictEqual(toMonacoColor('#FF000033', '#000000'), '#ff000033');
	});

	test('expands shorthand hex to six or eight digits', () => {
		assert.strictEqual(toMonacoColor('#abc', '#000000'), '#aabbcc');
		assert.strictEqual(toMonacoColor('#abcd', '#000000'), '#aabbccdd');
	});

	test('converts rgba() without dropping its alpha', () => {
		assert.strictEqual(
			toMonacoColor('rgba(155, 185, 85, 0.20)', '#000000'),
			'#9bb95533',
			'the diff line tint must stay translucent'
		);
		assert.strictEqual(toMonacoColor('rgba(255, 0, 0, 0.5)', '#000000'), '#ff000080');
	});

	test('converts modern space and slash syntax', () => {
		assert.strictEqual(toMonacoColor('rgb(155 185 85 / 20%)', '#000000'), '#9bb95533');
		assert.strictEqual(toMonacoColor('rgba(52 125 57 / 0.15)', '#000000'), '#347d3926');
	});

	test('omits alpha when a color is fully opaque', () => {
		assert.strictEqual(toMonacoColor('rgb(52, 125, 57)', '#000000'), '#347d39');
		assert.strictEqual(toMonacoColor('rgba(52, 125, 57, 1)', '#000000'), '#347d39');
	});

	test('falls back when the value is not a colour Monaco can use', () => {
		assert.strictEqual(toMonacoColor('transparent', '#123456'), '#123456');
		assert.strictEqual(toMonacoColor('', '#123456'), '#123456');
		assert.strictEqual(toMonacoColor('not-a-color', '#123456'), '#123456');
	});
});
