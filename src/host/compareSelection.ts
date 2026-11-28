/**
 * The session-only first-file stash for the compare commands.
 *
 * The stash is deliberately not persisted: it belongs to one window session, and
 * the manifest's `arxmlScope.hasCompareSelection` context key is derived from it.
 */
import * as path from 'path';
import * as vscode from 'vscode';

const COMPARE_SELECTION_CONTEXT = 'arxmlScope.hasCompareSelection';

/** The basename used in titles, messages and labels. */
export function fileName(uri: vscode.Uri): string {
	return path.basename(uri.fsPath);
}

/** Whether a stat failure means the path is gone, as opposed to unreadable. */
export function isMissingFileError(error: unknown): boolean {
	return (
		error instanceof vscode.FileSystemError &&
		(error.code === 'FileNotFound' || error.code === 'EntryNotFound')
	);
}

/**
 * Why the stashed first file cannot be compared, or `undefined` when it is
 * readable. A deleted path is named as such; any other failure keeps its
 * detail instead of claiming the file no longer exists.
 */
export async function firstFileProblem(uri: vscode.Uri): Promise<string | undefined> {
	try {
		await vscode.workspace.fs.stat(uri);
		return undefined;
	} catch (error) {
		if (isMissingFileError(error)) {
			return `Cannot compare: "${fileName(uri)}" no longer exists. Select it again as the first file.`;
		}
		const detail = error instanceof Error ? error.message : String(error);
		return `Cannot compare: "${fileName(uri)}" cannot be read (${detail}). Select it again as the first file.`;
	}
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
