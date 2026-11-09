import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const root = process.cwd();
const fixturesDir = path.join(root, 'src', 'test', 'fixtures');
const update = process.argv.includes('--update');
const allowMissingRust = process.argv.includes('--allow-missing-rust');

function discover(dir) {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.arxml'))
		.map((entry) => path.join(entry.parentPath ?? dir, entry.name))
		.sort();
}

function typescriptManifest() {
	const fixtures = discover(fixturesDir).map((file) => {
		const bytes = readFileSync(file);
		return {
			path: path.relative(fixturesDir, file).replaceAll('\\', '/'),
			bytes: statSync(file).size,
			sha256: createHash('sha256').update(bytes).digest('hex'),
		};
	});
	return { fixtures };
}

function canonical(manifest) {
	return `${JSON.stringify(manifest, null, 2)}\n`;
}

function runCargoManifest() {
	return spawnSync(
		'cargo',
		[
			'run',
			'--quiet',
			'--manifest-path',
			'rust/Cargo.toml',
			'-p',
			'arxml-cli',
			'--',
			'fixture-manifest',
			'--dir',
			fixturesDir,
		],
		{ cwd: root, encoding: 'utf8', shell: false }
	);
}

function isMissingCargo(result) {
	return result.error?.code === 'ENOENT';
}

function assertCargoStatus(result) {
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || `cargo exited with ${result.status}`);
	}
}

function rustManifest() {
	const result = runCargoManifest();
	if (isMissingCargo(result)) {
		return { skipped: true };
	}
	assertCargoStatus(result);
	return { text: result.stdout.trim() };
}

function writeUpdateReport(manifest) {
	mkdirSync(path.join(root, 'out'), { recursive: true });
	const report = path.join(root, 'out', 'parity-ts-manifest.json');
	writeFileSync(report, canonical(manifest), 'utf8');
	console.log(JSON.stringify({ _type: 'parity', update: path.relative(root, report).replaceAll('\\', '/') }));
}

function requireRustManifest() {
	const rust = rustManifest();
	if (rust.skipped && !allowMissingRust) {
		throw new Error(
			'cargo was not found; Rust parity is required (use --allow-missing-rust only for a local check)'
		);
	}
	return rust;
}

function compareManifests(tsFirst, rustText) {
	if (canonical(tsFirst) !== `${rustText}\n`) {
		throw new Error('the TypeScript and Rust manifests are not byte-identical');
	}
	const rustParsed = JSON.parse(rustText);
	if (!isDeepStrictEqual(tsFirst, rustParsed)) {
		const tsLines = canonical(tsFirst).split('\n');
		const rustLines = canonical(rustParsed).split('\n');
		const at = tsLines.findIndex((line, index) => line !== rustLines[index]);
		throw new Error(
			`TypeScript and Rust fixture manifests differ at line ${at + 1}:\nTS: ${tsLines[at]}\nRust: ${rustLines[at]}`
		);
	}
	const bytes = tsFirst.fixtures.reduce((total, fixture) => total + fixture.bytes, 0);
	console.log(
		JSON.stringify({
			_type: 'parity',
			fixtures: tsFirst.fixtures.length,
			bytes,
			manifestComparison: 'ok',
			behavioralParity: 'later port child',
		})
	);
}

function assertSame(label, first, second) {
	if (first !== second) {
		throw new Error(`the ${label} manifest is not deterministic`);
	}
}

function main() {
	const tsFirst = typescriptManifest();
	assertSame('TypeScript', canonical(tsFirst), canonical(typescriptManifest()));
	if (update) {
		writeUpdateReport(tsFirst);
		return;
	}
	const rustFirst = requireRustManifest();
	if (rustFirst.skipped) {
		console.log(JSON.stringify({ _type: 'parity', skipped: 'cargo not found; Rust parity not run' }));
		return;
	}
	const rustSecond = rustManifest();
	assertSame('Rust', rustFirst.text, rustSecond.text);
	compareManifests(tsFirst, rustFirst.text);
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
