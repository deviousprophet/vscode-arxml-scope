const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

/**
 * The extension host imports webview components for their static HTML builders.
 * Those modules carry side-effect CSS imports that only the browser bundles need;
 * stub them for the Node bundle so no CSS artifact is emitted beside extension.js.
 * @type {import('esbuild').Plugin}
 */
const ignoreCssPlugin = {
	name: 'ignore-css',
	setup(build) {
		build.onResolve({ filter: /\.css$/ }, args => ({
			path: args.path,
			namespace: 'ignore-css',
		}));
		build.onLoad({ filter: /.*/, namespace: 'ignore-css' }, () => ({
			contents: '',
			loader: 'js',
		}));
	},
};

async function main() {
	// Extension host bundle
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			ignoreCssPlugin,
			esbuildProblemMatcherPlugin,
		],
	});

	// Editor webview bundle: a real browser IIFE. Component CSS is emitted as
	// dist/editorViewer.css next to the script and loaded through asWebviewUri.
	const ctxEditor = await esbuild.context({
		entryPoints: [
			'src/webview/editorViewer.ts'
		],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outfile: 'dist/editorViewer.js',
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});

	// Diff webview bundle: independent page, same shared components and CSS.
	const ctxDiff = await esbuild.context({
		entryPoints: [
			'src/webview/diffViewer.ts'
		],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outfile: 'dist/diffViewer.js',
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});

	if (watch) {
		await Promise.all([ctx.watch(), ctxEditor.watch(), ctxDiff.watch()]);
	} else {
		await ctx.rebuild();
		await ctxEditor.rebuild();
		await ctxDiff.rebuild();
		await Promise.all([ctx.dispose(), ctxEditor.dispose(), ctxDiff.dispose()]);
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
