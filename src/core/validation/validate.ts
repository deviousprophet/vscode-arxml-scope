/**
 * ECUC rule engine. Pure over the in-memory index; no `vscode` import.
 *
 * Every rule is best-effort: an ambiguous path is a diagnostic, never a guess.
 * The host converts the returned offset ranges to editor positions.
 */
import type { IndexDefinition, IndexElement, IndexReference } from '../index/indexModel';
import { multiplicityValue } from '../index/definitions';
import type { WorkspaceIndex } from '../index/workspaceIndex';
import {
	DEFAULT_SEVERITIES,
	DiagnosticRule,
	EcucDiagnostic,
	SeveritySettings,
} from './types';

export function validateWorkspace(index: WorkspaceIndex, severities: SeveritySettings = DEFAULT_SEVERITIES): EcucDiagnostic[] {
	const out: EcucDiagnostic[] = [];
	const add = (rule: DiagnosticRule, file: string, range: { start: number; end: number }, message: string): void => {
		const severity = severities[rule];
		if (severity === 'off') {
			return;
		}
		out.push({ rule, severity, message, file, range });
	};

	const files = index.fileList();
	const elements: IndexElement[] = [];
	const references: IndexReference[] = [];
	const definitions: IndexDefinition[] = [];
	for (const file of files) {
		for (const element of file.elements) {
			elements.push(element);
		}
		for (const reference of file.references) {
			references.push(reference);
		}
		for (const definition of file.definitions) {
			definitions.push(definition);
		}
	}
	const hasDefinitions = definitions.length > 0;

	const elementsByParent = new Map<string, IndexElement[]>();
	const elementsByPath = new Map<string, IndexElement[]>();
	for (const element of elements) {
		if (element.path !== undefined) {
			const group = elementsByPath.get(element.path);
			if (group === undefined) {
				elementsByPath.set(element.path, [element]);
			} else {
				group.push(element);
			}
			const parent = parentPath(element.path);
			if (parent !== undefined && element.kind === 'container') {
				addTo(elementsByParent, parent, element);
			}
		}
		if (element.kind === 'parameter' && element.sourcePath !== undefined) {
			addTo(elementsByParent, element.sourcePath, element);
		}
	}
	const referencesBySource = new Map<string, IndexReference[]>();
	for (const reference of references) {
		if (reference.sourcePath !== undefined) {
			addTo(referencesBySource, reference.sourcePath, reference);
		}
	}

	// Broken references and DEST mismatches.
	for (const reference of references) {
		const resolution = index.resolveReference(reference);
		if (resolution.ok) {
			continue;
		}
		if (resolution.reason === 'dest-mismatch') {
			add(
				'destMismatch',
				reference.file,
				reference.range,
				`Reference target "${resolution.target ?? ''}" is a ${resolution.actualKind ?? 'different element'}, not the declared DEST.`
			);
			continue;
		}
		const reason = resolution.reason === 'ambiguous' ? 'ambiguous' : resolution.reason === 'no-target' ? 'missing' : 'not found';
		add(
			'brokenReference',
			reference.file,
			reference.range,
			`Reference target "${resolution.target ?? ''}" is ${reason} in the workspace.`
		);
	}

	// Duplicate SHORT-NAME / AR path.
	for (const [path, group] of elementsByPath) {
		if (group.length < 2) {
			continue;
		}
		const name = group[0].shortName ?? path;
		for (const element of group) {
			add(
				'duplicateShortName',
				element.file,
				element.range,
				`SHORT-NAME "${name}" is declared ${group.length} times for ${path}.`
			);
		}
	}

	// Value ranges and string lengths.
	for (const element of elements) {
		if (element.kind !== 'parameter' || element.value === undefined || element.definitionRef === undefined) {
			continue;
		}
		const definition = index.definitionEntry(element.definitionRef);
		if (definition === undefined) {
			continue;
		}
		const problem = valueProblem(definition, element.value);
		if (problem !== undefined) {
			add('valueOutOfRange', element.file, element.range, `Value "${element.value}" ${problem}.`);
		}
	}

	// Multiplicity, grouped by the owning parent.
	const multiplicityGroups = new Map<string, { definitionRef: string; elements: IndexElement[]; references: IndexReference[] }>();
	for (const element of elements) {
		if (element.definitionRef === undefined) {
			continue;
		}
		let key: string | undefined;
		if (element.kind === 'module') {
			key = `module|${element.definitionRef}`;
		} else if (element.kind === 'container' && element.path !== undefined) {
			key = `container|${parentPath(element.path) ?? ''}|${element.definitionRef}`;
		} else if (element.kind === 'parameter' && element.sourcePath !== undefined) {
			key = `parameter|${element.sourcePath}|${element.definitionRef}`;
		}
		if (key !== undefined) {
			const group = multiplicityGroups.get(key) ?? { definitionRef: element.definitionRef, elements: [], references: [] };
			group.elements.push(element);
			multiplicityGroups.set(key, group);
		}
	}
	for (const reference of references) {
		if (reference.definitionRef === undefined || reference.sourcePath === undefined) {
			continue;
		}
		const key = `reference|${reference.sourcePath}|${reference.definitionRef}`;
		const group = multiplicityGroups.get(key) ?? { definitionRef: reference.definitionRef, elements: [], references: [] };
		group.references.push(reference);
		multiplicityGroups.set(key, group);
	}
	for (const group of multiplicityGroups.values()) {
		const definition = index.definitionEntry(group.definitionRef);
		if (definition === undefined) {
			continue;
		}
		const lowerRaw = multiplicityValue(definition.lowerMultiplicity);
		const upper = definition.upperMultiplicityInfinite === true ? -1 : multiplicityValue(definition.upperMultiplicity);
		if (lowerRaw === undefined && upper === undefined) {
			continue;
		}
		const lower = lowerRaw ?? 0;
		const count = group.elements.length + group.references.length;
		if (count < lower || (upper !== undefined && upper >= 0 && count > upper)) {
			const first = group.elements[0] ?? group.references[0];
			const expected = upper === undefined ? `${lower}..` : upper < 0 ? `${lower}..*` : lower === upper ? `${lower}` : `${lower}..${upper}`;
			add(
				'multiplicity',
				first.file,
				first.range,
				`"${definition.shortName}" occurs ${count} times; the definition allows ${expected}.`
			);
		}
	}

	// Missing definitions (only when the workspace actually carries definitions).
	if (hasDefinitions) {
		for (const element of elements) {
			if (element.definitionRef !== undefined && index.definitionEntry(element.definitionRef) === undefined) {
				add(
					'missingDefinition',
					element.file,
					element.range,
					`Definition "${element.definitionRef}" is not in the workspace index.`
				);
			}
		}
		for (const reference of references) {
			if (reference.definitionRef !== undefined && index.definitionEntry(reference.definitionRef) === undefined) {
				add(
					'missingDefinition',
					reference.file,
					reference.range,
					`Definition "${reference.definitionRef}" is not in the workspace index.`
				);
			}
		}
	}

	// Required child containers, parameters and references.
	const childrenByDefinition = new Map<string, IndexDefinition[]>();
	for (const definition of definitions) {
		const parent = parentPath(definition.path);
		if (parent !== undefined) {
			addTo(childrenByDefinition, parent, definition);
		}
	}
	for (const element of elements) {
		if ((element.kind !== 'module' && element.kind !== 'container') || element.path === undefined || element.definitionRef === undefined) {
			continue;
		}
		const definition = index.definitionEntry(element.definitionRef);
		if (definition === undefined) {
			continue;
		}
		const children = childrenByDefinition.get(definition.path) ?? [];
		const instances = elementsByParent.get(element.path) ?? [];
		const sourceReferences = referencesBySource.get(element.path) ?? [];
		for (const child of children) {
			const lower = multiplicityValue(child.lowerMultiplicity) ?? 0;
			if (lower <= 0) {
				continue;
			}
			const isReference = child.kind.endsWith('-REFERENCE-DEF');
			const isContainer = child.kind.endsWith('-CONTAINER-DEF');
			const canonical = (ref: string | undefined): string | undefined =>
				ref === undefined ? undefined : index.definitionEntry(ref)?.path;
			const present = isReference
				? sourceReferences.some((reference) => canonical(reference.definitionRef) === child.path)
				: instances.some(
						(instance) =>
							(isContainer ? instance.kind === 'container' : instance.kind === 'parameter') &&
							canonical(instance.definitionRef) === child.path
					);
			if (!present) {
				const kind = isReference ? 'reference' : isContainer ? 'container' : 'parameter';
				add(
					'missingRequired',
					element.file,
					element.range,
					`Missing required ${kind} "${child.shortName}" (lower multiplicity ${lower}).`
				);
			}
		}
	}

	return out;
}

function addTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
	const group = map.get(key);
	if (group === undefined) {
		map.set(key, [value]);
	} else {
		group.push(value);
	}
}

function parentPath(path: string): string | undefined {
	const at = path.lastIndexOf('/');
	return at <= 0 ? undefined : path.slice(0, at);
}

/** A displayable reason the value violates the definition, or undefined. */
function valueProblem(definition: IndexDefinition, value: string): string | undefined {
	if (definition.kind === 'ECUC-INTEGER-PARAM-DEF') {
		const parsed = parseInteger(value);
		if (parsed === undefined) {
			return 'is not a valid integer';
		}
		const lower = definition.lowerLimit === undefined ? undefined : parseInteger(definition.lowerLimit);
		const upper = definition.upperLimit === undefined ? undefined : parseInteger(definition.upperLimit);
		if (lower !== undefined && parsed < lower) {
			return `is below the lower limit ${definition.lowerLimit}`;
		}
		if (upper !== undefined && parsed > upper) {
			return `is above the upper limit ${definition.upperLimit}`;
		}
		return undefined;
	}
	if (definition.kind === 'ECUC-FLOAT-PARAM-DEF') {
		const parsed = Number(value.trim());
		if (!Number.isFinite(parsed)) {
			return 'is not a valid float';
		}
		const lower = definition.minValue === undefined ? undefined : Number(definition.minValue);
		const upper = definition.maxValue === undefined ? undefined : Number(definition.maxValue);
		if (lower !== undefined && Number.isFinite(lower) && parsed < lower) {
			return `is below the minimum ${definition.minValue}`;
		}
		if (upper !== undefined && Number.isFinite(upper) && parsed > upper) {
			return `is above the maximum ${definition.maxValue}`;
		}
		return undefined;
	}
	if (definition.kind === 'ECUC-STRING-PARAM-DEF') {
		const length = Array.from(value).length;
		const lower = numberValue(definition.minLength);
		const upper = numberValue(definition.maxLength);
		if (lower !== undefined && length < lower) {
			return `is shorter than ${lower} characters`;
		}
		if (upper !== undefined && length > upper) {
			return `is longer than ${upper} characters`;
		}
	}
	return undefined;
}

function parseInteger(text: string): bigint | undefined {
	let raw = text.trim();
	if (raw === '') {
		return undefined;
	}
	let sign = 1n;
	if (raw.startsWith('-') || raw.startsWith('+')) {
		sign = raw.startsWith('-') ? -1n : 1n;
		raw = raw.slice(1);
	}
	let value: bigint;
	if (/^0[xX][0-9a-fA-F]+$/.test(raw)) {
		value = BigInt(raw);
	} else if (/^0[bB][01]+$/.test(raw)) {
		value = BigInt(raw);
	} else if (/^\d+$/.test(raw)) {
		value = BigInt(raw);
	} else {
		return undefined;
	}
	return sign * value;
}

function numberValue(raw: string | undefined): number | undefined {
	if (raw === undefined) {
		return undefined;
	}
	const value = Number(raw.trim());
	return Number.isFinite(value) ? value : undefined;
}
