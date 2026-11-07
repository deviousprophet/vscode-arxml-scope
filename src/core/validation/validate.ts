/**
 * ECUC rule engine. Pure over the in-memory index; no `vscode` import.
 *
 * Every rule is best-effort: an ambiguous path is a diagnostic, never a guess.
 * The host converts the returned offset ranges to editor positions.
 */
import type { IndexDefinition, IndexElement, IndexReference } from '../index/indexModel';
import { ecucIntegerValue } from '../ecuc/numeric';
import { multiplicityValue } from '../index/definitions';
import type { WorkspaceIndex } from '../index/workspaceIndex';
import { DEFAULT_SEVERITIES } from './types';
import type {
	CrossFileMode,
	DiagnosticLevel,
	DiagnosticRelated,
	DiagnosticRule,
	EcucDiagnostic,
	SeveritySettings,
} from './types';

/** DESTs that name an indexed element with an AR path; all others are not judged. */
const CHECKED_TARGET_DESTS = new Set(['ECUC-MODULE-CONFIGURATION-VALUES', 'ECUC-CONTAINER-VALUE']);

/** Batch sizes for the sliced pass; each is sized to keep a slice well under 50 ms. */
const YIELD_ITEMS = 4000;
const YIELD_SCAN = 1000;
const YIELD_GROUPS = 500;

export function validateWorkspace(
	index: WorkspaceIndex,
	severities: SeveritySettings = DEFAULT_SEVERITIES,
	crossFileRules: CrossFileMode = 'auto'
): EcucDiagnostic[] {
	const iterator = validateWorkspaceSlices(index, severities, crossFileRules);
	while (true) {
		const step = iterator.next();
		if (step.done) {
			return step.value;
		}
	}
}

/**
 * The same rule pass, yielding after bounded batches so the host can keep the
 * extension host responsive. The generator's return value is the complete list.
 */
