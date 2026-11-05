# Implementation plan — validation false positives

Read `design.md` first. This file is the ordered checklist; it is self-contained enough to run on
a machine with no reference ECUC project.

Prerequisite: the task must be `in_progress` (`python ./.trellis/scripts/task.py start <dir>`).
Branch: `fix/validation-false-positives`.

## Step 0 — Preflight

```powershell
git status --porcelain          # plan artifacts only; no src/ change yet
npm run check-types
npm run lint
npm run compile-tests
node node_modules/mocha/bin/mocha.js --ui tdd "out/test/core/*.test.js" --ignore "out/test/core/uxNodeId.test.js"
```

Baseline must be green. If `npm test` is needed, it requires a VS Code download; do not treat a
proxy `407` as a code defect.

## Step 1 — Model fields

File: `src/core/index/indexModel.ts`

Add to `IndexElement`:

```ts
	/**
	 * FNV-1a over the element's normalized subtree. Set for `module` and
	 * `container` only; used to tell split copies from identical copies.
	 */
	contentHash?: number;
	/** Normalized own `VARIATION-POINT/SW-SYSCOND` text, when present. */
	syscond?: string;
```

Add `syscond?: string` to `IndexReference`, and to `IndexDefinition`:

```ts
	/** AUTOSAR `WITH-AUTO`: the configuration tool assigns this element. */
	withAuto?: boolean;
```

All optional: existing hand-built records in `src/test/core/workspaceIndex.test.ts` keep
compiling.

Checkpoint: `npm run check-types`.

## Step 2 — Hash helpers and `Frame`

File: `src/core/index/indexBuilder.ts`

1. Near the top constants, add:

```ts
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a, allocation-free. */
function hashText(hash: number, text: string): number {
	let value = hash >>> 0;
	for (let at = 0; at < text.length; at++) {
		value = Math.imul(value ^ text.charCodeAt(at), FNV_PRIME) >>> 0;
	}
	return value;
}

/** Sorted attributes, `UUID` excluded: split copies differ only by UUID. */
function attributeSignature(attrs: ReadonlyMap<string, string>): string {
	const parts: string[] = [];
	for (const key of [...attrs.keys()].sort()) {
		if (key === 'UUID') {
			continue;
		}
		parts.push(key + '=' + attrs.get(key));
	}
	return parts.join('\u0001');
}

function normalizeSpace(text: string): string {
	return text.replace(/\s+/g, ' ');
}
```

2. `Frame` (currently L45–65): add `hash: number;` and `syscond?: string;`.

3. `open()` (currently L104–120): seed the hash before pushing.

```ts
	const frame: Frame = { name, start: offset, text: '', hash: hashText(hashText(FNV_OFFSET, '<' + name), attributeSignature(attrs)) };
```

Keep the existing `attrs`/`uuid` handling below it.

## Step 3 — Text decoding and folding

File: `src/core/index/indexBuilder.ts`, `finishFrame` (currently L148–210)

Change the text-frame branch so text is decoded exactly once and folded into the parent:

```ts
	private finishFrame(frame: Frame, end: number, ancestors: Frame[]): void {
		if (TEXT_TAGS.has(frame.name)) {
			const text = decodeXml(frame.text).trim();
			const parent = ancestors[ancestors.length - 1];
			if (parent !== undefined && frame.name !== 'UUID') {
				parent.hash = hashText(parent.hash, '\u0001' + frame.name + '=' + normalizeSpace(text));
			}
			this.attachText(frame, text, ancestors);
			return;
		}
		// ...existing body unchanged...
```

At the end of every non-text branch that returns, fold the closed frame's hash into its parent.
The simplest edit is to wrap the existing tail: before each `return` in the `AR-PACKAGE`,
`ENUM-LITERAL-DEF`, definition, element, parameter and reference branches, or — cleaner — replace
those `return`s with a single local `fold` helper and call it once at the end of `finishFrame`:

```ts
		const parent = ancestors[ancestors.length - 1];
		if (parent !== undefined) {
			parent.hash = hashText(parent.hash, '\u0002' + frame.hash.toString(36));
		}
```

Concretely, restructure the non-text part as `if/else if` and put the fold after the chain. Do
not fold inside the text branch twice.

4. `attachText` (currently L212): change the signature to
   `private attachText(frame: Frame, text: string, ancestors: Frame[]): void` and delete the
   local `const raw = frame.text; const text = decodeXml(raw).trim();` lines. Every existing
   `case` keeps using `text`.

## Step 4 — New text tags and cases

File: `src/core/index/indexBuilder.ts`

1. `TEXT_TAGS` (currently L23–43): add `'WITH-AUTO'` and `'SW-SYSCOND'`.

2. In `attachText`, add:

```ts
			case 'SW-SYSCOND': {
				const owner = nearest(
					ancestors,
					(candidate) =>
						candidate.name === MODULE_VALUES ||
						candidate.name === CONTAINER_VALUE ||
						PARAMETER_VALUES.has(candidate.name) ||
						REFERENCE_VALUES.has(candidate.name)
				);
				if (owner !== undefined) {
					const guard = normalizeSpace(text);
					owner.syscond = owner.syscond === undefined ? guard : owner.syscond + ' && ' + guard;
				}
				return;
			}
			case 'WITH-AUTO': {
				const parent = ancestors[ancestors.length - 1];
				if (parent !== undefined && isDefinitionKind(parent.name)) {
					(parent.definition ??= {}).withAuto = /^true$/i.test(text);
				}
				return;
			}
```

`nearest` already exists in this file.

## Step 5 — Emit the new fields

File: `src/core/index/indexBuilder.ts`

1. `pushElement` (currently L309–332):

```ts
		if (element.kind === 'module' || element.kind === 'container') {
			element.contentHash = frame.hash;
		}
		if (frame.syscond !== undefined) {
			element.syscond = frame.syscond;
		}
```

2. Parameter element record (in `finishFrame`): add
   `...(frame.syscond === undefined ? {} : { syscond: frame.syscond }),`.

3. Reference record: add the same spread.

4. `pushDefinition`: nothing extra; `withAuto` travels in `...(frame.definition ?? {})`.

Checkpoint: Step 10 test below must pass before touching the rules.

## Step 6 — Duplicate rule

File: `src/core/validation/validate.ts`, duplicate block currently L113–140

Insert after `const fileCount = ...` / `if (fileCount > 1 && !crossFile) continue;` and before the
`related` construction:

```ts
		const sameIdentity = sorted.every(
			(element) => element.kind === first.kind && element.definitionRef === first.definitionRef
		);
		const hashes = new Set(sorted.map((element) => element.contentHash));
		const identical = hashes.size < sorted.length;
		const guards = new Set(sorted.map((element) => element.syscond ?? ''));
		const allVariants = sorted.length > 1 && guards.size === sorted.length;

		// AUTOSAR split files repeat one container per file with different children;
		// the copies are one merged element, not duplicates.
		if (sameIdentity && fileCount > 1 && !identical) {
			continue;
		}
		// Identical copies that are mutually exclusive variants.
		if (allVariants) {
			continue;
		}
```

Do not change the message, the severity override or `related`.

## Step 7 — Multiplicity rule

File: `src/core/validation/validate.ts`, currently L189–211

Replace the count/condition block with:

```ts
		const count = group.elements.length + group.references.length;
		const perGuard = new Map<string, number>();
		for (const item of [...group.elements, ...group.references]) {
			const guard = item.syscond ?? '';
			perGuard.set(guard, (perGuard.get(guard) ?? 0) + 1);
		}
		const unguarded = perGuard.get('') ?? 0;
		const guarded = Math.max(0, ...[...perGuard].filter(([guard]) => guard !== '').map(([, value]) => value));
		const worst = unguarded + guarded;
		const exceedsUpper = upper !== undefined && upper >= 0 && worst > upper;
		const offender = exceedsUpper ? Math.max(worst, ...perGuard.values()) : count;
		if (count < lower || exceedsUpper) {
			const first = group.elements[0] ?? group.references[0];
			const expected =
				upper === undefined ? `${lower}..` : upper < 0 ? `${lower}..*` : lower === upper ? `${lower}` : `${lower}..${upper}`;
			add(
				'multiplicity',
				first.file,
				first.range,
				`"${definition.shortName}" occurs ${offender} times in this file; the definition allows ${expected}.`
			);
		}
```

