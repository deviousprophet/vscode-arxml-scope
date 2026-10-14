# Implementation plan: ECUC value editing in the custom editor

Ordered checklist for this child. Design: `design.md` + `../10-14-ecuc-artext-editor/design.md` §8, §9.
**Do not start** until child `../10-14-artext-custom-editor` is complete. Parent **Spike A**'s API half is
already settled (`../10-14-ecuc-artext-editor/research/spike-results.md`): there is **no** custom-document
edit-event contract to satisfy, because undo, redo, dirty state and save belong to the real
`TextDocument`. Its behavioural rows (one press per undo, dirty dot, save persists) should be observed
before this child is closed out, but they do not gate starting it.

## Order

- [ ] 1. `src/editor/ecucEdit.ts` — the edit record `{ nodeId, region, oldText, newText }` and the region
      resolution for both kinds (`design.md` §2.1). **No document class**: `resolveCustomTextEditor`
      receives the real `TextDocument`, and nothing is cached across a change.
- [ ] 2. `src/editor/ecucEdit.ts` — `applyEdit(record)`: recompute the region by re-scan, replace via
      **one** `WorkspaceEdit`, re-scan, push the model (`design.md` §2.2, §2.3). No
      `CustomDocumentEditEvent` and no private history (`design.md` §2.4) — undo and redo come from the
      text document itself.
- [ ] 3. `src/editor/ecucEditorProvider.ts` — the edit message handler: validate **before** applying,
      and return the refusal reason as a `notice` with no mutation (`design.md` §2.5).
- [ ] 4. `src/editor/ecucValueEditor.ts` — the in-tree editor widget: shows the current value, commits
      on Enter, cancels on Escape, and displays the secondary hex where the model provides one.
- [ ] 5. Verify save, revert and save-as **behaviour** rather than implementing hooks (R12, AC5): they
      are the ordinary text-document operations. If a revert does not refresh the view, the fault is in
      the re-scan subscription, not in a missing hook.
- [ ] 6. `src/test/fixtures/editing/*.arxml` — a numeric parameter, a textual parameter, a self-closing
      `<VALUE/>`, and a value needing escaping; plus the expected post-edit bytes for each.
- [ ] 7. `src/test/editor/editing.test.ts` — per the table below.

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

Additive: new files under `src/editor/` and `src/test/editor/`, plus the edit message handler in the
provider. The scanner child is untouched and there is no document class to remove. If Spike A's
behavioural rows show that undo needs more than one press per edit, **stop** rather than implementing a
private undo stack: a custom editor whose undo diverges from VS Code's is worse than one that does not
edit yet.

## Guardrails

- One `WorkspaceEdit` per user action, so one action is exactly one undo step; do not batch two edits
  into one, and do not split one into two.
- Never write outside the recorded region, and never rewrite the document as a whole for formatting
  (parent D3).
- Never skip validation to make a test pass; AC6 exists to make that visible.
- Do not reintroduce the ARTEXT text form, grammar, `Open as ARTEXT` or Compare (parent D4).
- Do not write any derived file (parent D15).
- Keep all validation in `src/core/`; version guards and editor code do not belong in the scanner.
