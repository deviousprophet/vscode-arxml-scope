/**
 * Webview HTML for the ECUC tree (child design §2.6, parent design §6; UX child design
 * §2, §4, §5, §7, §8, §9).
 *
 * Everything is inlined — no asset files, no remote loads — because the CSP forbids
 * them and `esbuild.js` has no asset-copy step. Every colour is a `--vscode-*` custom
 * property (or a fallback inside one), so light, dark and high-contrast themes all work
 * (parent R16). Kind glyphs and the twisty are inline SVG for the same reason: inline
 * SVG is not a fetch, so the CSP needs no change.
 *
 * `renderTree` returns the region the provider swaps on a re-scan; `renderHtml` wraps
 * it in the page (toolbar, CSP, nonce, script).
 *
 * The state that has to survive a re-scan — the collapsed set and the scroll position —
 * lives in the webview (UX child design §4.1). The handful of pure helpers that decide
 * it are defined here as real functions and serialized into the page with
 * `toString()`, so the page and the tests share one definition instead of two.
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
import { valueEditorScript } from './ecucValueEditor';
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
<span id="count" class="count" role="status" aria-live="polite"></span>
<span id="notice" class="notice" role="status" aria-live="polite"></span>
<span class="grow"></span>
<button id="expand-all" class="tool" type="button" title="Expand every container">Expand all</button>
<button id="collapse-all" class="tool" type="button" title="Collapse every container">Collapse all</button>
</div>
<div id="main">${renderTree(model, options)}</div>
<script nonce="${nonce}">
${filterScript()}
const vscode = acquireVsCodeApi();
${valueEditorScript()}
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

	const modules = orderModules(model.modules, ctx.sort, ctx.except);
	const items = modules.map((module, at) => moduleItem(ctx, module, 1, at + 1, modules.length));
	return (
		`<div class="meta">${meta.join('')}</div>` +
		`<div id="tree" class="tree" role="tree" aria-label="ECUC values">${items.join('')}</div>`
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
	/** Position within its group, and the group's size, for `aria-posinset` / `aria-setsize`. */
	posinset: number;
	setsize: number;
	meta: string[];
	children: string[];
}

/** The inline-SVG kind markers: shape as well as colour, so high-contrast themes work. */
const GLYPHS: Record<string, string> = {
	module:
		'<svg class="g-module" viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><rect x="3" y="3" width="10" height="10"/></svg>',
	container:
		'<svg class="g-container" viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3.5" y="3.5" width="9" height="9"/></svg>',
	parameter:
		'<svg class="g-parameter" viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><circle cx="8" cy="8" r="3"/></svg>',
	reference:
		'<svg class="g-reference" viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 8h8M8 5l3 3-3 3"/></svg>',
};

const TWISTY_SVG =
	'<svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><path d="M6 4l4 4-4 4z"/></svg>';

function item(ctx: Ctx, spec: ItemSpec): string {
	const selected = ctx.selectedId !== undefined && spec.id === ctx.selectedId;
	// One item carries `tabindex="0"`; the script moves it as focus moves.
	const focusable = selected || (ctx.selectedId === undefined && ctx.first);
	ctx.first = false;
	const hasChildren = spec.children.length > 0;
	const expanded = hasChildren ? ' aria-expanded="true"' : '';
	// The value the in-tree editor starts from, so the webview never re-derives it from
	// the rendered text (parent design §9, `ecucValueEditor.ts`).
	const editable = spec.kind === 'parameter' ? ` data-value="${escapeAttr(spec.value ?? '')}"` : '';
	const group = hasChildren ? `<div role="group" class="children">${spec.children.join('')}</div>` : '';
	// A toggle only where there is something to toggle; a leaf gets a spacer instead, so
	// the labels of leaves and containers line up (UX child design §4.2).
	const twisty = hasChildren
		? `<span class="twisty" aria-hidden="true">${TWISTY_SVG}</span>`
		: '<span class="spacer" aria-hidden="true"></span>';
	return (
		`<div class="node" role="treeitem" aria-level="${spec.level}" aria-posinset="${spec.posinset}"` +
		` aria-setsize="${spec.setsize}" aria-selected="${selected ? 'true' : 'false'}"${expanded}` +
		` tabindex="${focusable ? '0' : '-1'}"` +
		` data-node-id="${escapeAttr(spec.id)}" data-kind="${escapeAttr(spec.kind)}"` +
		` data-haystack="${escapeAttr(haystack(spec))}"${editable}${selected ? ' data-selected="true"' : ''}` +
		` title="${escapeAttr(spec.title)}">` +
		`<span class="row k-${spec.kind}">${twisty}<span class="glyph" aria-hidden="true">${GLYPHS[spec.kind] ?? ''}</span>` +
		`<span class="label">${escapeHtml(spec.label)}</span>${spec.meta.join('')}</span>${group}</div>`
	);
}

