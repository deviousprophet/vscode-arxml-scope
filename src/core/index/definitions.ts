/**
 * ECUC definition normalization and lookup.
 *
 * The index stores raw definition fields exactly as the file writes them; this
 * module owns the display rules. A missing or ambiguous definition resolves to
 * `undefined` — the editor never invents a type or a range.
 */
import type { IndexDefinition } from './indexModel';
import type { WorkspaceIndex } from './workspaceIndex';

/** One resolved definition, in the shape the row/details model consumes. */
export interface DefinitionInfo {
	/** The definition element tag, e.g. `ECUC-INTEGER-PARAM-DEF`. */
	kind: string;
	/** The normalized display type, e.g. `Integer`. */
	type: string;
	range?: string;
	defaultValue?: string;
	multiplicity?: string;
	/** The destination type (`DESTINATION-REF`'s `DEST`) when declared. */
	destination?: string;
	literals?: string[];
	description?: string;
	/** The definition file's URI. */
	file: string;
	/** The definition file's last path segment, for the Details row. */
	fileName: string;
}

/** The row/details lookup over an index. Returns nothing on an absent/ambiguous ref. */
export type DefinitionLookup = (definitionRef: string) => DefinitionInfo | undefined;

/** Resolves a `DEFINITION-REF` against the workspace index and normalizes it. */
export function resolveDefinition(index: WorkspaceIndex, definitionRef: string): DefinitionInfo | undefined {
	const entry = index.definitionEntry(definitionRef);
	return entry === undefined ? undefined : definitionInfo(entry);
}

/** Normalizes one raw index record into the display shape. */
export function definitionInfo(definition: IndexDefinition): DefinitionInfo {
	const info: DefinitionInfo = {
		kind: definition.kind,
		type: definitionType(definition.kind),
		file: definition.file,
		fileName: fileNameOf(definition.file),
	};
	const range = definitionRange(definition);
	if (range !== undefined) {
		info.range = range;
	}
	if (definition.defaultValue !== undefined) {
		info.defaultValue = definition.defaultValue;
	}
	const lower = multiplicityValue(definition.lowerMultiplicity);
	const upper = definition.upperMultiplicityInfinite === true ? -1 : multiplicityValue(definition.upperMultiplicity);
	const multiplicity = multiplicityText(lower, upper);
	if (multiplicity !== undefined) {
		info.multiplicity = multiplicity;
	}
	const destination = definition.destinationDest ?? definition.destinationRef;
	if (destination !== undefined) {
		info.destination = destination;
	}
	if (definition.literals !== undefined && definition.literals.length > 0) {
		info.literals = definition.literals.slice();
	}
	if (definition.description !== undefined) {
		info.description = definition.description;
	}
	return info;
}

const TYPES = new Map<string, string>([
	['ECUC-INTEGER-PARAM-DEF', 'Integer'],
	['ECUC-FLOAT-PARAM-DEF', 'Float'],
	['ECUC-BOOLEAN-PARAM-DEF', 'Boolean'],
	['ECUC-STRING-PARAM-DEF', 'String'],
	['ECUC-ENUMERATION-PARAM-DEF', 'Enumeration'],
	['ECUC-FUNCTION-NAME-DEF', 'Function name'],
	['ECUC-LINKER-SYMBOL-DEF', 'Linker symbol'],
	['ECUC-PARAM-CONF-CONTAINER-DEF', 'Container'],
	['ECUC-MODULE-DEF', 'Module'],
	['ECUC-REFERENCE-DEF', 'Reference'],
	['ECUC-INSTANCE-REFERENCE-DEF', 'Instance reference'],
	['ECUC-ADD-INFO-PARAM-DEF', 'Add info parameter'],
]);

/** A stable display name for a definition kind. */
export function definitionType(kind: string): string {
	const known = TYPES.get(kind);
	if (known !== undefined) {
		return known;
	}
	const middle = kind.startsWith('ECUC-') && kind.endsWith('-DEF') ? kind.slice(5, -4) : kind;
	const words = middle.toLowerCase().replace(/-/g, ' ').trim();
	return words === '' ? kind : words.charAt(0).toUpperCase() + words.slice(1);
}

/** The declared range/length, from whichever endpoint fields the definition provides. */
export function definitionRange(definition: IndexDefinition): string | undefined {
	if (definition.kind === 'ECUC-STRING-PARAM-DEF') {
		return joinedRange(definition.minLength, definition.maxLength, 'chars');
	}
	return joinedRange(
		definition.lowerLimit ?? definition.minValue,
		definition.upperLimit ?? definition.maxValue,
		undefined
	);
}

function joinedRange(lower: string | undefined, upper: string | undefined, suffix: string | undefined): string | undefined {
	const unit = suffix === undefined ? '' : ` ${suffix}`;
	if (lower !== undefined && upper !== undefined) {
		return `${lower} .. ${upper}${unit}`;
	}
	if (lower !== undefined) {
		return `>= ${lower}${unit}`;
	}
	if (upper !== undefined) {
		return `<= ${upper}${unit}`;
	}
	return undefined;
}

/** Parses a multiplicity token; `*` and `UNBOUNDED` mean unlimited. */
export function multiplicityValue(raw: string | undefined): number | undefined {
	if (raw === undefined) {
		return undefined;
	}
	const text = raw.trim();
	if (text === '*') {
		return -1;
	}
	if (/^unbounded$/i.test(text)) {
		return -1;
	}
	if (!/^\d+$/.test(text)) {
		return undefined;
	}
	const value = Number.parseInt(text, 10);
	return Number.isFinite(value) ? value : undefined;
}

/** The display multiplicity, or nothing when neither endpoint is declared. */
export function multiplicityText(lower: number | undefined, upper: number | undefined): string | undefined {
	if (lower === undefined && upper === undefined) {
		return undefined;
	}
	// AUTOSAR's ECUC lower multiplicity defaults to 0 when the element omits it.
	const low = lower === undefined ? 0 : lower;
	if (upper === undefined) {
		return `${low}..`;
	}
	if (upper === -1) {
		return `${low}..*`;
	}
	if (lower !== undefined && upper === lower) {
		return `${low}`;
	}
	return `${low}..${upper}`;
}

/** The file name in a `file:` URI, for the provenance row. */
function fileNameOf(file: string): string {
	const withoutQuery = file.split(/[?#]/)[0];
	const segments = withoutQuery.split('/');
	const last = segments[segments.length - 1];
	if (last === undefined || last === '') {
		return file;
	}
	try {
		return decodeURIComponent(last);
	} catch {
		return last;
	}
}
