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
	Range,
	ReferenceNode,
	SortMode,
	Suffixes,
	lastShortName,
} from '../core/ecuc/model';
import { SORT_EXCEPTIONS, orderContainers, orderMembers, orderModules } from '../core/ecuc/order';
import { LineIndex } from '../core/text/offsets';
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
	/**
	 * The current document text's line index. When present, every node carries its
	 * 0-based source position as data attributes; the details inspector adds one for
	 * display. The renderer never guesses a position from the displayed order.
	 */
	lineIndex?: LineIndex;
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
<body data-view="document">
<div class="toolbar">
<div class="filter-wrap">
<input id="filter" class="filter" type="search" placeholder="Filter labels, short names and values" aria-label="Filter the ECUC tree">
<button id="filter-clear" class="filter-clear" type="button" title="Clear the filter" aria-label="Clear the filter" hidden>&times;</button>
</div>
<span id="count" class="count" role="status" aria-live="polite" data-state="none"></span>
<span id="notice" class="notice" role="status" aria-live="polite"></span>
<span class="grow"></span>
<button id="expand-all" class="tool" type="button" title="Expand every container">Expand all</button>
<button id="collapse-all" class="tool" type="button" title="Collapse every container">Collapse all</button>
<button id="view-toggle" class="tool" type="button" aria-pressed="true" title="Switch to tree view">Tree</button>
<button id="details-toggle" class="tool" type="button" aria-pressed="false" aria-controls="inspector" title="Show node details">Details</button>
</div>
<div id="content">
<div id="main">${renderTree(model, options)}</div>
<aside id="inspector" class="inspector" role="region" aria-label="Node details" hidden>
<div class="inspector-empty">
<p>Select a node to see its details.</p>
<p class="inspector-hint">Double-click a row to reveal it in the source.</p>
</div>
</aside>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
${valueEditorScript()}
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
		lineIndex: options.lineIndex,
		first: true,
	};

	const meta: string[] = [];
	if (model.schema) {
		meta.push(`<div class="schema"><span class="keyword">schema</span> ${escapeHtml(model.schema.release)}</div>`);
	}
	for (const pkg of model.packages) {
		meta.push(`<div class="package"><span class="keyword">package</span> ${escapeHtml(pkg.path.join('.'))}</div>`);
	}

	const modules = orderModules(model.modules, ctx.sort, ctx.except);
	const items = modules.map((module, at) => moduleItem(ctx, module, 1, at + 1, modules.length));
	return (
		`<div class="meta">${meta.join('')}</div>` +
		`<div id="tree" class="tree" role="tree" aria-label="ECUC values">${items.join('')}</div>` +
		`<div id="empty" class="empty" hidden><p id="empty-text"></p><button id="empty-clear" class="tool" type="button">Clear filter</button></div>`
	);
}

interface Ctx {
	index: NodeIndex;
	sort: SortMode;
	except: readonly string[];
	selectedId?: string;
	/** Source line/column for the inspector; absent when the caller has no document text. */
	lineIndex?: LineIndex;
	/** True until the first item is written; it carries the roving `tabindex="0"`. */
	first: boolean;
}

