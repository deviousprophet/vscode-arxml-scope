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
<input id="filter" class="filter" type="search" placeholder="Filter" aria-label="Filter the ECUC tree">
<button id="filter-clear" class="filter-clear" type="button" title="Clear the filter" aria-label="Clear the filter" hidden><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
</div>
<span id="count" class="count" role="status" aria-live="polite" data-state="none"></span>
<span class="grow"></span>
<button id="collapse-all" class="tool icon-tool" type="button" title="Collapse every container" aria-label="Collapse every container"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3 6h4V2M3 6l4-4M13 10H9v4M13 10l-4 4"/></svg></button>
<button id="expand-all" class="tool icon-tool" type="button" title="Expand every container" aria-label="Expand every container"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M7 2v4H3M7 2L3 6M9 14v-4h4M9 14l4-4"/></svg></button>
<button id="view-toggle" class="tool view-switch" type="button" aria-pressed="true" title="Switch to tree view"><span class="view-document">Document</span><span class="view-sep" aria-hidden="true">|</span><span class="view-tree">Tree</span></button>
<button id="details-toggle" class="tool details-toggle" type="button" aria-pressed="false" aria-controls="inspector" title="Show node details" aria-label="Show node details"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6 3v10"/></svg><span class="lbl">Details</span></button>
</div>
<div id="notice" class="notice" role="status" aria-live="polite"></div>
<div id="content">
<div id="main">${renderTree(model, options)}</div>
<aside id="inspector" class="inspector" role="region" aria-label="Node details" hidden>
<div class="inspector-empty">
<p>Select a line to see its details.</p>
<p class="inspector-hint">Click a line or press Space.</p>
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
		maxLine: 0,
		first: true,
	};

	const meta: string[] = [];
	if (model.schema) {
		meta.push(
			`<div class="schema"><span class="keyword">schema</span> <span class="number">${escapeHtml(
				model.schema.release
			)}</span></div>`
		);
	}
	for (const pkg of model.packages) {
		meta.push(`<div class="package"><span class="keyword">package</span> ${escapeHtml(pkg.path.join('.'))}</div>`);
	}

	const modules = orderModules(model.modules, ctx.sort, ctx.except);
	const items = modules.map((module, at) => moduleItem(ctx, module, 1, at + 1, modules.length));
	const digits = String(Math.max(1, ctx.maxLine)).length;
	return (
		`<div class="document">` +
		`<div class="meta">${meta.join('')}</div>` +
		`<div id="tree" class="tree" role="tree" aria-label="ECUC values" data-ln-digits="${digits}">${items.join('')}</div>` +
		`<div id="empty" class="empty" hidden><p id="empty-text"></p><button id="empty-clear" class="tool" type="button">Clear filter</button></div>` +
		`</div>`
	);
}

interface Ctx {
	index: NodeIndex;
	sort: SortMode;
	except: readonly string[];
	selectedId?: string;
	/** Source line/column for the inspector; absent when the caller has no document text. */
	lineIndex?: LineIndex;
	/** Largest 1-based entity source line, used for the gutter width. */
	maxLine: number;
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
	const sourceLine = start ? start.line + 1 : 0;
	if (sourceLine > ctx.maxLine) {
		ctx.maxLine = sourceLine;
	}
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
		`<span class="${rowClass}"${sourceLine ? ` data-line="${sourceLine}"` : ''}>${twisty}<span class="glyph" aria-hidden="true">${GLYPHS[spec.kind] ?? ''}</span>` +
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
		)}"><span class="punct">=</span> <span class="value-text">${escapeHtml(shown)}</span></span>`,
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
			)}"><span class="keyword">context</span> ${escapeHtml(reference.contextPaths.join(', '))}</span>`
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
		)}"><span class="punct">=</span> <span class="value-text">${escapeHtml(target)}</span></span>`,
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
/* Quiet-source tokens: one definition for both views. Plain declarations first are
 * the fallback for hosts without color-mix; the second declaration refines them. */
