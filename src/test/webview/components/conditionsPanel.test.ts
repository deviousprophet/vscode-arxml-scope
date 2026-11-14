/**
 * ConditionsPanel component: name validation and the panel markup. The live
 * add/edit/remove flow is exercised through the mounted editor page.
 */
import * as assert from 'assert';

import type { ConditionEntry } from '../../../core/ecuc/conditionEntry';
import {
	applyDisabledCount,
	conditionEntryError,
	conditionNameValid,
	ensureDiscoveredConditionRows,
	mountConditionsPanel,
	renderConditionEntries,
	renderConditionsPanelHtml,
	setConditionRows,
	setConditionsCallback,
} from '../../../webview/components/sidebar/conditionsPanel/conditionsPanel';
import { installMarkup } from '../pageTestUtils';

function panel(): ReturnType<typeof installMarkup> {
	const dom = installMarkup(`<body>${renderConditionsPanelHtml()}</body>`);
	// An active tab is not hidden; jsdom only focuses elements in the rendered tree.
	(dom.document.getElementById('sbp-conditions') as any).removeAttribute('hidden');
	mountConditionsPanel();
	return dom;
}

function rows(dom: ReturnType<typeof installMarkup>): any[] {
	return Array.from(dom.document.querySelectorAll('#conditions-list .condition-row'));
}

function row(dom: ReturnType<typeof installMarkup>, at: number): any {
	const list = rows(dom);
	assert.ok(list[at], `row ${at} exists`);
	return list[at];
}

function childClasses(element: any): string[] {
	return Array.from(element.children).map((child: any) => child.className);
}