interface ItemSpec {
	id: string;
	kind: string;
	label: string;
	shortName?: string;
	/** Full slash-delimited `DEFINITION-REF`, for the inspector and Copy path. */
	definitionRef: string;
	/** The raw value Copy value should carry, where the entity has one. */
	value?: string;
	/** The raw reference target, where the entity has one. */
	target?: string;
	/** The rendered value cell; absent for modules and containers. */
	valueHtml?: string;
	/** Hover text: the full `DEFINITION-REF` path where there is one (design §2.7). */
	title: string;
	level: number;
	/** Position within its group, and the group's size, for `aria-posinset` / `aria-setsize`. */
	posinset: number;
	setsize: number;
	meta: string[];
	children: string[];
	/** The node's own source range, for the line/column the inspector shows. */
	range: Range;
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
	const target = spec.kind === 'reference' ? ` data-target="${escapeAttr(spec.target ?? '')}"` : '';
	// The source position is carried as data, not hover text, so the inspector can show it
	// without a host round-trip. `LineIndex` is 0-based like a VS Code Position; the
	// inspector adds one for display.
	const start = ctx.lineIndex?.positionAt(spec.range.start);
	const end = ctx.lineIndex?.positionAt(spec.range.end);
	const position =
		start && end
			? ` data-line="${start.line}" data-column="${start.character}"` +
				` data-end-line="${end.line}" data-end-column="${end.character}"`
			: '';
	const group = hasChildren ? `<div role="group" class="children">${spec.children.join('')}</div>` : '';
	// A toggle only where there is something to toggle; a leaf gets a spacer instead, so
	// the labels of leaves and containers line up (UX child design §4.2).
	const twisty = hasChildren
		? `<span class="twisty" aria-hidden="true">${TWISTY_SVG}</span>`
		: '<span class="spacer" aria-hidden="true"></span>';
	const rowClass = `row k-${spec.kind}${spec.valueHtml ? ' has-value' : ' no-value'}`;
	const meta = spec.meta.length > 0 ? `<span class="row-meta">${spec.meta.join('')}</span>` : '';
	return (
		`<div class="node" role="treeitem" aria-level="${spec.level}" aria-posinset="${spec.posinset}"` +
		` aria-setsize="${spec.setsize}" aria-selected="${selected ? 'true' : 'false'}"${expanded}` +
		` tabindex="${focusable ? '0' : '-1'}"` +
		` data-node-id="${escapeAttr(spec.id)}" data-kind="${escapeAttr(spec.kind)}"` +
		` data-definition-ref="${escapeAttr(spec.definitionRef)}"` +
		` data-short-name="${escapeAttr(spec.shortName ?? '')}"` +
		` data-haystack="${escapeAttr(haystack(spec))}"${editable}${target}${position}` +
		`${selected ? ' data-selected="true"' : ''}` +
		` title="${escapeAttr(spec.title)}">` +
		`<span class="${rowClass}">${twisty}<span class="glyph" aria-hidden="true">${GLYPHS[spec.kind] ?? ''}</span>` +
		`<span class="label">${escapeHtml(spec.label)}</span>${spec.valueHtml ?? ''}${meta}</span>${group}</div>`
	);
}

