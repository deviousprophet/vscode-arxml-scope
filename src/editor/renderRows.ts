/**
 * Row data for the virtualised ECUC views (task design §2).
 *
 * This is the host half of the virtual renderer: it walks the model in display
 * order and emits one plain object per entity — no HTML string, no DOM, no
 * `vscode` import. The page owns windowing, filtering and row markup; the host
 * stays the single owner of the ECUC ordering and display rules
 * (`orderModules` / `orderContainers` / `orderMembers`, `lastShortName`,
 * `dotted`, `camelize`, the suffix rules).
 *
 * `EcucRow` carries the fields the old `renderTree` template needed — label,
 * value/target/context, the meta parts, the inspector source position and the
 * search haystack — but as values. Every row is in DFS/display order with its
 * children contiguous after it, which is what makes `subtreeSize` a complete
 * collapse index and `parentId` enough for filter ancestors.
 */
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
import { haystack } from './filter';
import { NodeIndex, buildNodeIndex } from './nodeId';

/** One quiet-source meta fragment (short name, variant, hex, context, condition, annotation). */
export interface MetaPart {
	cls: 'short' | 'variant' | 'hex' | 'context' | 'condition' | 'annotation';
	text: string;
	title: string;
}

/** One entity in DFS/display order. UI fields are values; no markup is carried. */
export interface EcucRow {
	id: string;
	kind: 'module' | 'container' | 'parameter' | 'reference';
	/** 1-based tree level; modules are 1. */
	level: number;
	parentId: string | null;
	/** Number of descendants in display order; they occupy the next `subtreeSize` rows. */
	subtreeSize: number;
	posinset: number;
	setsize: number;
	hasChildren: boolean;
	/** Definition-ref tail, or the dotted module path. */
	label: string;
	shortName?: string;
	definitionRef: string;
	/** Raw value or reference target, for copy and the in-tree editor. */
	value?: string;
	valueKind?: 'numeric' | 'textual' | 'boolean';
	/** The displayed value: quoted for textual parameters, bare otherwise. */
	shownValue?: string;
	/** Raw `VALUE-REF` / `TARGET-REF`, for the reference follow action. */
	target?: string;
	/** Raw instance-reference context paths, dotted like the target. */
	contextPaths?: string[];
	/** Hover text: the full `DEFINITION-REF` (design §2.7). */
	title: string;
	meta: MetaPart[];
	/** 1-based source line of the row; 0 when the caller has no document text. */
	sourceLine: number;
	/** 0-based source position for the details inspector (`sourceLine` is its +1). */
	line: number;
	column: number;
	endLine: number;
	endColumn: number;
	/** Lower-cased label + short name + value, the existing filter haystack. */
	haystack: string;
}

/** The row store the page embeds and swaps on a re-scan. */
export interface RowDocument {
	/** DFS/display order. */
	rows: EcucRow[];
	/** Digit count of the widest source line, for the line-number gutter. */
	digits: number;
}

export interface RowBuildOptions {
	/** `all` (sorted) by default, matching the current renderer. */
	sort?: SortMode;
	/** The `sort all` exception list; defaults to the legacy 15 entries. */
	sortExcept?: readonly string[];
	/**
	 * The current document text's line index. Without it every row carries
	 * `sourceLine: 0` and zeroed inspector positions, matching the old renderer.
	 */
	lineIndex?: LineIndex;
}

interface BuildContext {
	index: NodeIndex;
	sort: SortMode;
	except: readonly string[];
	lineIndex?: LineIndex;
	/** Largest 1-based entity source line, used for the gutter width. */
	maxLine: number;
}

/**
 * Builds the row document from the model. The returned rows are in the same
 * order `renderTree` rendered them: modules, containers, parameters,
 * references, then child containers, with the same `aria-posinset` grouping.
 */
