/**
 * ECUC rule engine. Pure over the in-memory index; no `vscode` import.
 *
 * Every rule is best-effort: an ambiguous path is a diagnostic, never a guess.
 * The host converts the returned offset ranges to editor positions.
 */
import type { Range } from '../ecuc/model';
import type { IndexDefinition, IndexElement, IndexReference } from '../index/indexModel';
import { ecucIntegerValue } from '../ecuc/numeric';
import { multiplicityValue } from '../index/definitions';
import type { ReferenceResolution, WorkspaceIndex } from '../index/workspaceIndex';
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
	const context: ValidationContext = { index, severities, out: [] };
	const { elements, references, definitions } = yield* flattenWorkspace(index);
	const elementsByParent = new Map<string, IndexElement[]>();
	const elementsByPath = new Map<string, IndexElement[]>();
	indexElements(elements, elementsByParent, elementsByPath);
	const referencesBySource = new Map<string, IndexReference[]>();
	indexReferences(references, referencesBySource);
	const crossFile = includesCrossFileRules(crossFileRules, definitions.length);

	yield* reportBrokenReferences(context, references, crossFile);
	yield* reportDuplicatePaths(context, elementsByPath, crossFile);
	yield* reportValueProblems(context, elements);
	const multiplicityGroups = new Map<string, MultiplicityGroup>();
	const multiplicityCounter = { count: 0 };
	yield* groupMultiplicityElements(multiplicityGroups, elements, multiplicityCounter);
	yield* groupMultiplicityReferences(multiplicityGroups, references, multiplicityCounter);
	yield* reportMultiplicityGroups(context, multiplicityGroups);
	yield* reportMissingDefinitions(context, elements, references);
	yield* reportMissingRequired(context, elements, definitions, elementsByParent, referencesBySource);
	return context.out;
}

/** State shared by every rule stage. */
interface ValidationContext {
	index: WorkspaceIndex;
	severities: SeveritySettings;
	out: EcucDiagnostic[];
}

/** The flattened index contributions, in file order. */
interface WorkspaceItems {
	elements: IndexElement[];
	references: IndexReference[];
	definitions: IndexDefinition[];
}

/** One rule, with the text the stage wants to report. */
interface RuleProblem {
	rule: DiagnosticRule;
	message: string;
}

/** Yields when the running count reaches another `step`. */
function* yieldOnCount(count: number, step: number): Generator<void, void> {
	if (count % step === 0) {
		yield;
	}
}

/** Appends one diagnostic unless its rule (or override) is off. */
function addDiagnostic(
	context: ValidationContext,
	rule: DiagnosticRule,
	file: string,
	range: Range,
	message: string,
	override?: DiagnosticLevel,
	related?: DiagnosticRelated[]
): void {
	const severity = override ?? context.severities[rule];
	if (severity === 'off') {
		return;
	}
	context.out.push({ rule, severity, message, file, range, ...(related === undefined ? {} : { related }) });
}

/** Appends one file's items, yielding at the shared item cadence. */
function* appendWithYield<T>(target: T[], items: readonly T[], counter: { count: number }): Generator<void, void> {
	for (const item of items) {
		target.push(item);
		counter.count++;
		yield* yieldOnCount(counter.count, YIELD_ITEMS);
	}
}

/** Flattens every indexed file's contributions into three ordered lists. */
function* flattenWorkspace(index: WorkspaceIndex): Generator<void, WorkspaceItems> {
	const elements: IndexElement[] = [];
	const references: IndexReference[] = [];
	const definitions: IndexDefinition[] = [];
	const counter = { count: 0 };
	for (const file of index.fileList()) {
		yield* appendWithYield(elements, file.elements, counter);
		yield* appendWithYield(references, file.references, counter);
		yield* appendWithYield(definitions, file.definitions, counter);
	}
	return { elements, references, definitions };
}

/** Indexes every element by AR path and by owning parent. */
function indexElements(
	elements: readonly IndexElement[],
	byParent: Map<string, IndexElement[]>,
	byPath: Map<string, IndexElement[]>
): void {
	for (const element of elements) {
		indexElement(element, byParent, byPath);
	}
}

function indexElement(
	element: IndexElement,
	byParent: Map<string, IndexElement[]>,
	byPath: Map<string, IndexElement[]>
): void {
	indexElementPath(element, byPath);
	indexContainerParent(element, byParent);
	indexParameterParent(element, byParent);
}

function indexElementPath(element: IndexElement, byPath: Map<string, IndexElement[]>): void {
	if (element.path !== undefined) {
		addTo(byPath, element.path, element);
	}
}

