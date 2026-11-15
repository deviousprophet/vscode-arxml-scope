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

/** The slice of a DocumentTreeView the arrow geometry needs. */
interface ArrowPane {
	root?: HTMLElement;
	getWindowElement?(): Element | undefined;
}

export class DiffView {
	callbacks: DiffViewCallbacks;
	left: any;
	right: any;
	scroll: VirtualScroll | undefined;
	titleLeft: any;
	titleRight: any;
	mounted: boolean;
	resizeObserver: ResizeObserver | undefined;

	constructor(callbacks: DiffViewCallbacks = {}) {
		this.callbacks = callbacks;
		this.left = undefined;
		this.right = undefined;
		this.scroll = undefined;
		this.titleLeft = undefined;
		this.titleRight = undefined;
		this.mounted = false;
		this.resizeObserver = undefined;
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
		this.observePaneResize();
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
		this.syncArrowOffsets(viewport);
		const lefts = viewportOffsets(viewport);
		this.left.render({ ...viewport, left: lefts[0] ?? 0 }, force);
		this.right.render({ ...viewport, left: rightPaneOffset(lefts) }, force);
		this.emitViewport(viewport);
	}

	/**
	 * Keep each copy arrow on the pane's fixed inner edge while the rows pan.
	 *
	 * The arrow lives inside the row, which is as wide as the horizontally
	 * scrollable content. Its `right`/`left` inset is therefore the distance from
	 * the content edge back to the viewport edge, not a constant.
	 */
	private syncArrowOffsets(viewport: DocumentTreeViewport): void {
		const lefts = viewportOffsets(viewport);
		this.setArrowOffset(this.left, '--diff-arrow-right', this.arrowRightOffset(0, lefts[0] ?? 0));
		this.setArrowOffset(this.right, '--diff-arrow-left', this.arrowLeftOffset(1, lefts[1] ?? 0));
	}

	private arrowRightOffset(index: number, scrollLeft: number): number {
		return Math.max(0, this.arrowOverflow(index) - scrollLeft);
	}

	private arrowLeftOffset(index: number, scrollLeft: number): number {
		return Math.max(0, Math.min(scrollLeft, this.arrowOverflow(index)));
	}

	private arrowOverflow(index: number): number {
		const pane = this.paneWidth(index);
		const measured = this.windowWidth(index);
		const estimate = this.scroll ? this.scroll.contentWidths[index] ?? 0 : 0;
		const content = measured > pane ? measured : estimate;
		return Math.max(0, content - pane);
	}

	/** The rendered row width, including the gutter the content estimate omits. */
	private windowWidth(index: number): number {
		const view = this.viewAt(index);
		if (!view) {
			return 0;
		}
		const windowEl = view.getWindowElement ? view.getWindowElement() : undefined;
		return windowEl ? this.rectWidthOf(windowEl) : 0;
	}

	private viewAt(index: number): ArrowPane | undefined {
		return index === 0 ? this.left : this.right;
	}

	private rectWidthOf(element: Element): number {
		return element.getBoundingClientRect().width;
	}

	private paneWidth(index: number): number {
		const view = this.viewAt(index);
		return view && view.root ? view.root.clientWidth : 0;
	}

	private setArrowOffset(view: ArrowPane | undefined, property: string, value: number): void {
		const root = view ? view.root : undefined;
		if (!root) {
			return;
		}
		if (typeof root.style.setProperty !== 'function') {
			return;
		}
		root.style.setProperty(property, `${value}px`);
	}

	/** A pane resizes when the shared vertical scrollbar appears or the host resizes. */
	private observePaneResize(): void {
		if (typeof ResizeObserver === 'undefined' || !this.scroll) {
			return;
		}
		this.resizeObserver = new ResizeObserver(() => {
			const viewport = this.scroll ? this.scroll.getViewport() : { top: 0, left: 0, height: 0, width: 0 };
			this.syncArrowOffsets(viewport);
		});
		this.resizeObserver.observe(this.scroll.getPane(0));
		this.resizeObserver.observe(this.scroll.getPane(1));
		window.addEventListener('pagehide', () => this.resizeObserver?.disconnect());
	}

	private emitViewport(viewport: DocumentTreeViewport): void {
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

	scrollToIndex(index: number, align?: 'auto' | 'start' | 'end'): void {
		this.scroll?.scrollToIndex(index, align);
	}

	/** Match the fixed title strip's width to the vertical scrollbar's gutter. */
	syncScrollbarWidth(): void {
		const body = diffBodyElement();
		if (!body || !body.style) {
			return;
		}
		body.style.setProperty('--diff-scrollbar-width', this.scrollbarWidth() + 'px');
	}

	private scrollbarWidth(): number {
		return this.scroll ? this.scroll.verticalScrollbarWidth() : 0;
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
		const text = headerTitle(header);
		element.textContent = text;
		element.title = headerTitleTooltip(header, text);
		element.hidden = text === '';
	}
}

/** The title text of a pane header. */
function headerTitle(header: DocumentTreeHeader): string {
	return header && header.title ? header.title : '';
}

/** The tooltip of a pane header; the title text is the fallback. */
function headerTitleTooltip(header: DocumentTreeHeader, text: string): string {
	return header && header.titleTitle ? header.titleTitle : text;
}

/** The two pane offsets; a single offset mirrors to both panes. */
function viewportOffsets(viewport: DocumentTreeViewport): readonly number[] {
	return viewport.lefts && viewport.lefts.length > 0 ? viewport.lefts : [viewport.left, viewport.left];
}

/** The right pane offset, falling back to the left pane's. */
function rightPaneOffset(lefts: readonly number[]): number {
	return lefts[1] ?? lefts[0] ?? 0;
}

/** The fixed chrome body whose width token follows the scrollbar gutter. */
function diffBodyElement(): HTMLElement | null | undefined {
	return typeof document === 'undefined' ? undefined : document.getElementById('diff-body');
}
