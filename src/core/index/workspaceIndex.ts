/**
 * In-memory workspace index.
 *
 * One `FileIndex` per URI. An update replaces exactly one file's contribution;
 * the lookup maps are rebuilt lazily after a change, so a save never rescans the
 * other files. Lookups are exact-first and then unique-suffix; two matches are
 * ambiguous and resolve to nothing, matching the single-file resolver's
 * "refuse rather than guess" rule.
 *
 * The reverse-reference map is incremental: a file whose target-bearing element
 * sequence is unchanged replaces only its own contribution. A structural change
 * invalidates the map and the next query rebuilds it.
 *
 * No `vscode` import: the host supplies file URIs as strings.
 */
import type { FileIndex, IndexDefinition, IndexElement, IndexReference, IndexStats } from './indexModel';

export interface IndexSubscription {
	dispose(): void;
}

/** One element lookup, with the refusal reason and copy list kept for the caller. */
export type ElementResolution =
	| { ok: true; element: IndexElement; copies: readonly IndexElement[] }
	| { ok: false; reason: 'absent' | 'ambiguous'; path: string }
	| { ok: false; reason: 'dest-mismatch'; path: string; element: IndexElement; actualKind: IndexElement['kind'] };

/** One reference lookup, with the source reference kept for diagnostics. */
export type ReferenceResolution =
	| { ok: true; element: IndexElement; copies: readonly IndexElement[]; reference: IndexReference }
	| {
			ok: false;
			reason: 'no-target' | 'absent' | 'ambiguous' | 'dest-mismatch';
			reference: IndexReference;
			target?: string;
			actualKind?: IndexElement['kind'];
	  };

export class WorkspaceIndex {
	private readonly files = new Map<string, FileIndex>();
	private readonly listeners = new Set<() => void>();
	private elements?: PathLookup<IndexElement>;
	private definitions?: PathLookup<IndexDefinition>;
	private lookupsValid = false;
	private lookupsHealthy = true;
	/** Bumped on every mutation so a cached reverse map can never outlive a change. */
	private generation = 0;
	private referencesByTarget?: Map<string, IndexReference[]>;
	/** Stable identity for every current path-bearing element; built with the reverse map. */
	private elementKeys?: WeakMap<IndexElement, string>;
	private referencesAt = -1;
	private referenceMapBuilds = 0;

	/** Replaces one file's contribution and notifies subscribers. */
	upsert(file: FileIndex): void {
		const previous = this.files.get(file.uri);
		const incremental = this.canUpdateIncrementally(previous, file);
		this.dropReplacedContribution(previous, incremental);
		this.files.set(file.uri, file);
		this.applyLookupDelta(previous, file);
		this.installNextContribution(file, incremental);
		this.bumpGeneration(incremental);
		this.notify();
	}

	/** Removes one file's contribution. Returns false when it was not indexed. */
	remove(uri: string): boolean {
		const previous = this.files.get(uri);
		if (previous === undefined) {
			return false;
		}
		const incremental = this.canRemoveIncrementally(previous);
		this.dropReplacedContribution(previous, incremental);
		this.files.delete(uri);
		this.applyLookupDelta(previous, undefined);
		if (!incremental) {
			this.invalidateReferenceMap();
		}
		this.bumpGeneration(incremental);
		this.notify();
		return true;
	}

	/**
	 * Drops the old references and keys before an incremental replacement, using
	 * the lookup state that produced them.
	 */
	private dropReplacedContribution(previous: FileIndex | undefined, incremental: boolean): void {
		if (!incremental || previous === undefined) {
			return;
		}
		this.removeReferenceContribution(previous);
		this.removeElementKeys(previous);
	}

	/** Adds the new references on the fast path, or invalidates the map otherwise. */
	private installNextContribution(file: FileIndex, incremental: boolean): void {
		if (incremental) {
			this.addReferenceContribution(file);
			return;
		}
		this.invalidateReferenceMap();
	}

	/** Advances the mutation counter and keeps a live reverse map current. */
	private bumpGeneration(incremental: boolean): void {
		this.generation++;
		if (incremental && this.referencesByTarget !== undefined) {
			this.referencesAt = this.generation;
		}
	}

