/**
 * Row data for the virtualised ECUC views.
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
} from './model';
import { ConditionState, ConditionValue, evaluateSyscond } from './syscond';
import { resolvePath } from './resolve';
import { SORT_EXCEPTIONS, orderContainers, orderMembers, orderModules } from './order';
import { haystack } from './haystack';
import { NodeIndex, buildNodeIndex } from './nodeId';
import { ecucIntegerValue } from './numeric';
import type { DefinitionInfo, DefinitionLookup } from '../index/definitions';

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
	/** The entered value for each referenced identifier that has one. */
	values: Record<string, ConditionValue>;
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
	/** Why a cross-file reference target cannot be followed; absent when it can. */
	followReason?: string;
	/** Raw instance-reference context paths, dotted like the target. */
	contextPaths?: string[];
	/** Hover text: the full `DEFINITION-REF`. */
	title: string;
	meta: MetaPart[];
	/** Annotation comment lines shown above this row, in source order. */
	comments?: string[];
	/** Present only when the node has its own SW-SYSCOND. */
	condition?: RowCondition;
	/** True when this row or any ancestor condition is false. */
	disabled?: boolean;
	/** Why this row is disabled; absent when it is not. */
	disabledBy?: 'self' | 'ancestor';
	/** Definition-derived fields, present only when the workspace index resolves the ref. */
	definition?: DefinitionInfo;
	/** Number of definition bodies sharing the path when no single definition resolves. */
	definitionCount?: number;
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
	/** Resolves a `DEFINITION-REF`; absent when no workspace index is available. */
	definitions?: DefinitionLookup;
	/** Counts definition bodies for a ref that does not resolve to exactly one. */
	ambiguousDefinitions?: (definitionRef: string) => number;
	/** True when a reference target resolves across the workspace index. */
	referenceResolver?: (targetPath: string, targetDest?: string) => { followable: boolean; reason?: string };
}

interface BuildContext {
	index: NodeIndex;
	sort: SortMode;
	except: readonly string[];
	pathIndex: Map<string, Range>;
	conditions: ReadonlyMap<string, ConditionValue>;
	definitions?: DefinitionLookup;
	ambiguousDefinitions?: (definitionRef: string) => number;
	referenceResolver?: (targetPath: string, targetDest?: string) => { followable: boolean; reason?: string };
}

/** The shared empty condition map, used when no values were supplied. */
const EMPTY_CONDITIONS: ReadonlyMap<string, ConditionValue> = new Map();

/**
 * Builds the row document from the model. The returned rows are in the same
 * order `renderTree` rendered them: modules, containers, parameters,
 * references, then child containers, with the same `aria-posinset` grouping.
 */
export function buildRows(model: EcucDocumentModel, options: RowBuildOptions = {}): RowDocument {
	const ctx = buildContext(model, options);
	const rows: EcucRow[] = [];
	appendModuleRows(ctx, rows, model);
	return { rows };
}

function buildContext(model: EcucDocumentModel, options: RowBuildOptions): BuildContext {
	return {
		index: buildNodeIndex(model),
		sort: options.sort ?? 'all',
		except: options.sortExcept ?? SORT_EXCEPTIONS,
		pathIndex: model.pathIndex,
		conditions: options.conditions ?? EMPTY_CONDITIONS,
		definitions: options.definitions,
		ambiguousDefinitions: options.ambiguousDefinitions,
		referenceResolver: options.referenceResolver,
	};
}

function appendModuleRows(ctx: BuildContext, rows: EcucRow[], model: EcucDocumentModel): void {
	const modules = orderModules(model.modules, ctx.sort, ctx.except);
	for (let at = 0; at < modules.length; at++) {
		moduleRow(ctx, rows, modules[at], 1, at + 1, modules.length, null, false);
	}
}

