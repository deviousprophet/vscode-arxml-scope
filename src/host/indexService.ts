/**
 * Owns the workspace index lifecycle: discovery, streamed reads, the file
 * watcher, the status bar item and the rebuild command behind it.
 *
 * Reads use a Node read stream plus a streaming `TextDecoder`, so a large ARXML
 * never has to be materialized as one string. Nothing is written to disk; the
 * index is rebuilt from the workspace on activation.
 */
import { createReadStream, promises as fs } from 'fs';
import type { Stats } from 'fs';
import * as vscode from 'vscode';
import { IndexBuilder } from '../core/index/indexBuilder';
import { compileExcludes } from '../core/index/glob';
import { RebuildGuard } from '../core/index/rebuildGuard';
import { detectEncoding } from '../core/text/encoding';
import type { FileIndex, IndexElement, IndexReference, IndexStats } from '../core/index/indexModel';
import { resolveDefinition } from '../core/index/definitions';
import type { DefinitionInfo } from '../core/index/definitions';
import { WorkspaceIndex } from '../core/index/workspaceIndex';
import type { ElementResolution, IndexSubscription } from '../core/index/workspaceIndex';
import type { DefinitionSource } from './ecucEditorProvider';

const DEBOUNCE_MS = 250;
/** Read chunk; large enough to keep syscall overhead low, small enough to stay responsive. */
const CHUNK_BYTES = 64 * 1024;

export interface IndexSettings {
	enabled: boolean;
	maxBytes: number;
	exclude: string[];
}

/** Reads the index settings with the documented defaults. */
export function indexSettings(): IndexSettings {
	const config = vscode.workspace.getConfiguration('arxmlScope.index');
	const enabled = config.get<boolean>('enabled', true);
	const megabytes = config.get<number>('maxFileSizeMB', 50);
	const safeMegabytes = typeof megabytes === 'number' && Number.isFinite(megabytes) ? Math.max(1, megabytes) : 50;
	const rawExclude = config.get<unknown>('exclude', []);
	const exclude = Array.isArray(rawExclude) ? rawExclude.filter((entry): entry is string => typeof entry === 'string') : [];
	return { enabled, maxBytes: safeMegabytes * 1024 * 1024, exclude };
}

/** True when this document belongs to a workspace folder and is not excluded. */
export function isIndexableUri(uri: vscode.Uri): boolean {
	if (vscode.workspace.getWorkspaceFolder(uri) === undefined) {
		return false;
	}
	const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
	return !compileExcludes(indexSettings().exclude)(relative);
}

/** True when this file should be represented in the index at all. */
function indexesFile(uri: vscode.Uri, settings: IndexSettings): boolean {
	return settings.enabled && isIndexableUri(uri);
}

/** True when a discovery hit is outside a workspace folder or excluded by settings. */
function isExcludedUri(uri: vscode.Uri, exclude: (relative: string) => boolean): boolean {
	if (vscode.workspace.getWorkspaceFolder(uri) === undefined) {
		return true;
	}
	const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
	return exclude(relative);
}

/** `N file` / `N files`; one owner for the status bar and its tooltip. */
function fileCountText(count: number): string {
	return `${count} file${count === 1 ? '' : 's'}`;
}

/** The cross-file rule mode; `auto` needs at least one indexed definition. */
export function crossFileRulesSetting(): 'auto' | 'always' | 'never' {
	const value = vscode.workspace.getConfiguration('arxmlScope.validation').get<string>('crossFileRules', 'auto');
	return value === 'always' || value === 'never' ? value : 'auto';
}

/** The status bar label for one index state. */
function statusBarText(stats: IndexStats, building: boolean, modeLabel?: string): string {
	if (building) {
		return '$(sync~spin) ARXML Scope: indexing…';
	}
	const suffix = modeLabel === undefined ? '' : ` · ${modeLabel}`;
	return `$(database) ARXML Scope: ${fileCountText(stats.files)} indexed${suffix}`;
}

/** The streaming decoder state for one file read. */
interface FileDecoding {
	decoder?: TextDecoder;
	head: Buffer;
}

/** Reads one ARXML file and returns its index contribution. */
async function readFileIndex(uri: vscode.Uri, maxBytes: number): Promise<FileIndex | undefined> {
	const stat = await fs.stat(uri.fsPath);
	if (!isIndexableFile(stat, maxBytes)) {
		return undefined;
	}
	const builder = new IndexBuilder(uri.toString());
	const decoding: FileDecoding = { head: Buffer.alloc(0) };
	for await (const chunk of createReadStream(uri.fsPath, { highWaterMark: CHUNK_BYTES })) {
		if (!writeChunk(builder, decoding, chunk)) {
			return undefined;
		}
	}
	finishDecoding(builder, decoding);
	return builder.finish();
}

