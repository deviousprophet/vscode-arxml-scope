/**
 * Webview HTML for the ECUC tree (child design §2.6, parent design §6).
 *
 * Everything is inlined — no asset files, no remote loads — because the CSP forbids
 * them and `esbuild.js` has no asset-copy step. Every colour is a `--vscode-*` custom
 * property, so light, dark and high-contrast themes all work (parent R16).
 *
 * `renderTree` returns the region the provider swaps on a re-scan; `renderHtml` wraps
 * it in the page (toolbar, CSP, nonce, script).
 */
import { randomBytes } from 'crypto';
import {
	ContainerNode,
	EcucDocumentModel,
	ModuleNode,
	ParameterNode,
	ReferenceNode,
	SortMode,
	Suffixes,
	lastShortName,
} from '../core/ecuc/model';
import { SORT_EXCEPTIONS, orderContainers, orderMembers, orderModules } from '../core/ecuc/order';
import { filterScript, haystack } from './filter';
import { NodeIndex, buildNodeIndex } from './nodeId';

export interface RenderOptions {
	/** Inline-script nonce; generated when absent. */
	nonce?: string;
	sort?: SortMode;
	sortExcept?: readonly string[];
	/** Node to mark and focus on load (child design §2.4, source → editor). */
	selectedId?: string;
}

