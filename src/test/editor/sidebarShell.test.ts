/**
 * The right sidebar shell: tab strip, sidebar width, section panes and the
 * shared button/field primitives.
 *
 * There is no webview DOM in the test host. The pure helpers are imported and
 * the page's own serialized copies are compiled from `renderHtml`; the pane and
 * tab classes are sliced out of the page script and driven with stub elements,
 * so the behaviour under test is the page's, not a host-side twin.
 */
import * as assert from 'assert';

import { scanEcucValues } from '../../core/ecuc/scanner';
import { RowPayload, renderHtml } from '../../editor/renderHtml';
import {
	DEFAULT_SIDEBAR_WIDTH,
	HEADER_H,
	MAX_SIDEBAR_WIDTH,
	MIN_PANE,
	MIN_SIDEBAR_WIDTH,
	PaneSpec,
	SASH_H,
	SASH_STEP,
	SidebarUiState,
	allocatePanes,
	clampSidebarWidth,
	loadUiState,
} from '../../editor/sidebarShell';
import { fixtureText } from '../core/modelTestUtils';
import { functionSource } from './scriptTestUtils';

const FIXTURE = 'editor/render.arxml';

function page(): string {
	return renderHtml(scanEcucValues(fixtureText(FIXTURE)), { nonce: 'test-nonce' });
}

function styleOf(html: string): string {
	const match = /<style[^>]*>([\s\S]*?)<\/style>/.exec(html);
	assert.ok(match, 'one inlined style block');
	return match[1];
}

function payload(source = page()): RowPayload {
	const match = /<script type="application\/json" id="ecuc-rows"[^>]*>([\s\S]*?)<\/script>/.exec(source);
	assert.ok(match, 'the page embeds the row document');
	return JSON.parse(match[1]) as RowPayload;
}

/** Compiles the page's sidebar width helpers with stub state, DOM and window. */
function compileResizer(
	source: string,
	state: SidebarUiState
): {
	apply(width: number, persist: boolean): void;
	width(): string | undefined;
	resizer: {
		classList: ReturnType<typeof fakeClassList>;
		handlers: Record<string, (event: Record<string, unknown>) => void>;
		addEventListener(type: string, listener: (event: Record<string, unknown>) => void): void;
	};
	handle: { offsetParent: unknown };
	move(clientX: number): void;
	release(): void;
	persisted(): number;
	setViewport(width: number): void;
} {
	const style = new Map<string, string>();
	const sidebar = {
		style: {
			setProperty(name: string, value: string) {
				style.set(name, value);
			},
		},
	};
	const tabs = { getBoundingClientRect: () => ({ width: 28 }) };
	const handle = { offsetParent: {} as unknown };
	const documentStub = {
		body: { classList: fakeClassList() },
		getElementById: (id: string) =>
			id === 'sidebar'
				? sidebar
				: id === 'side-tabs'
					? tabs
					: id === 'sidebar-resizer'
						? handle
						: undefined,
	};
	let moveHandler: ((event: { clientX: number }) => void) | undefined;
	let upHandler: (() => void) | undefined;
	const windowStub = {
		innerWidth: 1600,
		addEventListener(type: string, listener: (event: unknown) => void) {
			if (type === 'mousemove') {
				moveHandler = listener as (event: { clientX: number }) => void;
			} else if (type === 'mouseup') {
				upHandler = listener as () => void;
			}
		},
		removeEventListener(type: string) {
			if (type === 'mousemove') {
				moveHandler = undefined;
			} else if (type === 'mouseup') {
				upHandler = undefined;
			}
		},
	};
	const resizer = {
		classList: fakeClassList(),
		handlers: {} as Record<string, (event: Record<string, unknown>) => void>,
		addEventListener(type: string, listener: (event: Record<string, unknown>) => void) {
			resizer.handlers[type] = listener;
		},
	};
	let persisted = 0;
	const factory = new Function(
		'uiState',
		'persistUiState',
		'document',
		'window',
		'clampSidebarWidth',
		`${functionSource(source, 'sidebarTabsWidth')}
${functionSource(source, 'displayedSidebarWidth')}
${functionSource(source, 'applySidebarWidth')}
${functionSource(source, 'bindSidebarResizer')}
return { applySidebarWidth, bindSidebarResizer };`
	);
	const api = factory(state, () => persisted++, documentStub, windowStub, clampSidebarWidth) as {
		applySidebarWidth(width: number, persist: boolean): void;
		bindSidebarResizer(element: unknown): void;
	};
	api.bindSidebarResizer(resizer);
	return {
		apply: api.applySidebarWidth,
		width: () => style.get('--sidebar-w'),
		resizer,
		handle,
		move: (clientX) => moveHandler?.({ clientX }),
		release: () => upHandler?.(),
		persisted: () => persisted,
		setViewport: (width) => {
			windowStub.innerWidth = width;
		},
	};
}

/** A minimal element tree for the page's details renderer (text nodes only). */
interface FakeNode {
	tagName: string;
	className: string;
	type: string;
	textContent: string;
	children: FakeNode[];
	handlers: Record<string, (event: unknown) => void>;
	appendChild(child: FakeNode): void;
	addEventListener(type: string, listener: (event: unknown) => void): void;
}

function fakeNode(tagName: string): FakeNode {
	const children: FakeNode[] = [];
	const handlers: Record<string, (event: unknown) => void> = {};
	const node = {
		tagName,
		className: '',
		type: '',
		children,
		handlers,
		appendChild(child: FakeNode) {
			children.push(child);
		},
		addEventListener(type: string, listener: (event: unknown) => void) {
			handlers[type] = listener;
		},
	};
	let text = '';
	Object.defineProperty(node, 'textContent', {
		get: () => text,
		set: (value: string) => {
			text = value;
			if (value === '') {
				// A real element drops its children when its text content is set.
				children.length = 0;
			}
		},
	});
	return node as FakeNode;
}

