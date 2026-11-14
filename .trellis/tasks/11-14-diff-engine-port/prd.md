# Diff engine port

Parent: `11-14-arxml-config-merge`. This child is the first of the two; the copy-merge UI
must not start before its parity gate passes.

## Goal

Move the semantic diff — comparison rows, stable keys, semantic rename matching, word-level
changes and the streamed document — into the Rust engine, at exact parity with the
TypeScript implementation, and add the copy-patch operation the merge UI consumes.

## Requirements

- **R1 — Ownership.** `core/diff` moves to `arxml-core`. The extension host keeps the
  panel, the selection and the protocol; it does no comparison work.
- **R2 — Exact parity.** The serialized `DiffDocument` from the engine is byte-identical to
  the TypeScript oracle for every fixture and a generated ~2 MiB document, in **strict and
  semantic** modes: rows, order, keys, `posinset`/`setsize`/`subtreeSize`, statuses,
  `changes`, `match` metadata, word-level segments, pane labels, headers, summary,
  `semanticSkipped` and `semanticLimitReason`.
- **R3 — Keys are stable.** Row keys are the page's identity for selection, collapse and
  search; they must be equal to the oracle's, not merely unique.
- **R4 — Streamed.** `diff.compute` streams the document in row chunks, so a 26 MiB pair
  never materialises as one frame.
- **R5 — Copy patch.** `diff.patch` (or `doc.copy`) answers a copy with the contiguous
  diff-row replacement it causes, and that patch applied to the current document equals a
  full rebuild. It returns `unpatchable` with a reason for: a module change, a copy that
  shifts duplicate ordinals, an unmatched/created parent, stale bytes.
- **R6 — Oracle retained.** The TypeScript implementation stays under `src/test` as the
  parity oracle; production imports of `core/diff` are removed.
- **R7 — Performance.** The full diff on the 26 MiB pair stays within the recorded
  `diffSemantic` / `renameScale` ceilings; a patch is under 50 ms at 20 MiB.
- **R8 — No regression.** Editor protocols, the engine's row/edit operations and the
  existing page tests are unchanged.

## Acceptance criteria

- [ ] Parity suites pass for every fixture, strict and semantic, keys included; zero
      exemptions.
- [ ] The generated document (≥ 2 MiB) matches the oracle in both modes.
- [ ] The panel renders an engine diff with the existing page tests unchanged.
- [ ] Randomised copy sequences (fixtures + generated document) satisfy
      `patch(document, op) === rebuild(document)` on the serialized document.
- [ ] Each of the four `unpatchable` cases returns its reason and never a patch.
- [ ] `diffSemantic`, `renameScale` and `diffToggle` benchmarks are within their ceilings;
      a new patch benchmark records < 50 ms.
- [ ] No production import of `core/diff` remains; `tsc`, `lint`, `cargo test`, clippy and
      fmt pass.

## Out of scope

- The merge toggle, arrows and copy behaviour (child `11-14-copy-merge-ui`).
- Redesigning the diff page or the comparison rules; parity is the contract.
- The workspace index, validation or the editor's scan path.

## Notes

- `design.md` / `implement.md` for this child are written before `task.py start`; the
  parent's `implement.md` Step 2 lists the gate the copy UI waits on.
- The engine diff is the place where a later incremental-diff improvement belongs; this
  child only owes the copy patch, not a general incremental rebuild.
