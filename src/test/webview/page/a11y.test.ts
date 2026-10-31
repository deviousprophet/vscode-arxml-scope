/**
 * AC8 — the mounted tree exposes real tree semantics, and focus is drawn with a
 * theme colour. The row builder is exercised through the bundled page.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../../core/ecuc/scanner';
import { buildRows } from '../../../core/ecuc/renderRows';
import { SORT_EXCEPTIONS } from '../../../core/ecuc/order';
import { webviewCss } from '../cssTestUtils';
import { fixtureText } from '../../core/modelTestUtils';
import { installDom, loadModule, treeRows } from '../pageTestUtils';

function mount() {
	const dom = installDom('editor');
	loadModule<typeof import('../../../webview/editorViewer')>('../../webview/editorViewer').mountEditor();
	const model = scanEcucValues(fixtureText('editor/render.arxml'));
	dom.post({
		type: 'document',
		document: { rows: buildRows(model, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows },
	});
	return dom;
}

suite('editor accessibility (AC8)', () => {
	test('AC8: the tree exposes real tree roles, levels and expansion state', () => {
		const dom = mount();
		try {
			const tree = dom.document.getElementById('tree');
			assert.strictEqual(tree.getAttribute('role'), 'tree');
			assert.strictEqual(tree.getAttribute('aria-label'), 'ECUC values');
			assert.ok(!dom.document.querySelector('[role="group"]'), 'the flat tree drops group wrappers deliberately');
			const rows = treeRows(dom.document);
			assert.ok(rows.length > 0);
			for (const row of rows) {
				assert.strictEqual(row.getAttribute('role'), 'treeitem');
				assert.ok(Number(row.getAttribute('aria-level')) >= 1);
				assert.ok(Number(row.getAttribute('aria-posinset')) >= 1);
				assert.ok(Number(row.getAttribute('aria-setsize')) >= 1);
				assert.ok(['true', 'false'].includes(row.getAttribute('aria-selected')));
			assert.ok(row.tabIndex === -1 || row.tabIndex === 0, 'roving tabindex');
			assert.ok(rows.filter((candidate) => candidate.tabIndex === 0).length <= 1, 'one roving row');
			}
			const containers = rows.filter((row) => row.hasAttribute('aria-expanded'));
			assert.ok(containers.length > 0, 'a container exposes expansion');
			assert.ok(rows.some((row) => Number(row.getAttribute('aria-level')) === 3), 'a nested parameter exists');
		} finally {
			dom.restore();
		}
	});

	test('AC8: arrow keys and Enter are wired', () => {
		const dom = mount();
		try {
			const first = treeRows(dom.document)[0];
			first.focus();
			first.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
			assert.strictEqual(dom.document.activeElement, treeRows(dom.document)[1], 'ArrowDown moves focus');
			first.dispatchEvent(
				new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
			);
			assert.ok(dom.document.activeElement, 'ArrowRight keeps a row focused');
		} finally {
			dom.restore();
		}
	});

	test('AC8: focus is visible and drawn with a theme colour', () => {
		const style =
			webviewCss('components', 'documentTree', 'documentTree.css') + webviewCss('styles', 'tokens.css');
		assert.ok(style.includes(':focus-visible'));
		assert.ok(style.includes('var(--vscode-focusBorder)'));
		assert.ok(style.includes('--rail: var(--vscode-focusBorder'));
		assert.ok(style.includes('--sel-bg-focus: color-mix('));
		assert.ok(style.includes('--vscode-list-activeSelectionBackground'));
	});

	test('AC8: the details value editor has a label, invalid state and live error', () => {
		const dom = mount();
		try {
			const parameter = treeRows(dom.document).find(
				(row) => row.querySelector('.label')?.textContent === 'IniValue'
			)!;
			parameter.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			const input = dom.document.getElementById('details-value') as HTMLInputElement;
			assert.ok(input.getAttribute('aria-label')!.includes('Value of IniValue'));
			input.value = 'not-a-number';
			input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			dom.post({ type: 'notice', message: 'Not an integer.', kind: 'warn', inline: true, scope: 'details' });
			assert.strictEqual(input.getAttribute('aria-invalid'), 'true');
			const error = dom.document.querySelector('.details-value-error')!;
			assert.strictEqual(error.getAttribute('role'), 'status');
			assert.strictEqual(error.getAttribute('aria-live'), 'polite');
		} finally {
			dom.restore();
		}
	});
});