function indexContainerParent(element: IndexElement, byParent: Map<string, IndexElement[]>): void {
	if (element.path === undefined || element.kind !== 'container') {
		return;
	}
	const parent = parentPath(element.path);
	if (parent !== undefined) {
		addTo(byParent, parent, element);
	}
}

function indexParameterParent(element: IndexElement, byParent: Map<string, IndexElement[]>): void {
	if (element.kind !== 'parameter' || element.sourcePath === undefined) {
		return;
	}
	addTo(byParent, element.sourcePath, element);
}

/** Indexes every reference by its owning element path. */
function indexReferences(references: readonly IndexReference[], bySource: Map<string, IndexReference[]>): void {
	for (const reference of references) {
		if (reference.sourcePath !== undefined) {
			addTo(bySource, reference.sourcePath, reference);
		}
	}
}

/** Cross-file rules run when forced, or on `auto` when any definition exists. */
function includesCrossFileRules(mode: CrossFileMode, definitionCount: number): boolean {
	return mode === 'always' || (mode === 'auto' && definitionCount > 0);
}

/** True for a target DEST that is not in the judged set. */
function uncheckedTargetDest(reference: IndexReference): boolean {
	return reference.targetDest !== undefined && !CHECKED_TARGET_DESTS.has(reference.targetDest);
}

/** One resolved-reference failure. */
type FailedReferenceResolution = Extract<ReferenceResolution, { ok: false }>;

/** Broken references and DEST mismatches, only for DESTs with an indexed path. */
function* reportBrokenReferences(
	context: ValidationContext,
	references: readonly IndexReference[],
	crossFile: boolean
): Generator<void, void> {
	let count = 0;
	for (const reference of references) {
		if (!crossFile) {
			return;
		}
		count++;
		yield* yieldOnCount(count, YIELD_SCAN);
		reportBrokenReference(context, reference);
	}
}

function reportBrokenReference(context: ValidationContext, reference: IndexReference): void {
	if (uncheckedTargetDest(reference)) {
		return;
	}
	const resolution = context.index.resolveReference(reference);
	if (resolution.ok) {
		return;
	}
	const problem = referenceProblem(resolution);
	addDiagnostic(context, problem.rule, reference.file, reference.range, problem.message);
}

function referenceProblem(resolution: FailedReferenceResolution): RuleProblem {
	if (resolution.reason === 'dest-mismatch') {
		return { rule: 'destMismatch', message: destMismatchMessage(resolution) };
	}
	return { rule: 'brokenReference', message: brokenReferenceMessage(resolution) };
}

function destMismatchMessage(resolution: FailedReferenceResolution): string {
	return `Reference target "${resolution.target ?? ''}" is a ${resolution.actualKind ?? 'different element'}, not the declared DEST.`;
}

function brokenReferenceMessage(resolution: FailedReferenceResolution): string {
	return `Reference target "${resolution.target ?? ''}" is ${referenceReason(resolution.reason)} in the workspace.`;
}

function referenceReason(reason: FailedReferenceResolution['reason']): string {
	if (reason === 'ambiguous') {
		return 'ambiguous';
	}
	return reason === 'no-target' ? 'missing' : 'not found';
}

/** Duplicate SHORT-NAME / AR path: one diagnostic, with the other declarations attached. */
function* reportDuplicatePaths(
	context: ValidationContext,
	elementsByPath: ReadonlyMap<string, readonly IndexElement[]>,
	crossFile: boolean
): Generator<void, void> {
	let count = 0;
	for (const [path, group] of elementsByPath) {
		count++;
		yield* yieldOnCount(count, YIELD_SCAN);
		reportDuplicatePath(context, path, group, crossFile);
	}
}

function reportDuplicatePath(
	context: ValidationContext,
	path: string,
	group: readonly IndexElement[],
	crossFile: boolean
): void {
	const sorted = sortedElements(group);
	if (hidesDuplicate(sorted, crossFile)) {
		return;
	}
	addDuplicateDiagnostic(context, path, sorted);
}

/** True when the group is not a reportable duplicate. */
function hidesDuplicate(sorted: readonly IndexElement[], crossFile: boolean): boolean {
	if (sorted.length < 2) {
		return true;
	}
	return hidesCrossFileCopy(sorted, crossFile) || isMergedSplitCopy(sorted) || isVariantAlternative(sorted);
}

/** A cross-file group is hidden unless cross-file rules are on. */
function hidesCrossFileCopy(sorted: readonly IndexElement[], crossFile: boolean): boolean {
	return countFiles(sorted) > 1 && !crossFile;
}

