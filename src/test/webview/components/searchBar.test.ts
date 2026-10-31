/**
 * SearchBar component: markup, fixed feedback slots, key behaviour and the
 * root-scoped prefix that lets the editor and the diff coexist.
 */
import * as assert from 'assert';

import {
	SearchBar,
	renderSearchBarHtml,
	searchBarScript,
} from '../../../webview/components/searchBar/searchBar';

interface FakeElement {
	value?: string;
	hidden?: boolean;
	disabled?: boolean;
	textContent?: string;
	dataset: Record<string, string>;
	focusOptions: unknown[];
	listeners: Record<string, (event: unknown) => void>;
	addEventListener(type: string, listener: (event: unknown) => void): void;
	focus(options?: unknown): void;
	select?(): void;
}

function fakeElement(): FakeElement {
	return {
		dataset: {},
		focusOptions: [],
		listeners: {},
		addEventListener(type: string, listener: (event: unknown) => void) {
			this.listeners[type] = listener;
		},
		focus(options?: unknown) {
			this.focusOptions.push(options);
		},
		select() {},
	};
}

function withDocument<T>(elements: Record<string, FakeElement>, run: () => T): T {
	const globals = globalThis as unknown as { document?: unknown };
	const saved = globals.document;
	globals.document = { getElementById: (id: string) => elements[id] };
	try {
		return run();
	} finally {
		globals.document = saved;
	}
}

suite('SearchBar component', () => {
	test('the editor and diff instances get distinct, stable ids', () => {
		const editor = renderSearchBarHtml('', 'Search the ECUC tree');
		const diff = renderSearchBarHtml('diff-', 'Search the diff');
		assert.ok(/id="search-input"[^>]*class="search-input"[^>]*type="search"/.test(editor));
		assert.ok(/id="diff-search-input"[^>]*aria-label="Search the diff"/.test(diff));
		assert.ok(editor.includes('id="search-clear"') && diff.includes('id="diff-search-clear"'));
		assert.ok(/id="search-count"[^>]*role="status"[^>]*aria-live="polite"/.test(editor));
		assert.ok(/id="search-busy"[^>]*data-busy="false"/.test(editor));
		assert.strictEqual((editor.match(/<input\b/g) ?? []).length, 1, 'one query control');
		assert.ok(!/style="/.test(editor), 'no inline styles');
	});

	test('feedback setters keep the count and busy slots in the flow', () => {
		const count = fakeElement();
		const busy = fakeElement();
		const clear = fakeElement();
		const prev = fakeElement();
		const next = fakeElement();
		const elements = {
			'search-count': count,
			'search-busy': busy,
			'search-clear': clear,
			'search-prev': prev,
			'search-next': next,
		};
		withDocument(elements, () => {
			const bar = new SearchBar('');
			bar.setCount('1 / 3');
			bar.setBusy(true);
			bar.setClearVisible(false);
			bar.setNavigationEnabled(false);
		});
		assert.strictEqual(count.textContent, '1 / 3');
		assert.strictEqual(busy.dataset.busy, 'true');
		assert.strictEqual(clear.hidden, true);
		assert.strictEqual(prev.disabled, true);
		assert.strictEqual(next.disabled, true);
	});

	test('Enter, Shift+Enter, Escape and the nav buttons report through callbacks', () => {
		const input = fakeElement();
		const clear = fakeElement();
		const prev = fakeElement();
		const next = fakeElement();
		const elements = {
			'search-input': input,
			'search-clear': clear,
			'search-prev': prev,
			'search-next': next,
		};
		const calls: string[] = [];
		withDocument(elements, () => {
			const bar = new SearchBar('', {
				onExecute: (direction) => calls.push(`execute:${direction}`),
				onCycle: (direction) => calls.push(`cycle:${direction}`),
				onClear: () => calls.push('clear'),
				onEscape: () => calls.push('escape'),
				onInput: (value) => calls.push(`input:${value}`),
			});
			bar.mount();
			bar.mount();
			input.value = 'alp';
			input.listeners.input({});
			input.listeners.keydown({ key: 'Enter', shiftKey: false, preventDefault() {} });
			input.listeners.keydown({ key: 'Enter', shiftKey: true, preventDefault() {} });
			input.listeners.keydown({ key: 'Escape', preventDefault() {} });
			clear.listeners.click({});
			prev.listeners.click({});
			next.listeners.click({});
			assert.deepStrictEqual(input.focusOptions, [{ preventScroll: true }], 'Escape refocuses the field');
			assert.ok(input.value === '');
		});
		assert.deepStrictEqual(calls, [
			'input:alp',
			'execute:1',
			'execute:-1',
			'escape',
			'clear',
			'cycle:-1',
			'cycle:1',
		]);
	});

	test('the serialized class is self-contained and owns the keys', () => {
		const script = searchBarScript();
		assert.ok(script.includes('const SearchBar = ('));
		for (const name of ['mount()', 'setCount(text)', 'setBusy(busy)', 'setNavigationEnabled(enabled)', 'focus()']) {
			assert.ok(script.includes(name), `${name} is part of the contract`);
		}
		assert.ok(script.includes("input.addEventListener('keydown'"));
		assert.ok(!script.includes('vscode'), 'the component never posts provider messages');
		assert.ok(!script.includes('searchEngine'), 'the component never owns the search engine');
	});
});
