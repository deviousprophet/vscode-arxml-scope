# Implement — validation false positives

Ordered work. Each step ends with the listed check; do not start a later step before the earlier check
is green. Every step is revertible with `git checkout -- .`; nothing writes user data.

Track B (`11-04-diff-semantic-rename-matching`) ships in the same release. It does not depend on these
steps; both tasks run in parallel on `fix/validation-false-positives`.

## 0. Pre-flight

- [ ] Confirm branch `fix/validation-false-positives` is based on `origin/main` (v0.6.0, `7abfea5`).
- [ ] `npm ci` and `npm run check-types` are green before any edit.
- [ ] Record the v0.6.0 validation baseline on the reference project (time, heap, diagnostics) in the
      task notes; the reference project is never committed.
- [ ] Add the synthetic fixtures (multi-ECU twin folders, ambiguous definition, duplicate copies) under
      `src/test/fixtures/**`; synthetic only.

## 1. Candidate-aware lookup (R1)

Files: `src/core/index/workspaceIndex.ts`

- [ ] `PathLookup<T>` stores `T[]`; `buildLookup` pushes candidates for repeated paths.
- [ ] `resolveDetailed` returns candidates; `element()` / `definitionEntry()` still return
      `T | undefined` (exactly one candidate only).
- [ ] `copiesOfOneIdentity(candidates)` uses `kind` + `definitionRef`.
- [ ] `resolveTarget(raw, dest?, sourceFile?)`: dest filter; one candidate → ok; non-copies →
      ambiguous; copies → local copy, ambiguous when two are local, otherwise ok with every copy in
      `copies` ordered by file.
- [ ] `resolveReference` passes `reference.file`.
- [ ] `definitionCandidateCount(rawPath): number`.
- [ ] Tests (`src/test/core/workspaceIndex.test.ts`): local copy wins; two local copies ambiguous;
      no local copy → ok with all copies; differing `definitionRef` ambiguous; `definitionEntry` still
      refuses duplicates; `copies` sorted deterministically.

Check: `npm run compile-tests && npx mocha --ui tdd "out/test/core/workspaceIndex.test.js"`.

## 2. Navigation consumers (R1)

Files: `src/host/ecucEditorProvider.ts`, `src/host/textFeatures.ts`, `src/host/indexService.ts`

- [ ] `DefinitionSource.resolveTarget` gains the optional source-file parameter; pass
      `document.uri.toString()` at the follow call; `IndexService` forwards it.
- [ ] `TextFeatures.provideDefinition` returns `vscode.Location[]` for `copies.length > 1`; every
      `resolveTarget` call passes the document URI.
- [ ] `followReference`: `copies.length > 1` → `showQuickPick` (`fileName:line`), then
      `openElement`; cancel does nothing; one copy keeps today's path.
- [ ] `referenceResolver` stays keyed on `ok`; ambiguous/absent keep the refusal text.
- [ ] Tests (`src/test/extension/crossFileProvider.test.ts`, `src/test/extension/textFeatures.test.ts`):
      multiple locations returned, quick pick shown, single-copy path unchanged, same-file duplicate
      still refuses.

Check: `npm run check-types && npm run compile-tests && npx mocha --ui tdd "out/test/extension/*.test.js"` (or the extension runner when the suite needs VS Code).

## 3. Excluded paths (R8)

Files: `src/core/index/glob.ts` (new), `src/host/indexService.ts`, `src/host/textFeatures.ts`,
`package.json`

- [ ] `compileExcludes(patterns)`: `**`, `*`, `?`, `/` normalization, anchored, empty → always false;
      prefix form for a trailing `/`.
- [ ] `indexSettings()` returns `exclude: string[]` from `arxmlScope.index.exclude`.
- [ ] `runRebuild` filters URIs by workspace-relative path; `schedule`/`reindexFile` ignore matches;
      a settings change rebuilds (existing path).
- [ ] `TextFeatures` returns no index-backed features for an excluded or unknown-workspace document.
- [ ] Status tooltip adds `N excluded` when non-empty.
- [ ] Manifest key with the `_fwd`/`_out`/`_gen` example.
- [ ] Tests: new `src/test/core/glob.test.ts`; `src/test/extension/index.test.ts` for discovery and
      removal; `src/test/extension/textFeatures.test.ts` for the excluded-document return.

Check: `npm run check-types && npm run lint`.

## 4. Rule corrections (R2–R7, R9)

Files: `src/core/validation/validate.ts`, `src/core/validation/types.ts`

- [ ] `CHECKED_TARGET_DESTS` = module + container; missing DEST validates; every other DEST skipped
      (parameter values documented as skipped).
- [ ] `duplicateShortName`: one diagnostic per path at the first element; same-file keeps severity;
      cross-file `information` (honours `off`); `related` entries for the other declarations.
- [ ] `EcucDiagnostic.related` added and mapped in `validationService`.
- [ ] `multiplicity`: key includes the file; message names the per-file scope.
- [ ] `missingRequired`: skip `ECUC-ADD-INFO-PARAM-DEF`; skip definitions with `defaultValue`.
- [ ] `valueProblem`: empty/whitespace → valid; boolean `true/false/0/1`; float `INF`/`-INF`/`NaN`.
- [ ] `missingDefinition`: group to the highest missing ancestor / missing module definition; one
      diagnostic with the occurrence count; root-package heuristic removed.
