/**
 * Row data for the virtualised ECUC views (task design §2).
 *
 * This is the host half of the virtual renderer: it walks the model in display
 * order and emits one plain object per entity — no HTML string, no DOM, no
 * `vscode` import. The page owns windowing, querying and row markup; the host
 * stays the single owner of the ECUC ordering and display rules
 * (`orderModules` / `orderContainers` / `orderMembers`, `lastShortName`,
 * `dotted`, `camelize`, the suffix rules).
 *
 * `EcucRow` carries the fields the Document surface needs - label, value/target/
 * context, the meta parts and the search haystack - but as values. Every row is in
 * DFS/display order with its children contiguous after it, which is what makes
 * `subtreeSize` a complete collapse index and `parentId` enough for the ancestor walk.
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
import { ConditionState, ConditionValue, evaluateSyscond } from '../core/ecuc/syscond';
import { resolvePath } from '../core/ecuc/resolve';
import { SORT_EXCEPTIONS, orderContainers, orderMembers, orderModules } from '../core/ecuc/order';
import { haystack } from './treeQuery';
import { NodeIndex, buildNodeIndex } from './nodeId';

/** One quiet-source meta fragment (short name, variant, context, condition, annotation). */
export interface MetaPart {
	cls: 'short' | 'variant' | 'context' | 'condition' | 'annotation';
	text: string;
	title: string;
	/** Condition chip state, so the page can style it without parsing text. */
	state?: ConditionState;
}

/** An evaluated `SW-SYSCOND` that belongs to one row. */
export interface RowCondition {
	/** The scanner's condition text, without brackets. */
	text: string;
	state: ConditionState;
	/** Missing symbols or the parse/type reason, when the result is unknown. */
	reason?: string;
	missing?: string[];
	/** Identifiers referenced by this condition, in source order. */
	symbols: string[];
}

/** One entity in DFS/display order. UI fields are values; no markup is carried. */
export interface ParameterFormat {
	label: 'Decimal' | 'Hexadecimal' | 'Binary';
	value: string;
}

export interface EcucRow {
	id: string;
	kind: 'module' | 'container' | 'parameter' | 'reference';
	/** 1-based tree level; modules are 1. */
	level: number;
	parentId: string | null;
	/** Number of descendants in display order; they occupy the next `subtreeSize` rows. */
	subtreeSize: number;
	/** True for a container with no parameters, references or sub-containers. */
	empty?: boolean;
	posinset: number;
	setsize: number;
	hasChildren: boolean;
	/** Definition-ref tail, or the dotted module path. */
	label: string;
	shortName?: string;
	definitionRef: string;
	/** `DEFINITION-REF DEST`, for the AUTOSAR type row. */
	definitionDest?: string;
	/** Normalized AUTOSAR type or Numeric/Textual/Boolean fallback. */
	parameterType?: string;
	/** Display formats derived from the parameter value. */
	formats?: ParameterFormat[];
	/** Raw value or reference target, for the details field and follow. */
	value?: string;
	valueKind?: 'numeric' | 'textual' | 'boolean';
	/** The displayed value: quoted for textual parameters, bare otherwise. */
	shownValue?: string;
	/** Raw `VALUE-REF` / `TARGET-REF`, for the reference follow action. */
	target?: string;
	/** True when the reference target resolves inside this file. */
	followable?: boolean;
	/** Raw instance-reference context paths, dotted like the target. */
	contextPaths?: string[];
	/** Hover text: the full `DEFINITION-REF` (design §2.7). */
	title: string;
	meta: MetaPart[];
	/** Present only when the node has its own SW-SYSCOND. */
	condition?: RowCondition;
	/** True when this row or any ancestor condition is false. */
	disabled?: boolean;
	/** Why this row is disabled; absent when it is not. */
	disabledBy?: 'self' | 'ancestor';
	/** Lower-cased label + short name + value, the Search haystack. */
	haystack: string;
}

/** The row store the page embeds and swaps on a re-scan. */
export interface RowDocument {
	/** DFS/display order. */
	rows: EcucRow[];
}

export interface RowBuildOptions {
	/** `all` (sorted) by default, matching the current renderer. */
	sort?: SortMode;
	/** The `sort all` exception list; defaults to the legacy 15 entries. */
	sortExcept?: readonly string[];
	/** SW system-constant values used to evaluate each node's own condition. */
	conditions?: ReadonlyMap<string, ConditionValue>;
}

interface BuildContext {
	index: NodeIndex;
	sort: SortMode;
	except: readonly string[];
	pathIndex: Map<string, Range>;
	conditions: ReadonlyMap<string, ConditionValue>;
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
		pathIndex: model.pathIndex,
		conditions: options.conditions ?? new Map<string, ConditionValue>(),
	};
	const rows: EcucRow[] = [];
	const modules = orderModules(model.modules, ctx.sort, ctx.except);
	for (let at = 0; at < modules.length; at++) {
		moduleRow(ctx, rows, modules[at], 1, at + 1, modules.length, null, false);
	}
	return { rows };
}

