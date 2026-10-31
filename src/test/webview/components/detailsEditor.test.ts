/**
 * DetailsEditor component: type-aware value controls, one draft per field and
 * the callback contract that keeps the write and the row data in the host.
 */
import * as assert from 'assert';

import {
	detailsInputAllowed,
	detailsValueInput,
	handleDetailsEditorMessage,
	setDetailsEditorHost,
} from '../../../webview/components/detailsEditor/detailsEditor';
import { webviewCss } from '../cssTestUtils';
import { installMarkup } from '../pageTestUtils';

function row(overrides: Record<string, unknown> = {}): any {
	return {
		id: 'p1',
		kind: 'parameter',
		label: 'IniValue',
		value: '63',
		parameterType: 'Integer',
		valueKind: 'numeric',
		shortName: '',
		definitionRef: '/P/M/C/IniValue',
		meta: [],
		hasChildren: false,
		...overrides,
	};
}

function host(overrides: Record<string, unknown> = {}): any {
	return {
		getRow: (id: string) => (id === 'p1' ? row() : undefined),
		getSelectedId: () => 'p1',
		isDetailsTab: () => true,
		showTab: () => undefined,
		showSection: () => undefined,
		renderedItem: () => undefined,
		selectItem: () => undefined,
		setSelection: () => undefined,
		postSelect: () => undefined,
		focusRow: () => true,
		updateInspector: () => undefined,
		commitEdit: () => undefined,
		focusAdjacentParameter: () => undefined,
		...overrides,
	};
}

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
		const css = webviewCss('components', 'detailsEditor', 'detailsEditor.css');
		assert.ok(/\.details-value\s*\{[^}]*--vscode-input-background/.test(css));
		assert.ok(/\.details-value\[aria-invalid="true"\]\s*\{[^}]*--vscode-inputValidation-errorBorder/.test(css));
		assert.ok(/\.details-value-error\s*\{[^}]*--vscode-errorForeground/.test(css));
	});

	test('Integer and Float get a text input; Boolean gets a true/false select', () => {
		const dom = installMarkup('<body></body>');
		try {
			const integer = detailsValueInput(row(), { type: 'Integer' });
			const input = integer.querySelector('input');
			assert.ok(input, 'an input for a numeric parameter');
			assert.strictEqual(input.id, 'details-value');
			assert.strictEqual(input.getAttribute('data-field'), 'value');
			assert.ok(input.getAttribute('aria-label').includes('IniValue'));
			const bool = detailsValueInput(row({ parameterType: 'Boolean', value: 'true' }), { type: 'Boolean' });
			const select = bool.querySelector('select');
			assert.ok(select, 'Boolean uses a select');
			assert.deepStrictEqual(
				Array.from(select.options).map((option: any) => option.value),
				['true', 'false']
			);
		} finally {
			dom.restore();
		}
	});

	test('Enter commits through the host and Escape restores the original text', () => {
		const dom = installMarkup('<body></body>');
		try {
			const commits: any[] = [];
			setDetailsEditorHost(host({ commitEdit: (message: any) => commits.push(message) }));
			const container = detailsValueInput(row(), { type: 'Integer' });
			const input = container.querySelector('input');
			input.value = '99';
			input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			assert.deepStrictEqual(commits, [{ type: 'edit', nodeId: 'p1', value: '99' }]);
			// A committed edit waits for the host's next document message; emulate that
			// re-scan, then Escape on a fresh field restores the committed row value.
			handleDetailsEditorMessage({ type: 'document', document: { rows: [] } });
			const fresh = detailsValueInput(row(), { type: 'Integer' }).querySelector('input');
			fresh.value = 'broken';
			fresh.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
			assert.strictEqual(fresh.value, '63', 'Escape restores the row value');
		} finally {
			dom.restore();
		}
	});

	test('a refusal marks the waiting field invalid and shows the reason inline', () => {
		const dom = installMarkup('<body></body>');
		try {
			setDetailsEditorHost(host());
			const container = detailsValueInput(row(), { type: 'Integer' });
			const input = container.querySelector('input');
			input.value = 'x';
			input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			handleDetailsEditorMessage({ type: 'notice', message: 'Not an integer.', kind: 'warn', inline: true });
			assert.strictEqual(input.getAttribute('aria-invalid'), 'true');
			assert.strictEqual(container.querySelector('.details-value-error').textContent, '/* Not an integer. */');
		} finally {
			dom.restore();
		}
	});
});
