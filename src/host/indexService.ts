/**
 * Owns the workspace index lifecycle: discovery, streamed reads, the file
 * watcher, the status bar item and the rebuild command behind it.
 *
 * Reads use a Node read stream plus a streaming `TextDecoder`, so a large ARXML
 * never has to be materialized as one string. Nothing is written to disk; the
 * index is rebuilt from the workspace on activation.
 */
import { createReadStream, promises as fs } from 'fs';
import * as vscode from 'vscode';
import { IndexBuilder } from '../core/index/indexBuilder';
import { FileIndex, IndexStats } from '../core/index/indexModel';
import { DefinitionInfo, definitionInfo } from '../core/index/definitions';
import { IndexSubscription, WorkspaceIndex } from '../core/index/workspaceIndex';

const DEBOUNCE_MS = 250;
/** Read chunk; large enough to keep syscall overhead low, small enough to stay responsive. */
const CHUNK_BYTES = 64 * 1024;

export interface IndexSettings {
	enabled: boolean;
	maxBytes: number;
}

/** Reads the index settings with the documented defaults. */
export function indexSettings(): IndexSettings {
	const config = vscode.workspace.getConfiguration('arxmlScope.index');
	const enabled = config.get<boolean>('enabled', true);
	const megabytes = config.get<number>('maxFileSizeMB', 50);
	const safeMegabytes = typeof megabytes === 'number' && Number.isFinite(megabytes) ? Math.max(1, megabytes) : 50;
	return { enabled, maxBytes: safeMegabytes * 1024 * 1024 };
}

/** The status bar label for one index state. */
export function statusBarText(stats: IndexStats, building: boolean): string {
	if (building) {
		return '$(sync~spin) ARXML Scope: indexing…';
	}
	return `$(database) ARXML Scope: ${stats.files} file${stats.files === 1 ? '' : 's'} indexed`;
}

/** Reads one ARXML file and returns its index contribution. */
export async function readFileIndex(uri: vscode.Uri, maxBytes: number): Promise<FileIndex | undefined> {
	const stat = await fs.stat(uri.fsPath);
	if (!stat.isFile() || stat.size > maxBytes) {
		return undefined;
	}
	const builder = new IndexBuilder(uri.toString());
	const decoder = new TextDecoder('utf-8');
	const stream = createReadStream(uri.fsPath, { highWaterMark: CHUNK_BYTES });
	for await (const chunk of stream) {
		builder.write(decoder.decode(chunk, { stream: true }));
	}
	builder.write(decoder.decode());
	return builder.finish();
}

export class IndexService implements vscode.Disposable {
	private readonly index = new WorkspaceIndex();
	private readonly emitter = new vscode.EventEmitter<IndexStats>();
	private readonly status: vscode.StatusBarItem;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
	/** Files that were too large or unreadable; reported in the tooltip only. */
	private readonly skipped = new Set<string>();
	private watcher?: vscode.FileSystemWatcher;
	private building = false;
	private started = false;
	private lastIndexedAt?: number;
	private rebuildPromise?: Promise<void>;
	private rebuildQueued = false;

	/** Fires after every completed rebuild or incremental file update. */
	readonly onDidChange: vscode.Event<IndexStats> = this.emitter.event;

	constructor() {
		this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.status.command = 'vscode-arxml-scope.rebuildIndex';
		this.disposables.push(this.status, this.emitter);
	}

	/** Starts the watcher and the first build. Does not await the build. */
	start(): void {
		if (this.started) {
			return;
		}
		this.started = true;
		const settings = indexSettings();
		if (settings.enabled) {
			this.startWatcher();
		}
		void this.rebuild();
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
		const entry = this.index.definitionEntry(definitionRef);
		return entry === undefined ? undefined : definitionInfo(entry);
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

	/** Reindexes exactly one file; used by the watcher and the extension API. */
	async reindexFile(uri: vscode.Uri): Promise<void> {
		const settings = indexSettings();
		if (!settings.enabled) {
			return;
		}
		try {
			const file = await readFileIndex(uri, settings.maxBytes);
			if (file === undefined) {
				this.skipped.add(uri.toString());
				this.index.remove(uri.toString());
			} else {
				this.skipped.delete(uri.toString());
				this.index.upsert(file);
			}
		} catch {
			// A file deleted between the watcher event and the read is not an error;
			// removing it keeps the index truthful.
			this.skipped.delete(uri.toString());
			this.index.remove(uri.toString());
		}
		this.lastIndexedAt = Date.now();
		this.publish();
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
			this.index.clear();
			this.skipped.clear();
			this.building = false;
			this.publish();
			return;
		}
		this.building = true;
		this.updateStatus();
		const uris = await vscode.workspace.findFiles('**/*.arxml');
		uris.sort((left, right) => left.toString().localeCompare(right.toString()));
		const files: FileIndex[] = [];
		const skipped = new Set<string>();
		for (const uri of uris) {
			try {
				const file = await readFileIndex(uri, settings.maxBytes);
				if (file === undefined) {
					skipped.add(uri.toString());
				} else {
					files.push(file);
				}
			} catch {
				skipped.add(uri.toString());
			}
		}
		this.index.replaceAll(files);
		this.skipped.clear();
		for (const uri of skipped) {
			this.skipped.add(uri);
		}
		this.building = false;
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
			this.watcher.onDidDelete((uri) => this.remove(uri)),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration('arxmlScope.index')) {
					void this.onConfigurationChanged();
				}
			})
		);
	}

	private schedule(uri: vscode.Uri): void {
		const key = uri.toString();
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
		const timer = this.pending.get(key);
		if (timer !== undefined) {
			clearTimeout(timer);
			this.pending.delete(key);
		}
		this.skipped.delete(key);
		if (this.index.remove(key)) {
			this.lastIndexedAt = Date.now();
			this.publish();
		}
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
		this.emitter.fire(this.index.stats());
	}

	private updateStatus(): void {
		const settings = indexSettings();
		const stats = this.index.stats();
		if (!settings.enabled || (!this.building && stats.files === 0)) {
			this.status.hide();
			this.status.text = '';
			return;
		}
		this.status.text = statusBarText(stats, this.building);
		const lines = [
			`${stats.files} file${stats.files === 1 ? '' : 's'} indexed`,
			`${stats.elements} elements, ${stats.references} references, ${stats.definitions} definitions`,
			`${stats.packages} packages`,
		];
		if (this.skipped.size > 0) {
			lines.push(`${this.skipped.size} file${this.skipped.size === 1 ? '' : 's'} skipped (size limit or unreadable)`);
		}
		if (this.lastIndexedAt !== undefined) {
			lines.push(`Updated ${new Date(this.lastIndexedAt).toLocaleTimeString()}`);
		}
		lines.push('Click to rebuild the workspace index.');
		this.status.tooltip = lines.join('\n');
		this.status.show();
	}
}