/** Builds the whole page. */
export function renderHtml(model: EcucDocumentModel, options: RenderOptions = {}): string {
	const nonce = options.nonce ?? randomBytes(16).toString('base64');
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<div class="toolbar">
<input id="filter" class="filter" type="search" placeholder="Filter labels, short names and values" aria-label="Filter the ECUC tree">
<span id="notice" class="notice" role="status" aria-live="polite"></span>
</div>
<div id="main">${renderTree(model, options)}</div>
<script nonce="${nonce}">
${filterScript()}
${TREE_SCRIPT}
</script>
</body>
</html>`;
}

/** Builds the refreshable region: schema release, packages, and the tree itself. */
export function renderTree(model: EcucDocumentModel, options: RenderOptions = {}): string {
	const ctx: Ctx = {
		index: buildNodeIndex(model),
		sort: options.sort ?? 'all',
		except: options.sortExcept ?? SORT_EXCEPTIONS,
		selectedId: options.selectedId,
		first: true,
	};

	const meta: string[] = [];
	if (model.schema) {
		meta.push(`<div class="schema">schema ${escapeHtml(model.schema.release)}</div>`);
	}
	for (const pkg of model.packages) {
		meta.push(`<div class="package">package ${escapeHtml(pkg.path.join('.'))}</div>`);
	}

	const modules = orderModules(model.modules, ctx.sort, ctx.except).map((module) => moduleItem(ctx, module, 1));
	return (
		`<div class="meta">${meta.join('')}</div>` +
		`<div id="tree" class="tree" role="tree" aria-label="ECUC values">${modules.join('')}</div>`
	);
}

interface Ctx {
	index: NodeIndex;
	sort: SortMode;
	except: readonly string[];
	selectedId?: string;
	/** True until the first item is written; it carries the roving `tabindex="0"`. */
	first: boolean;
}

interface ItemSpec {
	id: string;
	kind: string;
	label: string;
	shortName?: string;
	value?: string;
	/** Hover text: the full `DEFINITION-REF` path where there is one (design §2.7). */
	title: string;
	level: number;
	meta: string[];
	children: string[];
}

function item(ctx: Ctx, spec: ItemSpec): string {
	const selected = ctx.selectedId !== undefined && spec.id === ctx.selectedId;
	// One item carries `tabindex="0"`; the script moves it as focus moves.
	const focusable = selected || (ctx.selectedId === undefined && ctx.first);
	ctx.first = false;
	const expanded = spec.children.length > 0 ? ' aria-expanded="true"' : '';
	const group =
		spec.children.length > 0 ? `<div role="group" class="children">${spec.children.join('')}</div>` : '';
	return (
		`<div class="node" role="treeitem" aria-level="${spec.level}"${expanded} tabindex="${focusable ? '0' : '-1'}"` +
		` data-node-id="${escapeAttr(spec.id)}" data-kind="${escapeAttr(spec.kind)}"` +
		` data-haystack="${escapeAttr(haystack(spec))}"${selected ? ' data-selected="true"' : ''}` +
		` title="${escapeAttr(spec.title)}">` +
		`<span class="row"><span class="label">${escapeHtml(spec.label)}</span>${spec.meta.join('')}</span>${group}</div>`
	);
}

function moduleItem(ctx: Ctx, module: ModuleNode, level: number): string {
	return item(ctx, {
		id: ctx.index.idOf(module) ?? '',
		kind: 'module',
		label: dotted(module.definitionRef),
		shortName: module.shortName,
		title: module.definitionRef,
		level,
		meta: [
			`<span class="short">"${escapeHtml(module.shortName)}"</span>`,
			module.variant ? `<span class="variant">(${escapeHtml(camelize(module.variant))})</span>` : '',
			...suffixSpans(module),
		].filter(Boolean),
		children: orderContainers(module.containers, ctx.sort, ctx.except).map((c) => containerItem(ctx, c, level + 1)),
	});
}

function containerItem(ctx: Ctx, container: ContainerNode, level: number): string {
	const members = orderMembers(container.parameters, container.references, ctx.sort, ctx.except);
	const children = [
		...members.parameters.map((p) => parameterItem(ctx, p, level + 1)),
		...members.references.map((r) => referenceItem(ctx, r, level + 1)),
		...orderContainers(container.containers, ctx.sort, ctx.except).map((c) => containerItem(ctx, c, level + 1)),
	];
	return item(ctx, {
		id: ctx.index.idOf(container) ?? '',
		kind: 'container',
		label: lastShortName(container.definitionRef),
		shortName: container.shortName,
		title: container.definitionRef,
		level,
		meta: [`<span class="short">"${escapeHtml(container.shortName)}"</span>`, ...suffixSpans(container)],
		children,
	});
}

function parameterItem(ctx: Ctx, parameter: ParameterNode, level: number): string {
	const value = parameter.displayValue ?? '';
	// The legacy form quotes a textual value and leaves a numerical one bare, which is
	// what tells the two apart at a glance.
	const shown = parameter.numeric ? value : `"${value}"`;
	return item(ctx, {
		id: ctx.index.idOf(parameter) ?? '',
		kind: 'parameter',
		label: parameter.name,
		value,
		title: parameter.definitionRef,
		level,
		meta: [
			`<span class="value">= ${escapeHtml(shown)}</span>`,
			parameter.hexValue ? `<span class="hex">(= ${escapeHtml(parameter.hexValue)})</span>` : '',
			...suffixSpans(parameter),
		].filter(Boolean),
		children: [],
	});
}

function referenceItem(ctx: Ctx, reference: ReferenceNode, level: number): string {
	const target = reference.targetPath ?? reference.targetRawPath ?? '';
	const context = reference.instance && reference.contextPaths.length > 0
		? `<span class="context">context ${escapeHtml(reference.contextPaths.join(', '))}</span>`
		: '';
	return item(ctx, {
		id: ctx.index.idOf(reference) ?? '',
		kind: 'reference',
		label: reference.name,
		value: target,
		title: reference.definitionRef,
		level,
		meta: [
			`<span class="value target" data-follow="true" title="Follow to the target">= ${escapeHtml(target)}</span>`,
			context,
			...suffixSpans(reference),
		].filter(Boolean),
		children: [],
	});
}

/** Conditions and annotations, in the legacy order: syscond, variant conditions, annotations. */
function suffixSpans(node: Suffixes): string[] {
	const spans: string[] = [];
	if (node.syscond) {
		spans.push(`<span class="condition">[${escapeHtml(node.syscond)}]</span>`);
	}
	if (node.postBuildVariants && node.postBuildVariants.length > 0) {
		const text = node.postBuildVariants.map((v) => `${v.criterion} ${v.operator} ${v.value}`).join(' && ');
		spans.push(`<span class="condition">&lt;${escapeHtml(text)}&gt;</span>`);
	}
	for (const annotation of node.annotations ?? []) {
		const label = annotation.label ? `[${annotation.label}] ` : '';
		const text = annotation.text ?? '';
		if (label === '' && text === '') {
			continue;
		}
		spans.push(`<span class="annotation">${escapeHtml(label + text)}</span>`);
	}
	return spans;
}

/** `/A/B/C` → `A.B.C`, the legacy `\structify`. */
function dotted(path: string): string {
	const parts = path.split('/');
	return parts.length <= 1 ? path : parts.slice(1).join('.');
}

/** `VARIANT-PRE-COMPILE` → `VariantPreCompile`, the legacy `\camelize`. */
function camelize(value: string): string {
	return value
		.split('-')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join('');
}

/** Text-content escaping; quotes are safe in text. */
function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Attribute-value escaping, which must also cover the quote. */
function escapeAttr(text: string): string {
	return escapeHtml(text).replace(/"/g, '&quot;');
}

const STYLE = `
body {
	font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size);
	color: var(--vscode-foreground);
	background: var(--vscode-editor-background);
	margin: 0;
}
.toolbar {
	display: flex;
	gap: 8px;
	align-items: center;
	padding: 6px 10px;
	position: sticky;
	top: 0;
	background: var(--vscode-editor-background);
	border-bottom: 1px solid var(--vscode-panel-border);
}
.filter {
	min-width: 240px;
	padding: 2px 6px;
	color: var(--vscode-input-foreground);
	background: var(--vscode-input-background);
	border: 1px solid var(--vscode-input-border, transparent);
}
.notice {
	color: var(--vscode-editorWarning-foreground);
}
.meta {
	padding: 6px 10px;
	color: var(--vscode-descriptionForeground);
}
.schema, .package {
	font-family: var(--vscode-editor-font-family);
}
.tree {
	padding: 4px 0 12px;
}
.node {
	outline: none;
}
.row {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	align-items: baseline;
	padding: 1px 8px 1px 4px;
}
.node:focus-visible > .row {
	outline: 1px solid var(--vscode-focusBorder);
	outline-offset: -1px;
	background: var(--vscode-list-focusBackground);
}
.node[data-selected="true"] > .row {
	background: var(--vscode-list-activeSelectionBackground);
	color: var(--vscode-list-activeSelectionForeground);
}
.children {
	margin-left: 14px;
	border-left: 1px solid var(--vscode-tree-indentGuidesStroke, transparent);
}
.label {
	font-weight: 600;
}
.short {
	color: var(--vscode-symbolIcon-stringForeground, var(--vscode-foreground));
}
.variant {
	color: var(--vscode-symbolIcon-enumeratorForeground, var(--vscode-foreground));
}
.condition {
	color: var(--vscode-symbolIcon-keywordForeground, var(--vscode-foreground));
}
.annotation {
	color: var(--vscode-descriptionForeground);
	font-style: italic;
}
.value {
	color: var(--vscode-symbolIcon-numberForeground, var(--vscode-foreground));
}
.target {
	text-decoration: underline;
	cursor: pointer;
}
.context, .hex {
	color: var(--vscode-descriptionForeground);
}
`;

/**
 * Keyboard traversal, activation and the message bridge. There is no `ready` message:
 * the initial model is already in the HTML, and a re-scan swaps the region whole, so a
 * first-paint push would only be a second update path (design §3).
 */
const TREE_SCRIPT = `
const vscode = acquireVsCodeApi();
const main = document.getElementById('main');
const notice = document.getElementById('notice');
let selectedId;

