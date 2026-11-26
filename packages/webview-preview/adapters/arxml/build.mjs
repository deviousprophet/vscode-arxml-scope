/**
 * ARXML adapter build: turn the existing preview page source into static assets
 * under `.out/arxml`. The standalone core only ever sees this output directory.
 *
 * This is the one place that is allowed to import extension source, and it runs
 * as a separate build command before the core starts.
 */
import { buildSync } from 'esbuild';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const packageRoot = path.resolve(here, '../..');
const skillDir = path.join(repoRoot, '.agents', 'skills', 'webview-preview');
const outDir = path.join(packageRoot, '.out', 'arxml');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Browser bundle: the real preview page, including Monaco and its CSS/fonts.
buildSync({
	entryPoints: [path.join(skillDir, 'preview', 'previewPage.ts')],
	bundle: true,
	platform: 'browser',
	format: 'iife',
	outfile: path.join(outDir, 'preview.js'),
	loader: { '.ttf': 'file' },
	assetNames: 'assets/[name]-[hash]',
	logLevel: 'silent'
});

// Node bundle: fixtures + shell builders, used once to emit one HTML per state.
const tempDir = mkdtempSync(path.join(tmpdir(), 'arxml-preview-build-'));
const dataFile = path.join(tempDir, 'previewData.cjs');
try {
	buildSync({
		entryPoints: [path.join(skillDir, 'preview', 'previewData.ts')],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		outfile: dataFile,
		logLevel: 'silent'
	});
	const require = createRequire(import.meta.url);
	const data = require(dataFile);
	const states = data.STATES.map((state) => {
		const entry = `${state.name}.html`;
		writeFileSync(path.join(outDir, entry), data.previewHtml(state));
		return {
			name: state.name,
			width: state.width,
			height: state.height,
			entry,
			page: state.page
		};
	});
	const worker = path.join(repoRoot, 'dist', 'monaco.worker.js');
	if (!existsSync(worker)) {
		throw new Error(`missing ${worker}; run "node esbuild.js" in the repository root first`);
	}
	copyFileSync(worker, path.join(outDir, 'monaco.worker.js'));
	writeFileSync(
		path.join(outDir, 'manifest.json'),
		`${JSON.stringify({ generatedAt: new Date().toISOString(), states }, null, 2)}\n`
	);
	console.log(
		JSON.stringify({
			_type: 'arxml-preview-build',
			outDir,
			states: states.length,
			assets: ['preview.js', 'preview.css', 'monaco.worker.js', 'assets/']
		})
	);
} finally {
	rmSync(tempDir, { recursive: true, force: true });
}
