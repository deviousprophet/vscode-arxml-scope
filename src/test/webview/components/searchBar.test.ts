/**
 * SearchBar component: floating find widget markup, option toggles, replace row,
 * focus and the root-scoped prefix that lets the editor and the diff coexist.
 */
import * as assert from 'assert';

import { SearchBar, renderSearchBarHtml } from '../../../webview/components/searchBar/searchBar';

interface FakeElement {
	value?: string;
	hidden?: boolean;
	disabled?: boolean;
	textContent?: string;
	dataset: Record<string, string>;
	attributes: Record<string, string>;
	focusOptions: unknown[];
	listeners: Record<string, (event: unknown) => void>;
	addEventListener(type: string, listener: (event: unknown) => void): void;
	focus(options?: unknown): void;
	select?(): void;
	setAttribute(name: string, value: string): void;
	getAttribute(name: string): string | null;
	hasAttribute(name: string): boolean;
}

function fakeElement(): FakeElement {
	return {
		dataset: {},
		attributes: {},
		focusOptions: [],
		listeners: {},
		addEventListener(type: string, listener: (event: any) => void) {
			this.listeners[type] = listener;
		},
		focus(options?: unknown) {
			this.focusOptions.push(options);
		},
		select() {},
		setAttribute(name: string, value: string) {
			this.attributes[name] = value;
		},
		getAttribute(name: string): string | null {
			if (name === 'hidden') {
				return this.hidden ? '' : null;
			}
			return this.attributes[name] ?? null;
		},
		hasAttribute(name: string): boolean {
			return name === 'hidden' ? this.hidden === true : name in this.attributes;
		},
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
	test('the editor and diff instances get distinct ids and option controls', () => {
		const editor = renderSearchBarHtml('', 'Find in the ECUC tree', true);
		const diff = renderSearchBarHtml('diff-', 'Find in the diff', false);
		assert.ok(/id="find-widget"[^>]*class="find-widget"[^>]*hidden/.test(editor));
		assert.ok(/id="search-input"[^>]*class="search-input field-input"[^>]*type="search"/.test(editor));
		assert.ok(/id="diff-search-input"[^>]*aria-label="Find in the diff"/.test(diff));
		assert.ok(editor.includes('id="search-match-case"') && editor.includes('id="search-whole-word"'));
		assert.ok(editor.includes('id="search-regex"') && editor.includes('id="search-replace-row"'));
		assert.ok(!diff.includes('id="diff-search-replace-row"'), 'the diff has no replace row');
		assert.ok(editor.includes('id="search-close"') && diff.includes('id="diff-search-close"'));
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
			'search-next': next
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
			'search-next': next
		};
		const calls: string[] = [];
		withDocument(elements, () => {
			const bar = new SearchBar('', {
				onExecute: (direction) => calls.push(`execute:${direction}`),
				onCycle: (direction) => calls.push(`cycle:${direction}`),
				onClear: () => calls.push('clear'),
				onClose: () => calls.push('close'),
				onInput: (value) => calls.push(`input:${value}`)
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
		});
		assert.deepStrictEqual(calls, [
			'input:alp',
			'execute:1',
			'execute:-1',
			'close',
			'clear',
			'cycle:-1',
			'cycle:1'
		]);
	});

	test('toggles carry aria-pressed and report the options', () => {
		const caseButton = fakeElement();
		const wordButton = fakeElement();
		const regexButton = fakeElement();
		const calls: unknown[] = [];
		withDocument(
			{
				'search-match-case': caseButton,
				'search-whole-word': wordButton,
				'search-regex': regexButton
			},
			() => {
				const bar = new SearchBar('', { onOptions: (options) => calls.push(options) });
				bar.mount();
				caseButton.listeners.click({});
				regexButton.listeners.click({});
				assert.deepStrictEqual(bar.options(), { caseSensitive: true, wholeWord: false, regex: true });
			}
		);
		assert.strictEqual(caseButton.getAttribute('aria-pressed'), 'true');
		assert.strictEqual(regexButton.getAttribute('aria-pressed'), 'true');
		assert.deepStrictEqual(calls.length, 2);
	});

	test('the replace row toggles, reports replace and preserves case', () => {
		const widget = fakeElement();
		const row = fakeElement();
		row.hidden = true;
		const toggle = fakeElement();
		const replace = fakeElement();
		const all = fakeElement();
		const preserve = fakeElement();
		preserve.attributes['aria-pressed'] = 'true';
		const replaceInput = fakeElement();
		const calls: string[] = [];
		withDocument(
			{
				'find-widget': widget,
				'search-replace-row': row,
				'search-replace-toggle': toggle,
				'search-replace': replace,
				'search-replace-all': all,
				'search-preserve-case': preserve,
				'search-replace-input': replaceInput
			},
			() => {
				const bar = new SearchBar('', { onReplace: (text, every) => calls.push(`${text}:${every}`) });
				bar.mount();
				bar.show(true);
				assert.strictEqual(widget.hidden, false);
				assert.strictEqual(row.hidden, false);
				replaceInput.value = 'beta';
				replace.listeners.click({});
				all.listeners.click({});
				preserve.listeners.click({});
				assert.strictEqual(bar.preserveCase(), false);
			}
		);
		assert.deepStrictEqual(calls, ['beta:false', 'beta:true']);
	});

	test('show and hide control the widget without touching the query', () => {
		const widget = fakeElement();
		const input = fakeElement();
		withDocument({ 'find-widget': widget, 'search-input': input }, () => {
			const bar = new SearchBar('');
			bar.mount();
			bar.setValue('keep');
			bar.show(false);
			assert.strictEqual(widget.hidden, false);
			assert.deepStrictEqual(input.focusOptions, [{ preventScroll: true }]);
			bar.hide();
			assert.strictEqual(widget.hidden, true);
			assert.strictEqual(bar.value(), 'keep');
		});
	});

	test('F3 and Shift+F3 execute in both directions without touching the text', () => {
		const input = fakeElement();
		const calls: string[] = [];
		withDocument({ 'search-input': input }, () => {
			const bar = new SearchBar('', { onExecute: (direction) => calls.push(`execute:${direction}`) });
			bar.mount();
			input.value = 'keep';
			const enter = (shiftKey: boolean): boolean => {
				let prevented = false;
				input.listeners.keydown({
					key: 'F3',
					shiftKey,
					preventDefault() {
						prevented = true;
					}
				});
				return prevented;
			};
			assert.strictEqual(enter(false), true);
			assert.strictEqual(enter(true), true);
			assert.strictEqual(input.value, 'keep');
		});
		assert.deepStrictEqual(calls, ['execute:1', 'execute:-1']);
	});

	test('a page without controls and a bar without callbacks mount and key safely', () => {
		withDocument({}, () => {
			const bar = new SearchBar('missing-');
			bar.mount();
			bar.mount();
			assert.strictEqual(bar.value(), '');
		});
		const input = fakeElement();
		const prevented: number[] = [];
		withDocument({ 'search-input': input }, () => {
			const bar = new SearchBar('');
			bar.mount();
			input.value = 'abc';
			input.listeners.input({});
			input.listeners.keydown({ key: 'Enter', shiftKey: false, preventDefault: () => prevented.push(1) });
			input.listeners.keydown({ key: 'Escape', preventDefault: () => prevented.push(1) });
			assert.strictEqual(input.value, 'abc', 'Escape lets the page close and clear');
		});
		assert.deepStrictEqual(prevented, [1, 1]);
	});
});
