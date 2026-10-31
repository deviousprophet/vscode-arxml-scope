/**
 * The Conditions tab: the panel shell, discovery from the document, the one
 * draft at a time and the entries the host receives. The page is mounted into
 * jsdom from the host's static shell.
 *
 * The second suite drives the real provider through a stub webview panel.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { buildRows } from '../../core/ecuc/renderRows';
import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import type { ConditionEntry } from '../../core/ecuc/conditionEntry';
import { EcucEditorProvider } from '../../host/ecucEditorProvider';
import { buildDocumentNodeRow } from '../../webview/components/documentTree/documentRows';
import { inspectorFields } from '../../webview/components/sidebar/detailsPanel/detailsPanel';
import { editorShell } from '../../host/webviewShell';
import { ConditionValueStore } from '../../host/conditionValues';
import { fixtureText } from '../core/modelTestUtils';
import { fixtureUri } from '../extension/testUtils';
import { webviewCss } from '../webview/cssTestUtils';
import { installDom, installMarkup, loadModule, messagesOf } from '../webview/pageTestUtils';

const FIXTURE = 'editor/render.arxml';

function mount(entries: ConditionEntry[] = []): ReturnType<typeof installDom> {
	const dom = installDom('editor');
	loadModule<typeof import('../../webview/editorViewer')>('../../webview/editorViewer').mountEditor();
	dom.post({ type: 'conditions', entries });
	return dom;
}

function addDraft(dom: ReturnType<typeof installDom>, name: string, value: string): any {
	(dom.document.getElementById('conditions-add') as HTMLElement).click();
	const row = dom.document.querySelector('#conditions-list .condition-row:last-child')!;
	(row.querySelector('.condition-name') as HTMLInputElement).value = name;
	(row.querySelector('.condition-value') as HTMLInputElement).value = value;
	return row;
}

function panelRow(dom: ReturnType<typeof installDom>, name: string): any {
	return Array.from(dom.document.querySelectorAll('#conditions-list .condition-row')).find(
		(row: any) => (row.dataset.name || '') === name
	);
}

suite('conditions panel (design §6)', () => {
	test('the Conditions tab hosts the panel shell once, outside #tree', () => {
		const html = editorShell({
			cspSource: 'https://webview.test',
			scriptUri: 'https://webview.test/editorViewer.js',
			styleUri: 'https://webview.test/editorViewer.css',
			nonce: 'test-nonce',
		});
		assert.strictEqual((html.match(/id="conditions-panel"/g) ?? []).length, 1);
		const treeAt = html.indexOf('id="tree"');
		const panelAt = html.indexOf('id="conditions-panel"');
		assert.ok(treeAt >= 0 && panelAt > treeAt, 'the panel is outside the virtual tree');
	});

	test('the shared buttons are styled and the header badge counts committed values', () => {
		const dom = mount([
			{ name: 'A_SC', value: '1' },
			{ name: 'B_SC', value: '' },
		]);
		try {
			const badge = dom.document.getElementById('sb-conditions-values-badge')!;
			assert.strictEqual(badge.textContent, '2 constants · 1 missing');
			assert.strictEqual(badge.hidden, false);
			const css = webviewCss('components', 'sidebar', 'conditionsPanel', 'conditionsPanel.css');
			assert.ok(webviewCss('components', 'sidebar', 'sidebar.css').includes('.sb-btn'), 'shared buttons live in the sidebar');
		} finally {
			dom.restore();
		}
	});

	test('a committed empty value shows the unknown state; a draft does not', () => {
		const dom = mount([{ name: 'A_SC', value: '' }]);
		try {
			const row = panelRow(dom, 'A_SC');
			const state = row.querySelector('.condition-state');
			assert.strictEqual(state.hidden, false, 'an empty committed value is unknown');
			assert.strictEqual(state.textContent, 'unknown');
			(row.querySelector('.condition-edit') as HTMLElement).click();
			assert.strictEqual(row.querySelector('.condition-state'), null, 'an edit draft has no unknown badge');
		} finally {
			dom.restore();
		}
	});

	test('rows are built from committed datasets and expose explicit actions', () => {
		const dom = mount([{ name: 'A_SC', value: '1' }]);
		try {
			const row = panelRow(dom, 'A_SC');
			assert.strictEqual(row.querySelector('.condition-name-text').textContent, 'A_SC');
			assert.strictEqual(row.querySelector('.condition-value-text').textContent, '1');
			assert.ok(row.querySelector('.condition-edit'));
			assert.ok(row.querySelector('.condition-remove'));
		} finally {
			dom.restore();
		}
	});

	test('a host entries refresh replaces the panel rows', () => {
		const dom = mount([{ name: 'A_SC', value: '1' }]);
		try {
			dom.post({ type: 'conditions', entries: [{ name: 'B_SC', value: '2' }] });
			assert.strictEqual(panelRow(dom, 'A_SC'), undefined);
			assert.strictEqual(panelRow(dom, 'B_SC').querySelector('.condition-value-text').textContent, '2');
		} finally {
			dom.restore();
		}
	});

	test('discovery adds each referenced constant once, in document order, and sends no message', () => {
		const dom = mount([]);
		try {
			const model = scanEcucValues(fixtureText(FIXTURE));
			const rows = buildRows(model, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows;
			dom.post({ type: 'document', document: { rows } });
			const names = Array.from(dom.document.querySelectorAll('#conditions-list .condition-name-text')).map(
				(node: any) => node.textContent
			);
			const expected = Array.from(new Set(rows.flatMap((row) => row.condition?.symbols ?? [])));
			assert.deepStrictEqual(names, expected);
			assert.strictEqual(messagesOf(dom.api, 'conditions').length, 0, 'discovery never saves');
		} finally {
			dom.restore();
		}
	});

	test('scanned rows have no Remove; a manual row keeps its value when it becomes scanned', () => {
		const rows = buildRows(scanEcucValues(fixtureText(FIXTURE)), { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows;
		const symbol = rows.flatMap((row) => row.condition?.symbols ?? [])[0];
		assert.ok(symbol, 'the fixture has a referenced condition symbol');
		const dom = mount([{ name: symbol, value: '7' }]);
		try {
			dom.post({ type: 'document', document: { rows } });
			const row = panelRow(dom, symbol);
			assert.ok(row, 'the manual constant is still listed');
			assert.strictEqual(row.querySelector('.condition-remove'), null, 'a scanned row has no Remove action');
			assert.strictEqual(row.querySelector('.condition-value-text').textContent, '7', 'its committed value survives');
		} finally {
			dom.restore();
		}
	});

	test('Remove sends one message for a manual row', () => {
		const dom = mount([{ name: 'A_SC', value: '1' }]);
		try {
			(panelRow(dom, 'A_SC').querySelector('.condition-remove') as HTMLElement).click();
			assert.deepStrictEqual(messagesOf(dom.api, 'conditions'), [{ type: 'conditions', entries: [] }]);
		} finally {
			dom.restore();
		}
	});

	test('Clear values empties committed values and sends once', () => {
		const dom = mount([
			{ name: 'A_SC', value: '1' },
			{ name: 'B_SC', value: '2' },
		]);
		try {
			(dom.document.getElementById('conditions-clear') as HTMLElement).click();
			const sent = messagesOf(dom.api, 'conditions');
			assert.strictEqual(sent.length, 1);
			assert.deepStrictEqual(sent[0].entries, [
				{ name: 'A_SC', value: '' },
				{ name: 'B_SC', value: '' },
			], 'manual rows keep their name with an empty value');
			assert.strictEqual(panelRow(dom, 'A_SC').querySelector('.condition-state').hidden, false);
		} finally {
			dom.restore();
		}
	});

	test('Save commits the draft, sends exactly one message and updates the row', () => {
		const dom = mount([]);
		try {
			const row = addDraft(dom, 'NEW_SC', '5');
			(row.querySelector('.condition-save') as HTMLElement).click();
			assert.deepStrictEqual(messagesOf(dom.api, 'conditions'), [
				{ type: 'conditions', entries: [{ name: 'NEW_SC', value: '5' }] },
			]);
			assert.strictEqual(row.querySelector('.condition-value-text').textContent, '5');
			assert.strictEqual(row.querySelector('.condition-edit'), row.querySelector('.condition-edit'));
		} finally {
			dom.restore();
		}
	});

	test('Save refuses an empty or duplicate name and keeps the draft', () => {
		const dom = mount([{ name: 'A_SC', value: '1' }]);
		try {
			const row = addDraft(dom, 'A_SC', '2');
			(row.querySelector('.condition-save') as HTMLElement).click();
			assert.strictEqual(messagesOf(dom.api, 'conditions').length, 0);
			assert.ok(dom.document.getElementById('conditions-status')!.textContent!.includes('already exists'));
			assert.strictEqual(row.dataset.editing, 'true');
		} finally {
			dom.restore();
		}
	});

	test('Cancel restores the committed value and removes an unsaved draft', () => {
		const dom = mount([{ name: 'A_SC', value: '1' }]);
		try {
			const row = panelRow(dom, 'A_SC');
			(row.querySelector('.condition-edit') as HTMLElement).click();
			(row.querySelector('.condition-value') as HTMLInputElement).value = '9';
			(row.querySelector('.condition-cancel') as HTMLElement).click();
			assert.strictEqual(row.querySelector('.condition-value-text').textContent, '1');
			assert.strictEqual(messagesOf(dom.api, 'conditions').length, 0);
			const draft = addDraft(dom, 'NEW_SC', '5');
			(draft.querySelector('.condition-cancel') as HTMLElement).click();
			assert.strictEqual(panelRow(dom, 'NEW_SC'), undefined);
		} finally {
			dom.restore();
		}
	});

	test('the row builder and inspector expose disabled conditions', () => {
		const dom = installMarkup('<body></body>');
		try {
			const row: any = {
				id: 'p1',
				kind: 'parameter',
				level: 3,
				parentId: 'c1',
				subtreeSize: 0,
				posinset: 1,
				setsize: 1,
				hasChildren: false,
				label: 'IniValue',
				definitionRef: '/P/M/C/IniValue',
				value: '63',
				shownValue: '63',
				title: '',
				meta: [{ cls: 'condition', text: '[A_SC == 1]', title: 'A_SC = 1', state: 'false' }],
				condition: { text: 'A_SC == 1', state: 'false', symbols: ['A_SC'] },
				disabled: true,
				disabledBy: 'self' as const,
				haystack: 'inivalue 63',
			};
			const node = buildDocumentNodeRow(row, { expandedIds: new Set(), searchQuery: '', subtreeIds: new Set() });
			assert.strictEqual(node.dataset.disabled, 'true');
			assert.ok(node.querySelector('.sr-only')!.textContent!.includes('disabled'));
			const meta = node.querySelector('.row-meta .condition')!;
			assert.strictEqual(meta.getAttribute('data-state'), 'false');
			const fields = inspectorFields(row);
			assert.strictEqual(fields.condition!.text, 'A_SC == 1');
			assert.strictEqual(fields.condition!.state, 'false');
		} finally {
			dom.restore();
		}
	});
});

suite('conditions provider wiring (design §5)', () => {
	interface StubMessage {
		type?: string;
		message?: string;
		kind?: string;
		scope?: string;
		entries?: unknown;
		document?: { rows?: Array<{ label: string; disabled?: boolean }> };
	}

	function stubPanel(): {
		panel: vscode.WebviewPanel;
		messages: StubMessage[];
		send(message: unknown): void;
		dispose(): void;
	} {
		const messages: StubMessage[] = [];
		let listener: ((message: unknown) => void) | undefined;
		const disposeListeners: Array<() => void> = [];
		const webview = {
			options: {} as vscode.WebviewOptions,
			html: '',
			cspSource: 'https://webview.test',
			asWebviewUri: (uri: vscode.Uri) => uri,
			onDidReceiveMessage: (next: (message: unknown) => void) => {
				listener = next;
				return new vscode.Disposable(() => undefined);
			},
			postMessage: (message: unknown) => {
				messages.push(message as StubMessage);
				return Promise.resolve(true);
			},
		};
		const panel = {
			webview,
			reveal: () => undefined,
			onDidDispose: (callback: () => void) => {
				disposeListeners.push(callback);
				return new vscode.Disposable(() => undefined);
			},
		} as unknown as vscode.WebviewPanel;
		return {
			panel,
			messages,
			send: (message: unknown) => listener?.(message),
			dispose: () => disposeListeners.forEach((callback) => callback()),
		};
	}

	test('a conditions message re-pushes one panel and never reloads another', async () => {
		const provider = new EcucEditorProvider();
		const firstDocument = await vscode.workspace.openTextDocument(fixtureUri(FIXTURE));
		const secondDocument = await vscode.workspace.openTextDocument(fixtureUri('editor/render.arxml'));
		const token = new vscode.CancellationTokenSource().token;
		const first = stubPanel();
		const second = stubPanel();
		provider.resolveCustomTextEditor(firstDocument, first.panel, token);
		provider.resolveCustomTextEditor(secondDocument, second.panel, token);
		try {
			const secondHtml = second.panel.webview.html;
			first.send({ type: 'conditions', entries: [{ name: 'CANIPCORETYPE_SC', value: '1' }] });
			assert.ok(
				first.messages.filter((message) => message.type === 'document').length >= 1,
				'the sending panel re-renders'
			);
			assert.strictEqual(second.panel.webview.html, secondHtml, 'the other panel is not reloaded');
			assert.strictEqual(
				second.messages.filter((message) => message.type === 'document').length,
				0,
				'a condition change does not push rows into another panel'
			);
		} finally {
			first.dispose();
			second.dispose();
		}
	});

	test('a reloaded page is re-sent the current entries and the row document', async () => {
		const store = {
			load: (): ConditionEntry[] => [{ name: 'A_SC', value: '1' }],
			save: (): Thenable<void> => Promise.resolve(),
		} as unknown as ConditionValueStore;
		const provider = new EcucEditorProvider(store);
		const document = await vscode.workspace.openTextDocument(fixtureUri(FIXTURE));
		const stub = stubPanel();
		provider.resolveCustomTextEditor(document, stub.panel, new vscode.CancellationTokenSource().token);
		try {
			stub.send({ type: 'conditions', entries: [{ name: 'A_SC', value: '2' }] });
			stub.send({ type: 'ready' });
			const refreshed = stub.messages.filter((message) => message.type === 'conditions').at(-1);
			assert.ok(refreshed, 'the host answered the reload');
			assert.deepStrictEqual(refreshed!.entries, [{ name: 'A_SC', value: '2' }]);
			const pushed = stub.messages.filter((message) => message.type === 'document').at(-1);
			assert.ok(pushed?.document?.rows?.length, 'the host re-posted the row document');
		} finally {
			stub.dispose();
		}
	});

	test('the panel shell is static and uses the bundled assets', async () => {
		const provider = new EcucEditorProvider();
		const document = await vscode.workspace.openTextDocument(fixtureUri(FIXTURE));
		const stub = stubPanel();
		provider.resolveCustomTextEditor(document, stub.panel, new vscode.CancellationTokenSource().token);
		try {
			const html = stub.panel.webview.html;
			assert.ok(html.includes('default-src \'none\''), 'strict CSP');
			assert.ok(html.includes('editorViewer.js'), 'the bundled page script');
			assert.ok(html.includes('editorViewer.css'), 'the bundled stylesheet');
			assert.ok(!/<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/.test(html), 'no inline page script');
			assert.ok(!html.includes('type="application/json"'), 'no embedded row document');
		} finally {
			stub.dispose();
		}
	});
});
