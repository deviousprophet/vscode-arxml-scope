/**
 * The workspace index value model.
 *
 * A `FileIndex` is the complete contribution of one `.arxml` file. It contains
 * only strings, numbers and offset ranges, so the workspace index never retains
 * a file's text. Offsets are UTF-16 code units into that file, converted to
 * line/column only at the VS Code boundary.
 */
import type { Range } from '../ecuc/model';

/** One ECUC value element found in a file. */
export interface IndexElement {
	kind: 'module' | 'container' | 'parameter';
	/** AR path for a module or container; absent for a parameter value. */
	path?: string;
	/** The enclosing module/container path for a parameter value. */
	sourcePath?: string;
	/** The element's own `DEFINITION-REF`. */
	definitionRef?: string;
	/** The `DEST` of the element's `DEFINITION-REF`. */
	definitionDest?: string;
	shortName?: string;
	uuid?: string;
	/** Decoded parameter `<VALUE>` text, when present. */
	value?: string;
	/**
	 * FNV-1a over the element's normalized subtree. Set for `module` and
	 * `container` only; used to tell split copies from identical copies.
	 */
	contentHash?: number;
	/** Normalized own `VARIATION-POINT/SW-SYSCOND` text, when present. */
	syscond?: string;
	file: string;
	range: Range;
}

/** One ECUC reference value, with the information needed for cross-file lookup. */
export interface IndexReference {
	kind: 'reference';
	/** The AR path of the containing module/container, when one is known. */
	sourcePath?: string;
	definitionRef?: string;
	/** The `DEST` of the reference value's `DEFINITION-REF`. */
	definitionDest?: string;
	shortName?: string;
	uuid?: string;
	/** Verbatim `VALUE-REF` / `TARGET-REF` text. */
	targetRawPath?: string;
	/** `DEST` of the `VALUE-REF` / `TARGET-REF`. */
	targetDest?: string;
	contextPaths: string[];
	/** Normalized own `VARIATION-POINT/SW-SYSCOND` text, when present. */
	syscond?: string;
	file: string;
	range: Range;
}

/**
 * One ECUC definition element (a module, container, parameter or reference
 * definition). The raw fields are kept deliberately: `definitions.ts` owns the
 * normalization and the display rules.
 */
export interface IndexDefinition {
	/** The definition's own AR path, e.g. `/Pack/Mod/Cont/Param`. */
	path: string;
	/** The element tag, e.g. `ECUC-INTEGER-PARAM-DEF`. */
	kind: string;
	shortName: string;
	description?: string;
	defaultValue?: string;
	lowerLimit?: string;
	upperLimit?: string;
	minValue?: string;
	maxValue?: string;
	minLength?: string;
	maxLength?: string;
	lowerMultiplicity?: string;
	upperMultiplicity?: string;
	/** AUTOSAR's `UPPER-MULTIPLICITY-INFINITE` flag, when present. */
	upperMultiplicityInfinite?: boolean;
	/** The `DESTINATION-REF` text (the target AR path). */
	destinationRef?: string;
	/** The `DEST` attribute of `DESTINATION-REF` (the target type). */
	destinationDest?: string;
	/** AUTOSAR `WITH-AUTO`: the configuration tool assigns this element. */
	withAuto?: boolean;
	literals?: string[];
	file: string;
	range: Range;
}

/** One file's contribution to the workspace index. */
export interface FileIndex {
	uri: string;
	/** Schema release from `xsi:schemaLocation`, when present. */
	schemaRelease?: string;
	/** Every `AR-PACKAGE` path this file contributes to. */
	packages: string[];
	/** UTF-16 offsets of every line start, for diagnostic positions. */
	lineStarts?: number[];
	elements: IndexElement[];
	references: IndexReference[];
	definitions: IndexDefinition[];
}

/** Aggregate counts for the status bar and tests. */
export interface IndexStats {
	files: number;
	elements: number;
	references: number;
	definitions: number;
	packages: number;
}
