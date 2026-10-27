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

/** Uppercase/mixed-case booleans are legal AUTOSAR values; the reference grammar highlights them. */
const BOOLEAN_CASE_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0">
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>P</SHORT-NAME>
      <ELEMENTS>
        <ECUC-MODULE-CONFIGURATION-VALUES>
          <SHORT-NAME>M</SHORT-NAME>
          <DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/M</DEFINITION-REF>
          <CONTAINERS>
            <ECUC-CONTAINER-VALUE>
              <SHORT-NAME>C</SHORT-NAME>
              <DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/M/C</DEFINITION-REF>
              <PARAMETER-VALUES>
                <ECUC-NUMERICAL-PARAM-VALUE>
                  <DEFINITION-REF DEST="ECUC-BOOLEAN-PARAM-DEF">/P/M/C/Upper</DEFINITION-REF>
                  <VALUE>TRUE</VALUE>
                </ECUC-NUMERICAL-PARAM-VALUE>
                <ECUC-NUMERICAL-PARAM-VALUE>
                  <DEFINITION-REF DEST="ECUC-BOOLEAN-PARAM-DEF">/P/M/C/Mixed</DEFINITION-REF>
                  <VALUE>False</VALUE>
                </ECUC-NUMERICAL-PARAM-VALUE>
              </PARAMETER-VALUES>
            </ECUC-CONTAINER-VALUE>
          </CONTAINERS>
        </ECUC-MODULE-CONFIGURATION-VALUES>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;


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
		const upper = renderTree(scanEcucValues(BOOLEAN_CASE_FIXTURE), {});
		assert.strictEqual(
			(upper.match(/data-value-kind="boolean"/g) ?? []).length,
			2,
			'boolean detection is case-insensitive (TRUE / False)'
		);
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
		assert.ok(/\.value\[data-value-kind="numeric"\]\s*\{[^}]*--tok-number/.test(style));
		assert.ok(/\.value\[data-value-kind="textual"\]\s*\{[^}]*--tok-string/.test(style));
		assert.ok(/\.value\[data-value-kind="boolean"\]\s*\{[^}]*--tok-keyword/.test(style));
		assert.ok(/\.target\s*\{[^}]*--vscode-editor-foreground/.test(style));
		assert.ok(/\.target:hover \.value-text\s*\{[^}]*--vscode-textLink-foreground/.test(style));
		assert.ok(/\.short\s*\{[^}]*--tok-string/.test(style));
	});

	test('AC14: selection is a tint and does not recolour syntax', () => {
		const style = styleOf(page());
		assert.ok(/--sel-bg:\s*var\(--vscode-list-inactiveSelectionBackground/.test(style));
		assert.ok(/--sel-bg-focus:\s*var\(--vscode-list-activeSelectionBackground/.test(style));
		assert.ok(
			/\.node\[data-selected="true"\] > \.row\s*\{[^}]*background:\s*var\(--sel-bg\)/.test(style)
		);
		assert.ok(
			/#tree:focus-within \.node\[data-selected="true"\] > \.row\s*\{[^}]*background:\s*var\(--sel-bg-focus\)/.test(
				style
			)
		);
		assert.ok(!style.includes('--ecuc-selection-fg'), 'selection never recolours syntax');
		const hexes = [...style.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
		assert.deepStrictEqual(hexes, ['#80808040'], 'the indent-guide fallback is still the only literal');
	});
});