	/** Replaces the whole index in one notification (a full rebuild). */
	replaceAll(files: readonly FileIndex[]): void {
		this.files.clear();
		for (const file of files) {
			this.files.set(file.uri, file);
		}
		this.invalidateLookups();
		this.generation++;
		this.notify();
	}

	clear(): void {
		if (this.files.size === 0) {
			return;
		}
		this.files.clear();
		this.invalidateLookups();
		this.generation++;
		this.notify();
	}

	get size(): number {
		return this.files.size;
	}

	/** Monotonic mutation counter, for caches that live outside the index. */
	get revision(): number {
		return this.generation;
	}

	file(uri: string): FileIndex | undefined {
		return this.files.get(uri);
	}

	/** The indexed files, for the validation and text-feature layers. */
	fileList(): readonly FileIndex[] {
		return [...this.files.values()];
	}

	stats(): IndexStats {
		let elements = 0;
		let references = 0;
		let definitions = 0;
		const packages = new Set<string>();
		for (const file of this.files.values()) {
			elements += file.elements.length;
			references += file.references.length;
			definitions += file.definitions.length;
			for (const path of file.packages) {
				packages.add(path);
			}
		}
		return { files: this.files.size, elements, references, definitions, packages: packages.size };
	}

	/** Resolves an element by AR path, with the suffix rule. */
	element(rawPath: string): IndexElement | undefined {
		this.ensureLookups();
		return resolve(this.elements!, rawPath);
	}

	/** Resolves a target path and checks the optional `DEST` kind. */
	resolveTarget(rawPath: string, dest?: string, sourceFile?: string): ElementResolution {
		this.ensureLookups();
		const resolved = resolveDetailed(this.elements!, rawPath);
		if (resolved.status !== 'found') {
			return { ok: false, reason: resolved.status, path: rawPath };
		}
		return narrowTarget(resolved.candidates, rawPath, dest, sourceFile);
	}

	/** Resolves one indexed reference through the workspace index. */
	resolveReference(reference: IndexReference): ReferenceResolution {
		const raw = reference.targetRawPath ?? '';
		if (raw === '') {
			return { ok: false, reason: 'no-target', reference };
		}
		const resolution = this.resolveTarget(raw, reference.targetDest, reference.file);
		if (resolution.ok) {
			return { ok: true, element: resolution.element, copies: resolution.copies, reference };
		}
		return failedReference(resolution, reference, raw);
	}

	/** Every reference that resolves to the same element, in file/start order. */
	referencesFor(target: IndexElement): IndexReference[] {
		this.ensureReferenceMap();
		const key = this.targetKey(target);
		if (key === undefined) {
			return [];
		}
		return [...(this.referencesByTarget?.get(key) ?? [])].sort(compareReferences);
	}

	/** @internal Full reverse-map builds, for tests and the benchmark. */
	get referenceMapBuildCount(): number {
		return this.referenceMapBuilds;
	}

	/** Every element/reference whose own `DEFINITION-REF` resolves to this definition. */
	definitionUsers(definitionPath: string): Array<IndexElement | IndexReference> {
		const target = this.definitionEntry(definitionPath);
		if (target === undefined) {
			return [];
		}
		const out: Array<IndexElement | IndexReference> = [];
		const pathOf = this.canonicalPaths();
		for (const file of this.files.values()) {
			collectDefinitionUsers(out, file, target.path, pathOf);
		}
		return out;
	}

	/** A memoized `definitionRef` → canonical definition path resolver. */
	private canonicalPaths(): (reference: string) => string | undefined {
		const canonical = new Map<string, string | undefined>();
		return (reference: string): string | undefined => {
			if (!canonical.has(reference)) {
				canonical.set(reference, this.definitionEntry(reference)?.path);
			}
			return canonical.get(reference);
		};
	}

	/** How many definition bodies share this path (0, 1 or N); navigation never picks one. */
	definitionCandidateCount(rawPath: string): number {
		this.ensureLookups();
		const resolved = resolveDetailed(this.definitions!, rawPath);
		return resolved.status === 'found' ? resolved.candidates.length : 0;
	}

