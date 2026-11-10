/**
 * The shared Document window renderer.
 *
 * VirtualScroll owns the scroller and the offsets; this suite pins the window
 * contract: position, slice, horizontal translation and row callbacks.
 */
import * as assert from 'assert';

import { DocumentTreeView, type DocumentTreeLineInfo } from '../../../webview/components/documentTree/documentTreeView';
import { buildOffsets } from '../../../webview/render/virtualScroll';
import { webviewCss } from '../cssTestUtils';

interface FakeElement {
	name: string;
	className: string;
	textContent: string;
	hidden: boolean;
	tabIndex: number;
	title: string;
	dataset: Record<string, string>;
	style: { values: Record<string, string>; setProperty(name: string, value: string): void; [key: string]: any };
	attributes: Record<string, string>;
	listeners: Record<string, (event: unknown) => void>;
	children: FakeElement[];
	firstChild: FakeElement | undefined;
	lastChild: FakeElement | undefined;
	clientHeight: number;
	clientWidth: number;
	scrollWidth: number;
	classList: { add(): void; toggle(): void };
	appendChild(child: FakeElement): FakeElement;
	insertBefore(child: FakeElement, before: FakeElement): FakeElement;
	removeChild(child: FakeElement): FakeElement;
	setAttribute(name: string, value: string): void;
	addEventListener(type: string, listener: (event: unknown) => void): void;
	querySelector(): undefined;
	contains(): boolean;
}

function element(name = 'div'): FakeElement {
	const node: FakeElement = {
		name,
		className: '',
		textContent: '',
		hidden: false,
		tabIndex: 0,
		title: '',
		dataset: {},
		style: {
			values: {},
			setProperty(property: string, value: string) {
				this.values[property] = value;
			}
		},
		attributes: {},
		listeners: {},
		children: [],
		firstChild: undefined,
		lastChild: undefined,
		clientHeight: 0,
		clientWidth: 0,
		scrollWidth: 0,
		classList: { add() {}, toggle() {} },
		appendChild(child: FakeElement) {
			if (child.name === 'fragment') {
				for (const nested of child.children) {
					this.children.push(nested);
				}
			} else {
				this.children.push(child);
			}
			this.firstChild = this.children[0];
			this.lastChild = this.children[this.children.length - 1];
			return child;
		},
		insertBefore(child: FakeElement, before: FakeElement) {
			const at = this.children.indexOf(before);
			if (at < 0) {
				this.children.push(child);
			} else {
				this.children.splice(at, 0, child);
			}
			this.firstChild = this.children[0];
			this.lastChild = this.children[this.children.length - 1];
			return child;
		},
		removeChild(child: FakeElement) {
			const at = this.children.indexOf(child);
			if (at >= 0) {
				this.children.splice(at, 1);
			}
			this.firstChild = this.children[0];
			this.lastChild = this.children[this.children.length - 1];
			return child;
		},
		setAttribute(property: string, value: string) {
			this.attributes[property] = value;
		},
		addEventListener(type: string, listener: (event: unknown) => void) {
			this.listeners[type] = listener;
		},
		querySelector() {
			return undefined;
		},
		contains() {
			return true;
		}
	};
	let text = '';
	Object.defineProperty(node, 'textContent', {
		configurable: true,
		enumerable: true,
		get() {
			return text;
		},
		set(value: string) {
			text = value;
			if (value === '') {
				node.children = [];
				node.firstChild = undefined;
				node.lastChild = undefined;
			}
		}
	});
	return node;
}

interface Harness {
	root: FakeElement;
	view: DocumentTreeView;
	rendered: number[];
	ranges: Array<[number, number]>;
	clicked: number[];
	restore(): void;
}

type LineInfo = (index: number, pane: string) => DocumentTreeLineInfo | undefined;

