/**
 * The bundled editor page, mounted into jsdom from the same static shell the
 * host writes. The host → page protocol is driven through `postMessage` and the
 * page's own DOM is asserted: rows, details, search, editing and virtualization.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../../core/ecuc/scanner';
import { buildRows, EcucRow } from '../../../core/ecuc/renderRows';
import { SORT_EXCEPTIONS } from '../../../core/ecuc/order';
import { installConsoleErrors } from '../../../webview/render/pageError';
import type { EditorDocumentPayload } from '../../../webviewProtocol';
import { documentHeader } from '../../../webviewProtocol';
import { editorShell } from '../../../host/webviewShell';
import { fixtureText } from '../../core/modelTestUtils';
import { expectReady, installDom, loadModule, messagesOf, rowLabels, settleSearch, treeRows } from '../pageTestUtils';

const FIXTURE = 'editor/render.arxml';

function editorDocument(overrides: Partial<EditorDocumentPayload> = {}): EditorDocumentPayload {
	const model = scanEcucValues(fixtureText(FIXTURE));
	return {
		rows: buildRows(model, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows,
		header: documentHeader(model),
		...overrides,
	};
}

function mount(): { dom: ReturnType<typeof installDom>; page: any; document: EditorDocumentPayload } {
	const dom = installDom('editor');
	const module = loadModule<typeof import('../../../webview/editorViewer')>('../../webview/editorViewer');
	module.mountEditor();
	const document = editorDocument();
	dom.post({ type: 'conditions', entries: [] });
	dom.post({ type: 'document', document });
	return { dom, page: module, document };
}

function rowFor(document: EditorDocumentPayload, label: string): EcucRow {
	const row = document.rows.find((candidate) => candidate.label === label);
	assert.ok(row, `the fixture has ${label}`);
	return row;
}

function clickRow(dom: ReturnType<typeof installDom>, label: string): any {
	const windowRow = treeRows(dom.document).find(
		(row) => row.querySelector('.label')?.textContent === label
	);
	assert.ok(windowRow, `the rendered window contains ${label}`);
	windowRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
	return windowRow;
}

suite('editor bundled page', () => {
	test('the host shell is strict and loads the bundled script and stylesheet', () => {
		const html = editorShell({
			cspSource: 'https://webview.test',
			scriptUri: 'https://webview.test/editorViewer.js',
			styleUri: 'https://webview.test/editorViewer.css',
			nonce: 'test-nonce',
		});
		assert.ok(
			html.includes(
				"default-src 'none'; style-src https://webview.test 'nonce-test-nonce'; script-src 'nonce-test-nonce'; img-src https://webview.test data:"
			),
			'a strict CSP'
		);
		assert.ok(html.includes('src="https://webview.test/editorViewer.js"'), 'the bundled script');
		assert.ok(html.includes('href="https://webview.test/editorViewer.css"'), 'the bundled stylesheet');
		assert.ok(!/<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/.test(html), 'no inline page script');
		assert.ok(!html.includes('type="application/json"'), 'no embedded document');
		assert.ok(!html.includes('Function.prototype.toString'), 'no serialized page functions');
		assert.strictEqual((html.match(/id="tree"/g) || []).length, 1);
		assert.ok(html.includes('id="sidebar"') && html.includes('id="row-menu"'));
	});

	test('boots from the static shell, announces ready and renders the posted document', () => {
		const { dom } = mount();
		try {
			expectReady(dom.api);
			assert.ok(treeRows(dom.document).length > 0, 'the posted rows are in the tree');
			const labels = rowLabels(dom.document);
			assert.ok(labels.includes('PkgA.PkgB.ModDefs.ModX'), 'the module label');
			assert.ok(labels.includes('ContA'), 'the container label');
			assert.ok(labels.includes('IniValue'), 'the parameter label');
			assert.ok(
				dom.document.querySelector('#tree .node')!.getAttribute('role') === 'treeitem',
				'the row builder owns tree semantics'
			);
			assert.strictEqual(dom.document.querySelector('#tree').getAttribute('aria-label'), 'ECUC values');
		} finally {
			dom.restore();
		}
	});

	test('the row primitives carry the data the details panel needs, without model markup', () => {
		const { dom } = mount();
		try {
			const module = treeRows(dom.document).find(
				(row) => row.querySelector('.label')?.textContent === 'PkgA.PkgB.ModDefs.ModX'
			)!;
			assert.strictEqual(module.dataset.kind, 'module');
			assert.strictEqual(module.dataset.definitionRef, '/PkgA/PkgB/ModDefs/ModX');
			const parameter = treeRows(dom.document).find(
				(row) => row.querySelector('.label')?.textContent === 'IniValue'
			)!;
			assert.strictEqual(parameter.dataset.value, '63');
			assert.strictEqual(parameter.querySelector('.value-text')!.textContent, '63');
			assert.strictEqual(parameter.querySelector('.value')!.getAttribute('data-value-kind'), 'numeric');
			assert.ok(!dom.document.querySelector('#tree').innerHTML.includes('<script'), 'model text is never markup');
		} finally {
			dom.restore();
		}
	});

	test('selection fills the one Details body and the value editor owns the type', () => {
		const { dom, document } = mount();
		try {
			clickRow(dom, 'IniValue');
			const body = dom.document.getElementById('sb-details-body');
			assert.ok(body.textContent.includes('IniValue'));
			assert.ok(body.textContent.includes('Integer'));
			const value = body.querySelector('#details-value') as HTMLInputElement;
			assert.ok(value, 'the parameter value input is in Details');
			assert.strictEqual(value.value, '63');
			assert.deepStrictEqual(
				Array.from(body.querySelectorAll('.inspector-code')).map((code: any) => code.textContent).slice(-3),
				['63', '0x3F', '0b00111111']
			);
			assert.ok(rowFor(document, 'PeerIref'), 'the fixture has a reference');
			clickRow(dom, 'PeerIref');
			assert.ok(body.textContent.includes('Jump to target'), 'a followable reference gets the jump action');
			clickRow(dom, 'ContA');
			assert.ok(body.querySelector('#details-short-name'), 'a container gets its short-name editor');
			assert.ok(body.querySelector('#details-definition-ref'), 'a container gets its definition editor');
		} finally {
			dom.restore();
		}
	});

	test('Enter in the details editor posts one edit and a re-scan keeps the selection', () => {
		const { dom, document } = mount();
		try {
			clickRow(dom, 'IniValue');
			const input = dom.document.getElementById('details-value') as HTMLInputElement;
			input.value = '99';
			input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			assert.deepStrictEqual(messagesOf(dom.api, 'edit'), [
				{ type: 'edit', nodeId: rowFor(document, 'IniValue').id, value: '99' },
			]);
			const selected = rowFor(document, 'IniValue').id;
			dom.post({ type: 'document', document: editorDocument({ selectedId: selected }) });
			assert.strictEqual(
				dom.document.querySelector('[data-selected="true"]')?.getAttribute('data-node-id'),
				selected,
				'a re-scan keeps the host selection'
			);
		} finally {
			dom.restore();
		}
	});

	test('a plain click selects, a double click reveals and Ctrl+Enter reveals', async () => {
		const { dom, document } = mount();
		try {
			const item = clickRow(dom, 'IniValue');
			assert.deepStrictEqual(messagesOf(dom.api, 'select'), [
				{ type: 'select', nodeId: rowFor(document, 'IniValue').id },
			]);
			item.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
			assert.deepStrictEqual(messagesOf(dom.api, 'reveal'), [
				{ type: 'reveal', nodeId: rowFor(document, 'IniValue').id },
			]);
			item.dispatchEvent(
				new dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })
			);
			assert.strictEqual(messagesOf(dom.api, 'reveal').length, 2, 'Ctrl+Enter is the deliberate reveal');
		} finally {
			dom.restore();
		}
	});

	test('search runs on Enter through the chunked engine and keeps the current match', async () => {
		const { dom } = mount();
		try {
			const input = dom.document.getElementById('search-input') as HTMLInputElement;
			input.value = 'IniValue';
			input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
			input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			await settleSearch();
			const count = dom.document.getElementById('search-count')!.textContent;
			assert.ok(/1 \/ [1-9]/.test(count), `the count reports the first match (${count})`);
			assert.strictEqual(dom.document.getElementById('search-busy')!.getAttribute('data-busy'), 'false');
			assert.ok(
				dom.document.getElementById('tree')!.innerHTML.includes('<mark>IniValue</mark>'),
				'the rendered row carries the search mark'
			);
		} finally {
			dom.restore();
		}
	});

	test('a large document renders only the viewport window plus overscan', () => {
		const rows: EcucRow[] = Array.from({ length: 6000 }, (_, at) => ({
			id: `row-${at}`,
			kind: 'parameter' as const,
			level: 2,
			parentId: at === 0 ? null : 'row-0',
			subtreeSize: 0,
			posinset: at + 1,
			setsize: 6000,
			hasChildren: false,
			label: `Param${at}`,
			definitionRef: `/P/M/C/Param${at}`,
			shownValue: String(at),
			valueKind: 'numeric' as const,
			title: '',
			meta: [],
			haystack: `param${at} ${at}`,
		}));
		const dom = installDom('editor');
		try {
			loadModule<typeof import('../../../webview/editorViewer')>('../../webview/editorViewer').mountEditor();
			dom.post({ type: 'conditions', entries: [] });
			dom.post({ type: 'document', document: { rows } });
			const rendered = treeRows(dom.document).length;
			assert.ok(rendered > 0, 'the viewport has rows');
			assert.ok(rendered <= 200, `the DOM is bounded by the window+overscan (${rendered})`);
		} finally {
			dom.restore();
		}
	});

	test('the Conditions panel saves one entry and posts it to the host', () => {
		const { dom } = mount();
		try {
			(dom.document.getElementById('conditions-add') as HTMLElement).click();
			const row = dom.document.querySelector('#conditions-list .condition-row:last-child')!;
			const name = row.querySelector('.condition-name') as HTMLInputElement;
			const value = row.querySelector('.condition-value') as HTMLInputElement;
			name.value = 'A_SC';
			value.value = '1';
			(row.querySelector('.condition-save') as HTMLElement).click();
			assert.deepStrictEqual(messagesOf(dom.api, 'conditions'), [
				{ type: 'conditions', entries: [{ name: 'A_SC', value: '1' }] },
			]);
			const pushed = messagesOf(dom.api, 'conditions');
			dom.post({ type: 'conditions', entries: [{ name: 'B_SC', value: '2' }] });
			assert.strictEqual(
				dom.document.querySelector('#conditions-list .condition-name-text')!.textContent,
				'B_SC',
				'a host entries push replaces the list'
			);
			void pushed;
		} finally {
			dom.restore();
		}
	});

	test('the page reports an unhandled error to the webview console, not a banner', () => {
		const { dom } = mount();
		try {
			assert.ok(!dom.document.getElementById('notice'), 'there is no notice element');
			const logged: string[] = [];
			const surface = installConsoleErrors(
				{ addEventListener: () => undefined },
				{ error: (text: string) => logged.push(text) }
			);
			surface.report('boom');
			assert.ok(logged.some((line) => line.includes('ECUC editor:') && line.includes('boom')), logged.join('\n'));
		} finally {
			dom.restore();
		}
	});
});