	/** The raw definition record for a `DEFINITION-REF`, or nothing when absent/ambiguous. */
	definitionEntry(rawPath: string): IndexDefinition | undefined {
		this.ensureLookups();
		return resolve(this.definitions!, rawPath);
	}

	/** The files that contribute to each `AR-PACKAGE` path (split-package view). */
	packageSources(): Map<string, string[]> {
		const sources = new Map<string, string[]>();
		for (const file of this.files.values()) {
			for (const path of file.packages) {
				const list = sources.get(path);
				if (list === undefined) {
					sources.set(path, [file.uri]);
				} else {
					list.push(file.uri);
				}
			}
		}
		return sources;
	}

	/** Subscribes to every index mutation. */
	onDidChange(listener: () => void): IndexSubscription {
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}

	/** True when only this file's own contribution may be replaced. */
	private canUpdateIncrementally(previous: FileIndex | undefined, next: FileIndex): boolean {
		if (!this.referenceMapCurrent()) {
			return false;
		}
		if (previous === undefined) {
			// A new file without targets cannot change any existing resolution.
			return targetShape(next) === '';
		}
		// Duplicates of one identity resolve through their range order, while the
		// stable key uses declaration order. Only canonical order on both sides keeps
		// those the same element after a shape-preserving update.
		return keepsCanonicalOrder(previous, next);
	}

	/** True when removing the file cannot change another file's resolution. */
	private canRemoveIncrementally(previous: FileIndex): boolean {
		return this.referenceMapCurrent() && targetShape(previous) === '';
	}

	/** The reverse map is current only while it matches the live lookups and generation. */
	private referenceMapCurrent(): boolean {
		return this.referenceMapsLive() && this.lookupsLive() && this.referencesAt === this.generation;
	}

	private referenceMapsLive(): boolean {
		return this.referencesByTarget !== undefined && this.elementKeys !== undefined;
	}

	private lookupsLive(): boolean {
		return (
			this.lookupsValid &&
			this.lookupsHealthy &&
			this.elements !== undefined &&
			this.definitions !== undefined
		);
	}

	/**
	 * Resolves one file's references through the live lookup and stable keys.
	 * A reference that no longer resolves is skipped, never guessed.
	 */
	private forEachResolvedReference(
		file: FileIndex,
		keys: WeakMap<IndexElement, string>,
		each: (key: string, reference: IndexReference) => void
	): void {
		for (const reference of file.references) {
			const resolution = this.resolveReference(reference);
			if (!resolution.ok) {
				continue;
			}
			const key = keys.get(resolution.element);
			if (key === undefined) {
				continue;
			}
			each(key, reference);
		}
	}

	/** Removes one file's references using the lookup state that produced them. */
	private removeReferenceContribution(file: FileIndex): void {
		const map = this.referencesByTarget;
		const keys = this.elementKeys;
		if (map === undefined || keys === undefined) {
			return;
		}
		this.forEachResolvedReference(file, keys, (key, reference) => removeEntry(map, key, reference));
	}

	/** Adds one file's references against the current lookup. */
	private addReferenceContribution(file: FileIndex): void {
		const map = this.referencesByTarget;
		const keys = this.elementKeys;
		if (map === undefined || keys === undefined) {
			return;
		}
		addElementKeys(keys, file);
		this.forEachResolvedReference(file, keys, (key, reference) => addEntry(map, key, reference));
	}

	/** Drops the replaced element identities; old objects are not targets any more. */
	private removeElementKeys(file: FileIndex): void {
		const keys = this.elementKeys;
		if (keys === undefined) {
			return;
		}
		for (const element of file.elements) {
			keys.delete(element);
		}
	}

	private invalidateReferenceMap(): void {
		this.referencesByTarget = undefined;
		this.elementKeys = undefined;
		this.referencesAt = -1;
	}

	/** Applies one file delta to the live maps, or resets them after a failed build. */
	private applyLookupDelta(previous: FileIndex | undefined, next: FileIndex | undefined): void {
		if (!this.lookupsHealthy) {
			this.invalidateLookups();
			return;
		}
		if (!this.lookupsReady()) {
			return;
		}
		this.removeContribution(previous);
		this.addContribution(next);
	}

	private lookupsReady(): boolean {
		return this.lookupsValid && this.elements !== undefined && this.definitions !== undefined;
	}