function harness(rowCount = 1000, lineInfo?: LineInfo, activeLine?: (pane: string) => number | undefined): Harness {
	const root = element();
	const globals = globalThis as unknown as Record<string, unknown>;
	const saved = { document: globals.document };
	globals.document = {
		querySelector: () => root,
		createElement: () => element(),
		createTextNode: (text: string) => {
			const node = element('text');
			node.textContent = text;
			return node;
		},
		createDocumentFragment: () => element('fragment'),
		activeElement: undefined
	};
	const rendered: number[] = [];
	const ranges: Array<[number, number]> = [];
	const clicked: number[] = [];
	const view = new DocumentTreeView(root, 'document', {
		onRender(range) {
			ranges.push(range);
		},
		onRowClick(index) {
			clicked.push(index);
		}
	});
	view.mount();
	view.setModel({
		rowCount,
		offsets: buildOffsets(rowCount, () => 20),
		renderRow(index) {
			rendered.push(index);
			return element();
		},
		contentWidth: 500,
		...(lineInfo ? { lineInfo } : {}),
		...(activeLine ? { activeLine } : {})
	});
	const restore = () => {
		globals.document = saved.document;
	};
	return { root, view, rendered, ranges, clicked, restore };
}

function gutterOf(root: FakeElement): FakeElement {
	const gutter = root.children.find((child) => child.className === 'document-tree-lines');
	assert.ok(gutter, 'the pane has a line-number gutter');
	return gutter;
}