/** AUTOSAR DEST types that narrow the details Type row directly. */
const PARAMETER_TYPES: ReadonlyMap<string, string> = new Map([
	['ECUC-INTEGER-PARAM-DEF', 'Integer'],
	['ECUC-FLOAT-PARAM-DEF', 'Float'],
	['ECUC-BOOLEAN-PARAM-DEF', 'Boolean'],
	['ECUC-STRING-PARAM-DEF', 'String'],
	['ECUC-ENUMERATION-PARAM-DEF', 'Enumeration'],
	['ECUC-FUNCTION-NAME-DEF', 'Function name'],
	['ECUC-LINKER-SYMBOL-DEF', 'Linker symbol'],
]);

/** Types whose values carry no Decimal/Hexadecimal/Binary rows. */
const UNFORMATTED_TYPES: ReadonlySet<string> = new Set([
	'Boolean',
	'Textual',
	'String',
	'Enumeration',
	'Function name',
	'Linker symbol',
]);

/** Normalizes an AUTOSAR `DEFINITION-REF DEST` to the details Type row. */
export function parameterType(
	definitionDest: string | undefined,
	valueKind: EcucRow['valueKind']
): string {
	return destType(definitionDest) ?? fallbackType(valueKind);
}

/** The type named by a known DEST, or the generic `ECUC-*-PARAM-DEF` spelling. */
function destType(definitionDest: string | undefined): string | undefined {
	if (!definitionDest) {
		return undefined;
	}
	const mapped = PARAMETER_TYPES.get(definitionDest);
	if (mapped !== undefined) {
		return mapped;
	}
	return derivedType(definitionDest);
}

/** `ECUC-ONE-OFF-PARAM-DEF` -> `One off`; an empty middle has no type name. */
function derivedType(definitionDest: string): string | undefined {
	if (!definitionDest.startsWith('ECUC-') || !definitionDest.endsWith('-PARAM-DEF')) {
		return undefined;
	}
	const middle = definitionDest.slice(5, -10).toLowerCase().replace(/-/g, ' ');
	return middle === '' ? undefined : middle.charAt(0).toUpperCase() + middle.slice(1);
}

/** The value-kind fallback for a DEST the map does not name. */
function fallbackType(valueKind: EcucRow['valueKind']): string {
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
	if (UNFORMATTED_TYPES.has(type)) {
		return [];
	}
	const raw = value.trim();
	if (raw === '') {
		return [];
	}
	if (type === 'Float') {
		return [{ label: 'Decimal', value: raw }];
	}
	return numericFormats(raw, value, type);
}

/** Integer formats when the value parses, otherwise the Decimal-only forms. */
function numericFormats(raw: string, value: string, type: string): ParameterFormat[] {
	const integer = ecucIntegerValue(value);
	if (integer !== undefined) {
		return integerFormats(integer);
	}
	return type === 'Numeric' ? [{ label: 'Decimal', value: raw }] : [];
}

/** The signed value in decimal, hexadecimal and binary. */
function integerFormats(integer: bigint): ParameterFormat[] {
	const sign = integer < 0n ? '-' : '';
	const magnitude = integer < 0n ? -integer : integer;
	return [
		{ label: 'Decimal', value: String(integer) },
		{ label: 'Hexadecimal', value: `${sign}0x${magnitude.toString(16).toUpperCase().padStart(2, '0')}` },
		{ label: 'Binary', value: `${sign}0b${magnitude.toString(2).padStart(8, '0')}` },
	];
}

/** Parses decimal, `0x` or `0b` integer literals; non-integers return undefined. */

/** Resolves a definition only when a lookup was supplied; failure degrades to no definition. */
function definitionFor(ctx: BuildContext, definitionRef: string): DefinitionInfo | undefined {
	if (ctx.definitions === undefined || definitionRef === '') {
		return undefined;
	}
	try {
		return ctx.definitions(definitionRef);
	} catch {
		// A definition is optional metadata. A broken index must never stop the
		// row document from rendering.
		return undefined;
	}
}

/** The ambiguous-definition count, only when no single definition resolved. */
function definitionCountFor(
	ctx: BuildContext,
	definitionRef: string,
	definition: DefinitionInfo | undefined
): number | undefined {
	if (definition !== undefined || definitionRef === '') {
		return undefined;
	}
	const counter = ctx.ambiguousDefinitions;
	if (counter === undefined) {
		return undefined;
	}
	return atLeastTwo(counter(definitionRef));
}

