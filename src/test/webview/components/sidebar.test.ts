/**
 * The right sidebar shell: tab strip, sidebar width, section panes and the
 * shared button/field primitives. Pure allocation is asserted directly; the
 * interactive shell is mounted into jsdom from the same static markup the host
 * writes.
 */
import * as assert from 'assert';

import { editorShell } from '../../../host/webviewShell';
import {
	DEFAULT_SIDEBAR_WIDTH,
	HEADER_H,
	MAX_SIDEBAR_WIDTH,
	MIN_PANE,
	MIN_SIDEBAR_WIDTH,
	PaneSpec,
	SASH_H,
	SASH_STEP,
	SidebarPaneView,
	SidebarUiState,
	activateSidebarTab,
	allocatePanes,
	clampSidebarWidth,
	getSidebarState,
	loadUiState,
	mountSidebarShell,
	setSidebarPersistence,
	setSidebarState,
	setSidebarHidden,
} from '../../../webview/components/sidebar/sidebar';
import { webviewCss } from '../cssTestUtils';
import { installDom, installMarkup } from '../pageTestUtils';

function page(): string {
	return editorShell({
		cspSource: 'https://webview.test',
		scriptUri: 'https://webview.test/editorViewer.js',
		styleUri: 'https://webview.test/editorViewer.css',
		nonce: 'test-nonce',
	});
}

function spec(id: string, saved: number | null = null, user = false, collapsed = false): PaneSpec {
	return { id, saved, user, collapsed };
}

function allowResizerLayout(window: any): void {
	Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
		configurable: true,
		get(this: any) {
			return this.parentElement;
		},
	});
}

function paneMarkup(collapsed: string[] = []): string {
	const section = (id: string) => `<section class="sb-section sb-pane" id="${id}" data-pane-id="${id}">
<div class="sb-section-head" role="button" tabindex="0" aria-expanded="true" aria-controls="${id}-body"><span class="sb-section-chevron"></span><h3 class="sb-section-title">${id}</h3></div>
<div class="sb-body" id="${id}-body"></div>
</section>`;
	return `<div class="sb-pane-view" id="pane-view" data-test-client-height="600">
${section('pane-a')}
<div class="sb-pane-sash" role="separator" tabindex="0"></div>
${section('pane-b')}
</div>`;
}

function state(overrides: Partial<SidebarUiState> = {}): SidebarUiState {
	return { tab: 'details', sidebarWidth: 360, panes: {}, collapsed: [], hidden: false, ...overrides };
}

