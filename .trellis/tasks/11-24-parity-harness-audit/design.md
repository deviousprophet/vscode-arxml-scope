# Design — prune the TypeScript/Rust parity harness

## 1. Current shape

```text
scripts/
  parity.mjs          fixture manifest (TS filesystem walk vs arxml-cli manifest)
  parityRows.mjs      TS row oracle vs arxml-cli rows
  parityDiff.mjs      TS strict/semantic diff oracle vs arxml-cli diff
  parityCopy.mjs      TS copy/delete planner oracle vs arxml-cli copy
  parityWords.mjs     TS word-diff oracle vs arxml-cli words
  parityFixtures.mjs  shared fixture walk

src/test/parity/
  oracleRows.ts       scanEcucValues + buildRows
  oracleDiff.ts       scanner + rows + buildDiffDocument
  oracleCopy.ts       planCopy/planDelete/wrapWithAncestors
  oracleWords.ts      diffWords
```

`parity.mjs` is a **manifest integrity check**, not a cross-language algorithm check. It
should stay in its own category and not be deleted just because the oracle scripts are
pruned.

## 2. Classification method

For each oracle, build a consumer table:

1. Find the exact TS functions the oracle calls.
2. Search every non-test, non-preview import of those functions.
3. Confirm the symbol is called, not just imported as a type.
4. Record the file + call path in the task notes.

Decision rule:

- **Keep** if the symbol is on a live webview/host path and the Rust and TS outputs must
  agree (for example, rows rendered by the UI vs rows returned by the engine).
- **Remove** if the only calls are the oracle, a test, the preview fixture builder, or a
  legacy page entry that is no longer bundled.
- **Replace** if a parity guarantee is still wanted but the TS implementation is gone:
  check a committed Rust golden file instead.

Do not infer “Rust is the engine” means every TS implementation is dead. The webview
still imports `renderRows`, `searchModel` and `wordDiff`; those are candidates for
`keep` or a narrower oracle, not automatic deletion.

### 2.1 Default disposition

Deletion is the default. A script survives only if **both** are true:

1. the TypeScript function it exercises is still called on a live production path; and
2. the check runs in CI (or the task adds it to CI with an owner).

Initial hypothesis to verify, not a decision:

| Script | What it actually checks | Default |
|---|---|---|
| `parity.mjs` | fixture manifest paths/sizes/hashes vs `arxml-cli` | convert to a test or delete if nothing consumes the manifest |
| `parityRows.mjs` | TS rows vs Rust rows | verify live host row path; keep only as a CI test if real |
| `parityDiff.mjs` | TS diff builder vs Rust diff | likely delete; TS diff builder looks preview/test-only |
| `parityCopy.mjs` | TS copy planner vs Rust copy | verify host planner; otherwise delete |
| `parityWords.mjs` | TS word diff vs Rust words | keep only if the tree still needs TS word diff in production |
| `parityFixtures.mjs` | shared fixture walk | delete with the last consumer |

Do not “preserve for history” by moving a script into `src/test/parity/tools/`. If it has
no live consumer, delete it; git history already preserves it.

## 3. Initial evidence to verify

- `oracleRows.ts` is imported by `src/test/extension/engine.test.ts` as well as the
  script. `scanEcucValues` and `buildRows` still appear in `commands.ts`,
  `host/ecucEdit.ts`, `host/ecucEditorProvider.ts`, `host/ecucStructureEdit.ts` and
  `host/textFeatures.ts`.
- `oracleDiff.ts` calls `buildDiffDocument`; production imports of the diff model are
  mostly types/helpers. Confirm whether `host/diffPanel.ts` builds a document or only
  consumes the engine payload.
- `oracleCopy.ts` calls `planCopy`; `host/diffPanel.ts` and the engine seam reference the
  copy types. Confirm whether the host ever calls the TS planner or only forwards the
  Rust plan.
- `oracleWords.ts` calls `diffWords`; `webview/components/documentTree/documentRows.ts`
  still uses word diff for the tree. Confirm whether the Monaco page still uses
  `diffViewer.ts` or only `diffMonaco.ts`.
- `parityRows/Diff/Words` are not in `.github/workflows/ct.yml`; `parity` and
  `parity:copy` are. This is either an unfinished CI migration or proof that the other
  checks are already considered optional.

## 4. Removal mechanics

For a removed check:

- delete `scripts/parity<Name>.mjs`;
- delete `src/test/parity/oracle<Name>.ts`;
- remove the `parity:<name>` alias from `package.json`;
- remove the CI step from `.github/workflows/ct.yml`;
- remove the `src/test/parity/oracle*.ts` entry from `.fallowrc.json` only if no oracle
  remains;
- update `docs/TEST_PLAN.md` and any README/AGENTS mention;
- run a final `rg` for the old command/oracle names.

If `parityFixtures.mjs` loses every consumer, delete it too. If `parity.mjs` remains,
keep the shared fixture walk only if it still uses it.

## 5. Retention mechanics

For a retained check:

- add a CI step after `engine:build` (or ensure it builds the CLI it needs);
- set a timeout and use the same Node version as the other jobs;
- print the first mismatch plus a count, not a wall of JSON;
- document the command in `docs/TEST_PLAN.md` with its trigger (every PR or release
  only).

If the oracle is replaced by a Rust golden:

- store the golden under `src/test/fixtures/` or a dedicated parity directory;
- add a `--update` path that is explicit and reviewed;
- keep the fixture bytes deterministic (LF, sorted keys).

## 6. Verification

- `npm run check-types`
- `npm run lint`
- `npm test`
- `npm run engine:smoke`
- `npm run rust:test`
- every retained `npm run parity*`
- `node .agents/skills/fallow-fix/scripts/fallow-extract.mjs`
- `node esbuild.js --production`
- `git diff --check`

The task is not complete if a retained command is not exercised by CI or by the final
verification run.

## 7. Risks and rollback

- **Hidden TS consumer:** the webview bundle can import a module through a barrel or a
  dynamic path. Search the bundled entries and run the production build before deleting.
- **CI ordering:** parity needs `arxml-cli`; keep it after `engine:build` or build it in
  the parity script.
- **Manifest vs oracle confusion:** `parity.mjs` checks fixture integrity; do not remove
  it as part of an oracle cleanup without replacing that guarantee.
- **Rollback:** revert the task commits. No protocol, persisted format or host data
  migration.