	/** Removes one file's items from the live maps, when both maps and the file exist. */
	private removeContribution(file: FileIndex | undefined): void {
		const elements = this.elements;
		const definitions = this.definitions;
		if (file === undefined || elements === undefined || definitions === undefined) {
			return;
		}
		removeLookupItems(elements, file.elements, (element) => element.path);
		removeLookupItems(definitions, file.definitions, (definition) => definition.path);
	}

	/** Adds one file's items to the live maps, when both maps and the file exist. */
	private addContribution(file: FileIndex | undefined): void {
		const elements = this.elements;
		const definitions = this.definitions;
		if (file === undefined || elements === undefined || definitions === undefined) {
			return;
		}
		addLookupItems(elements, file.elements, (element) => element.path);
		addLookupItems(definitions, file.definitions, (definition) => definition.path);
	}

	private invalidateLookups(): void {
		this.elements = undefined;
		this.definitions = undefined;
		this.lookupsValid = false;
		this.lookupsHealthy = true;
		this.invalidateReferenceMap();
	}

	private ensureLookups(): void {
		if (this.lookupsValid && this.elements !== undefined && this.definitions !== undefined) {
			return;
		}
		this.buildLookups();
	}

	/** Builds both candidate maps, degrading to empty ones after a failure. */
	private buildLookups(): void {
		try {
			this.installLookups();
		} catch {
			// A lookup failure must not make every later call rethrow. Definitions are
			// optional data; degrading to "no lookup" keeps the editor usable.
			this.elements = emptyLookup();
			this.definitions = emptyLookup();
			this.lookupsHealthy = false;
		}
		this.lookupsValid = true;
	}

	private installLookups(): void {
		const elements: IndexElement[] = [];
		const definitions: IndexDefinition[] = [];
		for (const file of this.files.values()) {
			appendAll(elements, file.elements);
			appendAll(definitions, file.definitions);
		}
		this.elements = buildLookup(elements, (element) => element.path);
		this.definitions = buildLookup(definitions, (definition) => definition.path);
	}

	private ensureReferenceMap(): void {
		if (this.referenceMapFresh()) {
			return;
		}
		this.buildReferenceMap();
	}

	private referenceMapFresh(): boolean {
		return this.referencesAt === this.generation && this.referencesByTarget !== undefined;
	}

	private buildReferenceMap(): void {
		const map = new Map<string, IndexReference[]>();
		const keys = new WeakMap<IndexElement, string>();
		// Every target identity must exist before any reference is resolved: a
		// reference can point at an element in a file not visited yet.
		for (const file of this.files.values()) {
			addElementKeys(keys, file);
		}
		for (const file of this.files.values()) {
			this.forEachResolvedReference(file, keys, (key, reference) => addEntry(map, key, reference));
		}
		this.referencesByTarget = map;
		this.elementKeys = keys;
		this.referencesAt = this.generation;
		this.referenceMapBuilds++;
	}

	/**
	 * The stable key for a target. Elements the index does not own (the host asks
	 * with a freshly built element) are matched to the indexed element at the same
	 * range, which is how the text editor's Find References keeps working.
	 */
	private targetKey(target: IndexElement): string | undefined {
		const cached = this.elementKeys?.get(target);
		if (cached !== undefined) {
			return cached;
		}
		if (!isKeyableTarget(target)) {
			return undefined;
		}
		const file = this.files.get(target.file);
		if (file === undefined) {
			return undefined;
		}
		return keyForRangeMatch(file, target);
	}
}

interface PathLookup<T> {
	exact: Map<string, T[]>;
	suffix: Map<string, T[]>;
}

function emptyLookup<T>(): PathLookup<T> {
	return { exact: new Map(), suffix: new Map() };
}

/** Appends every item by index: a spread here can exceed the engine's argument limit. */
function appendAll<T>(target: T[], items: readonly T[]): void {
	for (const item of items) {
		target.push(item);
	}
}

/**
 * Builds the two candidate maps. Exact keys keep the full path; suffix keys keep
 * every suffix. A unique path has a one-element array; only repeated paths grow.
 */