export function buildRows(model: EcucDocumentModel, options: RowBuildOptions = {}): RowDocument {
	const ctx: BuildContext = {
		index: buildNodeIndex(model),
		sort: options.sort ?? 'all',
		except: options.sortExcept ?? SORT_EXCEPTIONS,
		lineIndex: options.lineIndex,
		maxLine: 0,
	};
	const rows: EcucRow[] = [];
	const modules = orderModules(model.modules, ctx.sort, ctx.except);
	for (let at = 0; at < modules.length; at++) {
		moduleRow(ctx, rows, modules[at], 1, at + 1, modules.length, null);
	}
	return { rows, digits: String(Math.max(1, ctx.maxLine)).length };
}

function moduleRow(
	ctx: BuildContext,
	rows: EcucRow[],
	module: ModuleNode,
	level: number,
	posinset: number,
	setsize: number,
	parentId: string | null
): void {
	const index = rows.length;
	const row: EcucRow = {
		id: ctx.index.idOf(module) ?? '',
		kind: 'module',
		level,
		parentId,
		subtreeSize: 0,
		posinset,
		setsize,
		hasChildren: false,
		label: dotted(module.definitionRef),
		shortName: module.shortName,
		definitionRef: module.definitionRef,
		title: module.definitionRef,
		meta: [
			shortPart(module.shortName),
			...(module.variant ? [variantPart(module.variant)] : []),
			...suffixParts(module),
		],
		...sourceFields(ctx, module.range),
		haystack: haystack({ label: dotted(module.definitionRef), shortName: module.shortName }),
	};
	rows.push(row);

	const containers = orderContainers(module.containers, ctx.sort, ctx.except);
	for (let at = 0; at < containers.length; at++) {
		containerRow(ctx, rows, containers[at], level + 1, at + 1, containers.length, row.id);
	}
	row.hasChildren = containers.length > 0;
	row.subtreeSize = rows.length - index - 1;
}

function containerRow(
	ctx: BuildContext,
	rows: EcucRow[],
	container: ContainerNode,
	level: number,
	posinset: number,
	setsize: number,
	parentId: string | null
): void {
	const at = rows.length;
	const row: EcucRow = {
		id: ctx.index.idOf(container) ?? '',
		kind: 'container',
		level,
		parentId,
		subtreeSize: 0,
		posinset,
		setsize,
		hasChildren: false,
		label: lastShortName(container.definitionRef),
		shortName: container.shortName,
		definitionRef: container.definitionRef,
		title: container.definitionRef,
		meta: [shortPart(container.shortName), ...suffixParts(container)],
		...sourceFields(ctx, container.range),
		haystack: haystack({ label: lastShortName(container.definitionRef), shortName: container.shortName }),
	};
	rows.push(row);

	// Parameters, then references, then nested containers: one contiguous
	// posinset group per container, exactly as `containerItem` rendered it.
	const members = orderMembers(container.parameters, container.references, ctx.sort, ctx.except);
	const nested = orderContainers(container.containers, ctx.sort, ctx.except);
	const total = members.parameters.length + members.references.length + nested.length;
	let child = 1;
	for (const parameter of members.parameters) {
		parameterRow(ctx, rows, parameter, level + 1, child, total, row.id);
		child++;
	}
	for (const reference of members.references) {
		referenceRow(ctx, rows, reference, level + 1, child, total, row.id);
		child++;
	}
	for (const container of nested) {
		containerRow(ctx, rows, container, level + 1, child, total, row.id);
		child++;
	}
	row.hasChildren = total > 0;
	row.subtreeSize = rows.length - at - 1;
}

function parameterRow(
	ctx: BuildContext,
	rows: EcucRow[],
	parameter: ParameterNode,
	level: number,
	posinset: number,
	setsize: number,
	parentId: string | null
): void {
	const value = parameter.displayValue ?? '';
	// The legacy form quotes a textual value and leaves a numerical one bare.
	const shown = parameter.numeric ? value : `"${value}"`;
	const valueKind = parameter.numeric ? (/^(true|false)$/i.test(value) ? 'boolean' : 'numeric') : 'textual';
	rows.push({
		id: ctx.index.idOf(parameter) ?? '',
		kind: 'parameter',
		level,
		parentId,
		subtreeSize: 0,
		posinset,
		setsize,
		hasChildren: false,
		label: parameter.name,
		definitionRef: parameter.definitionRef,
		value,
		valueKind,
		shownValue: shown,
		title: parameter.definitionRef,
		meta: [...(parameter.hexValue ? [hexPart(parameter.hexValue)] : []), ...suffixParts(parameter)],
		...sourceFields(ctx, parameter.range),
		haystack: haystack({ label: parameter.name, value }),
	});
}