/**
 * AUTOSAR split files repeat one container per file with different children;
 * the copies are one merged element, not duplicates.
 */
function isMergedSplitCopy(sorted: readonly IndexElement[]): boolean {
	const first = sorted[0];
	const sameIdentity = sorted.every(
		(element) => element.kind === first.kind && element.definitionRef === first.definitionRef
	);
	return sameIdentity && countFiles(sorted) > 1 && !hasIdenticalCopy(sorted);
}

/** True when two declarations share a normalized subtree hash. */
function hasIdenticalCopy(sorted: readonly IndexElement[]): boolean {
	const hashes = new Set(sorted.map((element) => element.contentHash));
	return hashes.size < sorted.length;
}

/** Identical copies that are mutually exclusive variants are alternatives. */
function isVariantAlternative(sorted: readonly IndexElement[]): boolean {
	const guards = new Set(sorted.map((element) => element.syscond ?? ''));
	return sorted.length > 1 && guards.size === sorted.length && !guards.has('');
}

function countFiles(sorted: readonly IndexElement[]): number {
	return new Set(sorted.map((element) => element.file)).size;
}

function sortedElements(group: readonly IndexElement[]): IndexElement[] {
	return [...group].sort((left, right) => left.file.localeCompare(right.file) || left.range.start - right.range.start);
}

function addDuplicateDiagnostic(context: ValidationContext, path: string, sorted: readonly IndexElement[]): void {
	const first = sorted[0];
	const name = first.shortName ?? path;
	const fileCount = countFiles(sorted);
	const related: DiagnosticRelated[] = sorted.slice(1).map((element) => ({
		file: element.file,
		range: element.range,
		message: 'Also declared here.',
	}));
	addDiagnostic(
		context,
		'duplicateShortName',
		first.file,
		first.range,
		`SHORT-NAME "${name}" is declared ${sorted.length} times for ${path} (${fileCount} file${fileCount === 1 ? '' : 's'}).`,
		fileCount > 1 ? 'information' : undefined,
		related
	);
}

/** Value ranges, type forms and string lengths. */
function* reportValueProblems(context: ValidationContext, elements: readonly IndexElement[]): Generator<void, void> {
	let count = 0;
	for (const element of elements) {
		count++;
		yield* yieldOnCount(count, YIELD_SCAN);
		reportValueProblem(context, element);
	}
}

/** The parts of a parameter element the value rules need. */
interface ValueInput {
	definitionRef: string;
	value: string;
}

function valueInput(element: IndexElement): ValueInput | undefined {
	if (element.kind !== 'parameter') {
		return undefined;
	}
	if (element.value === undefined || element.definitionRef === undefined) {
		return undefined;
	}
	return { definitionRef: element.definitionRef, value: element.value };
}

function reportValueProblem(context: ValidationContext, element: IndexElement): void {
	const input = valueInput(element);
	if (input === undefined) {
		return;
	}
	const definition = context.index.definitionEntry(input.definitionRef);
	if (definition === undefined) {
		return;
	}
	const problem = valueProblem(definition, input.value);
	if (problem === undefined) {
		return;
	}
	addDiagnostic(context, 'valueOutOfRange', element.file, element.range, `Value "${input.value}" ${problem}.`);
}

/** One group of same-definition, same-parent declarations. */
interface MultiplicityGroup {
	definitionRef: string;
	elements: IndexElement[];
	references: IndexReference[];
}

/** A multiplicity group key and the definition it counts against. */
interface MultiplicityEntry {
	key: string;
	definitionRef: string;
}

/** The multiplicity group an element belongs to, when it can be grouped. */
function multiplicityEntry(element: IndexElement): MultiplicityEntry | undefined {
	const definitionRef = element.definitionRef;
	if (definitionRef === undefined) {
		return undefined;
	}
	return kindedMultiplicityKey(element, definitionRef);
}

function kindedMultiplicityKey(element: IndexElement, definitionRef: string): MultiplicityEntry | undefined {
	if (element.kind === 'module') {
		return { key: `module|${element.file}|${definitionRef}`, definitionRef };
	}
	if (element.kind === 'container') {
		return containerMultiplicityKey(element, definitionRef);
	}
	if (element.kind === 'parameter') {
		return parameterMultiplicityKey(element, definitionRef);
	}
	return undefined;
}

function containerMultiplicityKey(element: IndexElement, definitionRef: string): MultiplicityEntry | undefined {
	return element.path === undefined
		? undefined
		: { key: `container|${element.file}|${parentPath(element.path) ?? ''}|${definitionRef}`, definitionRef };
}

