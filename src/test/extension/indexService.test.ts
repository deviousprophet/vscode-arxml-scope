/**
 * The rebuild/read race at the extension boundary.
 *
 * A file read that starts before a rebuild and finishes after the rebuild's
 * snapshot must not apply its older result. The injected reader holds the first
 * read open so the ordering is deterministic.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';

import type { FileIndex } from '../../core/index/indexModel';
import { IndexService } from '../../host/indexService';

function fileOf(uri: string, label: string): FileIndex {
	return {
		uri,
		packages: [],
		elements: [
			{
				kind: 'container',
				path: `/Race/${label}`,
				shortName: label,
				file: uri,
				range: { start: 0, end: 1 },
			},
		],
		references: [],
		definitions: [],
	};
}

async function waitForRelease(current: () => (() => void) | undefined): Promise<() => void> {
	while (true) {
		const release = current();
		if (release) {
			return release;
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

async function waitForNewElement(service: IndexService): Promise<void> {
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline && service.workspaceIndex.element('/Race/NEW') === undefined) {
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

suite('index service rebuild race (extension)', function () {
	this.timeout(20000);

	test('a read that started before a rebuild cannot overwrite the snapshot', async () => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(folder, 'the test host has a workspace folder');
		const uri = vscode.Uri.joinPath(folder!.uri, `index-race-${Date.now()}.arxml`);
		fs.writeFileSync(uri.fsPath, '<AUTOSAR/>');
		let calls = 0;
		let pendingRelease: (() => void) | undefined;
		const service = new IndexService(async (readUri) => {
			if (readUri.toString() !== uri.toString()) {
				return undefined;
			}
			calls++;
			if (calls === 1) {
				await new Promise<void>((resolve) => {
					pendingRelease = resolve;
				});
				return fileOf(readUri.toString(), 'OLD');
			}
			return fileOf(readUri.toString(), 'NEW');
		});
		try {
			const first = service.reindexFile(uri, false);
			const release = await waitForRelease(() => pendingRelease);
			await service.rebuild();
			release();
			await first;
			// The stale read schedules its own retry; wait for the new content.
			await waitForNewElement(service);
			assert.strictEqual(service.workspaceIndex.element('/Race/OLD'), undefined);
			assert.strictEqual(service.workspaceIndex.element('/Race/NEW')?.shortName, 'NEW');
		} finally {
			service.dispose();
			fs.rmSync(uri.fsPath, { force: true });
		}
	});
});
