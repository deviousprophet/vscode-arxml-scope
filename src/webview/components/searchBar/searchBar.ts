/**
 * SearchBar component: the floating find widget shared by both pages.
 *
 * Owns the markup, option toggles, replace row, focus and transient typing state.
 * The composition root owns matching, the match index and every consequence of a
 * query; it receives actions through callbacks and feeds count/busy/state back.
 */
import './searchBar.css';

import type { FindOptions } from '../../../core/searchModel';

export interface SearchBarCallbacks {
	/** Enter/F3: run a changed query or move through the current match set. */
	onExecute?(direction: 1 | -1): void;
	/** Previous/next buttons. */
	onCycle?(direction: 1 | -1): void;
	/** Clear control: drop the query and the result set. */
	onClear?(): void;
	/** Escape or the close button: the composition root hides and clears. */
	onClose?(): void;
	/** The field text changed; the composition root drops stale matches. */
	onInput?(value: string): void;
	/** One option toggle changed. */
	onOptions?(options: FindOptions): void;
	/** Replace / Replace All. */
	onReplace?(text: string, all: boolean): void;
}

/** The query or replacement input shape the widget reads. */
interface WidgetKeyEvent {
	key?: string;
	shiftKey?: boolean;
	preventDefault(): void;
}

interface WidgetInput {
	value: string;
	focus(options?: { preventScroll?: boolean }): void;
	select?(): void;
	disabled?: boolean;
	addEventListener(type: string, listener: (event: WidgetKeyEvent) => void): void;
	setAttribute(name: string, value: string): void;
}

/** Markup for one instance. `prefix` is `''` (editor) or `'diff-'` (diff). */
export function renderSearchBarHtml(prefix: string, ariaLabel: string, withReplace = true): string {
	const id = (name: string): string => `${prefix}${name}`;
	const toggle = (name: string, label: string, title: string, glyph: string): string =>
		`<button id="${id(name)}" class="find-toggle find-option" type="button" aria-pressed="false" title="${title}" aria-label="${label}">${glyph}</button>`;
	const replaceRow = withReplace
		? `<div id="${id('search-replace-row')}" class="find-row replace-row" hidden>
<input id="${id('search-replace-input')}" class="search-input replace-input field-input" type="text" placeholder="Replace" aria-label="Replace" autocomplete="off" spellcheck="false">
<button id="${id('search-preserve-case')}" class="find-toggle find-option" type="button" aria-pressed="true" title="Preserve case" aria-label="Preserve case">AB</button>
<button id="${id('search-replace')}" class="find-action" type="button" title="Replace" aria-label="Replace" disabled>Replace</button>
<button id="${id('search-replace-all')}" class="find-action" type="button" title="Replace All" aria-label="Replace All" disabled>Replace All</button>
</div>`
		: '';
	return `<div id="${id('find-widget')}" class="find-widget" role="dialog" aria-label="${ariaLabel}" hidden>
<div class="find-row query-row">
<button id="${id('search-replace-toggle')}" class="find-toggle find-expand" type="button" aria-expanded="false" title="Toggle Replace" aria-label="Toggle Replace"${withReplace ? '' : ' hidden'}><span class="codicon codicon-chevron-right" aria-hidden="true"></span></button>
<div class="find-field"><input id="${id('search-input')}" class="search-input field-input" type="search" placeholder="Find" aria-label="${ariaLabel}" autocomplete="off" spellcheck="false">
<button id="${id('search-clear')}" class="find-toggle search-clear" type="button" title="Clear search" aria-label="Clear search" hidden><span class="codicon codicon-close" aria-hidden="true"></span></button></div>
${toggle('search-match-case', 'Match Case', 'Match Case (Alt+C)', 'Aa')}
${toggle('search-whole-word', 'Match Whole Word', 'Match Whole Word (Alt+W)', 'ab|')}
${toggle('search-regex', 'Use Regular Expression', 'Use Regular Expression (Alt+R)', '.*')}
<span id="${id('search-count')}" class="search-count" role="status" aria-live="polite"></span>
<span id="${id('search-busy')}" class="search-progress" role="status" aria-label="Searching" data-busy="false"></span>
<button id="${id('search-prev')}" class="find-toggle find-nav" type="button" title="Previous match (Shift+F3)" aria-label="Previous match" disabled><span class="codicon codicon-arrow-up" aria-hidden="true"></span></button>
<button id="${id('search-next')}" class="find-toggle find-nav" type="button" title="Next match (F3)" aria-label="Next match" disabled><span class="codicon codicon-arrow-down" aria-hidden="true"></span></button>
<button id="${id('search-close')}" class="find-toggle find-close" type="button" title="Close (Escape)" aria-label="Close find"><span class="codicon codicon-close" aria-hidden="true"></span></button>
</div>
${replaceRow}
</div>`;
}