suite('sidebar shell', () => {
	test('clampSidebarWidth keeps the width between 260 and 900px', () => {
		assert.strictEqual(MIN_SIDEBAR_WIDTH, 260);
		assert.strictEqual(MAX_SIDEBAR_WIDTH, 900);
		assert.strictEqual(DEFAULT_SIDEBAR_WIDTH, 360);
		assert.strictEqual(clampSidebarWidth(100, 1600, 28), 260, 'the minimum');
		assert.strictEqual(clampSidebarWidth(1200, 1600, 28), 900, 'the maximum');
		assert.strictEqual(clampSidebarWidth(420, 1600, 28), 420);
		assert.strictEqual(clampSidebarWidth(700, 700, 28), 452, 'the window keeps a tree gutter');
		assert.strictEqual(clampSidebarWidth(900, 1000, 28), 752, 'the sidebar cannot cover the tree');
		assert.strictEqual(clampSidebarWidth(Number.NaN, 1600, 28), 260, 'an invalid width falls back');
		assert.strictEqual(clampSidebarWidth(420.6, 1600, 28), 421, 'a width is a whole pixel');
	});

	test('loadUiState validates the persisted shape', () => {
		assert.deepStrictEqual(loadUiState(undefined), state({ sidebarWidth: 360 }));
		assert.deepStrictEqual(loadUiState({ tab: 'conditions', sidebarWidth: 500, panes: { a: 120 }, collapsed: ['x'] }), {
			tab: 'conditions',
			sidebarWidth: 500,
			panes: { a: 120 },
			collapsed: ['x'],
			hidden: false,
		});
		assert.deepStrictEqual(loadUiState({ tab: 'nope', sidebarWidth: 'wide', panes: [], collapsed: [1, 'x'] }), {
			tab: 'details',
			sidebarWidth: 360,
			panes: {},
			collapsed: ['x'],
			hidden: false,
		});
		assert.strictEqual(loadUiState({ hidden: true }).hidden, true);
		assert.strictEqual(loadUiState({ hidden: 'yes' }).hidden, false);
	});

	test('allocatePanes fills a lone pane, splits fresh panes and honours saved sizes', () => {
		assert.strictEqual(HEADER_H, 22);
		assert.strictEqual(SASH_H, 6);
		assert.strictEqual(MIN_PANE, 82, 'the min pane is HEADER_H + 60');
		assert.deepStrictEqual([...allocatePanes(480, [spec('a')])], [['a', 480]]);
		assert.deepStrictEqual([...allocatePanes(480, [spec('a'), spec('b')])], [
			['a', 240],
			['b', 240],
		]);
		assert.deepStrictEqual([...allocatePanes(480, [spec('a', 300, true), spec('b')])], [
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
	});

	test('allocatePanes skips collapsed panes and absorbs rounding in the last one', () => {
		assert.deepStrictEqual([...allocatePanes(480, [spec('a'), spec('b', null, false, true)])], [['a', 480]]);
		const odd = allocatePanes(481, [spec('a'), spec('b'), spec('c')]);
		assert.deepStrictEqual([...odd], [
			['a', 160],
			['b', 160],
			['c', 161],
		]);
		assert.strictEqual([...odd.values()].reduce((sum, px) => sum + px, 0), 481, 'the sum is exact');
		const underfilled = allocatePanes(594, [spec('a', 150, true), spec('b', 400, true)]);
		assert.deepStrictEqual([...underfilled], [
			['a', 162],
			['b', 432],
		], 'all-saved sizes scale up to fill the pool');
	});

	test('the shell markup has the tab strip, panels, sections and no sashes', () => {
		const html = page();
		assert.ok(/id="sidebar-resizer"[^>]*role="separator"[^>]*aria-orientation="vertical"[^>]*tabindex="0"/.test(html));
		assert.ok(/id="side-tabs"[^>]*role="tablist"[^>]*aria-orientation="vertical"/.test(html));
		assert.ok(/id="stab-details"[^>]*role="tab"[^>]*aria-selected="true"[^>]*aria-controls="sbp-details"/.test(html));
		assert.ok(/id="stab-conditions"[^>]*role="tab"[^>]*aria-selected="false"[^>]*aria-controls="sbp-conditions"/.test(html));
		assert.ok(/id="sbp-details"[^>]*role="tabpanel"[^>]*aria-labelledby="stab-details"/.test(html));
		assert.ok(!/id="sbp-details"[^>]*\shidden/.test(html), 'the default Details panel is visible');
		assert.ok(/id="sbp-conditions"[^>]*role="tabpanel"[^>]*aria-labelledby="stab-conditions"[^>]*hidden/.test(html));
		for (const id of ['sb-details', 'sb-conditions-values']) {
			assert.ok(html.includes(`id="${id}" data-pane-id="${id}"`), `${id} is a pane`);
			assert.ok(html.includes(`id="${id}-body" role="region"`), `${id} has a region body`);
		}
		assert.ok(!/class="sb-pane-sash"/.test(html), 'there are no pane sashes');
		assert.equal((html.match(/class="sb-section-head" role="button"/g) ?? []).length, 2);
		const resizerAt = html.indexOf('id="sidebar-resizer"');
		const sidebarAt = html.indexOf('id="sidebar"');
		const tabsAt = html.indexOf('id="side-tabs"');
		assert.ok(resizerAt < sidebarAt && sidebarAt < tabsAt, 'resizer, panel and right-edge tab strip in order');
	});

	test('tab activation shows one panel and persists the change', () => {
		const dom = installDom('editor');
		try {
			let persisted = 0;
			setSidebarState(state());
			setSidebarPersistence(() => persisted++);
			const details = dom.document.getElementById('stab-details');
			const conditions = dom.document.getElementById('stab-conditions');
			activateSidebarTab('conditions', true);
			assert.strictEqual(persisted, 1);
			assert.strictEqual(details.getAttribute('aria-selected'), 'false');
			assert.strictEqual(details.tabIndex, -1);
			assert.strictEqual(conditions.getAttribute('aria-selected'), 'true');
			assert.strictEqual(dom.document.activeElement, conditions, 'focus follows the key that moved the tab');
			assert.ok(dom.document.getElementById('sbp-conditions').classList.contains('active'));
			assert.strictEqual(dom.document.getElementById('sbp-conditions').hidden, false);
			assert.strictEqual(dom.document.getElementById('sbp-details').hidden, true);
			activateSidebarTab('details', false);
			assert.strictEqual(persisted, 2);
			assert.strictEqual(dom.document.getElementById('sbp-details').hidden, false);
		} finally {
			dom.restore();
		}
	});

	test('the sidebar resizer drags, steps and clamps the width', () => {
		const dom = installDom('editor');
		try {
			allowResizerLayout(dom.window);
			dom.window.innerWidth = 1600;
			(dom.document.getElementById('side-tabs') as any).dataset.testClientWidth = '28';
			setSidebarState(state({ sidebarWidth: 420 }));
			setSidebarPersistence(() => {
				dom.api.state = getSidebarState();
			});
			mountSidebarShell();
			const sidebar = dom.document.getElementById('sidebar') as any;
			assert.strictEqual(sidebar.style.getPropertyValue('--sidebar-w'), '420px');

			const resizer = dom.document.getElementById('sidebar-resizer') as HTMLElement;
			resizer.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }));
			assert.strictEqual(sidebar.style.getPropertyValue('--sidebar-w'), '436px', 'ArrowLeft widens');
			resizer.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
			assert.strictEqual(sidebar.style.getPropertyValue('--sidebar-w'), '420px');

			resizer.dispatchEvent(new dom.window.MouseEvent('mousedown', { button: 0, clientX: 1000, cancelable: true }));
			dom.window.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientX: 960 }));
			assert.strictEqual(sidebar.style.getPropertyValue('--sidebar-w'), '460px', 'dragging left widens');
			dom.window.dispatchEvent(new dom.window.MouseEvent('mouseup'));
			assert.strictEqual((dom.api.state as SidebarUiState).sidebarWidth, 460, 'release persists');

			dom.window.innerWidth = 700;
			dom.window.dispatchEvent(new dom.window.Event('resize'));
			assert.strictEqual(sidebar.style.getPropertyValue('--sidebar-w'), '452px', 'a narrow window clamps the display width');
			assert.strictEqual((dom.api.state as SidebarUiState).sidebarWidth, 460, 'the preference survives the clamp');
		} finally {
			dom.restore();
		}
	});

	test('section keyboard and collapse update the pane heights and state', () => {
		const dom = installMarkup(`<body>${paneMarkup()}</body>`);
		try {
			const ui = state();
			setSidebarState(ui);
			setSidebarPersistence(() => undefined);
			const root = dom.document.getElementById('pane-view');
			const view = new SidebarPaneView(root);
			const first = dom.document.getElementById('pane-a');
			const second = dom.document.getElementById('pane-b');
			const sash = dom.document.querySelector('.sb-pane-sash') as HTMLElement;
			assert.strictEqual(first.style.getPropertyValue('--sb-pane-h'), '297px', 'fresh panes split the pool');
			assert.strictEqual(second.style.getPropertyValue('--sb-pane-h'), '297px');

			first.querySelector('.sb-section-head')!.dispatchEvent(
				new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
			);
			assert.strictEqual(view.isCollapsed('pane-a'), true);
			assert.strictEqual(first.querySelector('.sb-section-head')!.getAttribute('aria-expanded'), 'false');
			assert.strictEqual(first.style.getPropertyValue('--sb-pane-h'), '22px', 'a collapsed pane keeps its header');
			assert.strictEqual(second.style.getPropertyValue('--sb-pane-h'), '572px', 'the single expanded pane fills');
			assert.deepStrictEqual(getSidebarState().collapsed, ['pane-a']);
			assert.strictEqual(sash.tabIndex, -1, 'the adjacent sash leaves the tab order');
			assert.strictEqual(sash.getAttribute('aria-disabled'), 'true');

			first.querySelector('.sb-section-head')!.dispatchEvent(
				new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
			);
			assert.strictEqual(view.isCollapsed('pane-a'), false);
			assert.strictEqual(first.style.getPropertyValue('--sb-pane-h'), '297px');
			assert.deepStrictEqual(getSidebarState().collapsed, []);
			assert.strictEqual(sash.tabIndex, 0);

			view.setCollapsed('pane-b', true, true);
			assert.strictEqual(view.showSection('pane-b'), true, 'the view owns its section');
			assert.strictEqual(view.isCollapsed('pane-b'), false, 'focusing a field expands its section');
			assert.strictEqual(view.showSection('sb-conditions-values'), false, 'another view owns that section');
		} finally {
			dom.restore();
		}
	});

	test('sash drag sizing, keyboard steps and reset obey MIN_PANE', () => {
		const dom = installMarkup(`<body>${paneMarkup()}</body>`);
		try {
			const ui = state();
			setSidebarState(ui);
			setSidebarPersistence(() => undefined);
			const root = dom.document.getElementById('pane-view');
			const view = new SidebarPaneView(root);
			const first = dom.document.getElementById('pane-a');
			const second = dom.document.getElementById('pane-b');
			const sash = dom.document.querySelector('.sb-pane-sash') as HTMLElement;

			assert.strictEqual(SASH_STEP, 10);
			sash.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
			assert.strictEqual(first.style.getPropertyValue('--sb-pane-h'), '287px', 'ArrowUp moves the sash up');
			assert.strictEqual(second.style.getPropertyValue('--sb-pane-h'), '307px');
			assert.deepStrictEqual(getSidebarState().panes, { 'pane-a': 287, 'pane-b': 307 });

			sash.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
			assert.strictEqual(first.style.getPropertyValue('--sb-pane-h'), '297px');

			view.shiftPane('pane-a', 'pane-b', -1000);
			assert.strictEqual(first.style.getPropertyValue('--sb-pane-h'), `${MIN_PANE}px`);
			assert.strictEqual(second.style.getPropertyValue('--sb-pane-h'), '512px');

			sash.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
			assert.strictEqual(first.style.getPropertyValue('--sb-pane-h'), '297px', 'double-click splits the pair');
			assert.strictEqual(second.style.getPropertyValue('--sb-pane-h'), '297px');
			assert.deepStrictEqual(getSidebarState().panes, { 'pane-a': 297, 'pane-b': 297 });
		} finally {
			dom.restore();
		}
	});

	test('a saved pane height is restored on mount', () => {
		const dom = installMarkup(`<body>${paneMarkup()}</body>`);
		try {
			const ui = state({ panes: { 'pane-a': 150 } });
			setSidebarState(ui);
			setSidebarPersistence(() => undefined);
			const view = new SidebarPaneView(dom.document.getElementById('pane-view'));
			assert.strictEqual(view.isCollapsed('pane-a'), false);
			const first = dom.document.getElementById('pane-a');
			const second = dom.document.getElementById('pane-b');
			assert.strictEqual(first.style.getPropertyValue('--sb-pane-h'), '150px', 'the saved size is claimed first');
			assert.strictEqual(second.style.getPropertyValue('--sb-pane-h'), '444px', 'the fresh pane takes the rest');
		} finally {
			dom.restore();
		}
	});

	test('the shared button and field primitives use theme tokens', () => {
		const style = webviewCss('components', 'sidebar', 'sidebar.css') + webviewCss('components', 'searchBar', 'searchBar.css');
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
		assert.ok(/\.search-input\s*\{[^}]*height:\s*26px/.test(style));
		assert.ok(/\.search-input\s*\{[^}]*--vscode-input-background/.test(style));
		assert.ok(/\.search-input\s*\{[^}]*--vscode-input-border/.test(style));
		assert.ok(/input\[type="search"\]::-webkit-search-cancel-button/.test(style));
		assert.ok(/\.search-clear\s*\{[^}]*position:\s*absolute/.test(style));
	});

	test('loadUiState rejects invalid shapes and clamps every field', () => {
		for (const saved of [null, 'state', 42, [], true]) {
			assert.deepStrictEqual(loadUiState(saved), state({ sidebarWidth: 360 }));
		}
		assert.strictEqual(loadUiState({ sidebarWidth: 100 }).sidebarWidth, 260);
		assert.strictEqual(loadUiState({ sidebarWidth: 5000 }).sidebarWidth, 900);
		assert.strictEqual(loadUiState({ sidebarWidth: 420.6 }).sidebarWidth, 421);
		assert.strictEqual(loadUiState({ sidebarWidth: Number.NaN }).sidebarWidth, 360);
		assert.strictEqual(loadUiState({ sidebarWidth: Number.POSITIVE_INFINITY }).sidebarWidth, 360);
		assert.deepStrictEqual(loadUiState({ panes: [] }).panes, {});
		assert.deepStrictEqual(loadUiState({ panes: null }).panes, {});
		assert.deepStrictEqual(loadUiState({ panes: { a: 100, b: 0, c: -1, d: 'x', e: Infinity, f: NaN } }).panes, {
			a: 100,
		});
		assert.deepStrictEqual(loadUiState({ collapsed: ['x', 1, null, {}] }).collapsed, ['x']);
		assert.strictEqual(loadUiState({ tab: 'conditions' }).tab, 'conditions');
	});

	test('tab keyboard navigation wraps, honours Home/End and ignores other keys', () => {
		const dom = installDom('editor');
		try {
			let persisted = 0;
			setSidebarState(state());
			setSidebarPersistence(() => persisted++);
			mountSidebarShell();
			const details = dom.document.getElementById('stab-details') as HTMLElement;
			const conditions = dom.document.getElementById('stab-conditions') as HTMLElement;
			const press = (button: HTMLElement, key: string): KeyboardEvent => {
				const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
				button.dispatchEvent(event);
				return event;
			};
			assert.strictEqual(details.getAttribute('aria-selected'), 'true');
			assert.strictEqual(details.tabIndex, 0);
			assert.strictEqual(conditions.tabIndex, -1);

			details.focus();
			assert.strictEqual(press(details, 'ArrowDown').defaultPrevented, true);
			assert.strictEqual(persisted, 1);
			assert.strictEqual(conditions.getAttribute('aria-selected'), 'true');
			assert.strictEqual(dom.document.activeElement, conditions);

			press(conditions, 'ArrowDown');
			assert.strictEqual(persisted, 2, 'ArrowDown wraps to the first tab');
			assert.strictEqual(dom.document.activeElement, details);

			press(details, 'ArrowUp');
			assert.strictEqual(persisted, 3, 'ArrowUp wraps to the last tab');
			assert.strictEqual(dom.document.activeElement, conditions);

			press(conditions, 'ArrowRight');
			assert.strictEqual(persisted, 4);
			assert.strictEqual(dom.document.activeElement, details);

			const home = press(details, 'Home');
			assert.strictEqual(home.defaultPrevented, true);
			assert.strictEqual(persisted, 4, 'activating the current tab does not persist');
			assert.strictEqual(dom.document.activeElement, details);

			press(details, 'End');
			assert.strictEqual(persisted, 5);
			assert.strictEqual(dom.document.activeElement, conditions);

			const ignored = press(conditions, 'x');
			assert.strictEqual(ignored.defaultPrevented, false);
			assert.strictEqual(persisted, 5);
			assert.strictEqual(dom.document.activeElement, conditions);

			details.click();
			assert.strictEqual(persisted, 6, 'a tab click activates it');
			details.click();
			assert.strictEqual(persisted, 6, 'clicking the active tab is a no-op');
		} finally {
			dom.restore();
		}
	});

	test('section head click and keyboard ignore the actions and toggle on demand', () => {
		const dom = installMarkup(`<body>${paneMarkup()}</body>`);
		try {
			const snapshots: string[][] = [];
			setSidebarState(state());
			setSidebarPersistence(() => snapshots.push([...getSidebarState().collapsed]));
			const root = dom.document.getElementById('pane-view');
			const view = new SidebarPaneView(root);
			const head = root.querySelector('.sb-section-head') as HTMLElement;

			head.click();
			assert.strictEqual(view.isCollapsed('pane-a'), true);
			assert.strictEqual(head.getAttribute('aria-expanded'), 'false');
			assert.deepStrictEqual(snapshots, [['pane-a']]);
			head.click();
			assert.strictEqual(view.isCollapsed('pane-a'), false);
			assert.deepStrictEqual(snapshots, [['pane-a'], []]);

			const actions = dom.document.createElement('span');
			actions.className = 'sb-section-actions';
			head.appendChild(actions);
			actions.click();
			assert.strictEqual(view.isCollapsed('pane-a'), false, 'section actions do not toggle the pane');

			const enter = new dom.window.KeyboardEvent('keydown', {
				key: 'Enter',
				bubbles: true,
				cancelable: true,
			});
			head.dispatchEvent(enter);
			assert.strictEqual(enter.defaultPrevented, true);
			assert.strictEqual(view.isCollapsed('pane-a'), true);

			head.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
				key: ' ',
				bubbles: true,
				cancelable: true,
			}));
			assert.strictEqual(view.isCollapsed('pane-a'), false, 'Space toggles like Enter');

			head.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
				key: 'x',
				bubbles: true,
				cancelable: true,
			}));
			assert.strictEqual(view.isCollapsed('pane-a'), false, 'an unrelated key is ignored');

			actions.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
				key: 'ArrowLeft',
				bubbles: true,
				cancelable: true,
			}));
			assert.strictEqual(view.isCollapsed('pane-a'), false, 'a key from a child does not toggle');
		} finally {
			dom.restore();
		}
	});

	test('sash drag guards, commits once on release and ignores collapsed pairs', () => {
		const dom = installMarkup(`<body>${paneMarkup()}</body>`);
		try {
			const snapshots: Record<string, number>[] = [];
			setSidebarState(state());
			setSidebarPersistence(() => snapshots.push({ ...getSidebarState().panes }));
			const root = dom.document.getElementById('pane-view');
			const view = new SidebarPaneView(root);
			const first = dom.document.getElementById('pane-a');
			const second = dom.document.getElementById('pane-b');
			const sash = dom.document.querySelector('.sb-pane-sash') as HTMLElement;

			view.setCollapsed('pane-b', true, false);
			assert.strictEqual(first.style.getPropertyValue('--sb-pane-h'), '572px');
			sash.dispatchEvent(new dom.window.MouseEvent('mousedown', {
				button: 0,
				clientY: 300,
				bubbles: true,
				cancelable: true,
			}));
			assert.strictEqual(sash.classList.contains('dragging'), false, 'a collapsed neighbour cannot be dragged');
			sash.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
				key: 'ArrowUp',
				bubbles: true,
				cancelable: true,
			}));
			sash.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
			assert.strictEqual(first.style.getPropertyValue('--sb-pane-h'), '572px');
			assert.deepStrictEqual(snapshots, []);

			view.setCollapsed('pane-b', false, false);
			assert.strictEqual(first.style.getPropertyValue('--sb-pane-h'), '297px');
			sash.dispatchEvent(new dom.window.MouseEvent('mousedown', {
				button: 1,
				clientY: 300,
				bubbles: true,
				cancelable: true,
			}));
			assert.strictEqual(sash.classList.contains('dragging'), false, 'only the primary button drags');

			const down = new dom.window.MouseEvent('mousedown', {
				button: 0,
				clientY: 300,
				bubbles: true,
				cancelable: true,
			});
			sash.dispatchEvent(down);
			assert.strictEqual(down.defaultPrevented, true);
			assert.strictEqual(sash.classList.contains('dragging'), true);
			assert.strictEqual(root.classList.contains('dragging'), true);
			assert.strictEqual(dom.document.body.classList.contains('sb-row-resizing'), true);

			dom.window.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientY: 250 }));
			assert.strictEqual(first.style.getPropertyValue('--sb-pane-h'), '247px');
			assert.strictEqual(second.style.getPropertyValue('--sb-pane-h'), '347px');
			assert.deepStrictEqual(snapshots, [], 'a drag previews without persisting');

			dom.window.dispatchEvent(new dom.window.MouseEvent('mouseup'));
			assert.strictEqual(sash.classList.contains('dragging'), false);
			assert.strictEqual(root.classList.contains('dragging'), false);
			assert.strictEqual(dom.document.body.classList.contains('sb-row-resizing'), false);
			assert.deepStrictEqual(snapshots, [{ 'pane-a': 247, 'pane-b': 347 }]);

			sash.dispatchEvent(new dom.window.MouseEvent('mousedown', {
				button: 0,
				clientY: 300,
				bubbles: true,
				cancelable: true,
			}));
			dom.window.dispatchEvent(new dom.window.MouseEvent('mouseup'));
			assert.deepStrictEqual(snapshots, [{ 'pane-a': 247, 'pane-b': 347 }], 'a click without a move does not persist');
		} finally {
			dom.restore();
		}
	});

	test('a stacked layout leaves the saved sidebar width alone', () => {
		const dom = installDom('editor');
		try {
			Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', {
				configurable: true,
				get() {
					return null;
				},
			});
			dom.window.innerWidth = 1600;
			(dom.document.getElementById('side-tabs') as any).dataset.testClientWidth = '28';
			setSidebarState(state({ sidebarWidth: 460 }));
			setSidebarPersistence(() => undefined);
			mountSidebarShell();
			const sidebar = dom.document.getElementById('sidebar') as any;
			assert.strictEqual(sidebar.style.getPropertyValue('--sidebar-w'), '');
			assert.strictEqual(getSidebarState().sidebarWidth, 460);

			Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', {
				configurable: true,
				get(this: any) {
					return this.parentElement;
				},
			});
			dom.window.dispatchEvent(new dom.window.Event('resize'));
			assert.strictEqual(sidebar.style.getPropertyValue('--sidebar-w'), '460px');
		} finally {
			dom.restore();
		}
	});

	test('setSidebarHidden hides the shell and keeps the tab, width and panes', () => {
		const dom = installDom('editor');
		try {
			let persisted = 0;
			setSidebarState(state({ tab: 'conditions', sidebarWidth: 500, panes: { 'sb-details': 200 }, collapsed: ['x'] }));
			setSidebarPersistence(() => persisted++);
			mountSidebarShell();
			const tab = dom.document.getElementById('stab-conditions') as HTMLElement;
			tab.focus();
			setSidebarHidden(true);
			assert.ok(dom.document.body.classList.contains('sidebar-hidden'));
			assert.strictEqual(getSidebarState().hidden, true);
			assert.strictEqual(persisted, 1, 'a change is persisted');
			assert.strictEqual(dom.document.activeElement!.id, 'toggle-sidebar', 'focus leaves the hidden shell');
			for (const id of ['sidebar', 'sidebar-resizer', 'side-tabs']) {
				assert.strictEqual(dom.document.getElementById(id)!.hasAttribute('inert'), true, `${id} is inert`);
			}
			assert.deepStrictEqual(getSidebarState(), state({
				tab: 'conditions',
				sidebarWidth: 500,
				panes: { 'sb-details': 200 },
				collapsed: ['x'],
				hidden: true,
			}), 'only hidden changed');
			setSidebarHidden(false);
			assert.strictEqual(dom.document.body.classList.contains('sidebar-hidden'), false);
			assert.strictEqual(getSidebarState().hidden, false);
			assert.strictEqual(persisted, 2);
			for (const id of ['sidebar', 'sidebar-resizer', 'side-tabs']) {
				assert.strictEqual(dom.document.getElementById(id)!.hasAttribute('inert'), false, `${id} is interactive`);
			}
			assert.deepStrictEqual(getSidebarState(), state({
				tab: 'conditions',
				sidebarWidth: 500,
				panes: { 'sb-details': 200 },
				collapsed: ['x'],
			}), 'restoring keeps the prior layout');
			setSidebarHidden(false);
			assert.strictEqual(persisted, 2, 'an unchanged state is not persisted');
		} finally {
			dom.restore();
		}
	});

	test('the hidden layout hides the panel, resizer and tab strip', () => {
		const css = webviewCss('components', 'sidebar', 'sidebar.css');
		assert.ok(
			/body\.sidebar-hidden #sidebar,[\s\S]*?body\.sidebar-hidden #sidebar-resizer,[\s\S]*?body\.sidebar-hidden #side-tabs\s*\{[^}]*display:\s*none/.test(
				css
			),
			'the whole shell collapses to the Document width'
		);
	});

	test('mountSidebarShell does nothing without the shell elements', () => {
		const dom = installMarkup('<body></body>');
		try {
			setSidebarState(state({ sidebarWidth: 460 }));
			mountSidebarShell();
			assert.strictEqual(getSidebarState().sidebarWidth, 460);
		} finally {
			dom.restore();
		}
	});

	test('the editor actions use the shared classes and the old toggles are gone', () => {
		const html = page();
		assert.ok(/id="collapse-all" class="tool diff-tool"/.test(html));
		assert.ok(/id="expand-all" class="tool diff-tool"/.test(html));
		assert.ok(/id="toggle-sidebar" class="tool diff-tool"/.test(html));
		assert.ok(html.includes('class="search-input"'));
		assert.ok(!html.includes('id="conditions-toggle"'));
		assert.ok(!html.includes('id="details-toggle"'));
	});
});