function moduleItem(ctx: Ctx, module: ModuleNode, level: number, posinset: number, setsize: number): string {
	const containers = orderContainers(module.containers, ctx.sort, ctx.except);
	return item(ctx, {
		id: ctx.index.idOf(module) ?? '',
		kind: 'module',
		label: dotted(module.definitionRef),
		shortName: module.shortName,
		title: module.definitionRef,
		level,
		posinset,
		setsize,
		meta: [
			`<span class="short">"${escapeHtml(module.shortName)}"</span>`,
			module.variant ? `<span class="variant">(${escapeHtml(camelize(module.variant))})</span>` : '',
			...suffixSpans(module),
		].filter(Boolean),
		children: containers.map((c, at) => containerItem(ctx, c, level + 1, at + 1, containers.length)),
	});
}

function containerItem(
	ctx: Ctx,
	container: ContainerNode,
	level: number,
	posinset: number,
	setsize: number
): string {
	const members = orderMembers(container.parameters, container.references, ctx.sort, ctx.except);
	const nested = orderContainers(container.containers, ctx.sort, ctx.except);
	// One group per container: parameters, then references, then child containers, so the
	// positions stay contiguous (parent design §6).
	const total = members.parameters.length + members.references.length + nested.length;
	const children: string[] = [];
	for (const parameter of members.parameters) {
		children.push(parameterItem(ctx, parameter, level + 1, children.length + 1, total));
	}
	for (const reference of members.references) {
		children.push(referenceItem(ctx, reference, level + 1, children.length + 1, total));
	}
	for (const child of nested) {
		children.push(containerItem(ctx, child, level + 1, children.length + 1, total));
	}
	return item(ctx, {
		id: ctx.index.idOf(container) ?? '',
		kind: 'container',
		label: lastShortName(container.definitionRef),
		shortName: container.shortName,
		title: container.definitionRef,
		level,
		posinset,
		setsize,
		meta: [`<span class="short">"${escapeHtml(container.shortName)}"</span>`, ...suffixSpans(container)],
		children,
	});
}

function parameterItem(
	ctx: Ctx,
	parameter: ParameterNode,
	level: number,
	posinset: number,
	setsize: number
): string {
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
		posinset,
		setsize,
		meta: [
			// The value advertises that it is editable (UX child design §6, AC8).
			`<span class="value" title="Click to edit, or press F2">= ${escapeHtml(shown)}</span>`,
			parameter.hexValue ? `<span class="hex">(= ${escapeHtml(parameter.hexValue)})</span>` : '',
			...suffixSpans(parameter),
		].filter(Boolean),
		children: [],
	});
}