/** Normalizes an AUTOSAR `DEFINITION-REF DEST` to the details Type row. */
export function parameterType(
	definitionDest: string | undefined,
	valueKind: EcucRow['valueKind']
): string {
	if (definitionDest) {
		const known = new Map<string, string>([
			['ECUC-INTEGER-PARAM-DEF', 'Integer'],
			['ECUC-FLOAT-PARAM-DEF', 'Float'],
			['ECUC-BOOLEAN-PARAM-DEF', 'Boolean'],
			['ECUC-STRING-PARAM-DEF', 'String'],
			['ECUC-ENUMERATION-PARAM-DEF', 'Enumeration'],
			['ECUC-FUNCTION-NAME-DEF', 'Function name'],
			['ECUC-LINKER-SYMBOL-DEF', 'Linker symbol'],
		]);
		const mapped = known.get(definitionDest);
		if (mapped) {
			return mapped;
		}
		if (definitionDest.startsWith('ECUC-') && definitionDest.endsWith('-PARAM-DEF')) {
			const middle = definitionDest.slice(5, -10).toLowerCase().replace(/-/g, ' ');
			if (middle) {
				return middle.charAt(0).toUpperCase() + middle.slice(1);
			}
		}
	}
	if (valueKind === 'boolean') {
		return 'Boolean';
	}
	if (valueKind === 'numeric') {
		return 'Numeric';
	}
	if (valueKind === 'textual') {
		return 'Textual';
	}
	return 'Unknown';
}

/**
 * Derives the display formats for a parameter. Integer values get all three;
 * floats/unknown non-integers get Decimal only; Boolean/textual values get none.
 */
export function parameterFormats(value: string, type: string): ParameterFormat[] {
	if (type === 'Boolean' || type === 'Textual' || type === 'String' || type === 'Enumeration' || type === 'Function name' || type === 'Linker symbol') {
		return [];
	}
	const raw = value.trim();
	if (raw === '') {
		return [];
	}
	if (type === 'Float') {
		return [{ label: 'Decimal', value: raw }];
	}
	const integer = integerValue(value);
	if (integer !== undefined) {
		const sign = integer < 0n ? '-' : '';
		const magnitude = integer < 0n ? -integer : integer;
		return [
			{ label: 'Decimal', value: String(integer) },
			{ label: 'Hexadecimal', value: `${sign}0x${magnitude.toString(16).toUpperCase().padStart(2, '0')}` },
			{ label: 'Binary', value: `${sign}0b${magnitude.toString(2).padStart(8, '0')}` },
		];
	}
	if (type === 'Numeric') {
		return [{ label: 'Decimal', value: raw }];
	}
	return [];
}

/** Parses decimal, `0x` or `0b` integer literals; non-integers return undefined. */
function integerValue(value: string): bigint | undefined {
	const raw = value.trim();
	if (raw === '') {
		return undefined;
	}
	const negative = raw.startsWith('-');
	const body = negative ? raw.slice(1) : raw;
	let parsed: bigint;
	if (/^0[xX][0-9A-Fa-f]+$/.test(body)) {
		parsed = BigInt(`0x${body.slice(2)}`);
	} else if (/^0[bB][01]+$/.test(body)) {
		parsed = BigInt(`0b${body.slice(2)}`);
	} else if (/^\d+$/.test(body)) {
		parsed = BigInt(body);
	} else {
		return undefined;
	}
	return negative ? -parsed : parsed;
}

function moduleRow(
	ctx: BuildContext,
	rows: EcucRow[],
	module: ModuleNode,
	level: number,
	posinset: number,
	setsize: number,
	parentId: string | null,
	disabledByAncestor: boolean
): void {
	const index = rows.length;
	const condition = ownCondition(module, ctx);
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
			...suffixParts(module, condition),
		],
		haystack: haystack({ label: dotted(module.definitionRef), shortName: module.shortName }),
	};
	const disabled = applyCondition(row, condition, disabledByAncestor);
	rows.push(row);

	const containers = orderContainers(module.containers, ctx.sort, ctx.except);
	for (let at = 0; at < containers.length; at++) {
		containerRow(ctx, rows, containers[at], level + 1, at + 1, containers.length, row.id, disabled);
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
	parentId: string | null,
	disabledByAncestor: boolean
): void {
	const at = rows.length;
	const condition = ownCondition(container, ctx);
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
		meta: [shortPart(container.shortName), ...suffixParts(container, condition)],
		haystack: haystack({ label: lastShortName(container.definitionRef), shortName: container.shortName }),
	};
	const disabled = applyCondition(row, condition, disabledByAncestor);
	rows.push(row);

	// Parameters, then references, then nested containers: one contiguous
	// posinset group per container, exactly as `containerItem` rendered it.
	const members = orderMembers(container.parameters, container.references, ctx.sort, ctx.except);
	const nested = orderContainers(container.containers, ctx.sort, ctx.except);
	const total = members.parameters.length + members.references.length + nested.length;
	let child = 1;
	for (const parameter of members.parameters) {
		parameterRow(ctx, rows, parameter, level + 1, child, total, row.id, disabled);
		child++;
	}
	for (const reference of members.references) {
		referenceRow(ctx, rows, reference, level + 1, child, total, row.id, disabled);
		child++;
	}
	for (const container of nested) {
		containerRow(ctx, rows, container, level + 1, child, total, row.id, disabled);
		child++;
	}
	row.hasChildren = total > 0;
	row.empty = !row.hasChildren;
	row.subtreeSize = rows.length - at - 1;
}