/** The key event the query field forwards. */
interface SearchKeyEvent {
	key?: string;
	shiftKey?: boolean;
	preventDefault(): void;
}

function keyAction(key: string | undefined): 'close' | 'execute' | '' {
	if (key === 'Escape') {
		return 'close';
	}
	return key === 'Enter' || key === 'F3' ? 'execute' : '';
}

function readOptions(widget: HTMLElement): FindOptions {
	const pressed = (name: string): boolean =>
		widget.querySelector(`#${name}`)?.getAttribute('aria-pressed') === 'true';
	return {
		caseSensitive: pressed(`${widget.id}search-match-case`.replace(`${widget.id}`, widget.id.startsWith('diff-') ? 'diff-' : '')),
		wholeWord: pressed(`${widget.id}search-whole-word`.replace(`${widget.id}`, widget.id.startsWith('diff-') ? 'diff-' : '')),
		regex: pressed(`${widget.id}search-regex`.replace(`${widget.id}`, widget.id.startsWith('diff-') ? 'diff-' : ''))
	};
}

/** The page controller; the composition root instantiates it. */
export class SearchBar {
	prefix: string;
	callbacks: SearchBarCallbacks;
	mounted: boolean;

	constructor(prefix: string, callbacks: SearchBarCallbacks = {}) {
		this.prefix = prefix || '';
		this.callbacks = callbacks;
		this.mounted = false;
	}

	id(name: string): string {
		return this.prefix + name;
	}

	widget(): HTMLElement | null {
		return document.getElementById(this.id('find-widget'));
	}

	input(): WidgetInput | null {
		return document.getElementById(this.id('search-input')) as WidgetInput | null;
	}

	replaceInput(): WidgetInput | null {
		return document.getElementById(this.id('search-replace-input')) as WidgetInput | null;
	}

	mount(): void {
		if (this.mounted) {
			return;
		}
		this.mounted = true;
		this.mountInput();
		this.mountClear();
		this.mountNavigation();
		this.mountOptions();
		this.mountReplace();
	}

	private mountInput(): void {
		const input = this.input();
		if (!input) {
			return;
		}
		input.addEventListener('input', () => this.emitInput(input));
		input.addEventListener('keydown', (event: SearchKeyEvent) => this.onKeydown(event));
	}

	private emitInput(input: { value: string }): void {
		if (this.callbacks.onInput) {
			this.callbacks.onInput(input.value);
		}
	}

	private onKeydown(event: SearchKeyEvent): void {
		const action = keyAction(event.key);
		if (action !== '') {
			this.performKey(action, event);
		}
	}

	private performKey(action: 'close' | 'execute', event: SearchKeyEvent): void {
		event.preventDefault();
		if (action === 'close') {
			this.close();
		} else {
			this.execute(event);
		}
	}

	private close(): void {
		this.callbacks.onClose?.();
	}

	private execute(event: SearchKeyEvent): void {
		this.callbacks.onExecute?.(event.shiftKey ? -1 : 1);
	}

	private mountClear(): void {
		const clear = document.getElementById(this.id('search-clear'));
		if (!clear) {
			return;
		}
		clear.addEventListener('click', () => this.onClearClick());
	}

	private onClearClick(): void {
		this.clear();
		if (this.callbacks.onClear) {
			this.callbacks.onClear();
		}
		this.focus();
	}

	private mountNavigation(): void {
		this.mountCycleButton('search-prev', -1);
		this.mountCycleButton('search-next', 1);
	}

	private mountCycleButton(name: string, direction: 1 | -1): void {
		const button = document.getElementById(this.id(name));
		if (!button) {
			return;
		}
		button.addEventListener('click', () => this.cycle(direction));
	}

	private cycle(direction: 1 | -1): void {
		if (this.callbacks.onCycle) {
			this.callbacks.onCycle(direction);
		}
	}

