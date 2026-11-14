/**
 * The merge strip in the diff panel.
 *
 * It shows the conflict count, the current conflict's path and both values, and the
 * five actions a three-way merge needs. The strip owns no merge state: the host is
 * the only owner, and every action is a protocol message.
 */
import type { MergeConflictView, MergeViewState } from '../../../diffProtocol';

export interface MergeBarCallbacks {
	onPrev: () => void;
	onNext: () => void;
	onAccept: (side: 'ours' | 'theirs') => void;
	onWrite: () => void;
}

const ACTIONS = [
	{ action: 'prev', label: 'Previous conflict' },
	{ action: 'next', label: 'Next conflict' },
	{ action: 'ours', label: 'Keep ours' },
	{ action: 'theirs', label: 'Take theirs' },
	{ action: 'write', label: 'Write merge' }
] as const;

function valueLine(conflict: MergeConflictView): string {
	const parts: string[] = [];
	if (conflict.base !== undefined) {
		parts.push(`base ${conflict.base}`);
	}
	parts.push(conflict.ours === undefined ? '(deleted on ours)' : `ours ${conflict.ours}`);
	parts.push(conflict.theirs === undefined ? '(deleted on theirs)' : `theirs ${conflict.theirs}`);
	return parts.join('  ·  ');
}

export class MergeBar {
	private bar: HTMLElement | undefined;
	private status: HTMLElement | undefined;
	private current: HTMLElement | undefined;
	private buttons: HTMLButtonElement[] = [];
	private state: MergeViewState | undefined;
	private index = 0;

	constructor(
		private readonly root: Document,
		private readonly callbacks: MergeBarCallbacks
	) {}

	/** Creates the strip once; the shell stays static. */
	mount(): void {
		if (this.bar !== undefined) {
			return;
		}
		const bar = this.root.createElement('div');
		bar.id = 'diff-merge';
		bar.className = 'merge-bar';
		bar.hidden = true;
		bar.setAttribute('role', 'group');
		bar.setAttribute('aria-label', 'Merge conflicts');

		const status = this.root.createElement('span');
		status.className = 'merge-bar-status';
		const current = this.root.createElement('span');
		current.className = 'merge-bar-current';
		const actions = this.root.createElement('div');
		actions.className = 'merge-bar-actions';

		for (const { action, label } of ACTIONS) {
			const button = this.root.createElement('button');
			button.type = 'button';
			button.className = 'merge-bar-button';
			button.dataset.action = action;
			button.textContent = label;
			button.addEventListener('click', () => this.activate(action));
			actions.appendChild(button);
			this.buttons.push(button);
		}

		bar.append(status, current, actions);
		this.bar = bar;
		this.status = status;
		this.current = current;
	}

	private activate(action: (typeof ACTIONS)[number]['action']): void {
		if (action === 'prev') {
			this.callbacks.onPrev();
			return;
		}
		if (action === 'next') {
			this.callbacks.onNext();
			return;
		}
		if (action === 'write') {
			this.callbacks.onWrite();
			return;
		}
		this.callbacks.onAccept(action);
	}

	/** The created element, for the page to place in its shell. */
	get element(): HTMLElement | undefined {
		return this.bar;
	}

	/** The bar's current index, clamped to the conflict list. */
	get currentIndex(): number {
		return this.index;
	}

	setIndex(index: number): void {
		this.index = index;
		this.render();
	}

	/** Installs the host state; `undefined` hides the strip (a plain diff). */
	setState(state: MergeViewState | undefined): void {
		this.state = state;
		if (state === undefined || state.conflicts.length === 0) {
			this.index = 0;
			this.render();
			return;
		}
		this.index = Math.min(this.index, state.conflicts.length - 1);
		this.render();
	}

	private render(): void {
		if (this.bar === undefined || this.status === undefined || this.current === undefined) {
			return;
		}
		const state = this.state;
		if (state === undefined || state.conflicts.length === 0) {
			this.bar.hidden = true;
			return;
		}
		this.bar.hidden = false;
		const conflict = state.conflicts[this.index];
		const resolved = conflict.resolution === undefined ? 'unresolved' : `kept ${conflict.resolution}`;
		this.status.textContent = `Merge ${this.index + 1}/${state.conflicts.length} · ${state.unresolved} unresolved`;
		this.current.textContent = `${conflict.path} (${conflict.reason}, ${resolved}) ${valueLine(conflict)} → ${state.target}`;
		for (const button of this.buttons) {
			if (button.dataset.action === 'write') {
				button.disabled = state.unresolved > 0;
			}
		}
	}
}
