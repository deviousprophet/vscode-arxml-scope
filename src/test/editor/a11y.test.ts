/**
 * AC8 — the flat tree exposes real tree semantics, keyboard traversal is wired, and
 * focus is always visible with a theme colour. The roles/attributes are built by the
 * page's row builder from the row data; there is no live-webview API to press a key
 * through, so the wiring is asserted on the inlined script.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { RowPayload, renderHtml } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';
import { functionSource } from './scriptTestUtils';

const FIXTURE = 'editor/render.arxml';

function html(): string {
	return renderHtml(scanEcucValues(fixtureText(FIXTURE)), { nonce: 'test-nonce' });
}

function payload(source = html()): RowPayload {
	const match = /<script type="application\/json" id="ecuc-rows"[^>]*>([\s\S]*?)<\/script>/.exec(source);
	assert.ok(match, 'the page embeds the row document');
	return JSON.parse(match[1]) as RowPayload;
}

suite('editor accessibility (AC8)', () => {
	test('AC8: the tree exposes real tree roles, levels and expansion state', () => {
		const page = html();
		assert.ok(page.includes('role="tree"'));
		assert.ok(page.includes('aria-label="ECUC values"'));
		assert.ok(!page.includes('role="group"'), 'the flat tree drops group wrappers deliberately');
		assert.ok(page.includes("this.windowEl.className = 'document-tree-window'"), 'the window wrapper exists');
		assert.ok(page.includes("this.windowEl.setAttribute('role', 'presentation')"), 'the window wrapper is presentational');
		assert.ok(page.includes("this.spacer('document-tree-top')"));
		assert.ok(page.includes("this.spacer('document-tree-bottom')"));
		assert.ok(page.includes('aria-live="polite"'), 'notices are announced');

		const build = functionSource(page, 'buildDocumentNodeRow');
		for (const attribute of ['role', 'aria-level', 'aria-posinset', 'aria-setsize', 'aria-selected']) {
			assert.ok(build.includes(`setAttribute('${attribute}'`), attribute);
		}
		assert.ok(build.includes("setAttribute('aria-expanded', context.expandedIds.has(row.id) ? 'true' : 'false')"));
		assert.ok(build.includes('node.tabIndex = -1'), 'roving tabindex');
		assert.ok(functionSource(page, 'applyRoving').includes('element.tabIndex = renderedId === id ? 0 : -1'));

		const rows = payload(page).rows;
		assert.ok(rows.some((row) => row.level === 1));
		assert.ok(rows.some((row) => row.level === 3), 'a parameter nested two levels down');
		assert.ok(rows.some((row) => row.hasChildren), 'a row with an expansion state');
	});

	test('AC8: arrow keys and Enter are wired', () => {
		const page = html();
		const keys = functionSource(page, 'onTreeKeydown');
		for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter']) {
			assert.ok(page.includes(`'${key}'`) || page.includes(`event.key === '${key}'`), key);
		}
		assert.ok(keys.includes('event.preventDefault()'), 'the default scroll is suppressed');
		assert.ok(keys.includes('moveTarget('), 'movement goes through the shared map');
		assert.ok(keys.includes('focusRow(nextId)'), 'the target is rendered before it is focused');
	});

	test('AC8: focus is visible and drawn with a theme colour', () => {
		const page = html();
		assert.ok(page.includes(':focus-visible'));
		assert.ok(page.includes('var(--vscode-focusBorder)'));
		assert.ok(page.includes('--rail: var(--vscode-focusBorder'));
		assert.ok(page.includes('--sel-bg-focus: color-mix('));
		assert.ok(page.includes('--vscode-list-activeSelectionBackground'));
	});

	test('AC8: the details value editor has a label, invalid state and live error', () => {
		const page = html();
		const details = functionSource(page, 'detailsValueInput');
		assert.ok(details.includes("input.setAttribute('aria-label'"), 'the input is named');
		assert.ok(details.includes("input.id = 'details-value'"));
		assert.ok(
			functionSource(page, 'setDetailsError').includes("setAttribute('aria-invalid', 'true')"),
			'refusal marks the waiting control invalid'
		);
		const fields = functionSource(page, 'detailsFieldInput');
		assert.ok(fields.includes("input.setAttribute('aria-label'"), 'the container controls are named too');
		assert.ok(fields.includes("input.setAttribute('data-field', field)"), 'each control names its field');
		const error = functionSource(page, 'detailsErrorSpan');
		assert.ok(error.includes("error.setAttribute('role', 'status')"), 'the error is announced');
		assert.ok(error.includes("error.setAttribute('aria-live', 'polite')"));
		assert.ok(page.includes('.details-value-error'), 'the error has a style');
	});
});