function referenceItem(
	ctx: Ctx,
	reference: ReferenceNode,
	level: number,
	posinset: number,
	setsize: number
): string {
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
		posinset,
		setsize,
		meta: [
			// The target is the row's follow affordance — not the whole row, which selects
			// now (UX child design §2, §5).
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

/* ---------------------------------------------------------------------------------
 * Re-render state (UX child design §4.1). Serialized into the page with `toString()`
 * so the webview and the tests run the same code, and so the ordering — capture the
 * scroll *before* the `innerHTML` swap, restore it *after* everything else — is
 * asserted rather than assumed.
 * ------------------------------------------------------------------------------- */

/** Drops the ids that no longer exist, leaving the rest of the set alone. */
export function pruneCollapsed(collapsed: readonly string[], present: readonly string[]): string[] {
	const alive = new Set(present);
	return collapsed.filter((id) => alive.has(id));
}

/** Adds or removes `id`; a node without children can never be collapsed. */
export function toggleCollapsed(collapsed: readonly string[], id: string, hasChildren: boolean): string[] {
	if (!hasChildren) {
		return collapsed.slice();
	}
	return collapsed.includes(id) ? collapsed.filter((other) => other !== id) : collapsed.concat([id]);
}

/** Collapse-all: every node that has something to hide. */
export function collapsedIdsFor(items: readonly { id: string; hasChildren: boolean }[]): string[] {
	return items.filter((item) => item.hasChildren).map((item) => item.id);
}

/**
 * The index a movement key moves focus to, or `undefined` when the key is not a move
 * (UX child design §8). `page` is how many rows fit in the viewport, so PageUp/PageDown
 * move by a screen rather than a fixed count.
 */
export function moveTarget(key: string, from: number, count: number, page: number): number | undefined {
	if (count === 0) {
		return undefined;
	}
	if (key === 'ArrowDown') {
		return Math.min(from + 1, count - 1);
	}
	if (key === 'ArrowUp') {
		return Math.max(from - 1, 0);
	}
	if (key === 'Home') {
		return 0;
	}
	if (key === 'End') {
		return count - 1;
	}
	if (key === 'PageUp') {
		return Math.max(from - page, 0);
	}
	if (key === 'PageDown') {
		return Math.min(from + page, count - 1);
	}
	return undefined;
}

/** The view operations a re-render needs, so the sequence is testable without a DOM. */
export interface ReRenderHooks {
	readScrollTop(): number;
	writeHtml(tree: string): void;
	pruneCollapsed(): void;
	applyCollapsed(): void;
	applyFilter(): void;
	prepareFocus(): void;
	writeScrollTop(scrollTop: number): void;
}

/**
 * The re-render sequence for one `model` message. The scroll is read before the swap and
 * written back after every other step, so neither the swap nor `scrollIntoView` in
 * `prepareFocus` can move the viewport while the user is typing in the XML.
 */
export function reRenderTree(tree: string, hooks: ReRenderHooks): void {
	const scrollTop = hooks.readScrollTop();
	hooks.writeHtml(tree);
	hooks.pruneCollapsed();
	hooks.applyCollapsed();
	hooks.applyFilter();
	hooks.prepareFocus();
	hooks.writeScrollTop(scrollTop);
}

const STYLE = `
html, body {
	height: 100%;
}
body {
	font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size);
	color: var(--vscode-foreground);
	background: var(--vscode-editor-background);
	margin: 0;
	display: flex;
	flex-direction: column;
	overflow: hidden;
}
.toolbar {
	display: flex;
	gap: 8px;
	align-items: center;
	padding: 6px 10px;
	flex: none;
	background: var(--vscode-editor-background);
	border-bottom: 1px solid var(--vscode-panel-border);
}
.grow {
	flex: 1 1 auto;
}
.filter {
	min-width: 240px;
	padding: 2px 6px;
	color: var(--vscode-input-foreground);
	background: var(--vscode-input-background);
	border: 1px solid var(--vscode-input-border, transparent);
}
.count {
	color: var(--vscode-descriptionForeground);
}
.tool {
	padding: 2px 8px;
	cursor: pointer;
	color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
	background: var(--vscode-button-secondaryBackground, transparent);
	border: 1px solid var(--vscode-button-border, transparent);
}
.tool:hover {
	background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
}
.notice {
	color: var(--vscode-foreground);
}
.notice[data-kind="warn"] {
	color: var(--vscode-editorWarning-foreground);
}
#main {
	flex: 1 1 auto;
	overflow: auto;
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
	flex-wrap: nowrap;
	gap: 6px;
	align-items: baseline;
	padding: 1px 8px 1px 4px;
}
.row:hover {
	background: var(--vscode-list-hoverBackground);
}
.twisty {
	flex: 0 0 12px;
	width: 12px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	color: var(--vscode-icon-foreground, var(--vscode-foreground));
}
.spacer {
	flex: 0 0 12px;
	width: 12px;
}
.twisty svg {
	transition: transform 120ms ease;
}
.node[aria-expanded="true"] > .row > .twisty svg {
	transform: rotate(90deg);
}
.glyph {
	flex: 0 0 12px;
	width: 12px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	color: var(--vscode-icon-foreground, var(--vscode-foreground));
}
.label {
	flex: 0 0 22ch;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: 600;
}
.row.k-module, .row.k-container {
	border-left: 2px solid var(--vscode-symbolIcon-classForeground, var(--vscode-foreground));
}
.row.k-parameter {
	border-left: 2px solid var(--vscode-symbolIcon-fieldForeground, var(--vscode-foreground));
}
.row.k-reference {
	border-left: 2px solid var(--vscode-symbolIcon-referenceForeground, var(--vscode-foreground));
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
body:not(:focus-within) .node[data-selected="true"] > .row {
	background: var(--vscode-list-inactiveSelectionBackground);
	color: var(--vscode-list-inactiveSelectionForeground);
}
.children {
	margin-left: 14px;
	border-left: 1px solid var(--vscode-tree-indentGuidesStroke, var(--vscode-panel-border, #80808040));
}
.node[aria-expanded="false"] > .children {
	display: none;
}
.node.flash > .row {
	animation: ecuc-flash 900ms ease-out;
}
@keyframes ecuc-flash {
	from { background: var(--vscode-editor-findMatchHighlightBackground, var(--vscode-list-hoverBackground)); }
	to { background: transparent; }
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
.row.k-parameter > .value {
	cursor: text;
	border-bottom: 1px dotted var(--vscode-descriptionForeground);
}
.row.k-parameter:hover > .value::after {
	content: "\\270E";
	margin-left: 4px;
	color: var(--vscode-descriptionForeground);
}
.value-edit {
	min-width: 12ch;
	padding: 0 2px;
	font-family: var(--vscode-editor-font-family);
	color: var(--vscode-input-foreground);
	background: var(--vscode-input-background);
	border: 1px solid var(--vscode-focusBorder);
}
.value-edit[aria-invalid="true"] {
	border-color: var(--vscode-editorError-foreground, var(--vscode-errorForeground));
}
.target {
	text-decoration: underline;
	cursor: pointer;
}
.context, .hex {
	color: var(--vscode-descriptionForeground);
}
mark {
	color: var(--vscode-editor-findMatchForeground, var(--vscode-foreground));
	background: var(--vscode-editor-findMatchHighlightBackground, var(--vscode-list-hoverBackground));
}
@media (prefers-reduced-motion: reduce) {
	.twisty svg {
		transition: none;
	}
	.node.flash > .row {
		animation: none;
	}
}
`;

/**
 * Keyboard traversal, activation, collapse and the message bridge. There is no `ready`
 * message: the initial model is already in the HTML, and a re-scan swaps the region
 * whole, so a first-paint push would only be a second update path (design §3). `vscode`
 * is declared once above, because `acquireVsCodeApi` may only be called once per page.
 *
 * Interaction model (UX child design §2): a click selects, the twisty toggles, a double
 * click or Ctrl/Alt+Enter reveals, Enter is toggle-or-reveal, Space selects only. The
 * value widget's handlers are registered before these and claim their events with
 * `stopImmediatePropagation`, so nothing here runs for an interaction it owns.
 */
const TREE_SCRIPT = `
const main = document.getElementById('main');
const notice = document.getElementById('notice');
let selectedId;
let collapsed = new Set();
let typeAhead = { text: '', at: 0 };

${pruneCollapsed.toString()}
${toggleCollapsed.toString()}
${collapsedIdsFor.toString()}
${moveTarget.toString()}
${reRenderTree.toString()}

function allItems() {
	return Array.from(document.querySelectorAll('#tree [role="treeitem"]'));
}

function treeItems() {
	return allItems().filter((el) => el.offsetParent !== null);
}

function itemHasChildren(item) {
	return item.querySelector(':scope > [role="group"]') !== null;
}

function focusItem(target) {
	if (!target) {
		return;
	}
	for (const item of allItems()) {
		item.tabIndex = -1;
	}
	target.tabIndex = 0;
	target.focus();
	target.scrollIntoView({ block: 'center' });
}

function setSelection(nodeId) {
	selectedId = nodeId;
	for (const item of allItems()) {
		const on = item.dataset.nodeId === nodeId;
		item.setAttribute('aria-selected', on ? 'true' : 'false');
		if (on) {
			item.dataset.selected = 'true';
		} else {
			delete item.dataset.selected;
		}
	}
}

function prepareFocus() {
	if (selectedId !== undefined) {
		for (const item of allItems()) {
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

/** Drop ids that the re-scan removed; everything else stays collapsed. */
function prune() {
	collapsed = new Set(pruneCollapsed(Array.from(collapsed), allItems().map((item) => item.dataset.nodeId)));
}

/**
 * The one place that writes \`aria-expanded\`, and therefore the one place that decides
 * what is visible. \`expandedOverride\` carries the ancestors of filter matches, which are
 * shown while a filter is active without touching the collapsed set (design §4.4).
 */
function applyCollapsed(expandedOverride) {
	for (const item of allItems()) {
		if (!itemHasChildren(item)) {
			continue;
		}
		const id = item.dataset.nodeId;
		const closed = collapsed.has(id) && !(expandedOverride && expandedOverride.has(id));
		item.setAttribute('aria-expanded', closed ? 'false' : 'true');
	}
}

function flipCollapsed(nodeId) {
	collapsed = new Set(toggleCollapsed(Array.from(collapsed), nodeId, true));
	applyCollapsed();
}

function selectItem(item) {
	focusItem(item);
	setSelection(item.dataset.nodeId);
	vscode.postMessage({ type: 'select', nodeId: item.dataset.nodeId });
}

function revealItem(item) {
	vscode.postMessage({ type: 'reveal', nodeId: item.dataset.nodeId });
}

function followItem(item) {
	vscode.postMessage({ type: 'follow', nodeId: item.dataset.nodeId });
}

function rowHeight() {
	const row = document.querySelector('#tree [role="treeitem"] > .row');
	const measured = row && row.getBoundingClientRect ? row.getBoundingClientRect().height : 0;
	return measured > 0 ? measured : 20;
}

/** Type-ahead over the visible labels, with a 2 s window (design §8). */
function typeAheadJump(character) {
	const now = Date.now();
	typeAhead.text = (now - typeAhead.at > 2000 ? '' : typeAhead.text) + character.toLowerCase();
	typeAhead.at = now;
	const items = treeItems();
	const at = items.indexOf(document.activeElement);
	for (let step = 1; step <= items.length; step++) {
		const candidate = items[(at + step + items.length) % items.length];
		const label = candidate.querySelector(':scope > .row > .label');
		if (label && label.textContent.toLowerCase().startsWith(typeAhead.text)) {
			focusItem(candidate);
			return;
		}
	}
}

/** A click selects; the twisty toggles; the target follows (UX child design §2). */
function onRowClick(event) {
	if (!(event.target instanceof Element)) {
		return;
	}
	const item = event.target.closest('#tree [role="treeitem"]');
	if (!item) {
		return;
	}
	// One interaction, one effect: the twisty toggles without moving the selection, the
	// target follows, everything else selects.
	if (event.target.closest('.twisty')) {
		flipCollapsed(item.dataset.nodeId);
		return;
	}
	if (event.target.closest('[data-follow]')) {
		followItem(item);
		return;
	}
	selectItem(item);
}

/** A double click is the deliberate reveal (UX child design §2). */
function onRowDoubleClick(event) {
	if (!(event.target instanceof Element)) {
		return;
	}
	const item = event.target.closest('#tree [role="treeitem"]');
	if (!item || event.target.closest('.twisty') || event.target.closest('[data-follow]')) {
		return;
	}
	revealItem(item);
}

function onTreeKeydown(event) {
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
	const page = Math.max(1, Math.floor(main.clientHeight / rowHeight()));
	const moved = moveTarget(event.key, at, items.length, page);
	if (moved !== undefined) {
		event.preventDefault();
		focusItem(items[moved]);
		return;
	}
	if (event.key === 'ArrowRight') {
		event.preventDefault();
		if (group && item.getAttribute('aria-expanded') !== 'true') {
			flipCollapsed(item.dataset.nodeId);
		} else if (group) {
			focusItem(group.firstElementChild);
		}
	} else if (event.key === 'ArrowLeft') {
		event.preventDefault();
		if (group && item.getAttribute('aria-expanded') === 'true') {
			flipCollapsed(item.dataset.nodeId);
		} else {
			focusItem(item.parentElement.closest('#tree [role="treeitem"]'));
		}
	} else if (event.key === 'Enter') {
		event.preventDefault();
		// A leaf has nothing to toggle, so revealing it is the only useful action; a
		// container is revealed with Ctrl/Alt+Enter or a double click (design §2).
		if (event.ctrlKey || event.altKey) {
			revealItem(item);
		} else if (group) {
			flipCollapsed(item.dataset.nodeId);
		} else {
			revealItem(item);
		}
	} else if (event.key === ' ') {
		event.preventDefault();
		selectItem(item);
	} else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
		typeAheadJump(event.key);
	}
}

/** Collapse-all: hide every subtree, leaving the selection and the scroll alone. */
function collapseAll() {
	collapsed = new Set(
		collapsedIdsFor(allItems().map((item) => ({ id: item.dataset.nodeId, hasChildren: itemHasChildren(item) })))
	);
	applyCollapsed();
}

/** Expand-all: the same, the other way. Selection and scroll are untouched. */
function expandAll() {
	collapsed = new Set();
	applyCollapsed();
}

document.addEventListener('click', onRowClick);
document.addEventListener('dblclick', onRowDoubleClick);
document.addEventListener('keydown', onTreeKeydown);
document.getElementById('collapse-all').addEventListener('click', collapseAll);
document.getElementById('expand-all').addEventListener('click', expandAll);

window.addEventListener('message', (event) => {
	const message = event.data;
	if (!message) {
		return;
	}
	if (message.type === 'model') {
		selectedId = message.selectedId;
		reRenderTree(message.tree, {
			readScrollTop: () => main.scrollTop,
			writeHtml: (tree) => {
				main.innerHTML = tree;
			},
			pruneCollapsed: prune,
			applyCollapsed: () => applyCollapsed(),
			applyFilter: applyFilter,
			prepareFocus: prepareFocus,
			writeScrollTop: (top) => {
				main.scrollTop = top;
			},
		});
	} else if (message.type === 'select') {
		setSelection(message.nodeId);
		prepareFocus();
	} else if (message.type === 'notice') {
		notice.textContent = message.message;
		if (message.kind) {
			notice.dataset.kind = message.kind;
		} else {
			delete notice.dataset.kind;
		}
	}
});

applyFilter();
prepareFocus();
`;
