/**
 * DetailsEditor component: type-aware value controls, one draft per field and
 * the callback contract that keeps the write and the row data in the host.
 */
import * as assert from 'assert';

import {
	beginDetailsEdit,
	detailsContainerFields,
	detailsInputAllowed,
	detailsSelectionChanged,
	detailsValueInput,
	handleDetailsEditorMessage,
	resetDetailsEditorState,
	setDetailsEditorHost,
} from '../../../webview/components/detailsEditor/detailsEditor';
import { definitionRows } from '../../../webview/components/sidebar/detailsPanel/detailsPanel';
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

	test('Enter leaves the live draft and Escape restores the original text', () => {
		const dom = installMarkup('<body></body>');
		try {
			const previews: any[] = [];
			const commits: any[] = [];
			setDetailsEditorHost(
				host({
					previewEdit: (message: any) => previews.push(message),
					commitEdit: (message: any) => commits.push(message)
				})
			);
			const container = detailsValueInput(row(), { type: 'Integer' });
			const input = container.querySelector('input');
			input.value = '99';
			input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
			assert.deepStrictEqual(previews, [{ type: 'edit', nodeId: 'p1', value: '99' }]);
			const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
			input.dispatchEvent(enter);
			assert.strictEqual(enter.defaultPrevented, true, 'Enter is consumed');
			assert.deepStrictEqual(commits, [], 'Enter does not commit');
			input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
			assert.strictEqual(input.value, '63', 'Escape restores the row value');
			assert.deepStrictEqual(previews.at(-1), { type: 'edit', nodeId: 'p1', value: '63' });
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

	test('beginDetailsEdit reveals the panel, selects an unselected row and focuses the first field', () => {
		const dom = installMarkup('<body></body>');
		try {
			resetDetailsEditorState();
			const calls: string[] = [];
			const field = dom.document.createElement('input');
			field.id = 'details-value';
			dom.document.body.appendChild(field);
			setDetailsEditorHost(
				host({
					isDetailsTab: () => false,
					showTab: (name: string) => calls.push('tab:' + name),
					showSection: (id: string) => calls.push('section:' + id),
					getSelectedId: () => 'other',
					renderedItem: () => ({ id: 'p1' }),
					selectItem: () => calls.push('select'),
				})
			);
			assert.strictEqual(beginDetailsEdit('p1'), true);
			assert.deepStrictEqual(calls, ['tab:details', 'section:sb-details', 'select']);
			assert.strictEqual(dom.document.activeElement, field);
		} finally {
			dom.restore();
		}
	});

	test('beginDetailsEdit falls back to setSelection and reports a missing row', () => {
		const dom = installMarkup('<body></body>');
		try {
			resetDetailsEditorState();
			const calls: string[] = [];
			const container = row({
				id: 'c1',
				kind: 'container',
				label: 'Container',
				value: '',
				shortName: '',
				definitionRef: '/P/M/C',
			});
			const field = dom.document.createElement('input');
			field.id = 'details-definition-ref';
			dom.document.body.appendChild(field);
			setDetailsEditorHost(
				host({
					getRow: (id: string) => (id === 'c1' ? container : undefined),
					getSelectedId: () => 'other',
					renderedItem: () => undefined,
					setSelection: (id: string) => calls.push('selection:' + id),
					postSelect: (id: string) => calls.push('post:' + id),
					focusRow: (id: string) => {
						calls.push('focus-row:' + id);
						return true;
					},
				})
			);
			assert.strictEqual(beginDetailsEdit('c1'), true, 'a container without a short name starts at its definition');
			assert.deepStrictEqual(calls, ['selection:c1', 'post:c1', 'focus-row:c1']);
			assert.strictEqual(dom.document.activeElement, field);
			assert.strictEqual(beginDetailsEdit('missing'), false);
			assert.strictEqual(dom.document.activeElement, field, 'a missing row leaves focus alone');
		} finally {
			dom.restore();
		}
	});

	test('Tab leaves the value without committing', () => {
		const dom = installMarkup('<body></body>');
		try {
			resetDetailsEditorState();
			const commits: unknown[] = [];
			setDetailsEditorHost(host({ commitEdit: (message: unknown) => commits.push(message) }));
			const container = detailsValueInput(row(), { type: 'Integer' });
			dom.document.body.appendChild(container);
			const input = container.querySelector('input');
			const tab = new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
			input.dispatchEvent(tab);
			assert.strictEqual(tab.defaultPrevented, false, 'the browser owns Tab focus');
			assert.deepStrictEqual(commits, []);
		} finally {
			dom.restore();
		}
	});

	test('Tab between container fields leaves the draft to the shared model', () => {
		const dom = installMarkup('<body></body>');
		try {
			resetDetailsEditorState();
			const commits: unknown[] = [];
			const container = row({
				id: 'c1',
				kind: 'container',
				label: 'Container',
				value: '',
				shortName: 'C',
				definitionRef: '/P/M/C',
			});
			setDetailsEditorHost(
				host({
					getRow: (id: string) => (id === 'c1' ? container : undefined),
					getSelectedId: () => 'c1',
					commitEdit: (message: unknown) => commits.push(message),
				})
			);
			const fields = detailsContainerFields(container, { shortName: 'C', definitionRef: '/P/M/C' });
			dom.document.body.appendChild(fields);
			const shortName = dom.document.getElementById('details-short-name');
			const tab = new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
			shortName.dispatchEvent(tab);
			assert.strictEqual(tab.defaultPrevented, false);
			assert.deepStrictEqual(commits, []);
		} finally {
			dom.restore();
		}
	});

	test('DETAIL-03 Tab from the last container field does not commit or trap focus', () => {
		const dom = installMarkup('<body></body>');
		try {
			resetDetailsEditorState();
			const commits: unknown[] = [];
			const container = row({
				id: 'c1',
				kind: 'container',
				label: 'Container',
				value: '',
				shortName: 'C',
				definitionRef: '/P/M/C',
			});
			setDetailsEditorHost(
				host({
					getRow: (id: string) => (id === 'c1' ? container : undefined),
					getSelectedId: () => 'c1',
					commitEdit: (message: unknown) => commits.push(message),
				})
			);
			const fields = detailsContainerFields(container, { shortName: 'C', definitionRef: '/P/M/C' });
			dom.document.body.appendChild(fields);
			const definition = dom.document.getElementById('details-definition-ref');
			const tab = new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
			definition.dispatchEvent(tab);
			assert.strictEqual(tab.defaultPrevented, false, 'the browser moves focus out of the panel');
			assert.deepStrictEqual(commits, []);
		} finally {
			dom.restore();
		}
	});

	test('DETAIL-01 definition rows keep the documented order and omit absent fields', () => {
		assert.deepStrictEqual(
			definitionRows({
				kind: 'ECUC-ENUMERATION-PARAM-DEF',
				type: 'Enumeration',
				range: '0 .. 255',
				defaultValue: '1',
				multiplicity: '1..*',
				literals: ['Off', 'On'],
				destination: 'ECUC-INTEGER-PARAM-DEF',
				description: 'Mode selector',
				file: 'file:///workspace/Defs.arxml',
				fileName: 'Defs.arxml',
			}),
			[
				{ label: 'Definition type', value: 'Enumeration' },
				{ label: 'Range', value: '0 .. 255' },
				{ label: 'Default', value: '1' },
				{ label: 'Multiplicity', value: '1..*' },
				{ label: 'Values', value: 'Off, On' },
				{ label: 'Destination', value: 'ECUC-INTEGER-PARAM-DEF' },
				{ label: 'Definition description', value: 'Mode selector' },
				{ label: 'Definition file', value: 'Defs.arxml' },
			],
			'only declared fields appear and the file stays last'
		);

		assert.deepStrictEqual(
			definitionRows({
				kind: 'ECUC-INTEGER-PARAM-DEF',
				type: 'Integer',
				file: 'file:///workspace/Defs.arxml',
				fileName: 'Defs.arxml',
			}),
			[
				{ label: 'Definition type', value: 'Integer' },
				{ label: 'Definition file', value: 'Defs.arxml' },
			],
			'an absent range/default/multiplicity/literals/destination/description adds no row'
		);
	});

	test('DETAIL-04 a selection change cancels the open draft and never writes its text', () => {
		const dom = installMarkup('<body></body>');
		try {
			resetDetailsEditorState();
			const commits: unknown[] = [];
			setDetailsEditorHost(host({ commitEdit: (message: unknown) => commits.push(message) }));

			const container = detailsValueInput(row(), { type: 'Integer' });
			dom.document.body.appendChild(container);
			const input = container.querySelector('input');
			input.value = '999';
			assert.strictEqual(input.value, '999', 'the draft is open');

			detailsSelectionChanged('p2');
			input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			assert.deepStrictEqual(commits, [], 'the cancelled draft never reaches commitEdit');

			const fresh = detailsValueInput(row(), { type: 'Integer' }).querySelector('input');
			assert.strictEqual(fresh.value, '63', 'a new control starts from the committed value, not the ghost draft');

			fresh.value = '77';
			detailsSelectionChanged('p1');
			const kept = detailsValueInput(row(), { type: 'Integer' }).querySelector('input');
			assert.strictEqual(kept.value, '77', 'a selection that stays on the row keeps its draft');
		} finally {
			dom.restore();
		}
	});

	test('Enter never commits, an info notice is ignored, and an empty warning uses the default reason', () => {
		const dom = installMarkup('<body></body>');
		try {
			resetDetailsEditorState();
			const commits: unknown[] = [];
			setDetailsEditorHost(host({ commitEdit: (message: unknown) => commits.push(message) }));
			const container = detailsValueInput(row(), { type: 'Integer' });
			const input = container.querySelector('input');
			const enter = () => input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			enter();
			handleDetailsEditorMessage({ type: 'notice', kind: 'info', message: 'Saved.' });
			enter();
			assert.strictEqual(commits.length, 0, 'Enter does not commit the live draft');
			handleDetailsEditorMessage({ type: 'notice', kind: 'warn', message: '', inline: true });
			assert.strictEqual(input.getAttribute('aria-invalid'), 'true');
			assert.strictEqual(container.querySelector('.details-value-error').textContent, '/* The value was refused. */');
		} finally {
			dom.restore();
		}
	});
});
