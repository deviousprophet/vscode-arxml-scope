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
import { renderHtml } from '../../editor/renderHtml';
import { buildRows } from '../../editor/renderRows';
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


function rows(): ReturnType<typeof buildRows>['rows'] {
	return buildRows(scanEcucValues(fixtureText(FIXTURE))).rows;
}

function page(): string {
	return renderHtml(scanEcucValues(fixtureText(FIXTURE)), { nonce: 'test-nonce' });
}

function styleOf(html: string): string {
	const match = /<style[^>]*>([\s\S]*?)<\/style>/.exec(html);
	assert.ok(match, 'one inlined style block');
	return match[1];
}

/** The `data-value-kind` the row builder will use for the parameter named `name`. */
function kindFor(name: string): string | undefined {
	const row = rows().find(
		(candidate) => candidate.definitionRef === `/PkgA/PkgB/ModDefs/ModX/ContA/${name}`
	);
	assert.ok(row, `the ${name} row exists`);
	return row.valueKind;
}

suite('editor semantic colours (AC14)', () => {
	test('AC14: numeric, textual and boolean values carry their own kind', () => {
		assert.strictEqual(kindFor('IniValue'), 'numeric');
		assert.strictEqual(kindFor('Title'), 'textual');
		assert.strictEqual(kindFor('Flag'), 'boolean');
		// The class contract is unchanged; the widget and filter still select `.value`.
		assert.ok(page().includes("value.className = followable ? 'value target' : 'value'"));
		const upper = buildRows(scanEcucValues(BOOLEAN_CASE_FIXTURE), {}).rows;
		assert.strictEqual(
			upper.filter((row) => row.valueKind === 'boolean').length,
			2,
			'boolean detection is case-insensitive (TRUE / False)'
		);
	});

	test('AC14: the Tree kind glyphs and accent borders are removed', () => {
		const style = styleOf(page());
		assert.ok(!style.includes('.glyph'), 'no Tree glyphs');
		assert.ok(!/\.row\.k-module\s*\{[^}]*--vscode-symbolIcon/.test(style), 'no module kind border');
		assert.ok(!/\.row\.k-container\s*\{[^}]*--vscode-symbolIcon/.test(style), 'no container kind border');
		assert.ok(!/\.row\.k-parameter\s*\{[^}]*--vscode-symbolIcon/.test(style), 'no parameter kind border');
		assert.ok(!/\.row\.k-reference\s*\{[^}]*--vscode-symbolIcon/.test(style), 'no reference kind border');
	});

	test('AC14: value types, references and short names use their semantic scopes', () => {
		const style = styleOf(page());
		assert.ok(/\.value\[data-value-kind="numeric"\]\s*\{[^}]*--tok-number/.test(style));
		assert.ok(/\.value\[data-value-kind="textual"\]\s*\{[^}]*--tok-string/.test(style));
		assert.ok(/\.value\[data-value-kind="boolean"\]\s*\{[^}]*--tok-keyword/.test(style));
		assert.ok(/\.target\s*\{[^}]*--vscode-editor-foreground/.test(style));
		assert.ok(/\.target:hover \.value-text\s*\{[^}]*text-decoration:\s*underline[^}]*text-decoration-color:\s*var\(--vscode-textLink-foreground/.test(style));
		assert.ok(/\.short\s*\{[^}]*--tok-string/.test(style));
	});

	test('AC14: selection is a tint and does not recolour syntax', () => {
		const style = styleOf(page());
		assert.ok(/--sel-bg:\s*color-mix\([^;]*--vscode-list-inactiveSelectionBackground/.test(style));
		assert.ok(/--sel-bg-focus:\s*color-mix\([^;]*--vscode-list-activeSelectionBackground/.test(style));
		assert.ok(
			/\.node\[data-selected="true"\] > \.row\s*\{[^}]*background-color:\s*var\(--sel-bg-focus\)/.test(style)
		);
		assert.ok(
			/#tree:focus-within \.node\[data-selected="true"\] > \.row\s*\{[^}]*background-color:\s*var\(--sel-bg-focus\)/.test(
				style
			)
		);
		assert.ok(!style.includes('--ecuc-selection-fg'), 'selection never recolours syntax');
		const hexes = [...style.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
		assert.deepStrictEqual(
			hexes.sort(),
			['#4EC9B0', '#80808040', '#DCDCAA'].sort(),
			'the semantic guide/colour fallbacks are the only literals'
		);
	});
});
