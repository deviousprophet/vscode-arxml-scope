/**
 * The extension's copied-row registry.
 *
 * `core/copy/copyDirty` owns the state; this module owns the VS Code binding:
 * one registry for the extension host, following document edits and saves so a
 * panel and an editor page never disagree about which rows a copy left dirty.
 */
import * as vscode from 'vscode';
import { CopyDirtyStore } from '../core/copy/copyDirty';
import type { CopyRecord } from '../core/copy/copyDirty';

const store = new CopyDirtyStore();
const changed = new vscode.EventEmitter<string>();

/** Rows that a merge copy wrote and the user has not saved yet, per document URI. */
export const copyDirty = {
	/** Records one applied copy; pages that show the target document re-read their rows. */
	record(uri: vscode.Uri, record: CopyRecord): void {
		store.record(uri.toString(), record);
		changed.fire(uri.toString());
	},

	/** The row keys one open document marks as copied-dirty. */
	keys(uri: vscode.Uri): string[] {
		return store.keys(uri.toString());
	},

	/** Fires with the document URI whose copied-dirty rows changed. */
	onDidChange: changed.event,

	/**
	 * Registers the document listeners once. A change that overlaps a copied
	 * span (an undo, or typing over the copied text) drops the marker; a save
	 * clears the document; a closed buffer loses its copies.
	 */
	watch(context: vscode.ExtensionContext): void {
		context.subscriptions.push(
			vscode.workspace.onDidChangeTextDocument((event) => {
				const key = event.document.uri.toString();
				const offsets = event.contentChanges.map((change) => ({
					start: change.rangeOffset,
					end: change.rangeOffset + change.rangeLength,
					text: change.text
				}));
				if (store.applyChange(key, offsets, event.document.version)) {
					changed.fire(key);
				}
			}),
			vscode.workspace.onDidSaveTextDocument((saved) => {
				if (store.clear(saved.uri.toString())) {
					changed.fire(saved.uri.toString());
				}
			}),
			vscode.workspace.onDidCloseTextDocument((closed) => {
				store.forget(closed.uri.toString());
			}),
			changed
		);
	}
};