function parameterMultiplicityKey(element: IndexElement, definitionRef: string): MultiplicityEntry | undefined {
	return element.sourcePath === undefined
		? undefined
		: { key: `parameter|${element.file}|${element.sourcePath}|${definitionRef}`, definitionRef };
}

function addMultiplicityElement(groups: Map<string, MultiplicityGroup>, element: IndexElement): void {
	const entry = multiplicityEntry(element);
	if (entry === undefined) {
		return;
	}
	const group = groups.get(entry.key) ?? { definitionRef: entry.definitionRef, elements: [], references: [] };
	group.elements.push(element);
	groups.set(entry.key, group);
}

function addMultiplicityReference(groups: Map<string, MultiplicityGroup>, reference: IndexReference): void {
	if (reference.definitionRef === undefined || reference.sourcePath === undefined) {
		return;
	}
	const key = `reference|${reference.file}|${reference.sourcePath}|${reference.definitionRef}`;
	const group = groups.get(key) ?? { definitionRef: reference.definitionRef, elements: [], references: [] };
	group.references.push(reference);
	groups.set(key, group);
}

function* groupMultiplicityElements(
	groups: Map<string, MultiplicityGroup>,
	elements: readonly IndexElement[],
	counter: { count: number }
): Generator<void, void> {
	for (const element of elements) {
		counter.count++;
		yield* yieldOnCount(counter.count, YIELD_ITEMS);
		addMultiplicityElement(groups, element);
	}
}

function* groupMultiplicityReferences(
	groups: Map<string, MultiplicityGroup>,
	references: readonly IndexReference[],
	counter: { count: number }
): Generator<void, void> {
	for (const reference of references) {
		counter.count++;
		yield* yieldOnCount(counter.count, YIELD_ITEMS);
		addMultiplicityReference(groups, reference);
	}
}

/** The counted bounds a definition declares, with its display name. */
interface MultiplicityBounds {
	definition: IndexDefinition;
	lower: number;
	upper: number | undefined;
}

function multiplicityBounds(index: WorkspaceIndex, definitionRef: string): MultiplicityBounds | undefined {
	const definition = index.definitionEntry(definitionRef);
	if (definition === undefined) {
		return undefined;
	}
	return boundsOf(definition);
}

function boundsOf(definition: IndexDefinition): MultiplicityBounds | undefined {
	const lower = multiplicityValue(definition.lowerMultiplicity);
	const upper = multiplicityUpper(definition);
	if (lower === undefined && upper === undefined) {
		return undefined;
	}
	return { definition, lower: lower ?? 0, upper };
}

/** A finite upper multiplicity, or -1 for AUTOSAR's infinite flag. */
function multiplicityUpper(definition: IndexDefinition): number | undefined {
	return definition.upperMultiplicityInfinite === true ? -1 : multiplicityValue(definition.upperMultiplicity);
}

/** Counts the declarations per syscond, with an empty key for unguarded ones. */
function tallyGuards(group: MultiplicityGroup): Map<string, number> {
	const perGuard = new Map<string, number>();
	for (const item of [...group.elements, ...group.references]) {
		const guard = item.syscond ?? '';
		perGuard.set(guard, (perGuard.get(guard) ?? 0) + 1);
	}
	return perGuard;
}

/** The largest guarded bucket, or 0 when every declaration is unguarded. */
function guardedMaximum(perGuard: ReadonlyMap<string, number>): number {
	return Math.max(0, ...[...perGuard].filter(([guard]) => guard !== '').map(([, value]) => value));
}

/**
 * The worst-case count: an unguarded occurrence is present under every
 * condition, so it adds to each guarded bucket.
 */
function worstCount(perGuard: ReadonlyMap<string, number>): number {
	const unguarded = perGuard.get('') ?? 0;
	return unguarded + guardedMaximum(perGuard);
}

function exceedsUpperMultiplicity(upper: number | undefined, perGuard: ReadonlyMap<string, number>): boolean {
	const worst = worstCount(perGuard);
	return upper !== undefined && upper >= 0 && worst > upper;
}

function violatesMultiplicity(count: number, bounds: MultiplicityBounds, perGuard: ReadonlyMap<string, number>): boolean {
	return count < bounds.lower || exceedsUpperMultiplicity(bounds.upper, perGuard);
}

function hasConditionVariants(perGuard: ReadonlyMap<string, number>): boolean {
	return perGuard.size > (perGuard.has('') ? 1 : 0);
}