export function* validateWorkspaceSlices(
	index: WorkspaceIndex,
	severities: SeveritySettings = DEFAULT_SEVERITIES,
	crossFileRules: CrossFileMode = 'auto'
): Generator<void, EcucDiagnostic[], void> {
	const out: EcucDiagnostic[] = [];
	const add = (
		rule: DiagnosticRule,
		file: string,
		range: { start: number; end: number },
		message: string,
		override?: DiagnosticLevel,
		related?: DiagnosticRelated[]
	): void => {
		const severity = override ?? severities[rule];
		if (severity === 'off') {
			return;
		}
		out.push({ rule, severity, message, file, range, ...(related === undefined ? {} : { related }) });
	};

	const files = index.fileList();
	const elements: IndexElement[] = [];
	const references: IndexReference[] = [];
	const definitions: IndexDefinition[] = [];
	let flattenCount = 0;
	for (const file of files) {
		for (const element of file.elements) {
			elements.push(element);
			if (++flattenCount % YIELD_ITEMS === 0) {
				yield;
			}
		}
		for (const reference of file.references) {
			references.push(reference);
			if (++flattenCount % YIELD_ITEMS === 0) {
				yield;
			}
		}
		for (const definition of file.definitions) {
			definitions.push(definition);
			if (++flattenCount % YIELD_ITEMS === 0) {
				yield;
			}
		}
	}

	const elementsByParent = new Map<string, IndexElement[]>();
	const elementsByPath = new Map<string, IndexElement[]>();
	for (const element of elements) {
		if (element.path !== undefined) {
			addTo(elementsByPath, element.path, element);
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
	const crossFile = crossFileRules === 'always' || (crossFileRules === 'auto' && definitions.length > 0);

	// Broken references and DEST mismatches, only for DESTs with an indexed path.
	let referenceCount = 0;
	for (const reference of references) {
		if (!crossFile) {
			break;
		}
		if (++referenceCount % YIELD_SCAN === 0) {
			yield;
		}
		if (reference.targetDest !== undefined && !CHECKED_TARGET_DESTS.has(reference.targetDest)) {
			continue;
		}
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

	// Duplicate SHORT-NAME / AR path: one diagnostic, with the other declarations attached.
	let duplicateCount = 0;
	for (const [path, group] of elementsByPath) {
		if (++duplicateCount % YIELD_SCAN === 0) {
			yield;
		}
		if (group.length < 2) {
			continue;
		}
		const sorted = [...group].sort(
			(left, right) => left.file.localeCompare(right.file) || left.range.start - right.range.start
		);
		const first = sorted[0];
		const name = first.shortName ?? path;
		const fileCount = new Set(sorted.map((element) => element.file)).size;
		if (fileCount > 1 && !crossFile) {
			continue;
		}
		const sameIdentity = sorted.every(
			(element) => element.kind === first.kind && element.definitionRef === first.definitionRef
		);
		const hashes = new Set(sorted.map((element) => element.contentHash));
		const identical = hashes.size < sorted.length;
		const guards = new Set(sorted.map((element) => element.syscond ?? ''));
		const allVariants = sorted.length > 1 && guards.size === sorted.length && !guards.has('');

		// AUTOSAR split files repeat one container per file with different children;
		// the copies are one merged element, not duplicates.
		if (sameIdentity && fileCount > 1 && !identical) {
			continue;
		}
		// Identical copies that are mutually exclusive variants.
		if (allVariants) {
			continue;
		}
		const related: DiagnosticRelated[] = sorted.slice(1).map((element) => ({
			file: element.file,
			range: element.range,
			message: 'Also declared here.',
		}));
		add(
			'duplicateShortName',
			first.file,
			first.range,
			`SHORT-NAME "${name}" is declared ${sorted.length} times for ${path} (${fileCount} file${fileCount === 1 ? '' : 's'}).`,
			fileCount > 1 ? 'information' : undefined,
			related
		);
	}

	// Value ranges, type forms and string lengths.
	let valueCount = 0;
	for (const element of elements) {
		if (++valueCount % YIELD_SCAN === 0) {
			yield;
		}
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

	// Multiplicity, counted inside one file and one owning parent.
	const multiplicityGroups = new Map<
		string,
		{ definitionRef: string; elements: IndexElement[]; references: IndexReference[] }
	>();
	let multiplicityCount = 0;
	for (const element of elements) {
		if (++multiplicityCount % YIELD_ITEMS === 0) {
			yield;
		}
		if (element.definitionRef === undefined) {
			continue;
		}
		let key: string | undefined;
		if (element.kind === 'module') {
			key = `module|${element.file}|${element.definitionRef}`;
		} else if (element.kind === 'container' && element.path !== undefined) {
			key = `container|${element.file}|${parentPath(element.path) ?? ''}|${element.definitionRef}`;
		} else if (element.kind === 'parameter' && element.sourcePath !== undefined) {
			key = `parameter|${element.file}|${element.sourcePath}|${element.definitionRef}`;
		}
		if (key !== undefined) {
			const group = multiplicityGroups.get(key) ?? { definitionRef: element.definitionRef, elements: [], references: [] };
			group.elements.push(element);
			multiplicityGroups.set(key, group);
		}
	}
	for (const reference of references) {
		if (++multiplicityCount % YIELD_ITEMS === 0) {
			yield;
		}
		if (reference.definitionRef === undefined || reference.sourcePath === undefined) {
			continue;
		}
		const key = `reference|${reference.file}|${reference.sourcePath}|${reference.definitionRef}`;
		const group = multiplicityGroups.get(key) ?? { definitionRef: reference.definitionRef, elements: [], references: [] };
		group.references.push(reference);
		multiplicityGroups.set(key, group);
	}
	let multiplicityGroupCount = 0;
	for (const group of multiplicityGroups.values()) {
		if (++multiplicityGroupCount % YIELD_GROUPS === 0) {
			yield;
		}
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
		const perGuard = new Map<string, number>();
		for (const item of [...group.elements, ...group.references]) {
			const guard = item.syscond ?? '';
			perGuard.set(guard, (perGuard.get(guard) ?? 0) + 1);
		}
		// An unguarded occurrence is present under every condition, so it adds to
		// each guarded bucket. Distinct guards are mutually exclusive alternatives.
		const unguarded = perGuard.get('') ?? 0;
		const guarded = Math.max(0, ...[...perGuard].filter(([guard]) => guard !== '').map(([, value]) => value));
		const worst = unguarded + guarded;
		const exceedsUpper = upper !== undefined && upper >= 0 && worst > upper;
		const offender = exceedsUpper ? Math.max(worst, ...perGuard.values()) : count;
		const conditionCount = perGuard.size > (perGuard.has('') ? 1 : 0);
		if (count < lower || exceedsUpper) {
			const first = group.elements[0] ?? group.references[0];
			const expected = upper === undefined ? `${lower}..` : upper < 0 ? `${lower}..*` : lower === upper ? `${lower}` : `${lower}..${upper}`;
			add(
				'multiplicity',
				first.file,
				first.range,
				`"${definition.shortName}" occurs ${offender} times${exceedsUpper && conditionCount ? ' under one condition' : ''} in this file; the definition allows ${expected}.`
			);
		}
	}

	// Missing definitions: one diagnostic at the highest missing ancestor.
	const missingPaths = new Set<string>();
	const occurrences: Array<{ path: string; file: string; range: { start: number; end: number } }> = [];
	let missingCount = 0;
	for (const element of elements) {
		if (++missingCount % YIELD_ITEMS === 0) {
			yield;
		}
		if (element.definitionRef !== undefined && index.definitionCandidateCount(element.definitionRef) === 0) {
			missingPaths.add(element.definitionRef);
			occurrences.push({ path: element.definitionRef, file: element.file, range: element.range });
		}
	}
	for (const reference of references) {
		if (++missingCount % YIELD_ITEMS === 0) {
			yield;
		}
		if (reference.definitionRef !== undefined && index.definitionCandidateCount(reference.definitionRef) === 0) {
			missingPaths.add(reference.definitionRef);
			occurrences.push({ path: reference.definitionRef, file: reference.file, range: reference.range });
		}
	}
	if (missingPaths.size > 0) {
		const moduleDefinitions = new Set(
			elements
				.filter((element) => element.kind === 'module' && element.definitionRef !== undefined)
				.map((element) => element.definitionRef!)
		);
		const groups = new Map<string, { file: string; range: { start: number; end: number }; count: number }>();
		let occurrenceCount = 0;
		for (const occurrence of occurrences) {
			if (++occurrenceCount % YIELD_SCAN === 0) {
				yield;
			}
			const root = missingRoot(occurrence.path, missingPaths, moduleDefinitions);
			const group = groups.get(root);
			if (group === undefined) {
				groups.set(root, { file: occurrence.file, range: occurrence.range, count: 1 });
			} else {
				group.count++;
			}
		}
		for (const [root, group] of groups) {
			add(
				'missingDefinition',
				group.file,
				group.range,
				`Definition "${root}" is not in the workspace index (${group.count} instance${group.count === 1 ? '' : 's'}).`
			);
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
	let requiredCount = 0;
	for (const element of elements) {
		if (++requiredCount % YIELD_GROUPS === 0) {
			yield;
		}
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
		const canonical = new Map<string, string | undefined>();
		const pathOf = (ref: string | undefined): string | undefined => {
			if (ref === undefined) {
				return undefined;
			}
			if (!canonical.has(ref)) {
				canonical.set(ref, index.definitionEntry(ref)?.path);
			}
			return canonical.get(ref);
		};
		for (const child of children) {
			const lower = multiplicityValue(child.lowerMultiplicity) ?? 0;
			if (
				lower <= 0 ||
				child.kind === 'ECUC-ADD-INFO-PARAM-DEF' ||
				child.defaultValue !== undefined ||
				child.withAuto === true
			) {
				continue;
			}
			const isReference = child.kind.endsWith('-REFERENCE-DEF');
			const isContainer = child.kind.endsWith('-CONTAINER-DEF');
			const present = isReference
				? sourceReferences.some((reference) => pathOf(reference.definitionRef) === child.path)
				: instances.some(
						(instance) =>
							(isContainer ? instance.kind === 'container' : instance.kind === 'parameter') &&
							pathOf(instance.definitionRef) === child.path
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

/**
 * The path the missing-definition diagnostic should be anchored at: the nearest
 * module definition ancestor when one is missing, otherwise the highest missing
 * ancestor. A missing child of a present module stays anchored at the child.
 */
function missingRoot(path: string, missing: ReadonlySet<string>, moduleDefinitions: ReadonlySet<string>): string {
	const segments = path
		.split('/')
		.filter((segment) => segment.length > 0);
	let highest: string | undefined;
	let module: string | undefined;
	for (let at = 1; at <= segments.length; at++) {
		const candidate = '/' + segments.slice(0, at).join('/');
		if (!missing.has(candidate)) {
			continue;
		}
		if (highest === undefined) {
			highest = candidate;
		}
		if (moduleDefinitions.has(candidate)) {
			module = candidate;
		}
	}
	return module ?? highest ?? path;
}

/** A displayable reason the value violates the definition, or undefined. */
function valueProblem(definition: IndexDefinition, value: string): string | undefined {
	const trimmed = value.trim();
	if (trimmed === '') {
		return undefined;
	}
	if (definition.kind === 'ECUC-INTEGER-PARAM-DEF') {
		const parsed = ecucIntegerValue(trimmed);
		if (parsed === undefined) {
			return 'is not a valid integer';
		}
		const lower = definition.lowerLimit === undefined ? undefined : ecucIntegerValue(definition.lowerLimit);
		const upper = definition.upperLimit === undefined ? undefined : ecucIntegerValue(definition.upperLimit);
		if (lower !== undefined && parsed < lower) {
			return `is below the lower limit ${definition.lowerLimit}`;
		}
		if (upper !== undefined && parsed > upper) {
			return `is above the upper limit ${definition.upperLimit}`;
		}
		return undefined;
	}
	if (definition.kind === 'ECUC-FLOAT-PARAM-DEF') {
		if (/^[+-]?INF$/i.test(trimmed) || /^NaN$/i.test(trimmed)) {
			return undefined;
		}
		const parsed = Number(trimmed);
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
		const length = Array.from(trimmed).length;
		const lower = numberValue(definition.minLength);
		const upper = numberValue(definition.maxLength);
		if (lower !== undefined && length < lower) {
			return `is shorter than ${lower} characters`;
		}
		if (upper !== undefined && length > upper) {
			return `is longer than ${upper} characters`;
		}
		return undefined;
	}
	if (definition.kind === 'ECUC-BOOLEAN-PARAM-DEF') {
		const text = trimmed.toLowerCase();
		return text === 'true' || text === 'false' || text === '0' || text === '1' ? undefined : 'is not a boolean';
	}
	if (definition.kind === 'ECUC-ENUMERATION-PARAM-DEF') {
		if (definition.literals !== undefined && definition.literals.length > 0 && !definition.literals.includes(trimmed)) {
			return `is not one of ${definition.literals.join(', ')}`;
		}
		return undefined;
	}
	return undefined;
}

function numberValue(raw: string | undefined): number | undefined {
	if (raw === undefined) {
		return undefined;
	}
	const value = Number(raw.trim());
	return Number.isFinite(value) ? value : undefined;
}