suite('ConditionsPanel component', () => {
	test('the panel owns one list, its actions and the fixed status line', () => {
		const html = renderConditionsPanelHtml();
		assert.ok(html.includes('id="conditions-panel"'));
		assert.ok(html.includes('id="conditions-list"'));
		assert.ok(html.includes('id="conditions-add"'));
		assert.ok(html.includes('id="conditions-clear"'));
		assert.ok(html.includes('id="conditions-status"'));
		assert.ok(html.includes('id="conditions-empty"'));
	});

	test('name validation is one rule for Save and the tests', () => {
		assert.strictEqual(conditionNameValid('A_SC'), true);
		assert.strictEqual(conditionNameValid('Pkg.Mod/Sub-1_A'), true);
		assert.strictEqual(conditionNameValid('/Pkg/SwSystemconsts/A_SC'), true);
		assert.strictEqual(conditionNameValid('1ABC'), false);
		assert.strictEqual(conditionNameValid('A B'), false);
		assert.strictEqual(conditionEntryError(''), 'Enter a constant name before saving.');
		assert.ok(conditionEntryError('BAD NAME').startsWith('Invalid name'));
		assert.ok(conditionEntryError('A_SC', ['A_SC']).includes('already exists'));
		assert.strictEqual(conditionEntryError('B_SC', ['A_SC']), '');
	});

	test('validation trims the draft and compares the trimmed name', () => {
		assert.strictEqual(conditionEntryError('   '), 'Enter a constant name before saving.');
		assert.ok(conditionEntryError('  A_SC  ', ['A_SC']).includes('A condition value named A_SC already exists.'));
		assert.strictEqual(conditionEntryError(' A_SC ', []), '');
	});

	test('rendering keeps row order, classes, text and the auto/manual actions apart', () => {
		const dom = panel();
		try {
			assert.strictEqual((dom.document.getElementById('conditions-empty') as any).hidden, false);
			assert.strictEqual((dom.document.getElementById('conditions-clear') as any).disabled, true);
			assert.strictEqual((dom.document.getElementById('sb-conditions-values-badge') as any).hidden, true);
			assert.strictEqual(
				dom.document.getElementById('sb-conditions-values-badge')!.textContent,
				'0 constants'
			);

			setConditionRows([{ condition: { symbols: ['A_SC', 'B_SC'] } }]);
			ensureDiscoveredConditionRows();
			assert.deepStrictEqual(rows(dom).map((entry) => entry.dataset.name), ['A_SC', 'B_SC']);
			const first = row(dom, 0);
			assert.strictEqual(first.className, 'condition-row parent');
			assert.deepStrictEqual(
				{ auto: first.dataset.auto, editing: first.dataset.editing, new: first.dataset.new, value: first.dataset.value },
				{ auto: 'true', editing: 'false', new: 'false', value: '' }
			);
			assert.deepStrictEqual(childClasses(first), [
				'condition-name-text',
				'punct',
				'condition-actions',
			]);
			assert.deepStrictEqual(
				Array.from(first.children[2].children).map((child: any) => child.className),
				['condition-state', 'act-btn condition-edit']
			);
			const state = first.querySelector('.condition-state');
			assert.strictEqual(state.textContent, 'unknown');
			assert.strictEqual(state.title, 'No value yet: conditions using this constant stay unknown');
			assert.strictEqual(state.hidden, false);
			assert.strictEqual((dom.document.getElementById('conditions-empty') as any).hidden, true);
			assert.strictEqual((dom.document.getElementById('conditions-clear') as any).disabled, false);
			assert.strictEqual(
				dom.document.getElementById('sb-conditions-values-badge')!.textContent,
				'2 constants · 2 missing'
			);

			renderConditionEntries([{ name: 'C_SC', value: '3' }]);
			const manual = row(dom, 0);
			assert.strictEqual(manual.dataset.auto, 'false');
			assert.deepStrictEqual(childClasses(manual), [
				'condition-name-text',
				'punct',
				'condition-value-text',
				'condition-actions',
			]);
			assert.strictEqual(manual.querySelector('.condition-value-text').title, 'Value: 3');
			assert.strictEqual(manual.querySelector('.condition-state').hidden, true);
			assert.deepStrictEqual(
				Array.from(manual.children[3].children).map((child: any) => child.className),
				['condition-state', 'act-btn condition-edit', 'act-btn condition-remove']
			);
		} finally {
			dom.restore();
		}
	});

	test('one draft at a time, Enter saves and Escape restores focus', () => {
		const dom = panel();
		try {
			const posted: ConditionEntry[][] = [];
			setConditionsCallback((entries) => posted.push(entries));
			renderConditionEntries([
				{ name: 'A_SC', value: '1' },
				{ name: 'B_SC', value: '2' },
			]);

			row(dom, 0).querySelector('.condition-edit').click();
			const first = row(dom, 0);
			assert.strictEqual(first.dataset.editing, 'true');
			assert.strictEqual(first.querySelector('.condition-name'), null, 'a committed name is not editable');
			const firstInput = first.querySelector('.condition-value');
			assert.strictEqual(firstInput.value, '1');
			assert.strictEqual(dom.document.activeElement, firstInput, 'the draft value is focused');
			assert.deepStrictEqual(
				Array.from(first.querySelector('.condition-actions').children).map((child: any) => child.className),
				['act-btn condition-save', 'act-btn condition-cancel']
			);

			row(dom, 1).querySelector('.condition-edit').click();
			assert.strictEqual(row(dom, 0).dataset.editing, 'false', 'the previous draft is cancelled');
			assert.strictEqual(row(dom, 0).querySelector('.condition-value'), null);
			assert.strictEqual(dom.document.activeElement, row(dom, 1).querySelector('.condition-value'));
			assert.strictEqual(dom.document.querySelectorAll('#conditions-list .condition-value').length, 1);

			const secondInput = row(dom, 1).querySelector('.condition-value');
			const escape = new dom.window.KeyboardEvent('keydown', {
				key: 'Escape',
				bubbles: true,
				cancelable: true,
			});
			secondInput.dispatchEvent(escape);
			assert.strictEqual(escape.defaultPrevented, true);
			assert.strictEqual(row(dom, 1).dataset.editing, 'false');
			assert.strictEqual(dom.document.activeElement, row(dom, 1).querySelector('.condition-edit'));
			assert.deepStrictEqual(posted, []);

			row(dom, 0).querySelector('.condition-edit').click();
			const input = row(dom, 0).querySelector('.condition-value');
			input.value = '9';
			const enter = new dom.window.KeyboardEvent('keydown', {
				key: 'Enter',
				bubbles: true,
				cancelable: true,
			});
			input.dispatchEvent(enter);
			assert.strictEqual(enter.defaultPrevented, true);
			assert.strictEqual(row(dom, 0).dataset.value, '9');
			assert.strictEqual(row(dom, 0).querySelector('.condition-value-text').textContent, '9');
			assert.strictEqual(dom.document.activeElement, row(dom, 0).querySelector('.condition-edit'));
			assert.deepStrictEqual(posted, [[
				{ name: 'A_SC', value: '9' },
				{ name: 'B_SC', value: '2' },
			]]);

			row(dom, 0).querySelector('.condition-edit').click();
			row(dom, 0).querySelector('.condition-cancel').click();
			assert.strictEqual(row(dom, 0).dataset.editing, 'false');
			assert.strictEqual(row(dom, 0).dataset.value, '9', 'Cancel keeps the committed value');
		} finally {
			dom.restore();
		}
	});

	test('a new row validates the trimmed name, rejects duplicates and clears the error on input', () => {
		const dom = panel();
		try {
			const posted: ConditionEntry[][] = [];
			setConditionsCallback((entries) => posted.push(entries));
			renderConditionEntries([]);
			const add = dom.document.getElementById('conditions-add') as HTMLElement;
			const status = dom.document.getElementById('conditions-status') as any;

			add.click();
			assert.strictEqual(rows(dom).length, 1);
			const draft = row(dom, 0);
			assert.deepStrictEqual(
				{ editing: draft.dataset.editing, new: draft.dataset.new },
				{ editing: 'true', new: 'true' }
			);
			const name = draft.querySelector('.condition-name') as HTMLInputElement;
			assert.strictEqual(name.placeholder, 'CONSTANT_NAME');
			assert.strictEqual(name.getAttribute('aria-label'), 'Constant name');
			assert.strictEqual(name.getAttribute('aria-invalid'), 'false');
			assert.strictEqual(dom.document.activeElement, name);
			assert.deepStrictEqual(
				Array.from(draft.querySelector('.condition-actions').children).map((child: any) => child.className),
				['act-btn condition-save', 'act-btn condition-cancel']
			);
			assert.strictEqual((dom.document.getElementById('conditions-clear') as any).disabled, true, 'a draft is not committed');

			draft.querySelector('.condition-save').click();
			assert.strictEqual(status.textContent, 'Enter a constant name before saving.');
			assert.strictEqual(name.getAttribute('aria-invalid'), 'true');
			assert.deepStrictEqual(posted, []);

			add.click();
			assert.strictEqual(rows(dom).length, 1, 'Add focuses the open new draft');
			assert.strictEqual(dom.document.activeElement, name);

			name.value = 'BAD NAME';
			name.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
			assert.strictEqual(name.getAttribute('aria-invalid'), 'false');
			assert.strictEqual(status.textContent, '');
			draft.querySelector('.condition-save').click();
			assert.strictEqual(
				status.textContent,
				'Invalid name: use a constant name or path (letters, digits, _ . - /).'
			);

			name.value = 'A_SC';
			(draft.querySelector('.condition-value') as HTMLInputElement).value = '1';
			draft.querySelector('.condition-save').click();
			assert.strictEqual(status.textContent, '');
			assert.strictEqual(row(dom, 0).dataset.new, 'false');
			assert.strictEqual(row(dom, 0).dataset.editing, 'false');
			assert.strictEqual(row(dom, 0).querySelector('.condition-name-text').textContent, 'A_SC');
			assert.strictEqual(row(dom, 0).querySelector('.condition-value-text').textContent, '1');
			assert.strictEqual(dom.document.activeElement, row(dom, 0).querySelector('.condition-edit'));
			assert.deepStrictEqual(posted, [[{ name: 'A_SC', value: '1' }]]);

			add.click();
			const duplicate = row(dom, 1);
			(duplicate.querySelector('.condition-name') as HTMLInputElement).value = 'A_SC';
			duplicate.querySelector('.condition-save').click();
			assert.strictEqual(status.textContent, 'A condition value named A_SC already exists.');
			assert.strictEqual(
				duplicate.querySelector('.condition-name')!.getAttribute('aria-invalid'),
				'true'
			);
			assert.strictEqual(rows(dom).length, 2);
			assert.strictEqual(posted.length, 1);

			duplicate.querySelector('.condition-cancel').click();
			assert.strictEqual(rows(dom).length, 1);
			assert.strictEqual(status.textContent, '');
		} finally {
			dom.restore();
		}
	});

	test('CPANEL-01 discovered rows lose Remove, regain it on re-scan and keep their committed value', () => {
		const dom = panel();
		try {
			renderConditionEntries([
				{ name: 'A_SC', value: '1' },
				{ name: 'MAN_SC', value: '2' },
			]);
			setConditionRows([{ condition: { symbols: ['A_SC', 'NEW_SC'] } }]);
			ensureDiscoveredConditionRows();
			assert.deepStrictEqual(rows(dom).map((entry) => entry.dataset.name), ['A_SC', 'MAN_SC', 'NEW_SC']);
			assert.strictEqual(row(dom, 0).dataset.auto, 'true');
			assert.strictEqual(row(dom, 0).querySelector('.condition-remove'), null);
			assert.strictEqual(row(dom, 0).querySelector('.condition-value-text').textContent, '1');
			assert.strictEqual(row(dom, 1).dataset.auto, 'false');
			assert.ok(row(dom, 1).querySelector('.condition-remove'));
			assert.strictEqual(row(dom, 2).dataset.auto, 'true');

			setConditionRows([{ condition: { symbols: ['MAN_SC'] } }]);
			ensureDiscoveredConditionRows();
			assert.deepStrictEqual(rows(dom).map((entry) => entry.dataset.name), ['A_SC', 'MAN_SC', 'NEW_SC']);
			assert.strictEqual(row(dom, 0).dataset.auto, 'false');
			assert.ok(row(dom, 0).querySelector('.condition-remove'), 'a manual row regains Remove');
			assert.strictEqual(row(dom, 0).querySelector('.condition-value-text').textContent, '1');
			assert.strictEqual(row(dom, 1).dataset.auto, 'true');
			assert.strictEqual(row(dom, 1).querySelector('.condition-remove'), null);
			assert.strictEqual(row(dom, 2).dataset.auto, 'false');
			assert.ok(row(dom, 2).querySelector('.condition-remove'));

			row(dom, 0).querySelector('.condition-edit').click();
			setConditionRows([{ condition: { symbols: [] } }]);
			ensureDiscoveredConditionRows();
			assert.strictEqual(row(dom, 0).dataset.editing, 'true');
			assert.ok(row(dom, 0).querySelector('.condition-value'), 'a re-scan does not rebuild the draft');
			assert.strictEqual(row(dom, 0).dataset.value, '1', 'the draft is not read as a committed value');

			renderConditionEntries([{ name: 'Z_SC', value: '3' }]);
			assert.deepStrictEqual(rows(dom).map((entry) => entry.dataset.name), ['A_SC', 'MAN_SC', 'NEW_SC']);
			assert.strictEqual(row(dom, 0).dataset.editing, 'true', 'a host entries push cannot replace a draft');
		} finally {
			dom.restore();
		}
	});

	test('CPANEL-02 Clear values with a draft open keeps the typed draft', () => {
		const dom = panel();
		try {
			setConditionsCallback(() => undefined);
			setConditionRows([]);
			renderConditionEntries([{ name: 'A_SC', value: '1' }]);
			(dom.document.getElementById('conditions-add') as HTMLElement).click();
			const draft = rows(dom).find((entry) => entry.dataset.new === 'true')!;
			assert.ok(draft, 'Add opened a draft row');
			const input = draft.querySelector('.condition-name') as HTMLInputElement;
			input.value = 'DRAFT_SC';
			input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

			(dom.document.getElementById('conditions-clear') as HTMLElement).click();
			const survivor = rows(dom).find((entry) => entry.dataset.new === 'true');
			assert.ok(survivor, 'the draft row survives Clear');
			assert.strictEqual((survivor!.querySelector('.condition-name') as HTMLInputElement).value, 'DRAFT_SC');
			assert.strictEqual(rows(dom).find((entry) => entry.dataset.name === 'A_SC')!.dataset.value, '');
		} finally {
			dom.restore();
		}
	});

	test('CPANEL-03 a 201st row is refused with the cap message', () => {
		const dom = panel();
		try {
			setConditionsCallback(() => undefined);
			setConditionRows([]);
			renderConditionEntries(
				Array.from({ length: 200 }, (_, at) => ({ name: `SC_${at}`, value: '1' }))
			);
			(dom.document.getElementById('conditions-add') as HTMLElement).click();
			assert.strictEqual(rows(dom).length, 200, 'no 201st row is created');
			const status = dom.document.getElementById('conditions-status') as HTMLElement;
			assert.ok(status.textContent?.includes('At most 200'), status.textContent ?? '');
		} finally {
			dom.restore();
		}
	});

	test('Remove, Clear values and the disabled count keep their contracts', () => {
		const dom = panel();
		try {
			const posted: ConditionEntry[][] = [];
			setConditionsCallback((entries) => posted.push(entries));
			setConditionRows([]);
			renderConditionEntries([
				{ name: 'A_SC', value: '1' },
				{ name: 'B_SC', value: '2' },
			]);

			row(dom, 1).querySelector('.condition-remove').click();
			assert.deepStrictEqual(rows(dom).map((entry) => entry.dataset.name), ['A_SC']);
			assert.deepStrictEqual(posted, [[{ name: 'A_SC', value: '1' }]]);

			setConditionRows([{ condition: { symbols: ['A_SC'] } }]);
			ensureDiscoveredConditionRows();
			const autoRow = row(dom, 0);
			assert.strictEqual(autoRow.dataset.auto, 'true');
			const injected = dom.document.createElement('button');
			injected.className = 'condition-remove';
			autoRow.appendChild(injected);
			injected.click();
			assert.strictEqual(rows(dom).length, 1, 'a scanned row has no Remove even if a control is injected');
			assert.strictEqual(posted.length, 1);

			setConditionRows([]);
			ensureDiscoveredConditionRows();
			renderConditionEntries([
				{ name: 'A_SC', value: '1' },
				{ name: 'B_SC', value: '2' },
			]);
			(dom.document.getElementById('conditions-clear') as HTMLElement).click();
			assert.deepStrictEqual(rows(dom).map((entry) => entry.dataset.name), ['A_SC', 'B_SC']);
			assert.deepStrictEqual(rows(dom).map((entry) => entry.dataset.value), ['', '']);
			assert.deepStrictEqual(rows(dom).map((entry) => entry.querySelector('.condition-state').hidden), [false, false]);
			assert.deepStrictEqual(posted[posted.length - 1], [
				{ name: 'A_SC', value: '' },
				{ name: 'B_SC', value: '' },
			]);

			setConditionRows([{ disabled: true }, { disabled: false }, { disabled: true }]);
			applyDisabledCount();
			const count = dom.document.getElementById('conditions-count') as any;
			assert.strictEqual(count.textContent, '2 disabled');
			assert.strictEqual(count.hidden, false);
			setConditionRows([]);
			applyDisabledCount();
			assert.strictEqual(count.textContent, '');
			assert.strictEqual(count.hidden, true);
		} finally {
			dom.restore();
		}
	});
});
