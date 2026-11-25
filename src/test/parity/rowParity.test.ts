/**
 * Row parity: the engine's row store must match the TypeScript row store.
 *
 * The editor builds its rows in TypeScript (`scanEcucValues` + `buildRows`) and the
 * engine streams the rows the diff page pairs. The two stores are the same contract,
 * so a drift is a real UI regression. Every fixture is checked in both sort modes
 * against the oracle; the first difference and the failure count are reported.
 */
import * as assert from 'assert';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { EngineClient } from '../../host/engine/engineClient';
import { enginePath } from '../../host/engine/engineLoader';
import { oracleRows, type OracleSort } from './oracleRows';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SORTS: readonly OracleSort[] = ['all', 'declaration'];
const FIXTURES = path.join(ROOT, 'src', 'test', 'fixtures');
const OPEN_OPTIONS = { sort: 'all' as const, sortExcept: [...SORT_EXCEPTIONS] };

/** Every committed ARXML fixture, as an absolute path. */
function fixtureFiles(): string[] {
	return readdirSync(FIXTURES, { recursive: true, encoding: 'utf8' })
		.filter((file) => file.endsWith('.arxml'))
		.map((file) => path.join(FIXTURES, file))
		.sort();
}

function clip(value: string): string {
	return value.length > 400 ? `${value.slice(0, 400)}...` : value;
}

/** The first row difference, or `undefined` when the stores are equal. */
function firstDifference(actual: readonly unknown[], expected: readonly unknown[]): string | undefined {
	if (actual.length !== expected.length) {
		return `row count ${actual.length} !== ${expected.length}`;
	}
	for (let at = 0; at < actual.length; at++) {
		if (!isDeepStrictEqual(actual[at], expected[at])) {
			return `row ${at}: engine ${clip(JSON.stringify(actual[at]))} !== oracle ${clip(JSON.stringify(expected[at]))}`;
		}
	}
	return undefined;
}

suite('row parity (TypeScript oracle vs engine)', () => {
	test('every fixture matches in both sort modes', async function () {
		this.timeout(120_000);
		const binary = enginePath(ROOT);
		assert.ok(
			existsSync(binary),
			'the engine is required by the test/package build; run npm run engine:build'
		);
		const files = fixtureFiles();
		assert.ok(files.length > 0, 'the fixture corpus is not empty');
		const failures: string[] = [];
		let checked = 0;
		const client = await EngineClient.start({ binary, root: ROOT });
		try {
			for (const file of files) {
				const relative = path.relative(ROOT, file).replaceAll('\\', '/');
				const text = readFileSync(file, 'utf8');
				const opened = await client.request('doc.open', { uri: file, options: OPEN_OPTIONS }, text);
				const docId = Number(opened.header.docId);
				try {
					for (const sort of SORTS) {
						checked++;
						const chunks = await client.requestStream('doc.rows', {
							docId,
							options: { sort, sortExcept: [...SORT_EXCEPTIONS] }
						});
						const actual = chunks.flatMap((chunk) =>
							chunk.body.length === 0
								? []
								: (JSON.parse(chunk.body.toString('utf8')) as unknown[])
						);
						const expected = JSON.parse(oracleRows(file, sort)) as unknown[];
						const mismatch = firstDifference(actual, expected);
						if (mismatch !== undefined) {
							failures.push(`${relative} [${sort}]: ${mismatch}`);
						}
					}
				} finally {
					await client.request('doc.close', { docId });
				}
			}
		} finally {
			client.dispose();
		}
		assert.deepStrictEqual(
			failures,
			[],
			`${failures.length}/${checked} fixture/sort combinations differ:\n${failures.slice(0, 10).join('\n')}`
		);
	});
});