function moduleItem(ctx: Ctx, module: ModuleNode, level: number, posinset: number, setsize: number): string {
	const containers = orderContainers(module.containers, ctx.sort, ctx.except);
	return item(ctx, {
		id: ctx.index.idOf(module) ?? '',
		kind: 'module',
		label: dotted(module.definitionRef),
		shortName: module.shortName,
		definitionRef: module.definitionRef,
		title: module.definitionRef,
		level,
		posinset,
		setsize,
		range: module.range,
		meta: [
			`<span class="short" title="${escapeAttr(module.shortName)}">"${escapeHtml(module.shortName)}"</span>`,
			module.variant
				? `<span class="variant" title="${escapeAttr(camelize(module.variant))}">(${escapeHtml(
						camelize(module.variant)
					)})</span>`
				: '',
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
		definitionRef: container.definitionRef,
		title: container.definitionRef,
		level,
		posinset,
		setsize,
		range: container.range,
		meta: [
			`<span class="short" title="${escapeAttr(container.shortName)}">"${escapeHtml(container.shortName)}"</span>`,
			...suffixSpans(container),
		],
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
	// The reference ARTEXT grammar distinguishes strings, numeric literals and booleans.
	// Keep that split for parameter values instead of painting every value with the numeric
	// token; reference targets get the link colour in `referenceItem`.
	const valueKind = parameter.numeric
		? /^(true|false)$/i.test(value)
			? 'boolean'
			: 'numeric'
		: 'textual';
	return item(ctx, {
		id: ctx.index.idOf(parameter) ?? '',
		kind: 'parameter',
		label: parameter.name,
		definitionRef: parameter.definitionRef,
		value,
		// The value is the first line's fourth column, so it stays aligned across
		// siblings; the hex and the suffixes move to the quieter second line.
		valueHtml: `<span class="value" data-value-kind="${valueKind}" title="${escapeAttr(
			'Click to edit, or press F2: = ' + shown
		)}">= ${escapeHtml(shown)}</span>`,
		title: parameter.definitionRef,
		level,
		posinset,
		setsize,
		range: parameter.range,
		meta: [
			parameter.hexValue
				? `<span class="hex" title="${escapeAttr('(= ' + parameter.hexValue + ')')}">(= ${escapeHtml(
						parameter.hexValue
					)})</span>`
				: '',
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
	const rawTarget = reference.targetRawPath ?? target;
	const context = reference.instance && reference.contextPaths.length > 0
		? `<span class="context" title="${escapeAttr(
				'context ' + reference.contextPaths.join(', ')
			)}">context ${escapeHtml(reference.contextPaths.join(', '))}</span>`
		: '';
	return item(ctx, {
		id: ctx.index.idOf(reference) ?? '',
		kind: 'reference',
		label: reference.name,
		definitionRef: reference.definitionRef,
		value: target,
		target: rawTarget,
		// The target is the row's follow affordance — not the whole row, which selects
		// now (UX child design §2, §5).
		valueHtml: `<span class="value target" data-follow="true" title="${escapeAttr(
			'Follow to the target: = ' + target
		)}">= ${escapeHtml(target)}</span>`,
		title: reference.definitionRef,
		level,
		posinset,
		setsize,
		range: reference.range,
		meta: [context, ...suffixSpans(reference)].filter(Boolean),
		children: [],
	});
}

/** Conditions and annotations, in the legacy order: syscond, variant conditions, annotations. */
function suffixSpans(node: Suffixes): string[] {
	const spans: string[] = [];
	if (node.syscond) {
		spans.push(
			`<span class="condition" title="${escapeAttr('[' + node.syscond + ']')}">[${escapeHtml(
				node.syscond
			)}]</span>`
		);
	}
	if (node.postBuildVariants && node.postBuildVariants.length > 0) {
		const text = node.postBuildVariants.map((v) => `${v.criterion} ${v.operator} ${v.value}`).join(' && ');
		spans.push(
			`<span class="condition" title="${escapeAttr('<' + text + '>')}">&lt;${escapeHtml(text)}&gt;</span>`
		);
	}
	for (const annotation of node.annotations ?? []) {
		const label = annotation.label ? `[${annotation.label}] ` : '';
		const text = annotation.text ?? '';
		if (label === '' && text === '') {
			continue;
		}
		spans.push(
			`<span class="annotation" title="${escapeAttr(label + text)}">${escapeHtml(label + text)}</span>`
		);
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
	font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif);
	font-size: var(--vscode-font-size, 13px);
	line-height: 1.4;
	color: var(--vscode-foreground);
	background: var(--vscode-editor-background);
	margin: 0;
	display: flex;
	flex-direction: column;
	overflow: hidden;
}
.toolbar {
	display: flex;
	flex-wrap: wrap;
	gap: 6px 8px;
	align-items: center;
	padding: 6px 10px;
	flex: none;
	background: var(--vscode-editor-background);
	border-bottom: 1px solid var(--vscode-panel-border);
}
.grow {
	flex: 1 1 auto;
}
.filter-wrap {
	position: relative;
	display: flex;
	flex: 1 1 280px;
	max-width: 560px;
	min-width: 180px;
}
.filter {
	width: 100%;
	min-width: 0;
	padding: 3px 24px 3px 8px;
	color: var(--vscode-input-foreground);
	background: var(--vscode-input-background);
	border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, transparent));
}
.filter:focus-visible {
	outline: 1px solid var(--vscode-focusBorder, var(--vscode-contrastActiveBorder, transparent));
	outline-offset: -1px;
}
.filter-clear {
	position: absolute;
	right: 3px;
	top: 50%;
	transform: translateY(-50%);
	padding: 0 4px;
	font: inherit;
	line-height: 1;
	cursor: pointer;
	color: var(--vscode-input-foreground);
	background: transparent;
	border: 0;
}
.filter-clear[hidden] {
	display: none;
}
.filter-clear:hover {
	color: var(--vscode-foreground);
}
.count {
	padding: 1px 7px;
	border: 1px solid transparent;
	border-radius: 9px;
	white-space: nowrap;
	color: var(--vscode-badge-foreground, var(--vscode-foreground));
	background: var(--vscode-badge-background, transparent);
}
.count[data-state="none"] {
	padding: 0;
	background: transparent;
}
.count[data-state="empty"] {
	color: var(--vscode-foreground);
	background: var(--vscode-inputValidation-warningBackground, var(--vscode-badge-background, transparent));
	border-color: var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border, transparent));
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
.tool:focus-visible {
	outline: 1px solid var(--vscode-focusBorder, var(--vscode-contrastActiveBorder, transparent));
	outline-offset: 1px;
}
.notice {
	flex: 0 1 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--vscode-foreground);
}
.notice[data-kind="warn"] {
	color: var(--vscode-editorWarning-foreground);
}
#content {
	display: flex;
	flex: 1 1 auto;
	min-height: 0;
}
#main {
	flex: 1 1 auto;
	min-width: 0;
	overflow: auto;
}
#inspector {
	flex: 0 0 300px;
	min-width: 220px;
	overflow: auto;
	padding: 8px 10px 16px;
	border-left: 1px solid var(--vscode-panel-border);
	background: var(--vscode-sideBar-background, var(--vscode-editor-background));
}
#inspector[hidden] {
	display: none;
}
.meta {
	padding: 6px 10px;
	color: var(--vscode-descriptionForeground);
}
.schema, .package {
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
}
.tree {
	padding: 4px 0 12px;
}
.node {
	outline: none;
}
.row {
	display: grid;
	grid-template-columns: 12px 12px 26ch minmax(0, 1fr);
	column-gap: 6px;
	row-gap: 1px;
	align-items: center;
	padding: 2px 8px 2px 4px;
}
.row:hover {
	background: var(--vscode-list-hoverBackground);
}
.twisty {
	grid-column: 1;
	grid-row: 1;
	width: 12px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	color: var(--vscode-icon-foreground, var(--vscode-foreground));
}
.spacer {
	grid-column: 1;
	grid-row: 1;
	width: 12px;
}
.twisty svg {
	transition: transform 120ms ease;
}
.node[aria-expanded="true"] > .row > .twisty svg {
	transform: rotate(90deg);
}
.glyph {
	grid-column: 2;
	grid-row: 1;
	width: 12px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	color: var(--vscode-icon-foreground, var(--vscode-foreground));
}
.label {
	grid-column: 3;
	grid-row: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: 600;
}
.row.no-value .label {
	grid-column: 3 / -1;
}
.value {
	grid-column: 4;
	grid-row: 1;
	justify-self: start;
	min-width: 0;
	max-width: 100%;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--vscode-foreground);
}
.value[data-value-kind="numeric"] {
	color: var(--vscode-symbolIcon-numberForeground, var(--vscode-symbolIcon-fieldForeground, var(--vscode-foreground)));
}
.value[data-value-kind="textual"] {
	color: var(--vscode-symbolIcon-stringForeground, var(--vscode-foreground));
}
.value[data-value-kind="boolean"] {
	color: var(--vscode-symbolIcon-booleanForeground, var(--vscode-symbolIcon-keywordForeground, var(--vscode-foreground)));
}
.row-meta {
	grid-column: 3 / -1;
	grid-row: 2;
	display: flex;
	flex-wrap: wrap;
	gap: 2px 8px;
	min-width: 0;
	font-size: 0.9em;
	color: var(--vscode-descriptionForeground);
}
.row-meta > span {
	min-width: 0;
	max-width: 100%;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.row.k-module {
	border-left: 2px solid var(--vscode-symbolIcon-moduleForeground, var(--vscode-symbolIcon-classForeground, var(--vscode-foreground)));
}
.row.k-container {
	border-left: 2px solid var(--vscode-symbolIcon-namespaceForeground, var(--vscode-symbolIcon-classForeground, var(--vscode-foreground)));
}
.row.k-parameter {
	border-left: 2px solid var(--vscode-symbolIcon-fieldForeground, var(--vscode-foreground));
}
.row.k-reference {
	border-left: 2px solid var(--vscode-symbolIcon-referenceForeground, var(--vscode-foreground));
}
.glyph .g-module {
	color: var(--vscode-symbolIcon-moduleForeground, var(--vscode-symbolIcon-classForeground, var(--vscode-icon-foreground)));
}
.glyph .g-container {
	color: var(--vscode-symbolIcon-namespaceForeground, var(--vscode-symbolIcon-classForeground, var(--vscode-icon-foreground)));
}
.glyph .g-parameter {
	color: var(--vscode-symbolIcon-fieldForeground, var(--vscode-icon-foreground));
}
.glyph .g-reference {
	color: var(--vscode-symbolIcon-referenceForeground, var(--vscode-icon-foreground));
}
.node:focus-visible > .row {
	--ecuc-selection-fg: var(--vscode-list-activeSelectionForeground);
	outline: 1px solid var(--vscode-focusBorder);
	outline-offset: -1px;
	background: var(--vscode-list-focusBackground, var(--vscode-list-hoverBackground));
}
.node[data-selected="true"] > .row {
	--ecuc-selection-fg: var(--vscode-list-activeSelectionForeground);
	background: var(--vscode-list-activeSelectionBackground);
	color: var(--ecuc-selection-fg);
	outline: 1px solid var(--vscode-contrastActiveBorder, transparent);
	outline-offset: -1px;
}
body:not(:focus-within) .node[data-selected="true"] > .row {
	--ecuc-selection-fg: var(--vscode-list-inactiveSelectionForeground);
	background: var(--vscode-list-inactiveSelectionBackground);
	color: var(--ecuc-selection-fg);
}
/* Token colours are for the normal background. On a selection they can fall to ~1.2:1
 * (the light theme's green value on the blue selection is the worst case), so the whole
 * selected row uses the theme's selection foreground. The custom property lets the
 * active and inactive states share one rule. */
:is(.node[data-selected="true"], .node:focus-visible) > .row > .value,
:is(.node[data-selected="true"], .node:focus-visible) > .row .short,
:is(.node[data-selected="true"], .node:focus-visible) > .row .variant,
:is(.node[data-selected="true"], .node:focus-visible) > .row .hex,
:is(.node[data-selected="true"], .node:focus-visible) > .row .condition,
:is(.node[data-selected="true"], .node:focus-visible) > .row .annotation,
:is(.node[data-selected="true"], .node:focus-visible) > .row .context {
	color: var(--ecuc-selection-fg);
}
/* The marker, twisty and kind border are part of the selected/focused row too. */
:is(.node[data-selected="true"], .node:focus-visible) > .row > .twisty,
:is(.node[data-selected="true"], .node:focus-visible) > .row .glyph svg {
	color: var(--ecuc-selection-fg);
}
:is(.node[data-selected="true"], .node:focus-visible) > .row.k-module,
:is(.node[data-selected="true"], .node:focus-visible) > .row.k-container,
:is(.node[data-selected="true"], .node:focus-visible) > .row.k-parameter,
:is(.node[data-selected="true"], .node:focus-visible) > .row.k-reference {
	border-left-color: var(--ecuc-selection-fg);
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
.keyword {
	color: var(--vscode-symbolIcon-keywordForeground, var(--vscode-foreground));
}
.variant {
	color: var(--vscode-symbolIcon-enumeratorForeground, var(--vscode-foreground));
}
.condition {
	padding: 0 4px;
	border: 1px solid var(--vscode-panel-border, transparent);
	border-radius: 3px;
	color: var(--vscode-symbolIcon-keywordForeground, var(--vscode-foreground));
}
.annotation {
	padding: 0 4px;
	border: 1px solid var(--vscode-panel-border, transparent);
	border-radius: 3px;
	color: var(--vscode-descriptionForeground);
	font-style: italic;
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
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	color: var(--vscode-input-foreground);
	background: var(--vscode-input-background);
	border: 1px solid var(--vscode-focusBorder);
}
.value-edit[aria-invalid="true"] {
	border-color: var(--vscode-editorError-foreground, var(--vscode-errorForeground));
}
.target {
	color: var(--vscode-textLink-foreground, var(--vscode-symbolIcon-referenceForeground, var(--vscode-foreground)));
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
.empty {
	padding: 36px 20px;
	text-align: center;
	color: var(--vscode-descriptionForeground);
}
.empty[hidden] {
	display: none;
}
.empty p {
	margin: 0 0 10px;
}
.inspector-empty {
	padding: 6px 0;
	color: var(--vscode-descriptionForeground);
}
.inspector-empty p {
	margin: 0 0 6px;
}
.inspector-hint {
	font-size: 0.9em;
}
.inspector-kind {
	font-size: 0.8em;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--vscode-descriptionForeground);
}
.inspector-label {
	margin: 2px 0 10px;
	font-weight: 600;
	word-break: break-word;
}
.inspector-row {
	margin: 0 0 9px;
}
.inspector-key {
	display: block;
	margin-bottom: 2px;
	font-size: 0.75em;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--vscode-descriptionForeground);
}
.inspector-code {
	margin: 0;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	white-space: pre-wrap;
	word-break: break-word;
}
.inspector-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	margin-top: 12px;
}
/* Document view: an editor-like text surface over the same tree DOM. The tree
 * chrome (chips, per-row borders, two-line grid, value underlines) is absent;
 * see the document-editor-look task design. */
