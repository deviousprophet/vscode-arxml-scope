/**
 * Copies colocated component stylesheets next to their compiled modules.
 *
 * `tsc` does not emit `.css` files, but the compiled webview modules keep their
 * `require('./Component.css')`. The test host loads `out/**`, so the files must
 * exist there; `scripts/css-loader.cjs` then turns them into empty strings.
 */
const fs = require('fs');
const path = require('path');

const sourceRoot = path.join(__dirname, '..', 'src', 'webview');
const outputRoot = path.join(__dirname, '..', 'out', 'webview');

function copyTree(from, to) {
	if (!fs.existsSync(from)) {
		return 0;
	}
	let copied = 0;
	for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
		const source = path.join(from, entry.name);
		const target = path.join(to, entry.name);
		if (entry.isDirectory()) {
			copied += copyTree(source, target);
		} else if (entry.isFile() && entry.name.endsWith('.css')) {
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.copyFileSync(source, target);
			copied++;
		}
	}
	return copied;
}

const count = copyTree(sourceRoot, outputRoot);
console.log(`[css] copied ${count} webview stylesheet${count === 1 ? '' : 's'} to out/webview`);
