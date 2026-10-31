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
	rowMenu.addEventListener('click', function (event: any) {
		if (!(event.target instanceof Element)) {
			return;
		}
		const item: any = event.target.closest('.row-menu-item');
		if (!item || menuNodeId === undefined) {
			return;
		}
		const nodeId = menuNodeId;
		const action = item.dataset.action;
		hideRowMenu(true);
		if (action === 'delete' || action === 'duplicate') {
			rowMenuHost.onAction(action, nodeId);
		}
	});
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
	if (restoreFocus && id !== undefined) {
		const element = rowMenuHost.rowElement(id);
		if (element) {
			element.focus({ preventScroll: true });
		}
	}
}

function showRowMenu(item: any, left: number, top: number): void {
	if (!rowMenu || !rowMenuStyle) {
		return;
	}
	const kind = item.dataset.kind;
	if (kind !== 'container' && kind !== 'parameter') {
		return;
	}
	rowMenuHost.selectItem(item);
	menuNodeId = item.dataset.nodeId;
	rowMenu.hidden = false;
	const bounds = rowMenu.getBoundingClientRect();
	const x = Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8));
	const y = Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8));
	rowMenuStyle.textContent = '#row-menu{left:' + x + 'px;top:' + y + 'px}';
	const first = rowMenu.querySelector('.row-menu-item');
	if (first) {
		first.focus({ preventScroll: true });
	}
}

function onTreeContextMenu(event: any): void {
	if (!(event.target instanceof Element)) {
		return;
	}
	const item: any = event.target.closest('#tree [role="treeitem"]');
	if (!item) {
		return;
	}
	const kind = item.dataset.kind;
	if (kind !== 'container' && kind !== 'parameter') {
		return;
	}
	event.preventDefault();
	showRowMenu(item, event.clientX, event.clientY);
}

function onRowMenuKeydown(event: any): void {
	if (!rowMenu || rowMenu.hidden) {
		return;
	}
	const items = Array.from(rowMenu.querySelectorAll('.row-menu-item')) as any[];
	if (event.key === 'Escape') {
		event.preventDefault();
		hideRowMenu(true);
		return;
	}
	if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
		return;
	}
	event.preventDefault();
	const at = items.indexOf(document.activeElement);
	const step = event.key === 'ArrowDown' ? 1 : -1;
	const next = items[(at + step + items.length) % items.length];
	if (next) {
		next.focus();
	}
}