- [ ] Tests in `src/test/core/validation.test.ts` (one per bullet) and
      `src/test/extension/validation.test.ts` (`off` suppresses the informational cross-file duplicate;
      related information reaches `vscode.Diagnostic`).

Check: `npm run compile-tests && npx mocha --ui tdd "out/test/core/*.test.js"`.

## 5. Ambiguous definition in Details (R12)

Files: `src/core/ecuc/renderRows.ts`, `src/host/ecucEditorProvider.ts`, `src/host/indexService.ts`,
`src/webview/editorViewer.ts`, `src/webview/components/sidebar/detailsPanel/detailsPanel.ts`

- [ ] `RowBuildOptions.ambiguousDefinitions?: (ref) => number`; `EcucRow.definitionCount`.
- [ ] Provider passes `definitionCandidateCount`; `IndexService` exposes it.
- [ ] Inspector shows `N definitions found` when no single definition resolves and count ≥ 2.
- [ ] Tests: `src/test/core/definitionRows.test.ts` and
      `src/test/webview/page/uxDocumentInteractions.test.ts`.

Check: `npm run compile-tests && npx mocha --ui tdd "out/test/core/definitionRows.test.js"` plus the
webview page suite.

## 6. Performance guards (R10)

Files: `src/host/validationService.ts`, `src/host/textFeatures.ts`,
`src/test/benchmarks/validationBenchmark.ts` (new)

- [ ] Validation refresh records the index generation, coalesces (newest generation wins), yields
      between chunks, publishes only a complete set.
- [ ] `TextFeatures.cached()` respects `arxmlScope.index.maxFileSizeMB` and bounds its cache (LRU 8).
- [ ] Benchmark builds a ~40 MiB synthetic workspace across many files, exercises every rule, prints
      time/heap, and throws above 5,000 ms or 512 MiB.
- [ ] Tests: a fake document above the limit returns no features and is not scanned; a generation bump
      during a pass discards the stale result.

Check: `npm run benchmark` (all three benchmarks) and `npm run check-types`.

## 7. Diagnostic volume cap (R11)

Files: `src/host/validationService.ts`, `package.json`

- [ ] `arxmlScope.validation.maxDiagnosticsPerFile` (500) and `maxDiagnostics` (5000), `0` = unlimited.
- [ ] Deterministic truncation plus one summary diagnostic per affected file with the hidden count.
- [ ] Tests in `src/test/extension/validation.test.ts`: caps respected, summary present, `0` disables.

Check: `npm run check-types && npm run lint`.

## 8. Shared v0.6.1 release steps

Run once for both tasks; Track B references this section.

- [ ] Bump `package.json` and `package-lock.json` to `0.6.1`.
- [ ] `CHANGELOG.md`: dated `0.6.1` entry.
      - Fixed: validation false positives (copy-aware resolution, checked DESTs, per-file multiplicity,
        ADD-INFO and default-value required parameters, value semantics, ancestor missing definitions),
        validation performance guards.
      - Added: `arxmlScope.index.exclude`, `arxmlScope.validation.maxDiagnostics*`,
        `arxmlScope.validation.crossFileRules`, `arxmlScope.diff.semanticMatching`,
        rename matching in the diff, and the fragment-workspace quiet mode.
- [ ] `README.md`: exclusion setting, caps, semantic diff setting.
- [ ] `docs/ECUC_EDITOR.md`: revised rule semantics and the new settings.
- [ ] `.trellis/spec/frontend/quality-guidelines.md`: replace "two matches must resolve to nothing"
      with the copy-aware rule, including the same-file exception and multiple-location navigation.
- [ ] Full verification (below).

## 9. Full verification

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run benchmark` (index, ECUC large file, validation)
- [ ] `npm run package` and `npx @vscode/vsce ls` (only runtime, docs, manifest, icons)
- [ ] Re-run the external measurement against the reference project with
      `arxmlScope.index.exclude = ["**/_fwd/**", "**/_out/**", "**/_gen/**"]`:
      - total diagnostics ≤ 5,000;
      - no non-ECUC or parameter-value `brokenReference`;
      - no ambiguity where a local copy or a unique copy exists;
      - no cross-file `multiplicity`;
      - no ADD-INFO or default-value `missingRequired`;
      - no empty-value or `0/1`/`INF`/`NaN` `valueOutOfRange`;
      - missing definitions ≤ the distinct ancestor count (not per instance);
      - validation time and heap compared with the recorded v0.6.0 baseline.
- [ ] Record the before/after numbers in the task notes and the PR body.

## Review gates

1. After step 1: prove the copy rule cannot turn a kind/`DEFINITION-REF` mismatch into `ok`, and that
   two local copies stay ambiguous.
2. After step 2: prove every navigation entry point returns all copies (definition provider, Jump,
   links/hover) and none silently picks the first file.
3. After step 4: mutation check — delete each new branch (DEST filter, related information, per-file
   key, ADD-INFO skip, default-value skip, empty/boolean/float, ancestor grouping) and watch its test
   fail.
4. After step 6: benchmark gate fails when the pass is made artificially quadratic; the host yields.
5. Before commit: no customer ARXML, no fixture beyond the synthetic set, `git status` contains only
   source, tests, docs, benchmark and task artifacts.

## Rollback

- Steps 1–2, 3, 4, 5, 6, 7 are independent; revert a step without touching the others.
- The exclusion setting and both caps are inert at their defaults; removing the manifest keys and the
  corresponding branches reverts them.
- No migration, no persisted state.