function buildLookup<T>(items: readonly T[], pathOf: (item: T) => string | undefined): PathLookup<T> {
	const lookup = emptyLookup<T>();
	addLookupItems(lookup, items, pathOf);
	return lookup;
}

/** Applies one file's items to both candidate maps, exact first then every suffix. */
function updateLookupItems<T>(
	lookup: PathLookup<T>,
	items: readonly T[],
	pathOf: (item: T) => string | undefined,
	update: (map: Map<string, T[]>, key: string, item: T) => void
): void {
	for (const item of items) {
		const path = pathOf(item);
		if (path !== undefined) {
			updateItemPaths(lookup, path, item, update);
		}
	}
}

/** Applies one item's exact and suffix keys to the lookup maps. */
function updateItemPaths<T>(
	lookup: PathLookup<T>,
	path: string,
	item: T,
	update: (map: Map<string, T[]>, key: string, item: T) => void
): void {
	const segments = splitPath(path);
	if (segments.length === 0) {
		return;
	}
	update(lookup.exact, '/' + segments.join('/'), item);
	for (let start = 0; start < segments.length; start++) {
		update(lookup.suffix, '/' + segments.slice(start).join('/'), item);
	}
}

/** Adds one file's items to the live maps. */
function addLookupItems<T>(
	lookup: PathLookup<T>,
	items: readonly T[],
	pathOf: (item: T) => string | undefined
): void {
	updateLookupItems(lookup, items, pathOf, addEntry);
}

/** Removes one file's items from the live maps. */
function removeLookupItems<T>(
	lookup: PathLookup<T>,
	items: readonly T[],
	pathOf: (item: T) => string | undefined
): void {
	updateLookupItems(lookup, items, pathOf, removeEntry);
}

function addEntry<T>(map: Map<string, T[]>, key: string, item: T): void {
	const list = map.get(key);
	if (list === undefined) {
		map.set(key, [item]);
	} else {
		list.push(item);
	}
}

function removeEntry<T>(map: Map<string, T[]>, key: string, item: T): void {
	const list = map.get(key);
	if (list === undefined) {
		return;
	}
	const at = list.indexOf(item);
	if (at >= 0) {
		list.splice(at, 1);
	}
	if (list.length === 0) {
		map.delete(key);
	}
}

/**
 * The stable identity of one path-bearing element:
 * `file \u0001 path \u0001 kind \u0001 ordinal`. The ordinal counts preceding
 * path-bearing elements in the same file with the same path and kind, so it
 * separates duplicates without depending on a source range. Parameters have no
 * path and are not targets.
 */
function elementKey(element: IndexElement, ordinals: Map<string, number>): string | undefined {
	const path = element.path;
	if (path === undefined) {
		return undefined;
	}
	const identity = `${path}\u0001${element.kind}`;
	const ordinal = ordinals.get(identity) ?? 0;
	ordinals.set(identity, ordinal + 1);
	return `${element.file}\u0001${identity}\u0001${ordinal}`;
}

/** Adds one file's stable element keys in declaration order. */
function addElementKeys(keys: WeakMap<IndexElement, string>, file: FileIndex): void {
	const ordinals = new Map<string, number>();
	for (const element of file.elements) {
		const key = elementKey(element, ordinals);
		if (key !== undefined) {
			keys.set(element, key);
		}
	}
}

/** Elements without an AR path are not targets and have no stable key. */
function isKeyableTarget(target: IndexElement): boolean {
	return target.path !== undefined;
}

/** The key of the indexed element at the target's own range, in declaration order. */
function keyForRangeMatch(file: FileIndex, target: IndexElement): string | undefined {
	const ordinals = new Map<string, number>();
	for (const element of file.elements) {
		const key = elementKey(element, ordinals);
		if (key !== undefined && sameTargetIdentity(element, target)) {
			return key;
		}
	}
	return undefined;
}

/** Path, kind and range all agree, so the element is the one the host asked about. */
function sameTargetIdentity(element: IndexElement, target: IndexElement): boolean {
	return element.path === target.path && element.kind === target.kind && sameRange(element.range, target.range);
}

function sameRange(left: { start: number; end: number }, right: { start: number; end: number }): boolean {
	return left.start === right.start && left.end === right.end;
}

