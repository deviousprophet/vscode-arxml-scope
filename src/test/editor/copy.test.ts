/**
 * AC5 — the exact-text contract of the inspector's Copy actions. The webview posts text;
 * this helper is the only place that touches the clipboard, so a stub can prove the bytes
 * that reach it without a live webview or a real system clipboard.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { copyText } from '../../editor/clipboard';
import { repoRoot } from './editorTestUtils';

suite('editor clipboard copy (AC5)', () => {
	test('AC5: copyText writes the exact text and returns the notice', async () => {
		const written: string[] = [];
		const notice = await copyText(
			{
				writeText: async (text: string) => {
					written.push(text);
				},
			},
			'/PkgA/PkgB/ModX/ContA'
		);
		assert.deepStrictEqual(written, ['/PkgA/PkgB/ModX/ContA']);
		assert.strictEqual(notice, 'Copied to clipboard.');
	});

	test('AC5: the provider wires a copy message to the helper', () => {
		// The helper above proves the exact text reaches the clipboard interface; this
		// source assertion is the wiring check for the one-liner in the provider. The
		// browser harness separately observed the page posting `{ type: 'copy', text }`.
		const source = fs.readFileSync(path.join(repoRoot, 'src', 'editor', 'ecucEditorProvider.ts'), 'utf8');
		assert.ok(source.includes("message.type === 'copy'"), 'the provider recognises the copy message');
		assert.ok(
			source.includes('copyText(vscode.env.clipboard, message.text)'),
			'and passes the exact text to the clipboard helper'
		);
		assert.ok(
			source.includes("message: 'Could not copy: ' + String(error)"),
			'and reports a failed copy instead of claiming success'
		);
		assert.ok(source.includes("kind: 'warn'"), 'as a warning notice');
	});

	test('AC5: a clipboard failure is propagated, not reported as success', async () => {
		let attempted = false;
		await assert.rejects(
			copyText(
				{
					writeText: async () => {
						attempted = true;
						throw new Error('denied');
					},
				},
				'x'
			),
			/denied/
		);
		assert.strictEqual(attempted, true);
	});
});