/** A count that is only worth showing when it is ambiguous. */
function atLeastTwo(count: number): number | undefined {
	return count >= 2 ? count : undefined;
}

/** The resolved definition fields, omitted entirely when absent. */
function definitionFields(
	definition: DefinitionInfo | undefined,
	definitionCount: number | undefined
): Partial<EcucRow> {
	return {
		...(definition === undefined ? {} : { definition }),
		...(definitionCount === undefined ? {} : { definitionCount }),
	};
}

/** Applies the row's own condition, appends it, and returns the inherited disabled state. */
function appendRow(
	rows: EcucRow[],
	row: EcucRow,
	condition: RowCondition | undefined,
	disabledByAncestor: boolean
): boolean {
	const disabled = applyCondition(row, condition, disabledByAncestor);
	rows.push(row);
	return disabled;
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
	const definition = definitionFor(ctx, module.definitionRef);
	const definitionCount = definitionCountFor(ctx, module.definitionRef, definition);
	const meta: MetaPart[] = [
		shortPart(module.shortName),
		...(module.variant ? [variantPart(module.variant)] : []),
		...suffixParts(module, condition),
	];
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
		meta,
		comments: commentLines(meta),
		haystack: haystack({ label: dotted(module.definitionRef), shortName: module.shortName, meta }),
		...definitionFields(definition, definitionCount),
	};
	const disabled = appendRow(rows, row, condition, disabledByAncestor);

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
	const definition = definitionFor(ctx, container.definitionRef);
	const definitionCount = definitionCountFor(ctx, container.definitionRef, definition);
	const meta: MetaPart[] = [shortPart(container.shortName), ...suffixParts(container, condition)];
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
		meta,
		comments: commentLines(meta),
		haystack: haystack({
			label: lastShortName(container.definitionRef),
			shortName: container.shortName,
			meta,
		}),
		...definitionFields(definition, definitionCount),
	};
	const disabled = appendRow(rows, row, condition, disabledByAncestor);

	// Parameters, then references, then nested containers: one contiguous
	// posinset group per container, exactly as `containerItem` rendered it.
	const members = orderMembers(container.parameters, container.references, ctx.sort, ctx.except);
	const nested = orderContainers(container.containers, ctx.sort, ctx.except);
	const total = members.parameters.length + members.references.length + nested.length;
	appendChildRows(ctx, rows, members, nested, level + 1, total, row.id, disabled);
	row.hasChildren = total > 0;
	row.empty = !row.hasChildren;
	row.subtreeSize = rows.length - at - 1;
}

/** Appends the container's parameters, references and nested containers in order. */
function appendChildRows(
	ctx: BuildContext,
	rows: EcucRow[],
	members: { parameters: ParameterNode[]; references: ReferenceNode[] },
	nested: readonly ContainerNode[],
	level: number,
	total: number,
	parentId: string | null,
	disabledByAncestor: boolean
): void {
	let child = 1;
	for (const parameter of members.parameters) {
		parameterRow(ctx, rows, parameter, level, child, total, parentId, disabledByAncestor);
		child++;
	}
	for (const reference of members.references) {
		referenceRow(ctx, rows, reference, level, child, total, parentId, disabledByAncestor);
		child++;
	}
	for (const container of nested) {
		containerRow(ctx, rows, container, level, child, total, parentId, disabledByAncestor);
		child++;
	}
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
	const valueKind = parameterValueKind(parameter, value);
	const type = parameterType(parameter.definitionDest, valueKind);
	const condition = ownCondition(parameter, ctx);
	const definition = definitionFor(ctx, parameter.definitionRef);
	const definitionCount = definitionCountFor(ctx, parameter.definitionRef, definition);
	const meta: MetaPart[] = suffixParts(parameter, condition);
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
		meta,
		comments: commentLines(meta),
		haystack: haystack({ label: parameter.name, value, meta }),
		...definitionFields(definition, definitionCount),
	};
	appendRow(rows, row, condition, disabledByAncestor);
}

