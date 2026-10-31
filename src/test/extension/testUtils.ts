/**
 * Shared helpers for the editor integration tests. Test-only: nothing here is
 * imported by `src/editor/**`.
 */
import * as path from 'path';
import * as vscode from 'vscode';

export const repoRoot = path.resolve(__dirname, '..', '..', '..');

/** A committed synthetic fixture. */
export function fixtureUri(name: string): vscode.Uri {
	return vscode.Uri.file(path.join(repoRoot, 'src', 'test', 'fixtures', name));
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The `viewType` of the active tab when it is a custom editor, else `undefined`. */
export function activeViewType(): string | undefined {
	const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	return input instanceof vscode.TabInputCustom ? input.viewType : undefined;
}
