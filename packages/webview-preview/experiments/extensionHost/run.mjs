/**
 * Extension-host spike, part 1.
 *
 * Uses the official `@vscode/test-electron` runner (the engine behind
 * `@vscode/test-cli`) to launch this extension in a real VS Code window with a
 * remote-debugging port. The extension test opens a real diff webview, then
 * spawns `cdpCapture.mjs`, which attaches official Playwright over CDP and tries
 * to reach the webview frame.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const outDir = path.resolve(repoRoot, '.out', 'extension-host');
const workspace = mkdtempSync(path.join(tmpdir(), 'webview-preview-ext-ws-'));
const userData = mkdtempSync(path.join(tmpdir(), 'webview-preview-ext-profile-'));
const port = process.env.PREVIEW_CDP_PORT ?? '9222';

const executable =
	process.env.VSCODE_EXE ??
	path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe');

mkdirSync(outDir, { recursive: true });
cpSync(path.join(repoRoot, 'src', 'test', 'fixtures', 'diff', 'left.arxml'), path.join(workspace, 'left.arxml'));
cpSync(path.join(repoRoot, 'src', 'test', 'fixtures', 'diff', 'right.arxml'), path.join(workspace, 'right.arxml'));

try {
	await runTests({
		vscodeExecutablePath: executable,
		extensionDevelopmentPath: repoRoot,
		extensionTestsPath: path.join(here, 'suite.cjs'),
		launchArgs: [
			workspace,
			'--disable-workspace-trust',
			'--disable-extensions',
			`--remote-debugging-port=${port}`,
			`--user-data-dir=${userData}`
		],
		extensionTestsEnv: {
			PREVIEW_OUT: outDir,
			PREVIEW_CDP_PORT: port,
			PREVIEW_WORKSPACE: workspace
		}
	});
	console.log(JSON.stringify({ _type: 'extension-host-spike', ok: true, outDir, port }));
} catch (error) {
	console.error(`extension-host spike failed: ${error instanceof Error ? error.stack : String(error)}`);
	process.exitCode = 1;
} finally {
	rmSync(workspace, { recursive: true, force: true });
	rmSync(userData, { recursive: true, force: true });
}
