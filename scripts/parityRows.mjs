/**
 * Row/scan parity between the Rust engine and the TypeScript oracle.
 *
 * Test-only helper. Builds the oracle with esbuild, runs `arxml-cli rows` and
 * compares the two row stores structurally, reporting the first mismatch per file.
 *
 *   node scripts/parityRows.mjs            # every fixture, sort=all
 *   node scripts/parityRows.mjs basic      # fixtures whose path contains "basic"
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSync } from 'esbuild';

const root = process.cwd();
const filter = process.argv[2] ?? '';
const SORTS = ['all', 'declaration'];
const fixturesDir = path.join(root, 'src', 'test', 'fixtures');
const cli = path.join(root, 'rust', 'target', 'debug', process.platform === 'win32' ? 'arxml-cli.exe' : 'arxml-cli');

function fixtures() {
	return readdirSync(fixturesDir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.arxml'))
		.map((entry) => path.join(entry.parentPath ?? fixturesDir, entry.name))
		.sort();
}

function bundleOracle() {
	const dir = mkdtempSync(path.join(tmpdir(), 'arxml-parity-'));
	const outfile = path.join(dir, 'oracleRows.cjs');
	buildSync({
		entryPoints: [path.join(root, 'src', 'test', 'parity', 'oracleRows.ts')],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		outfile,
		logLevel: 'silent',
	});
	return { dir, outfile };
}

function mismatch(at, left, right) {
	return `${at || '<root>'}: ${JSON.stringify(left)} !== ${JSON.stringify(right)}`;
}

function isContainer(value) {
	return value !== null && typeof value === 'object';
}

function isPrimitivePair(left, right) {
	return !isContainer(left) || !isContainer(right);
}

function isSameContainerKind(left, right) {
	return Array.isArray(left) === Array.isArray(right);
}

function compare(left, right, at = '') {
	if (left === right) return undefined;
	if (isPrimitivePair(left, right)) return compareMixed(left, right, at);
	return compareContainer(left, right, at);
}

function compareMixed(left, right, at) {
	if (!isSameContainerKind(left, right)) return mismatch(at, left, right);
	return compareContainer(left, right, at);
}

function compareContainer(left, right, at) {
	return Array.isArray(left) ? compareArray(left, right, at) : compareObject(left, right, at);
}

function compareArray(left, right, at) {
	if (!isArrayPair(left, right)) return `${at}: array mismatch`;
	if (left.length !== right.length) return `${at}.length: ${left.length} !== ${right.length}`;
	return compareItems(left, right, at);
}

function compareItems(left, right, at) {
	for (let index = 0; index < left.length; index++) {
		const found = compare(left[index], right[index], `${at}[${index}]`);
		if (found) return found;
	}
	return undefined;
}

function compareObject(left, right, at) {
	for (const key of unionKeys(left, right)) {
		const found = compare(left[key], right[key], joinKey(at, key));
		if (found) return found;
	}
	return undefined;
}

function isArrayPair(left, right) {
	return Array.isArray(left) && Array.isArray(right);
}

function unionKeys(left, right) {
	return new Set([...Object.keys(left), ...Object.keys(right)]);
}

function joinKey(at, key) {
	return at ? `${at}.${key}` : key;
}

const { dir, outfile } = bundleOracle();
let failures = 0;
let checked = 0;
try {
	for (const file of fixtures()) {
		const relative = path.relative(root, file).replaceAll('\\', '/');
		if (filter && !relative.includes(filter)) continue;
		checked++;
		for (const sort of SORTS) {
			const expected = JSON.parse(
				execFileSync(process.execPath, [outfile, file, sort], {
					encoding: 'utf8',
					maxBuffer: 256 * 1024 * 1024,
				})
			);
			let actual;
			try {
				actual = JSON.parse(
					execFileSync(cli, ['rows', '--file', file, '--sort', sort], {
						encoding: 'utf8',
						maxBuffer: 256 * 1024 * 1024,
					})
				);
			} catch (error) {
				console.log(`FAIL ${relative} [${sort}]: engine failed: ${error.message}`);
				failures++;
				continue;
			}
			const mismatch = compare(expected, actual);
			if (mismatch) {
				failures++;
				console.log(`FAIL ${relative} [${sort}]: ${mismatch}`);
			} else {
				console.log(`ok   ${relative} [${sort}] (${actual.length} rows)`);
			}
		}
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${checked * SORTS.length - failures}/${checked * SORTS.length} fixture/sort combinations matched`);
process.exit(failures === 0 ? 0 : 1);
