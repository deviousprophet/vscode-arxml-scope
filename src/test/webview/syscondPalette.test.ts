/**
 * The system-condition palette has one shared definition.
 *
 * `tokens.css` owns the variables and the `.syscond-*` colour classes; every
 * page imports it. `documentTree.css` keeps only the condition-chip layout and
 * state rules, and the Conditions panel consumes the same tokens. The Monaco
 * theme rules repeat the hex values by necessity, so a test pins them to the
 * CSS values.
 */
import * as assert from 'assert';

import { webviewCss, webviewSource } from './cssTestUtils';

suite('shared system-condition palette', () => {
	test('tokens.css defines the three condition variables with Dark+/Light+ values', () => {
		const css = webviewCss('styles', 'tokens.css');
		assert.ok(/--tok-syscond:\s*#569cd6/.test(css), 'the name uses the dark preprocessor blue');
		assert.ok(/--tok-syscond-op:\s*#c586c0/.test(css), 'the operator uses the dark parameter magenta');
		assert.ok(/--tok-syscond-literal:\s*#4fc1ff/.test(css), 'the literal uses the dark constant cyan');
		const lightBlock =
			/body\.vscode-light\[data-view\],\s*body\.vscode-high-contrast-light\[data-view\]\s*\{([^}]*)\}/.exec(css)?.[1] ??
			'';
		assert.ok(/--tok-syscond:\s*#0000ff/.test(lightBlock), 'light uses the Light+ preprocessor blue');
		assert.ok(/--tok-syscond-op:\s*#af00db/.test(lightBlock), 'light uses the Light+ parameter magenta');
		assert.ok(/--tok-syscond-literal:\s*#0070c1/.test(lightBlock), 'light uses the Light+ constant blue');
	});

	test('the Monaco theme rules repeat the same palette', () => {
		const setup = webviewSource('monaco', 'setup.ts');
		for (const [token, dark, light] of [
			['syscond', '569cd6', '0000ff'],
			['constant', '4fc1ff', '0070c1']
		]) {
			assert.ok(
				new RegExp(`\\{ token: '${token}', foreground: '${dark}' \\}`).test(setup),
				`the dark ${token} rule matches tokens.css`
			);
			assert.ok(
				new RegExp(`\\{ token: '${token}', foreground: '${light}' \\}`).test(setup),
				`the light ${token} rule matches tokens.css`
			);
		}
	});

	test('tokens.css owns every syscond colour class', () => {
		const css = webviewCss('styles', 'tokens.css');
		assert.ok(/\.syscond-name\s*\{[^}]*color:\s*var\(--tok-syscond\)/.test(css));
		assert.ok(/\.syscond-operator\s*\{[^}]*color:\s*var\(--tok-syscond-op\)/.test(css));
		assert.ok(/\.syscond-literal\s*\{[^}]*color:\s*var\(--tok-syscond-literal\)/.test(css));
		assert.ok(/\.syscond-number\s*\{[^}]*color:\s*var\(--tok-number\)/.test(css));
		assert.ok(/\.syscond-string\s*\{[^}]*color:\s*var\(--tok-string\)/.test(css));
		assert.ok(/\.syscond-punct\s*\{[^}]*color:\s*var\(--tok-punct\)/.test(css));
	});

	test('documentTree.css keeps the chip layout and state, not a second palette', () => {
		const css = webviewCss('components', 'documentTree', 'documentTree.css');
		assert.ok(/\.condition\s*\{[^}]*color:\s*var\(--tok-syscond\)/.test(css));
		assert.ok(
			/\.condition\[data-state="false"\]\s*\{[^}]*border-color:\s*var\(--vscode-errorForeground\)/.test(css),
			'a false condition keeps its edge cue'
		);
		for (const cls of ['name', 'operator', 'literal', 'number', 'string', 'punct']) {
			assert.ok(
				!new RegExp(`\\.syscond-${cls}\\s*\\{`).test(css),
				`documentTree.css does not own .syscond-${cls}`
			);
		}
	});

	test('every page loads the shared stylesheet', () => {
		for (const page of ['editorMonaco.ts', 'editorViewer.ts', 'diffMonaco.ts']) {
			assert.ok(
				webviewSource(page).includes("import './styles/tokens.css';"),
				`${page} imports the shared tokens`
			);
		}
	});

	test('the Conditions panel uses the shared condition colours', () => {
		const css = webviewCss('components', 'sidebar', 'conditionsPanel', 'conditionsPanel.css');
		assert.ok(/\.condition-name-text\s*\{[^}]*color:\s*var\(--tok-syscond\)/.test(css));
		assert.ok(/\.condition-name\s*\{[^}]*color:\s*var\(--tok-syscond\)/.test(css));
		assert.ok(/\.condition-state\s*\{[^}]*color:\s*var\(--tok-syscond-literal\)/.test(css));
		assert.ok(
			/\.condition-value-text\[data-value-kind="boolean"\]\s*\{[^}]*color:\s*var\(--tok-syscond-literal\)/.test(
				css
			)
		);
		assert.ok(
			/\.condition-state\s*\{[^}]*border:\s*1px dashed/.test(css),
			'the state keeps its border, not colour alone'
		);
	});
});