/** The value kind the type column reads: a numeric value may still be a boolean. */
function parameterValueKind(parameter: ParameterNode, value: string): EcucRow['valueKind'] {
	if (!parameter.numeric) {
		return 'textual';
	}
	return /^(true|false)$/i.test(value) ? 'boolean' : 'numeric';
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
	const target = referenceTarget(reference, ctx);
	const condition = ownCondition(reference, ctx);
	const definition = definitionFor(ctx, reference.definitionRef);
	const definitionCount = definitionCountFor(ctx, reference.definitionRef, definition);
	const meta: MetaPart[] = referenceMeta(reference, condition);
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
		value: target.value,
		shownValue: target.value,
		target: target.raw,
		followable: target.followable,
		...(target.reason === undefined ? {} : { followReason: target.reason }),
		...contextPathsField(reference),
		title: reference.definitionRef,
		meta,
		comments: commentLines(meta),
		haystack: haystack({ label: reference.name, value: target.value, meta }),
		...definitionFields(definition, definitionCount),
	};
	appendRow(rows, row, condition, disabledByAncestor);
}

/** The reference's display value, raw target, and whether/how it can be followed. */
interface ReferenceTarget {
	value: string;
	raw: string;
	followable: boolean;
	reason?: string;
}

function referenceTarget(reference: ReferenceNode, ctx: BuildContext): ReferenceTarget {
	const value = referenceValue(reference);
	const raw = reference.targetRawPath ?? value;
	const sameFile = resolvesInFile(ctx.pathIndex, raw);
	const crossFile = sameFile ? undefined : crossFileResolution(ctx, raw, reference.targetDest);
	return targetView(value, raw, sameFile, crossFile);
}

/** A reference's display path: the resolved target first, then its raw form. */
function referenceValue(reference: ReferenceNode): string {
	return reference.targetPath ?? reference.targetRawPath ?? '';
}

function targetView(
	value: string,
	raw: string,
	sameFile: boolean,
	crossFile: { followable: boolean; reason?: string } | undefined
): ReferenceTarget {
	if (sameFile) {
		return { value, raw, followable: true };
	}
	return { value, raw, followable: crossFile?.followable === true, reason: crossFile?.reason };
}

function resolvesInFile(pathIndex: Map<string, Range>, raw: string): boolean {
	return raw !== '' && resolvePath(pathIndex, raw) !== undefined;
}

function crossFileResolution(
	ctx: BuildContext,
	raw: string,
	targetDest: string | undefined
): { followable: boolean; reason?: string } | undefined {
	if (raw === '' || ctx.referenceResolver === undefined) {
		return undefined;
	}
	return ctx.referenceResolver(raw, targetDest);
}

/** The instance's context-path chip, then the usual suffix meta. */
function referenceMeta(reference: ReferenceNode, condition: RowCondition | undefined): MetaPart[] {
	const parts: MetaPart[] = [];
	if (hasContextPaths(reference)) {
		parts.push(contextPart(reference.contextPaths));
	}
	parts.push(...suffixParts(reference, condition));
	return parts;
}

function hasContextPaths(reference: ReferenceNode): boolean {
	return Boolean(reference.instance) && reference.contextPaths.length > 0;
}

function contextPathsField(reference: ReferenceNode): { contextPaths?: string[] } {
	return hasContextPaths(reference) ? { contextPaths: reference.contextPaths.slice() } : {};
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
		values: result.values,
	};
}

