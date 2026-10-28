/**
 * ARTEXT information model for a single ECUC-Values arxml file.
 *
 * Contract: parent design §4. Every node carries the source range needed for
 * navigation and editing. Offsets are UTF-16 code units into the caller's text,
 * matching VS Code `Position`. No `vscode` import may appear in this module.
 */

/** UTF-16 offsets into the source text. */
export interface Range {
	start: number;
	end: number;
}

/** Values contributed by `VARIATION-POINT` and `ANNOTATIONS`, shared by every gst-bearing node. */
export interface Suffixes {
	/** `SW-SYSCOND` text, trimmed. */
	syscond?: string;
	syscondRange?: Range;
	postBuildVariants?: { criterion: string; operator: string; value: string }[];
	postBuildRange?: Range;
	annotations?: { label?: string; text?: string; range?: Range }[];
}

export interface ModuleNode extends Suffixes {
	kind: 'module';
	definitionRef: string;
	definitionRefRange?: Range;
	shortName: string;
	shortNameRange?: Range;
	variant?: string;
	variantRange?: Range;
	/** Whole `ECUC-MODULE-CONFIGURATION-VALUES` element. */
	range: Range;
	containers: ContainerNode[];
}

export interface ContainerNode extends Suffixes {
	kind: 'container';
	definitionRef: string;
	definitionRefRange?: Range;
	shortName: string;
	shortNameRange?: Range;
	range: Range;
	/** Ancestor `SHORT-NAME` chain, module last. */
	containerPath: string[];
	parameters: ParameterNode[];
	references: ReferenceNode[];
	containers: ContainerNode[];
}

export interface ParameterNode extends Suffixes {
	kind: 'parameter';
	numeric: boolean;
	/** `DEFINITION-REF DEST` value, when the document provides it. */
	definitionDest?: string;
	definitionRef: string;
	definitionRefRange?: Range;
	/** `DEFINITION-REF` tail. */
	name: string;
	/** Entity-decoded text for display. */
	displayValue?: string;
	/** Text content inside `<VALUE>`. */
	valueRange?: Range;
	range: Range;
}

export interface ReferenceNode extends Suffixes {
	kind: 'reference';
	instance: boolean;
	definitionRef: string;
	definitionRefRange?: Range;
	name: string;
	/** Verbatim `VALUE-REF` / `TARGET-REF` text. */
	targetRawPath?: string;
	/** Dotted equivalent of `\structify`. */
	targetPath?: string;
	contextPaths: string[];
	/** Text content inside `VALUE-REF` / `TARGET-REF`. */
	targetRange?: Range;
	range: Range;
}

export interface EcucDocumentModel {
	schema?: { release: string };
	/** Ancestor `AR-PACKAGE` chain per module. */
	packages: { path: string[]; range: Range }[];
	modules: ModuleNode[];
	/** `SHORT-NAME` path -> element range, same file. */
	pathIndex: Map<string, Range>;
}

export type SortMode = 'all' | 'declaration';

/** `DEFINITION-REF` tail. */
export function lastShortName(path: string): string {
	const i = path.lastIndexOf('/');
	return i < 0 ? path : path.slice(i + 1);
}