body[data-view="document"] #tree {
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--vscode-editor-font-size, 14px);
	line-height: 1.5;
	padding: 8px 0 24px 3.5ch;
}
body[data-view="document"] .meta {
	padding: 4px 0 2px 3.5ch;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--vscode-editor-font-size, 14px);
	color: var(--vscode-editor-foreground);
}
body[data-view="document"] .schema,
body[data-view="document"] .package {
	font-family: inherit;
}
body[data-view="document"] .meta .keyword {
	color: var(--vscode-symbolIcon-keywordForeground, var(--vscode-editor-foreground));
}
body[data-view="document"] .row {
	position: relative;
	display: flex;
	flex-wrap: nowrap;
	gap: 1ch;
	align-items: baseline;
	padding: 0;
	border: 0;
	background: transparent;
}
body[data-view="document"] .node:hover > .row {
	background: transparent;
}
body[data-view="document"] .row.k-module,
body[data-view="document"] .row.k-container,
body[data-view="document"] .row.k-parameter,
body[data-view="document"] .row.k-reference {
	border-left: 0;
}
body[data-view="document"] .glyph {
	display: none;
}
/* The twisty lives in the gutter, not in the text flow, so labels align on
 * exact 4ch steps and the brace returns to the parent text start. */
body[data-view="document"] .twisty,
body[data-view="document"] .spacer {
	position: absolute;
	left: -2.2ch;
	top: 0.1em;
	width: 1.2ch;
	height: 1.2em;
	margin: 0;
	padding: 0;
	flex: none;
}
body[data-view="document"] .twisty svg {
	width: 8px;
	height: 8px;
}
/* Keep the document free of list-like markers; the toggle appears on hover/focus. */
body[data-view="document"] .twisty {
	opacity: 0;
}
body[data-view="document"] .row:hover .twisty,
body[data-view="document"] .node:focus-visible > .row .twisty {
	opacity: 1;
}
body[data-view="document"] .label {
	flex: 0 0 auto;
	overflow: visible;
	text-overflow: clip;
	white-space: pre;
	font-weight: 400;
	color: var(--vscode-editor-foreground);
}
body[data-view="document"] .value {
	flex: 0 0 auto;
	margin: 0;
	max-width: none;
	overflow: visible;
	text-overflow: clip;
	white-space: pre;
}
body[data-view="document"] .row-meta {
	display: flex;
	flex: 0 0 auto;
	flex-wrap: nowrap;
	gap: 1ch;
	margin: 0;
	font-size: inherit;
	color: var(--vscode-descriptionForeground);
	white-space: pre;
}
body[data-view="document"] .row-meta > span {
	max-width: none;
	overflow: visible;
	white-space: pre;
	margin: 0;
}
body[data-view="document"] .condition,
body[data-view="document"] .annotation {
	padding: 0;
	border: 0;
	border-radius: 0;
}
body[data-view="document"] .annotation::before {
	content: "/* ";
}
body[data-view="document"] .annotation::after {
	content: " */";
}
body[data-view="document"] .row.k-module .label::before {
	content: "module ";
	color: var(--vscode-symbolIcon-keywordForeground, var(--vscode-foreground));
}
body[data-view="document"] .variant,
body[data-view="document"] .condition,
body[data-view="document"] .context {
	color: var(--vscode-descriptionForeground);
}
body[data-view="document"] .hex {
	color: var(--vscode-symbolIcon-numberForeground, var(--vscode-foreground));
}
body[data-view="document"] .target {
	color: var(--vscode-editor-foreground);
	text-decoration: none;
}
body[data-view="document"] .target:hover {
	color: var(--vscode-textLink-foreground, var(--vscode-symbolIcon-referenceForeground, var(--vscode-foreground)));
	text-decoration: underline;
}
body[data-view="document"] .children {
	margin-left: 4ch;
	border-left: 0;
}
body[data-view="document"] .children::before,
body[data-view="document"] .children::after {
	display: block;
	margin-left: -4ch;
	color: var(--vscode-descriptionForeground);
	white-space: pre;
}
body[data-view="document"] .children::before {
	content: "{";
}
body[data-view="document"] .children::after {
	content: "}";
}
/* A document selection is a quiet line highlight, not the list's blue bar. */
body[data-view="document"] .node[data-selected="true"] > .row,
body[data-view="document"] .node:focus-visible > .row {
	--ecuc-selection-fg: var(--vscode-editor-foreground);
	background: var(--vscode-editor-lineHighlightBackground, var(--vscode-list-inactiveSelectionBackground));
	outline: none;
}
body[data-view="document"] .node:focus-visible > .row {
	box-shadow: inset 2px 0 0 var(--vscode-focusBorder);
}
/* Values are text in Document view: no dotted underline or hover pencil. */
body[data-view="document"] .row.k-parameter > .value {
	border-bottom: 0;
}
body[data-view="document"] .row.k-parameter:hover > .value::after {
	content: none;
}
body[data-view="document"] .value-edit {
	padding: 0 2px;
	font-size: inherit;
	line-height: inherit;
	vertical-align: baseline;
}
/* A slimmer document bar; the actions and Tree view are unchanged. */
body[data-view="document"] .toolbar {
	min-height: 0;
	padding: 3px 8px;
	gap: 3px 4px;
}
body[data-view="document"] .filter-wrap {
	max-width: 240px;
}
body[data-view="document"] .toolbar .filter {
	max-width: 240px;
	height: 22px;
	font-size: 12px;
	border-color: transparent;
	background: var(--vscode-input-background);
	border-radius: 2px;
}
body[data-view="document"] .toolbar .tool {
	padding: 2px 6px;
	border: 0;
	background: transparent;
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
}
body[data-view="document"] .toolbar .tool:hover {
	color: var(--vscode-foreground);
	background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
}
body[data-view="document"] .toolbar .count {
	font-size: 11px;
}
body[data-view="document"] :is(.node[data-selected="true"], .node:focus-visible) > .row > .label,
body[data-view="document"] :is(.node[data-selected="true"], .node:focus-visible) > .row > .label::before {
	color: var(--ecuc-selection-fg);
}
@media (max-width: 720px) {
	#content {
		flex-direction: column;
	}
	#inspector {
		flex: 0 0 auto;
		min-width: 0;
		max-height: 42%;
		border-left: 0;
		border-top: 1px solid var(--vscode-panel-border);
	}
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
const inspector = document.getElementById('inspector');
const detailsToggle = document.getElementById('details-toggle');
const viewToggle = document.getElementById('view-toggle');
const savedState = vscode.getState();
// Only the object shape this page writes is accepted; anything else starts clean.
let viewState =
	savedState && typeof savedState === 'object' && !Array.isArray(savedState) ? savedState : {};