function treeItems() {
	return Array.from(document.querySelectorAll('#tree [role="treeitem"]')).filter((el) => el.offsetParent !== null);
}

function focusItem(target) {
	if (!target) {
		return;
	}
	for (const item of document.querySelectorAll('#tree [role="treeitem"]')) {
		item.tabIndex = -1;
	}
	target.tabIndex = 0;
	target.focus();
	target.scrollIntoView({ block: 'center' });
}

function prepareFocus() {
	if (selectedId !== undefined) {
		for (const item of document.querySelectorAll('#tree [role="treeitem"]')) {
			if (item.dataset.nodeId === selectedId) {
				focusItem(item);
				return;
			}
		}
	}
	const first = document.querySelector('#tree [role="treeitem"]');
	if (first && !document.querySelector('#tree [tabindex="0"]')) {
		first.tabIndex = 0;
	}
}

document.addEventListener('click', (event) => {
	if (!(event.target instanceof Element)) {
		return;
	}
	const item = event.target.closest('#tree [role="treeitem"]');
	if (!item) {
		return;
	}
	focusItem(item);
	const follow = event.target.closest('[data-follow]') !== null;
	vscode.postMessage({ type: follow ? 'follow' : 'reveal', nodeId: item.dataset.nodeId });
});

document.addEventListener('keydown', (event) => {
	if (!(event.target instanceof Element)) {
		return;
	}
	const item = event.target.closest('#tree [role="treeitem"]');
	if (!item) {
		return;
	}
	const items = treeItems();
	const at = items.indexOf(item);
	const group = item.querySelector(':scope > [role="group"]');
	if (event.key === 'ArrowDown') {
		event.preventDefault();
		focusItem(items[Math.min(at + 1, items.length - 1)]);
	} else if (event.key === 'ArrowUp') {
		event.preventDefault();
		focusItem(items[Math.max(at - 1, 0)]);
	} else if (event.key === 'ArrowRight') {
		event.preventDefault();
		if (group && item.getAttribute('aria-expanded') !== 'true') {
			item.setAttribute('aria-expanded', 'true');
			group.style.display = '';
		} else if (group) {
			focusItem(group.firstElementChild);
		}
	} else if (event.key === 'ArrowLeft') {
		event.preventDefault();
		if (group && item.getAttribute('aria-expanded') === 'true') {
			item.setAttribute('aria-expanded', 'false');
			group.style.display = 'none';
		} else {
			focusItem(item.parentElement.closest('#tree [role="treeitem"]'));
		}
	} else if (event.key === 'Enter') {
		event.preventDefault();
		vscode.postMessage({ type: 'reveal', nodeId: item.dataset.nodeId });
	}
});

window.addEventListener('message', (event) => {
	const message = event.data;
	if (!message) {
		return;
	}
	if (message.type === 'model') {
		selectedId = message.selectedId;
		main.innerHTML = message.tree;
		applyFilter();
		prepareFocus();
	} else if (message.type === 'select') {
		selectedId = message.nodeId;
		prepareFocus();
	} else if (message.type === 'notice') {
		notice.textContent = message.message;
	}
});

applyFilter();
prepareFocus();
`;
