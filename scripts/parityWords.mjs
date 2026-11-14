/**
 * Word-diff parity between the Rust engine and the TypeScript implementation.
 *
 * Test-only. Builds the oracle with esbuild, then compares `arxml-cli words` with it
 * for hand-written edge cases plus every changed field the fixtures produce.
 *
 *   node scripts/parityWords.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { buildSync } from 'esbuild';

const root = process.cwd();
const fixturesDir = path.join(root, 'src', 'test', 'fixtures');
const cli = path.join(root, 'rust', 'target', 'debug', process.platform === 'win32' ? 'arxml-cli.exe' : 'arxml-cli');

const edges = [
	['', ''],
	['', 'Added'],
	['Gone', ''],
	['Timeout', 'Timeout'],
	['Timeout 100', 'Timeout 200'],
	['(a)', '(b)'],
	['/Pkg/Diff', '/Pkg/Other'],
	['/Pkg/Diff', '/PkgX/Diff'],
	['a  b', 'a b'],
	['0x1F', '0x2F'],
	['é value', 'e value'],
	['a😀b', 'a😀c'],
	['a b c', 'a c b'],
	['x/y/z', 'x/y'],
	['TRUE', 'FALSE'],
	['1', '12'],
	['  ', ' '],
	['line\nbreak', 'line\rbreak']
];

function bundle(entry, name) {
	const dir = mkdtempSync(path.join(tmpdir(), 'arxml-word-parity-'));
	const outfile = path.join(dir, name);
	buildSync({
		entryPoints: [path.join(root, 'src', 'test', 'parity', entry)],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		outfile,
		logLevel: 'silent'
	});
	return { dir, outfile };
}

const comparedPairs = [
	['diff/left.arxml', 'diff/right.arxml'],
	['semantic/rename.left.arxml', 'semantic/rename.right.arxml'],
	['semantic/embed.left.arxml', 'semantic/embed.right.arxml'],
	['semantic/empty.left.arxml', 'semantic/empty.right.arxml'],
	['editing/container.arxml', 'editing/container-ref.expected.arxml'],
	['editing/numeric.arxml', 'editing/numeric.expected.arxml'],
	['editing/self-closing.arxml', 'editing/self-closing.expected.arxml'],
	['editing/escaping.arxml', 'editing/escaping.expected.arxml'],
	['editing/textual.arxml', 'editing/textual.expected.arxml'],
	['basic.arxml', 'deep.arxml'],
	['exceptions.arxml', 'formatting.arxml']
];

function changedFieldPairs(oracleDiff) {
	const pairs = [];
	for (const [leftName, rightName] of comparedPairs) {
		const left = path.join(fixturesDir, leftName);
		const right = path.join(fixturesDir, rightName);
		const document = JSON.parse(
			execFileSync(process.execPath, [oracleDiff, left, right, 'strict'], {
				encoding: 'utf8',
				maxBuffer: 256 * 1024 * 1024
			})
		);
		for (const row of document.rows) {
			for (const change of row.changes ?? []) {
				pairs.push([change.left, change.right]);
			}
			if (row.status !== 'changed' || !row.left || !row.right) {
				continue;
			}
			// The page word-diffs these cell fields, not only the change list.
			pairs.push([row.left.label, row.right.label]);
			pairs.push([row.left.shownValue ?? '', row.right.shownValue ?? '']);
			for (const part of row.left.meta ?? []) {
				const twin = (row.right.meta ?? []).find((candidate) => candidate.cls === part.cls);
				if (twin) {
					pairs.push([part.text, twin.text]);
				}
			}
		}
	}
	return pairs;
}

function compare(expected, actual, at) {
	if (isDeepStrictEqual(expected, actual)) {
		return undefined;
	}
	return `${at}: ${JSON.stringify(expected)} !== ${JSON.stringify(actual)}`;
}

const wordsOracle = bundle('oracleWords.ts', 'oracleWords.cjs');
const diffOracle = bundle('oracleDiff.ts', 'oracleDiff.cjs');
let checked = 0;
let failures = 0;
try {
	const pairs = [...edges];
	for (const pair of changedFieldPairs(diffOracle.outfile)) {
		if (pairs.length >= 4000) {
			break;
		}
		pairs.push(pair);
	}
	const input = path.join(wordsOracle.dir, 'pairs.json');
	writeFileSync(input, JSON.stringify(pairs));
	const expected = JSON.parse(
		execFileSync(process.execPath, [wordsOracle.outfile, input], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
	);
	const actual = JSON.parse(
		execFileSync(cli, ['words', '--pairs', input], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
	);
	checked = pairs.length;
	for (let at = 0; at < pairs.length; at++) {
		const mismatch = compare(expected[at], actual[at], `pair ${at} ${JSON.stringify(pairs[at])}`);
		if (mismatch) {
			failures++;
			if (failures <= 10) {
				console.log(`FAIL ${mismatch}`);
			}
		}
	}
} finally {
	rmSync(wordsOracle.dir, { recursive: true, force: true });
	rmSync(diffOracle.dir, { recursive: true, force: true });
}
console.log(`\n${checked - failures}/${checked} word pairs matched`);
process.exit(failures === 0 ? 0 : 1);
