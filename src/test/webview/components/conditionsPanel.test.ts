/**
 * ConditionsPanel component: name validation and the panel markup. The live
 * add/edit/remove flow is exercised through the mounted editor page.
 */
import * as assert from 'assert';

import {
	conditionEntryError,
	conditionNameValid,
	renderConditionsPanelHtml,
} from '../../../webview/components/sidebar/conditionsPanel/conditionsPanel';

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
});