	private mountOptions(): void {
		for (const name of ['search-match-case', 'search-whole-word', 'search-regex']) {
			const button = document.getElementById(this.id(name));
			if (!button) {
				continue;
			}
			button.addEventListener('click', () => {
				const pressed = button.getAttribute('aria-pressed') === 'true';
				button.setAttribute('aria-pressed', pressed ? 'false' : 'true');
				this.callbacks.onOptions?.(this.options());
			});
		}
		const close = document.getElementById(this.id('search-close'));
		close?.addEventListener('click', () => this.callbacks.onClose?.());
	}

	private mountReplace(): void {
		const toggle = document.getElementById(this.id('search-replace-toggle'));
		toggle?.addEventListener('click', () => this.toggleReplace());
		const replace = document.getElementById(this.id('search-replace'));
		replace?.addEventListener('click', () => this.replace(false));
		const all = document.getElementById(this.id('search-replace-all'));
		all?.addEventListener('click', () => this.replace(true));
		const preserve = document.getElementById(this.id('search-preserve-case'));
		preserve?.addEventListener('click', () => {
			const pressed = preserve.getAttribute('aria-pressed') === 'true';
			preserve.setAttribute('aria-pressed', pressed ? 'false' : 'true');
		});
	}

	private replace(all: boolean): void {
		this.callbacks.onReplace?.(this.replaceInput()?.value ?? '', all);
	}

	value(): string {
		const input = this.input();
		return input ? input.value : '';
	}

	hasText(): boolean {
		return this.value().trim() !== '';
	}

	setValue(value: string): void {
		const input = this.input();
		if (input) {
			input.value = value;
		}
	}

	clear(): void {
		this.setValue('');
	}

	focus(): void {
		const input = this.input();
		if (!input) {
			return;
		}
		input.focus({ preventScroll: true });
		if (typeof input.select === 'function') {
			input.select();
		}
	}

	focusReplace(): void {
		this.replaceInput()?.focus({ preventScroll: true });
	}

	setCount(text: string): void {
		const count = document.getElementById(this.id('search-count'));
		if (count) {
			count.textContent = text;
		}
	}

	setBusy(busy: boolean): void {
		const progress = document.getElementById(this.id('search-busy'));
		if (progress) {
			progress.dataset.busy = busy ? 'true' : 'false';
		}
	}

	setNavigationEnabled(enabled: boolean): void {
		for (const name of ['search-prev', 'search-next']) {
			const button = document.getElementById(this.id(name)) as HTMLButtonElement | null;
			if (button) {
				button.disabled = !enabled;
			}
		}
	}

	setClearVisible(visible: boolean): void {
		const clear = document.getElementById(this.id('search-clear'));
		if (clear) {
			clear.hidden = !visible;
		}
	}

	setInvalid(invalid: boolean): void {
		const input = this.input();
		if (input) {
			input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
		}
	}

	setReplaceEnabled(enabled: boolean): void {
		for (const name of ['search-replace', 'search-replace-all']) {
			const button = document.getElementById(this.id(name)) as HTMLButtonElement | null;
			if (button) {
				button.disabled = !enabled;
			}
		}
	}

	options(): FindOptions {
		const pressed = (name: string): boolean =>
			document.getElementById(this.id(name))?.getAttribute('aria-pressed') === 'true';
		return {
			caseSensitive: pressed('search-match-case'),
			wholeWord: pressed('search-whole-word'),
			regex: pressed('search-regex')
		};
	}

	replaceValue(): string {
		return this.replaceInput()?.value ?? '';
	}

	preserveCase(): boolean {
		return document.getElementById(this.id('search-preserve-case'))?.getAttribute('aria-pressed') === 'true';
	}

	toggleReplace(force?: boolean): void {
		const row = document.getElementById(this.id('search-replace-row'));
		const toggle = document.getElementById(this.id('search-replace-toggle'));
		if (!row || !toggle) {
			return;
		}
		this.setReplaceOpen(row, toggle, force ?? row.hasAttribute('hidden'));
	}

	private setReplaceOpen(row: HTMLElement, toggle: HTMLElement, open: boolean): void {
		row.hidden = !open;
		toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
		if (open) {
			this.focusReplace();
		} else {
			this.focus();
		}
	}

	show(expandReplace = false): void {
		const widget = this.widget();
		if (!widget) {
			return;
		}
		widget.hidden = false;
		if (expandReplace) {
			this.toggleReplace(true);
		} else {
			this.focus();
		}
	}

	hide(): void {
		const widget = this.widget();
		if (widget) {
			widget.hidden = true;
		}
	}

	get visible(): boolean {
		const widget = this.widget();
		return widget !== null && !widget.hidden;
	}
}
