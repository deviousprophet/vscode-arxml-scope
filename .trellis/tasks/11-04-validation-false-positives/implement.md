# Implement — validation false positives

Ordered work. Each step ends with the listed check; do not start a later step before the earlier check is
green. Rollback point after every step is a clean working tree (`git stash`/`git checkout -- .`), because
no step writes user data.

## 0. Pre-flight

- [ ] Confirm branch `fix/validation-false-positives` is based on `origin/main` (v0.6.0, commit `7abfea5`).
- [ ] `npm ci` (or `npm install`) and `npm run check-types` are green before any edit.
- [ ] Copy `research/validation-false-positives.md` numbers into the task notes; the reference project is
      not committed.

## 1. Candidate-aware index lookup

Files: `src/core/index/workspaceIndex.ts`

- [ ] `PathLookup<T>` stores `T[]`; `buildLookup` pushes candidates; `resolveDetailed` returns
      `found | ambiguous(candidates) | absent`.
- [ ] `element()` / `definitionEntry()` keep returning `T | undefined` (found only when one candidate).
- [ ] Add `copiesOfOneIdentity(candidates)` using `kind` + `definitionRef`.
- [ ] `resolveTarget(raw, dest?, sourceFile?)`: dest filter, copy selection (same file, then first by
      `file`), `ambiguous` only for non-copies.
- [ ] `resolveReference` passes `reference.file`.
- [ ] Tests in `src/test/core/workspaceIndex.test.ts`: same-file copy wins; sorted-first fallback;
      differing `definitionRef` stays ambiguous; `definitionEntry` still refuses duplicates.

Check: `npm run check-types && npx mocha --ui tdd "out/test/core/workspaceIndex.test.js"` after
`npm run compile-tests`.

## 2. Call sites

Files: `src/host/ecucEditorProvider.ts`, `src/host/textFeatures.ts`, `src/host/indexService.ts`

- [ ] Extend `DefinitionSource.resolveTarget` with the optional third parameter and pass
      `document.uri.toString()` at the follow, link, definition, references and hover call sites.
- [ ] `IndexService.resolveTarget` forwards the parameter.
- [ ] Tests: `src/test/extension/crossFileProvider.test.ts`, `src/test/extension/textFeatures.test.ts`.

Check: `npm run check-types`.

## 3. Glob matcher and exclusion setting

Files: `src/core/index/glob.ts` (new), `src/host/indexService.ts`, `package.json`

- [ ] `compileExcludes(patterns)` with `**`, `*`, `?`, `/` normalization, empty list → always false.
- [ ] `indexSettings()` returns `exclude: string[]` read from `arxmlScope.index.exclude`.
- [ ] `runRebuild` filters discovered URIs by workspace-relative path; `schedule`/`reindexFile` ignore
      excluded URIs; a settings change triggers the existing full rebuild.
- [ ] Status bar tooltip adds `N excluded` when non-empty.
- [ ] Manifest: `arxmlScope.index.exclude` (array of strings, default `[]`, description names `_fwd`/
      `_out`/`_gen` as examples).
- [ ] Tests: new `src/test/core/glob.test.ts`; `src/test/extension/index.test.ts` covers an excluded file
      and its removal from the status/definitions.

Check: `npm run check-types && npm run lint`.

## 4. Rule corrections

Files: `src/core/validation/validate.ts`

- [ ] `brokenReference`: skip non-ECUC `targetDest` values (`ECUC_TARGET_DESTS` set).
- [ ] `duplicateShortName`: one diagnostic per path at the first element; cross-file → `information`
      (still suppressed by `off`); message states the declaration count and file count.
- [ ] `multiplicity`: key includes the file; count per file.
- [ ] `missingRequired`: skip `ECUC-ADD-INFO-PARAM-DEF`.
- [ ] `valueProblem`: empty/whitespace value returns `undefined`; boolean accepts `true/false/0/1`.
- [ ] `missingDefinition`: one per path at first occurrence; skip when the root package has no indexed
      definition.
- [ ] Tests in `src/test/core/validation.test.ts` (one per bullet) and
      `src/test/extension/validation.test.ts` (severity `off` still suppresses the new informational
      cross-file duplicate).

Check: `npm run compile-tests && npx mocha --ui tdd "out/test/core/*.test.js"`.

## 5. Docs and spec

Files: `README.md`, `docs/ECUC_EDITOR.md`, `CHANGELOG.md`, `.trellis/spec/frontend/quality-guidelines.md`

- [ ] Document `arxmlScope.index.exclude` with the generated-tree example.
- [ ] Describe the revised semantics: ADD-INFO not required, empty value = default, boolean `0`/`1`,
      one diagnostic per duplicate/missing definition, non-ECUC targets not validated.
- [ ] Replace the "two matches must resolve to nothing" rule with the copy-aware wording from the design.
- [ ] `CHANGELOG.md` under `Unreleased`.

## 6. Full verification

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run benchmark`
- [ ] `npm run package` and `npx @vscode/vsce ls` (only runtime, docs, manifest, icons)
- [ ] Re-run the external measurement script against the reference project with
      `arxmlScope.index.exclude = ["**/_fwd/**", "**/_out/**", "**/_gen/**"]`:
      - total diagnostics ≤ 5,000;
      - `brokenReference` contains no non-ECUC DEST and no same-file-resolvable ambiguity;
      - no `multiplicity` from cross-file copies;
      - no `missingRequired` for ADD-INFO;
      - no `valueOutOfRange` for empty values or `0/1` booleans.
- [ ] Record the before/after counts in the task notes and the PR body.

## Review gates

1. After step 1: verify the copy rule cannot turn a kind/definition mismatch into `ok`.
2. After step 4: confirm every new test fails when its rule branch is deleted (mutation check, per
   `testing.md`).
3. Before commit: confirm no fixture or customer file was added, and `git status` contains only source,
   tests, docs and task artifacts.

## Rollback

- Step 1/2 are independent of steps 3–4; revert them separately if the index benchmark regresses.
- The exclusion setting is inert by default; dropping the manifest key and the matcher reverts it.
- No migration, no persisted state.
