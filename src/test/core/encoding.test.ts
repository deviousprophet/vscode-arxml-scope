/**
 * Encoding detection for the streamed index reader.
 */
import * as assert from 'assert';

import { detectEncoding } from '../../core/text/encoding';

function bytes(...values: number[]): Uint8Array {
	return Uint8Array.from(values);
}

suite('encoding detection', () => {
	test('detects a UTF-8 BOM', () => {
		assert.deepStrictEqual(detectEncoding(bytes(0xef, 0xbb, 0xbf, 0x3c)), { label: 'utf-8', bomBytes: 3 });
	});

	test('detects a UTF-16LE BOM', () => {
		assert.deepStrictEqual(detectEncoding(bytes(0xff, 0xfe, 0x3c, 0x00)), { label: 'utf-16le', bomBytes: 2 });
	});

	test('detects a UTF-16BE BOM', () => {
		assert.deepStrictEqual(detectEncoding(bytes(0xfe, 0xff, 0x00, 0x3c)), { label: 'utf-16be', bomBytes: 2 });
	});

	test('defaults to UTF-8 without a declaration', () => {
		assert.deepStrictEqual(detectEncoding(Buffer.from('<AUTOSAR>')), { label: 'utf-8', bomBytes: 0 });
	});

	test('honours a common ASCII-compatible declaration', () => {
		const text = '<?xml version="1.0" encoding="ISO-8859-1"?><AUTOSAR>';
		assert.deepStrictEqual(detectEncoding(Buffer.from(text)), { label: 'iso-8859-1', bomBytes: 0 });
	});

	test('normalises a windows-1252 declaration', () => {
		const text = '<?xml version="1.0" encoding="windows-1252"?><AUTOSAR>';
		assert.deepStrictEqual(detectEncoding(Buffer.from(text)), { label: 'windows-1252', bomBytes: 0 });
	});

	test('refuses an unsupported declaration', () => {
		const text = '<?xml version="1.0" encoding="UTF-32"?><AUTOSAR>';
		assert.strictEqual(detectEncoding(Buffer.from(text)), undefined);
	});

	test('refuses UTF-32LE even when the first bytes mimic a BOM', () => {
		assert.strictEqual(detectEncoding(bytes(0xff, 0xfe, 0x00, 0x00, 0x3c)), undefined);
		assert.strictEqual(detectEncoding(bytes(0xff, 0xfe, 0x00, 0x00)), undefined);
	});

	test('a truncated BOM falls back to the declaration scan', () => {
		assert.deepStrictEqual(detectEncoding(bytes(0xef, 0xbb)), { label: 'utf-8', bomBytes: 0 });
		assert.deepStrictEqual(detectEncoding(bytes(0xff)), { label: 'utf-8', bomBytes: 0 });
		assert.deepStrictEqual(detectEncoding(bytes(0xfe)), { label: 'utf-8', bomBytes: 0 });
		assert.deepStrictEqual(detectEncoding(bytes()), { label: 'utf-8', bomBytes: 0 });
	});

	test('normalises aliases, padded labels and single quotes', () => {
		const label = (encoding: string): string | undefined =>
			detectEncoding(Buffer.from(`<?xml version='1.0' encoding='${encoding}'?>`))?.label;
		assert.strictEqual(label(' UTF8 '), 'utf-8');
		assert.strictEqual(label('utf-16'), 'utf-16le');
		assert.strictEqual(label('UTF-16BE'), 'utf-16be');
		assert.strictEqual(label(' LaTiN1 '), 'iso-8859-1');
		assert.strictEqual(label('us-ascii'), 'windows-1252');
		assert.strictEqual(label('CP1252'), 'windows-1252');
	});

	test('the declaration scan stops at 256 bytes', () => {
		const text = 'x'.repeat(250) + '<?xml version="1.0" encoding="latin1"?>';
		assert.deepStrictEqual(detectEncoding(Buffer.from(text)), { label: 'utf-8', bomBytes: 0 });
		const early = '<?xml version="1.0" encoding="latin1"?>' + 'x'.repeat(400);
		assert.deepStrictEqual(detectEncoding(Buffer.from(early)), { label: 'iso-8859-1', bomBytes: 0 });
	});
});