function descendants(node: FakeNode): FakeNode[] {
	const out: FakeNode[] = [];
	for (const child of node.children) {
		out.push(child, ...descendants(child));
	}
	return out;
}

function findButton(node: FakeNode, label: string): FakeNode | undefined {
	return descendants(node).find((child) => child.tagName === 'button' && child.textContent === label);
}

function hasEmptyLine(node: FakeNode, text: string): boolean {
	return descendants(node).some((child) => child.className === 'sb-empty' && child.textContent === text);
}

/**
 * Compiles the page's `updateInspector` (with its element helpers) against four
 * stub section bodies, so the test proves where each row lands rather than
 * grepping the source.
 */
function compileInspector(
	source: string,
	rows: readonly { id: string }[],
	selectedId: string | undefined
): {
	node: FakeNode;
	value: FakeNode;
	reference: FakeNode;
	conditions: FakeNode;
	run(): void;
	followed(): string[];
	revealed(): string[];
} {
	const node = fakeNode('div');
	const value = fakeNode('div');
	const reference = fakeNode('div');
	const conditions = fakeNode('div');
	const followed: string[] = [];
	const revealed: string[] = [];
	const rowById = new Map(rows.map((row) => [row.id, row]));
	const inspectorFieldsOfRow = new Function(`${functionSource(source, 'inspectorFields')}\nreturn inspectorFields;`)() as (
		row: unknown
	) => unknown;
	const factory = new Function(
		'inspector',
		'detailsNodeBody',
		'detailsValueBody',
		'detailsReferenceBody',
		'detailsConditionsBody',
		'selectedId',
		'rowById',
		'detailsSelectionChanged',
		'inspectorFields',
		'detailsContainerFields',
		'detailsValueInput',
		'followItem',
		'revealItem',
		'document',
		`${functionSource(source, 'inspectorElement')}
${functionSource(source, 'inspectorRow')}
${functionSource(source, 'paneEmpty')}
${functionSource(source, 'paneActions')}
${functionSource(source, 'updateInspector')}
return updateInspector;`
	);
	const run = factory(
		{},
		node,
		value,
		reference,
		conditions,
		selectedId,
		rowById,
		() => undefined,
		inspectorFieldsOfRow,
		(fieldsRow: { id: string }) => {
			const fields = fakeNode('div');
			fields.className = 'inspector-fields';
			fields.textContent = `container:${fieldsRow.id}`;
			return fields;
		},
		(fieldsRow: { id: string }) => {
			const input = fakeNode('input');
			input.className = 'details-value';
			input.textContent = `value:${fieldsRow.id}`;
			return input;
		},
		(id: string) => followed.push(id),
		(id: string) => revealed.push(id),
		{ createElement: (tag: string) => fakeNode(tag) }
	) as () => void;
	return { node, value, reference, conditions, run, followed: () => followed, revealed: () => revealed };
}

/** One section as the allocator sees it. */
function spec(id: string, saved: number | null = null, user = false, collapsed = false): PaneSpec {
	return { id, saved, user, collapsed };
}

/** A minimal class list with the three methods the page uses. */
function fakeClassList(initial: readonly string[] = []): {
	values: Set<string>;
	contains(name: string): boolean;
	toggle(name: string, force?: boolean): void;
	add(name: string): void;
	remove(name: string): void;
} {
	const values = new Set(initial);
	return {
		values,
		contains: (name) => values.has(name),
		toggle(name, force) {
			const on = force === undefined ? !values.has(name) : force;
			if (on) {
				values.add(name);
			} else {
				values.delete(name);
			}
		},
		add: (name) => values.add(name),
		remove: (name) => values.delete(name),
	};
}

interface FakeHead {
	attrs: Record<string, string>;
	handlers: Record<string, (event: unknown) => void>;
	classList: ReturnType<typeof fakeClassList>;
	tabIndex: number;
	focused: boolean;
	setAttribute(name: string, value: string): void;
	getAttribute(name: string): string | null;
	addEventListener(type: string, listener: (event: unknown) => void): void;
	focus(): void;
}

function fakeHead(): FakeHead {
	const attrs: Record<string, string> = {};
	const handlers: Record<string, (event: unknown) => void> = {};
	return {
		attrs,
		handlers,
		classList: fakeClassList(),
		tabIndex: 0,
		focused: false,
		setAttribute(name, value) {
			attrs[name] = value;
		},
		getAttribute: (name) => attrs[name] ?? null,
		addEventListener(type, listener) {
			handlers[type] = listener;
		},
		focus() {
			this.focused = true;
		},
	};
}

interface FakeSection {
	id: string;
	dataset: { paneId: string };
	classList: ReturnType<typeof fakeClassList>;
	head: FakeHead;
	body: Record<string, never>;
	style: { values: Map<string, string>; setProperty(name: string, value: string): void };
	querySelector(selector: string): unknown;
}

function fakeSection(id: string): FakeSection {
	const head = fakeHead();
	const style = {
		values: new Map<string, string>(),
		setProperty(name: string, value: string) {
			style.values.set(name, value);
		},
	};
	const section: FakeSection = {
		id,
		dataset: { paneId: id },
		classList: fakeClassList(['sb-section', 'sb-pane']),
		head,
		body: {},
		style,
		querySelector(selector) {
			return selector === '.sb-section-head' ? head : selector === '.sb-body' ? section.body : null;
		},
	};
	return section;
}

