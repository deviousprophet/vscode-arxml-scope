/**
 * Word-diff parity oracle: prints the TypeScript segment pairs for a JSON list of
 * string pairs.
 *
 * Test-only. `scripts/parityWords.mjs` bundles this entry and compares it with
 * `arxml-cli words --pairs …`.
 */
import { readFileSync } from 'node:fs';

import { diffWords } from '../../core/diff/wordDiff';

const pairs = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Array<[string, string]>;
process.stdout.write(JSON.stringify(pairs.map(([left, right]) => diffWords(left, right))));
