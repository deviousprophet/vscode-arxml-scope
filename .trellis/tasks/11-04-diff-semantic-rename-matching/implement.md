# Implement — semantic rename matching in the diff

Ordered work on `fix/validation-false-positives`. Do not start a step before the previous check is
green. Track A (`11-04-validation-false-positives`) ships in the same release and owns the shared release
steps; see section 7. The diff stays read-only.

## 0. Pre-flight

- [ ] `npm ci`, `npm run check-types`, and the core diff suite are green.
- [ ] Capture the strict baseline: the current `src/test/core/diffModel.test.ts` expectations are the
      pre-change output. Do not edit them to fit the new pass.
- [ ] Add the synthetic rename fixture: several containers renaming `NMH_*` → `NM_*`, one real value
      edit, one nested container, one moved container, one near-tie pair, one different
      `DEFINITION-REF` pair. No customer ARXML.

## 1. Relative child identity (B3 groundwork)

Files: `src/core/diff/diffModel.ts`

- [ ] `relativeId(id)` (everything after the first `/`).
- [ ] `PairContext { relative, semantic, substitutions }`; `pairLevel` and `mergeChildren` take it.
- [ ] Identity grouping and the exact-id pass use `baseId(relativeId(...))` in relative mode;
      `contentIdentity` / `subtreeIdentity` / `sortIdentity` stay id-free.
- [ ] `pairedNode` forwards the context; default context is `{ relative: false, semantic: false }`.
- [ ] Test: with `relative: false`, every existing diff test still passes byte-for-byte; with
      `relative: true`, a renamed parent's identical children pair.

Check: `npm run compile-tests && npx mocha --ui tdd "out/test/core/diffModel.test.js"`.

## 2. Semantic pass, scoring and substitution (B1, B4, B5, B9)

Files: `src/core/diff/diffModel.ts`

- [ ] `DiffMatch`, `DiffChange.renameImplied`, `DiffSummary.renamed`, `DiffOptions`.
- [ ] Bucket leftover container leftovers by `kind` + `definitionRef` inside each `pairLevel`.
- [ ] Score `0.55*children + 0.30*name + 0.10*position + 0.05*substitution`; token Jaccard + normalized
      Levenshtein for `name`; multiset Jaccard of `kind|definitionRef|sortIdentity` for `children`.
- [ ] Accept only `score ≥ 0.62` and a `0.08` margin on both sides; greedy one-to-one sorted by score,
      then relative id.
- [ ] Substitution learner: seed accepted pairs at `score ≥ 0.80`, LCS token alignment, ≥ 2 seeds and
      ≥ 60% agreement, no pure digits or tokens shorter than 2, deterministic conflict order; rerun the
      bucket with the map applied.
- [ ] `applySubstitutions(text, map)`; no displayed text is rewritten.
- [ ] Bucket guard: `L * R > 250_000` → no semantic pair in that bucket.
- [ ] `DiffRow.match` set on semantic pairs with score, reasons and used substitutions.
- [ ] `summarizeDiff` counts `renamed`.
- [ ] Tests in `src/test/core/diffModel.test.ts` (or a new `diffSemantic.test.ts`): rename → one
      `changed` row with aligned children; no removed/added rows for those containers; near-tie →
      removed + added; moved parent → removed + added; different `DEFINITION-REF` → never pairs;
      repeated run and reversed declaration order → identical output; strict option → current output.

Check: `npm run compile-tests && npx mocha --ui tdd "out/test/core/*diff*.test.js"`.

## 3. Rename-implied changes (B6)

Files: `src/core/diff/diffModel.ts`, `src/webview/diffViewer.ts`,
`src/webview/components/diffView/diffView.css`, `src/webview/components/documentTree/documentRows.ts`

- [ ] Mark a `DiffChange` `renameImplied` when `applySubstitutions(left) === right`.
- [ ] Page adds `.rename-implied` to the affected word runs (dashed underline, muted background) and a
      tooltip naming the substitution; independent edits keep the normal style.
