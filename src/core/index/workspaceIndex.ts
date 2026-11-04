/**
 * In-memory workspace index.
 *
 * One `FileIndex` per URI. An update replaces exactly one file's contribution;
 * the lookup maps are rebuilt lazily after a change, so a save never rescans the
 * other files. Lookups are exact-first and then unique-suffix; two matches are
 * ambiguous and resolve to nothing, matching the single-file resolver's
 * "refuse rather than guess" rule.
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
	/** Bumped on every mutation so a cached lookup can never outlive a change. */
	private generation = 0;
	private lookupsAt = -1;

	/** Replaces one file's contribution and notifies subscribers. */
	upsert(file: FileIndex): void {
		this.files.set(file.uri, file);
		this.changed();
	}

	/** Removes one file's contribution. Returns false when it was not indexed. */
	remove(uri: string): boolean {
		const removed = this.files.delete(uri);
		if (removed) {
			this.changed();
		}
		return removed;
	}

	/** Replaces the whole index in one notification (a full rebuild). */
	replaceAll(files: readonly FileIndex[]): void {
		this.files.clear();
		for (const file of files) {
			this.files.set(file.uri, file);
		}
		this.changed();
	}

	clear(): void {
		if (this.files.size === 0) {
			return;
		}
		this.files.clear();
		this.changed();
	}

	get size(): number {
		return this.files.size;
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
		const expected = expectedKind(dest);
		const candidates =
			expected === undefined ? resolved.candidates : resolved.candidates.filter((candidate) => candidate.kind === expected);
		if (candidates.length === 0) {
			const first = resolved.candidates[0];
			return {
				ok: false,
				reason: 'dest-mismatch',
				path: rawPath,
				element: first,
				actualKind: first.kind,
			};
		}
		const copies = copiesFor(candidates, sourceFile);
		if (copies === undefined) {
			return { ok: false, reason: 'ambiguous', path: rawPath };
		}
		return { ok: true, element: copies[0], copies };
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
		return {
			ok: false,
			reason: resolution.reason,
			reference,
			target: raw,
			...(resolution.reason === 'dest-mismatch' ? { actualKind: resolution.actualKind } : {}),
		};
	}

	/** Every reference that resolves to the same element. */
	referencesFor(target: IndexElement): IndexReference[] {
		const out: IndexReference[] = [];
		for (const file of this.files.values()) {
			for (const reference of file.references) {
				const resolution = this.resolveReference(reference);
				if (
					resolution.ok &&
					resolution.element.file === target.file &&
					resolution.element.range.start === target.range.start &&
					resolution.element.range.end === target.range.end
				) {
					out.push(reference);
				}
			}
		}
		return out;
	}

	/** Every element/reference whose own `DEFINITION-REF` resolves to this definition. */
	definitionUsers(definitionPath: string): Array<IndexElement | IndexReference> {
		const target = this.definitionEntry(definitionPath);
		if (target === undefined) {
			return [];
		}
		const out: Array<IndexElement | IndexReference> = [];
		const canonical = new Map<string, string | undefined>();
		const pathOf = (reference: string): string | undefined => {
			if (!canonical.has(reference)) {
				canonical.set(reference, this.definitionEntry(reference)?.path);
			}
			return canonical.get(reference);
		};
		for (const file of this.files.values()) {
			for (const element of file.elements) {
				if (element.definitionRef !== undefined && pathOf(element.definitionRef) === target.path) {
					out.push(element);
				}
			}
			for (const reference of file.references) {
				if (reference.definitionRef !== undefined && pathOf(reference.definitionRef) === target.path) {
					out.push(reference);
				}
			}
		}
		return out;
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

	private changed(): void {
		this.generation++;
		for (const listener of this.listeners) {
			listener();
		}
	}

	private ensureLookups(): void {
		if (this.lookupsAt === this.generation && this.elements !== undefined && this.definitions !== undefined) {
			return;
		}
		const generation = this.generation;
		try {
			const elements: IndexElement[] = [];
			const definitions: IndexDefinition[] = [];
			for (const file of this.files.values()) {
				// Never use spread here: a large file can exceed the engine's argument
				// limit and throw `RangeError` inside the editor's row build.
				for (const element of file.elements) {
					elements.push(element);
				}
				for (const definition of file.definitions) {
					definitions.push(definition);
				}
			}
			this.elements = buildLookup(elements, (element) => element.path);
			this.definitions = buildLookup(definitions, (definition) => definition.path);
		} catch {
			// A lookup failure must not make every later call rethrow. Definitions are
			// optional data; degrading to "no lookup" keeps the editor usable.
			this.elements = emptyLookup();
			this.definitions = emptyLookup();
		}
		this.lookupsAt = generation;
	}
}

interface PathLookup<T> {
	exact: Map<string, T[]>;
	suffix: Map<string, T[]>;
}

function emptyLookup<T>(): PathLookup<T> {
	return { exact: new Map(), suffix: new Map() };
}

/**
 * Builds the two candidate maps. Exact keys keep the full path; suffix keys keep
 * every suffix. A unique path has a one-element array; only repeated paths grow.
 */
function buildLookup<T>(items: readonly T[], pathOf: (item: T) => string | undefined): PathLookup<T> {
	const exact = new Map<string, T[]>();
	const suffix = new Map<string, T[]>();
	for (const item of items) {
		const path = pathOf(item);
		if (path === undefined) {
			continue;
		}
		const segments = splitPath(path);
		if (segments.length === 0) {
			continue;
		}
		const full = '/' + segments.join('/');
		const exactList = exact.get(full);
		if (exactList === undefined) {
			exact.set(full, [item]);
		} else {
			exactList.push(item);
		}
		for (let start = 0; start < segments.length; start++) {
			const key = '/' + segments.slice(start).join('/');
			const list = suffix.get(key);
			if (list === undefined) {
				suffix.set(key, [item]);
			} else {
				list.push(item);
			}
		}
	}
	return { exact, suffix };
}

function resolve<T>(lookup: PathLookup<T>, rawPath: string): T | undefined {
	const resolved = resolveDetailed(lookup, rawPath);
	return resolved.status === 'found' && resolved.candidates.length === 1 ? resolved.candidates[0] : undefined;
}

type Resolved<T> = { status: 'found'; candidates: T[] } | { status: 'absent' };

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
	const local = candidates.filter((candidate) => candidate.file === sourceFile);
	if (local.length > 1) {
		return undefined;
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
