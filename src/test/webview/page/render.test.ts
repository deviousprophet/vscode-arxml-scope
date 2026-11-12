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

function annotationDocument(): EditorDocumentPayload {
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0">
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Pkg</SHORT-NAME>
      <ELEMENTS>
        <ECUC-MODULE-CONFIGURATION-VALUES>
          <SHORT-NAME>Mod</SHORT-NAME>
          <DEFINITION-REF DEST="ECUC-MODULE-DEF">/Pkg/Mod</DEFINITION-REF>
          <CONTAINERS>
            <ECUC-CONTAINER-VALUE>
              <SHORT-NAME>Parent</SHORT-NAME>
              <DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Pkg/Mod/Parent</DEFINITION-REF>
              <SUB-CONTAINERS>
                <ECUC-CONTAINER-VALUE>
                  <SHORT-NAME>Child</SHORT-NAME>
                  <DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Pkg/Mod/Child</DEFINITION-REF>
                  <ANNOTATIONS>
                    <ANNOTATION>
                      <ANNOTATION-TEXT>
                        <VERBATIM>
                          <L-5 L="EN">child note</L-5>
                        </VERBATIM>
                      </ANNOTATION-TEXT>
                    </ANNOTATION>
                  </ANNOTATIONS>
                </ECUC-CONTAINER-VALUE>
              </SUB-CONTAINERS>
            </ECUC-CONTAINER-VALUE>
          </CONTAINERS>
        </ECUC-MODULE-CONFIGURATION-VALUES>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;
	const model = scanEcucValues(xml);
	return {
		rows: buildRows(model, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows,
		header: documentHeader(model),
	};
}

function twoModuleDocument(): EditorDocumentPayload {
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0">
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Pkg</SHORT-NAME>
      <ELEMENTS>
        <ECUC-MODULE-CONFIGURATION-VALUES>
          <SHORT-NAME>ModA</SHORT-NAME>
          <DEFINITION-REF DEST="ECUC-MODULE-DEF">/Pkg/ModA</DEFINITION-REF>
          <CONTAINERS>
            <ECUC-CONTAINER-VALUE>
              <SHORT-NAME>ContA</SHORT-NAME>
              <DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Pkg/ModA/ContA</DEFINITION-REF>
              <PARAMETER-VALUES>
                <ECUC-NUMERICAL-PARAM-VALUE>
                  <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Pkg/ModA/ContA/Value</DEFINITION-REF>
                  <VALUE>1</VALUE>
                </ECUC-NUMERICAL-PARAM-VALUE>
              </PARAMETER-VALUES>
            </ECUC-CONTAINER-VALUE>
          </CONTAINERS>
        </ECUC-MODULE-CONFIGURATION-VALUES>
        <ECUC-MODULE-CONFIGURATION-VALUES>
          <SHORT-NAME>ModB</SHORT-NAME>
          <DEFINITION-REF DEST="ECUC-MODULE-DEF">/Pkg/ModB</DEFINITION-REF>
          <ANNOTATIONS>
            <ANNOTATION>
              <ANNOTATION-TEXT>
                <VERBATIM>
                  <L-5 L="EN">second module note</L-5>
                </VERBATIM>
              </ANNOTATION-TEXT>
            </ANNOTATION>
          </ANNOTATIONS>
        </ECUC-MODULE-CONFIGURATION-VALUES>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;
	const model = scanEcucValues(xml);
	return {
		rows: buildRows(model, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows,
		header: documentHeader(model),
	};
}

function mount(payload: EditorDocumentPayload = editorDocument()): {
	dom: ReturnType<typeof installDom>;
	page: any;
	document: EditorDocumentPayload;
} {
	const dom = installDom('editor');
	const module = loadModule<typeof import('../../../webview/editorViewer')>('../../webview/editorViewer');
	module.mountEditor();
	dom.post({ type: 'conditions', entries: [] });
	dom.post({ type: 'document', document: payload });
	return { dom, page: module, document: payload };
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

function gutterElement(dom: ReturnType<typeof installDom>, pane = '#tree-pane'): HTMLElement {
	const gutter = dom.document.querySelector(`${pane} .document-tree-lines`) as HTMLElement | null;
	assert.ok(gutter, `${pane} has a line-number gutter`);
	return gutter;
}

function gutterCells(dom: ReturnType<typeof installDom>, pane = '#tree-pane'): HTMLElement[] {
	return Array.from(gutterElement(dom, pane).querySelectorAll('.document-tree-line-number')) as HTMLElement[];
}

function lineCell(dom: ReturnType<typeof installDom>, index: number, pane = '#tree-pane'): HTMLElement {
	const cell = gutterElement(dom, pane).querySelector(
		`.document-tree-line-number[data-document-index="${index}"]`
	) as HTMLElement | null;
	assert.ok(cell, `the gutter has a cell for virtual row ${index}`);
	return cell;
}

/** Every rendered row has the 1-based number of its virtual index. */
function assertSequentialNumbers(dom: ReturnType<typeof installDom>, pane = '#tree-pane'): void {
	const windowElement = dom.document.querySelector(`${pane} .document-tree-window`) as HTMLElement;
	const rows = Array.from(windowElement.children) as HTMLElement[];
	const cells = gutterCells(dom, pane);
	assert.strictEqual(cells.length, rows.length, 'one gutter cell per rendered row');
	for (let at = 0; at < rows.length; at++) {
		const index = Number(rows[at].dataset.documentIndex);
		assert.strictEqual(cells[at].dataset.documentIndex, String(index));
		assert.strictEqual(cells[at].textContent, String(index + 1), `row ${index} is numbered ${index + 1}`);
	}
}

function rowNamed(dom: ReturnType<typeof installDom>, label: string): any {
	const row = treeRows(dom.document).find(
		(candidate) => candidate.querySelector('.label')?.textContent === label
	);
	assert.ok(row, `the rendered window contains ${label}`);
	return row;
}

function commentNamed(dom: ReturnType<typeof installDom>, text: string): HTMLElement {
	const nodes = Array.from(dom.document.querySelectorAll('#tree .comment[data-row-id]')) as HTMLElement[];
	const node = nodes.find((candidate) => (candidate.textContent || '').includes(text));
	assert.ok(node, `the rendered window contains the ${text} annotation`);
	return node;
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
			const scroller = dom.document.querySelector('#tree > .virtual-scroll-vscroll') as HTMLElement;
			assert.ok(scroller, 'the shared scroll surface is the tree root child');
			const windowEl = dom.document.querySelector('#tree-pane .document-tree-window') as HTMLElement;
			assert.ok(windowEl, 'the docs view window is inside the pane layer');
			assert.ok(
				dom.document.querySelector('#tree-pane .document-tree-header-row'),
				'the schema/package lines are content rows'
			);
			const headerGap = dom.document.querySelector(
				'#tree-pane .document-tree-header-gap'
			) as HTMLElement;
			assert.ok(headerGap, 'a header gap row follows the schema/package lines');
			assert.strictEqual(headerGap.getAttribute('role'), 'presentation');
			assert.strictEqual(headerGap.getAttribute('aria-hidden'), 'true');
			assert.strictEqual(headerGap.tabIndex, -1);
			assert.strictEqual(headerGap.hasAttribute('data-node-id'), false);
			assert.strictEqual(headerGap.children.length, 0, 'the gap is one blank line with no rule child');
			assert.ok(headerGap.previousElementSibling?.classList.contains('document-tree-header-row'));
			const firstNode = dom.document.querySelector('#tree-pane .node') as HTMLElement;
			assert.ok(firstNode, 'the first module node exists');
			assert.ok(
				(headerGap.compareDocumentPosition(firstNode) & 4) !== 0,
				'the gap precedes the first module node'
			);
			const headerCount = dom.document.querySelectorAll('#tree-pane .document-tree-header-row').length;
			assert.strictEqual(headerGap.getAttribute('data-document-index'), String(headerCount));
			headerGap.click();
			assert.strictEqual(messagesOf(dom.api, 'select').length, 0, 'clicking the gap does not select');
			assert.strictEqual(dom.document.querySelector('.document-tree-title-bar'), null);
			assert.strictEqual(dom.document.querySelector('.document-tree-header'), null);
			assert.strictEqual(dom.document.querySelector('#tree').getAttribute('aria-label'), 'ECUC values');
		} finally {
			dom.restore();
		}
	});

	test('the module gap is one inert numbered row between two modules', () => {
		const { dom } = mount(twoModuleDocument());
		try {
			const gaps = Array.from(
				dom.document.querySelectorAll('#tree-pane .document-tree-module-gap')
			) as HTMLElement[];
			assert.strictEqual(gaps.length, 1, 'one gap separates the two modules');
			const gap = gaps[0];
			assert.strictEqual(gap.getAttribute('role'), 'presentation');
			assert.strictEqual(gap.getAttribute('aria-hidden'), 'true');
			assert.strictEqual(gap.tabIndex, -1);
			assert.strictEqual(gap.hasAttribute('data-node-id'), false);
			assert.strictEqual(gap.hasAttribute('data-gap'), false);
			assert.strictEqual(gap.children.length, 0, 'the gap is one blank line with no rule child');
			assert.strictEqual(
				dom.document.querySelectorAll('#tree-pane [data-gap]').length,
				0,
				'no row keeps the old padding marker'
			);
			const index = Number(gap.dataset.documentIndex);
			assert.strictEqual(lineCell(dom, index).textContent, String(index + 1), 'the gap is a numbered line');
			assert.strictEqual(lineCell(dom, index).style.height, '20px', 'the gap is exactly one base row high');

			assert.ok(
				gap.previousElementSibling?.classList.contains('brace'),
				'the gap follows the first module subtree'
			);
			const annotation = gap.nextElementSibling as HTMLElement;
			assert.ok(annotation.classList.contains('comment'), 'the gap sits above the module annotations');
			assert.ok((annotation.textContent || '').includes('second module note'));
			const modules = Array.from(
				dom.document.querySelectorAll('#tree-pane .node[data-kind="module"]')
			) as HTMLElement[];
			assert.strictEqual(modules.length, 2);
			assert.strictEqual(
				Number(modules[1].dataset.documentIndex),
				index + 2,
				'the gap and its annotation precede the module label'
			);
			assert.strictEqual(
				Number(lineCell(dom, Number(modules[1].dataset.documentIndex)).textContent),
				Number(lineCell(dom, index).textContent) + 2,
				'the gap, its annotation and then the module label are consecutive lines'
			);
			assertSequentialNumbers(dom);

			gap.click();
			assert.strictEqual(messagesOf(dom.api, 'select').length, 0, 'clicking the gap does not select');
			lineCell(dom, index).click();
			assert.strictEqual(messagesOf(dom.api, 'select').length, 0, 'clicking the gap number does not select');
			assert.strictEqual(gap.hasAttribute('aria-selected'), false, 'the gap is not a tree row');

			const moduleBId = modules[1].dataset.nodeId;
			const lastModuleARow = rowNamed(dom, 'Value');
			lastModuleARow.focus();
			lastModuleARow.dispatchEvent(
				new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
			);
			const focusedModule = dom.document.querySelector(
				`#tree-pane .node[data-node-id="${moduleBId}"]`
			) as HTMLElement | null;
			assert.ok(focusedModule, 'the second module is rendered');
			assert.strictEqual(
				(dom.document.activeElement as HTMLElement | null)?.dataset?.nodeId,
				moduleBId,
				'keyboard navigation skips the module gap'
			);

			const before = Number(gap.dataset.documentIndex);
			const twisty = rowNamed(dom, 'ContA').querySelector('.twisty') as HTMLElement;
			twisty.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			const collapsedGap = dom.document.querySelector('#tree-pane .document-tree-module-gap') as HTMLElement;
			assert.ok(collapsedGap, 'the gap survives a collapse');
			assert.ok(
				Number(collapsedGap.dataset.documentIndex) < before,
				'collapsing the first module moves the gap up'
			);
			assertSequentialNumbers(dom);
			const expand = rowNamed(dom, 'ContA').querySelector('.twisty') as HTMLElement;
			expand.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			assert.strictEqual(
				Number((dom.document.querySelector('#tree-pane .document-tree-module-gap') as HTMLElement).dataset
					.documentIndex),
				before,
				'expanding restores the gap position'
			);
			assertSequentialNumbers(dom);
		} finally {
			dom.restore();
		}
	});

	test('search skips the module gap and the full content width covers header lines', async () => {
		const payload = twoModuleDocument();
		const longPackage = 'Pkg.' + 'X'.repeat(180);
		const { dom } = mount({ ...payload, header: { packages: [longPackage] } });
		try {
			const windowEl = dom.document.querySelector('#tree-pane .document-tree-window') as HTMLElement;
			const contentWidth = Number.parseFloat(
				windowEl.style.getPropertyValue('--document-tree-content-width')
			);
			assert.ok(
				contentWidth >= longPackage.length,
				`the full content estimate covers the header line (${contentWidth})`
			);
			assert.notStrictEqual(contentWidth, 0, 'the model publishes its content width');
			const spacer = dom.document.querySelector('#tree .virtual-scroll-hspacer') as HTMLElement;
			assert.strictEqual(
				Number.parseFloat(spacer.style.width),
				contentWidth,
				'the scroll extent matches the content width, so the right edge stays reachable'
			);
			assert.strictEqual(
				dom.document.querySelectorAll('#tree-pane .document-tree-module-gap[data-search-current]').length,
				0
			);
			const input = dom.document.getElementById('search-input') as HTMLInputElement;
			input.value = 'ModB';
			input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
			input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			await settleSearch();
			const count = dom.document.getElementById('search-count')!.textContent;
			assert.ok(/1 \/ 1/.test(count || ''), `search counts only the row, not the gap (${count})`);
		} finally {
			dom.restore();
		}
	});

	test('the full content width covers long annotation rows', () => {
		const payload = twoModuleDocument();
		const longComment = 'N'.repeat(180);
		const rows = payload.rows.map((row) =>
			row.kind === 'module' ? { ...row, comments: [longComment] } : row
		);
		const { dom } = mount({ rows, header: { packages: [] } });
		try {
			const windowEl = dom.document.querySelector('#tree-pane .document-tree-window') as HTMLElement;
			const contentWidth = Number.parseFloat(
				windowEl.style.getPropertyValue('--document-tree-content-width')
			);
			assert.ok(
				contentWidth >= longComment.length,
				`the full content estimate covers comment rows (${contentWidth})`
			);
		} finally {
			dom.restore();
		}
	});

	test('the header gap is absent when there is no schema or package header', () => {
		const { dom } = mount({ rows: editorDocument().rows });
		try {
			assert.strictEqual(dom.document.querySelector('#tree-pane .document-tree-header-gap'), null);
		} finally {
			dom.restore();
		}
	});

	test('the Document numbers every virtual row, including the header, gap, comments and braces', () => {
		const { dom } = mount(annotationDocument());
		try {
			const gutter = gutterElement(dom);
			assert.strictEqual(gutter.getAttribute('aria-hidden'), 'true');
			assert.strictEqual(gutter.getAttribute('data-side'), 'document');
			assert.strictEqual(gutter.tabIndex, -1);
			assert.ok(gutter.previousElementSibling?.classList.contains('document-tree-window'), 'the gutter is after the window');
			const width = (dom.document.querySelector('#tree-pane') as HTMLElement).style.getPropertyValue('--line-numbers-width');
			assert.ok(/^[5-9]\d*ch$/.test(width), `the gutter width is at least five characters (${width})`);
			assert.ok(dom.document.querySelector('#tree-pane .comment'), 'the fixture renders an annotation line');
			assert.ok(dom.document.querySelector('#tree-pane .brace'), 'the fixture renders brace lines');
			assertSequentialNumbers(dom);
			const headerCount = dom.document.querySelectorAll('#tree-pane .document-tree-header-row').length;
			assert.ok(headerCount > 0, 'the fixture has a schema/package header');
			assert.strictEqual(lineCell(dom, headerCount).textContent, String(headerCount + 1), 'the gap is a numbered line');
			const firstNode = dom.document.querySelector('#tree-pane .node') as HTMLElement;
			assert.strictEqual(
				lineCell(dom, Number(firstNode.dataset.documentIndex)).textContent,
				String(Number(firstNode.dataset.documentIndex) + 1),
				'the first module line follows the gap'
			);
		} finally {
			dom.restore();
		}
	});

	test('collapsing and expanding a container renumbers the display rows', () => {
		const { dom } = mount();
		try {
			const beforeIniIndex = Number(rowNamed(dom, 'IniValue').dataset.documentIndex);
			assert.strictEqual(lineCell(dom, beforeIniIndex).textContent, String(beforeIniIndex + 1));
			const beforeCount = gutterCells(dom).length;
			const twisty = rowNamed(dom, 'ContA').querySelector('.twisty') as HTMLElement;
			twisty.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			assert.strictEqual(
				treeRows(dom.document).some((row) => row.querySelector('.label')?.textContent === 'IniValue'),
				false,
				'the collapsed subtree is hidden'
			);
			assert.ok(gutterCells(dom).length < beforeCount, 'hidden rows leave the gutter');
			assertSequentialNumbers(dom);
			const expand = rowNamed(dom, 'ContA').querySelector('.twisty') as HTMLElement;
			expand.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			const afterIniIndex = Number(rowNamed(dom, 'IniValue').dataset.documentIndex);
			assert.strictEqual(afterIniIndex, beforeIniIndex, 'expanding restores the row index');
			assert.strictEqual(lineCell(dom, afterIniIndex).textContent, String(afterIniIndex + 1));
			assertSequentialNumbers(dom);
		} finally {
			dom.restore();
		}
	});

	test('the selected row number is active and a re-scan without the row clears it', () => {
		const { dom, document } = mount();
		try {
			clickRow(dom, 'IniValue');
			const index = Number(rowNamed(dom, 'IniValue').dataset.documentIndex);
			const active = Array.from(
				dom.document.querySelectorAll('#tree-pane .document-tree-line-number[data-active="true"]')
			) as HTMLElement[];
			assert.strictEqual(active.length, 1, 'exactly one number is active');
			assert.strictEqual(active[0].textContent, String(index + 1));
			const selectedId = rowFor(document, 'IniValue').id;
			dom.post({
				type: 'document',
				document: {
					rows: document.rows.filter((row) => row.id !== selectedId),
					header: document.header,
				},
			});
			assert.strictEqual(
				dom.document.querySelector('#tree-pane .document-tree-line-number[data-active="true"]'),
				null,
				'a selection that no longer exists clears the active number'
			);
		} finally {
			dom.restore();
		}
	});

	test('the focused row number repeats the focus rail and clears when focus leaves', () => {
		const { dom } = mount();
		try {
			const row = rowNamed(dom, 'IniValue');
			const index = Number(row.dataset.documentIndex);
			row.focus();
			assert.strictEqual(lineCell(dom, index).dataset.focused, 'true', 'the focused row number carries the rail');
			const other = rowNamed(dom, 'ContA');
			other.focus();
			assert.strictEqual(lineCell(dom, index).dataset.focused, undefined, 'the previous row clears');
			assert.strictEqual(
				lineCell(dom, Number(other.dataset.documentIndex)).dataset.focused,
				'true',
				'the new focused row is marked'
			);
			(dom.document.getElementById('search-input') as HTMLElement).focus();
			assert.strictEqual(
				lineCell(dom, Number(other.dataset.documentIndex)).dataset.focused,
				undefined,
				'focus outside the tree clears the gutter rail'
			);
		} finally {
			dom.restore();
		}
	});

	test('the gutter stays fixed horizontally and follows the rows vertically', async () => {
		const { dom } = mount();
		try {
			const gutter = gutterElement(dom);
			const bar = dom.document.querySelector('#tree .virtual-scroll-hscroll') as HTMLElement;
			bar.scrollLeft = 40;
			bar.dispatchEvent(new dom.window.Event('scroll'));
			await new Promise((resolve) => setTimeout(resolve, 10));
			const windowEl = dom.document.querySelector('#tree-pane .document-tree-window') as HTMLElement;
			assert.strictEqual(windowEl.style.transform, 'translateX(-40px)', 'the rows pan horizontally');
			assert.strictEqual(gutter.style.transform, '', 'the gutter never translates with the rows');
			assert.ok(gutterCells(dom).length > 0, 'the numbers survive horizontal scroll');

			const scroller = dom.document.querySelector('#tree > .virtual-scroll-vscroll') as HTMLElement;
			scroller.scrollTop = 400;
			scroller.dispatchEvent(new dom.window.Event('scroll'));
			await new Promise((resolve) => setTimeout(resolve, 10));
			const cells = gutterCells(dom);
			assert.ok(cells.length > 0, 'the numbers are present after vertical scroll');
			assert.strictEqual(cells[0].style.top, windowEl.style.top, 'the gutter starts at the rendered window top');
			assertSequentialNumbers(dom);
		} finally {
			dom.restore();
		}
	});

	test('the gutter is inert decoration: no tree semantics, no search marks and no focus stop', async () => {
		const { dom } = mount();
		try {
			const gutter = gutterElement(dom);
			assert.strictEqual(gutter.querySelectorAll('[data-node-id], [role="treeitem"], [tabindex="0"]').length, 0);
			assert.strictEqual(gutter.tabIndex, -1);
			const input = dom.document.getElementById('search-input') as HTMLInputElement;
			input.value = 'IniValue';
			input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
			input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			await settleSearch();
			assert.ok(/^1 \/ [1-9]/.test(dom.document.getElementById('search-count')!.textContent || ''));
			assert.strictEqual(gutter.querySelectorAll('mark').length, 0, 'the gutter text is not searched');
			assert.strictEqual(gutter.querySelectorAll('[data-search-current]').length, 0);
		} finally {
			dom.restore();
		}
	});

	test('clicking a number selects its row; a header or gap number selects nothing', () => {
		const { dom } = mount();
		try {
			const row = rowNamed(dom, 'IniValue');
			const index = Number(row.dataset.documentIndex);
			lineCell(dom, index).click();
			assert.deepStrictEqual(messagesOf(dom.api, 'select'), [
				{ type: 'select', nodeId: row.dataset.nodeId },
			]);
			const header = dom.document.querySelector('#tree-pane .document-tree-header-row') as HTMLElement;
			lineCell(dom, Number(header.dataset.documentIndex)).click();
			assert.strictEqual(messagesOf(dom.api, 'select').length, 1, 'a header number never selects');
			assert.strictEqual(dom.document.activeElement, header, 'the header number focuses the header row');
			const gap = dom.document.querySelector('#tree-pane .document-tree-header-gap') as HTMLElement;
			lineCell(dom, Number(gap.dataset.documentIndex)).click();
			assert.strictEqual(messagesOf(dom.api, 'select').length, 1, 'the gap number never selects');
		} finally {
			dom.restore();
		}
	});

	test('the docs view has one horizontal bar that scrolls the window', async () => {
		const { dom } = mount();
		try {
			const bar = dom.document.querySelector('#tree .virtual-scroll-hscroll') as HTMLElement;
			assert.ok(bar, 'the docs view owns one horizontal bar');
			bar.scrollLeft = 40;
			bar.dispatchEvent(new dom.window.Event('scroll'));
			await new Promise((resolve) => setTimeout(resolve, 10));
			const windowEl = dom.document.querySelector('#tree-pane .document-tree-window') as HTMLElement;
			assert.strictEqual(windowEl.style.transform, 'translateX(-40px)');
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

	test('the Details find-references action posts the selected row id', () => {
		const { dom } = mount();
		try {
			const row = clickRow(dom, 'ContA');
			const buttons = Array.from(
				dom.document.querySelectorAll('#sb-details-body .inspector-actions button')
			) as HTMLButtonElement[];
			const button = buttons.find((candidate) => candidate.textContent === 'Find references');
			assert.ok(button, 'a container gets the Find references action');
			button!.click();
			const posted = messagesOf(dom.api, 'references');
			assert.strictEqual(posted.length, 1);
			assert.strictEqual(posted[0].nodeId, row.dataset.nodeId);
		} finally {
			dom.restore();
		}
	});

	test('selecting a container highlights the annotation row of a descendant sub-container', () => {
		const { dom } = mount(annotationDocument());
		try {
			clickRow(dom, 'Parent');
			assert.strictEqual(rowNamed(dom, 'Parent').dataset.selected, 'true');
			assert.strictEqual(rowNamed(dom, 'Child').dataset.subtree, 'true', 'the descendant node is highlighted');
			const comment = commentNamed(dom, 'child note');
			assert.strictEqual(comment.dataset.subtree, 'true', 'the descendant annotation is highlighted');
			assert.strictEqual(comment.getAttribute('aria-hidden'), 'true');
			assert.strictEqual(comment.getAttribute('tabindex'), null, 'the annotation is not focusable');
		} finally {
			dom.restore();
		}
	});

	test('clicking an annotation row does not change selection', () => {
		const { dom } = mount(annotationDocument());
		try {
			clickRow(dom, 'Parent');
			const comment = commentNamed(dom, 'child note');
			comment.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			assert.strictEqual(rowNamed(dom, 'Parent').dataset.selected, 'true', 'the previous selection survives');
			assert.strictEqual(rowNamed(dom, 'Child').dataset.selected, undefined, 'the annotation owner is not selected');
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

	test('a plain click selects, a double click selects text and Ctrl+Enter reveals', async () => {
		const { dom, document } = mount();
		try {
			const item = clickRow(dom, 'IniValue');
			assert.deepStrictEqual(messagesOf(dom.api, 'select'), [
				{ type: 'select', nodeId: rowFor(document, 'IniValue').id },
			]);
			item.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
			assert.strictEqual(messagesOf(dom.api, 'reveal').length, 0, 'a double click is a text gesture');
			item.dispatchEvent(
				new dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })
			);
			assert.deepStrictEqual(messagesOf(dom.api, 'reveal'), [
				{ type: 'reveal', nodeId: rowFor(document, 'IniValue').id },
			], 'Ctrl+Enter is the deliberate reveal');
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
