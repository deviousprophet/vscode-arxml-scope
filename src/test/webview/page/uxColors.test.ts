/**
 * AC14 — semantic element colours. The stylesheet maps value kinds to theme
 * variables without changing the `.value` contract; the row model owns the kind.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../../core/ecuc/scanner';
import { buildRows } from '../../../core/ecuc/renderRows';
import { webviewCss } from '../cssTestUtils';
import { fixtureText } from '../../core/modelTestUtils';

const FIXTURE = 'editor/render.arxml';

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

function style(): string {
	return webviewCss('components', 'documentTree', 'documentTree.css') + webviewCss('styles', 'tokens.css');
}

function kindFor(name: string): string | undefined {
	const rows = buildRows(scanEcucValues(fixtureText(FIXTURE))).rows;
	const row = rows.find((candidate) => candidate.definitionRef === `/PkgA/PkgB/ModDefs/ModX/ContA/${name}`);
	assert.ok(row, `the ${name} row exists`);
	return row.valueKind;
}

suite('editor semantic colours (AC14)', () => {
	test('AC14: numeric, textual and boolean values carry their own kind', () => {
		assert.strictEqual(kindFor('IniValue'), 'numeric');
		assert.strictEqual(kindFor('Title'), 'textual');
		assert.strictEqual(kindFor('Flag'), 'boolean');
		const upper = buildRows(scanEcucValues(BOOLEAN_CASE_FIXTURE), {}).rows;
		assert.strictEqual(
			upper.filter((row) => row.valueKind === 'boolean').length,
			2,
			'boolean detection is case-insensitive (TRUE / False)'
		);
	});

	test('AC14: the Tree kind glyphs and accent borders are removed', () => {
		const css = style();
		assert.ok(!css.includes('.glyph'), 'no Tree glyphs');
		for (const kind of ['module', 'container', 'parameter', 'reference']) {
			assert.ok(
				!new RegExp(`\\.row\\.k-${kind}\\s*\\{[^}]*--vscode-symbolIcon`).test(css),
				`no ${kind} kind border`
			);
		}
	});

	test('AC14: value types, references and short names use their semantic scopes', () => {
		const css = style();
		assert.ok(/\.value\[data-value-kind="numeric"\]\s*\{[^}]*--tok-number/.test(css));
		assert.ok(/\.value\[data-value-kind="textual"\]\s*\{[^}]*--tok-string/.test(css));
		assert.ok(/\.value\[data-value-kind="boolean"\]\s*\{[^}]*--tok-keyword/.test(css));
		assert.ok(!/\.target\s*\{/.test(css), 'reference targets have no Document link style');
		assert.ok(!/\.target:hover \.value-text/.test(css), 'reference targets have no hover underline');
		assert.ok(/\.short\s*\{[^}]*--tok-string/.test(css));
	});

	test('AC14: selection is a tint and does not recolour syntax', () => {
		const css = style();
		assert.ok(/--sel-bg:\s*color-mix\([^;]*--vscode-list-inactiveSelectionBackground/.test(css));
		assert.ok(/--sel-bg-focus:\s*color-mix\([^;]*--vscode-list-activeSelectionBackground/.test(css));
		assert.ok(/\.node\[data-selected="true"\] > \.row\s*\{[^}]*background-color:\s*var\(--sel-bg-focus\)/.test(css));
		assert.ok(
			/\.document-tree:focus-within \.node\[data-selected="true"\] > \.row\s*\{[^}]*background-color:\s*var\(--sel-bg-focus\)/.test(
				css
			)
		);
		assert.ok(!css.includes('--ecuc-selection-fg'), 'selection never recolours syntax');
		const hexes = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
		assert.deepStrictEqual(
			hexes.sort(),
			['#4EC9B0', '#80808040', '#DCDCAA'].sort(),
			'the semantic guide/colour fallbacks are the only literals'
		);
	});
});