function parameterRow(
	ctx: BuildContext,
	rows: EcucRow[],
	parameter: ParameterNode,
	level: number,
	posinset: number,
	setsize: number,
	parentId: string | null,
	disabledByAncestor: boolean
): void {
	const value = parameter.displayValue ?? '';
	// The legacy form quotes a textual value and leaves a numerical one bare.
	const shown = parameter.numeric ? value : `"${value}"`;
	const valueKind = parameter.numeric ? (/^(true|false)$/i.test(value) ? 'boolean' : 'numeric') : 'textual';
	const type = parameterType(parameter.definitionDest, valueKind);
	const condition = ownCondition(parameter, ctx);
	const row: EcucRow = {
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
		definitionDest: parameter.definitionDest,
		parameterType: type,
		formats: parameterFormats(value, type),
		value,
		valueKind,
		shownValue: shown,
		title: parameter.definitionRef,
		meta: suffixParts(parameter, condition),
		haystack: haystack({ label: parameter.name, value }),
	};
	applyCondition(row, condition, disabledByAncestor);
	rows.push(row);
}

function referenceRow(
	ctx: BuildContext,
	rows: EcucRow[],
	reference: ReferenceNode,
	level: number,
	posinset: number,
	setsize: number,
	parentId: string | null,
	disabledByAncestor: boolean
): void {
	const target = reference.targetPath ?? reference.targetRawPath ?? '';
	const rawTarget = reference.targetRawPath ?? target;
	const followable = rawTarget !== '' && resolvePath(ctx.pathIndex, rawTarget) !== undefined;
	const condition = ownCondition(reference, ctx);
	const row: EcucRow = {
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
		followable,
		...(reference.instance && reference.contextPaths.length > 0
			? { contextPaths: reference.contextPaths.slice() }
			: {}),
		title: reference.definitionRef,
		meta: [
			...(reference.instance && reference.contextPaths.length > 0
				? [contextPart(reference.contextPaths)]
				: []),
			...suffixParts(reference, condition),
		],
		haystack: haystack({ label: reference.name, value: target }),
	};
	applyCondition(row, condition, disabledByAncestor);
	rows.push(row);
}

/** Evaluates a node's own condition, or `undefined` when it has none. */
function ownCondition(node: Suffixes, ctx: BuildContext): RowCondition | undefined {
	if (!node.syscond) {
		return undefined;
	}
	const result = evaluateSyscond(node.syscond, ctx.conditions);
	const missingText = result.missing.length > 0 ? `missing: ${result.missing.join(', ')}` : undefined;
	return {
		text: node.syscond,
		state: result.state,
		reason: result.error ?? missingText,
		missing: result.missing,
		symbols: result.symbols,
	};
}

/**
 * Marks the row disabled when its own condition is false or an ancestor is
 * disabled. A true/unknown own condition never re-enables a row below a false
 * container. The return value is what the children inherit.
 */
function applyCondition(row: EcucRow, condition: RowCondition | undefined, disabledByAncestor: boolean): boolean {
	const ownFalse = condition !== undefined && condition.state === 'false';
	if (condition) {
		row.condition = condition;
	}
	const disabled = disabledByAncestor || ownFalse;
	if (disabled) {
		row.disabled = true;
		row.disabledBy = ownFalse ? 'self' : 'ancestor';
	} else if (condition) {
		row.disabled = false;
	}
	return disabled;
}

function shortPart(shortName: string): MetaPart {
	return { cls: 'short', text: `"${shortName}"`, title: shortName };
}

function variantPart(variant: string): MetaPart {
	const text = camelize(variant);
	return { cls: 'variant', text: `(${text})`, title: text };
}

function contextPart(contextPaths: readonly string[]): MetaPart {
	const text = `context ${contextPaths.join(', ')}`;
	return { cls: 'context', text, title: text };
}

/** Conditions and annotations in the legacy order: syscond, post-build conditions, annotations. */
function suffixParts(node: Suffixes, condition?: RowCondition): MetaPart[] {
	const parts: MetaPart[] = [];
	if (node.syscond) {
		const text = `[${node.syscond}]`;
		const title = condition
			? `${text} — ${condition.state}${condition.reason ? ` (${condition.reason})` : ''}`
			: text;
		parts.push({ cls: 'condition', text, title, ...(condition ? { state: condition.state } : {}) });
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
