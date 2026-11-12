/**
 * The Document-only interaction model, collapse, hierarchy, details entry and
 * guardrails. Pure rules are imported; gestures are driven on the mounted page.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { scanEcucValues } from '../../../core/ecuc/scanner';
import { buildRows } from '../../../core/ecuc/renderRows';
import { SORT_EXCEPTIONS } from '../../../core/ecuc/order';
import {
	collapsedIdsFor,
	moveTarget,
	pruneCollapsed,
	toggleCollapsed,
} from '../../../webview/components/documentTree/documentTreeState';
import { getSidebarState } from '../../../webview/components/sidebar/sidebar';
import { buildDocumentNodeRow } from '../../../webview/components/documentTree/documentRows';
import { detailsInputAllowed } from '../../../webview/components/detailsEditor/detailsEditor';
import { editorShell } from '../../../host/webviewShell';
import { fixtureText } from '../../core/modelTestUtils';
import { repoRoot } from '../../extension/testUtils';
import { webviewCss } from '../cssTestUtils';
import { installDom, installMarkup, loadModule, messagesOf, settleSearch, treeRows } from '../pageTestUtils';

const FIXTURE = 'editor/render.arxml';
/** Longer than the page's 500 ms multi-click guard, with headroom for a loaded CI host. */
const DETAILS_GUARD_SETTLE_MS = 700;

function shell(): string {
	return editorShell({
		cspSource: 'https://webview.test',
		scriptUri: 'https://webview.test/editorViewer.js',
		styleUri: 'https://webview.test/editorViewer.css',
		nonce: 'test-nonce',
	});
}

function rowsOf(fixture: string) {
	return buildRows(scanEcucValues(fixtureText(fixture)), { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows;
}

function rows() {
	return rowsOf(FIXTURE);
}

/** The value span of a rendered parameter row. */
function valueTextOf(item: HTMLElement): HTMLElement {
	return item.querySelector<HTMLElement>('.value-text')!;
}

function mountFixture(fixture: string) {
	const dom = installDom('editor');
	loadModule<typeof import('../../../webview/editorViewer')>('../../webview/editorViewer').mountEditor();
	dom.post({ type: 'document', document: { rows: rowsOf(fixture) } });
	return dom;
}

function mount() {
	return mountFixture(FIXTURE);
}

/** Dispatch the page's own copy listener with a recorder for `text/plain`. */
function dispatchCopy(
	dom: ReturnType<typeof installDom>,
	target: EventTarget = dom.document
): { copied: string | undefined; prevented: boolean } {
	const event = new dom.window.Event('copy', { bubbles: true, cancelable: true });
	let copied: string | undefined;
	Object.defineProperty(event, 'clipboardData', {
		value: {
			setData(_type: string, text: string) {
				copied = text;
			},
		},
	});
	target.dispatchEvent(event);
	return { copied, prevented: event.defaultPrevented };
}

/** Select from the first node to the last character of another node's label. */
function selectBetween(dom: ReturnType<typeof installDom>, first: Node, last: Node): void {
	const range = dom.document.createRange();
	range.setStart(first, 0);
	range.setEnd(last, (last.textContent || '').length);
	const selection = dom.window.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
}

/** The on-screen top of a Document row from the uniform row height and the scroller. */
function documentRowTop(dom: ReturnType<typeof installDom>, row: HTMLElement): number {
	const scroller = dom.document.querySelector('#tree > .virtual-scroll-vscroll') as HTMLElement;
	return Number(row.dataset.documentIndex) * 20 - scroller.scrollTop;
}

/** Whether a row's on-screen top sits inside the page test's 600px viewport. */
function inViewport(top: number): boolean {
	return top >= 0 && top < 560;
}

function mountWithState(saved: unknown) {
	const dom = installDom('editor');
	// jsdom has no layout: make the resizer report visible so the saved width
	// can be applied, the same shim the sidebar component tests use.
	Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', {
		configurable: true,
		get(this: any) {
			return this.parentElement;
		},
	});
	dom.api.state = saved;
	loadModule<typeof import('../../../webview/editorViewer')>('../../webview/editorViewer').mountEditor();
	dom.post({ type: 'document', document: { rows: rows() } });
	return dom;
}

