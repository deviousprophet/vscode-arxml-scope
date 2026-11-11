/**
 * Row context menu: one page-local `role="menu"` with Duplicate and Delete.
 * Only container and parameter rows open it; the composition root receives the
 * action and decides what the write/confirmation is.
 */
import './contextMenu.css';

export function renderContextMenuHtml(): string {
	return `<div id="row-menu" class="row-menu" role="menu" aria-label="Row actions" hidden>
<button class="row-menu-item" type="button" role="menuitem" data-action="duplicate">Duplicate</button>
<button class="row-menu-item" type="button" role="menuitem" data-action="delete">Delete</button>
</div>`;
}

/**
 * The menu's coordinates live in a nonce stylesheet; the menu never writes a
 * style attribute. The host shell includes this tag next to the static markup.
 */
export function renderContextMenuStyleTag(nonce: string): string {
	return `<style id="row-menu-style" nonce="${nonce}">#row-menu{left:0;top:0}</style>`;
}

export interface ContextMenuHost {
	/** Select the right-clicked row through the tree's own selection path. */
	selectItem(item: any): void;
	/** The rendered row element for a node id, for focus restore. */
	rowElement(nodeId: string): any;
	/** One `duplicate` or `delete` request; the host confirms and writes. */
	onAction(action: string, nodeId: string): void;
}

let rowMenu: any;
let rowMenuStyle: any;
let menuNodeId: string | undefined;
let rowMenuHost: ContextMenuHost = {
	selectItem: function () {},
	rowElement: function () { return undefined; },
	onAction: function () {}
};

/** A menu item or tree row: the page-local elements carry their action in a dataset. */
type MenuRow = Element & { dataset: DOMStringMap };

/** The keyboard event the menu forwards. */
interface MenuKeyEvent {
	key?: string;
	preventDefault(): void;
}

/** The contextmenu event the tree forwards. */
interface ContextMenuEvent {
	target?: unknown;
	clientX: number;
	clientY: number;
	preventDefault(): void;
}

function hasDataset(item: Element): item is MenuRow {
	return 'dataset' in item;
}

function isMenuRow(item: MenuRow): boolean {
	const kind = item.dataset.kind;
	return kind === 'container' || kind === 'parameter';
}

/** Bind the static menu markup and the tree's contextmenu gesture. */
export function mountContextMenu(treeElement: any, host: ContextMenuHost): void {
	rowMenuHost = host || rowMenuHost;
	rowMenu = document.getElementById('row-menu');
	rowMenuStyle = document.getElementById('row-menu-style');
	if (treeElement) {
		treeElement.addEventListener('contextmenu', onTreeContextMenu);
	}
	if (!rowMenu) {
		return;
	}
	rowMenu.addEventListener('click', onRowMenuClick);
	rowMenu.addEventListener('keydown', onRowMenuKeydown);
	document.addEventListener('pointerdown', function (event: any) {
		if (rowMenu.hidden) {
			return;
		}
		if (event.target instanceof Element && event.target.closest('#row-menu')) {
			return;
		}
		hideRowMenu(false);
	});
	window.addEventListener('scroll', function () { hideRowMenu(false); }, true);
	window.addEventListener('resize', function () { hideRowMenu(false); });
	window.addEventListener('blur', function () { hideRowMenu(false); });
}

export function hideRowMenu(restoreFocus: boolean): void {
	if (!rowMenu || rowMenu.hidden) {
		return;
	}
	rowMenu.hidden = true;
	const id = menuNodeId;
	menuNodeId = undefined;
	restoreRowMenuFocus(restoreFocus, id);
}

function restoreRowMenuFocus(restoreFocus: boolean, id: string | undefined): void {
	if (!restoreFocus || id === undefined) {
		return;
	}
	const element = rowMenuHost.rowElement(id);
	if (element) {
		element.focus({ preventScroll: true });
	}
}

function onRowMenuClick(event: { target?: unknown }): void {
	const item = rowMenuItemFromEvent(event);
	const nodeId = menuNodeId;
	if (!item || nodeId === undefined) {
		return;
	}
	hideRowMenu(true);
	runRowMenuAction(item.dataset.action, nodeId);
}

function rowMenuItemFromEvent(event: { target?: unknown }): MenuRow | undefined {
	if (!(event.target instanceof Element)) {
		return undefined;
	}
	const item = event.target.closest('.row-menu-item');
	return item && hasDataset(item) ? item : undefined;
}

function runRowMenuAction(action: string | undefined, nodeId: string): void {
	if (action === 'delete' || action === 'duplicate') {
		rowMenuHost.onAction(action, nodeId);
	}
}

function showRowMenu(item: MenuRow, left: number, top: number): void {
	if (!rowMenu || !rowMenuStyle) {
		return;
	}
	if (!isMenuRow(item)) {
		return;
	}
	rowMenuHost.selectItem(item);
	menuNodeId = item.dataset.nodeId;
	rowMenu.hidden = false;
	positionRowMenu(left, top);
	focusFirstRowMenuItem();
}

function positionRowMenu(left: number, top: number): void {
	const bounds = rowMenu.getBoundingClientRect();
	const x = Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8));
	const y = Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8));
	rowMenuStyle.textContent = '#row-menu{left:' + x + 'px;top:' + y + 'px}';
}

function focusFirstRowMenuItem(): void {
	const first = rowMenu.querySelector('.row-menu-item');
	if (first) {
		first.focus({ preventScroll: true });
	}
}

function onTreeContextMenu(event: ContextMenuEvent): void {
	const item = treeMenuRow(event.target);
	if (!item || !isMenuRow(item)) {
		return;
	}
	event.preventDefault();
	showRowMenu(item, event.clientX, event.clientY);
}

function treeMenuRow(target: unknown): MenuRow | undefined {
	if (!(target instanceof Element)) {
		return undefined;
	}
	const item = target.closest('#tree [role="treeitem"]');
	return item && hasDataset(item) ? item : undefined;
}

function onRowMenuKeydown(event: MenuKeyEvent): void {
	if (!rowMenu || rowMenu.hidden) {
		return;
	}
	if (event.key === 'Escape') {
		event.preventDefault();
		hideRowMenu(true);
		return;
	}
	moveRowMenuFocus(event);
}

function moveRowMenuFocus(event: MenuKeyEvent): void {
	if (!isRowMenuArrow(event.key)) {
		return;
	}
	event.preventDefault();
	const items = Array.from(rowMenu.querySelectorAll('.row-menu-item')).filter(
		(item): item is HTMLElement => item instanceof HTMLElement
	);
	const at = items.findIndex((item) => item === document.activeElement);
	const step = event.key === 'ArrowDown' ? 1 : -1;
	const next = items[(at + step + items.length) % items.length];
	if (next) {
		next.focus();
	}
}

function isRowMenuArrow(key: string | undefined): boolean {
	return key === 'ArrowDown' || key === 'ArrowUp';
}
