/**
 * Packaging gate: the webview scripts must survive the production build.
 *
 * renderHtml.ts / renderDiffHtml.ts / virtualScroll.ts / ecucDetailsEditor.ts /
 * rowView.ts inject page logic via `Function.prototype.toString()`. If the
 * bundler renames those declarations (e.g. identifier minification), the page's
 * own code still calls the original names and the installed VSIX dies at boot
 * with `ReferenceError`. The dev build never catches this because it is not
 * minified — this script bundles with the production flags and boots the
 * extracted scripts in a stub DOM.
 *
 * Exit 0 = both pages booted; exit 1 = a page would be dead in the installed VSIX.
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

function boot(src, label, payload) {
	const stub = anything();
	const documentStub = payload
		? new Proxy(stub, {
				get(_target, property) {
					if (property === 'getElementById') {
						return (id) => (id === payload.id ? { textContent: payload.text } : anything());
					}
					return anything();
				},
			})
		: stub;
	const sandbox = {
		document: documentStub,
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

/** The escaped JSON the page parses as its initial model. */
function embeddedJson(html, id) {
	const match = new RegExp(`<script type="application/json" id="${id}"[^>]*>([\\s\\S]*?)</script>`).exec(html);
	if (!match) {
		throw new Error(`the rendered page has no ${id} JSON block`);
	}
	return { id, text: match[1] };
}

(async () => {
	const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'arxml-boot-'));
	const outfile = path.join(outdir, 'probe.js');
	await esbuild.build({
		stdin: {
			contents: [
				"export { renderHtml } from './src/editor/renderHtml';",
				"export { renderDiffHtml } from './src/diff/diffPage';",
				"export { buildDiffDocument } from './src/diff/diffModel';",
				"export { buildRows } from './src/editor/renderRows';",
				"export { scanEcucValues } from './src/core/ecuc/scanner';",
			].join('\n'),
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
	const { renderHtml, renderDiffHtml, buildDiffDocument, buildRows, scanEcucValues } = require(outfile);

	const editorFixture = path.join(repo, 'src/test/fixtures/editor/render.arxml');
	const editorHtml = renderHtml(scanEcucValues(fs.readFileSync(editorFixture, 'utf8')), {
		sort: 'all',
		sortExcept: [],
		nonce: 'boot-check',
	});
	const editorScripts = [...editorHtml.matchAll(/<script nonce="boot-check">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
	if (editorScripts.length === 0) {
		throw new Error('no inline script found in the rendered editor page');
	}
	editorScripts.forEach((src, i) => boot(src, `editor-webview-script-${i}`));

	const left = scanEcucValues(fs.readFileSync(path.join(repo, 'src/test/fixtures/diff/left.arxml'), 'utf8'));
	const right = scanEcucValues(fs.readFileSync(path.join(repo, 'src/test/fixtures/diff/right.arxml'), 'utf8'));
	const options = { sort: 'all', sortExcept: [] };
	const diffDocument = buildDiffDocument(
		{ name: 'left.arxml', path: path.join(repo, 'src/test/fixtures/diff/left.arxml') },
		{ name: 'right.arxml', path: path.join(repo, 'src/test/fixtures/diff/right.arxml') },
		buildRows(left, options).rows,
		buildRows(right, options).rows
	);
	const diffHtml = renderDiffHtml(diffDocument, { nonce: 'boot-check' });
	const diffScripts = [...diffHtml.matchAll(/<script nonce="boot-check">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
	if (diffScripts.length === 0) {
		throw new Error('no inline script found in the rendered diff page');
	}
	const diffPayload = embeddedJson(diffHtml, 'diff-document');
	if (JSON.parse(diffPayload.text).rows.length === 0) {
		throw new Error('the rendered diff page embeds no rows');
	}
	diffScripts.forEach((src, i) => boot(src, `diff-webview-script-${i}`, diffPayload));

	// Guard against a vacuous success: each rendered page must contain the panel
	// this gate claims to boot.
	for (const marker of ['id="tree"', 'id="sidebar"', 'id="sidebar-resizer"', 'id="side-tabs"']) {
		if (!editorHtml.includes(marker)) {
			throw new Error(`rendered editor page is missing ${marker}`);
		}
	}
	// The sidebar shell is injected via toString(); keep the page's own entry
	// points so a bundler rename is caught before the VSIX ships a dead sidebar.
	for (const marker of ['function mountSidebarShell', 'function activateSidebarTab', 'class SidebarPaneView']) {
		if (!editorHtml.includes(marker)) {
			throw new Error(`rendered editor page is missing ${marker}`);
		}
	}
	if (!diffHtml.includes('id="diff-list"')) {
		throw new Error('rendered diff page is missing id="diff-list"');
	}
	fs.rmSync(outdir, { recursive: true, force: true });
	console.log('webview boot check: OK (editor + diff)');
})().catch((error) => {
	console.error('webview boot check: FAILED');
	console.error(error);
	process.exit(1);
});