suite('editor Document interactions', () => {
	test('bracket guides fade at rest and activate on container hover', () => {
		const css = webviewCss('components', 'documentTree', 'documentTree.css');
		assert.ok(/\.guide\s*\{[^}]*opacity:\s*0\.28/.test(css));
		assert.ok(/\.guide\.guide-active\s*\{[^}]*opacity:\s*0\.85/.test(css));
	});

	test('the toolbar hides and shows the sidebar without losing its layout state', () => {
		const dom = mount();
		try {
			const toggle = dom.document.getElementById('toggle-sidebar') as HTMLElement;
			const detailsTab = dom.document.getElementById('stab-details') as HTMLElement;
			detailsTab.focus();
			const before = { ...getSidebarState() };
			toggle.click();
			assert.ok(dom.document.body.classList.contains('sidebar-hidden'));
			assert.strictEqual(getSidebarState().hidden, true);
			assert.strictEqual(toggle.getAttribute('aria-pressed'), 'false');
			assert.strictEqual(toggle.title, 'Show sidebar');
			assert.strictEqual(toggle.getAttribute('aria-label'), 'Sidebar');
			assert.strictEqual(dom.document.activeElement, toggle, 'focus leaves the hidden shell');
			for (const id of ['sidebar', 'sidebar-resizer', 'side-tabs']) {
				assert.strictEqual(dom.document.getElementById(id)!.hasAttribute('inert'), true, `${id} is inert`);
			}
			assert.deepStrictEqual(getSidebarState(), { ...before, hidden: true }, 'tab, width and panes survive hiding');
			assert.deepStrictEqual(dom.api.state, { ...before, hidden: true }, 'the hidden flag is persisted');
			toggle.click();
			assert.strictEqual(dom.document.body.classList.contains('sidebar-hidden'), false);
			assert.strictEqual(toggle.getAttribute('aria-pressed'), 'true');
			assert.strictEqual(toggle.title, 'Hide sidebar');
			assert.deepStrictEqual(getSidebarState(), before, 'showing restores the previous layout');
			for (const id of ['sidebar', 'sidebar-resizer', 'side-tabs']) {
				assert.strictEqual(dom.document.getElementById(id)!.hasAttribute('inert'), false, `${id} is interactive`);
			}
		} finally {
			dom.restore();
		}
	});

	test('showing the sidebar restores the prior Details tab and keeps the selection', () => {
		const dom = mount();
		try {
			const ini = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'IniValue')!;
			ini.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			const inspectorBefore = dom.document.getElementById('inspector')!.textContent;
			assert.strictEqual(getSidebarState().tab, 'details');
			(dom.document.getElementById('toggle-sidebar') as HTMLElement).click();
			assert.strictEqual(getSidebarState().hidden, true);
			(dom.document.getElementById('toggle-sidebar') as HTMLElement).click();
			assert.strictEqual(getSidebarState().hidden, false);
			assert.strictEqual(getSidebarState().tab, 'details', 'the prior Details tab is restored');
			assert.strictEqual(dom.document.getElementById('stab-details')!.getAttribute('aria-selected'), 'true');
			assert.strictEqual(dom.document.getElementById('stab-conditions')!.getAttribute('aria-selected'), 'false');
			assert.ok(dom.document.getElementById('sbp-details')!.classList.contains('active'));
			assert.strictEqual(dom.document.getElementById('sbp-conditions')!.hasAttribute('hidden'), true);
			assert.strictEqual(
				dom.document.querySelector('#tree .node[data-selected="true"] .label')!.textContent,
				'IniValue',
				'the selection is untouched'
			);
			assert.strictEqual(dom.document.getElementById('inspector')!.textContent, inspectorBefore, 'the content is untouched');
		} finally {
			dom.restore();
		}
	});

	test('a reload restores a hidden sidebar with its prior tab, width and panes', () => {
		const saved = { tab: 'conditions', sidebarWidth: 500, panes: { 'sb-details': 200 }, collapsed: [], hidden: true };
		const dom = mountWithState(saved);
		try {
			assert.ok(dom.document.body.classList.contains('sidebar-hidden'));
			assert.deepStrictEqual(getSidebarState(), saved);
			const toggle = dom.document.getElementById('toggle-sidebar') as HTMLElement;
			assert.strictEqual(toggle.getAttribute('aria-pressed'), 'false');
			assert.strictEqual(toggle.title, 'Show sidebar');
			assert.strictEqual(dom.document.getElementById('stab-conditions')!.getAttribute('aria-selected'), 'true');
			assert.strictEqual((dom.document.getElementById('sidebar') as HTMLElement).style.getPropertyValue('--sidebar-w'), '500px');
			toggle.click();
			assert.strictEqual(dom.document.body.classList.contains('sidebar-hidden'), false);
			assert.deepStrictEqual(getSidebarState(), { ...saved, hidden: false }, 'the prior tab, width and panes return');
			assert.strictEqual(dom.document.getElementById('stab-conditions')!.getAttribute('aria-selected'), 'true');
		} finally {
			dom.restore();
		}
	});

	test('a plain click selects and never reveals; the deliberate gestures reveal', () => {
		const dom = mount();
		try {
			const item = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'IniValue')!;
			item.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			assert.strictEqual(messagesOf(dom.api, 'reveal').length, 0, 'a click never reveals');
			assert.strictEqual(messagesOf(dom.api, 'select').length, 1);
			item.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
			assert.strictEqual(messagesOf(dom.api, 'reveal').length, 0, 'a double click is a text gesture');
			item.dispatchEvent(
				new dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })
			);
			assert.strictEqual(messagesOf(dom.api, 'reveal').length, 1, 'Ctrl+Enter is deliberate');
			item.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
			assert.strictEqual(messagesOf(dom.api, 'reveal').length, 1, 'Space only selects');
		} finally {
			dom.restore();
		}
	});

	test('a double click never reveals or opens the deferred value editor', async () => {
		const dom = mount();
		try {
			const item = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'IniValue')!;
			const valueText = valueTextOf(item);
			valueText.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
			valueText.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 2 }));
			valueText.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }));
			await new Promise((resolve) => setTimeout(resolve, DETAILS_GUARD_SETTLE_MS));
			assert.strictEqual(messagesOf(dom.api, 'reveal').length, 0, 'selection never reveals');
			assert.strictEqual(dom.document.activeElement, item, 'focus stays in the Document');
		} finally {
			dom.document.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
			dom.restore();
		}
	});

	test('a single click on a value still opens the Details editor after the guard', async () => {
		const dom = mount();
		try {
			const item = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'IniValue')!;
			const valueText = valueTextOf(item);
			valueText.dispatchEvent(
				new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
			);
			assert.notStrictEqual(
				dom.document.activeElement,
				dom.document.getElementById('details-value'),
				'the editor waits for a possible second click'
			);
			await new Promise((resolve) => setTimeout(resolve, DETAILS_GUARD_SETTLE_MS));
			assert.strictEqual(
				dom.document.activeElement,
				dom.document.getElementById('details-value'),
				'the single click still opens the value editor'
			);
		} finally {
			dom.document.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
			dom.restore();
		}
	});

	test('a value edit reveals the sidebar when it is hidden', async () => {
		const dom = mount();
		try {
			(dom.document.getElementById('toggle-sidebar') as HTMLElement).click();
			assert.strictEqual(getSidebarState().hidden, true);
			const item = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'IniValue')!;
			valueTextOf(item).dispatchEvent(
				new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
			);
			await new Promise((resolve) => setTimeout(resolve, DETAILS_GUARD_SETTLE_MS));
			assert.strictEqual(getSidebarState().hidden, false, 'the edit reveals the sidebar');
			assert.strictEqual(getSidebarState().tab, 'details', 'the edit selects Details');
			assert.strictEqual(dom.document.body.classList.contains('sidebar-hidden'), false);
			assert.strictEqual(
				dom.document.activeElement,
				dom.document.getElementById('details-value'),
				'the value editor receives focus'
			);
		} finally {
			dom.document.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
			dom.restore();
		}
	});

	test('a click that ends a text drag keeps the selection and opens no editor', async () => {
		const dom = mount();
		try {
			const item = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'IniValue')!;
			const labelText = item.querySelector('.label')!.firstChild!;
			const range = dom.document.createRange();
			range.setStart(labelText, 0);
			range.setEnd(labelText, labelText.textContent!.length);
			const selection = dom.window.getSelection()!;
			selection.removeAllRanges();
			selection.addRange(range);
			const valueText = valueTextOf(item);
			valueText.dispatchEvent(
				new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
			);
			await new Promise((resolve) => setTimeout(resolve, DETAILS_GUARD_SETTLE_MS));
			assert.strictEqual(dom.window.getSelection()!.isCollapsed, false, 'the drag selection survives the click');
			assert.notStrictEqual(
				dom.document.activeElement,
				dom.document.getElementById('details-value'),
				'a click after a drag never opens the value editor'
			);
		} finally {
			dom.window.getSelection()?.removeAllRanges();
			dom.restore();
		}
	});

	test('a document refresh cancels a deferred value editor', async () => {
		const dom = mount();
		try {
			const item = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'IniValue')!;
			const valueText = valueTextOf(item);
			valueText.dispatchEvent(
				new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
			);
			dom.post({ type: 'document', document: { rows: rows() } });
			await new Promise((resolve) => setTimeout(resolve, DETAILS_GUARD_SETTLE_MS));
			assert.notStrictEqual(
				dom.document.activeElement,
				dom.document.getElementById('details-value'),
				'a re-scan drops the pending edit instead of opening it later'
			);
		} finally {
			dom.document.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
			dom.restore();
		}
	});

	test('a key press cancels a deferred value editor', async () => {
		const dom = mount();
		try {
			const item = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'IniValue')!;
			const valueText = valueTextOf(item);
			valueText.dispatchEvent(
				new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
			);
			dom.document.dispatchEvent(
				new dom.window.KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true })
			);
			await new Promise((resolve) => setTimeout(resolve, DETAILS_GUARD_SETTLE_MS));
			assert.notStrictEqual(
				dom.document.activeElement,
				dom.document.getElementById('details-value'),
				'a key press drops the pending edit instead of stealing focus later'
			);
		} finally {
			dom.document.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
			dom.restore();
		}
	});

	test('a native range over two rendered rows copies only row text', () => {
		const dom = mount();
		try {
			const items = treeRows(dom.document);
			const firstLabel = items[0].querySelector('.label')!.firstChild!;
			const secondLabel = items[1].querySelector('.label')!.firstChild!;
			const range = dom.document.createRange();
			range.setStart(firstLabel, 0);
			range.setEnd(secondLabel, secondLabel.textContent!.length);
			const selection = dom.window.getSelection()!;
			selection.removeAllRanges();
			selection.addRange(range);
			const copied = selection.toString();
			assert.ok(copied.includes(items[0].querySelector('.label')!.textContent!), 'the first row is selected');
			assert.ok(copied.includes(items[1].querySelector('.label')!.textContent!), 'the second row is selected');
			assert.strictEqual(
				range.intersectsNode(dom.document.querySelector('.document-tree-lines')!),
				false,
				'line numbers are outside the selection'
			);
			assert.strictEqual(
				range.intersectsNode(dom.document.getElementById('sidebar')!),
				false,
				'sidebar chrome is outside the selection'
			);
			assert.ok(!copied.includes('Conditions'), 'sidebar text is never copied');
		} finally {
			dom.window.getSelection()?.removeAllRanges();
			dom.restore();
		}
	});

	test('a multi-row copy keeps the 4-space tree indent and drops gutter and sidebar text', () => {
		const dom = mount();
		try {
			const labelOf = (text: string): Node =>
				treeRows(dom.document)
					.find((row) => row.querySelector('.label')?.textContent === text)!
					.querySelector('.label')!.firstChild!;
			selectBetween(dom, labelOf('IniValue'), labelOf('Title'));
			const { copied, prevented } = dispatchCopy(dom);
			assert.strictEqual(prevented, true, 'the page owns the multi-row copy');
			assert.strictEqual(
				copied,
				'        IniValue = 63\n        Title = "hello"',
				'each row is one line with 4 spaces per level',
			);
			assert.ok(!copied.includes('\n1'), 'taken from the labels, not the line-number gutter');
			assert.ok(!copied.includes('Conditions'), 'no sidebar chrome');
		} finally {
			dom.window.getSelection()?.removeAllRanges();
			dom.restore();
		}
	});

	test('a partial selection inside one row stays on the native copy path', () => {
		const dom = mount();
		try {
			const item = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'IniValue')!;
			const label = item.querySelector('.label')!.firstChild!;
			const range = dom.document.createRange();
			range.setStart(label, 1);
			range.setEnd(label, 4);
			const selection = dom.window.getSelection()!;
			selection.removeAllRanges();
			selection.addRange(range);
			const { copied, prevented } = dispatchCopy(dom);
			assert.strictEqual(prevented, false, 'the native copy keeps the exact substring');
			assert.strictEqual(copied, undefined, 'the page writes nothing');
		} finally {
			dom.window.getSelection()?.removeAllRanges();
			dom.restore();
		}
	});

	test('copying inside an input is not overridden by a stale tree selection', () => {
		const dom = mount();
		try {
			const labelOf = (text: string): Node =>
				treeRows(dom.document)
					.find((row) => row.querySelector('.label')?.textContent === text)!
					.querySelector('.label')!.firstChild!;
			selectBetween(dom, labelOf('IniValue'), labelOf('Title'));
			const input = dom.document.getElementById('search-input') as HTMLInputElement;
			input.focus();
			input.value = 'abc';
			input.setSelectionRange(0, 3);
			const { copied, prevented } = dispatchCopy(dom, input);
			assert.strictEqual(prevented, false, 'the native input copy survives');
			assert.strictEqual(copied, undefined, 'the page does not replace the input text');
		} finally {
			dom.window.getSelection()?.removeAllRanges();
			dom.restore();
		}
	});

	test('Collapse all anchors to the nearest visible ancestor and Expand all restores the selected row', async () => {
		const dom = mountFixture('editor/large.arxml');
		try {
			const scroller = dom.document.querySelector('#tree > .virtual-scroll-vscroll') as HTMLElement;
			scroller.scrollTop = 800;
			scroller.dispatchEvent(new dom.window.Event('scroll'));
			await settleSearch();
			const selected = treeRows(dom.document).find((row) => {
				const top = documentRowTop(dom, row);
				return top >= 0 && top < 560 && row.querySelector('.label')?.textContent === 'Epsilon';
			});
			assert.ok(selected, 'a parameter row is on screen');
			const selectedId = selected.dataset.nodeId;
			selected.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			(dom.document.getElementById('collapse-all') as HTMLElement).click();
			const visible = treeRows(dom.document);
			assert.strictEqual(visible.length, 1, 'Collapse all leaves the root module');
			assert.ok(visible[0].querySelector('.label')?.textContent?.includes('LargeMod'), 'nearest visible ancestor');
			assert.ok(
				inViewport(documentRowTop(dom, visible[0])),
				'the nearest visible ancestor stays on screen instead of jumping away',
			);
			assert.strictEqual(
				dom.document.querySelector(`#tree [data-node-id="${selectedId}"]`),
				null,
				'the selected row is hidden while collapsed',
			);
			(dom.document.getElementById('expand-all') as HTMLElement).click();
			const restored = dom.document.querySelector(`#tree [data-node-id="${selectedId}"]`) as HTMLElement | null;
			assert.ok(restored, 'Expand all restores the selected row');
			assert.strictEqual(restored.getAttribute('data-selected'), 'true', 'the selection itself is unchanged');
			assert.ok(
				inViewport(documentRowTop(dom, restored)),
				'the restored selection is scrolled back into view',
			);
		} finally {
			dom.restore();
		}
	});

	test('Collapse all then Expand all keeps the current search match visible', async () => {
		const dom = mountFixture('editor/large.arxml');
		try {
			const input = dom.document.getElementById('search-input') as HTMLInputElement;
			input.value = 'Cont08';
			input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
			input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			await settleSearch();
			const match = (): HTMLElement | null =>
				dom.document.querySelector('#tree .node[data-search-current="true"]') as HTMLElement | null;
			assert.ok(match(), 'the search match is current');
			assert.strictEqual(match()!.getAttribute('data-selected'), 'true', 'the jump selects the match');
			(dom.document.getElementById('collapse-all') as HTMLElement).click();
			assert.strictEqual(match(), null, 'the match is hidden by Collapse all');
			const collapsedRows = treeRows(dom.document);
			assert.strictEqual(collapsedRows.length, 1, 'the nearest visible ancestor is anchored');
			assert.ok(
				inViewport(documentRowTop(dom, collapsedRows[0])),
				'the nearest visible ancestor stays on screen instead of jumping away',
			);
			(dom.document.getElementById('expand-all') as HTMLElement).click();
			assert.ok(match(), 'Expand all shows the current match again');
			assert.strictEqual(match()!.getAttribute('data-selected'), 'true', 'the match stays selected');
			assert.ok(inViewport(documentRowTop(dom, match()!)), 'the current match is scrolled back into view');
		} finally {
			dom.restore();
		}
	});

	test('row text is selectable while gutter, twisty, guides and gaps are not', () => {
		const css = webviewCss('components', 'documentTree', 'documentTree.css');
		assert.ok(/\.document-tree-pane\s*\{[^}]*user-select:\s*text/.test(css));
		assert.ok(/\.row\s*\{[^}]*user-select:\s*text/.test(css));
		assert.ok(/\.document-tree-lines\s*\{[^}]*user-select:\s*none/.test(css));
		assert.ok(/\.twisty\s*\{[^}]*user-select:\s*none/.test(css));
		assert.ok(/body\[data-view="document"\] \.guide\s*\{[^}]*user-select:\s*none/.test(css));
		assert.ok(
			/\.document-tree-header-gap,\s*\.document-tree-module-gap\s*\{[^}]*user-select:\s*none/.test(css)
		);
	});

	test('a toggle is built only where the row has children, with no glyph or inline hint', () => {
		const dom = installMarkup('<body></body>');
		try {
			const list = rows();
			const container = buildDocumentNodeRow(list.find((row) => row.label === 'ContA')!, {
				expandedIds: new Set(),
				searchQuery: '',
				subtreeIds: new Set(),
			});
			const parameter = buildDocumentNodeRow(list.find((row) => row.label === 'IniValue')!, {
				expandedIds: new Set(),
				searchQuery: '',
				subtreeIds: new Set(),
			});
			assert.ok(container.querySelector('.twisty'), 'a container has a fold control');
			assert.strictEqual(parameter.querySelector('.twisty'), null, 'a leaf has no fold control');
			assert.strictEqual(container.querySelector('.glyph'), null, 'the Tree glyph is gone');
			assert.strictEqual(list.find((row) => row.label === 'ContA')!.hasChildren, true);
			assert.strictEqual(list.find((row) => row.label === 'IniValue')!.hasChildren, false);
		} finally {
			dom.restore();
		}
		const css = webviewCss('components', 'documentTree', 'documentTree.css');
		assert.ok(/\.node\[aria-expanded="true"\] > \.row > \.twisty svg\s*\{[^}]*transform:\s*rotate\(90deg\)/.test(css));
		assert.ok(!/content:\s*"  F2"/.test(css), 'no F2 pseudo hint');
	});

	test('reference tooltips show the target without display punctuation', () => {
		const dom = mount();
		try {
			const reference = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'PeerIref')!;
			const value = reference.querySelector('.value')!;
			assert.strictEqual(value.getAttribute('title'), 'Target: PkgA.PkgB.ModX.ContA.ContB');
			assert.ok(!value.hasAttribute('data-follow'), 'the Document value is not a link');
		} finally {
			dom.restore();
		}
	});

	test('the details panel owns the reference jump action', () => {
		const dom = mount();
		try {
			const reference = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'PeerIref')!;
			reference.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			const body = dom.document.getElementById('sb-details-body')!;
			const jump = Array.from(body.querySelectorAll('button')).find(
				(button: any) => button.textContent === 'Jump to target'
			) as HTMLElement;
			assert.ok(jump, 'Jump to target lives in Details');
			jump.click();
			assert.strictEqual(messagesOf(dom.api, 'follow').length, 1);
		} finally {
			dom.restore();
		}
	});

	test('details controls follow the parameter type', () => {
		assert.strictEqual(detailsInputAllowed('Integer', '1'), true);
		assert.strictEqual(detailsInputAllowed('Integer', '0x3F'), true);
		assert.strictEqual(detailsInputAllowed('Integer', '-7'), true);
		assert.strictEqual(detailsInputAllowed('Integer', '1.5'), false);
		assert.strictEqual(detailsInputAllowed('Integer', '1g'), false);
		assert.strictEqual(detailsInputAllowed('Float', '1.5e-3'), true);
		assert.strictEqual(detailsInputAllowed('Float', '0x3F'), false);
		assert.strictEqual(detailsInputAllowed('Float', 'true'), false);
		assert.strictEqual(detailsInputAllowed('String', 'anything at all'), true);
	});

	test('aria-expanded follows the displayed list', () => {
		const dom = mount();
		try {
			const container = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'ContA')!;
			assert.strictEqual(container.getAttribute('aria-expanded'), 'true');
			container.querySelector('.twisty')!.dispatchEvent(
				new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
			);
			const collapsed = dom.document.querySelector('[data-node-id="' + container.dataset.nodeId + '"]');
			assert.strictEqual(collapsed!.getAttribute('aria-expanded'), 'false', 'the toggle re-renders the state');
		} finally {
			dom.restore();
		}
	});

	test('toggling flips membership and never collapses a leaf', () => {
		assert.deepStrictEqual(toggleCollapsed([], 'a', true), ['a']);
		assert.deepStrictEqual(toggleCollapsed(['a', 'b'], 'a', true), ['b']);
		assert.deepStrictEqual(toggleCollapsed([], 'leaf', false), []);
		assert.deepStrictEqual(collapsedIdsFor([{ id: 'a', hasChildren: true }, { id: 'b', hasChildren: false }]), ['a']);
	});

	test('pruning drops the ids that are gone and leaves the rest alone', () => {
		assert.deepStrictEqual(pruneCollapsed(['a', 'gone', 'b'], ['a', 'b']), ['a', 'b']);
		assert.deepStrictEqual(pruneCollapsed([], ['a']), []);
	});

	test('Home, End, PageUp and PageDown move focus as expected', () => {
		assert.strictEqual(moveTarget('Home', 5, 20, 8), 0);
		assert.strictEqual(moveTarget('End', 5, 20, 8), 19);
		assert.strictEqual(moveTarget('PageUp', 10, 20, 8), 2);
		assert.strictEqual(moveTarget('PageDown', 10, 20, 8), 18);
		assert.strictEqual(moveTarget('ArrowDown', 10, 20, 8), 11);
		assert.strictEqual(moveTarget('ArrowUp', 10, 20, 8), 9);
	});

	test('the key handler wires movement, expansion, F2/Enter editing and type-ahead', () => {
		const dom = mount();
		try {
			const item = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'IniValue')!;
			item.focus();
			item.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
			assert.ok(dom.document.activeElement, 'ArrowDown keeps a row focused');
			const parameter = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'IniValue')!;
			parameter.focus();
			parameter.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
			assert.ok(dom.document.getElementById('details-value') || dom.document.getElementById('details-short-name'));
		} finally {
			dom.restore();
		}
	});

	test('a refused write keeps the typed text and marks the details input invalid', () => {
		const dom = mount();
		try {
			const parameter = treeRows(dom.document).find((row) => row.querySelector('.label')?.textContent === 'IniValue')!;
			parameter.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			const input = dom.document.getElementById('details-value') as HTMLInputElement;
			input.value = 'bad';
			input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			dom.post({ type: 'notice', message: 'Not an integer.', kind: 'warn', inline: true, scope: 'details' });
			assert.strictEqual(input.value, 'bad', 'the typed text survives a refusal');
			assert.strictEqual(input.getAttribute('aria-invalid'), 'true');
			assert.ok(input.parentElement!.querySelector('.details-value-error')!.textContent!.includes('Not an integer.'));
		} finally {
			dom.restore();
		}
	});

	test('no runtime dependency was added and nothing is fetched', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
			dependencies?: Record<string, string>;
		};
		assert.strictEqual(pkg.dependencies, undefined, 'no runtime dependency');
		const html = shell();
		assert.ok(/<script[^>]+src=/.test(html), 'the bundled page script is loaded');
		assert.ok(!/fetch\(|XMLHttpRequest|new Worker|serviceWorker/.test(html), 'the shell has no remote/worker path');
	});

	test('the stylesheet keeps only the documented colour literals', () => {
		const css = [webviewCss('styles', 'tokens.css'), webviewCss('components', 'documentTree', 'documentTree.css')].join('\n');
		const hexes = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
		assert.deepStrictEqual(
			hexes.sort(),
			['#4EC9B0', '#80808040', '#DCDCAA'].sort(),
			'the fixed container accent and guide/reference fallbacks are the only literals'
		);
		assert.ok(!/style="--/.test(shell()), 'no CSP-blocked inline custom property');
	});

	test('the presentation adds no write path', () => {
		const html = shell();
		assert.ok(!html.includes('WorkspaceEdit'));
		assert.ok(!html.includes('writeFile'));
		assert.ok(!html.includes('type: \'edit\''), 'the shell carries no protocol payload');
	});
});
