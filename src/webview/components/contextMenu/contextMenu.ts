/**
 * Row context menu: one page-local `role="menu"` with Duplicate and Delete.
 * Only container and parameter rows open it; the composition root receives the
 * action and decides what the write/confirmation is.
 */
import contextMenuCss from './contextMenu.css';

export function contextMenuStyles(): string {
	return contextMenuCss;
}

/** Coordinates live in a nonce stylesheet; the menu never writes a style attr. */
export function renderContextMenuStyleTag(nonce: string): string {
	return `<style id="row-menu-style" nonce="${nonce}">#row-menu{left:0;top:0}</style>`;
}

export function renderContextMenuHtml(): string {
	return `<div id="row-menu" class="row-menu" role="menu" aria-label="Row actions" hidden>
<button class="row-menu-item" type="button" role="menuitem" data-action="duplicate">Duplicate</button>
<button class="row-menu-item" type="button" role="menuitem" data-action="delete">Delete</button>
</div>`;
}

export interface ContextMenuHost {
	/** Select the right-clicked row through the tree's own selection path. */
	selectItem(item: any): void;
	/** The rendered row element for a node id, for focus restore. */
	rowElement(nodeId: string): any;
	/** One `duplicate` or `delete` request; the host confirms and writes. */
	onAction(action: string, nodeId: string): void;
}

export function contextMenuScript(): string {
	return `
let rowMenu;
let rowMenuStyle;
let menuNodeId;
let rowMenuHost = {
	selectItem: function () {},
	rowElement: function () { return undefined; },
	onAction: function () {}
};

function mountContextMenu(treeElement, host) {
	rowMenuHost = host || rowMenuHost;
	rowMenu = document.getElementById('row-menu');
	rowMenuStyle = document.getElementById('row-menu-style');
	if (treeElement) {
		treeElement.addEventListener('contextmenu', onTreeContextMenu);
	}
	if (!rowMenu) {
		return;
	}
	rowMenu.addEventListener('click', function (event) {
		if (!(event.target instanceof Element)) {
			return;
		}
		const item = event.target.closest('.row-menu-item');
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
	document.addEventListener('pointerdown', function (event) {
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

function hideRowMenu(restoreFocus) {
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

function showRowMenu(item, left, top) {
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

function onTreeContextMenu(event) {
	if (!(event.target instanceof Element)) {
		return;
	}
	const item = event.target.closest('#tree [role="treeitem"]');
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

function onRowMenuKeydown(event) {
	if (!rowMenu || rowMenu.hidden) {
		return;
	}
	const items = Array.from(rowMenu.querySelectorAll('.row-menu-item'));
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
`;
}
