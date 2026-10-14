# Implementation plan: ECUC value editing in the custom editor

Ordered checklist for this child. Design: `design.md` + `../10-14-ecuc-artext-editor/design.md` §8, §9.
**Do not start** until child `../10-14-artext-custom-editor` is complete. Parent **Spike A**'s API half is
already settled (`../10-14-ecuc-artext-editor/research/spike-results.md`): there is **no** custom-document
edit-event contract to satisfy, because undo, redo, dirty state and save belong to the real
`TextDocument`. Its behavioural rows (one press per undo, dirty dot, save persists) should be observed
before this child is closed out, but they do not gate starting it.

## Order

- [x] 1. `src/editor/ecucEdit.ts` — the edit record `{ nodeId, region, oldText, newText }` and the region
      resolution for both kinds (`design.md` §2.1). **No document class**: `resolveCustomTextEditor`
      receives the real `TextDocument`, and nothing is cached across a change.
- [x] 2. `src/editor/ecucEdit.ts` — `applyEdit(record)`: recompute the region by re-scan, replace via
      **one** `WorkspaceEdit`, re-scan, push the model (`design.md` §2.2, §2.3). No
      `CustomDocumentEditEvent` and no private history (`design.md` §2.4) — undo and redo come from the
      text document itself.
- [x] 3. `src/editor/ecucEditorProvider.ts` — the edit message handler: validate **before** applying,
      and return the refusal reason as a `notice` with no mutation (`design.md` §2.5).
- [x] 4. `src/editor/ecucValueEditor.ts` — the in-tree editor widget: shows the current value, commits
      on Enter, cancels on Escape, and displays the secondary hex where the model provides one.
- [x] 5. Verify save, revert and save-as **behaviour** rather than implementing hooks (R12, AC5): they
      are the ordinary text-document operations. If a revert does not refresh the view, the fault is in
      the re-scan subscription, not in a missing hook.
- [x] 6. `src/test/fixtures/editing/*.arxml` — a numeric parameter, a textual parameter, a self-closing
      `<VALUE/>`, and a value needing escaping; plus the expected post-edit bytes for each.
- [x] 7. `src/test/editor/editing.test.ts` — per the table below.

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

- [x] AC1–AC10 in `prd.md` pass.
- [x] AC1, AC2 and AC4 are byte comparisons, not value comparisons — the criterion is that nothing else
      in the file moved.
- [x] `npm run check-types`, `npm run lint`, `npm test` are green.
- [x] A refusal path is confirmed to leave the bytes untouched (AC6), inspected rather than assumed.
- [x] Undo is confirmed to need exactly one press per edit (parent `design.md` §9).

## Built

| File | What it holds |
|---|---|
| `src/editor/ecucEdit.ts` | `EcucEditRecord`, `regionOf`, `wrapElement`, `buildEdit`, `applyEdit` |
| `src/editor/ecucEditorProvider.ts` | the `edit` message handler (`editValue`), one `WorkspaceEdit` per action |
| `src/editor/ecucValueEditor.ts` | the in-tree editor widget, as the webview half of the script |
| `src/editor/renderHtml.ts` | `data-value` on a parameter node, the widget script and its CSS, one `acquireVsCodeApi()` |
| `src/test/fixtures/editing/*.arxml` | `numeric`, `textual`, `self-closing`, `escaping` + `.expected` bytes for each |
| `src/test/editor/editing.test.ts` | 14 tests: AC1–AC9, the §2.1 record shapes, the §2.2 recompute, the widget wiring |

`buildEdit` validates before `applyEdit` structurally: it returns a refusal or a record, and the handler
never reaches the write path without a record. The widget posts the same `{ type: 'edit', nodeId, value }`
the parent `design.md` §8 specifies; the existing `reveal` / `follow` / `model` / `select` / `notice`
protocol is unchanged.

Observed results — `npm run check-types` clean, `npm run lint` clean, `npm test` **88 passing, 0 failing**
(73 before this child). Every editing test passed on the first full run, including AC4's undo/redo and
AC5's save/revert, which drive VS Code's own `undo`, `redo` and `workbench.action.files.revert`.

## Decisions taken where the design left a gap

1. **There is no `elementRange` on the model.** The scanner sets `valueRange` to the *inner text* when
   there is text and to the *whole element* when the value is empty or self-closing, so the region kind
   is derived from the bytes (`text[valueRange.start] === '<'`) and no second range is needed. For a
   re-scan of a recorded `element` region that now has text, the element span is recovered by expanding
   `valueRange` outward to the enclosing tags. `src/core/**` was **not** modified: the existing ranges
   were sufficient, so there was no defect to report.
2. **No push after a successful write.** The checklist's "re-scan, push the model" is the existing
   `onDidChangeTextDocument` subscription. Pushing from the handler as well would be a second update
   path for one change, and `rescan.test.ts` counts pushes against the platform's own events.
3. **How an edit starts.** The tree's single click already posts `reveal`, which swaps the editor, so
   "click the value" (or F2) begins the edit and the widget stops that click from reaching the reveal
   handler; Enter commits, Escape cancels, and Enter on a node that is not being edited still reveals.
4. **One guard beyond the design.** `applyEdit` refuses when the recomputed region's `oldText` differs
   from the record's, so a record prepared against bytes that have since moved cannot overwrite what the
   user never saw. Covered by a test.
5. **CDATA-backed `<VALUE>` values are out of scope.** The scanner's `valueRange` points *inside* the
   CDATA section, so a shape-1 replacement there would not round-trip through a re-read. No acceptance
   criterion covers it and no editing fixture uses it; `lexical.arxml` still has one and nothing edits
   it. Recorded rather than silently mishandled.

## Still unobserved

- **Spike A's behavioural rows A1–A8 remain unobserved.** A human must still press Ctrl+Z, watch the
  dirty dot and save in an Extension Development Host, per
  `../10-14-ecuc-artext-editor/research/spike-results.md`. The editor tests above drive the same
  platform behaviour through its commands, which is not the same as the manual observation the rows ask
  for; do not record them as passed.
- **The widget's DOM behaviour is not covered by a test.** `@vscode/test-electron` has no webview DOM, so
  `editing.test.ts` asserts the widget is rendered, styled and wired (the edit message, the id it posts,
  the Enter/Escape branch) but never that a click opens the input. The inline script is parsed by
  `node --check` and `acquireVsCodeApi()` is asserted to appear once.
- **Live pairing of the custom editor and the text editor** is Spike B, untouched here.

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