function referenceRow(
	ctx: BuildContext,
	rows: EcucRow[],
	reference: ReferenceNode,
	level: number,
	posinset: number,
	setsize: number,
	parentId: string | null
): void {
	const target = reference.targetPath ?? reference.targetRawPath ?? '';
	const rawTarget = reference.targetRawPath ?? target;
	rows.push({
		id: ctx.index.idOf(reference) ?? '',
		kind: 'reference',
		level,
		parentId,
		subtreeSize: 0,
		posinset,
		setsize,
		hasChildren: false,
		label: reference.name,
		definitionRef: reference.definitionRef,
		value: target,
		shownValue: target,
		target: rawTarget,
		...(reference.instance && reference.contextPaths.length > 0
			? { contextPaths: reference.contextPaths.slice() }
			: {}),
		title: reference.definitionRef,
		meta: [
			...(reference.instance && reference.contextPaths.length > 0
				? [contextPart(reference.contextPaths)]
				: []),
			...suffixParts(reference),
		],
		...sourceFields(ctx, reference.range),
		haystack: haystack({ label: reference.name, value: target }),
	});
}

/** 0-based inspector position from the document line index; zeroed when absent. */
function sourceFields(
	ctx: BuildContext,
	range: Range
): Pick<EcucRow, 'sourceLine' | 'line' | 'column' | 'endLine' | 'endColumn'> {
	if (!ctx.lineIndex) {
		return { sourceLine: 0, line: 0, column: 0, endLine: 0, endColumn: 0 };
	}
	const start = ctx.lineIndex.positionAt(range.start);
	const end = ctx.lineIndex.positionAt(range.end);
	const sourceLine = start.line + 1;
	if (sourceLine > ctx.maxLine) {
		ctx.maxLine = sourceLine;
	}
	return {
		sourceLine,
		line: start.line,
		column: start.character,
		endLine: end.line,
		endColumn: end.character,
	};
}

function shortPart(shortName: string): MetaPart {
	return { cls: 'short', text: `"${shortName}"`, title: shortName };
}

function variantPart(variant: string): MetaPart {
	const text = camelize(variant);
	return { cls: 'variant', text: `(${text})`, title: text };
}

function hexPart(hexValue: string): MetaPart {
	return { cls: 'hex', text: `(= ${hexValue})`, title: `(= ${hexValue})` };
}

function contextPart(contextPaths: readonly string[]): MetaPart {
	const text = `context ${contextPaths.join(', ')}`;
	return { cls: 'context', text, title: text };
}

/** Conditions and annotations in the legacy order: syscond, post-build conditions, annotations. */
function suffixParts(node: Suffixes): MetaPart[] {
	const parts: MetaPart[] = [];
	if (node.syscond) {
		const text = `[${node.syscond}]`;
		parts.push({ cls: 'condition', text, title: text });
	}
	if (node.postBuildVariants && node.postBuildVariants.length > 0) {
		const text = node.postBuildVariants.map((v) => `${v.criterion} ${v.operator} ${v.value}`).join(' && ');
		parts.push({ cls: 'condition', text: `<${text}>`, title: `<${text}>` });
	}
	for (const annotation of node.annotations ?? []) {
		const label = annotation.label ? `[${annotation.label}] ` : '';
		const text = annotation.text ?? '';
		if (label === '' && text === '') {
			continue;
		}
		parts.push({ cls: 'annotation', text: label + text, title: label + text });
	}
	return parts;
}

/** `/A/B/C` -> `A.B.C`, the legacy `\structify` (shared with the HTML renderer). */
function dotted(path: string): string {
	const parts = path.split('/');
	return parts.length <= 1 ? path : parts.slice(1).join('.');
}

/** `VARIANT-PRE-COMPILE` -> `VariantPreCompile`, the legacy `\camelize`. */
function camelize(value: string): string {
	return value
		.split('-')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join('');
}