function expectedMultiplicity(bounds: MultiplicityBounds): string {
	if (bounds.upper === undefined) {
		return `${bounds.lower}..`;
	}
	if (bounds.upper < 0) {
		return `${bounds.lower}..*`;
	}
	return bounds.lower === bounds.upper ? `${bounds.lower}` : `${bounds.lower}..${bounds.upper}`;
}

function multiplicityMessage(
	bounds: MultiplicityBounds,
	perGuard: ReadonlyMap<string, number>,
	count: number
): string {
	const exceedsUpper = exceedsUpperMultiplicity(bounds.upper, perGuard);
	const offender = exceedsUpper ? Math.max(worstCount(perGuard), ...perGuard.values()) : count;
	const condition = exceedsUpper && hasConditionVariants(perGuard) ? ' under one condition' : '';
	return `"${bounds.definition.shortName}" occurs ${offender} times${condition} in this file; the definition allows ${expectedMultiplicity(bounds)}.`;
}

function reportMultiplicityGroup(context: ValidationContext, group: MultiplicityGroup): void {
	const bounds = multiplicityBounds(context.index, group.definitionRef);
	if (bounds === undefined) {
		return;
	}
	const perGuard = tallyGuards(group);
	const count = group.elements.length + group.references.length;
	if (!violatesMultiplicity(count, bounds, perGuard)) {
		return;
	}
	const first = group.elements[0] ?? group.references[0];
	addDiagnostic(context, 'multiplicity', first.file, first.range, multiplicityMessage(bounds, perGuard, count));
}

function* reportMultiplicityGroups(
	context: ValidationContext,
	groups: ReadonlyMap<string, MultiplicityGroup>
): Generator<void, void> {
	let count = 0;
	for (const group of groups.values()) {
		count++;
		yield* yieldOnCount(count, YIELD_GROUPS);
		reportMultiplicityGroup(context, group);
	}
}

/** One referenced path that resolved to no definition candidate. */
interface MissingOccurrence {
	path: string;
	file: string;
	range: Range;
}

/** One grouped missing-definition diagnostic. */
interface MissingGroup {
	file: string;
	range: Range;
	count: number;
}

/** The path when the definition has no candidates, otherwise undefined. */
function missingDefinitionPath(index: WorkspaceIndex, definitionRef: string | undefined): string | undefined {
	if (definitionRef === undefined) {
		return undefined;
	}
	return index.definitionCandidateCount(definitionRef) === 0 ? definitionRef : undefined;
}

function addMissingOccurrence(
	index: WorkspaceIndex,
	definitionRef: string | undefined,
	file: string,
	range: Range,
	missingPaths: Set<string>,
	occurrences: MissingOccurrence[]
): void {
	const path = missingDefinitionPath(index, definitionRef);
	if (path === undefined) {
		return;
	}
	missingPaths.add(path);
	occurrences.push({ path, file, range });
}

function* collectMissingElements(
	context: ValidationContext,
	elements: readonly IndexElement[],
	missingPaths: Set<string>,
	occurrences: MissingOccurrence[],
	counter: { count: number }
): Generator<void, void> {
	for (const element of elements) {
		counter.count++;
		yield* yieldOnCount(counter.count, YIELD_ITEMS);
		addMissingOccurrence(context.index, element.definitionRef, element.file, element.range, missingPaths, occurrences);
	}
}

function* collectMissingReferences(
	context: ValidationContext,
	references: readonly IndexReference[],
	missingPaths: Set<string>,
	occurrences: MissingOccurrence[],
	counter: { count: number }
): Generator<void, void> {
	for (const reference of references) {
		counter.count++;
		yield* yieldOnCount(counter.count, YIELD_ITEMS);
		addMissingOccurrence(
			context.index,
			reference.definitionRef,
			reference.file,
			reference.range,
			missingPaths,
			occurrences
		);
	}
}

/** The module element definition paths, used to anchor a missing root. */
function moduleDefinitionPaths(elements: readonly IndexElement[]): Set<string> {
	const paths = new Set<string>();
	for (const element of elements) {
		if (element.kind === 'module' && element.definitionRef !== undefined) {
			paths.add(element.definitionRef);
		}
	}
	return paths;
}

/** Every missing ancestor of `path`, from the highest depth down. */
function missingAncestors(path: string, missing: ReadonlySet<string>): string[] {
	const segments = path.split('/').filter((segment) => segment.length > 0);
	const ancestors: string[] = [];
	for (let at = 1; at <= segments.length; at++) {
		const candidate = '/' + segments.slice(0, at).join('/');
		if (missing.has(candidate)) {
			ancestors.push(candidate);
		}
	}
	return ancestors;
}