Delete the old `const count` line that it replaces; keep the group key unchanged.

## Step 8 — `missingRequired`

File: `src/core/validation/validate.ts`, currently L283–287

Extend the skip:

```ts
			if (
				lower <= 0 ||
				child.kind === 'ECUC-ADD-INFO-PARAM-DEF' ||
				child.defaultValue !== undefined ||
				child.withAuto === true
			) {
				continue;
			}
```

## Step 9 — Resolution of same-identity local copies

File: `src/core/index/workspaceIndex.ts`, `copiesFor` currently L345–361

```ts
	const local = candidates.filter((candidate) => candidate.file === sourceFile);
	if (local.length > 1) {
		const ordered = sortCopies(local);
		return [...ordered, ...sortCopies(candidates.filter((candidate) => candidate.file !== sourceFile))];
	}
```

`copiesOfOneIdentity` above it already guarantees one identity. Do not touch the `sortCopies`
tie-breakers.

## Step 10 — Index-builder test (hash contract)

File: `src/test/core/indexBuilder.test.ts`, append inside the suite:

```ts
	test('contentHash ignores whitespace and UUID but tracks content', () => {
		const document = (uuid: string, value: string, spaced: boolean) => {
			const gap = spaced ? '\n    ' : '';
			return `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/MDef</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE UUID="${uuid}"><SHORT-NAME>C</SHORT-NAME>${gap}<DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/MDef/C</DEFINITION-REF>${gap}<PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/MDef/C/P</DEFINITION-REF>${gap}<VALUE>${value}</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		};
		const hash = (uuid: string, value: string, spaced: boolean): number => element(buildFileIndex('file:///v.arxml', document(uuid, value, spaced)).elements, '/P/M/C').contentHash!;
		assert.strictEqual(hash('u1', '1', false), hash('u2', '1', true));
		assert.notStrictEqual(hash('u1', '1', false), hash('u1', '2', false));
	});