body[data-view] {
	--ecuc-fs: var(--vscode-editor-font-size, 13px);
	--ecuc-lh: calc(var(--ecuc-fs) * 1.55);
	--tok-keyword: var(--vscode-debugTokenExpression-boolean, var(--vscode-editor-foreground));
	--tok-string: var(--vscode-debugTokenExpression-string, var(--vscode-editor-foreground));
	--tok-number: var(--vscode-debugTokenExpression-number, var(--vscode-editor-foreground));
	--tok-meta: var(--vscode-debugTokenExpression-name, var(--vscode-editor-foreground));
	--tok-comment: var(--vscode-charts-green, var(--vscode-editor-foreground));
	--tok-key: var(--vscode-symbolIcon-variableForeground, var(--vscode-editor-foreground));
	--tok-punct: var(--vscode-editor-foreground);
	--tok-dim: var(--vscode-editor-foreground);
	--hover-bg: var(--vscode-list-hoverBackground, transparent);
	--sel-bg: var(--vscode-editor-background);
	--sel-bg-focus: var(--vscode-editor-background);
	--rail: var(--vscode-focusBorder, var(--vscode-editorCursor-foreground, var(--vscode-editor-foreground)));
}
@supports (color: color-mix(in srgb, currentColor 50%, transparent)) {
	body[data-view] {
		--tok-comment: color-mix(in srgb, var(--vscode-charts-green, var(--vscode-editor-foreground)) 85%, var(--vscode-editor-background));
		--tok-punct: color-mix(in srgb, var(--vscode-editor-foreground) 70%, var(--vscode-editor-background));
		--tok-dim: color-mix(in srgb, var(--vscode-editor-foreground) 55%, var(--vscode-editor-background));
		/* A 10% dark / 2% fallback tint preserves token contrast; the light
		 * theme has no fill (below). The active line number and 2px rail
		 * carry the selection meaning. */
		--sel-bg: color-mix(in srgb, var(--vscode-list-inactiveSelectionBackground, var(--vscode-editor-background)) 2%, var(--vscode-editor-background));
		--sel-bg-focus: color-mix(in srgb, var(--vscode-list-activeSelectionBackground, var(--vscode-list-inactiveSelectionBackground, var(--vscode-editor-background))) 2%, var(--vscode-editor-background));
	}
	body.vscode-dark[data-view] {
		--sel-bg: color-mix(in srgb, var(--vscode-list-inactiveSelectionBackground, var(--vscode-editor-background)) 10%, var(--vscode-editor-background));
		--sel-bg-focus: color-mix(in srgb, var(--vscode-list-activeSelectionBackground, var(--vscode-list-inactiveSelectionBackground, var(--vscode-editor-background))) 10%, var(--vscode-editor-background));
	}
	body.vscode-light[data-view] {
		/* The light key accent is 4.51:1 on white; any fill would drop it below
		 * 4.5:1, so the light selection is the active line number + rail only. */
		--sel-bg: var(--vscode-editor-background);
		--sel-bg-focus: var(--vscode-editor-background);
	}
}
.toolbar {
	display: flex;
	flex-wrap: nowrap;
	gap: 6px;
	align-items: center;
	height: 26px;
	padding: 0 8px;
	flex: none;
	font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif);
	font-size: 12px;
	color: var(--tok-dim);
	background: var(--vscode-editor-background);
	border-bottom: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
}
.grow {
	flex: 1 1 auto;
}
.filter-wrap {
	position: relative;
	display: flex;
	flex: 0 1 28ch;
	min-width: 0;
	max-width: none;
}
.filter {
	width: 100%;
	min-width: 0;
	height: 20px;
	padding: 0 22px 0 6px;
	font: inherit;
	color: var(--vscode-editor-foreground);
	background: transparent;
	border: 1px solid transparent;
	border-radius: 2px;
}
.filter:not(:placeholder-shown) {
	color: var(--vscode-input-foreground, var(--vscode-editor-foreground));
	background: var(--vscode-input-background);
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
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 18px;
	height: 18px;
	padding: 0;
	font: inherit;
	line-height: 1;
	cursor: pointer;
	color: var(--tok-dim);
	background: transparent;
	border: 0;
	border-radius: 2px;
}
.filter-clear[hidden] {
	display: none;
}
.filter-clear:hover {
	color: var(--vscode-foreground);
	background: var(--vscode-toolbar-hoverBackground, transparent);
}
.count {
	padding: 0;
	border: 0;
	white-space: nowrap;
	color: var(--tok-dim);
	background: transparent;
	font-size: 12px;
}
.count[data-state="none"] {
	padding: 0;
	background: transparent;
}
.count[data-state="empty"] {
	color: var(--tok-dim);
	background: transparent;
	border-color: transparent;
}
.tool {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 4px;
	height: 20px;
	padding: 0 6px;
	cursor: pointer;
	color: var(--tok-dim);
	background: transparent;
	border: 0;
	border-radius: 2px;
	font: inherit;
}
.tool:hover {
	color: var(--vscode-foreground);
	background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
}
.tool:focus-visible {
	outline: 1px solid var(--vscode-focusBorder, var(--vscode-contrastActiveBorder, transparent));
	outline-offset: 1px;
}
.tool svg {
	flex: none;
}
.icon-tool {
	width: 20px;
	padding: 0;
}
.view-switch {
	gap: 0;
	padding: 0 6px;
}
.view-switch .view-sep {
	color: var(--tok-dim);
	padding: 0 3px;
}
.view-switch .view-document,
.view-switch .view-tree {
	color: var(--tok-dim);
}
.view-switch[aria-pressed="true"] .view-document,
.view-switch[aria-pressed="false"] .view-tree {
	color: var(--vscode-foreground);
}
.details-toggle .lbl {
	white-space: nowrap;
}