interface FakeSash {
	prev: FakeSection | null;
	next: FakeSection | null;
	previousElementSibling: FakeSection | null;
	nextElementSibling: FakeSection | null;
	classList: ReturnType<typeof fakeClassList>;
	attrs: Record<string, string>;
	handlers: Record<string, (event: unknown) => void>;
	tabIndex: number;
	setAttribute(name: string, value: string): void;
	removeAttribute(name: string): void;
	addEventListener(type: string, listener: (event: unknown) => void): void;
}

function fakeSash(prev: FakeSection, next: FakeSection): FakeSash {
	const attrs: Record<string, string> = {};
	const handlers: Record<string, (event: unknown) => void> = {};
	return {
		prev,
		next,
		previousElementSibling: prev,
		nextElementSibling: next,
		classList: fakeClassList(['sb-pane-sash']),
		attrs,
		handlers,
		tabIndex: 0,
		setAttribute(name, value) {
			attrs[name] = value;
		},
		removeAttribute(name) {
			delete attrs[name];
		},
		addEventListener(type, listener) {
			handlers[type] = listener;
		},
	};
}

interface PaneFixture {
	root: {
		clientHeight: number;
		classList: ReturnType<typeof fakeClassList>;
		querySelectorAll(selector: string): unknown[];
	};
	sections: FakeSection[];
	sash: FakeSash;
}

function paneFixture(height = 600): PaneFixture {
	const first = fakeSection('sb-details-node');
	const second = fakeSection('sb-details-value');
	const sash = fakeSash(first, second);
	return {
		root: {
			clientHeight: height,
			classList: fakeClassList(['sb-pane-view']),
			querySelectorAll: (selector) =>
				selector === '.sb-section' ? [first, second] : selector === '.sb-pane-sash' ? [sash] : [],
		},
		sections: [first, second],
		sash,
	};
}

/** Compiles the page's SidebarPaneView with stub globals. */
function compilePaneView(
	source: string,
	state: SidebarUiState
): new (root: unknown) => {
	layout(): void;
	setCollapsed(id: string, collapsed: boolean, persist?: boolean): void;
	shiftPane(aboveId: string, belowId: string, delta: number): void;
	isCollapsed(id: string): boolean;
	showSection(id: string): boolean;
} {
	const classAt = source.indexOf('class SidebarPaneView {');
	const classEnd = source.indexOf('function bindSidebarResizer(');
	assert.ok(classAt >= 0 && classEnd > classAt, 'the page emits the pane view class');
	const emitted = source.slice(classAt, classEnd);
	const persisted: SidebarUiState[] = [];
	const factory = new Function(
		'HEADER_H',
		'MIN_PANE',
		'SASH_H',
		'SASH_STEP',
		'uiState',
		'persistUiState',
		'requestAnimationFrame',
		'ResizeObserver',
		'document',
		'Element',
		`${functionSource(source, 'allocatePanes')}\n${emitted}\nreturn SidebarPaneView;`
	);
	return factory(
		HEADER_H,
		MIN_PANE,
		SASH_H,
		SASH_STEP,
		state,
		() => persisted.push(state),
		(callback: () => void) => {
			callback();
			return 0;
		},
		undefined,
		{ body: { classList: fakeClassList() } },
		class Element {}
	);
}

