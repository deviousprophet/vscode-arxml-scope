import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	mocha: {
		// The extension-host suites drive real documents, edits and undo; several
		// wait up to 5s for the platform. Mocha's 2s default made those waits flaky.
		timeout: 10000,
		// Webview modules import their colocated CSS; the compiled test tree has no
		// CSS loader, so the hook swallows those requires and mirrors the files.
		require: ['./out/test/webview/cssImportHook.js'],
	},
});
