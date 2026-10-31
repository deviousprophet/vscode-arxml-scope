// Compiled tests run as CJS in Node/Electron and require() webview modules that
// carry side-effect CSS imports. Node has no .css loader, and tsc does not copy
// .css assets, so:
//  1. teach require() to swallow .css (no-op handler)
//  2. mirror every src/webview/**/*.css into the compiled out/webview tree so
//     relative `require('./X.css')` resolution succeeds.
// The walk is dynamic: new component stylesheets are picked up with no change.
// `.vscode-test.mjs` requires this module before any test file loads.
import * as fs from 'fs';
import * as path from 'path';

const nodeRequire = require as unknown as {
	extensions: Record<string, (module: unknown, filename: string) => void>;
};

if (!nodeRequire.extensions['.css']) {
	nodeRequire.extensions['.css'] = () => {};
}
const srcWebview = path.resolve(__dirname, '..', '..', '..', 'src', 'webview');
const outWebview = path.resolve(__dirname, '..', '..', 'webview');

function mirrorCss(dir: string): void {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			mirrorCss(full);
		} else if (entry.isFile() && full.endsWith('.css')) {
			const target = path.join(outWebview, path.relative(srcWebview, full));
			fs.mkdirSync(path.dirname(target), { recursive: true });
			if (!fs.existsSync(target)) {
				fs.writeFileSync(target, '');
			}
		}
	}
}

mirrorCss(srcWebview);