/** The file still has to exist, be a file and fit the size cap. */
function isIndexableFile(stat: Stats, maxBytes: number): boolean {
	return stat.isFile() && stat.size <= maxBytes;
}

/** Feeds one stream chunk through the decoder, detecting the encoding on the head. */
function writeChunk(builder: IndexBuilder, decoding: FileDecoding, chunk: Buffer): boolean {
	if (!Buffer.isBuffer(chunk)) {
		return true;
	}
	if (decoding.decoder !== undefined) {
		builder.write(decoding.decoder.decode(chunk, { stream: true }));
		return true;
	}
	decoding.head = Buffer.concat([decoding.head, chunk]);
	if (decoding.head.length < 3) {
		return true;
	}
	return startDecoding(builder, decoding);
}

/** Creates the decoder once the first bytes identify the encoding; false on failure. */
function startDecoding(builder: IndexBuilder, decoding: FileDecoding): boolean {
	const detected = detectEncoding(decoding.head);
	if (detected === undefined) {
		return false;
	}
	decoding.decoder = new TextDecoder(detected.label);
	builder.write(decoding.decoder.decode(decoding.head.subarray(detected.bomBytes), { stream: true }));
	return true;
}

/** Flushes the decoder's pending bytes at end of stream. */
function finishDecoding(builder: IndexBuilder, decoding: FileDecoding): void {
	if (decoding.decoder !== undefined) {
		builder.write(decoding.decoder.decode());
	}
}

export class IndexService implements vscode.Disposable, DefinitionSource {
	private readonly index = new WorkspaceIndex();
	private readonly status: vscode.StatusBarItem;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
	/** Invalidates a file read that started before the current rebuild. */
	private readonly guard = new RebuildGuard();
	/** Files the watcher touched while a rebuild was reading; drained after `replaceAll`. */
	private readonly dirtyDuringBuild = new Set<string>();
	/** Files that were too large or unreadable; reported in the tooltip only. */
	private readonly skipped = new Set<string>();
	/** Files dropped by `arxmlScope.index.exclude` during the last rebuild. */
	private excludedCount = 0;
	private watcher?: vscode.FileSystemWatcher;
	private building = false;
	private started = false;
	private lastIndexedAt?: number;
	private rebuildPromise?: Promise<void>;
	private rebuildQueued = false;

	constructor(
		private readonly reader: (uri: vscode.Uri, maxBytes: number) => Promise<FileIndex | undefined> = readFileIndex
	) {
		this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.status.command = 'vscode-arxml-scope.cycleCrossFileRules';
		this.disposables.push(this.status);
	}