suite('sidebar shell', () => {
	test('clampSidebarWidth keeps the width between 260 and 900px', () => {
		assert.strictEqual(MIN_SIDEBAR_WIDTH, 260, 'the serialized copy pins the minimum');
		assert.strictEqual(MAX_SIDEBAR_WIDTH, 900, 'the serialized copy pins the maximum');
		assert.strictEqual(DEFAULT_SIDEBAR_WIDTH, 360);
		assert.strictEqual(clampSidebarWidth(100, 1600, 28), 260, 'the minimum');
		assert.strictEqual(clampSidebarWidth(1200, 1600, 28), 900, 'the maximum');
		assert.strictEqual(clampSidebarWidth(420, 1600, 28), 420);
		assert.strictEqual(clampSidebarWidth(700, 700, 28), 452, 'the window keeps a tree gutter');
		assert.strictEqual(clampSidebarWidth(900, 1000, 28), 752, 'the sidebar cannot cover the tree');
		assert.strictEqual(clampSidebarWidth(Number.NaN, 1600, 28), 260, 'an invalid width falls back');
		assert.strictEqual(clampSidebarWidth(420.6, 1600, 28), 421, 'a width is a whole pixel');

		const inline = new Function(`${functionSource(page(), 'clampSidebarWidth')}\nreturn clampSidebarWidth;`)() as
			typeof clampSidebarWidth;
		for (const [width, viewport] of [
			[100, 1600],
			[1200, 1600],
			[420, 1600],
			[700, 700],
		] as Array<[number, number]>) {
			assert.strictEqual(inline(width, viewport, 28), clampSidebarWidth(width, viewport, 28), `${width}/${viewport}`);
		}
	});

	test('allocatePanes fills a lone pane, splits fresh panes and honours saved sizes', () => {
		assert.strictEqual(HEADER_H, 22);
		assert.strictEqual(SASH_H, 6);
		assert.strictEqual(MIN_PANE, 82, 'the serialized min pane is HEADER_H + 60');
		const single = allocatePanes(480, [spec('a')]);
		assert.deepStrictEqual([...single], [['a', 480]]);

		const even = allocatePanes(480, [spec('a'), spec('b')]);
		assert.deepStrictEqual([...even], [
			['a', 240],
			['b', 240],
		]);

		const saved = allocatePanes(480, [spec('a', 300, true), spec('b')]);
		assert.deepStrictEqual([...saved], [
			['a', 300],
			['b', 180],
		]);

		const clamped = allocatePanes(200, [spec('a', 900, true), spec('b')]);
		assert.strictEqual(clamped.get('a'), 118, 'a saved size leaves MIN_PANE for the other pane');
		assert.strictEqual(clamped.get('b'), 82);

		const tiny = allocatePanes(100, [spec('a'), spec('b')]);
		assert.deepStrictEqual([...tiny], [
			['a', 82],
			['b', 82],
		], 'a degenerate panel floors at MIN_PANE');
		assert.strictEqual(tiny.get('a')! + tiny.get('b')!, 164, 'the pool expands to the minimum');
	});

	test('allocatePanes skips collapsed panes and absorbs rounding in the last one', () => {
		assert.deepStrictEqual([...allocatePanes(480, [spec('a'), spec('b', null, false, true)])], [['a', 480]]);
		const odd = allocatePanes(481, [spec('a'), spec('b'), spec('c')]);
		assert.deepStrictEqual([...odd], [
			['a', 160],
			['b', 160],
			['c', 161],
		]);
		assert.strictEqual(
			[...odd.values()].reduce((sum, px) => sum + px, 0),
			481,
			'the sum is exact'
		);

		const underfilled = allocatePanes(594, [spec('a', 150, true), spec('b', 400, true)]);
		assert.deepStrictEqual([...underfilled], [
			['a', 162],
			['b', 432],
		], 'all-saved sizes scale up to fill the pool');

		const inline = new Function('MIN_PANE', `${functionSource(page(), 'allocatePanes')}\nreturn allocatePanes;`)(
			MIN_PANE
		) as typeof allocatePanes;
		for (const panes of [
			[spec('a')],
			[spec('a'), spec('b')],
			[spec('a', 300, true), spec('b')],
			[spec('a'), spec('b'), spec('c')],
			[spec('a'), spec('b', null, false, true)],
		]) {
			assert.deepStrictEqual([...inline(481, panes)], [...allocatePanes(481, panes)]);
		}
	});

	test('the shell markup has the tab strip, panels, sections and sashes', () => {
		const html = page();
		assert.ok(/id="sidebar-resizer"[^>]*role="separator"[^>]*aria-orientation="vertical"[^>]*tabindex="0"/.test(html));
		assert.ok(/id="side-tabs"[^>]*role="tablist"[^>]*aria-orientation="vertical"/.test(html));
		assert.ok(/id="stab-details"[^>]*role="tab"[^>]*aria-selected="true"[^>]*aria-controls="sbp-details"/.test(html));
		assert.ok(/id="stab-conditions"[^>]*role="tab"[^>]*aria-selected="false"[^>]*aria-controls="sbp-conditions"/.test(html));
		assert.ok(/id="sbp-details"[^>]*role="tabpanel"[^>]*aria-labelledby="stab-details"/.test(html));
		assert.ok(!/id="sbp-details"[^>]*\shidden/.test(html), 'the default Details panel is visible');
		assert.ok(/id="sbp-conditions"[^>]*role="tabpanel"[^>]*aria-labelledby="stab-conditions"[^>]*hidden/.test(html));
		assert.ok(/id="stab-details"[^>]*class="stab active"/.test(html), 'Details is selected first');
		assert.ok(!/id="stab-conditions"[^>]*class="stab active"/.test(html));

		for (const id of ['sb-details-node', 'sb-details-value', 'sb-details-reference', 'sb-details-conditions', 'sb-conditions-values']) {
			assert.ok(html.includes(`id="${id}" data-pane-id="${id}"`), `${id} is a pane`);
			assert.ok(html.includes(`id="${id}-body" role="region"`), `${id} has a region body`);
			assert.ok(
				new RegExp(`aria-controls="${id}-body"`).test(html),
				`${id} header controls its body`
			);
		}
		assert.ok(html.includes('Conditions &amp; annotations'), 'the section label is escaped and uppercase via CSS');
		assert.strictEqual((html.match(/class="sb-pane-sash"/g) ?? []).length, 3, 'three sashes between four Details panes');
		assert.ok(/class="sb-pane-sash"[^>]*role="separator"[^>]*aria-orientation="horizontal"[^>]*tabindex="0"/.test(html));
		assert.equal((html.match(/class="sb-section-head" role="button"/g) ?? []).length, 5, 'every section header is a button');
		assert.ok(html.includes('<div id="inspector" class="inspector sb-pane-view"'), 'the inspector is the Details pane view');
		assert.strictEqual((html.match(/id="inspector"/g) ?? []).length, 1, 'one details surface');
		const detailsAt = html.indexOf('id="sbp-details"');
		const inspectorAt = html.indexOf('id="inspector"');
		const conditionsAt = html.indexOf('id="sbp-conditions"');
		assert.ok(
			detailsAt >= 0 && inspectorAt > detailsAt && conditionsAt > inspectorAt,
			'the inspector is inside the Details tab panel'
		);
		const resizerAt = html.indexOf('id="sidebar-resizer"');
		const sidebarAt = html.indexOf('id="sidebar"');
		const tabsAt = html.indexOf('id="side-tabs"');
		assert.ok(resizerAt < sidebarAt && sidebarAt < tabsAt, 'resizer, panel and right-edge tab strip in order');
		const conditionsBodyAt = html.indexOf('id="sb-conditions-values-body"');
		assert.ok(html.includes('id="sb-conditions-values-body"'), 'the Conditions panel sits in its section body');
		const conditionsPanelAt = html.indexOf('id="conditions-panel"');
		const conditionsSectionEnd = html.indexOf('</section>', conditionsBodyAt);
		assert.ok(
			conditionsPanelAt > conditionsBodyAt && conditionsPanelAt < conditionsSectionEnd,
			'the existing Conditions panel markup is the section body'
		);
		assert.ok(!html.includes('id="conditions-toggle"'), 'no toolbar Conditions toggle');
		assert.ok(!html.includes('id="details-toggle"'), 'no toolbar Details toggle');
	});

	test('tab activation shows one panel and moves the roving focus', () => {
		const html = page();
		const state: SidebarUiState = { tab: 'details', sidebarWidth: 360, panes: {}, collapsed: [] };
		let persisted = 0;
		const detailsTab = fakeHead();
		detailsTab.attrs['aria-controls'] = 'sbp-details';
		const conditionsTab = fakeHead();
		conditionsTab.attrs['aria-controls'] = 'sbp-conditions';
		const tabList = {
			querySelectorAll: (selector: string) => (selector === '.stab' ? [detailsTab, conditionsTab] : []),
		};
		const detailsPanel = {
			id: 'sbp-details',
			classList: fakeClassList(['sb-tab-panel', 'active']),
			attrs: {} as Record<string, string>,
			removeAttribute(name: string) {
				delete this.attrs[name];
			},
			setAttribute(name: string, value: string) {
				this.attrs[name] = value;
			},
		};
		const conditionsPanel = {
			id: 'sbp-conditions',
			classList: fakeClassList(['sb-tab-panel']),
			attrs: { hidden: '' } as Record<string, string>,
			removeAttribute(name: string) {
				delete this.attrs[name];
			},
			setAttribute(name: string, value: string) {
				this.attrs[name] = value;
			},
		};
		const documentStub = {
			getElementById: (id: string) => (id === 'side-tabs' ? tabList : undefined),
			querySelectorAll: (selector: string) => (selector === '.sb-tab-panel' ? [detailsPanel, conditionsPanel] : []),
		};
		const factory = new Function(
			'uiState',
			'persistUiState',
			'document',
			'requestAnimationFrame',
			'layoutSidebarPanes',
			`${functionSource(html, 'sidebarTabName')}\n${functionSource(html, 'activateSidebarTab')}\nreturn activateSidebarTab;`
		);
		const activate = factory(state, () => persisted++, documentStub, (callback: () => void) => callback(), () => {
			return;
		}) as (name: string, focus: boolean) => void;

		activate('conditions', false);
		assert.strictEqual(state.tab, 'conditions');
		assert.strictEqual(persisted, 1);
		assert.strictEqual(detailsTab.attrs['aria-selected'], 'false');
		assert.strictEqual(detailsTab.tabIndex, -1);
		assert.strictEqual(conditionsTab.attrs['aria-selected'], 'true');
		assert.strictEqual(conditionsTab.tabIndex, 0);
		assert.ok(detailsPanel.classList.contains('active') === false, 'only one panel is visible');
		assert.ok(conditionsPanel.classList.contains('active'));
		assert.strictEqual(conditionsPanel.attrs.hidden, undefined, 'the active panel is not hidden');
		assert.strictEqual(detailsPanel.attrs.hidden, '', 'the inactive panel is hidden');

		activate('details', true);
		assert.strictEqual(state.tab, 'details');
		assert.strictEqual(persisted, 2);
		assert.strictEqual(detailsTab.tabIndex, 0);
		assert.strictEqual(conditionsTab.tabIndex, -1);
		assert.ok(detailsPanel.classList.contains('active'));
		assert.strictEqual(detailsPanel.attrs.hidden, undefined);
		assert.strictEqual(conditionsPanel.attrs.hidden, '');

		// The page's own key handler moves the roving focus with the arrow keys.
		const navFactory = new Function(
			'uiState',
			'persistUiState',
			'document',
			'requestAnimationFrame',
			'layoutSidebarPanes',
			'sidebarTabName',
			'activateSidebarTab',
			`${functionSource(html, 'onTabKeydown')}\nreturn onTabKeydown;`
		);
		const tabName = new Function(`${functionSource(html, 'sidebarTabName')}\nreturn sidebarTabName;`)() as (
			button: FakeHead
		) => string;
		const onKey = navFactory(
			state,
			() => persisted++,
			documentStub,
			(callback: () => void) => callback(),
			() => undefined,
			tabName,
			activate
		) as (event: { key: string; preventDefault(): void }, button: FakeHead) => void;
		detailsTab.focused = false;
		conditionsTab.focused = false;
		onKey({ key: 'ArrowDown', preventDefault: () => undefined }, detailsTab);
		assert.strictEqual(state.tab, 'conditions', 'ArrowDown activates the next tab');
		assert.ok(conditionsTab.focused, 'the roving focus follows the active tab');
		onKey({ key: 'ArrowDown', preventDefault: () => undefined }, conditionsTab);
		assert.strictEqual(state.tab, 'details', 'the arrow ring wraps');
		assert.ok(detailsTab.focused);
		onKey({ key: 'End', preventDefault: () => undefined }, detailsTab);
		assert.strictEqual(state.tab, 'conditions', 'End selects the last tab');
		onKey({ key: 'Home', preventDefault: () => undefined }, conditionsTab);
		assert.strictEqual(state.tab, 'details', 'Home selects the first tab');
	});

	test('the sidebar resizer drags, steps and clamps the width', () => {
		const html = page();
		const state: SidebarUiState = { tab: 'details', sidebarWidth: 420, panes: {}, collapsed: [] };
		const resizer = compileResizer(html, state);

		resizer.apply(420, false);
		assert.strictEqual(resizer.width(), '420px');

		resizer.resizer.handlers.keydown({ key: 'ArrowLeft', preventDefault: () => undefined });
		assert.strictEqual(state.sidebarWidth, 436, 'ArrowLeft moves the resizer left, widening the sidebar');
		assert.strictEqual(resizer.width(), '436px');
		assert.strictEqual(resizer.persisted(), 1, 'a keyboard resize is persisted');
		resizer.resizer.handlers.keydown({ key: 'ArrowRight', preventDefault: () => undefined });
		assert.strictEqual(state.sidebarWidth, 420, 'ArrowRight narrows it again');

		state.sidebarWidth = 880;
		resizer.apply(880, false);
		resizer.resizer.handlers.keydown({ key: 'ArrowLeft', preventDefault: () => undefined });
		assert.strictEqual(state.sidebarWidth, 896);
		resizer.resizer.handlers.keydown({ key: 'ArrowLeft', preventDefault: () => undefined });
		assert.strictEqual(state.sidebarWidth, 900, 'the width stops at the maximum');
		assert.strictEqual(resizer.width(), '900px');

		resizer.setViewport(1000);
		state.sidebarWidth = 900;
		resizer.apply(900, false);
		assert.strictEqual(resizer.width(), '752px', 'a narrow window clamps the displayed width');
		assert.strictEqual(state.sidebarWidth, 900, 'the preference survives a transient clamp');
		resizer.setViewport(1600);
		resizer.apply(900, false);
		assert.strictEqual(resizer.width(), '900px', 'widening the window restores it');

		state.sidebarWidth = 420;
		resizer.apply(420, true);
		const before = resizer.persisted();
		resizer.resizer.handlers.mousedown({ button: 0, clientX: 1000, preventDefault: () => undefined });
		resizer.move(960);
		assert.strictEqual(resizer.width(), '460px', 'dragging left widens the sidebar');
		assert.strictEqual(state.sidebarWidth, 420, 'the preference is not rewritten mid-drag');
		assert.strictEqual(resizer.persisted(), before, 'a mid-drag width is not written');
		resizer.release();
		assert.strictEqual(state.sidebarWidth, 460, 'the released width becomes the preference');
		assert.strictEqual(resizer.persisted(), before + 1, 'the width is persisted once on release');

		const afterDrag = resizer.persisted();
		resizer.resizer.handlers.mousedown({ button: 0, clientX: 1000, preventDefault: () => undefined });
		resizer.release();
		assert.strictEqual(resizer.persisted(), afterDrag, 'a click with no movement writes nothing');

		state.sidebarWidth = 420;
		resizer.handle.offsetParent = null;
		resizer.apply(1200, true);
		assert.strictEqual(state.sidebarWidth, 420, 'a stacked narrow layout keeps the saved preference');
		assert.strictEqual(resizer.persisted(), afterDrag, 'and writes nothing while the resizer is hidden');
	});

	test('updateInspector writes each row into its own section body', () => {
		const html = page();
		const rows = payload(html).rows;
		const parameter = rows.find((row) => row.kind === 'parameter' && row.value === '63');
		const container = rows.find((row) => row.kind === 'container' && row.shortName === 'ContA');
		const reference = rows.find((row) => row.kind === 'reference' && row.followable === true);
		assert.ok(parameter && container && reference, 'the fixture has a parameter, a container and a reference');

		const param = compileInspector(html, rows, parameter.id);
		param.run();
		assert.ok(param.value.children.some((child) => child.className === 'details-value'), 'the value editor is in Value');
		assert.ok(!param.reference.children.some((child) => child.className === 'details-value'), 'and not in Reference');
		assert.ok(hasEmptyLine(param.reference, 'No reference.'), 'an empty Reference shows a quiet line');
		const reveal = findButton(param.conditions, 'Reveal in source');
		assert.ok(reveal, 'Reveal lives in Conditions & annotations');
		assert.strictEqual(findButton(param.reference, 'Jump to target'), undefined, 'no jump on a parameter');
		reveal.handlers.click({});
		assert.deepStrictEqual(param.revealed(), [parameter.id], 'Reveal posts the selected row');

		const ref = compileInspector(html, rows, reference.id);
		ref.run();
		const jump = findButton(ref.reference, 'Jump to target');
		assert.ok(jump, 'Jump lives in Reference');
		jump.handlers.click({});
		assert.deepStrictEqual(ref.followed(), [reference.id], 'Jump follows the selected row');
		assert.ok(hasEmptyLine(ref.value, 'No editable value.'), 'a reference has no value editor');

		const cont = compileInspector(html, rows, container.id);
		cont.run();
		assert.ok(
			cont.node.children.some((child) => child.className === 'inspector-fields'),
			'the container fields are in Node'
		);
		assert.ok(hasEmptyLine(cont.value, 'No editable value.'), 'a container has no value editor');

		const none = compileInspector(html, rows, undefined);
		none.run();
		assert.ok(
			descendants(none.node).some((child) => child.className === 'inspector-empty'),
			'no selection keeps the details hint'
		);
		assert.ok(hasEmptyLine(none.value, 'Select a line to see its value.'));
		assert.ok(hasEmptyLine(none.reference, 'Select a line to see its reference.'));
		assert.ok(hasEmptyLine(none.conditions, 'Select a line to see its conditions and annotations.'));
	});

	test('section keyboard and collapse update the pane heights and state', () => {
		const html = page();
		const state: SidebarUiState = { tab: 'details', sidebarWidth: 360, panes: {}, collapsed: [] };
		const fixture = paneFixture(600);
		const View = compilePaneView(html, state);
		const view = new View(fixture.root);
		const [first, second] = fixture.sections;

		assert.strictEqual(first.style.values.get('--sb-pane-h'), '297px', 'fresh panes split the pool');
		assert.strictEqual(second.style.values.get('--sb-pane-h'), '297px');

		first.head.handlers.keydown({ key: 'ArrowLeft', target: first.head, preventDefault: () => undefined });
		assert.strictEqual(view.isCollapsed('sb-details-node'), true);
		assert.strictEqual(first.head.attrs['aria-expanded'], 'false');
		assert.strictEqual(first.style.values.get('--sb-pane-h'), '22px', 'a collapsed pane keeps its header');
		assert.strictEqual(second.style.values.get('--sb-pane-h'), '572px', 'the single expanded pane fills');
		assert.deepStrictEqual(state.collapsed, ['sb-details-node'], 'the collapsed section is persisted');
		assert.strictEqual(fixture.sash.tabIndex, -1, 'the adjacent sash leaves the tab order');
		assert.strictEqual(fixture.sash.attrs['aria-disabled'], 'true');
		assert.ok(fixture.sash.classList.contains('disabled'));

		first.head.handlers.keydown({ key: 'ArrowRight', target: first.head, preventDefault: () => undefined });
		assert.strictEqual(view.isCollapsed('sb-details-node'), false);
		assert.strictEqual(first.head.attrs['aria-expanded'], 'true');
		assert.strictEqual(first.style.values.get('--sb-pane-h'), '297px');
		assert.deepStrictEqual(state.collapsed, []);
		assert.strictEqual(fixture.sash.tabIndex, 0, 'the expanding pair re-enables the sash');
		assert.strictEqual(fixture.sash.attrs['aria-disabled'], undefined);

		first.head.handlers.keydown({ key: 'Enter', target: first.head, preventDefault: () => undefined });
		assert.strictEqual(view.isCollapsed('sb-details-node'), true);
		first.head.handlers.keydown({ key: ' ', target: first.head, preventDefault: () => undefined });
		assert.strictEqual(view.isCollapsed('sb-details-node'), false);

		view.setCollapsed('sb-details-value', true, true);
		assert.strictEqual(view.showSection('sb-details-value'), true, 'the view owns its section');
		assert.strictEqual(view.isCollapsed('sb-details-value'), false, 'focusing a field expands its section');
		assert.strictEqual(view.showSection('sb-conditions-values'), false, 'another view owns that section');

		const details = functionSource(page(), 'beginDetailsEdit');
		assert.ok(details.includes("showSidebarSection(target === 'value' ? 'sb-details-value' : 'sb-details-node')"));
		assert.ok(details.includes('showSidebarTab'));
	});

	test('sash drag sizing, keyboard steps and reset obey MIN_PANE', () => {
		const html = page();
		const state: SidebarUiState = { tab: 'details', sidebarWidth: 360, panes: {}, collapsed: [] };
		const fixture = paneFixture(600);
		const View = compilePaneView(html, state);
		const view = new View(fixture.root);

		assert.strictEqual(SASH_STEP, 10, 'one keyboard step is 10px');
		fixture.sash.handlers.keydown({ key: 'ArrowUp', preventDefault: () => undefined });
		assert.strictEqual(fixture.sections[0].style.values.get('--sb-pane-h'), '287px', 'ArrowUp moves the sash up');
		assert.strictEqual(fixture.sections[1].style.values.get('--sb-pane-h'), '307px');
		assert.deepStrictEqual(state.panes, {
			'sb-details-node': 287,
			'sb-details-value': 307,
		});

		fixture.sash.handlers.keydown({ key: 'ArrowDown', preventDefault: () => undefined });
		assert.strictEqual(fixture.sections[0].style.values.get('--sb-pane-h'), '297px');

		view.shiftPane('sb-details-node', 'sb-details-value', -1000);
		assert.strictEqual(fixture.sections[0].style.values.get('--sb-pane-h'), `${MIN_PANE}px`, 'a pane never shrinks below MIN_PANE');
		assert.strictEqual(fixture.sections[1].style.values.get('--sb-pane-h'), '512px');

		fixture.sash.handlers.dblclick({});
		assert.strictEqual(fixture.sections[0].style.values.get('--sb-pane-h'), '297px', 'double-click splits the pair');
		assert.strictEqual(fixture.sections[1].style.values.get('--sb-pane-h'), '297px');
		assert.deepStrictEqual(state.panes, {
			'sb-details-node': 297,
			'sb-details-value': 297,
		});
	});

	test('a saved pane height and collapsed section are restored on mount', () => {
		const html = page();
		const state: SidebarUiState = {
			tab: 'details',
			sidebarWidth: 420,
			panes: { 'sb-details-node': 150 },
			collapsed: ['sb-details-reference'],
		};
		const fixture = paneFixture(600);
		const View = compilePaneView(html, state);
		const view = new View(fixture.root);
		assert.strictEqual(view.isCollapsed('sb-details-node'), false);
		assert.strictEqual(fixture.sections[1].head.attrs['aria-expanded'], 'true');
		assert.strictEqual(fixture.sections[0].style.values.get('--sb-pane-h'), '150px', 'the saved size is claimed first');
		assert.strictEqual(fixture.sections[1].style.values.get('--sb-pane-h'), '444px', 'the fresh pane takes the rest');
	});

	test('the shared button and field primitives use theme tokens', () => {
		const html = page();
		const style = styleOf(html);
		for (const selector of ['.sb-btn', '.sb-btn-primary', '.sb-btn-secondary', '.sb-btn-add', '.sb-btn-danger']) {
			assert.ok(style.includes(selector), selector);
		}
		assert.ok(/\.sb-btn\s*\{[^}]*border-radius:\s*3px/.test(style));
		assert.ok(/\.sb-btn\s*\{[^}]*font-size:\s*10px/.test(style));
		assert.ok(/\.sb-btn\s*\{[^}]*font-weight:\s*600/.test(style));
		assert.ok(/\.sb-btn\s*\{[^}]*padding:\s*2px 8px/.test(style));
		assert.ok(/\.sb-btn-primary\s*\{[^}]*--vscode-button-background[^}]*--vscode-button-foreground/.test(style));
		assert.ok(/\.sb-btn-secondary\s*\{[^}]*--vscode-panel-border/.test(style));
		assert.ok(/\.sb-btn-add\s*\{[^}]*border:\s*1px dashed/.test(style));
		assert.ok(/\.sb-btn-danger\s*\{[^}]*--vscode-errorForeground/.test(style));
		assert.ok(/\.sb-btn:disabled\s*\{[^}]*opacity:\s*0\.35[^}]*cursor:\s*not-allowed/.test(style));
		assert.ok(/\.nav-btn\s*\{[^}]*width:\s*28px[^}]*height:\s*28px/.test(style));
		assert.ok(/\.act-btn\s*\{[^}]*width:\s*18px[^}]*height:\s*18px[^}]*opacity:\s*0/.test(style));
		assert.ok(/\.parent:hover \.act-btn/.test(style), 'row actions appear on row hover');

		assert.ok(/\.filter,\s*\.search-input\s*\{[^}]*height:\s*26px/.test(style), 'the shared field is 26px');
		assert.ok(/\.filter,\s*\.search-input\s*\{[^}]*--vscode-input-background/.test(style));
		assert.ok(/\.filter,\s*\.search-input\s*\{[^}]*--vscode-input-border/.test(style));
		assert.ok(/input\[type="search"\]::-webkit-search-cancel-button/.test(style), 'native search cancel stays suppressed');
		assert.ok(
			/\.filter-clear(?:,\s*\.search-clear)?\s*\{[^}]*position:\s*absolute/.test(style),
			'the custom clear X remains'
		);
		assert.ok(/id="filter-clear"/.test(html));
	});

	test('the editor actions use the shared classes and the old toggles are gone', () => {
		const html = page();
		assert.ok(/id="empty-clear" class="sb-btn sb-btn-secondary"/.test(html));
		assert.ok(/id="collapse-all" class="sb-btn sb-btn-secondary/.test(html));
		assert.ok(/id="expand-all" class="sb-btn sb-btn-secondary/.test(html));
		assert.ok(html.includes('class="filter"'), 'the filter uses the shared field rule');
		const update = functionSource(html, 'updateInspector');
		assert.ok(update.includes("'sb-btn sb-btn-secondary'"), 'Jump/Reveal use the shared secondary button');
		assert.ok(update.includes("'Jump to target'"));
		assert.ok(update.includes("'Reveal in source'"));
		assert.ok(!html.includes('id="conditions-toggle"'));
		assert.ok(!html.includes('id="details-toggle"'));
	});

	test('the serialized shell is self-contained', () => {
		const html = page();
		const shellAt = html.indexOf('const HEADER_H = 22;');
		const treeAt = html.indexOf('const main = document.getElementById');
		assert.ok(shellAt >= 0 && treeAt > shellAt, 'the shell script is emitted before the page script');
		const shell = html.slice(shellAt, treeAt);
		assert.ok(!shell.includes('exports.'), 'no CommonJS module-object reference leaks into the page');
		assert.ok(!shell.includes('require('), 'the page never requires a module');
		assert.ok(shell.includes(`const MIN_PANE = ${MIN_PANE};`));
		assert.ok(shell.includes(`const SASH_H = ${SASH_H};`));
		assert.ok(/function mountSidebarShell\(/.test(shell));
	});

	test('the pane layout survives a re-scan', () => {
		const html = page();
		const setRows = functionSource(html, 'setRows');
		assert.ok(!setRows.includes('uiState'), 'a re-scan never writes the layout state');
		assert.ok(!setRows.includes('mountSidebarShell'), 'the shell is not re-bound');
		assert.ok(!setRows.includes('sidebarPaneViews'));
		const boot = /^mountSidebarShell\(\);$/m.exec(html);
		assert.ok(boot, 'the shell mounts at boot (not only in a comment)');
		assert.strictEqual((html.match(/^mountSidebarShell\(\);$/gm) ?? []).length, 1, 'it mounts exactly once');
		const stateAt = html.indexOf('let uiState = loadUiState(savedState);');
		assert.ok(stateAt >= 0 && boot.index > stateAt, 'the boot call runs after the layout state exists');
		assert.ok(html.includes('uiState.panes'), 'pane heights are part of the persisted state');
		assert.ok(html.includes('uiState.collapsed'), 'collapsed sections are part of the persisted state');
	});

	test('a narrow-layout sidebar height change re-runs the virtual window', () => {
		const html = page();
		const at = html.indexOf('sidebarViewportObserver = new ResizeObserver');
		assert.ok(at >= 0, 'the page observes the sidebar (structural: the real DOM round trip needs the host)');
		const end = html.indexOf('sidebarViewportObserver.observe(sidebarPanel)', at);
		assert.ok(end > at, 'it observes the sidebar, not #main (no scrollbar loop)');
		const observer = html.slice(at, end);
		assert.ok(observer.includes('height === sidebarViewportHeight'), 'a width-only change does not re-render');
		assert.ok(observer.includes('renderWindow(true)'), 'a height change refreshes the row window');
		assert.ok(
			html.indexOf("const sidebarPanel = document.getElementById('sidebar')") < at,
			'it runs in the page script after #sidebar exists'
		);
	});
});
