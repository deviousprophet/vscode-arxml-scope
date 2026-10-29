/**
 * Packaging gate: the webview script must survive the production build.
 *
 * renderHtml.ts / virtualScroll.ts / ecucDetailsEditor.ts inject page logic via
 * `Function.prototype.toString()`. If the bundler renames those declarations
 * (e.g. identifier minification), the page's own code still calls the original
 * names and the installed VSIX dies at boot with `ReferenceError`. The dev
 * build never catches this because it is not minified — this script bundles
 * with the production flags and boots the extracted script in a stub DOM.
 *
 * Exit 0 = booted; exit 1 = the page would be dead in the installed VSIX.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const esbuild = require('esbuild');

const repo = path.join(__dirname, '..');

/** A DOM stub tolerant enough that only genuine errors (e.g. ReferenceError) throw. */
function anything() {
	return new Proxy(function () {}, {
		get(_t, p) {
			if (p === Symbol.toPrimitive) return () => '';
			return anything();
		},
		set: () => true,
		apply: () => anything(),
		construct: () => anything(),
	});
}

function boot(src, label) {
	const stub = anything();
	const sandbox = {
		document: stub,
		window: stub,
		acquireVsCodeApi: () => ({ getState: () => ({}), setState: () => {}, postMessage: () => {} }),
		getComputedStyle: () => anything(),
		requestAnimationFrame: () => 0,
		cancelAnimationFrame: () => {},
		setTimeout: () => 0,
		clearTimeout: () => {},
		console,
	};
	vm.runInNewContext(src, sandbox, { filename: label });
}

(async () => {
	const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'arxml-boot-'));
	const outfile = path.join(outdir, 'probe.js');
	await esbuild.build({
		stdin: {
			contents:
				"export { renderHtml } from './src/editor/renderHtml'; export { scanEcucValues } from './src/core/ecuc/scanner';",
			resolveDir: repo,
			sourcefile: 'probe.ts',
			loader: 'ts',
		},
		bundle: true,
		format: 'cjs',
		// The production flags from esbuild.js — this is the pipeline being guarded.
		minifyWhitespace: true,
		minifySyntax: true,
		minifyIdentifiers: false,
		platform: 'node',
		outfile,
		external: ['vscode'],
		logLevel: 'error',
	});
	const { renderHtml, scanEcucValues } = require(outfile);
	const fixture = path.join(repo, 'src/test/fixtures/editor/render.arxml');
	const model = scanEcucValues(fs.readFileSync(fixture, 'utf8'));
	const html = renderHtml(model, { sort: 'all', sortExcept: [], nonce: 'boot-check' });
	const scripts = [...html.matchAll(/<script nonce="boot-check">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
	if (scripts.length === 0) {
		throw new Error('no inline script found in rendered page');
	}
	scripts.forEach((src, i) => boot(src, `webview-script-${i}`));
	fs.rmSync(outdir, { recursive: true, force: true });
	console.log('webview boot check: OK');
})().catch((error) => {
	console.error('webview boot check: FAILED');
	console.error(error);
	process.exit(1);
});