/**
 * The ordered target-bearing sequence that the stable keys depend on. Value,
 * condition, comment, range, `contentHash`, `uuid` and reference changes leave
 * it untouched; a path, kind, `definitionRef`, order or count change alters it.
 */
function targetShape(file: FileIndex): string {
	let shape = '';
	for (const element of file.elements) {
		if (element.path === undefined) {
			continue;
		}
		shape += `${element.kind}\u0001${element.path}\u0001${definitionRefPart(element)}\u0002`;
	}
	return shape;
}

/**
 * Encodes an optional `definitionRef` with absent and empty kept distinct, the
 * same way `copiesOfOneIdentity` compares them. `\u0003` cannot appear in XML text.
 */
function definitionRefPart(element: IndexElement): string {
	return element.definitionRef === undefined ? '\u0003' : element.definitionRef;
}

/**
 * True when every duplicate of one identity is declared in range order, which is
 * the order `copiesFor` uses to pick the canonical copy. The stable key uses
 * declaration order, so an out-of-order duplicate would move a reference to a
 * different copy than a fresh build chooses.
 */
function hasCanonicalDuplicateOrder(file: FileIndex): boolean {
	const last = new Map<string, IndexElement>();
	for (const element of file.elements) {
		if (!recordInDeclarationOrder(last, element)) {
			return false;
		}
	}
	return true;
}

/** Records one element and reports whether it followed its identity's previous copy. */
function recordInDeclarationOrder(last: Map<string, IndexElement>, element: IndexElement): boolean {
	const path = element.path;
	if (path === undefined) {
		return true;
	}
	const identity = `${path}\u0001${element.kind}\u0001${definitionRefPart(element)}`;
	const before = last.get(identity);
	const inOrder = before === undefined || !outOfDeclarationOrder(before, element);
	last.set(identity, element);
	return inOrder;
}

function outOfDeclarationOrder(before: IndexElement, element: IndexElement): boolean {
	return (
		before.range.start > element.range.start ||
		(before.range.start === element.range.start && before.range.end > element.range.end)
	);
}

/** True when a shape-preserving update keeps the duplicate order canonical on both sides. */
function keepsCanonicalOrder(previous: FileIndex, next: FileIndex): boolean {
	return (
		targetShape(previous) === targetShape(next) &&
		hasCanonicalDuplicateOrder(previous) &&
		hasCanonicalDuplicateOrder(next)
	);
}

/** `referencesFor` order: file URI, then start (and end as a stable tiebreak). */
function compareReferences(left: IndexReference, right: IndexReference): number {
	if (left.file < right.file) {
		return -1;
	}
	if (left.file > right.file) {
		return 1;
	}
	return left.range.start - right.range.start || left.range.end - right.range.end;
}

function resolve<T>(lookup: PathLookup<T>, rawPath: string): T | undefined {
	const resolved = resolveDetailed(lookup, rawPath);
	return resolved.status === 'found' && resolved.candidates.length === 1 ? resolved.candidates[0] : undefined;
}

type Resolved<T> = { status: 'found'; candidates: T[] } | { status: 'absent' };

/** One element lookup that did not find a usable target. */
type FailedElementResolution = Exclude<ElementResolution, { ok: true }>;

/** Narrows the candidates to the `DEST` kind and applies the copy rule. */
function narrowTarget(
	candidates: readonly IndexElement[],
	rawPath: string,
	dest: string | undefined,
	sourceFile: string | undefined
): ElementResolution {
	const matching = filterByDest(candidates, dest);
	if (matching.length === 0) {
		const first = candidates[0];
		return { ok: false, reason: 'dest-mismatch', path: rawPath, element: first, actualKind: first.kind };
	}
	const copies = copiesFor(matching, sourceFile);
	if (copies === undefined) {
		return { ok: false, reason: 'ambiguous', path: rawPath };
	}
	return { ok: true, element: copies[0], copies };
}

/** The candidates whose kind matches the path-bearing `DEST`, when it names one. */
function filterByDest(candidates: readonly IndexElement[], dest: string | undefined): readonly IndexElement[] {
	const expected = expectedKind(dest);
	return expected === undefined ? candidates : candidates.filter((candidate) => candidate.kind === expected);
}

