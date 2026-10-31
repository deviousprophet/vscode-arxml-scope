/**
 * DetailsEditor component: type-aware value controls, one draft per field and
 * the callback contract that keeps the write and the row data in the host.
 */
import * as assert from 'assert';

import {
	detailsEditorScript,
	detailsEditorStyles,
	detailsInputAllowed,
} from '../../../webview/components/detailsEditor/detailsEditor';

suite('DetailsEditor component', () => {
	test('insertion guards follow the parameter type without rewriting text', () => {
		assert.strictEqual(detailsInputAllowed('Integer', '1'), true);
		assert.strictEqual(detailsInputAllowed('Integer', '0x3F'), true);
		assert.strictEqual(detailsInputAllowed('Integer', '-7'), true);
		assert.strictEqual(detailsInputAllowed('Integer', '1.5'), false);
		assert.strictEqual(detailsInputAllowed('Integer', '1g'), false);
		assert.strictEqual(detailsInputAllowed('Float', '1.5e-3'), true);
		assert.strictEqual(detailsInputAllowed('Float', '0x3F'), false);
		assert.strictEqual(detailsInputAllowed('String', 'anything at all'), true);
		assert.strictEqual(detailsInputAllowed('String', ''), true);
	});

	test('the component CSS owns the input and its inline refusal reason', () => {
		const css = detailsEditorStyles();
		assert.ok(/\.details-value\s*\{[^}]*--vscode-input-background/.test(css));
		assert.ok(/\.details-value\[aria-invalid="true"\]\s*\{[^}]*--vscode-inputValidation-errorBorder/.test(css));
		assert.ok(/\.details-value-error\s*\{[^}]*--vscode-errorForeground/.test(css));
	});

	test('commits and selection reach the host through callbacks', () => {
		const script = detailsEditorScript();
		for (const name of [
			'detailsInputAllowed',
			'detailsRegisterKeydown',
			'detailsValueInput',
			'beginDetailsEdit',
			'commitDetailsEdit',
		]) {
			assert.ok(script.includes(`function ${name}(`), `${name} is emitted`);
		}
		assert.ok(script.includes('detailsEditorHost.commitEdit('));
		assert.ok(script.includes('detailsEditorHost.getRow('));
		assert.ok(script.includes('detailsEditorHost.showTab('));
		assert.ok(!script.includes('vscode'), 'the component never posts provider messages');
		assert.ok(!script.includes('rowById'), 'the component never reads the host row map directly');
	});

	test('the serialized script keeps Enter, Escape and Tab owned by the field', () => {
		const script = detailsEditorScript();
		assert.ok(script.includes("event.key === 'Enter'"));
		assert.ok(script.includes("event.key === 'Escape'"));
		assert.ok(script.includes("event.key === 'Tab'"));
		assert.ok(script.includes('stopPropagation()'));
		assert.ok(script.includes("event.shiftKey ? 'prev' : 'next'"));
	});
});
