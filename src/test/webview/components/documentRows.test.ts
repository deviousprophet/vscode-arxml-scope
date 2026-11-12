/**
 * The shared Document row primitives.
 *
 * The row builder is the only place a Document node's attributes, child order
 * and word-diff spans are decided, so these tests pin the observable output:
 * attribute values, dataset keys, child order and the `.word-changed` spans.
 */
import * as assert from 'assert';

import type { EcucRow } from '../../../core/ecuc/renderRows';
import type { WordPair } from '../../../core/diff/wordDiff';
import {
	buildDocumentNodeRow,
	type DocumentRowContext,
} from '../../../webview/components/documentTree/documentRows';
import { installMarkup } from '../pageTestUtils';

function row(overrides: Partial<EcucRow> = {}): EcucRow {
	return {
		id: 'p1',
		kind: 'parameter',
		level: 3,
		parentId: 'c1',
		subtreeSize: 0,
		posinset: 1,
		setsize: 1,
		hasChildren: false,
		label: 'IniValue',
		shortName: 'IniValueShort',
		definitionRef: '/P/M/C/IniValue',
		parameterType: 'Integer',
		formats: [],
		value: '63',
		shownValue: '63',
		title: '/P/M/C/IniValue',
		meta: [],
		haystack: 'inivalue 63',
		...overrides,
	};
}

function context(overrides: Partial<DocumentRowContext> = {}): DocumentRowContext {
	return {
		expandedIds: new Set(),
		searchQuery: '',
		subtreeIds: new Set(),
		...overrides,
	};
}

function childClasses(element: HTMLElement): string[] {
	return Array.from(element.children).map((child) => (child as HTMLElement).className);
}

function childElements(element: HTMLElement): HTMLElement[] {
	return Array.from(element.children).map((child) => child as HTMLElement);
}

function firstShell(node: HTMLElement): HTMLElement {
	const shell = node.firstElementChild;
	assert.ok(shell instanceof HTMLElement, 'the node carries a row shell');
	return shell;
}

