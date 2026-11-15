# Rename matching in the Rust diff

## Goal

Pair renamed ECUC containers in the semantic diff even when the old and new short
names share no token, and even when many new containers sort before the renamed
block. Keep every guarantee that prevents a wrong pair.

## Requirements

- **F1 self-name masking.** Before a container's children are compared, replace the
  container's own short name inside each child value/reference identity with one
  placeholder. The same rule applies to the substitution-score blob.
- **F2 position-independent blocking.** Candidate generation must use the masked
  child-key signature (a content hash) and name-token candidates, not sibling
  position. Position neighbours stay only as a second-score fallback.
- **F3 tests.** Cover the review shapes at several sizes:
  - 500 `NMH_` to `NM_`;
  - 500 `Old_` to `New_` (no shared token);
  - 200 renamed plus 300 unchanged;
  - 50 renamed plus 50 new containers sorting before;
  - 10 renamed plus 10 new sorting before;
  - 50 renamed plus 50 new sorting after;
  - 55 old with 50 renamed;
  - 500 unrelated replacements (must pair zero);
  - identical names with edited values (must pair by identity).
- **F4 guarantees.** Different `DEFINITION-REF` never pairs; unrelated content never
  pairs; near-ties stay unpaired; output stays deterministic; Strict mode still
  matches the old Strict output.
- Mirror the change in the TypeScript oracle (`core/diff/diffModel.ts`) so
  `parity:diff` remains a real gate. Do not add an allowlist.
- Strict mode has no semantic matching and must not change.

## Acceptance criteria

- [ ] Every shape above produces the expected pairs and zero false pairs.
- [ ] `parity:diff` passes across the whole corpus, including `semantic/rename`,
      `semantic/embed`, `semantic/large` and `diff/`.
- [ ] `npm run benchmark -- renameScale` still pairs 500/700 and stays under its
      regression limits.
- [ ] Rust and TypeScript produce byte-identical diff documents for the matrix.
- [ ] No new dependency and no change to the protocol.

## Constraints

- Do not weaken `accepted_candidate`, the margin rule or the Strict toggle to make a
  shape pass.
- Masking is case-sensitive and exact; do not use a fuzzy replacement that could
  erase unrelated content.
- Keep the masking cost linear in child text; the 26 MiB path must not regress.
