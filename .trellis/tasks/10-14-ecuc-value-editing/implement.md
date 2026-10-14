# Implementation plan: ECUC value editing in the custom editor

Ordered checklist for this child. Design: `design.md` + `../10-14-ecuc-artext-editor/design.md` §8, §9.
**Do not start** until child `../10-14-artext-custom-editor` is complete and parent **Spike A** has
proven the `CustomDocument` undo/redo contract (`../10-14-ecuc-artext-editor/implement.md` §Step 0).

## Order

- [ ] 1. `src/editor/ecucDocument.ts` — the `CustomDocument`: `uri`, and `model()` derived by
      re-scanning. No cached model (`design.md` §1).
- [ ] 2. `src/editor/ecucDocument.ts` — the edit record `{ nodeId, region, oldText, newText }` and the
      region resolution for both kinds (`design.md` §2.1).
- [ ] 3. `src/editor/ecucDocument.ts` — `applyEdit(record)`: recompute the region by re-scan, replace
      via `WorkspaceEdit`, re-scan, push the model (`design.md` §2.2, §2.3).
- [ ] 4. `src/editor/ecucDocument.ts` — `CustomDocumentEditEvent` construction; fire once on first
      application; `undo()`/`redo()` apply without re-firing (`design.md` §2.4).
- [ ] 5. `src/editor/ecucEditorProvider.ts` — the edit message handler: validate **before** applying,
      and return the refusal reason as a `notice` with no mutation (`design.md` §2.5).
- [ ] 6. `src/editor/ecucValueEditor.ts` — the in-tree editor widget: shows the current value, commits
      on Enter, cancels on Escape, and displays the secondary hex where the model provides one.
- [ ] 7. `src/editor/ecucEditorProvider.ts` — `saveCustomDocument`, `revertCustomDocument`,
      `saveCustomDocumentAs` (`design.md` §2.6). Verify each against Spike A's findings; if save-as or
      revert cannot be made to work, record that in `prd.md` rather than shipping a silent no-op.
- [ ] 8. `src/test/fixtures/editing/*.arxml` — a numeric parameter, a textual parameter, a self-closing
      `<VALUE/>`, and a value needing escaping; plus the expected post-edit bytes for each.
- [ ] 9. `src/test/editor/editing.test.ts` — per the table below.

## Test coverage

| Assertion | Test |
|---|---|
| AC1, AC2, AC3 — byte comparison after each edit kind | open a **copy** of each fixture in a temp directory, edit, compare bytes with the expected file |
| AC4 — undo and redo byte comparison | edit, undo, compare; redo, compare |
| AC5 — dirty, save, revert | assert dirty after edit, clean after save, and that revert restores the on-disk bytes and re-renders |
| AC6 — refusal leaves the file untouched | invalid value and XML-illegal character; compare bytes before and after |
| AC7 — unchanged value is a no-op | assert the document is not dirty afterwards |
| AC8 — view never stale | assert the pushed model equals a fresh scan after edit, undo and redo |
| AC9 — only the edited file is touched | snapshot the directory before and after |

Editing tests run against a copy in a temporary directory, never against a committed fixture: a test
that edits its own fixture in place fails on the second run and silently rewrites the repository.

## Validation commands

| Purpose | Command |
|---|---|
| Types | `npm run check-types` |
| Lint | `npm run lint` |
| Full suite | `npm test` |

## Done when

- [ ] AC1–AC10 in `prd.md` pass.
- [ ] AC1, AC2 and AC4 are byte comparisons, not value comparisons — the criterion is that nothing else
      in the file moved.
- [ ] `npm run check-types`, `npm run lint`, `npm test` are green.
- [ ] A refusal path is confirmed to leave the bytes untouched (AC6), inspected rather than assumed.
- [ ] Undo is confirmed to need exactly one press per edit (parent `design.md` §9).

## Rollback

Additive: new files under `src/editor/` and `src/test/editor/`, and the document class handed to the
provider. The scanner child is untouched. If Spike A contradicts `design.md` §2.4, **stop** rather than
implementing a private undo stack: a custom editor whose undo diverges from VS Code's is worse than one
that does not edit yet.

## Guardrails

- One `WorkspaceEdit` and one event per user action; no batching that merges two edits into one undo
  step, and no firing that splits one into two.
- Never write outside the recorded region, and never rewrite the document as a whole for formatting
  (parent D3).
- Never skip validation to make a test pass; AC6 exists to make that visible.
- Do not reintroduce the ARTEXT text form, grammar, `Open as ARTEXT` or Compare (parent D4).
- Do not write any derived file (parent D15).
- Keep all validation in `src/core/`; version guards and editor code do not belong in the scanner.