if (viewState.view !== 'tree' && viewState.view !== 'document') {
	viewState.view = 'document';
}
if (typeof viewState.inspectorHidden !== 'boolean') {
	viewState.inspectorHidden = true;
}
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
	updateInspector();
}

function textOf(parent, selector) {
	const element = parent.querySelector(selector);
	return element ? element.textContent : '';
}

function inspectorElement(tag, className, text) {
	const element = document.createElement(tag);
	if (className) {
		element.className = className;
	}
	if (text !== undefined) {
		element.textContent = text;
	}
	return element;
}

function inspectorRow(key, value) {
	const row = inspectorElement('div', 'inspector-row');
	row.appendChild(inspectorElement('span', 'inspector-key', key));
	row.appendChild(inspectorElement('div', 'inspector-code', value));
	return row;
}

/**
 * Rebuilds the details panel from the selected row. It reads the model-derived data
 * attributes and the rendered secondary spans; it never re-parses the source and never
 * uses innerHTML with model text. The panel lives outside #main, so a re-scan does not
 * destroy it.
 */
function updateInspector() {
	if (!inspector || inspector.hidden) {
		return;
	}
	inspector.textContent = '';
	const item = selectedId === undefined
		? undefined
		: allItems().find((candidate) => candidate.dataset.nodeId === selectedId);
	if (!item) {
		const empty = inspectorElement('div', 'inspector-empty');
		empty.appendChild(inspectorElement('p', '', 'Select a node to see its details.'));
		empty.appendChild(inspectorElement('p', 'inspector-hint', 'Double-click a row to reveal it in the source.'));
		inspector.appendChild(empty);
		return;
	}
	const row = item.querySelector(':scope > .row');
	if (!row) {
		return;
	}
	const kind = item.dataset.kind || 'node';
	const label = textOf(row, ':scope > .label');
	const definitionRef = item.dataset.definitionRef || item.title || '';
	const shortName = item.dataset.shortName || '';
	const value = item.dataset.value || '';
	const target = item.dataset.target || '';
	const variant = textOf(row, '.row-meta .variant');
	const hex = textOf(row, '.row-meta .hex');
	const contextText = textOf(row, '.row-meta .context');
	const context = contextText.startsWith('context ') ? contextText.slice('context '.length) : contextText;
	const conditions = Array.from(row.querySelectorAll('.row-meta .condition')).map((element) => element.textContent).join('\\n');
	const annotations = Array.from(row.querySelectorAll('.row-meta .annotation')).map((element) => element.textContent).join('\\n');
	const line = item.dataset.line;
	const column = item.dataset.column;
	const endLine = item.dataset.endLine;
	const endColumn = item.dataset.endColumn;

	inspector.appendChild(inspectorElement('div', 'inspector-kind', kind));
	inspector.appendChild(inspectorElement('div', 'inspector-label', label));
	if (definitionRef) {
		inspector.appendChild(inspectorRow('Definition', definitionRef));
	}
	if (shortName) {
		inspector.appendChild(inspectorRow('Short name', shortName));
	}
	if (variant) {
		inspector.appendChild(inspectorRow('Variant', variant));
	}
	if (kind === 'parameter') {
		inspector.appendChild(inspectorRow('Value', value === '' ? '(empty)' : value));
	}
	if (hex) {
		inspector.appendChild(inspectorRow('Hexadecimal', hex));
	}
	if (target) {
		inspector.appendChild(inspectorRow('Target', target));
	}
	if (context) {
		inspector.appendChild(inspectorRow('Context', context));
	}
	if (conditions) {
		inspector.appendChild(inspectorRow('Conditions', conditions));
	}
	if (annotations) {
		inspector.appendChild(inspectorRow('Annotations', annotations));
	}
	if (line !== undefined && column !== undefined && endLine !== undefined && endColumn !== undefined) {
		inspector.appendChild(
			inspectorRow(
				'Source',
				'L' + (Number(line) + 1) + ':' + (Number(column) + 1) + ' - L' + (Number(endLine) + 1) + ':' + (Number(endColumn) + 1)
			)
		);
	}

	const actions = inspectorElement('div', 'inspector-actions');
	const reveal = inspectorElement('button', 'tool', 'Reveal in source');
	reveal.type = 'button';
	reveal.addEventListener('click', () => revealItem(item));
	actions.appendChild(reveal);
	const path = definitionRef || label;
	if (path) {
		const copyPath = inspectorElement('button', 'tool', 'Copy path');
		copyPath.type = 'button';
		copyPath.addEventListener('click', () => vscode.postMessage({ type: 'copy', text: path }));
		actions.appendChild(copyPath);
	}
	const valueText = target || value;
	if (valueText) {
		const copyValue = inspectorElement('button', 'tool', target ? 'Copy target' : 'Copy value');
		copyValue.type = 'button';
		copyValue.addEventListener('click', () => vscode.postMessage({ type: 'copy', text: valueText }));
		actions.appendChild(copyValue);
	}
	inspector.appendChild(actions);
}

