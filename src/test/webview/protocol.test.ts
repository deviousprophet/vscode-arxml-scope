/**
 * The host ↔ webview protocol seam. The page and the provider exchange only
 * these typed messages; these tests pin the message discriminators and the
 * shared payload helpers.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { buildRows } from '../../core/ecuc/renderRows';
import { documentHeader, editorMessageType, isEditorProviderMessage } from '../../webviewProtocol';
import type { EditorProviderToWebview, EditorWebviewToProvider } from '../../webviewProtocol';
import { diffMessageType, isDiffProviderMessage } from '../../diffProtocol';
import type { DiffProviderToWebview, DiffWebviewToProvider } from '../../diffProtocol';
import { fixtureText } from '../core/modelTestUtils';

suite('webview protocol', () => {
	test('the editor host messages have one discriminator and a shape guard', () => {
		const messages: EditorProviderToWebview[] = [
			{ type: 'document', document: { rows: [] } },
			{ type: 'conditions', entries: [] },
			{ type: 'select', nodeId: 'x' },
			{ type: 'notice', message: 'warning', kind: 'warn', inline: true, scope: 'details' },
			{ type: 'error', message: 'fatal' },
		];
		for (const message of messages) {
			assert.strictEqual(editorMessageType(message), message.type);
			assert.strictEqual(isEditorProviderMessage(message), true);
		}
		assert.strictEqual(isEditorProviderMessage({ type: 'intent' }), false);
		assert.strictEqual(editorMessageType(null), undefined);
	});

	test('the editor webview intents stay a closed union', () => {
		const intents: EditorWebviewToProvider[] = [
			{ type: 'ready' },
			{ type: 'select', nodeId: 'x' },
			{ type: 'reveal', nodeId: 'x' },
			{ type: 'follow', nodeId: 'x' },
			{ type: 'edit', nodeId: 'x', field: 'shortName', value: 'Y' },
			{ type: 'delete', nodeId: 'x' },
			{ type: 'duplicate', nodeId: 'x' },
			{ type: 'conditions', entries: [{ name: 'A_SC', value: '1' }] },
		];
		assert.deepStrictEqual(
			intents.map((intent) => intent.type),
			['ready', 'select', 'reveal', 'follow', 'edit', 'delete', 'duplicate', 'conditions']
		);
	});

	test('the diff host messages and intents have their own seam', () => {
		const host: DiffProviderToWebview[] = [
			{
				type: 'document',
				document: {
					left: { name: 'a', path: '/a' },
					right: { name: 'b', path: '/b' },
					labels: ['a', 'b'],
					leftHeader: { packages: [] },
					rightHeader: { packages: [] },
					rows: [],
					summary: { changed: 0, added: 0, removed: 0, unchanged: 0 },
				},
			},
			{ type: 'error', message: 'refresh failed' },
		];
		for (const message of host) {
			assert.strictEqual(diffMessageType(message), message.type);
			assert.strictEqual(isDiffProviderMessage(message), true);
		}
		assert.strictEqual(isDiffProviderMessage({ type: 'select' }), false);
		const intents: DiffWebviewToProvider[] = [
			{ type: 'ready' },
			{ type: 'reveal', side: 'right', key: 'row-1' },
		];
		assert.deepStrictEqual(intents.map((intent) => intent.type), ['ready', 'reveal']);
	});

	test('the document header comes from the model, not from page markup', () => {
		const model = scanEcucValues(fixtureText('editor/render.arxml'));
		const header = documentHeader(model);
		assert.strictEqual(header.schema, '00048');
		assert.deepStrictEqual(header.packages, ['PkgA.PkgB']);
		const payload = { rows: buildRows(model, { sort: 'all', sortExcept: [] }).rows, header };
		assert.ok(payload.rows.length > 0);
		assert.ok(!JSON.stringify(payload).includes('<script'), 'the payload is data');
	});
});