suite('DocumentTreeView component', () => {
	test('mount creates the window and the line-number gutter inside the pane layer', () => {
		const h = harness();
		try {
			assert.strictEqual(h.root.children.length, 2);
			assert.strictEqual(h.root.children[0].className, 'document-tree-window');
			const gutter = gutterOf(h.root);
			assert.strictEqual(gutter.attributes['aria-hidden'], 'true');
			assert.strictEqual(gutter.attributes['data-side'], 'document');
			assert.strictEqual(gutter.tabIndex, -1);
			assert.ok(gutter.listeners['click'], 'the gutter owns its click forwarding');
			assert.ok(h.root.listeners['click'], 'the pane owns the click listener');
			assert.strictEqual(
				h.view.getWindowElement().style.values['--document-tree-content-width'],
				'500px'
			);
			assert.strictEqual(h.root.style.values['--line-numbers-width'], '0ch', 'no model numbers collapse the column');
		} finally {
			h.restore();
		}
	});

	test('the number column is max(digits(max number), 5) and shrinks for an empty model', () => {
		const h = harness(1000, (index) => ({ number: index + 1 }));
		try {
			assert.strictEqual(h.view.lineNumberChars(), 5, 'four digits still reserve five characters');
			assert.strictEqual(h.root.style.values['--line-numbers-width'], '5ch');
			h.view.setModel({
				rowCount: 120000,
				offsets: buildOffsets(120000, () => 20),
				renderRow: () => element(),
				lineInfo: (index) => ({ number: index + 1 })
			});
			assert.strictEqual(h.view.lineNumberChars(), 6, 'the column grows with the digit count');
			assert.strictEqual(h.root.style.values['--line-numbers-width'], '6ch');
			h.view.setModel({
				rowCount: 0,
				offsets: [0],
				renderRow: () => element(),
				lineInfo: (index) => ({ number: index + 1 })
			});
			assert.strictEqual(h.view.lineNumberChars(), 0, 'an empty model hides the gutter');
			assert.strictEqual(h.root.style.values['--line-numbers-width'], '0ch');
		} finally {
			h.restore();
		}
	});

	test('the gutter renders cells for the visible slice from the offsets', () => {
		const h = harness(1000, (index) => ({ number: index + 1 }));
		try {
			h.view.render({ top: 500, left: 0, height: 100, width: 800 });
			const gutter = gutterOf(h.root);
			assert.strictEqual(gutter.children.length, 25, 'the gutter follows the window range');
			const first = gutter.children[0];
			assert.strictEqual(first.className, 'document-tree-line-number');
			assert.strictEqual(first.dataset.documentIndex, '15');
			assert.strictEqual(first.textContent, '16', 'the number is the 1-based virtual row');
			assert.strictEqual(first.style.top, '300px', 'the cell sits at the row offset');
			assert.strictEqual(first.style.height, '20px', 'the cell spans the row height');
			assert.strictEqual(gutter.children[24].textContent, '40');
		} finally {
			h.restore();
		}
	});

	test('an empty model clears the gutter cells', () => {
		const h = harness(0, (index) => ({ number: index + 1 }));
		try {
			h.view.render({ top: 0, left: 0, height: 100, width: 800 });
			assert.strictEqual(gutterOf(h.root).children.length, 0);
			assert.strictEqual(h.view.lineNumberChars(), 0);
		} finally {
			h.restore();
		}
	});

	test('refreshActiveLine re-colours one numbered cell without a rebuild', () => {
		let active: number | undefined = 15;
		const h = harness(1000, (index) => ({ number: index + 1 }), () => active);
		try {
			h.view.render({ top: 500, left: 0, height: 100, width: 800 });
			const gutter = gutterOf(h.root);
			assert.strictEqual(gutter.children[0].dataset.active, 'true');
			assert.strictEqual(
				gutter.children.filter((cell) => cell.dataset.active === 'true').length,
				1
			);
			active = 20;
			h.view.refreshActiveLine();
			assert.strictEqual(gutter.children[0].dataset.active, undefined);
			assert.strictEqual(gutter.children[5].dataset.active, 'true');
			active = undefined;
			h.view.refreshActiveLine();
			assert.strictEqual(
				gutter.children.filter((cell) => cell.dataset.active === 'true').length,
				0,
				'clearing the selection clears the active number'
			);
		} finally {
			h.restore();
		}
	});

	test('a blank missing-side cell never carries the active colour', () => {
		const h = harness(10, (index) => (index % 2 === 0 ? { number: index / 2 + 1 } : undefined), () => 2);
		try {
			h.view.render({ top: 0, left: 0, height: 100, width: 800 });
			const gutter = gutterOf(h.root);
			assert.strictEqual(gutter.children[2].dataset.active, 'true', 'the numbered cell is active');
			assert.strictEqual(gutter.children[1].dataset.active, undefined, 'the blank cell stays inactive');
		} finally {
			h.restore();
		}
	});

	test('the focused node cell repeats the focus rail and clears with focus', () => {
		const h = harness(1000, (index) => ({ number: index + 1 }));
		try {
			h.view.render({ top: 500, left: 0, height: 100, width: 800 });
			const gutter = gutterOf(h.root);
			h.view.onFocusIn({ target: { closest: () => ({ dataset: { documentIndex: '19' } }) } });
			assert.strictEqual(gutter.children[4].dataset.focused, 'true');
			assert.strictEqual(
				gutter.children.filter((cell) => cell.dataset.focused === 'true').length,
				1
			);
			h.view.applyFocusedLine(undefined);
			assert.strictEqual(
				gutter.children.filter((cell) => cell.dataset.focused === 'true').length,
				0,
				'leaving the row clears the gutter focus rail'
			);
			h.view.onFocusIn({ target: { closest: () => null } });
			assert.strictEqual(
				gutter.children.filter((cell) => cell.dataset.focused === 'true').length,
				0,
				'a header focus never marks a gutter cell'
			);
		} finally {
			h.restore();
		}
	});

	test('clicking a number forwards to the row click action', () => {
		const h = harness(1000, (index) => ({ number: index + 1 }));
		try {
			h.view.render({ top: 500, left: 0, height: 100, width: 800 });
			const gutter = gutterOf(h.root);
			let requested: number | undefined;
			let clicked = 0;
			h.view.elementAt = (index: number) => {
				requested = index;
				return {
					click() {
						clicked++;
					}
				};
			};
			h.view.onLineClick({ target: { closest: () => gutter.children[4] } });
			assert.strictEqual(requested, 19);
			assert.strictEqual(clicked, 1);
			h.view.onLineClick({ target: { closest: () => undefined } });
			assert.strictEqual(clicked, 1, 'a click outside a cell does nothing');
		} finally {
			h.restore();
		}
	});

	test('render positions the window at the first row offset and renders the slice', () => {
		const h = harness();
		try {
			h.view.render({ top: 500, left: 0, height: 100, width: 800 });
			const windowEl = h.view.getWindowElement();
			assert.strictEqual(windowEl.style.top, '300px', 'the first buffered row starts at 300px');
			assert.strictEqual(windowEl.style.height, '500px', 'the window spans the rendered rows');
			assert.deepStrictEqual(h.view.getVisibleRange(), [15, 40]);
			assert.strictEqual(h.rendered.length, 25);
			assert.strictEqual(h.rendered[0], 15);
			assert.strictEqual(h.rendered[h.rendered.length - 1], 39);
			assert.deepStrictEqual(h.ranges[h.ranges.length - 1], [15, 40]);
		} finally {
			h.restore();
		}
	});

	test('the shared horizontal offset translates the window', () => {
		const h = harness();
		try {
			h.view.render({ top: 0, left: 40, height: 100, width: 800 });
			assert.strictEqual(h.view.getWindowElement().style.transform, 'translateX(-40px)');
		} finally {
			h.restore();
		}
	});

	test('an unchanged viewport skips the DOM render and a move forces a new slice', () => {
		const h = harness(1000);
		try {
			h.view.render({ top: 500, left: 0, height: 100, width: 800 });
			const before = h.rendered.length;
			h.view.render({ top: 500, left: 0, height: 100, width: 800 });
			assert.strictEqual(h.rendered.length, before, 'same viewport is a no-op');
			h.view.render({ top: 520, left: 0, height: 100, width: 800 });
			assert.ok(h.rendered.length > before, 'a moved viewport renders a new slice');
		} finally {
			h.restore();
		}
	});

	test('clicking a row reports its virtual index', () => {
		const h = harness();
		try {
			const row = element();
			row.dataset.documentIndex = '3';
			h.view.onClick({ target: { closest: () => row } });
			assert.deepStrictEqual(h.clicked, [3]);
		} finally {
			h.restore();
		}
	});

	test('an empty model clears the window', () => {
		const h = harness(0);
		try {
			h.view.render({ top: 0, left: 0, height: 100, width: 800 });
			assert.strictEqual(h.view.getWindowElement().style.top, '0px');
			assert.strictEqual(h.view.getWindowElement().style.height, '0px');
			assert.deepStrictEqual(h.view.getVisibleRange(), [0, 0]);
		} finally {
			h.restore();
		}
	});

	test('the stylesheet owns the absolute window, the fixed gutter and no gap rule', () => {
		const css = webviewCss('components', 'documentTree', 'documentTree.css');
		assert.ok(/\.document-tree-window\s*\{[^}]*position:\s*absolute/.test(css));
		assert.ok(/\.document-tree-header-row\s*\{/.test(css));
		assert.ok(/\.document-tree-header-gap\s*\{[^}]*height:\s*var\(--ecuc-lh\)/.test(css));
		assert.ok(!/\.document-tree-header-gap-line/.test(css), 'the gap has no rule element or border');
		assert.ok(/\.document-tree-lines\s*\{[^}]*position:\s*absolute/.test(css));
		assert.ok(/\.document-tree-lines\s*\{[^}]*width:\s*var\(--line-numbers-width\)/.test(css));
		assert.ok(/\.document-tree-lines\s*\{[^}]*background:\s*var\(--vscode-editorGutter-background/.test(css));
		assert.ok(/\.document-tree-lines\s*\{[^}]*user-select:\s*none/.test(css));
		assert.ok(
			/\.document-tree-pane\s*\{[^}]*--content-pad:\s*calc\(var\(--line-numbers-width\) \+ var\(--fold-gutter\) \+ var\(--doc-pad\)\)/.test(
				css
			),
			'the pane redeclares the content pad from its own number column'
		);
		assert.ok(/\.document-tree-line-number\s*\{[^}]*text-align:\s*right/.test(css));
		assert.ok(/\.document-tree-line-number\s*\{[^}]*font-variant-numeric:\s*tabular-nums/.test(css));
		assert.ok(/\.document-tree-line-number\s*\{[^}]*cursor:\s*default/.test(css));
		assert.ok(
			/\.document-tree-line-number\s*\{[^}]*color:\s*var\(--vscode-editorLineNumber-foreground\)/.test(css)
		);
		assert.ok(
			/\.document-tree-line-number\[data-active="true"\]\s*\{[^}]*var\(--vscode-editorLineNumber-activeForeground\)/.test(css)
		);
		assert.ok(
			/body\[data-view="document"\] \.document-tree-line-number\[data-active="true"\],\s*body\[data-view="document"\] \.document-tree-line-number\[data-focused="true"\]\s*\{[^}]*inset 2px 0 0 var\(--rail\)/.test(
				css
			),
			'the Document gutter repeats the selection and focus rail'
		);
		assert.ok(/\.twisty\s*\{[^}]*left:\s*calc\(var\(--line-numbers-width\) \+ 2px\)/.test(css));
		assert.ok(
			/\.document-tree-header-row\[data-search-current="true"\] mark\s*\{[^}]*var\(--match-hi\)/.test(css),
			'the current header uses the strong search tier'
		);
		assert.ok(!/\.document-tree-scroll\s*\{/.test(css));
		assert.ok(!/\.document-tree-title-bar\s*\{/.test(css));
	});
});