.notice {
	padding: 0 8px;
	min-height: 18px;
	font-size: 12px;
	line-height: 18px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--tok-dim);
}
.notice:empty {
	display: none;
}
.notice[data-kind="warn"] {
	color: var(--vscode-editorWarning-foreground, var(--tok-dim));
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
	scroll-padding-left: 9ch;
}
#inspector {
	flex: 0 0 clamp(260px, 30%, 340px);
	min-width: 0;
	overflow: auto;
	padding: 8px 10px 16px;
	border-left: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
	background: var(--vscode-editor-background);
}
#inspector[hidden] {
	display: none;
}
.meta {
	padding: 6px 10px;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	color: var(--vscode-editor-foreground);
}
.schema, .package {
	font-family: inherit;
}
.meta .keyword {
	color: var(--tok-keyword);
}
.meta .number {
	color: var(--tok-number);
}
.number {
	color: var(--tok-number);
}
.tree {
	padding: 4px 0 12px;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
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
	background: var(--hover-bg);
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
	color: var(--tok-number);
}
.value[data-value-kind="textual"] {
	color: var(--tok-string);
}
.value[data-value-kind="boolean"] {
	color: var(--tok-keyword);
}
.row-meta {
	grid-column: 3 / -1;
	grid-row: 2;
	display: flex;
	flex-wrap: wrap;
	gap: 2px 8px;
	min-width: 0;
	font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif);
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
	box-shadow: inset 2px 0 0 var(--rail);
}
.node[data-selected="true"] > .row {
	background: var(--sel-bg);
	box-shadow: inset 2px 0 0 var(--rail);
}
#tree:focus-within .node[data-selected="true"] > .row {
	background: var(--sel-bg-focus);
	box-shadow: inset 2px 0 0 var(--rail);
}
/* Selection never recolours syntax; the tint, active line number and rail carry the state. */
.children {
	margin-left: 14px;
	border-left: 1px solid var(--vscode-tree-indentGuidesStroke, var(--vscode-panel-border, #80808040));
}
.node[aria-expanded="false"] > .children {
	display: none;
}
.node.flash > .row {
	animation: ecuc-flash 1s ease-out;
}
@keyframes ecuc-flash {
	from { background: var(--vscode-editor-findMatchHighlightBackground, var(--vscode-list-hoverBackground)); }
	to { background: transparent; }
}
.short {
	color: var(--tok-string);
}
.keyword {
	color: var(--tok-keyword);
}
.variant {
	color: var(--tok-meta);
}
.condition {
	padding: 0 4px;
	border: 1px solid var(--vscode-panel-border, transparent);
	border-radius: 3px;
	color: var(--tok-meta);
}
.annotation {
	padding: 0 4px;
	border: 1px solid var(--vscode-panel-border, transparent);
	border-radius: 3px;
	color: var(--tok-comment);
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
	font-size: inherit;
	line-height: inherit;
	vertical-align: baseline;
	color: var(--vscode-input-foreground);
	background: var(--vscode-input-background);
	border: 1px solid var(--vscode-focusBorder);
}
.value-edit[aria-invalid="true"] {
	border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground, var(--vscode-errorForeground)));
}
.value-error {
	margin-left: 1ch;
	color: var(--vscode-errorForeground);
	font-style: italic;
	white-space: pre-wrap;
}
.punct {
	color: var(--tok-punct);
}
.target {
	color: var(--vscode-editor-foreground);
	text-decoration: none;
	cursor: pointer;
}
.target:hover .value-text {
	text-decoration: underline;
	text-decoration-color: var(--vscode-textLink-foreground, var(--vscode-symbolIcon-referenceForeground, var(--vscode-foreground)));
	text-underline-offset: 3px;
}
.context {
	color: var(--vscode-editor-foreground);
}
.context .keyword {
	color: var(--tok-keyword);
}
.hex {
	color: var(--tok-number);
}
mark {
	color: var(--vscode-editor-findMatchForeground, var(--vscode-foreground));
	background: var(--vscode-editor-findMatchHighlightBackground, var(--vscode-list-hoverBackground));
}
.empty {
	padding: 0;
	text-align: left;
	color: var(--tok-comment);
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	line-height: var(--ecuc-lh);
	font-style: italic;
}
.empty[hidden] {
	display: none;
}
.empty p {
	margin: 0;
}
.empty .tool {
	margin-left: 1ch;
	font-style: normal;
}
.inspector-empty {
	padding: 6px 0;
	color: var(--tok-dim);
}
.inspector-empty p {
	margin: 0 0 6px;
}
.inspector-hint {
	font-size: 0.9em;
}
.inspector-kind {
	font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif);
	font-size: 11px;
	letter-spacing: 0;
	text-transform: none;
	color: var(--tok-dim);
}
.inspector-label {
	margin: 2px 0 10px;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	font-weight: 600;
	word-break: break-word;
}
.inspector-row {
	margin: 0 0 9px;
}
.inspector-key {
	display: block;
	margin-bottom: 2px;
	font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif);
	font-size: 11px;
	letter-spacing: 0;
	text-transform: none;
	color: var(--tok-dim);
}
.inspector-code {
	margin: 0;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	line-height: 1.4;
	white-space: normal;
	overflow-wrap: anywhere;
}
.inspector-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	margin-top: 12px;
}
/* Document view: quiet source. One editor surface, a real source-line gutter,
 * and hover/focus affordances. Tree view keeps its grid; document selectors are
 * scoped. See docs/ECUC_EDITOR_DESIGN_SPEC.md. */
