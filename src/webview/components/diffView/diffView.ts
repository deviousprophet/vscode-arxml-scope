/**
 * DiffView: fixed file-name chrome plus one shared virtual scroll surface.
 *
 * The two DocumentTreeViews are pure window renderers inside one VirtualScroll.
 * They share one offsets table, one vertical scrollbar and one horizontal
 * offset; the pane split stays fixed.
 */
import './diffView.css';
import { DocumentTreeView } from '../documentTree/documentTreeView';
import type { DocumentTreeHeader, DocumentTreeViewModel, DocumentTreeViewport } from '../documentTree/documentTreeView';
import { VirtualScroll } from '../virtualScroll/virtualScroll';
import type { VirtualScrollContent } from '../virtualScroll/virtualScroll';
export { renderDiffViewHtml } from './diffViewRender';

export interface DiffViewCallbacks {
	onRowClick?(pane: 'left' | 'right', index: number, event: MouseEvent): void;
	onRender?(pane: string): void;
	onViewportChange?(viewport: DocumentTreeViewport): void;
}

export class DiffView {
	callbacks: DiffViewCallbacks;
	left: any;
	right: any;
	scroll: VirtualScroll | undefined;
	titleLeft: any;
	titleRight: any;
	mounted: boolean;

	constructor(callbacks: DiffViewCallbacks = {}) {
		this.callbacks = callbacks;
		this.left = undefined;
		this.right = undefined;
		this.scroll = undefined;
		this.titleLeft = undefined;
		this.titleRight = undefined;
		this.mounted = false;
	}

	mount(): void {
		if (this.mounted) {
			return;
		}
		this.mounted = true;
		this.titleLeft = document.getElementById('diff-title-left');
		this.titleRight = document.getElementById('diff-title-right');
		this.scroll = new VirtualScroll(
			'#diff-list',
			[
				{
					id: 'diff-pane-left',
					className: 'document-tree-pane document-tree diff-pane',
					role: 'tree',
					label: 'Semantic ECUC diff, left side',
					side: 'left'
				},
				{
					id: 'diff-pane-right',
					className: 'document-tree-pane document-tree diff-pane',
					role: 'group',
					label: 'Semantic ECUC diff, right side',
					side: 'right'
				}
			],
			{
				onViewportChange: (viewport) => this.render(viewport, false),
				syncHorizontal: true
			}
		);
		this.scroll.mount();
		this.syncScrollbarWidth();
		this.left = new DocumentTreeView(this.scroll.getPane(0), 'left', {
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
		this.right = new DocumentTreeView(this.scroll.getPane(1), 'right', {
			onRowClick: (index: number, event: any) => {
				if (this.callbacks.onRowClick) {
					this.callbacks.onRowClick('right', index, event);
				}
			}
		});
		this.left.mount();
		this.right.mount();
	}

	setModel(model: DocumentTreeViewModel): void {
		this.left.setModel(model);
		this.right.setModel(model);
	}

	/** Re-colour the selected display row's number in both panes. */
	refreshActiveLine(): void {
		if (this.left) {
			this.left.refreshActiveLine();
		}
		if (this.right) {
			this.right.refreshActiveLine();
		}
	}

	/** The number-column width of each pane, in `ch`. */
	lineNumberChars(): [number, number] {
		return [this.left ? this.left.lineNumberChars() : 0, this.right ? this.right.lineNumberChars() : 0];
	}

	setContent(content: VirtualScrollContent): void {
		if (this.scroll) {
			this.scroll.setContent(content);
		}
	}

	setContentWidth(width: number): void {
		this.left.setContentWidth(width);
		this.right.setContentWidth(width);
	}

	setHeader(header: { left: DocumentTreeHeader; right: DocumentTreeHeader }): void {
		this.setTitle(this.titleLeft, header.left);
		this.setTitle(this.titleRight, header.right);
	}

	render(viewport: DocumentTreeViewport, force: boolean): void {
		const lefts = viewport.lefts && viewport.lefts.length > 0 ? viewport.lefts : [viewport.left, viewport.left];
		this.left.render({ ...viewport, left: lefts[0] ?? 0 }, force);
		this.right.render({ ...viewport, left: lefts[1] ?? lefts[0] ?? 0 }, force);
		if (this.callbacks.onViewportChange) {
			this.callbacks.onViewportChange(viewport);
		}
	}

	setScrollTop(top: number, defer = false): void {
		this.scroll?.setScrollTop(top, defer);
	}

	getScrollTop(): number {
		return this.scroll ? this.scroll.getScrollTop() : 0;
	}

	setScrollLeft(left: number, defer = false): void {
		this.scroll?.setScrollLeft(left, defer);
	}

	getScrollLeft(index = 0): number {
		return this.scroll ? this.scroll.getScrollLeft(index) : 0;
	}

	getVisibleRange(): [number, number] {
		return this.scroll ? this.scroll.getVisibleRange() : [0, 0];
	}

	clientHeight(): number {
		return this.scroll ? this.scroll.clientHeight() : 0;
	}

	clientWidth(): number {
		return this.scroll ? this.scroll.clientWidth() : 0;
	}

	scrollToIndex(index: number, align?: 'auto' | 'start' | 'end'): void {
		this.scroll?.scrollToIndex(index, align);
	}

	getWindowElement(): any {
		return this.left ? this.left.getWindowElement() : undefined;
	}

	/** Match the fixed title strip's width to the vertical scrollbar's gutter. */
	syncScrollbarWidth(): void {
		const body = typeof document === 'undefined' ? undefined : document.getElementById('diff-body');
		if (!body || !body.style) {
			return;
		}
		const width = this.scroll ? this.scroll.verticalScrollbarWidth() : 0;
		body.style.setProperty('--diff-scrollbar-width', width + 'px');
	}

	/** Swap resets horizontal only; the vertical position is preserved. */
	resetHorizontal(): void {
		if (this.scroll) {
			this.scroll.setPaneScrollLeft(0, 0);
			this.scroll.setPaneScrollLeft(1, 0);
		}
	}

	private setTitle(element: any, header: DocumentTreeHeader): void {
		if (!element) {
			return;
		}
		const text = header && header.title ? header.title : '';
		element.textContent = text;
		element.title = header && header.titleTitle ? header.titleTitle : text;
		element.hidden = text === '';
	}
}
