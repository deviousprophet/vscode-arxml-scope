/**
 * Copy-planner parity: the Rust core and the TypeScript oracle must return the same
 * span for every request in the corpus.
 *
 *   node scripts/parityCopy.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { buildSync } from 'esbuild';

const root = process.cwd();
const cli = path.join(root, 'rust', 'target', 'debug', process.platform === 'win32' ? 'arxml-cli.exe' : 'arxml-cli');
if (!existsSync(cli)) {
	console.error(`arxml-cli is not built at ${cli}; run cargo build -p arxml-cli`);
	process.exit(1);
}

const LF = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <CONTAINERS>
    <ECUC-CONTAINER-VALUE>
      <SHORT-NAME>C</SHORT-NAME>
      <PARAMETER-VALUES>
        <ECUC-NUMERICAL-PARAM-VALUE>
          <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/C/P1</DEFINITION-REF>
          <VALUE>1</VALUE>
        </ECUC-NUMERICAL-PARAM-VALUE>
      </PARAMETER-VALUES>
    </ECUC-CONTAINER-VALUE>
  </CONTAINERS>
</AUTOSAR>
`;
const CRLF = LF.replaceAll('\n', '\r\n');

function between(text, open, close, from = 0) {
	const start = text.indexOf(open, from);
	if (start < 0) throw new Error(`missing ${open}`);
	const end = text.indexOf(close, start);
	if (end < 0) throw new Error(`missing ${close}`);
	return { start, end: end + close.length };
}

function twoParameters() {
	return LF.replace(
		'      </PARAMETER-VALUES>',
		`        <ECUC-NUMERICAL-PARAM-VALUE>
          <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/C/P2</DEFINITION-REF>
          <VALUE>2</VALUE>
        </ECUC-NUMERICAL-PARAM-VALUE>
      </PARAMETER-VALUES>`
	);
}

const ours = between(LF, '<ECUC-NUMERICAL-PARAM-VALUE>', '</ECUC-NUMERICAL-PARAM-VALUE>');
const sourceText = LF.replace('<VALUE>1</VALUE>', '<VALUE>22</VALUE>');
const sourceRange = between(sourceText, '<ECUC-NUMERICAL-PARAM-VALUE>', '</ECUC-NUMERICAL-PARAM-VALUE>');
const two = twoParameters();
const secondStart = two.lastIndexOf('<ECUC-NUMERICAL-PARAM-VALUE>');
const second = between(two, '<ECUC-NUMERICAL-PARAM-VALUE>', '</ECUC-NUMERICAL-PARAM-VALUE>', secondStart);
const inline = 'text <VALUE>x</VALUE> tail';
const crlfAnchor = between(CRLF, '<ECUC-NUMERICAL-PARAM-VALUE>', '</ECUC-NUMERICAL-PARAM-VALUE>');
const utf16Text = `<!--é-->\n${LF}`;
const utf16Anchor = between(utf16Text, '<ECUC-NUMERICAL-PARAM-VALUE>', '</ECUC-NUMERICAL-PARAM-VALUE>');

const cases = [
	{
		label: 'replace',
		request: { targetText: LF, sourceText, source: sourceRange, target: ours }
	},
	{
		label: 'insert after',
		request: { targetText: LF, sourceText, source: sourceRange, anchorAfter: ours }
	},
	{
		label: 'insert before',
		request: { targetText: LF, sourceText, source: sourceRange, anchorBefore: ours }
	},
	{
		label: 'delete whole line',
		request: { kind: 'delete', targetText: two, sourceText: '', target: second }
	},
	{
		label: 'delete inline',
		request: { kind: 'delete', targetText: inline, sourceText: '', target: between(inline, '<VALUE>', '</VALUE>') }
	},
	{
		label: 'CRLF target, LF source',
		request: { targetText: CRLF, sourceText, source: sourceRange, anchorAfter: crlfAnchor }
	},
	{
		label: 'two missing ancestors',
		request: {
			targetText: LF,
			sourceText,
			source: sourceRange,
			anchorAfter: ours,
			ancestors: [
				{
					shortName: 'A',
					definitionRef: '/P/A',
					definitionDest: 'ECUC-PARAM-CONF-CONTAINER-DEF',
					childKind: 'container'
				},
				{
					shortName: 'B',
					definitionRef: '/P/A/B',
					definitionDest: 'ECUC-PARAM-CONF-CONTAINER-DEF',
					childKind: 'parameter'
				}
			]
		}
	},
	{
		label: 'non-ASCII prefix',
		request: { targetText: utf16Text, sourceText, source: sourceRange, anchorAfter: utf16Anchor }
	},
	{
		label: 'refuses without an anchor',
		request: { targetText: LF, sourceText, source: sourceRange }
	}
];

function bundleOracle() {
	const dir = mkdtempSync(path.join(tmpdir(), 'arxml-copy-parity-'));
	const outfile = path.join(dir, 'oracleCopy.cjs');
	buildSync({
		entryPoints: [path.join(root, 'src', 'test', 'parity', 'oracleCopy.ts')],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		outfile,
		logLevel: 'silent'
	});
	return { dir, outfile };
}

const { dir, outfile } = bundleOracle();
let failures = 0;
try {
	for (const { label, request } of cases) {
		const requestPath = path.join(dir, 'request.json');
		writeFileSync(requestPath, JSON.stringify(request), 'utf8');
		const expected = JSON.parse(execFileSync(process.execPath, [outfile, requestPath], { encoding: 'utf8' }));
		const actual = JSON.parse(execFileSync(cli, ['copy', '--request', requestPath], { encoding: 'utf8' }));
		if (isDeepStrictEqual(expected, actual)) {
			console.log(`ok   ${label}`);
		} else {
			failures++;
			console.log(`FAIL ${label}\nexpected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(actual)}`);
		}
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${cases.length - failures}/${cases.length} copy cases matched`);
process.exit(failures === 0 ? 0 : 1);