function prepareFocus() {
	// A host-rendered selection (source -> editor, or a pending selection) arrives as
	// markup, not as a message. Adopt it before the first paint so the details panel is
	// not empty until the user clicks.
	if (selectedId === undefined) {
		const marked = document.querySelector('#tree [aria-selected="true"]');
		if (marked) {
			selectedId = marked.dataset.nodeId;
		}
	}
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
function applyView() {
	document.body.dataset.view = viewState.view;
	if (!viewToggle) {
		return;
	}
	const isDocument = viewState.view === 'document';
	viewToggle.setAttribute('aria-pressed', isDocument ? 'true' : 'false');
	viewToggle.textContent = isDocument ? 'Tree' : 'Document';
	viewToggle.title = isDocument ? 'Switch to tree view' : 'Switch to document view';
}

function applyInspectorVisibility() {
	if (!inspector || !detailsToggle) {
		return;
	}
	inspector.hidden = viewState.inspectorHidden === true;
	detailsToggle.setAttribute('aria-pressed', inspector.hidden ? 'false' : 'true');
	detailsToggle.title = inspector.hidden ? 'Show node details' : 'Hide node details';
}

if (viewToggle) {
	viewToggle.addEventListener('click', () => {
		viewState.view = viewState.view === 'document' ? 'tree' : 'document';
		applyView();
		vscode.setState(viewState);
	});
}

if (detailsToggle && inspector) {
	detailsToggle.addEventListener('click', () => {
		viewState.inspectorHidden = !viewState.inspectorHidden;
		applyInspectorVisibility();
		vscode.setState(viewState);
		if (!viewState.inspectorHidden) {
			updateInspector();
		}
	});
}

// The view and panel preferences survive a re-scan (the shell is not swapped) and a
// full webview reload (the host state); the harness persists the same state in
// localStorage so the browser loop can exercise it.
applyView();
applyInspectorVisibility();

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
		updateInspector();
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
updateInspector();
`;