	/** Starts the watcher and the first build. Does not await the build. */
	start(): void {
		if (this.started) {
			return;
		}
		this.started = true;
		// The listener must exist even when the index starts disabled; otherwise
		// enabling the setting could never revive it without a window reload.
		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration('arxmlScope.index')) {
					void this.onConfigurationChanged();
				} else if (event.affectsConfiguration('arxmlScope.validation')) {
					this.updateStatus();
				}
			})
		);
		if (indexSettings().enabled) {
			this.startWatcher();
		}
		void this.rebuild().catch(() => {
			// `runRebuild` already keeps the previous index on a read failure; this
			// catch only removes the unhandled-rejection tail from the fire-and-forget start.
			this.building = false;
			this.updateStatus();
		});
	}

	/** The current index, for the editor provider and the extension API. */
	get workspaceIndex(): WorkspaceIndex {
		return this.index;
	}

	/** The raw status bar text (empty while the item is hidden). */
	statusText(): string {
		return this.status.text;
	}

	stats(): IndexStats {
		return this.index.stats();
	}

	/** Resolves a `DEFINITION-REF` to the display shape, or nothing when absent/ambiguous. */
	definition(definitionRef: string): DefinitionInfo | undefined {
		return resolveDefinition(this.index, definitionRef);
	}

	/** How many definition bodies share this path (0, 1 or N). */
	definitionCandidateCount(definitionRef: string): number {
		return this.index.definitionCandidateCount(definitionRef);
	}

	/** Resolves a reference target across the workspace, with the reason kept. */
	resolveTarget(targetPath: string, targetDest?: string, sourceFile?: string): ElementResolution {
		return this.index.resolveTarget(targetPath, targetDest, sourceFile);
	}

	/** References that resolve to the given element, across every indexed file. */
	referencesFor(target: IndexElement): IndexReference[] {
		return this.index.referencesFor(target);
	}

	/** Elements/references whose own definition resolves to the given definition. */
	definitionUsers(definitionPath: string): Array<IndexElement | IndexReference> {
		return this.index.definitionUsers(definitionPath);
	}

	/** Rebuilds every file. Concurrent calls share one build chain. */
	async rebuild(): Promise<void> {
		if (this.rebuildPromise !== undefined) {
			this.rebuildQueued = true;
			return this.rebuildPromise;
		}
		this.rebuildPromise = (async () => {
			do {
				this.rebuildQueued = false;
				await this.runRebuild();
			} while (this.rebuildQueued);
		})().finally(() => {
			this.rebuildPromise = undefined;
		});
		return this.rebuildPromise;
	}

	/** Reindexes exactly one file; used by the watcher and the rebuild drain. */
	async reindexFile(uri: vscode.Uri, publish = true): Promise<void> {
		const settings = indexSettings();
		if (!indexesFile(uri, settings)) {
			this.dropUnindexed(uri, publish);
			return;
		}
		const readGeneration = this.guard.beginRead();
		let completed = false;
		try {
			const file = await this.reader(uri, settings.maxBytes);
			completed = this.applyReadResult(uri, file, readGeneration, publish);
		} catch (error) {
			completed = this.applyReadFailure(uri, error, readGeneration, publish);
		}
		if (completed) {
			this.finishReindex(publish);
		}
	}

	/** Not indexable: drop any stale entry and publish only when it existed. */
	private dropUnindexed(uri: vscode.Uri, publish: boolean): void {
		if (this.index.remove(uri.toString()) && publish) {
			this.publish();
		}
	}

	/** Stores a fresh read; `false` when a rebuild superseded it. */
	private applyReadResult(
		uri: vscode.Uri,
		file: FileIndex | undefined,
		generation: number,
		publish: boolean
	): boolean {
		if (this.guard.isStale(generation)) {
			this.deferStaleRead(uri, publish);
			return false;
		}
		this.storeReadResult(uri, file);
		return true;
	}

	/** Records a fresh read failure; `false` when a rebuild superseded it. */
	private applyReadFailure(uri: vscode.Uri, error: unknown, generation: number, publish: boolean): boolean {
		if (this.guard.isStale(generation)) {
			this.deferStaleRead(uri, publish);
			return false;
		}
		this.recordReadFailure(uri, error);
		return true;
	}

	/**
	 * A rebuild started while this read was in flight; the rebuild or its
	 * late-drain pass must re-read the file instead of accepting this copy.
	 */
	private deferStaleRead(uri: vscode.Uri, publish: boolean): void {
		this.dirtyDuringBuild.add(uri.toString());
		if (!this.building) {
			void this.reindexFile(uri, publish);
		}
	}

	private storeReadResult(uri: vscode.Uri, file: FileIndex | undefined): void {
		if (file === undefined) {
			this.skipped.add(uri.toString());
			this.index.remove(uri.toString());
		} else {
			this.skipped.delete(uri.toString());
			this.index.upsert(file);
		}
	}

	/**
	 * A deleted file is not a skipped file: remove it and keep the status quiet.
	 * Any other read failure is reported as skipped.
	 */
	private recordReadFailure(uri: vscode.Uri, error: unknown): void {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT') {
			this.skipped.delete(uri.toString());
		} else {
			this.skipped.add(uri.toString());
		}
		this.index.remove(uri.toString());
	}

	private finishReindex(publish: boolean): void {
		this.lastIndexedAt = Date.now();
		if (publish) {
			this.publish();
		}
	}

	/** Subscribes to index changes without exposing the `vscode.EventEmitter`. */
	subscribe(listener: () => void): IndexSubscription {
		return this.index.onDidChange(listener);
	}

	dispose(): void {
		for (const timer of this.pending.values()) {
			clearTimeout(timer);
		}
		this.pending.clear();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables.length = 0;
	}

	private async runRebuild(): Promise<void> {
		const settings = indexSettings();
		if (!settings.enabled) {
			this.clearDisabledIndex();
			return;
		}
		this.beginBuilding();
		try {
			this.applyRebuildSnapshot(await this.collectRebuildFiles(settings));
			await this.drainDirtyDuringBuild(false);
		} catch {
			// Discovery or a surprising read failure keeps the previous index. The
			// finally block still clears the busy state and publishes the status.
		} finally {
			this.finishBuilding();
		}
	}

	/** The disabled index is empty and publishes that state immediately. */
	private clearDisabledIndex(): void {
		this.index.clear();
		this.skipped.clear();
		this.excludedCount = 0;
		this.building = false;
		this.publish();
	}

	private beginBuilding(): void {
		this.building = true;
		this.updateStatus();
		this.guard.beginRebuild();
	}

	/** Discovers and reads every indexable file without touching the live index. */
	private async collectRebuildFiles(
		settings: IndexSettings
	): Promise<{ files: FileIndex[]; skipped: Set<string>; excluded: number }> {
		const uris = await vscode.workspace.findFiles('**/*.arxml');
		uris.sort((left, right) => left.toString().localeCompare(right.toString()));
		const files: FileIndex[] = [];
		const skipped = new Set<string>();
		const exclude = compileExcludes(settings.exclude);
		let excluded = 0;
		for (const uri of uris) {
			if (isExcludedUri(uri, exclude)) {
				excluded++;
				continue;
			}
			await this.readRebuildFile(uri, settings.maxBytes, skipped, files);
		}
		return { files, skipped, excluded };
	}

	/** Reads one discovery hit; an unreadable file is skipped, never fatal. */
	private async readRebuildFile(
		uri: vscode.Uri,
		maxBytes: number,
		skipped: Set<string>,
		files: FileIndex[]
	): Promise<void> {
		try {
			const file = await this.reader(uri, maxBytes);
			if (file === undefined) {
				skipped.add(uri.toString());
			} else {
				files.push(file);
			}
		} catch {
			skipped.add(uri.toString());
		}
	}

	/** Swaps in the collected snapshot, then reports exactly its skipped files. */
	private applyRebuildSnapshot(snapshot: { files: FileIndex[]; skipped: Set<string>; excluded: number }): void {
		this.excludedCount = snapshot.excluded;
		this.index.replaceAll(snapshot.files);
		this.skipped.clear();
		for (const uri of snapshot.skipped) {
			this.skipped.add(uri);
		}
	}

	/**
	 * Saves that landed while the rebuild was reading must not be lost to
	 * `replaceAll`; apply those files on top of the fresh snapshot.
	 */
	private async drainDirtyDuringBuild(publish: boolean): Promise<void> {
		const dirty = [...this.dirtyDuringBuild];
		this.dirtyDuringBuild.clear();
		for (const key of dirty) {
			await this.reindexFile(vscode.Uri.parse(key), publish);
		}
	}

	/**
	 * A read that began before this rebuild can finish after the drain. Once the
	 * building flag is down, reindex those files again so the newest content wins.
	 */
	private finishBuilding(): void {
		const late = [...this.dirtyDuringBuild];
		this.dirtyDuringBuild.clear();
		this.building = false;
		for (const key of late) {
			void this.reindexFile(vscode.Uri.parse(key), true);
		}
		this.lastIndexedAt = Date.now();
		this.publish();
	}

	private startWatcher(): void {
		if (this.watcher !== undefined) {
			return;
		}
		this.watcher = vscode.workspace.createFileSystemWatcher('**/*.arxml');
		this.disposables.push(
			this.watcher,
			this.watcher.onDidCreate((uri) => this.schedule(uri)),
			this.watcher.onDidChange((uri) => this.schedule(uri)),
			this.watcher.onDidDelete((uri) => this.remove(uri))
		);
	}

	private schedule(uri: vscode.Uri): void {
		if (!isIndexableUri(uri)) {
			return;
		}
		const key = uri.toString();
		if (this.building) {
			this.dirtyDuringBuild.add(key);
		}
		const existing = this.pending.get(key);
		if (existing !== undefined) {
			clearTimeout(existing);
		}
		this.pending.set(
			key,
			setTimeout(() => {
				this.pending.delete(key);
				void this.reindexFile(uri);
			}, DEBOUNCE_MS)
		);
	}

	private remove(uri: vscode.Uri): void {
		const key = uri.toString();
		this.markDirtyDuringBuild(key);
		this.clearPendingTimer(key);
		if (this.discardIndexedFile(key)) {
			this.lastIndexedAt = Date.now();
			this.publish();
		}
	}

	/** The index/watch bookkeeping for one key, without status effects. */
	private markDirtyDuringBuild(key: string): void {
		if (this.building) {
			this.dirtyDuringBuild.add(key);
		}
	}

	private clearPendingTimer(key: string): void {
		const timer = this.pending.get(key);
		if (timer !== undefined) {
			clearTimeout(timer);
			this.pending.delete(key);
		}
	}

	/** Removes the file from both the index and the skipped list; true when either held it. */
	private discardIndexedFile(key: string): boolean {
		const wasSkipped = this.skipped.delete(key);
		const removed = this.index.remove(key);
		return removed || wasSkipped;
	}

	private async onConfigurationChanged(): Promise<void> {
		const settings = indexSettings();
		if (!settings.enabled) {
			for (const timer of this.pending.values()) {
				clearTimeout(timer);
			}
			this.pending.clear();
			this.index.clear();
			this.skipped.clear();
			this.publish();
			return;
		}
		this.startWatcher();
		await this.rebuild();
	}

	private publish(): void {
		this.updateStatus();
	}

	private updateStatus(): void {
		const settings = indexSettings();
		const stats = this.index.stats();
		if (this.shouldHideStatus(settings, stats)) {
			this.status.hide();
			this.status.text = '';
			return;
		}
		const mode = crossFileRulesSetting();
		this.status.text = statusBarText(stats, this.building, crossFileModeLabel(mode, stats.definitions));
		this.status.tooltip = this.statusTooltip(stats, mode);
		this.status.show();
	}

	/** Hidden while disabled, and on an empty non-workspace window. */
	private shouldHideStatus(settings: IndexSettings, stats: IndexStats): boolean {
		if (!settings.enabled) {
			return true;
		}
		return !this.building && stats.files === 0 && workspaceFoldersExist();
	}

	private statusTooltip(stats: IndexStats, mode: ReturnType<typeof crossFileRulesSetting>): string {
		const lines = baseStatusLines(stats, mode);
		this.appendSkippedLine(lines);
		if (this.excludedCount > 0) {
			lines.push(excludedBySettingText(this.excludedCount));
		}
		this.appendUpdatedLine(lines);
		lines.push('Click to cycle cross-file checks; run ARXML Scope: Rebuild Workspace Index to rebuild.');
		return lines.join('\n');
	}

	private appendSkippedLine(lines: string[]): void {
		if (this.skipped.size === 0) {
			return;
		}
		lines.push(skippedText([...this.skipped].map(fileNameOf)));
	}

	private appendUpdatedLine(lines: string[]): void {
		if (this.lastIndexedAt !== undefined) {
			lines.push(`Updated ${new Date(this.lastIndexedAt).toLocaleTimeString()}`);
		}
	}
}