- [ ] Test: a value that changes only by `NMH`→`NM` is `changed` + `renameImplied`; an independent edit
      in the same container is not.

Check: `npm run check-types` and the webview row suite.

## 4. Host setting and protocol (B8)

Files: `package.json`, `src/diffProtocol.ts`, `src/host/diffPanel.ts`

- [ ] `arxmlScope.diff.semanticMatching` (boolean, default `true`, description names the panel toggle).
- [ ] Protocol: `document` payload gains `semantic: boolean`; page → host `matchMode`.
- [ ] `DiffPanel` reads the setting at open, includes the flag in every document post, and rebuilds on
      `matchMode` without writing configuration.
- [ ] Test: opening with the setting off produces the strict document; a toggle message flips only the
      current panel.

Check: `npm run check-types && npm run lint`.

## 5. Page marker, toggle and summary (B7)

Files: `src/webview/components/toolbar/toolbar.ts`, `toolbar.css`, `src/webview/diffViewer.ts`,
`src/webview/components/diffView/diffView.css`

- [ ] Toolbar button `#diff-match-mode`, `aria-pressed`, `Semantic`/`Strict` label, `onMatchMode`
      callback.
- [ ] `setMatchMode(semantic)` from the document payload.
- [ ] `renamed` badge with the score/reason tooltip on semantic rows.
- [ ] Summary slot: `X changed (Y renamed) · Z added · W removed`.
- [ ] Tests in `src/test/webview/page/*`: badge present, tooltip text, toggle sends the message,
      summary text, Prev/Next and Show-diff-only treat the pair as one change.

Check: `npm run compile-tests && npx mocha --ui tdd "out/test/webview/page/*.test.js"`.

## 6. Benchmark (B9)

Files: `src/test/benchmarks/diffSemanticBenchmark.ts` (new)

- [ ] Generate a synthetic pair of documents with ~2,000 leftover containers across 12 parents
      (including one 500 × 400 bucket), consistent `NMH`→`NM` renames and a few real edits.
- [ ] Measure `diffRows`/`buildDiffDocument` time and heap; print
      `{ _type: 'diff-semantic', sourceRows, pairs, elapsedMs, retainedMiB }`.
- [ ] Fail above 1,500 ms or when the paired count differs from the expected rename count; assert the
      oversized bucket stays conservative.

Check: `npm run benchmark`.

## 7. Release and verification

Shared release steps (version 0.6.1, changelog, README/docs, spec update, full verification list) are
owned by `.trellis/tasks/11-04-validation-false-positives/implement.md` section 8 and run once for both
tasks. This task adds:

- [ ] `CHANGELOG.md`: `arxmlScope.diff.semanticMatching` and "renamed containers pair as one changed row"
      under Added.
- [ ] `README.md` and `docs/ECUC_EDITOR.md`: the setting, the toolbar toggle, the renamed marker and the
      rename-implied style.
- [ ] `npm run check-types`, `npm run lint`, `npm test`, `npm run benchmark`, `npx @vscode/vsce ls`.
- [ ] Strict-mode regression: run the existing diff fixtures with the setting off and confirm the output
      matches the pre-change baseline.
- [ ] Record the benchmark numbers in the task notes and the PR body.

## Review gates

1. After step 1: strict output is unchanged for every existing fixture (no accidental pairing).
2. After step 2: prove a near-tie never pairs; prove a moved container never pairs; prove a different
   `DEFINITION-REF` never pairs; prove repeated runs are identical.
3. After step 3: prove an independent edit is not mislabelled `renameImplied`.
4. After step 5: prove the toggle is panel-scoped and the summary follows it.
5. Before commit: no customer ARXML, no fixture beyond the synthetic set, no edit/write path touched.

## Rollback

- The semantic pass, `match`/`renamed` and the toggle are additive; setting the option off restores the
  strict behaviour.
- Steps 1, 4 and 5 are independent of step 2; revert them separately.
- No persisted match state, so rollback needs no migration.
