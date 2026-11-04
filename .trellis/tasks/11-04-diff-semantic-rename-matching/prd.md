# Match renamed containers semantically in the diff

Ships as part of v0.6.1 together with `11-04-validation-false-positives`.

## Goal

When a user renames containers, the diff shows each renamed container as **one changed row** with its
children aligned, not as a removed/added pair. Real changes inside the renamed container stay visible
and are distinguishable from changes implied by the rename itself.

## Context

`src/core/diff/diffModel.ts` pairs sibling rows per level in `pairLevel`: exact content, then sort
identity, then exact row id, then the ordinal-free `baseId`. A row id embeds the container short name and
a child id embeds its parent id, so a container rename breaks pairing for the container and every child
(nested containers, parameters, references). Example (synthetic): renaming `NMH_MO_01_MAIN_BUS` to
`NM_MO_01_MAIN_BUS` across many containers yields hundreds of removed and added rows, plus changed
child values that repeat the old name.

## Requirements

- **B1 — Semantic pass.** After the existing identity passes in `pairLevel`, pair leftover removed
  (left) and added (right) **container** rows within the same parent pairing, the same `kind`, and the
  same `DEFINITION-REF`.
- **B2 — Changed row.** A semantically paired container is one `changed` row. The short-name change is
  shown at word level (reuse `diffWords`) alongside every other field change from `diffChanges`.
- **B3 — Parent-relative children.** Children of a semantic pair are paired by parent-relative
  identity (kind, `DEFINITION-REF`, sort identity within the parent), not by full ids. Nested
  containers run the same semantic pass recursively.
- **B4 — Scoring.** Score combines child overlap (matching definition/value), name similarity,
  sibling position, and a learned rename substitution inferred from high-confidence pairs. The
  weights and the threshold are fixed in `design.md`; the substitution raises confidence across a batch
  (`NMH` → `NM`) and is applied to child values and names before comparison.
- **B5 — Assignment.** One-to-one and globally best above the threshold. Ties and low-confidence
  candidates stay removed plus added. Output is deterministic for the same inputs and independent of
  declaration order within a sibling group.
- **B6 — Rename-implied changes.** A value that differs only by the inferred substitution still shows
  as changed, but is marked `rename-implied`. The visual treatment is subtle and documented in
  `design.md`.
- **B7 — UI.** A semantic pair carries a small "renamed" marker with a tooltip (score and reasons). A
  toolbar toggle switches semantic and strict matching for the current panel. Counts, Prev/Next diff
  and "Show diff only" treat a semantic pair as one change. The summary gains a `renamed` count.
- **B8 — Setting.** `arxmlScope.diff.semanticMatching` (boolean, default on). The toolbar toggle
  overrides it for the current panel only.
- **B9 — Performance.** Bucket candidates by parent, kind and `DEFINITION-REF` before scoring; no
  pairwise comparison across the whole file. The budget and the oversized-bucket fallback are in
  `design.md`; `npm run benchmark` includes a large many-leftover case.
- **B10 — Read-only.** No edit, write or persistence behaviour changes.

## Non-goals

- Renamed parameters or references as standalone rows.
- Containers moved between parents (they stay removed plus added).
- Editing or repairing either file.
- Persisting match decisions between panels or sessions.
- Changing validation (Track A).

## Acceptance criteria

- [ ] A synthetic fixture renames several containers with a consistent token change (`NMH` → `NM`) and
      edits one value in one of them: each renamed container is one `changed` row, children align, only
      the edited value plus rename-implied values are highlighted, and no removed/added row remains for
      those containers.
- [ ] Two candidates with near-equal scores stay removed plus added.
- [ ] A container moved to a different parent stays removed plus added.
- [ ] Containers with a different `DEFINITION-REF` never pair.
- [ ] Strict mode (toggle off or setting off) reproduces the pre-change output exactly for the existing
      diff fixtures.
- [ ] Counts, Prev/Next diff and "Show diff only" are correct with paired rows; the summary shows the
      renamed count.
- [ ] Output is identical across repeated runs and independent of declaration order within sibling
      groups.
- [ ] The benchmark's large many-leftover case stays within the stated budget.
- [ ] Every new test fails when the code branch it covers is removed (mutation check).
- [ ] `npm run check-types`, `npm run lint`, `npm test`, `npm run benchmark` and
      `npx @vscode/vsce ls` pass.

## Notes

- Shared release steps (version bump, changelog, docs, full verification) live once in
  `.trellis/tasks/11-04-validation-false-positives/implement.md` section 8. This task references them.
- Default-on is a proposal and an open decision; strict mode must stay available and reproducible.
- Existing fixtures and `src/test/core/diffModel.test.ts` are the regression baseline.
