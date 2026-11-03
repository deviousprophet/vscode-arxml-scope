# v0.6: cross-file navigation

## Requirements

- **R1 — Resolve a reference through the index.** Given an `IndexReference`, return the target file,
   element, range and kind, or a refusal reason (`absent`, `ambiguous`, `dest-mismatch`, `no-target`).
- **R2 — DEST check.** When `targetDest` is present, the resolved element kind must match it:
  `ECUC-MODULE-CONFIGURATION-VALUES` -> module, `ECUC-CONTAINER-VALUE` -> container,
  `ECUC-NUMERICAL-PARAM-VALUE` / `ECUC-TEXTUAL-PARAM-VALUE` -> parameter. A mismatch is refused.
- **R3 — Jump to target across files.** The Details Jump action follows the reference. Same-file
  targets select the row in the current ECUC editor; cross-file ECUC-Values targets open the ECUC
  editor in that file at the row; non-ECUC target files open the text editor at the range.
- **R4 — Find All References.** A Details action on a module/container row lists every reference
  value whose target resolves to that element. The list shows file, line and reference label; choosing
  one reveals it in the text editor.
- **R5 — Followable rows.** A reference row is `followable` when the workspace index resolves its
  target across files, not only when the same-file `pathIndex` does.
- **R6 — Broken targets are reported, not hidden.** An unresolved follow surfaces a Details notice
  with the reason; an ambiguous target is never picked.

## Acceptance criteria

- Core tests cover exact cross-file resolution, unique suffix, ambiguity, absent target and every DEST
  kind, plus `referencesFor` returning only references that resolve to the requested element.
- `buildRows` marks a cross-file-resolvable reference followable and leaves a broken one not
  followable.
- The provider follows a cross-file reference without opening the text editor when the target is an
  ECUC-Values file.
- `npm run check-types`, `npm run lint` and `npm test` pass.
