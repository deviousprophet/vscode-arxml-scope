/**
 * AC8 — arrow keys traverse the tree, Enter activates the focused node, and focus is
 * always visible with a theme colour. The roles and the keyboard wiring are asserted on
 * the rendered string; there is no live-webview API to press a key through.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { renderHtml } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';

const FIXTURE = 'editor/render.arxml';

function html(): string {
	return renderHtml(scanEcucValues(fixtureText(FIXTURE)), { nonce: 'test-nonce' });
}

suite('editor accessibility (AC8)', () => {
	test('AC8: the tree exposes real tree roles, levels and expansion state', () => {
		const page = html();
		assert.ok(page.includes('role="tree"'));
		assert.ok(page.includes('aria-label="ECUC values"'));
		assert.ok(page.includes('role="treeitem"'));
		assert.ok(page.includes('role="group"'), 'children are grouped');
		assert.ok(page.includes('aria-level="1"'));
		assert.ok(page.includes('aria-level="3"'), 'a parameter nested two levels down');
		assert.ok(page.includes('aria-expanded="true"'));
		assert.ok(page.includes('tabindex="0"'), 'one item is reachable by Tab');
		assert.ok(page.includes('aria-live="polite"'), 'notices are announced');
	});

	test('AC8: arrow keys and Enter are wired', () => {
		const page = html();
		for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter']) {
			assert.ok(page.includes(`'${key}'`), key);
		}
		assert.ok(page.includes("event.preventDefault()"), 'the default scroll is suppressed');
	});

	test('AC8: focus is visible and drawn with a theme colour', () => {
		const page = html();
		assert.ok(page.includes(':focus-visible'));
		assert.ok(page.includes('var(--vscode-focusBorder)'));
		assert.ok(page.includes('var(--vscode-list-activeSelectionBackground)'));
	});
});