/** The last missing ancestor that is also a module definition. */
function lastModuleAncestor(ancestors: readonly string[], moduleDefinitions: ReadonlySet<string>): string | undefined {
	let module: string | undefined;
	for (const candidate of ancestors) {
		if (moduleDefinitions.has(candidate)) {
			module = candidate;
		}
	}
	return module;
}

function selectMissingRoot(
	path: string,
	ancestors: readonly string[],
	moduleDefinitions: ReadonlySet<string>
): string {
	const module = lastModuleAncestor(ancestors, moduleDefinitions);
	if (module !== undefined) {
		return module;
	}
	return ancestors.length > 0 ? ancestors[0] : path;
}

function addMissingGroup(
	groups: Map<string, MissingGroup>,
	occurrence: MissingOccurrence,
	missingPaths: ReadonlySet<string>,
	moduleDefinitions: ReadonlySet<string>
): void {
	const root = missingRoot(occurrence.path, missingPaths, moduleDefinitions);
	const group = groups.get(root);
	if (group === undefined) {
		groups.set(root, { file: occurrence.file, range: occurrence.range, count: 1 });
		return;
	}
	group.count++;
}

function* groupMissingOccurrences(
	groups: Map<string, MissingGroup>,
	occurrences: readonly MissingOccurrence[],
	missingPaths: ReadonlySet<string>,
	moduleDefinitions: ReadonlySet<string>
): Generator<void, void> {
	let count = 0;
	for (const occurrence of occurrences) {
		count++;
		yield* yieldOnCount(count, YIELD_SCAN);
		addMissingGroup(groups, occurrence, missingPaths, moduleDefinitions);
	}
}

function addMissingDefinitionDiagnostics(context: ValidationContext, groups: ReadonlyMap<string, MissingGroup>): void {
	for (const [root, group] of groups) {
		addDiagnostic(
			context,
			'missingDefinition',
			group.file,
			group.range,
			`Definition "${root}" is not in the workspace index (${group.count} instance${group.count === 1 ? '' : 's'}).`
		);
	}
}

/** Missing definitions: one diagnostic at the highest missing ancestor. */
function* reportMissingDefinitions(
	context: ValidationContext,
	elements: readonly IndexElement[],
	references: readonly IndexReference[]
): Generator<void, void> {
	const missingPaths = new Set<string>();
	const occurrences: MissingOccurrence[] = [];
	const counter = { count: 0 };
	yield* collectMissingElements(context, elements, missingPaths, occurrences, counter);
	yield* collectMissingReferences(context, references, missingPaths, occurrences, counter);
	if (missingPaths.size === 0) {
		return;
	}
	const moduleDefinitions = moduleDefinitionPaths(elements);
	const groups = new Map<string, MissingGroup>();
	yield* groupMissingOccurrences(groups, occurrences, missingPaths, moduleDefinitions);
	addMissingDefinitionDiagnostics(context, groups);
}

/** The owning definition and AR path a required-child check needs. */
interface RequiredTarget {
	definition: IndexDefinition;
	path: string;
}

/** The parent, child instances and source references for one required check. */
interface RequiredScope {
	pathOf: (definitionRef: string | undefined) => string | undefined;
	children: readonly IndexDefinition[];
	instances: readonly IndexElement[];
	references: readonly IndexReference[];
}

function isModuleOrContainer(element: IndexElement): boolean {
	return element.kind === 'module' || element.kind === 'container';
}

function requiredTarget(element: IndexElement, index: WorkspaceIndex): RequiredTarget | undefined {
	const path = element.path;
	const definitionRef = element.definitionRef;
	if (path === undefined || definitionRef === undefined) {
		return undefined;
	}
	const definition = index.definitionEntry(definitionRef);
	return definition === undefined ? undefined : { definition, path };
}

function requiredInput(element: IndexElement, index: WorkspaceIndex): RequiredTarget | undefined {
	if (!isModuleOrContainer(element)) {
		return undefined;
	}
	return requiredTarget(element, index);
}

/** Required child definitions, grouped by their parent definition path. */
function childrenDefinitions(definitions: readonly IndexDefinition[]): Map<string, IndexDefinition[]> {
	const children = new Map<string, IndexDefinition[]>();
	for (const definition of definitions) {
		const parent = parentPath(definition.path);
		if (parent !== undefined) {
			addTo(children, parent, definition);
		}
	}
	return children;
}

/** A memoized `definitionRef` → canonical definition path resolver. */
function canonicalPathOf(index: WorkspaceIndex): (definitionRef: string | undefined) => string | undefined {
	const canonical = new Map<string, string | undefined>();
	return (definitionRef) => canonicalDefinitionPath(canonical, index, definitionRef);
}