function workspaceFoldersExist(): boolean {
	return (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
}

/** The short cross-file label shown after the indexed file count. */
function crossFileModeLabel(mode: ReturnType<typeof crossFileRulesSetting>, definitions: number): string | undefined {
	if (mode === 'always') {
		return 'cross-file checks always';
	}
	if (mode === 'never') {
		return 'cross-file checks off';
	}
	return definitions === 0 ? 'cross-file checks off (no project)' : undefined;
}

/** The tooltip's cross-file sentence, which spells out the resolved mode. */
function crossFileSummary(mode: ReturnType<typeof crossFileRulesSetting>, definitions: number): string {
	if (mode === 'always') {
		return 'always';
	}
	if (mode === 'never') {
		return 'never';
	}
	return definitions === 0 ? 'off (no project)' : 'auto';
}

function baseStatusLines(stats: IndexStats, mode: ReturnType<typeof crossFileRulesSetting>): string[] {
	return [
		`${fileCountText(stats.files)} indexed`,
		`${stats.elements} elements, ${stats.references} references, ${stats.definitions} definitions`,
		`${stats.packages} packages`,
		`Cross-file checks: ${crossFileSummary(mode, stats.definitions)}`,
	];
}

/** `Skipped: …` with the first five names and a count for the rest. */
function skippedText(names: string[]): string {
	const shown = names.slice(0, 5).join(', ');
	const more = names.length > 5 ? ` and ${names.length - 5} more` : '';
	return `Skipped: ${shown}${more} (size limit, encoding or unreadable)`;
}

function excludedBySettingText(count: number): string {
	return `${count} file${count === 1 ? '' : 's'} excluded by arxmlScope.index.exclude`;
}

/** The last path segment of a URI, for the skipped-file tooltip. */
function fileNameOf(uri: string): string {
	const withoutQuery = uri.split(/[?#]/)[0];
	const segments = withoutQuery.split('/');
	const last = segments[segments.length - 1];
	if (last === undefined || last === '') {
		return uri;
	}
	try {
		return decodeURIComponent(last);
	} catch {
		return last;
	}
}
