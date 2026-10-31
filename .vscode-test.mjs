import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	mocha: {
		// The extension-host suites drive real documents, edits and undo; several
		// wait up to 5s for the platform. Mocha's 2s default made those waits flaky.
		timeout: 10000,
		require: ['./scripts/css-loader.cjs'],
	},
});
