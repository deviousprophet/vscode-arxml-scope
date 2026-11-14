/**
 * Strict-diff parity between the Rust engine and the TypeScript oracle.
 *
 * Test-only. Builds the oracle with esbuild, then compares `arxml-cli diff` with it
 * for a set of meaningful pairs (every fixture against itself, plus edited pairs).
 *
 *   node scripts/parityDiff.mjs [filter]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { buildSync } from 'esbuild';
import { fixtures } from './parityFixtures.mjs';

const root = process.cwd();
const filter = process.argv[2] ?? '';
const fixturesDir = path.join(root, 'src', 'test', 'fixtures');
const cli = path.join(root, 'rust', 'target', 'debug', process.platform === 'win32' ? 'arxml-cli.exe' : 'arxml-cli');

function runs() {
	return [
		{ label: 'strict  ', args: [], cli: [] },
		{ label: 'semantic', args: ['semantic'], cli: ['--semantic'] },
		{ label: 'budget 1', args: ['semantic', '1'], cli: ['--semantic', '--budget', '1'] }
	];
}

function pairs(files) {
	const out = files.map((file) => [file, file]);
	const named = [
		['diff/left.arxml', 'diff/right.arxml'],
		['editing/container.arxml', 'editing/container-ref.expected.arxml'],
		['editing/numeric.arxml', 'editing/numeric.expected.arxml'],
		['editing/self-closing.arxml', 'editing/self-closing.expected.arxml'],
		['editing/escaping.arxml', 'editing/escaping.expected.arxml'],
		['editing/textual.arxml', 'editing/textual.expected.arxml'],
		['semantic/rename.left.arxml', 'semantic/rename.right.arxml'],
		['semantic/embed.left.arxml', 'semantic/embed.right.arxml'],
		['semantic/empty.left.arxml', 'semantic/empty.right.arxml'],
		['semantic/large.left.arxml', 'semantic/large.right.arxml'],
		['basic.arxml', 'deep.arxml'],
		['exceptions.arxml', 'formatting.arxml']
	];
	for (const [left, right] of named) {
		out.push([path.join(fixturesDir, left), path.join(fixturesDir, right)]);
	}
	return out
		.filter(([left, right]) => existsSync(left) && existsSync(right))
		.filter(([left, right]) => filter === '' || left.includes(filter) || right.includes(filter));
}

function bundleOracle() {
	const dir = mkdtempSync(path.join(tmpdir(), 'arxml-diff-parity-'));
	const outfile = path.join(dir, 'oracleDiff.cjs');
	buildSync({
		entryPoints: [path.join(root, 'src', 'test', 'parity', 'oracleDiff.ts')],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		outfile,
		logLevel: 'silent'
	});
	return { dir, outfile };
}

function isRecord(value) {
	return value !== null && typeof value === 'object';
}

function arrayShapeMismatch(left, right, at) {
	if (!Array.isArray(left) || !Array.isArray(right)) {
		return `${at}: array mismatch`;
	}
	return left.length === right.length ? undefined : `${at}.length: ${left.length} !== ${right.length}`;
}

function compareArrays(left, right, at) {
	const shape = arrayShapeMismatch(left, right, at);
	if (shape !== undefined) {
		return shape;
	}
	for (let index = 0; index < left.length; index++) {
		const found = firstDifference(left[index], right[index], `${at}[${index}]`);
		if (found) return found;
	}
	return undefined;
}

function eitherArray(left, right) {
	return Array.isArray(left) || Array.isArray(right);
}

function compareObjects(left, right, at) {
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	for (const key of keys) {
		const found = firstDifference(left[key], right[key], at ? `${at}.${key}` : key);
		if (found) return found;
	}
	return undefined;
}

function eitherNotRecord(left, right) {
	return !isRecord(left) || !isRecord(right);
}

function firstDifference(left, right, at = '') {
	if (isDeepStrictEqual(left, right)) {
		return undefined;
	}
	if (eitherArray(left, right)) {
		return compareArrays(left, right, at);
	}
	if (eitherNotRecord(left, right)) {
		return `${at}: ${JSON.stringify(left)} !== ${JSON.stringify(right)}`;
	}
	return compareObjects(left, right, at);
}

const { dir, outfile } = bundleOracle();
let checked = 0;
let failures = 0;
try {
	for (const [left, right] of pairs(fixtures(fixturesDir))) {
		const name = `${path.relative(fixturesDir, left)} ↔ ${path.relative(fixturesDir, right)}`;
		for (const run of runs()) {
			checked++;
			const expected = JSON.parse(
				execFileSync(process.execPath, [outfile, left, right, ...run.args], {
					encoding: 'utf8',
					maxBuffer: 256 * 1024 * 1024
				})
			);
			const actual = JSON.parse(
				execFileSync(cli, ['diff', '--left', left, '--right', right, ...run.cli], {
					encoding: 'utf8',
					maxBuffer: 256 * 1024 * 1024
				})
			);
			const mismatch = firstDifference(expected, actual);
			if (mismatch) {
				failures++;
				console.log(`FAIL ${run.label} ${name}: ${mismatch}`);
			} else {
				console.log(`ok   ${run.label} ${name} (${actual.rows.length} rows)`);
			}
		}
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${checked - failures}/${checked} diff pairs matched`);
process.exit(failures === 0 ? 0 : 1);