/** The refused reference, carrying the target and the mismatching kind when known. */
function failedReference(
	resolution: FailedElementResolution,
	reference: IndexReference,
	raw: string
): ReferenceResolution {
	const actual = resolution.reason === 'dest-mismatch' ? { actualKind: resolution.actualKind } : {};
	return { ok: false, reason: resolution.reason, reference, target: raw, ...actual };
}

function resolveDetailed<T>(lookup: PathLookup<T>, rawPath: string): Resolved<T> {
	const segments = splitPath(rawPath);
	for (let start = 0; start < segments.length; start++) {
		const candidate = '/' + segments.slice(start).join('/');
		const exact = lookup.exact.get(candidate);
		if (exact !== undefined) {
			return { status: 'found', candidates: exact };
		}
		const suffix = lookup.suffix.get(candidate);
		if (suffix !== undefined) {
			return { status: 'found', candidates: suffix };
		}
	}
	return { status: 'absent' };
}

/** The candidate list for navigation, or `undefined` when the copies do not agree. */
function copiesFor(candidates: readonly IndexElement[], sourceFile: string | undefined): IndexElement[] | undefined {
	if (candidates.length === 1) {
		return [candidates[0]];
	}
	if (!copiesOfOneIdentity(candidates)) {
		return undefined;
	}
	return orderedCopies(candidates, sourceFile);
}

/** The agreed copies, with the source file's own copy first. */
function orderedCopies(candidates: readonly IndexElement[], sourceFile: string | undefined): IndexElement[] {
	const local = candidates.filter((candidate) => candidate.file === sourceFile);
	if (local.length > 1) {
		return [...sortCopies(local), ...sortCopies(candidates.filter((candidate) => candidate.file !== sourceFile))];
	}
	if (local.length === 1) {
		return [local[0], ...sortCopies(candidates.filter((candidate) => candidate !== local[0]))];
	}
	return sortCopies(candidates);
}

function copiesOfOneIdentity(candidates: readonly IndexElement[]): boolean {
	const first = candidates[0];
	return candidates.every(
		(candidate) => candidate.kind === first.kind && candidate.definitionRef === first.definitionRef
	);
}

function sortCopies(candidates: readonly IndexElement[]): IndexElement[] {
	return [...candidates].sort(
		(left, right) =>
			left.file.localeCompare(right.file) || left.range.start - right.range.start || left.range.end - right.range.end
	);
}

/** The element kind a path-bearing `DEST` names, or `undefined` when it is not checked. */
function expectedKind(dest: string | undefined): IndexElement['kind'] | undefined {
	switch (dest) {
		case 'ECUC-MODULE-CONFIGURATION-VALUES':
			return 'module';
		case 'ECUC-CONTAINER-VALUE':
			return 'container';
		default:
			return undefined;
	}
}

function splitPath(path: string): string[] {
	return path
		.trim()
		.split('/')
		.filter((segment) => segment.length > 0);
}

/** Appends every element then every reference in one file that uses the definition. */
function collectDefinitionUsers(
	out: Array<IndexElement | IndexReference>,
	file: FileIndex,
	path: string,
	pathOf: (reference: string) => string | undefined
): void {
	collectElementUsers(out, file, path, pathOf);
	collectReferenceUsers(out, file, path, pathOf);
}

function collectElementUsers(
	out: Array<IndexElement | IndexReference>,
	file: FileIndex,
	path: string,
	pathOf: (reference: string) => string | undefined
): void {
	for (const element of file.elements) {
		if (isDefinitionUser(element, path, pathOf)) {
			out.push(element);
		}
	}
}

function collectReferenceUsers(
	out: Array<IndexElement | IndexReference>,
	file: FileIndex,
	path: string,
	pathOf: (reference: string) => string | undefined
): void {
	for (const reference of file.references) {
		if (isDefinitionUser(reference, path, pathOf)) {
			out.push(reference);
		}
	}
}

function isDefinitionUser(
	record: IndexElement | IndexReference,
	path: string,
	pathOf: (reference: string) => string | undefined
): boolean {
	return record.definitionRef !== undefined && pathOf(record.definitionRef) === path;
}
