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

/** One element lookup, with the refusal reason kept for the caller. */
export type ElementResolution =
	| { ok: true; element: IndexElement }
	| { ok: false; reason: 'absent' | 'ambiguous'; path: string }
	| { ok: false; reason: 'dest-mismatch'; path: string; element: IndexElement; actualKind: IndexElement['kind'] };

/** One reference lookup, with the source reference kept for diagnostics. */
export type ReferenceResolution =
	| { ok: true; element: IndexElement; reference: IndexReference }
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
	resolveTarget(rawPath: string, dest?: string): ElementResolution {
		this.ensureLookups();
		const resolved = resolveDetailed(this.elements!, rawPath);
		if (resolved.status !== 'found') {
			return { ok: false, reason: resolved.status, path: rawPath };
		}
		const expected = expectedKind(dest);
		if (expected !== undefined && resolved.value.kind !== expected) {
			return {
				ok: false,
				reason: 'dest-mismatch',
				path: rawPath,
				element: resolved.value,
				actualKind: resolved.value.kind,
			};
		}
		return { ok: true, element: resolved.value };
	}

	/** Resolves one indexed reference through the workspace index. */
	resolveReference(reference: IndexReference): ReferenceResolution {
		const raw = reference.targetRawPath ?? '';
		if (raw === '') {
			return { ok: false, reason: 'no-target', reference };
		}
		const resolution = this.resolveTarget(raw, reference.targetDest);
		if (resolution.ok) {
			return { ok: true, element: resolution.element, reference };
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
	exact: Map<string, T | undefined>;
	suffix: Map<string, T | undefined>;
}

function emptyLookup<T>(): PathLookup<T> {
	return { exact: new Map(), suffix: new Map() };
}

/**
 * Builds the two lookup maps. `exact` keeps a full path unique, while `suffix`
 * holds every suffix with `undefined` marking an ambiguity.
 */
function buildLookup<T>(items: readonly T[], pathOf: (item: T) => string | undefined): PathLookup<T> {
	const exact = new Map<string, T | undefined>();
	const suffix = new Map<string, T | undefined>();
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
		if (!exact.has(full)) {
			exact.set(full, item);
		} else if (exact.get(full) !== item) {
			exact.set(full, undefined);
		}
		for (let start = 0; start < segments.length; start++) {
			const key = '/' + segments.slice(start).join('/');
			if (!suffix.has(key)) {
				suffix.set(key, item);
			} else if (suffix.get(key) !== item) {
				suffix.set(key, undefined);
			}
		}
	}
	return { exact, suffix };
}

function resolve<T>(lookup: PathLookup<T>, rawPath: string): T | undefined {
	const resolved = resolveDetailed(lookup, rawPath);
	return resolved.status === 'found' ? resolved.value : undefined;
}

type Resolved<T> = { status: 'found'; value: T } | { status: 'absent' } | { status: 'ambiguous' };

function resolveDetailed<T>(lookup: PathLookup<T>, rawPath: string): Resolved<T> {
	const segments = splitPath(rawPath);
	for (let start = 0; start < segments.length; start++) {
		const candidate = '/' + segments.slice(start).join('/');
		if (lookup.exact.has(candidate)) {
			const value = lookup.exact.get(candidate);
			return value === undefined ? { status: 'ambiguous' } : { status: 'found', value };
		}
		if (lookup.suffix.has(candidate)) {
			const value = lookup.suffix.get(candidate);
			return value === undefined ? { status: 'ambiguous' } : { status: 'found', value };
		}
	}
	return { status: 'absent' };
}

/** The element kind a `DEST` names, or `undefined` when the DEST is not a value kind. */
function expectedKind(dest: string | undefined): IndexElement['kind'] | undefined {
	switch (dest) {
		case 'ECUC-MODULE-CONFIGURATION-VALUES':
			return 'module';
		case 'ECUC-CONTAINER-VALUE':
			return 'container';
		case 'ECUC-NUMERICAL-PARAM-VALUE':
		case 'ECUC-TEXTUAL-PARAM-VALUE':
			return 'parameter';
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
