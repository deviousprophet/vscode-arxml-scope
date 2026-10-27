/**
 * AC1 — every entity the model carries is rendered with the correct label and value.
 *
 * Asserted against the string `renderHtml` returns: a live webview would add no
 * coverage for a pure projection, only cost.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { renderHtml, renderTree } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';

const FIXTURE = 'editor/render.arxml';

function html(): string {
	return renderHtml(scanEcucValues(fixtureText(FIXTURE)), { nonce: 'test-nonce' });
}

suite('editor rendering (AC1)', () => {
	test('AC1: the schema release and the package path are shown', () => {
		const page = html();
		assert.ok(page.includes('>schema</span> <span class="number">00048</span>'));
		assert.ok(page.includes('>package</span> PkgA.PkgB'));
	});

	test('AC1: the module shows its dotted DEFINITION-REF path, short name and variant', () => {
		const page = html();
		assert.ok(page.includes('PkgA.PkgB.ModDefs.ModX'), 'the full dotted definition path');
		assert.ok(page.includes('"ModX"'));
		assert.ok(page.includes('(VariantPreCompile)'), 'the camelized implementation variant');
	});

	test('AC1: conditions and annotations are rendered, including an unlabelled annotation', () => {
		const page = html();
		assert.ok(page.includes('[(A == B)]'), 'SW-SYSCOND');
		assert.ok(page.includes('&lt;Crit1 == 1 &amp;&amp; Crit2 == 2&gt;'), 'post-build variant conditions');
		assert.ok(page.includes('[Note] module note'), 'a labelled annotation');
		assert.ok(page.includes('container note'), 'an annotation with no label still shows its text');
	});

	test('AC1: containers are labelled by their DEFINITION-REF tail', () => {
		const page = html();
		assert.ok(page.includes('<span class="label">ContA</span>'));
		assert.ok(page.includes('<span class="label">ContB</span>'));
	});

	test('AC1: parameters show their tail, their value, and a numeric hex form', () => {
		const page = html();
		assert.ok(page.includes('<span class="label">IniValue</span>'));
		assert.ok(page.includes('>63</span>'));
		assert.ok(page.includes('(= 0x3F)'), 'the secondary hexadecimal form');
		assert.ok(page.includes('>"hello"</span>'), 'a textual value is quoted');
		assert.ok(page.includes('>true</span>'));
	});

	test('AC1: references show their tail and the dotted target, with instance context', () => {
		const page = html();
		assert.ok(page.includes('<span class="label">PeerRef</span>'));
		assert.ok(page.includes('>PkgA.PkgB.ModX.ContA.ContB</span>'));
		assert.ok(page.includes('<span class="label">PeerIref</span>'));
		assert.ok(page.includes('>context</span> PkgA.PkgB.ModX.ContA'));
	});

	test('AC1: a container and a parameter expose the full DEFINITION-REF path on hover', () => {
		const page = html();
		assert.ok(page.includes('title="/PkgA/PkgB/ModDefs/ModX/ContA"'));
		assert.ok(page.includes('title="/PkgA/PkgB/ModDefs/ModX/ContA/IniValue"'));
	});

	test('AC1: the re-scan payload is the tree region on its own', () => {
		const model = scanEcucValues(fixtureText(FIXTURE));
		const region = renderTree(model, {});
		assert.ok(region.startsWith('<div class="document">'));
		assert.ok(region.includes('id="tree"'));
		assert.ok(!region.includes('<script'), 'the payload is a fragment, not a page');
		assert.ok(renderHtml(model, { nonce: 'test-nonce' }).includes(region));
	});

	test('AC1: every colour comes from a --vscode-* variable, and assets are inlined', () => {
		const page = html();
		const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(page);
		assert.ok(style, 'one inlined style block');
		assert.ok(style[1].includes('var(--vscode-'), 'theming through CSS custom properties');
		assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(style[1]), 'no hard-coded colour');
		assert.ok(page.includes('nonce="test-nonce"'), 'style and script carry the nonce');
		assert.ok(page.includes("default-src 'none'"), 'a CSP meta is present');
		assert.ok(!/<script[^>]+src=/.test(page), 'nothing is loaded remotely');
	});
});
