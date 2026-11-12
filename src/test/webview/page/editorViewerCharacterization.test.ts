/**
 * Characterization for the editor page's keyboard, hover, Details and host
 * message branches. These gestures are exercised against the bundled page so
 * the fallow complexity split can be compared against the exact DOM, focus,
 * inspector and protocol output it had before.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../../core/ecuc/scanner';
import { buildRows, EcucRow } from '../../../core/ecuc/renderRows';
import { SORT_EXCEPTIONS } from '../../../core/ecuc/order';
import { documentHeader } from '../../../webviewProtocol';
import type { EditorDocumentPayload } from '../../../webviewProtocol';
import { fixtureText } from '../../core/modelTestUtils';
import { installDom, loadModule, messagesOf, settleSearch, treeRows } from '../pageTestUtils';

const FIXTURE = 'editor/render.arxml';

function editorDocument(): EditorDocumentPayload {
	const model = scanEcucValues(fixtureText(FIXTURE));
	return {
		rows: buildRows(model, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows,
		header: documentHeader(model),
	};
}

function mount(payload: EditorDocumentPayload = editorDocument()) {
	const dom = installDom('editor');
	loadModule<typeof import('../../../webview/editorViewer')>('../../webview/editorViewer').mountEditor();
	dom.post({ type: 'conditions', entries: [] });
	dom.post({ type: 'document', document: payload });
	return { dom, document: payload };
}

function rowNamed(dom: ReturnType<typeof installDom>, label: string): any {
	const row = treeRows(dom.document).find(
		(candidate) => candidate.querySelector('.label')?.textContent === label
	);
	assert.ok(row, `the rendered window contains ${label}`);
	return row;
}

function activeNodeId(dom: ReturnType<typeof installDom>): string | undefined {
	return dom.document.activeElement?.dataset?.nodeId;
}

function press(
	dom: ReturnType<typeof installDom>,
	target: any,
	key: string,
	init: Record<string, unknown> = {}
): any {
	const event = new dom.window.KeyboardEvent('keydown', {
		key,
		bubbles: true,
		cancelable: true,
		...init,
	});
	target.dispatchEvent(event);
	return event;
}

function clickRow(dom: ReturnType<typeof installDom>, label: string): any {
	const row = rowNamed(dom, label);
	row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
	return row;
}

interface InspectorRow {
	key: string;
	code: string;
	control: string | undefined;
}

function inspectorText(row: any, selector: string): string {
	return row.querySelector(selector)?.textContent ?? '';
}

function inspectorRowOf(row: any): InspectorRow {
	const control = row.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null;
	return {
		key: inspectorText(row, '.inspector-key'),
		code: inspectorText(row, '.inspector-code'),
		control: control ? control.value : undefined,
	};
}

function inspectorRows(dom: ReturnType<typeof installDom>): InspectorRow[] {
	return Array.from(dom.document.querySelectorAll('#sb-details-body .inspector-row')).map(inspectorRowOf);
}

function inspectorButtonLabels(dom: ReturnType<typeof installDom>): string[] {
	return Array.from(dom.document.querySelectorAll('#sb-details-body .inspector-actions button')).map(
		(button: any) => button.textContent
	);
}

suite('editor viewer characterization', () => {
	test('the tree key map moves, expands, collapses, reveals, selects and types ahead', () => {
		const { dom, document } = mount();
		try {
			const moduleRow = rowNamed(dom, 'PkgA.PkgB.ModDefs.ModX');
			const moduleId = moduleRow.dataset.nodeId;
			moduleRow.focus();

			press(dom, moduleRow, 'ArrowRight');
			assert.strictEqual(activeNodeId(dom), rowNamed(dom, 'ContA').dataset.nodeId, 'Right enters the container');
			press(dom, rowNamed(dom, 'ContA'), 'ArrowRight');
			assert.strictEqual(activeNodeId(dom), rowNamed(dom, 'Flag').dataset.nodeId, 'Right enters the next level');
			press(dom, rowNamed(dom, 'Flag'), 'ArrowLeft');
			assert.strictEqual(activeNodeId(dom), rowNamed(dom, 'ContA').dataset.nodeId, 'Left on a leaf goes to its parent');

			const contAId = rowNamed(dom, 'ContA').dataset.nodeId;
			press(dom, rowNamed(dom, 'ContA'), 'ArrowLeft');
			assert.strictEqual(rowNamed(dom, 'ContA').getAttribute('aria-expanded'), 'false', 'Left collapses');
			assert.strictEqual(activeNodeId(dom), contAId, 'collapsing keeps focus on the container');
			press(dom, rowNamed(dom, 'ContA'), 'ArrowRight');
			assert.strictEqual(rowNamed(dom, 'ContA').getAttribute('aria-expanded'), 'true', 'Right expands');

			press(dom, rowNamed(dom, 'ContA'), 'End');
			assert.strictEqual(activeNodeId(dom), rowNamed(dom, 'Text').dataset.nodeId, 'End goes to the last visible row');
			press(dom, rowNamed(dom, 'Text'), 'Home');
			assert.strictEqual(activeNodeId(dom), moduleId, 'Home returns to the first row');
			press(dom, rowNamed(dom, 'PkgA.PkgB.ModDefs.ModX'), 'PageDown');
			assert.strictEqual(activeNodeId(dom), rowNamed(dom, 'Text').dataset.nodeId, 'PageDown clamps to the end');
			press(dom, rowNamed(dom, 'Text'), 'PageUp');
			assert.strictEqual(activeNodeId(dom), moduleId, 'PageUp clamps to the start');

			press(dom, rowNamed(dom, 'ContA'), 'Enter');
			assert.strictEqual(rowNamed(dom, 'ContA').getAttribute('aria-expanded'), 'false', 'Enter toggles a container');
			press(dom, rowNamed(dom, 'ContA'), 'Enter');
			assert.strictEqual(rowNamed(dom, 'ContA').getAttribute('aria-expanded'), 'true', 'a second Enter reopens it');

			press(dom, rowNamed(dom, 'PeerIref'), 'Enter');
			assert.deepStrictEqual(messagesOf(dom.api, 'reveal'), [
				{ type: 'reveal', nodeId: rowFor(document, 'PeerIref').id },
			]);
			press(dom, rowNamed(dom, 'PkgA.PkgB.ModDefs.ModX'), 'Enter', { ctrlKey: true });
			press(dom, rowNamed(dom, 'PkgA.PkgB.ModDefs.ModX'), 'Enter', { altKey: true });
			assert.strictEqual(messagesOf(dom.api, 'reveal').length, 3, 'Ctrl/Alt+Enter reveal');

			press(dom, rowNamed(dom, 'ContA'), ' ');
			assert.deepStrictEqual(messagesOf(dom.api, 'select'), [
				{ type: 'select', nodeId: contAId },
			]);
			assert.strictEqual(rowNamed(dom, 'ContA').dataset.selected, 'true', 'Space selects');

			press(dom, rowNamed(dom, 'IniValue'), 'F2');
			assert.ok(dom.document.getElementById('details-value'), 'F2 opens the parameter editor');
			press(dom, rowNamed(dom, 'ContA'), 'F2');
			assert.strictEqual(messagesOf(dom.api, 'reveal').length, 3, 'F2 on a container does nothing else');

			const firstHeader = dom.document.querySelector('#tree-pane .document-tree-header-row') as HTMLElement;
			firstHeader.focus();
			const headerEvent = press(dom, firstHeader, 'ArrowDown');
			assert.strictEqual(headerEvent.defaultPrevented, false, 'a header is not a treeitem');
			assert.strictEqual(dom.document.activeElement, firstHeader, 'a header keydown leaves focus alone');
		} finally {
			dom.restore();
		}
	});

	test('type-ahead starts after the focused row and wraps', () => {
		const first = mount();
		try {
			rowNamed(first.dom, 'PkgA.PkgB.ModDefs.ModX').focus();
			press(first.dom, rowNamed(first.dom, 'PkgA.PkgB.ModDefs.ModX'), 't');
			assert.strictEqual(
				activeNodeId(first.dom),
				rowNamed(first.dom, 'Title').dataset.nodeId,
				't skips to Title'
			);
		} finally {
			first.dom.restore();
		}

		const second = mount();
		try {
			press(second.dom, rowNamed(second.dom, 'PkgA.PkgB.ModDefs.ModX'), 'End');
			press(second.dom, rowNamed(second.dom, 'Text'), 'c');
			assert.strictEqual(
				activeNodeId(second.dom),
				rowNamed(second.dom, 'ContA').dataset.nodeId,
				'c wraps to ContA'
			);
		} finally {
			second.dom.restore();
		}
	});

	test('hover activates the owning container guide and leaves on the tree', () => {
		const { dom } = mount();
		try {
			const contA = rowNamed(dom, 'ContA');
			const contAId = contA.dataset.nodeId;
			const guide = dom.document.querySelector(
				`#tree-pane .guide[data-container-id="${contAId}"]`
			) as HTMLElement | null;
			assert.ok(guide, 'ContA has a bracket guide');

			contA.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
			assert.strictEqual(guide.classList.contains('guide-active'), true, 'the container guide activates');

			const leaf = rowNamed(dom, 'Flag');
			leaf.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
			assert.strictEqual(guide.classList.contains('guide-active'), true, 'a leaf walks to its container');

			const brace = dom.document.querySelector(
				`#tree-pane .brace[data-row-id="${contAId}"]`
			) as HTMLElement | null;
			assert.ok(brace);
			brace.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
			assert.strictEqual(guide.classList.contains('guide-active'), true, 'a brace hovers its owner');

			const comment = Array.from(
				dom.document.querySelectorAll('#tree-pane .comment[data-row-id]')
			).find((candidate: any) => (candidate.textContent || '').includes('container note')) as HTMLElement;
			assert.ok(comment);
			comment.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
			assert.strictEqual(guide.classList.contains('guide-active'), true, 'a comment hovers its owner');

			const header = dom.document.querySelector('#tree-pane .document-tree-header-row') as HTMLElement;
			header.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
			assert.strictEqual(dom.document.querySelectorAll('#tree-pane .guide-active').length, 0, 'a non-row clears');

			contA.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
			dom.document.getElementById('tree')!.dispatchEvent(new dom.window.MouseEvent('mouseleave'));
			assert.strictEqual(dom.document.querySelectorAll('#tree-pane .guide-active').length, 0, 'leaving clears');
		} finally {
			dom.restore();
		}
	});

	test('the Details body keeps its field order and actions per row kind', () => {
		const { dom } = mount();
		try {
			assert.deepStrictEqual(
				Array.from(dom.document.querySelectorAll('#sb-details-body .inspector-empty p')).map(
					(paragraph: any) => paragraph.textContent
				),
				['Select a line to see its details.', 'Click a line or press Space.']
			);

			clickRow(dom, 'PkgA.PkgB.ModDefs.ModX');
			assert.deepStrictEqual(inspectorRows(dom), [
				{ key: 'Definition', code: '/PkgA/PkgB/ModDefs/ModX', control: undefined },
				{ key: 'Short name', code: 'ModX', control: undefined },
				{ key: 'Variant', code: '(VariantPreCompile)', control: undefined },
				{ key: 'Condition', code: '(A == B)', control: undefined },
				{ key: 'Condition state', code: 'unknown', control: undefined },
				{ key: 'Condition note', code: 'missing: A, B', control: undefined },
				{ key: 'Conditions', code: '<Crit1 == 1 && Crit2 == 2>', control: undefined },
				{ key: 'Annotations', code: '[Note] module note', control: undefined },
			]);
			assert.deepStrictEqual(inspectorButtonLabels(dom), ['Find references', 'Reveal in source']);

			clickRow(dom, 'ContA');
			assert.deepStrictEqual(inspectorRows(dom), [
				{ key: 'Short name', code: '', control: 'ContA' },
				{ key: 'Definition', code: '', control: '/PkgA/PkgB/ModDefs/ModX/ContA' },
				{ key: 'Annotations', code: 'container note', control: undefined },
			]);
			assert.deepStrictEqual(inspectorButtonLabels(dom), ['Find references', 'Reveal in source']);

			clickRow(dom, 'IniValue');
			assert.deepStrictEqual(inspectorRows(dom), [
				{ key: 'Definition', code: '/PkgA/PkgB/ModDefs/ModX/ContA/IniValue', control: undefined },
				{ key: 'Type', code: 'Integer', control: undefined },
				{ key: 'Value', code: '', control: '63' },
				{ key: 'Decimal', code: '63', control: undefined },
				{ key: 'Hexadecimal', code: '0x3F', control: undefined },
				{ key: 'Binary', code: '0b00111111', control: undefined },
			]);
			assert.deepStrictEqual(inspectorButtonLabels(dom), ['Reveal in source']);

			clickRow(dom, 'PeerIref');
			assert.deepStrictEqual(inspectorRows(dom), [
				{ key: 'Definition', code: '/PkgA/PkgB/ModDefs/ModX/ContA/PeerIref', control: undefined },
				{ key: 'Target', code: '/PkgA/PkgB/ModX/ContA/ContB', control: undefined },
				{ key: 'Context', code: 'PkgA.PkgB.ModX.ContA', control: undefined },
			]);
			assert.deepStrictEqual(inspectorButtonLabels(dom), ['Jump to target', 'Reveal in source']);
		} finally {
			dom.restore();
		}
	});

	test('host messages dispatch to conditions, selection, status and re-scan state', () => {
		const { dom, document } = mount();
		try {
			dom.post({ type: 'conditions', entries: [{ name: 'B_SC', value: '2' }] });
			assert.strictEqual(
				dom.document.querySelector('#conditions-list .condition-name-text')!.textContent,
				'B_SC'
			);
			dom.post({ type: 'notice', scope: 'conditions', message: 'Fix the condition.' });
			assert.strictEqual(dom.document.getElementById('conditions-status')!.textContent, 'Fix the condition.');

			const contAId = rowFor(document, 'ContA').id;
			dom.post({ type: 'select', nodeId: 'missing-node' });
			assert.strictEqual(dom.document.querySelector('[data-selected="true"]'), null, 'an unknown id is dropped');
			dom.post({ type: 'select', nodeId: contAId });
			assert.strictEqual(
				dom.document.querySelector('[data-selected="true"]')?.getAttribute('data-node-id'),
				contAId
			);
			assert.deepStrictEqual(messagesOf(dom.api, 'select'), [], 'a host select does not echo');

			const status = dom.document.getElementById('details-status') as HTMLElement;
			dom.post({ type: 'notice', message: 'Jump failed.', kind: 'warn' });
			assert.strictEqual(status.textContent, 'Jump failed.');
			assert.strictEqual(status.dataset.kind, 'warn');
			dom.post({ type: 'notice', message: 'Not an integer.', kind: 'warn', inline: true, scope: 'details' });
			assert.strictEqual(status.textContent, '', 'an inline refusal already shown beside the field clears status');
			assert.strictEqual(status.dataset.kind, undefined);
			dom.post({ type: 'error', message: 'Boom.' });
			assert.strictEqual(status.textContent, 'Boom.');
			assert.strictEqual(status.dataset.kind, 'warn');

			const twisty = rowNamed(dom, 'ContA').querySelector('.twisty') as HTMLElement;
			twisty.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			assert.strictEqual(rowNamed(dom, 'ContA').getAttribute('aria-expanded'), 'false');
			dom.post({ type: 'document', document });
			assert.strictEqual(
				rowNamed(dom, 'ContA').getAttribute('aria-expanded'),
				'false',
				'a re-scan keeps the collapsed state'
			);
			assert.strictEqual(
				dom.document.querySelector('[data-selected="true"]')?.getAttribute('data-node-id'),
				contAId,
				'a re-scan keeps the selection'
			);
		} finally {
			dom.restore();
		}
	});

	test('a search jump expands a collapsed target and Escape returns focus to the tree', async () => {
		const { dom, document } = mount();
		try {
			const twisty = rowNamed(dom, 'ContA').querySelector('.twisty') as HTMLElement;
			twisty.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
			assert.strictEqual(
				treeRows(dom.document).some((row) => row.querySelector('.label')?.textContent === 'IniValue'),
				false,
				'the target starts inside a collapsed container'
			);

			const input = dom.document.getElementById('search-input') as HTMLInputElement;
			input.value = 'IniValue';
			input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
			input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			await settleSearch();

			const targetId = rowFor(document, 'IniValue').id;
			assert.strictEqual(dom.document.getElementById('search-count')!.textContent, '1 / 1');
			assert.ok(rowNamed(dom, 'IniValue'), 'the jump expands the ancestors');
			assert.strictEqual(
				dom.document.querySelector('[data-selected="true"]')?.getAttribute('data-node-id'),
				targetId,
				'the jump selects the target'
			);
			assert.strictEqual(dom.document.activeElement, input, 'the jump keeps focus in Search');

			input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
			assert.strictEqual(
				dom.document.activeElement?.dataset?.nodeId,
				targetId,
				'Escape returns focus to the visible selection'
			);
		} finally {
			dom.restore();
		}
	});

	test('Tab from the parameter value focuses the adjacent parameter after the re-scan', async () => {
		const { dom, document } = mount();
		try {
			clickRow(dom, 'IniValue');
			const input = dom.document.getElementById('details-value') as HTMLInputElement;
			input.focus();
			input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
			assert.deepStrictEqual(messagesOf(dom.api, 'edit'), [
				{ type: 'edit', nodeId: rowFor(document, 'IniValue').id, value: '63' },
			]);

			dom.post({ type: 'document', document });
			await new Promise((resolve) => setTimeout(resolve, 0));
			assert.strictEqual(
				dom.document.activeElement?.dataset?.nodeId,
				rowFor(document, 'Title').id,
				'the next visible parameter takes the edit focus'
			);
		} finally {
			dom.restore();
		}
	});

	test('the full content width estimate covers row labels, values, meta and headers exactly', () => {
		const moduleRow: EcucRow = {
			id: 'module:m#0',
			kind: 'module',
			level: 1,
			parentId: null,
			subtreeSize: 0,
			posinset: 1,
			setsize: 1,
			hasChildren: false,
			label: 'M',
			definitionRef: '/M',
			title: '',
			meta: [],
			haystack: 'm',
		};
		const moduleOnly = mount({ rows: [moduleRow], header: { packages: [] } });
		try {
			const windowEl = moduleOnly.dom.document.querySelector('#tree-pane .document-tree-window') as HTMLElement;
			const width = Number.parseFloat(windowEl.style.getPropertyValue('--document-tree-content-width'));
			assert.strictEqual(width, 50, 'module label + indent + gutter/padding at one character per ch');
		} finally {
			moduleOnly.dom.restore();
		}

		// level 2 parameter: indent 4 + label 1 + `= V` 3 + meta `Meta ` 5 = 14;
		// its comment is indent 4 + `/* ` 3 + `Note` 4 + ` */` 3 + gap 1 = 16; the
		// package header is `package ` 8 + `Pkg` 3 + gaps 2 = 13, so the comment wins.
		const rows: EcucRow[] = [
			moduleRow,
			{
				id: 'parameter:p#1',
				kind: 'parameter',
				level: 2,
				parentId: 'module:m#0',
				subtreeSize: 0,
				posinset: 1,
				setsize: 1,
				hasChildren: false,
				label: 'P',
				definitionRef: '/M/P',
				title: '',
				meta: [{ cls: 'annotation', text: 'Meta', title: 'Meta' }],
				haystack: 'p',
				shownValue: 'V',
				comments: ['Note'],
			},
		];
		const allParts = mount({ rows, header: { schema: 'S', packages: ['Pkg'] } });
		try {
			const windowEl = allParts.dom.document.querySelector('#tree-pane .document-tree-window') as HTMLElement;
			const width = Number.parseFloat(windowEl.style.getPropertyValue('--document-tree-content-width'));
			assert.strictEqual(
				width,
				58,
				'comment 16 + line numbers 5 + slack 3, then gutter and padding: 26 + 8 + 24'
			);
		} finally {
			allParts.dom.restore();
		}
	});
});

function rowFor(document: EditorDocumentPayload, label: string): EcucRow {
	const row = document.rows.find((candidate) => candidate.label === label);
	assert.ok(row, `the fixture has ${label}`);
	return row;
}
