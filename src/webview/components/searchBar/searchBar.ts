/**
 * SearchBar component: query field, clear, match navigation, fixed count and
 * busy slots. Owns its markup, its keys and its transient typing state.
 *
 * The composition root owns the search engine, candidate rows, the match index
 * and what a query means; it receives every action through callbacks and feeds
 * the count/busy/navigation state back with setters.
 */
import './searchBar.css';

export interface SearchBarCallbacks {
	/** Enter/F3: run a changed query or move through the current match set. */
	onExecute?(direction: 1 | -1): void;
	/** Previous/next buttons. */
	onCycle?(direction: 1 | -1): void;
	/** Clear control or Escape. */
	onClear?(): void;
	/** Escape after clearing: the composition root returns focus to the tree. */
	onEscape?(): void;
	/** The field text changed; the composition root drops stale matches. */
	onInput?(value: string): void;
}

/** Markup for one instance. `prefix` is `''` (editor) or `'diff-'` (diff). */
export function renderSearchBarHtml(prefix: string, ariaLabel: string): string {
	const id = (name: string): string => `${prefix}${name}`;
	return `<div class="search-box">
<div class="search-field">
<span class="search-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4"/><path d="M9.5 9.5l3.5 3.5"/></svg></span>
<input id="${id('search-input')}" class="search-input" type="search" placeholder="Search" aria-label="${ariaLabel}" autocomplete="off" spellcheck="false">
<button id="${id('search-clear')}" class="nav-btn search-clear" type="button" title="Clear search" aria-label="Clear search" hidden><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
</div>
<button id="${id('search-prev')}" class="nav-btn search-nav" type="button" title="Previous match (Shift+F3)" aria-label="Previous match" disabled><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.75l4-4 4 4"/></svg></button>
<button id="${id('search-next')}" class="nav-btn search-nav" type="button" title="Next match (F3)" aria-label="Next match" disabled><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.25l4 4 4-4"/></svg></button>
<span id="${id('search-count')}" class="search-count" role="status" aria-live="polite"></span>
<span id="${id('search-busy')}" class="search-progress" role="status" aria-label="Searching" data-busy="false"></span>
</div>`;
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

	input(): any {
		return document.getElementById(this.id('search-input'));
	}

	mount(): void {
		if (this.mounted) {
			return;
		}
		this.mounted = true;
		const input = this.input();
		if (input) {
			input.addEventListener('input', () => {
				if (this.callbacks.onInput) {
					this.callbacks.onInput(input.value);
				}
			});
			input.addEventListener('keydown', (event: any) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					if (this.callbacks.onExecute) {
						this.callbacks.onExecute(event.shiftKey ? -1 : 1);
					}
				} else if (event.key === 'Escape') {
					event.preventDefault();
					this.clear();
					if (this.callbacks.onEscape) {
						this.callbacks.onEscape();
					}
				} else if (event.key === 'F3') {
					event.preventDefault();
					if (this.callbacks.onExecute) {
						this.callbacks.onExecute(event.shiftKey ? -1 : 1);
					}
				}
			});
		}
		const clear = document.getElementById(this.id('search-clear'));
		if (clear) {
			clear.addEventListener('click', () => {
				this.clear();
				if (this.callbacks.onClear) {
					this.callbacks.onClear();
				}
				this.focus();
			});
		}
		const prev = document.getElementById(this.id('search-prev'));
		if (prev) {
			prev.addEventListener('click', () => {
				if (this.callbacks.onCycle) {
					this.callbacks.onCycle(-1);
				}
			});
		}
		const next = document.getElementById(this.id('search-next'));
		if (next) {
			next.addEventListener('click', () => {
				if (this.callbacks.onCycle) {
					this.callbacks.onCycle(1);
				}
			});
		}
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
		const prev = document.getElementById(this.id('search-prev')) as HTMLButtonElement | null;
		if (prev) {
			prev.disabled = !enabled;
		}
		const next = document.getElementById(this.id('search-next')) as HTMLButtonElement | null;
		if (next) {
			next.disabled = !enabled;
		}
	}

		setClearVisible(visible: boolean): void {
		const clear = document.getElementById(this.id('search-clear'));
		if (clear) {
			clear.hidden = !visible;
		}
	}
}