function canonicalDefinitionPath(
	canonical: Map<string, string | undefined>,
	index: WorkspaceIndex,
	definitionRef: string | undefined
): string | undefined {
	if (definitionRef === undefined) {
		return undefined;
	}
	if (!canonical.has(definitionRef)) {
		canonical.set(definitionRef, index.definitionEntry(definitionRef)?.path);
	}
	return canonical.get(definitionRef);
}

function requiredScope(
	target: RequiredTarget,
	childrenByDefinition: ReadonlyMap<string, readonly IndexDefinition[]>,
	elementsByParent: ReadonlyMap<string, readonly IndexElement[]>,
	referencesBySource: ReadonlyMap<string, readonly IndexReference[]>,
	index: WorkspaceIndex
): RequiredScope {
	return {
		pathOf: canonicalPathOf(index),
		children: childrenByDefinition.get(target.definition.path) ?? [],
		instances: elementsByParent.get(target.path) ?? [],
		references: referencesBySource.get(target.path) ?? [],
	};
}

function requiredLower(child: IndexDefinition): number {
	return multiplicityValue(child.lowerMultiplicity) ?? 0;
}

function isRequiredChild(child: IndexDefinition, lower: number): boolean {
	return (
		lower > 0 &&
		child.kind !== 'ECUC-ADD-INFO-PARAM-DEF' &&
		child.defaultValue === undefined &&
		child.withAuto !== true
	);
}

function isReferenceDefinition(child: IndexDefinition): boolean {
	return child.kind.endsWith('-REFERENCE-DEF');
}

function isContainerDefinition(child: IndexDefinition): boolean {
	return child.kind.endsWith('-CONTAINER-DEF');
}

function referencePresent(child: IndexDefinition, scope: RequiredScope): boolean {
	return scope.references.some((reference) => scope.pathOf(reference.definitionRef) === child.path);
}

function instancePresent(child: IndexDefinition, scope: RequiredScope): boolean {
	const container = isContainerDefinition(child);
	return scope.instances.some(
		(instance) =>
			(container ? instance.kind === 'container' : instance.kind === 'parameter') &&
			scope.pathOf(instance.definitionRef) === child.path
	);
}

function requiredChildPresent(child: IndexDefinition, scope: RequiredScope): boolean {
	return isReferenceDefinition(child) ? referencePresent(child, scope) : instancePresent(child, scope);
}

function requiredKind(child: IndexDefinition): string {
	if (isReferenceDefinition(child)) {
		return 'reference';
	}
	return isContainerDefinition(child) ? 'container' : 'parameter';
}

function reportRequiredChild(
	context: ValidationContext,
	element: IndexElement,
	child: IndexDefinition,
	scope: RequiredScope
): void {
	const lower = requiredLower(child);
	if (!isRequiredChild(child, lower)) {
		return;
	}
	if (requiredChildPresent(child, scope)) {
		return;
	}
	addDiagnostic(
		context,
		'missingRequired',
		element.file,
		element.range,
		`Missing required ${requiredKind(child)} "${child.shortName}" (lower multiplicity ${lower}).`
	);
}

function reportRequiredChildren(context: ValidationContext, element: IndexElement, scope: RequiredScope): void {
	for (const child of scope.children) {
		reportRequiredChild(context, element, child, scope);
	}
}

function reportRequiredForElement(
	context: ValidationContext,
	element: IndexElement,
	childrenByDefinition: ReadonlyMap<string, readonly IndexDefinition[]>,
	elementsByParent: ReadonlyMap<string, readonly IndexElement[]>,
	referencesBySource: ReadonlyMap<string, readonly IndexReference[]>
): void {
	const target = requiredInput(element, context.index);
	if (target === undefined) {
		return;
	}
	const scope = requiredScope(target, childrenByDefinition, elementsByParent, referencesBySource, context.index);
	reportRequiredChildren(context, element, scope);
}

/** Required child containers, parameters and references. */
function* reportMissingRequired(
	context: ValidationContext,
	elements: readonly IndexElement[],
	definitions: readonly IndexDefinition[],
	elementsByParent: ReadonlyMap<string, readonly IndexElement[]>,
	referencesBySource: ReadonlyMap<string, readonly IndexReference[]>
): Generator<void, void> {
	const childrenByDefinition = childrenDefinitions(definitions);
	let count = 0;
	for (const element of elements) {
		count++;
		yield* yieldOnCount(count, YIELD_GROUPS);
		reportRequiredForElement(context, element, childrenByDefinition, elementsByParent, referencesBySource);
	}
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
	return selectMissingRoot(path, missingAncestors(path, missing), moduleDefinitions);
}

