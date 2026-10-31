/**
 * DiffView component: the two-pane comparison surface.
 *
 * Owns the pane grid, two DocumentTree instances, the single visible vertical
 * driver, horizontal mirroring and swap state that only resets the horizontal
 * offsets. The composition root owns the diff model, rows, selection, search and
 * status; it supplies rows through the DocumentTree models.
 */
import './diffView.css';
import { DocumentTreeView } from '../documentTree/documentTreeView';
import type { DocumentTreeHeader, DocumentTreeViewModel } from '../documentTree/documentTreeView';
export { renderDiffViewHtml } from './diffViewRender';

export interface DiffViewCallbacks {
	onVisibleWindowChange?(pane: 'left' | 'right', top: number, left: number): void;
	onRowClick?(pane: 'left' | 'right', index: number, event: MouseEvent): void;
	onRender?(pane: string): void;
}

export class DiffView {
	callbacks: DiffViewCallbacks;
	left: any;
	right: any;
	mounted: boolean;

	constructor(callbacks: DiffViewCallbacks = {}) {
		this.callbacks = callbacks;
		this.left = undefined;
		this.right = undefined;
		this.mounted = false;
	}

	mount(): void {
		if (this.mounted) {
			return;
		}
		this.mounted = true;
		this.left = new DocumentTreeView('#diff-pane-left', 'left', {
			onVisibleWindowChange: (top: number, left: number) => this.syncPanes('left', top, left),
			onRender: () => {
				if (this.callbacks.onRender) {
					this.callbacks.onRender('left');
				}
			},
			onRowClick: (index: number, event: any) => {
				if (this.callbacks.onRowClick) {
					this.callbacks.onRowClick('left', index, event);
				}
			}
		});
		this.right = new DocumentTreeView('#diff-pane-right', 'right', {
			onVisibleWindowChange: (top: number, left: number) => this.syncPanes('right', top, left),
			onRowClick: (index: number, event: any) => {
				if (this.callbacks.onRowClick) {
					this.callbacks.onRowClick('right', index, event);
				}
			}
		});
		this.left.mount();
		this.right.mount();
		const rightScroller = this.right.root ? this.right.root.querySelector('.document-tree-scroll') : null;
		if (rightScroller) {
			rightScroller.addEventListener(
				'wheel',
				(event: any) => {
					if (event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
						return;
					}
					event.preventDefault();
					this.left.setScrollTop(this.left.getScrollTop() + event.deltaY);
				},
				{ passive: false }
			);
		}
	}

	/**
	 * One vertical driver: either pane's scroll copies to the other. Horizontal
	 * is mirrored the same way; the component's expected-offset suppression stops
	 * the follower's scroll event from bouncing back.
	 */
	syncPanes(pane: 'left' | 'right', top: number, left: number): void {
		if (!this.left || !this.right) {
			return;
		}
		const driver = pane === 'left' ? this.left : this.right;
		const follower = pane === 'left' ? this.right : this.left;
		if (Math.abs(follower.getScrollTop() - top) >= 1) {
			follower.setScrollTop(top);
		}
		if (Math.abs(follower.getScrollLeft() - left) >= 1) {
			follower.setScrollLeft(left);
		}
		if (Math.abs(driver.getScrollLeft() - left) >= 1) {
			driver.setScrollLeft(left);
		}
		if (this.callbacks.onVisibleWindowChange) {
			this.callbacks.onVisibleWindowChange(pane, top, left);
		}
	}

	render(force: boolean): void {
		this.left.render(force === true);
		this.right.render(force === true);
	}

	setModel(model: DocumentTreeViewModel): void {
		this.left.setModel(model);
		this.right.setModel(model);
	}

	setContentWidth(width: number): void {
		this.left.setContentWidth(width);
		this.right.setContentWidth(width);
	}

	setHeader(header: { left: DocumentTreeHeader; right: DocumentTreeHeader }): void {
		this.left.setHeader(header.left);
		this.right.setHeader(header.right);
	}

	setScrollTop(top: number): void {
		this.left.setScrollTop(top);
		this.right.setScrollTop(this.left.getScrollTop());
	}

	setScrollLeft(left: number): void {
		this.left.setScrollLeft(left);
		this.right.setScrollLeft(left);
	}

	getScrollTop(): number {
		return this.left.getScrollTop();
	}

	getScrollLeft(): number {
		return this.left.getScrollLeft();
	}

	getRowsScrollTop(): number {
		return this.left.getRowsScrollTop();
	}

	setRowsScrollTop(top: number): void {
		this.left.setRowsScrollTop(top);
		this.right.setScrollTop(this.left.getScrollTop());
	}

	clientHeight(): number {
		return this.left.clientHeight();
	}

	getVisibleRange(): [number, number] {
		return this.left.getVisibleRange();
	}

	scrollToIndex(index: number, align?: 'auto' | 'start' | 'end'): void {
		this.left.scrollToIndex(index, align);
		this.right.setScrollTop(this.left.getScrollTop());
	}

	/** Swap resets horizontal only; the vertical position is preserved. */
	resetHorizontal(): void {
		this.left.setScrollLeft(0);
		this.right.setScrollLeft(0);
	}
}
