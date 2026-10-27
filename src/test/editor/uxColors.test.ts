/**
 * AC14 — semantic element colours. The reference ARTEXT grammar distinguishes keywords,
 * strings, booleans, numeric literals, entity/type names and variables; this suite asserts the
 * custom viewer maps those scopes to theme variables without changing the `.value` contract.
 *
 * The stylesheet is asserted, and the values are asserted against the rendered markup. The
 * actual contrast is measured in the browser harness and recorded in `implement.md`; a CSS rule
 * alone is not a contrast measurement.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { LineIndex } from '../../core/text/offsets';
import { renderHtml, renderTree } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';

const FIXTURE = 'editor/render.arxml';

function tree(): string {
	const text = fixtureText(FIXTURE);
	return renderTree(scanEcucValues(text), { lineIndex: new LineIndex(text) });
}

function page(): string {
	const text = fixtureText(FIXTURE);
	return renderHtml(scanEcucValues(text), { nonce: 'test-nonce', lineIndex: new LineIndex(text) });
}

function styleOf(html: string): string {
	const match = /<style[^>]*>([\s\S]*?)<\/style>/.exec(html);
	assert.ok(match, 'one inlined style block');
	return match[1];
}

/** The `data-value-kind` of the parameter named `name`, scoped to its own node. */
function kindFor(name: string): string | undefined {
	const html = tree();
	const at = html.indexOf(`data-definition-ref="/PkgA/PkgB/ModDefs/ModX/ContA/${name}"`);
	assert.notStrictEqual(at, -1, `the ${name} node is rendered`);
	const end = html.indexOf('</div>', at);
	const snippet = html.slice(at, end);
	const match = /<span class="value" data-value-kind="([^"]+)"/.exec(snippet);
	return match ? match[1] : undefined;
}

suite('editor semantic colours (AC14)', () => {
	test('AC14: numeric, textual and boolean values carry their own kind', () => {
		assert.strictEqual(kindFor('IniValue'), 'numeric');
		assert.strictEqual(kindFor('Title'), 'textual');
		assert.strictEqual(kindFor('Flag'), 'boolean');
		// The class contract is unchanged; the widget and filter still select `.value`.
		assert.ok(tree().includes('<span class="value" data-value-kind="numeric"'));
	});

	test('AC14: each kind has its own accent and glyph variable', () => {
		const style = styleOf(page());
		assert.ok(/\.row\.k-module\s*\{[^}]*--vscode-symbolIcon-moduleForeground/.test(style));
		assert.ok(/\.row\.k-container\s*\{[^}]*--vscode-symbolIcon-namespaceForeground/.test(style));
		assert.ok(/\.row\.k-parameter\s*\{[^}]*--vscode-symbolIcon-fieldForeground/.test(style));
		assert.ok(/\.row\.k-reference\s*\{[^}]*--vscode-symbolIcon-referenceForeground/.test(style));
		assert.ok(/\.glyph \.g-module\s*\{[^}]*--vscode-symbolIcon-moduleForeground/.test(style));
		assert.ok(/\.glyph \.g-container\s*\{[^}]*--vscode-symbolIcon-namespaceForeground/.test(style));
		assert.ok(/\.glyph \.g-parameter\s*\{[^}]*--vscode-symbolIcon-fieldForeground/.test(style));
		assert.ok(/\.glyph \.g-reference\s*\{[^}]*--vscode-symbolIcon-referenceForeground/.test(style));
	});

	test('AC14: value types, references and short names use their semantic scopes', () => {
		const style = styleOf(page());
		assert.ok(/\.value\[data-value-kind="numeric"\]\s*\{[^}]*--vscode-symbolIcon-numberForeground/.test(style));
		assert.ok(/\.value\[data-value-kind="textual"\]\s*\{[^}]*--vscode-symbolIcon-stringForeground/.test(style));
		assert.ok(/\.value\[data-value-kind="boolean"\]\s*\{[^}]*--vscode-symbolIcon-booleanForeground/.test(style));
		assert.ok(/\.target\s*\{[^}]*--vscode-textLink-foreground/.test(style));
		assert.ok(/\.short\s*\{[^}]*--vscode-symbolIcon-variableForeground/.test(style));
	});

	test('AC14: selection still owns the foreground, and no colour literal is added', () => {
		const style = styleOf(page());
		assert.ok(
			/\.node\[data-selected="true"\] > \.row > \.value[\s\S]*?\{[^}]*--vscode-list-activeSelectionForeground/.test(
				style
			)
		);
		const hexes = [...style.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
		assert.deepStrictEqual(hexes, ['#80808040'], 'the indent-guide fallback is still the only literal');
	});
});
