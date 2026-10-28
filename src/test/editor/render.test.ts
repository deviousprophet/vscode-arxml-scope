/**
 * AC1 — every entity the model carries is present in the row document with the
 * correct label and value. The page builds its rows from this data; there is no
 * full-tree HTML string to assert against.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { RowPayload, encodeRowDocument, renderHtml } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';

const FIXTURE = 'editor/render.arxml';

function html(): string {
	return renderHtml(scanEcucValues(fixtureText(FIXTURE)), { nonce: 'test-nonce' });
}

function payload(source = html()): RowPayload {
	const match = /<script type="application\/json" id="ecuc-rows"[^>]*>([\s\S]*?)<\/script>/.exec(source);
	assert.ok(match, 'the page embeds the row document');
	return JSON.parse(match[1]) as RowPayload;
}

suite('editor rendering (AC1)', () => {
	test('AC1: the schema release and the package path are shown', () => {
		const page = html();
		assert.ok(page.includes('>schema</span> <span class="number">00048</span>'));
		assert.ok(page.includes('>package</span> PkgA.PkgB'));
	});

	test('AC1: the module row carries its dotted DEFINITION-REF path, short name and variant', () => {
		const rows = payload().rows;
		const module = rows.find((row) => row.kind === 'module');
		assert.ok(module, 'the fixture has a module');
		assert.strictEqual(module.label, 'PkgA.PkgB.ModDefs.ModX', 'the full dotted definition path');
		assert.strictEqual(module.shortName, 'ModX');
		assert.strictEqual(module.definitionRef, '/PkgA/PkgB/ModDefs/ModX');
		assert.ok(
			module.meta.some((part) => part.cls === 'variant' && part.text === '(VariantPreCompile)'),
			'the camelized implementation variant'
		);
	});

	test('AC1: conditions and annotations are carried as values, including an unlabelled annotation', () => {
		const module = payload().rows.find((row) => row.kind === 'module')!;
		const texts = module.meta.map((part) => part.text);
		assert.ok(texts.includes('[(A == B)]'), 'SW-SYSCOND');
		assert.ok(texts.includes('<Crit1 == 1 && Crit2 == 2>'), 'post-build variant conditions');
		assert.ok(texts.includes('[Note] module note'), 'a labelled annotation');
		const container = payload().rows.find((row) => row.label === 'ContA')!;
		assert.ok(container.meta.some((part) => part.text === 'container note'), 'an annotation with no label');
	});

	test('AC1: containers are labelled by their DEFINITION-REF tail', () => {
		const labels = payload().rows.filter((row) => row.kind === 'container').map((row) => row.label);
		assert.deepStrictEqual(labels, ['ContA', 'ContB']);
	});

	test('AC1: parameters show their tail, their value, and a numeric hex form', () => {
		const rows = payload().rows;
		const ini = rows.find((row) => row.label === 'IniValue')!;
		assert.strictEqual(ini.kind, 'parameter');
		assert.strictEqual(ini.value, '63');
		assert.strictEqual(ini.shownValue, '63');
		assert.strictEqual(ini.valueKind, 'numeric');
		assert.ok(ini.meta.some((part) => part.cls === 'hex' && part.text === '(= 0x3F)'));
		assert.strictEqual(rows.find((row) => row.label === 'Title')!.shownValue, '"hello"', 'text is quoted');
		assert.strictEqual(rows.find((row) => row.label === 'Flag')!.shownValue, 'true', 'a boolean is bare');
	});

	test('AC1: references show their tail and the dotted target, with instance context', () => {
		const rows = payload().rows;
		const peerRef = rows.find((row) => row.label === 'PeerRef')!;
		assert.strictEqual(peerRef.kind, 'reference');
		assert.strictEqual(peerRef.shownValue, 'PkgA.PkgB.ModX.ContA.ContB');
		const peerIref = rows.find((row) => row.label === 'PeerIref')!;
		assert.strictEqual(peerIref.target, '/PkgA/PkgB/ModX/ContA/ContB', 'the raw target is kept for follow');
		assert.deepStrictEqual(peerIref.contextPaths, ['PkgA.PkgB.ModX.ContA']);
		assert.ok(peerIref.meta.some((part) => part.text === 'context PkgA.PkgB.ModX.ContA'));
	});

	test('AC1: a container and a parameter expose the full DEFINITION-REF path on hover', () => {
		const rows = payload().rows;
		assert.strictEqual(rows.find((row) => row.label === 'ContA')!.title, '/PkgA/PkgB/ModDefs/ModX/ContA');
		assert.strictEqual(
			rows.find((row) => row.label === 'IniValue')!.title,
			'/PkgA/PkgB/ModDefs/ModX/ContA/IniValue'
		);
	});

	test('AC1: the page is the static virtual shell, not a rendered tree', () => {
		const source = html();
		assert.ok(source.includes('id="tree" class="tree" role="tree" aria-label="ECUC values"'));
		assert.ok(source.includes('id="tree-top" class="v-spacer" role="presentation" aria-hidden="true"></div>'));
		assert.ok(source.includes('id="tree-window" role="presentation"></div>'));
		assert.ok(source.includes('id="tree-bottom" class="v-spacer" role="presentation" aria-hidden="true"></div>'));
		const treeShell = /<div id="tree"[^>]*>(\s*)<div id="tree-top"/.exec(source);
		assert.ok(treeShell);
		assert.strictEqual(
			treeShell[1],
			'',
			'no whitespace text between the tree container and the top spacer, which would shift the virtual rows'
		);
		assert.ok(
			source.includes(
				'aria-hidden="true"></div><div id="tree-window" role="presentation"></div><div id="tree-bottom"'
			),
			'the spacers and window are flush, so the scroll offset matches the first rendered row'
		);
		assert.ok(!source.includes('data-node-id="'), 'the initial markup has no tree rows');
		assert.ok(!source.includes('<div class="node" role="treeitem"'), 'no full-tree DOM');
		assert.ok(source.includes('id="ecuc-rows"'), 'the rows are data');
		assert.ok(source.includes('setRows(message.rows, message.digits, message.selectedId)'));
	});

	test('AC1: the initial row JSON escapes model text so it cannot close the script', () => {
		const module = payload().rows.find((row) => row.kind === 'module')!;
		const encoded = encodeRowDocument({
			rows: [{ ...module, label: '</script><script>alert(1)</script>', definitionRef: '</script>' }],
			digits: 1,
		});
		assert.ok(!encoded.includes('</script>'), 'no raw closing tag');
		const decoded = JSON.parse(encoded) as RowPayload;
		assert.strictEqual(decoded.rows[0].label, '</script><script>alert(1)</script>');
		assert.strictEqual(decoded.rows[0].definitionRef, '</script>');
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
