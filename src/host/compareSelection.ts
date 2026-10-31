/**
 * The session-only first-file stash for the compare commands (task design §4.2).
 *
 * The stash is deliberately not persisted: it belongs to one window session, and
 * the manifest's `arxmlScope.hasCompareSelection` context key is derived from it.
 */
import * as path from 'path';
import * as vscode from 'vscode';

export const COMPARE_SELECTION_CONTEXT = 'arxmlScope.hasCompareSelection';

/** The basename used in titles, messages and labels. */
export function fileName(uri: vscode.Uri): string {
	return path.basename(uri.fsPath);
}

/** A session-only stash of the left/first compare candidate. */
export class CompareSelectionStore {
	private selection: vscode.Uri | null = null;

	public get(): vscode.Uri | null {
		return this.selection;
	}

	public set(uri: vscode.Uri): void {
		this.selection = uri;
		void vscode.commands.executeCommand('setContext', COMPARE_SELECTION_CONTEXT, true);
	}

	public clear(): void {
		this.selection = null;
		void vscode.commands.executeCommand('setContext', COMPARE_SELECTION_CONTEXT, false);
	}
}