suite('Document row builder', () => {
	test('a selected expanded container carries the full node state and child order', () => {
		const dom = installMarkup('<body></body>');
		try {
			const container = row({
				id: 'c1',
				kind: 'container',
				level: 2,
				posinset: 1,
				setsize: 2,
				hasChildren: true,
				label: 'ContA',
				shortName: 'ContA',
				definitionRef: '/P/M/ContA',
				shownValue: undefined,
				value: undefined,
				meta: [{ cls: 'short', text: 'ContA', title: 'Short name' }],
				empty: true,
				disabled: true,
				title: '/P/M/ContA title',
			});
			const node = buildDocumentNodeRow(
				container,
				context({
					selectedId: 'c1',
					expandedIds: new Set(['c1']),
					searchQuery: ' cont ',
					currentId: 'c1',
					subtreeIds: new Set(['c1']),
					guides: [{ level: 1, id: 'root' }],
				})
			);
			assert.strictEqual(node.className, 'node has-meta');
			assert.strictEqual(node.getAttribute('role'), 'treeitem');
			assert.strictEqual(node.getAttribute('aria-level'), '2');
			assert.strictEqual(node.getAttribute('aria-posinset'), '1');
			assert.strictEqual(node.getAttribute('aria-setsize'), '2');
			assert.strictEqual(node.getAttribute('aria-selected'), 'true');
			assert.strictEqual(node.getAttribute('aria-expanded'), 'true');
			assert.strictEqual(node.tabIndex, -1);
			assert.strictEqual(node.dataset.nodeId, 'c1');
			assert.strictEqual(node.dataset.kind, 'container');
			assert.strictEqual(node.dataset.definitionRef, '/P/M/ContA');
			assert.strictEqual(node.dataset.shortName, 'ContA');
			assert.strictEqual(node.dataset.value, undefined, 'a container carries no value');
			assert.strictEqual(node.dataset.target, undefined, 'a container carries no target');
			assert.strictEqual(node.dataset.selected, 'true');
			assert.strictEqual(node.dataset.searchCurrent, 'true');
			assert.strictEqual(node.dataset.subtree, undefined, 'the selected row is not a subtree row');
			assert.strictEqual(node.dataset.empty, 'true');
			assert.strictEqual(node.dataset.disabled, 'true');
			assert.strictEqual(node.title, '/P/M/ContA title');

			const shell = firstShell(node);
			assert.strictEqual(shell.className, 'row k-container no-value');
			assert.strictEqual(shell.dataset.level, '2');
			assert.deepStrictEqual(childClasses(shell), ['twisty', 'label', 'row-meta', 'sr-only', 'guide']);
			const shellChildren = childElements(shell);
			assert.strictEqual(shellChildren[2].children[0].className, 'short');
			assert.strictEqual(shellChildren[2].children[0].textContent, 'ContA');
			assert.strictEqual(shellChildren[3].textContent, '(disabled by condition)');
			assert.strictEqual(shellChildren[4].dataset.level, '1');
			assert.strictEqual(shellChildren[4].dataset.containerId, 'root');
			assert.strictEqual(shellChildren[4].getAttribute('aria-hidden'), 'true');
		} finally {
			dom.restore();
		}
	});

	test('parameter and reference rows write their kind-specific data only', () => {
		const dom = installMarkup('<body></body>');
		try {
			const parameter = buildDocumentNodeRow(
				row({ meta: [{ cls: 'annotation', text: '[note]', title: '' }] }),
				context({ selectedId: 'other' })
			);
			assert.strictEqual(parameter.className, 'node', 'an annotation is not inline meta');
			assert.strictEqual(parameter.dataset.value, '63');
			assert.strictEqual(parameter.dataset.target, undefined);
			assert.strictEqual(parameter.dataset.selected, undefined);
			const parameterShell = firstShell(parameter);
			assert.strictEqual(parameterShell.className, 'row k-parameter has-value');
			assert.deepStrictEqual(childClasses(parameterShell), ['label', 'value']);

			const reference = buildDocumentNodeRow(
				row({
					id: 'r1',
					kind: 'reference',
					label: 'PeerIref',
					value: '/P/Target',
					target: '/P/Target',
					shownValue: '/P/Target',
					meta: [],
				}),
				context()
			);
			assert.strictEqual(reference.dataset.value, undefined, 'a reference keeps the target, not a value');
			assert.strictEqual(reference.dataset.target, '/P/Target');
			assert.strictEqual(firstShell(reference).className, 'row k-reference has-value');
		} finally {
			dom.restore();
		}
	});

	test('a subtree row and a leaf row keep the remaining node flags independent', () => {
		const dom = installMarkup('<body></body>');
		try {
			const inSubtree = buildDocumentNodeRow(
				row({ id: 'p2', shownValue: undefined, value: undefined }),
				context({ selectedId: 'other', subtreeIds: new Set(['p2']), searchQuery: '   ', currentId: 'p2' })
			);
			assert.strictEqual(inSubtree.dataset.subtree, 'true');
			assert.strictEqual(inSubtree.dataset.searchCurrent, undefined, 'a blank query never marks a current row');
			const subtreeShell = firstShell(inSubtree);
			assert.strictEqual(subtreeShell.className, 'row k-parameter no-value');
			assert.strictEqual(subtreeShell.children[0].className, 'label');
			assert.ok(!inSubtree.querySelector('.twisty'), 'a leaf has no twisty');
		} finally {
			dom.restore();
		}
	});

	test('the label and value use the pair segments of the displayed side', () => {
		const dom = installMarkup('<body></body>');
		try {
			const pair: WordPair = {
				left: [{ text: 'Ini', changed: true }, { text: 'Value', changed: false }],
				right: [{ text: 'Ini', changed: false }, { text: 'Val', changed: true }],
			};
			const node = buildDocumentNodeRow(row(), context({ wordDiff: { label: pair, value: pair }, wordSide: 'right' }));
			const label = node.querySelector('.label')!;
			assert.strictEqual(label.textContent, 'IniVal');
			assert.strictEqual(label.childNodes[0].nodeType, 3, 'the unchanged run stays plain text');
			assert.strictEqual(label.childNodes[0].textContent, 'Ini');
			const changed = label.querySelector('.word-changed')!;
			assert.strictEqual(changed.textContent, 'Val');
			assert.strictEqual(changed.getAttribute('data-word-side'), 'right');

			const value = node.querySelector('.value-text')!;
			assert.strictEqual(value.textContent, 'IniVal');
			assert.strictEqual(value.querySelector('.word-changed')!.getAttribute('data-word-side'), 'right');
		} finally {
			dom.restore();
		}
	});

	test('meta chips pair by display order and extras fall back to the plain writer', () => {
		const dom = installMarkup('<body></body>');
		try {
			const pair: WordPair = {
				left: [{ text: '[A', changed: true }, { text: ' == 1]', changed: false }],
				right: [{ text: '[A', changed: false }, { text: ' == 2]', changed: true }],
			};
			const node = buildDocumentNodeRow(
				row({
					meta: [
						{ cls: 'condition', text: '[A == 1]', title: 'A = 1' },
						{ cls: 'condition', text: '[B == 1]', title: 'B = 1' },
					],
				}),
				context({ wordDiff: { meta: { condition: [pair] } }, wordSide: 'right' })
			);
			const chips = Array.from(node.querySelectorAll('.row-meta .condition'));
			assert.strictEqual(chips.length, 2);
			assert.ok(chips[0].querySelector('.word-changed'), 'the paired chip carries the changed run');
			assert.strictEqual(chips[0].textContent, '[A == 2]');
			assert.strictEqual(chips[1].querySelector('.word-changed'), null, 'the extra chip stays plain');
			assert.strictEqual(chips[1].textContent, '[B == 1]');
		} finally {
			dom.restore();
		}
	});

	test('a missing pair or side falls back to the plain text and the left segments', () => {
		const dom = installMarkup('<body></body>');
		try {
			const pair: WordPair = {
				left: [{ text: 'Left', changed: true }],
				right: [{ text: 'Right', changed: true }],
			};
			const noPair = buildDocumentNodeRow(row(), context({ wordDiff: { value: pair }, wordSide: 'right' }));
			assert.strictEqual(noPair.querySelector('.label')!.textContent, 'IniValue');
			assert.strictEqual(noPair.querySelector('.value-text')!.textContent, 'Right', 'only the value pair applies');

			const noSide = buildDocumentNodeRow(row(), context({ wordDiff: { label: pair } }));
			assert.strictEqual(noSide.querySelector('.label')!.textContent, 'IniValue');
			assert.strictEqual(noSide.querySelector('.value-text')!.textContent, '63');
			assert.strictEqual(noSide.querySelector('.label .word-changed'), null);

			const left = buildDocumentNodeRow(row(), context({ wordDiff: { label: pair }, wordSide: 'left' }));
			assert.strictEqual(left.querySelector('.label .word-changed')!.getAttribute('data-word-side'), 'left');
		} finally {
			dom.restore();
		}
	});
});