body[data-view="document"] .document {
	--ln-digits: 4;
	--ln-w: calc(var(--ln-digits, 4) * 1ch + 1ch);
	--gut: calc(var(--ln-w) + 4ch);
	--indent: 4ch;
}
body[data-view="document"] .document:has(#tree[data-ln-digits="1"]) { --ln-digits: 1; }
body[data-view="document"] .document:has(#tree[data-ln-digits="2"]) { --ln-digits: 2; }
body[data-view="document"] .document:has(#tree[data-ln-digits="3"]) { --ln-digits: 3; }
body[data-view="document"] .document:has(#tree[data-ln-digits="4"]) { --ln-digits: 4; }
body[data-view="document"] .document:has(#tree[data-ln-digits="5"]) { --ln-digits: 5; }
body[data-view="document"] .document:has(#tree[data-ln-digits="6"]) { --ln-digits: 6; }
body[data-view="document"] .document:has(#tree[data-ln-digits="7"]) { --ln-digits: 7; }
body[data-view="document"] #tree {
	position: relative;
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	font-weight: var(--vscode-editor-font-weight, normal);
	line-height: var(--ecuc-lh);
	font-variant-ligatures: none;
	tab-size: 4;
	white-space: pre;
	padding: calc(var(--ecuc-lh) * 0.5) 2ch calc(var(--ecuc-lh) * 3) var(--gut);
}
body[data-view="document"] .meta {
	padding: calc(var(--ecuc-lh) * 0.5) 0 0 var(--gut);
	margin-bottom: calc(var(--ecuc-lh) * 0.5);
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	line-height: var(--ecuc-lh);
	color: var(--vscode-editor-foreground);
}
body[data-view="document"] .schema,
body[data-view="document"] .package {
	font-family: inherit;
}
body[data-view="document"] .meta .keyword {
	color: var(--tok-keyword);
}
body[data-view="document"] .meta .number {
	color: var(--tok-number);
}
body[data-view="document"] .row {
	display: flex;
	flex-wrap: nowrap;
	gap: 1ch;
	align-items: baseline;
	padding: 0;
	margin-left: calc(-1 * var(--gut));
	padding-left: var(--gut);
	border: 0;
	background: transparent;
}
body[data-view="document"] .children .row {
	margin-left: calc(-1 * (var(--gut) + var(--indent)));
	padding-left: calc(var(--gut) + var(--indent));
}
body[data-view="document"] .children .children .row {
	margin-left: calc(-1 * (var(--gut) + var(--indent) * 2));
	padding-left: calc(var(--gut) + var(--indent) * 2);
}
body[data-view="document"] .children .children .children .row {
	margin-left: calc(-1 * (var(--gut) + var(--indent) * 3));
	padding-left: calc(var(--gut) + var(--indent) * 3);
}
body[data-view="document"] .children .children .children .children .row {
	margin-left: calc(-1 * (var(--gut) + var(--indent) * 4));
	padding-left: calc(var(--gut) + var(--indent) * 4);
}
body[data-view="document"] .children .children .children .children .children .row {
	margin-left: calc(-1 * (var(--gut) + var(--indent) * 5));
	padding-left: calc(var(--gut) + var(--indent) * 5);
}
body[data-view="document"] .children .children .children .children .children .children .row {
	margin-left: calc(-1 * (var(--gut) + var(--indent) * 6));
	padding-left: calc(var(--gut) + var(--indent) * 6);
}
body[data-view="document"] .children .children .children .children .children .children .children .row {
	margin-left: calc(-1 * (var(--gut) + var(--indent) * 7));
	padding-left: calc(var(--gut) + var(--indent) * 7);
}
body[data-view="document"] .children .children .children .children .children .children .children .children .row {
	margin-left: calc(-1 * (var(--gut) + var(--indent) * 8));
	padding-left: calc(var(--gut) + var(--indent) * 8);
}
body[data-view="document"] .children .children .children .children .children .children .children .children .children .row {
	margin-left: calc(-1 * (var(--gut) + var(--indent) * 9));
	padding-left: calc(var(--gut) + var(--indent) * 9);
}
body[data-view="document"] .row::before {
	content: attr(data-line);
	position: absolute;
	left: 0;
	width: var(--ln-w);
	text-align: right;
	color: var(--vscode-editorLineNumber-foreground, var(--tok-dim));
	font-variant-numeric: tabular-nums;
	pointer-events: none;
}
body[data-view="document"] .node[data-selected="true"] > .row::before,
body[data-view="document"] .node:focus-visible > .row::before {
	color: var(--vscode-editorLineNumber-activeForeground, var(--tok-keyword));
}
body[data-view="document"] .node:hover > .row {
	background: var(--hover-bg);
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
/* The twisty lives in the fold column of the gutter, not in the text flow. */
body[data-view="document"] .twisty,
body[data-view="document"] .spacer {
	position: absolute;
	left: calc(var(--ln-w) + 1ch);
	width: 2ch;
	height: var(--ecuc-lh);
	display: inline-flex;
	align-items: center;
	justify-content: center;
	margin: 0;
	padding: 0;
}
body[data-view="document"] .twisty svg {
	width: 10px;
	height: 10px;
}
body[data-view="document"] #tree:not(:hover):not(:focus-within) .node[aria-expanded="true"] > .row > .twisty {
	opacity: 0;
}
body[data-view="document"] .node[aria-expanded="false"] > .row > .twisty {
	opacity: 1;
}
body[data-view="document"] .node[aria-expanded="false"] > .row::after {
	content: " { … }";
	color: var(--tok-punct);
}
body[data-view="document"] .node[data-kind="parameter"][data-selected="true"] > .row::after {
	content: "  F2";
	color: var(--tok-dim);
}
body[data-view="document"] .label {
	flex: 0 0 auto;
	overflow: visible;
	text-overflow: clip;
	white-space: pre;
	font-weight: 400;
	color: var(--vscode-editor-foreground);
}
body[data-view="document"] .node[data-kind="parameter"] > .row > .label,
body[data-view="document"] .node[data-kind="reference"] > .row > .label {
	color: var(--tok-key);
}
body[data-view="document"] .value {
	flex: 0 0 auto;
	margin: 0;
	max-width: none;
	overflow: visible;
	text-overflow: clip;
	white-space: pre;
}
body[data-view="document"] .node[data-kind="parameter"] > .row > .value:hover {
	background: var(--vscode-toolbar-hoverBackground, var(--hover-bg));
	border-radius: 2px;
	cursor: text;
}
body[data-view="document"] .row-meta {
	display: flex;
	flex: 0 0 auto;
	flex-wrap: nowrap;
	gap: 1ch;
	margin: 0;
	font-family: inherit;
	font-size: inherit;
	color: var(--vscode-editor-foreground);
	white-space: pre;
}
body[data-view="document"] .row-meta > span {
	max-width: none;
	overflow: visible;
	white-space: pre;
	margin: 0;
}
body[data-view="document"] .variant,
body[data-view="document"] .condition {
	color: var(--tok-meta);
}
body[data-view="document"] .annotation {
	color: var(--tok-comment);
	font-style: italic;
}
body[data-view="document"] .hex {
	color: var(--tok-number);
}
body[data-view="document"] .context {
	color: var(--vscode-editor-foreground);
}
body[data-view="document"] .target {
	color: var(--vscode-editor-foreground);
	text-decoration: none;
}
body[data-view="document"] .target:hover .value-text {
	text-decoration: underline;
	text-decoration-color: var(--vscode-textLink-foreground, var(--vscode-symbolIcon-referenceForeground, var(--vscode-foreground)));
	text-underline-offset: 3px;
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
	color: var(--tok-keyword);
}
body[data-view="document"] .children {
	margin-left: var(--indent);
}
body[data-view="document"] .children::before,
body[data-view="document"] .children::after {
	display: block;
	margin-left: calc(-1 * var(--indent));
	color: var(--tok-punct);
	white-space: pre;
}
body[data-view="document"] .children::before {
	content: "{";
}
body[data-view="document"] .children::after {
	content: "}";
}
body[data-view="document"] #tree > .node + .node {
	margin-top: var(--ecuc-lh);
}
body[data-view="document"] .node[data-selected="true"] > .row {
	background: var(--sel-bg);
	box-shadow: inset 2px 0 0 var(--rail);
}
body[data-view="document"] #tree:focus-within .node[data-selected="true"] > .row {
	background: var(--sel-bg-focus);
	box-shadow: inset 2px 0 0 var(--rail);
}
body[data-view="document"] .node:focus-visible > .row {
	box-shadow: inset 2px 0 0 var(--rail);
}
body[data-view="document"] .row.k-parameter > .value {
	border-bottom: 0;
}
body[data-view="document"] .row.k-parameter:hover > .value::after {
	content: none;
}
body[data-view="document"] .value-edit {
	padding: 0 0.5ch;
	font-size: inherit;
	line-height: inherit;
	vertical-align: baseline;
}
body[data-view="document"] .empty {
	padding: 0 2ch 0 var(--gut);
	font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
	font-size: var(--ecuc-fs);
	line-height: var(--ecuc-lh);
	color: var(--tok-comment);
	font-style: italic;
}
body[data-view="document"] .empty p {
	margin: 0;
}
body[data-view="document"] .empty .tool {
	margin-left: 1ch;
	font-style: normal;
}
body[data-view="document"] #tree:not(:has([role="treeitem"]:not([style*="display: none"]))) {
	padding-top: 0;
	padding-bottom: 0;
}
@media (forced-colors: active) {
	body[data-view] .node[data-selected="true"] > .row,
	body[data-view] #tree:focus-within .node[data-selected="true"] > .row {
		background: transparent;
		outline: 1px solid var(--vscode-contrastActiveBorder, var(--vscode-contrastBorder, var(--vscode-focusBorder)));
		outline-offset: -1px;
	}
	body[data-view] .node:hover > .row {
		background: transparent;
		outline: 1px dashed var(--vscode-contrastBorder, var(--vscode-focusBorder));
		outline-offset: -1px;
	}
	body[data-view] .node:focus-visible > .row {
		box-shadow: none;
		outline: 2px solid var(--vscode-focusBorder);
		outline-offset: -2px;
	}
	body[data-view] mark {
		color: var(--vscode-editor-foreground);
		background: transparent;
		outline: 1px solid var(--vscode-contrastActiveBorder, var(--vscode-focusBorder));
	}
	body[data-view] .node.flash > .row {
		animation: none;
		outline: 1px solid var(--vscode-contrastActiveBorder, var(--vscode-focusBorder));
	}
}
body.vscode-high-contrast[data-view] .node[data-selected="true"] > .row,
body.vscode-high-contrast[data-view] #tree:focus-within .node[data-selected="true"] > .row {
	background: transparent;
	outline: 1px solid var(--vscode-contrastActiveBorder, var(--vscode-contrastBorder, var(--vscode-focusBorder)));
	outline-offset: -1px;
}
body.vscode-high-contrast[data-view] .node:hover > .row {
	background: transparent;
	outline: 1px dashed var(--vscode-contrastBorder, var(--vscode-focusBorder));
	outline-offset: -1px;
}
body.vscode-high-contrast[data-view] .node:focus-visible > .row {
	box-shadow: none;
	outline: 2px solid var(--vscode-focusBorder);
	outline-offset: -2px;
}
body.vscode-high-contrast[data-view] mark {
	color: var(--vscode-editor-foreground);
	background: transparent;
	outline: 1px solid var(--vscode-contrastActiveBorder, var(--vscode-focusBorder));
}
body.vscode-high-contrast[data-view] .node.flash > .row {
	animation: none;
	outline: 1px solid var(--vscode-contrastActiveBorder, var(--vscode-focusBorder));
}
@media (max-width: 720px) {
	body[data-view="document"] .document {
		--ln-w: 0ch;
		--gut: 3ch;
		--indent: 3ch;
	}
	body[data-view="document"] .row::before {
		display: none;
	}
	body[data-view="document"] .twisty,
	body[data-view="document"] .spacer {
		left: 0;
	}
	.toolbar {
		padding: 0 4px;
		gap: 3px;
	}
	.filter-wrap {
		flex: 1 1 0;
	}
	.count,
	.notice,
	.grow,
	.details-toggle .lbl {
		display: none;
	}
	.tool {
		padding: 0 4px;
	}
	#content {
		flex-direction: column;
	}
	#main {
		scroll-padding-left: 3ch;
	}
	#inspector {
		flex: 0 0 auto;
		min-width: 0;
		max-height: 45vh;
		border-left: 0;
		border-top: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
	}
}
@media (prefers-reduced-motion: reduce) {
	.twisty svg {
		transition: none;
	}
	.node.flash > .row {
		animation: ecuc-flash 1s steps(1, end);
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
		empty.appendChild(inspectorElement('p', '', 'Select a line to see its details.'));
		empty.appendChild(inspectorElement('p', 'inspector-hint', 'Click a line or press Space.'));
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
	viewToggle.title = isDocument ? 'Switch to tree view' : 'Switch to document view';
}

function applyInspectorVisibility() {
	if (!inspector || !detailsToggle) {
		return;
	}
	inspector.hidden = viewState.inspectorHidden === true;
	detailsToggle.setAttribute('aria-pressed', inspector.hidden ? 'false' : 'true');
	detailsToggle.title = inspector.hidden ? 'Show node details' : 'Hide node details';
	detailsToggle.setAttribute('aria-label', inspector.hidden ? 'Show node details' : 'Hide node details');
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