```

Also assert parsing of the guard and `WITH-AUTO` here or in the validation tests (Step 11 covers
`withAuto`).

## Step 11 — Validation tests

File: `src/test/core/validation.test.ts`, append before the closing `});` of the suite.

```ts
	test('split container copies across files are not duplicates', () => {
		const other = CLEAN.replace(
			'<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Synthetic/SampleModuleDef/Main/TimeoutSeconds</DEFINITION-REF><VALUE>42</VALUE></ECUC-NUMERICAL-PARAM-VALUE>',
			'<ECUC-TEXTUAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-STRING-PARAM-DEF">/Synthetic/SampleModuleDef/Main/Greeting</DEFINITION-REF><VALUE>hi</VALUE></ECUC-TEXTUAL-PARAM-VALUE>'
		);
		const index = workspace(CLEAN);
		index.upsert(buildFileIndex('file:///split.arxml', other));
		const duplicates = validateWorkspace(index, DEFAULT_SEVERITIES).filter(
			(diagnostic) => diagnostic.rule === 'duplicateShortName'
		);
		assert.deepStrictEqual(duplicates, []);
	});

	test('a same-file split copy is still a duplicate', () => {
		const two = CLEAN.replace(
			'</CONTAINERS>',
			'<ECUC-CONTAINER-VALUE><SHORT-NAME>Main</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Synthetic/SampleModuleDef/Main</DEFINITION-REF><PARAMETER-VALUES><ECUC-TEXTUAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-STRING-PARAM-DEF">/Synthetic/SampleModuleDef/Main/Greeting</DEFINITION-REF><VALUE>hi</VALUE></ECUC-TEXTUAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS>'
		);
		const diagnostics = validateWorkspace(workspace(two), DEFAULT_SEVERITIES);
		assert.ok(
			diagnostics.some(
				(diagnostic) =>
					diagnostic.rule === 'duplicateShortName' &&
					diagnostic.message.includes('/Synthetic/SampleModule/Main')
			)
		);
	});

	test('a same-path different-definition copy is still a duplicate', () => {
		const two = CLEAN.replace(
			'</CONTAINERS>',
			'<ECUC-CONTAINER-VALUE><SHORT-NAME>Main</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Synthetic/OtherDef/Main</DEFINITION-REF></ECUC-CONTAINER-VALUE></CONTAINERS>'
		);
		const diagnostics = validateWorkspace(workspace(two), DEFAULT_SEVERITIES);
		assert.ok(
			diagnostics.some(
				(diagnostic) =>
					diagnostic.rule === 'duplicateShortName' &&
					diagnostic.message.includes('/Synthetic/SampleModule/Main')
			)
		);
	});

	test('variant alternatives do not violate the upper multiplicity', () => {
		assert.ok(!rules(workspace(variantValues(['(A==1)', '(A!=1)']), VARIANT_DEFINITIONS)).includes('multiplicity'));
	});

	test('same-guard and unguarded repetitions still violate multiplicity', () => {
		assert.ok(rules(workspace(variantValues(['(A==1)', '(A==1)']), VARIANT_DEFINITIONS)).includes('multiplicity'));
		assert.ok(rules(workspace(variantValues(['', '']), VARIANT_DEFINITIONS)).includes('multiplicity'));
	});

	test('WITH-AUTO parameters are not missing but still parsed', () => {
		const definitions = (marker: string) =>
			`<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-DEF><SHORT-NAME>MDef</SHORT-NAME><CONTAINERS><ECUC-PARAM-CONF-CONTAINER-DEF><SHORT-NAME>C</SHORT-NAME><LOWER-MULTIPLICITY>1</LOWER-MULTIPLICITY><PARAMETERS><ECUC-INTEGER-PARAM-DEF><SHORT-NAME>P1</SHORT-NAME><LOWER-MULTIPLICITY>1</LOWER-MULTIPLICITY>${marker}</ECUC-INTEGER-PARAM-DEF></PARAMETERS></ECUC-PARAM-CONF-CONTAINER-DEF></CONTAINERS></ECUC-MODULE-DEF></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const values = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/MDef</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/MDef/C</DEFINITION-REF></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const auto = workspace(values, definitions('<WITH-AUTO>true</WITH-AUTO>'));
		assert.strictEqual(auto.definitionEntry('/P/MDef/C/P1')?.withAuto, true);
		assert.ok(!rules(auto).includes('missingRequired'));
		assert.ok(rules(workspace(values, definitions('<WITH-AUTO>false</WITH-AUTO>'))).includes('missingRequired'));
		assert.ok(rules(workspace(values, definitions(''))).includes('missingRequired'));
	});
```

Shared helpers to add next to `CLEAN` (top of the file):

```ts
const VARIANT_DEFINITIONS = `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-DEF><SHORT-NAME>MDef</SHORT-NAME><CONTAINERS><ECUC-PARAM-CONF-CONTAINER-DEF><SHORT-NAME>C</SHORT-NAME><LOWER-MULTIPLICITY>0</LOWER-MULTIPLICITY><UPPER-MULTIPLICITY>1</UPPER-MULTIPLICITY></ECUC-PARAM-CONF-CONTAINER-DEF></CONTAINERS></ECUC-MODULE-DEF></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;

function variantValues(guards: readonly string[]): string {
	const containers = guards
		.map(
			(guard) =>
				`<ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/MDef/C</DEFINITION-REF>${
					guard === '' ? '' : `<VARIATION-POINT><SW-SYSCOND>${guard}</SW-SYSCOND></VARIATION-POINT>`
				}</ECUC-CONTAINER-VALUE>`
		)
		.join('');
	return `<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/MDef</DEFINITION-REF><CONTAINERS>${containers}</CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
}
```

Keep the existing cross-file identical-duplicate test (currently L47–57) unchanged; it is AC11.

## Step 12 — Resolution test update

File: `src/test/core/workspaceIndex.test.ts`, currently L159–192

Rename the test to
`'a local copy wins; same-identity local copies merge; different identities stay ambiguous'`
and replace the `sameFile` block:

```ts
		const sameFile = new WorkspaceIndex();
		sameFile.upsert(module('file:///a.arxml', '/D/M', 2));
		const merged = sameFile.resolveTarget('/P/M/C', 'ECUC-CONTAINER-VALUE', 'file:///a.arxml');
		assert.strictEqual(merged.ok, true);
		assert.strictEqual(merged.ok && merged.copies.length, 2);
		assert.strictEqual(merged.ok && merged.element, merged.ok ? merged.copies[0] : undefined);
```

Leave the `different` block (different `DEFINITION-REF`, expects `ok === false`) untouched.

## Step 13 — Red-check every new assertion

Before reporting done, prove each test fails without its branch:

1. Comment out `if (sameIdentity && fileCount > 1 && !identical) { continue; }` → the split-copy
   test must fail.
2. Comment out `if (allVariants) { continue; }` → `variant alternatives ... upper multiplicity`
   must fail.
3. Revert the multiplicity `perGuard` upper bound to the old `count > upper` → the variant
   multiplicity test must fail.
4. Remove `child.withAuto === true` → the `WITH-AUTO` test must fail.
5. Remove the `local.length > 1` branch in `copiesFor` → the merge assertion must fail.
6. Remove the hash fold in `finishFrame`'s text branch → the index-builder hash test must fail.

Restore each change and re-run.

## Step 14 — Verification

```powershell
npm run check-types
npm run lint
npm run compile-tests
node node_modules/mocha/bin/mocha.js --ui tdd "out/test/core/*.test.js" --ignore "out/test/core/uxNodeId.test.js"
npm run benchmark
npx @vscode/vsce ls
```

If a VS Code download is available, also run `npm test`. If the proxy returns `407`, record it as
environmental and say so explicitly.

Optional webview suites (only if touched — they are not touched by this plan) need
`--require ./out/test/webview/cssImportHook.js` and the `%TEMP%\arxml-vscode-stub\stub.cjs`
require.

## Step 15 — Changelog

File: `CHANGELOG.md`, above `## [0.7.0]`:

```markdown
## [Unreleased]

### Fixed

- ECUC validation no longer reports AUTOSAR split-file container copies as duplicate names, variant alternatives (`VARIATION-POINT`/`SW-SYSCOND`) as multiplicity violations, `WITH-AUTO` parameters as missing, and same-definition local merge copies as ambiguous references
```

## Step 16 — Commit

```powershell
git add src/core/index/indexModel.ts src/core/index/indexBuilder.ts src/core/index/workspaceIndex.ts `
        src/core/validation/validate.ts src/test/core/indexBuilder.test.ts `
        src/test/core/validation.test.ts src/test/core/workspaceIndex.test.ts CHANGELOG.md
git commit -m "fix(validation): drop split-copy, variant and WITH-AUTO false positives"
```

Do not stage the reference project, the `%TEMP%\arxml-validate` scripts or any generated `out/`
artifacts. Then finish the Trellis task (`task.py finish`) with the checks recorded.

## Expected outcome (sanity, not a gate)

On the reference measurement recipe in `design.md` §10: ~4,290 → ~1,025 diagnostics
(`duplicateShortName` 3,063 → 53, `multiplicity` 233 → 117, `missingRequired` 888 → 754,
`brokenReference` 92 → 88, everything else unchanged).
