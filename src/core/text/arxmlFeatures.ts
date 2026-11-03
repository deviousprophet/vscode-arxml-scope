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

/** Every `DEFINITION-REF` and reference target in declaration order. */
export function refTokens(model: EcucDocumentModel): RefToken[] {
	const out: RefToken[] = [];
	const push = (kind: RefTokenKind, rawPath: string | undefined, range: Range | undefined): void => {
		if (rawPath !== undefined && rawPath !== '' && range !== undefined) {
			out.push({ kind, rawPath, range });
		}
	};
	const container = (node: ContainerNode): void => {
		push('definition', node.definitionRef, node.definitionRefRange);
		for (const parameter of node.parameters) {
			push('definition', parameter.definitionRef, parameter.definitionRefRange);
		}
		for (const reference of node.references) {
			push('definition', reference.definitionRef, reference.definitionRefRange);
			push('target', reference.targetRawPath, reference.targetRange);
		}
		for (const child of node.containers) {
			container(child);
		}
	};
	for (const module of model.modules) {
		push('definition', module.definitionRef, module.definitionRefRange);
		for (const child of module.containers) {
			container(child);
		}
	}
	return out;
}

/** The token whose range contains `offset`, preferring the innermost match. */
export function refTokenAt(model: EcucDocumentModel, offset: number): RefToken | undefined {
	let best: RefToken | undefined;
	for (const token of refTokens(model)) {
		if (token.range.start <= offset && offset <= token.range.end) {
			if (best === undefined || token.range.end - token.range.start < best.range.end - best.range.start) {
				best = token;
			}
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

function containerSymbol(container: ContainerNode): SymbolData {
	const children: SymbolData[] = [];
	for (const parameter of container.parameters) {
		children.push(parameterSymbol(parameter));
	}
	for (const reference of container.references) {
		children.push(referenceSymbol(reference));
	}
	for (const child of container.containers) {
		children.push(containerSymbol(child));
	}
	return {
		name: container.shortName || tail(container.definitionRef),
		detail: container.definitionRef,
		kind: 'container',
		range: container.range,
		selectionRange: container.shortNameRange ?? container.range,
		children,
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
