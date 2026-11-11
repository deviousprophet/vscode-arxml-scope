/**
 * DetailsEditor component: type-aware value controls, one draft per field and
 * the callback contract that keeps the write and the row data in the host.
 */
import * as assert from 'assert';

import {
	beginDetailsEdit,
	detailsContainerFields,
	detailsInputAllowed,
	detailsValueInput,
	handleDetailsEditorMessage,
	resetDetailsEditorState,
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

	test('Tab from the value commits and moves to the adjacent parameter after the re-scan', async () => {
		const dom = installMarkup('<body></body>');
		try {
			resetDetailsEditorState();
			const commits: unknown[] = [];
			const moves: string[] = [];
			setDetailsEditorHost(
				host({
					getRow: (id: string) => (id === 'p1' ? row() : id === 'p2' ? row({ id: 'p2', label: 'Other' }) : undefined),
					commitEdit: (message: unknown) => commits.push(message),
					focusAdjacentParameter: (from: string, dir: string) => {
						moves.push(from + ':' + dir);
						return 'p2';
					},
				})
			);
			const container = detailsValueInput(row(), { type: 'Integer' });
			dom.document.body.appendChild(container);
			const input = container.querySelector('input');
			const tab = new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
			input.dispatchEvent(tab);
			assert.strictEqual(tab.defaultPrevented, true);
			assert.deepStrictEqual(commits, [{ type: 'edit', nodeId: 'p1', value: '63' }]);
			handleDetailsEditorMessage({ type: 'document', document: { rows: [] } });
			await new Promise((resolve) => setTimeout(resolve, 0));
			assert.deepStrictEqual(moves, ['p1:prev']);
			assert.strictEqual(dom.document.activeElement, input, 'the adjacent parameter field takes focus');
		} finally {
			dom.restore();
		}
	});

	test('Tab between container fields commits and focuses the sibling after the re-scan', async () => {
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
			assert.strictEqual(tab.defaultPrevented, true);
			assert.deepStrictEqual(commits, [{ type: 'edit', nodeId: 'c1', field: 'shortName', value: 'C' }]);
			handleDetailsEditorMessage({ type: 'document', document: { rows: [] } });
			await new Promise((resolve) => setTimeout(resolve, 0));
			assert.strictEqual(dom.document.activeElement?.id, 'details-definition-ref');
		} finally {
			dom.restore();
		}
	});

	test('Tab from the last container field commits without trapping focus', () => {
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
			assert.deepStrictEqual(commits, [{ type: 'edit', nodeId: 'c1', field: 'definitionRef', value: '/P/M/C' }]);
		} finally {
			dom.restore();
		}
	});

	test('an info notice leaves the pending draft waiting; an empty warning uses the default reason', () => {
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
			assert.strictEqual(commits.length, 1, 'a pending draft is not committed twice');
			handleDetailsEditorMessage({ type: 'notice', kind: 'warn', message: '', inline: true });
			assert.strictEqual(input.getAttribute('aria-invalid'), 'true');
			assert.strictEqual(container.querySelector('.details-value-error').textContent, '/* The value was refused. */');
		} finally {
			dom.restore();
		}
	});
});
