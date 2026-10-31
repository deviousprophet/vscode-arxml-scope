import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineConfig } from '@vscode/test-cli';

// Open a disposable temp dir (not the repository) as the test workspace so the
// extension never writes into the checkout. It is removed on exit; the OS temp
// cleaner is only the fallback if the process is killed.
const ws = mkdtempSync(join(tmpdir(), 'arxml-scope-test-ws-'));
// `pathToFileURL` is the one form that is right on both platforms: hand-built
// concatenation yields `file:////tmp/...` on POSIX.
const workspaceUri = pathToFileURL(ws).href;

export default defineConfig({
	files: 'out/test/**/*.test.js',
	launchArgs: ['--disable-workspace-trust', '--folder-uri', workspaceUri],
	mocha: {
		// The extension-host suites drive real documents, edits and undo; several
		// wait up to 5s for the platform. Mocha's 2s default made those waits flaky.
		timeout: 10000,
		// Webview modules import their colocated CSS; the compiled test tree has no
		// CSS loader, so the hook swallows those requires and mirrors the files.
		require: ['./out/test/webview/cssImportHook.js'],
	},
});

process.on('exit', () => { try { rmSync(ws, { recursive: true, force: true }); } catch { /* best-effort */ } });