/** One per-kind value check; each returns a displayable reason or undefined. */
type ValueProblemCheck = (definition: IndexDefinition, trimmed: string) => string | undefined;

const VALUE_PROBLEM_CHECKS = new Map<string, ValueProblemCheck>([
	['ECUC-INTEGER-PARAM-DEF', integerProblem],
	['ECUC-FLOAT-PARAM-DEF', floatProblem],
	['ECUC-STRING-PARAM-DEF', stringProblem],
	['ECUC-BOOLEAN-PARAM-DEF', booleanProblem],
	['ECUC-ENUMERATION-PARAM-DEF', enumerationProblem],
]);

/** A displayable reason the value violates the definition, or undefined. */
function valueProblem(definition: IndexDefinition, value: string): string | undefined {
	const trimmed = value.trim();
	if (trimmed === '') {
		return undefined;
	}
	const check = VALUE_PROBLEM_CHECKS.get(definition.kind);
	return check === undefined ? undefined : check(definition, trimmed);
}

function isSpecialFloat(trimmed: string): boolean {
	return /^[+-]?INF$/i.test(trimmed) || /^NaN$/i.test(trimmed);
}

function isBelow(value: number, limit: number | undefined): boolean {
	return limit !== undefined && value < limit;
}

function isAbove(value: number, limit: number | undefined): boolean {
	return limit !== undefined && value > limit;
}

function isBelowInteger(value: bigint, limit: bigint | undefined): boolean {
	return limit !== undefined && value < limit;
}

function isAboveInteger(value: bigint, limit: bigint | undefined): boolean {
	return limit !== undefined && value > limit;
}

function integerLimit(raw: string | undefined): bigint | undefined {
	return raw === undefined ? undefined : ecucIntegerValue(raw);
}

function integerProblem(definition: IndexDefinition, trimmed: string): string | undefined {
	const parsed = ecucIntegerValue(trimmed);
	if (parsed === undefined) {
		return 'is not a valid integer';
	}
	if (isBelowInteger(parsed, integerLimit(definition.lowerLimit))) {
		return `is below the lower limit ${definition.lowerLimit}`;
	}
	if (isAboveInteger(parsed, integerLimit(definition.upperLimit))) {
		return `is above the upper limit ${definition.upperLimit}`;
	}
	return undefined;
}

function floatLimit(raw: string | undefined): number | undefined {
	if (raw === undefined) {
		return undefined;
	}
	const value = Number(raw);
	return Number.isFinite(value) ? value : undefined;
}

function floatRangeProblem(definition: IndexDefinition, parsed: number): string | undefined {
	if (isBelow(parsed, floatLimit(definition.minValue))) {
		return `is below the minimum ${definition.minValue}`;
	}
	if (isAbove(parsed, floatLimit(definition.maxValue))) {
		return `is above the maximum ${definition.maxValue}`;
	}
	return undefined;
}

function floatProblem(definition: IndexDefinition, trimmed: string): string | undefined {
	if (isSpecialFloat(trimmed)) {
		return undefined;
	}
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed)) {
		return 'is not a valid float';
	}
	return floatRangeProblem(definition, parsed);
}

function stringProblem(definition: IndexDefinition, trimmed: string): string | undefined {
	const length = Array.from(trimmed).length;
	const lower = numberValue(definition.minLength);
	const upper = numberValue(definition.maxLength);
	if (isBelow(length, lower)) {
		return `is shorter than ${lower} characters`;
	}
	if (isAbove(length, upper)) {
		return `is longer than ${upper} characters`;
	}
	return undefined;
}

function isBooleanText(text: string): boolean {
	return text === 'true' || text === 'false' || text === '0' || text === '1';
}

function booleanProblem(_definition: IndexDefinition, trimmed: string): string | undefined {
	return isBooleanText(trimmed.toLowerCase()) ? undefined : 'is not a boolean';
}

function enumerationProblem(definition: IndexDefinition, trimmed: string): string | undefined {
	const literals = definition.literals;
	if (literals === undefined || literals.length === 0) {
		return undefined;
	}
	return literals.includes(trimmed) ? undefined : `is not one of ${literals.join(', ')}`;
}

function numberValue(raw: string | undefined): number | undefined {
	if (raw === undefined) {
		return undefined;
	}
	const value = Number(raw.trim());
	return Number.isFinite(value) ? value : undefined;
}
