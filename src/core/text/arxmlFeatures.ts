/**
 * Pure ARXML text features: reference tokens and a document-symbol tree.
 *
 * These helpers let the plain text editor reuse the scanner's ranges instead of
 * regex-matching XML. No `vscode` import.
 */
import type {
	ContainerNode,
	EcucDocumentModel,
	ModuleNode,
	ParameterNode,
	Range,
	ReferenceNode,
} from '../ecuc/model';

export type RefTokenKind = 'definition' | 'target';

export interface RefToken {
	kind: RefTokenKind;
	rawPath: string;
	/** The AUTOSAR `DEST` on the value element, when present. */
	dest?: string;
	range: Range;
}

export type FeatureSymbolKind = 'module' | 'container' | 'parameter' | 'reference';

export interface SymbolData {
	name: string;
	detail?: string;
	kind: FeatureSymbolKind;
	range: Range;
	selectionRange: Range;
	children: SymbolData[];
}

/** The token's visible text, present only when both a value and a range exist. */
function tokenText(rawPath: string | undefined, range: Range | undefined): { rawPath: string; range: Range } | undefined {
	if (rawPath === undefined || rawPath === '' || range === undefined) {
		return undefined;
	}
	return { rawPath, range };
}

/** One token, with `dest` present only when the model supplied it. */
function tokenOf(kind: RefTokenKind, text: { rawPath: string; range: Range }, dest: string | undefined): RefToken {
	return dest === undefined ? { kind, ...text } : { kind, ...text, dest };
}

/** Appends a token unless the model omitted its text or range. */
function pushRefToken(
	out: RefToken[],
	kind: RefTokenKind,
	rawPath: string | undefined,
	range: Range | undefined,
	dest?: string
): void {
	const text = tokenText(rawPath, range);
	if (text !== undefined) {
		out.push(tokenOf(kind, text, dest));
	}
}

/** Every `DEFINITION-REF` and reference target in declaration order. */
export function refTokens(model: EcucDocumentModel): RefToken[] {
	const out: RefToken[] = [];
	const container = (node: ContainerNode): void => {
		pushRefToken(out, 'definition', node.definitionRef, node.definitionRefRange);
		for (const parameter of node.parameters) {
			pushRefToken(out, 'definition', parameter.definitionRef, parameter.definitionRefRange, parameter.definitionDest);
		}
		for (const reference of node.references) {
			pushRefToken(out, 'definition', reference.definitionRef, reference.definitionRefRange);
			pushRefToken(out, 'target', reference.targetRawPath, reference.targetRange, reference.targetDest);
		}
		for (const child of node.containers) {
			container(child);
		}
	};
	for (const module of model.modules) {
		pushRefToken(out, 'definition', module.definitionRef, module.definitionRefRange);
		for (const child of module.containers) {
			container(child);
		}
	}
	return out;
}

/** True when the offset falls inside the token's inclusive range. */
function containsOffset(token: RefToken, offset: number): boolean {
	return token.range.start <= offset && offset <= token.range.end;
}

/** The character width of a token's range. */
function spanOf(token: RefToken): number {
	return token.range.end - token.range.start;
}

/** True when `token` is a smaller match than the current best. */
function isInnermost(token: RefToken, best: RefToken | undefined): boolean {
	return best === undefined || spanOf(token) < spanOf(best);
}

/** The token whose range contains `offset`, preferring the innermost match. */
export function refTokenAt(model: EcucDocumentModel, offset: number): RefToken | undefined {
	let best: RefToken | undefined;
	for (const token of refTokens(model)) {
		if (containsOffset(token, offset) && isInnermost(token, best)) {
			best = token;
		}
	}
	return best;
}

/** Document symbols for an ECUC-Values model, in declaration order. */
export function documentSymbols(model: EcucDocumentModel): SymbolData[] {
	return model.modules.map(moduleSymbol);
}

function moduleSymbol(module: ModuleNode): SymbolData {
	return {
		name: module.shortName || tail(module.definitionRef),
		detail: module.definitionRef,
		kind: 'module',
		range: module.range,
		selectionRange: module.shortNameRange ?? module.range,
		children: module.containers.map(containerSymbol),
	};
}

/** A container's display name: its SHORT-NAME, or the definition's tail. */
function containerName(container: ContainerNode): string {
	return container.shortName || tail(container.definitionRef);
}

/** A container's children in declaration order: parameters, references, containers. */
function containerChildren(container: ContainerNode): SymbolData[] {
	return [
		...container.parameters.map(parameterSymbol),
		...container.references.map(referenceSymbol),
		...container.containers.map(containerSymbol),
	];
}

function containerSymbol(container: ContainerNode): SymbolData {
	return {
		name: containerName(container),
		detail: container.definitionRef,
		kind: 'container',
		range: container.range,
		selectionRange: container.shortNameRange ?? container.range,
		children: containerChildren(container),
	};
}

function parameterSymbol(parameter: ParameterNode): SymbolData {
	return {
		name: parameter.name,
		detail: parameter.definitionRef,
		kind: 'parameter',
		range: parameter.range,
		selectionRange: parameter.definitionRefRange ?? parameter.range,
		children: [],
	};
}

function referenceSymbol(reference: ReferenceNode): SymbolData {
	return {
		name: reference.name,
		detail: reference.targetRawPath ?? reference.definitionRef,
		kind: 'reference',
		range: reference.range,
		selectionRange: reference.definitionRefRange ?? reference.range,
		children: [],
	};
}

function tail(path: string): string {
	const at = path.lastIndexOf('/');
	return at < 0 ? path : path.slice(at + 1);
}
