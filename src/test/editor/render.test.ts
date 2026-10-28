/**
 * AC1 — every entity the model carries is present in the row document with the
 * correct label and value. The page builds its rows from this data; there is no
 * full-tree HTML string to assert against.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { RowPayload, encodeRowDocument, renderHtml } from '../../editor/renderHtml';
import { fixtureText } from '../core/modelTestUtils';
import { evaluateFunction } from './scriptTestUtils';

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

	test('AC1: a boot failure is shown in the notice region instead of an empty tree', () => {
		const page = html();
		assert.ok(
			page.indexOf('window.ecucReportError = show') !== -1 &&
				page.indexOf('window.ecucReportError = show') < page.indexOf('acquireVsCodeApi'),
			'the error surface is armed before the API is acquired'
		);
		assert.ok(page.includes("addEventListener('error'"), 'uncaught errors are shown');
		assert.ok(page.includes("addEventListener('unhandledrejection'"), 'rejected promises are shown');
		assert.ok(page.includes("postMessage({ type: 'ready' })"), 'a live page tells the host it booted');
	});

	test('AC2: an unreadable row payload is reported instead of an empty tree', () => {
		const page = html();
		const reported: string[] = [];
		const globals = globalThis as unknown as {
			document?: unknown;
			window?: { ecucReportError?: (text: string) => void };
		};
		const savedDocument = globals.document;
		const savedWindow = globals.window;
		globals.document = { getElementById: () => ({ textContent: '{ not json' }) };
		globals.window = { ecucReportError: (text: string) => reported.push(text) };
		try {
			const readInitialRows = evaluateFunction<() => { rows: unknown[] }>(page, 'readInitialRows');
			assert.deepStrictEqual(readInitialRows(), { rows: [] }, 'the caller still gets an empty page');
		} finally {
			globals.document = savedDocument;
			globals.window = savedWindow;
		}
		assert.strictEqual(reported.length, 1, 'exactly one report');
		assert.ok(reported[0].includes('could not be read'), reported[0]);
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

	test('AC1: parameters show their tail, value and details formats', () => {
		const rows = payload().rows;
		const ini = rows.find((row) => row.label === 'IniValue')!;
		assert.strictEqual(ini.kind, 'parameter');
		assert.strictEqual(ini.value, '63');
		assert.strictEqual(ini.shownValue, '63');
		assert.strictEqual(ini.valueKind, 'numeric');
		assert.strictEqual(ini.parameterType, 'Integer');
		assert.deepStrictEqual(ini.formats, [
			{ label: 'Decimal', value: '63' },
			{ label: 'Hexadecimal', value: '0x3F' },
			{ label: 'Binary', value: '0b00111111' },
		]);
		assert.ok(!ini.meta.some((part) => part.text.indexOf('(= 0x') === 0), 'no hex in the Document meta');
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
		assert.ok(source.includes('setRows(message.rows, message.selectedId)'));
		assert.ok(!source.includes('id="view-toggle"'), 'the Tree view toggle is gone');
		assert.ok(!source.includes('data-ln-digits'), 'there is no line-number gutter');
		assert.ok(!source.includes('data-line='), 'rows carry no source-line display data');
		assert.ok(!source.includes('class="glyph"'), 'the Tree glyph column is gone');
	});

	test('AC1: the initial row JSON escapes model text so it cannot close the script', () => {
		const module = payload().rows.find((row) => row.kind === 'module')!;
		const encoded = encodeRowDocument({
			rows: [{ ...module, label: '</script><script>alert(1)</script>', definitionRef: '</script>' }],
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
		const hexes = [...style[1].matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
		for (const hex of hexes) {
			assert.ok(
				['#4EC9B0', '#80808040', '#DCDCAA'].includes(hex),
				`${hex} is a semantic fallback inside a --vscode-* variable`
			);
		}
		assert.ok(page.includes('nonce="test-nonce"'), 'style and script carry the nonce');
		assert.ok(page.includes("default-src 'none'"), 'a CSP meta is present');
		assert.ok(!/<script[^>]+src=/.test(page), 'nothing is loaded remotely');
	});
});