/** How one entered condition value reads in the tooltip. */
function conditionValueText(value: ConditionValue): string {
	return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * The condition chip's hover text: one `NAME = value` line per referenced
 * symbol, in source order. The enabled/disabled row already carries the result,
 * so the tooltip explains the inputs instead of repeating `true`/`false`.
 */
export function conditionTooltip(condition: RowCondition): string {
	const lines = condition.symbols.map((name) => symbolLine(condition, name));
	// A parse/type reason is still useful next to its values; a bare `missing:`
	// reason repeats the `(not set)` lines and is left out.
	const reason = tooltipReason(condition);
	if (lines.length === 0) {
		return reason ?? condition.text;
	}
	if (reason !== undefined) {
		lines.push(reason);
	}
	return lines.join('\n');
}

/** One `NAME = value` tooltip line. */
function symbolLine(condition: RowCondition, name: string): string {
	const value = condition.values[name];
	return `${name} = ${value === undefined ? '(not set)' : conditionValueText(value)}`;
}

/** The reason worth appending to the tooltip, when the result has one. */
function tooltipReason(condition: RowCondition): string | undefined {
	if (condition.state !== 'unknown' || condition.reason === undefined) {
		return undefined;
	}
	return condition.reason.startsWith('missing:') ? undefined : condition.reason;
}

/**
 * Marks the row disabled when its own condition is false or an ancestor is
 * disabled. A true/unknown own condition never re-enables a row below a false
 * container. The return value is what the children inherit.
 */
function applyCondition(row: EcucRow, condition: RowCondition | undefined, disabledByAncestor: boolean): boolean {
	if (condition) {
		row.condition = condition;
	}
	const ownFalse = isOwnFalse(condition);
	const disabled = disabledByAncestor || ownFalse;
	applyDisabledFlags(row, condition, disabled, ownFalse);
	return disabled;
}

/** A row is disabled by its own condition only when that condition is false. */
function isOwnFalse(condition: RowCondition | undefined): boolean {
	return condition !== undefined && condition.state === 'false';
}

/** Writes the disabled flags: a false ancestor always wins over a true own condition. */
function applyDisabledFlags(
	row: EcucRow,
	condition: RowCondition | undefined,
	disabled: boolean,
	ownFalse: boolean
): void {
	if (disabled) {
		disableRow(row, ownFalse);
		return;
	}
	if (condition) {
		row.disabled = false;
	}
}

function disableRow(row: EcucRow, ownFalse: boolean): void {
	row.disabled = true;
	row.disabledBy = ownFalse ? 'self' : 'ancestor';
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
	return [
		...conditionParts(node, condition),
		...postBuildParts(node),
		...annotationParts(node.annotations ?? []),
	];
}

/** The row's own `SW-SYSCOND` chip, with its evaluated tooltip and state. */
function conditionParts(node: Suffixes, condition: RowCondition | undefined): MetaPart[] {
	if (!node.syscond) {
		return [];
	}
	const text = `[${node.syscond}]`;
	const title = condition ? conditionTooltip(condition) : text;
	return [{ cls: 'condition', text, title, ...(condition ? { state: condition.state } : {}) }];
}

/** The `POST-BUILD-VARIANT-CONDITIONS` chip. */
function postBuildParts(node: Suffixes): MetaPart[] {
	if (!node.postBuildVariants || node.postBuildVariants.length === 0) {
		return [];
	}
	const text = node.postBuildVariants.map((v) => `${v.criterion} ${v.operator} ${v.value}`).join(' && ');
	return [{ cls: 'condition', text: `<${text}>`, title: `<${text}>` }];
}

/** One annotation chip per captured annotation, in source order. */
function annotationParts(annotations: readonly { label?: string; text?: string }[]): MetaPart[] {
	const parts: MetaPart[] = [];
	for (const annotation of annotations) {
		const part = annotationPart(annotation);
		if (part !== undefined) {
			parts.push(part);
		}
	}
	return parts;
}

function annotationPart(annotation: { label?: string; text?: string }): MetaPart | undefined {
	const text = annotationText(annotation);
	if (text === '') {
		return undefined;
	}
	return { cls: 'annotation', text, title: text };
}

/** `[label] text`, with an absent label or text contributing nothing. */
function annotationText(annotation: { label?: string; text?: string }): string {
	const label = annotation.label ? `[${annotation.label}] ` : '';
	const text = annotation.text ?? '';
	return label + text;
}

/** The annotation parts, in source order, for the comment lines above a row. */
function commentLines(meta: readonly MetaPart[]): string[] | undefined {
	const lines = meta.filter((part) => part.cls === 'annotation').map((part) => part.text);
	return lines.length > 0 ? lines : undefined;
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
