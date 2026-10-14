# ECUC value editing in the custom editor

Make the rendered tree editable in the narrowest way that cannot damage the user's file: a value's
text is replaced in place, everything else is preserved byte for byte.

Parent requirement IDs (R1–R18), decisions (D1–D16) and the rationale live in
`../10-14-ecuc-artext-editor/prd.md` and `../10-14-ecuc-artext-editor/design.md`. The acceptance
criteria below are **child-local**.

## Goal

A user can correct a parameter or reference value in the readable view, have the change land in the
real `.arxml` with a conservative validation, undo it with Ctrl+Z, and save it — without the editor
ever touching anything but that value's text.

## Prerequisites

- `../10-14-ecuc-model-scanner` complete: `validate.ts` and per-node value ranges exist and are tested.
- `../10-14-artext-custom-editor` complete: the provider, the message channel and the re-scan
  subscription exist, because every applied edit refreshes the view through them.
- Parent plan **Spike A** (`../10-14-ecuc-artext-editor/implement.md` §Step 0): its API half is
  already settled and recorded in `../10-14-ecuc-artext-editor/research/spike-results.md` — there is
  no custom-document edit-event contract to satisfy, because undo/redo/dirty/save belong to the real
  `TextDocument`. The behavioural rows (one press per undo, dirty dot, save persists) should be
  observed before this child is closed out, but they do not gate starting it.

## Scope

- The write path: re-scanning to locate the region, applying one `WorkspaceEdit`, and refreshing the
  view. No custom document class and no edit-event callbacks — `CustomTextEditorProvider` provides no
  hook for them, and undo/redo/dirty/save are the real `TextDocument`'s own.
- Validation in front of every write, with no mutation on refusal.
- Re-scan after every applied change, so the view is never stale.

## Requirements

- Write only the `<VALUE>` element of the node being edited, never the surrounding structure (parent
  D1, R11).
- Preserve every byte outside that element: indentation, line endings, attribute spacing, comments,
  sibling order (parent R11, AC7).
- Make every write undoable and redoable through VS Code's own history, not a private stack (parent
  D10, R12).
- Refuse a value that is invalid for its parameter kind or that XML cannot represent, explain why, and
  leave the file untouched (parent R13).
- Track dirty state through the real `TextDocument`, so save behaves like any other editor (parent R12).
- Write no derived artefact anywhere (parent D15, R11).

## Acceptance criteria

- [ ] AC1. Editing a numeric parameter and editing a textual parameter each change exactly that value's
      text; a byte comparison against the expected file shows no other difference.
- [ ] AC2. The two write shapes both work: a value with text content is replaced inside its tags, and an
      empty or self-closing `<VALUE/>` becomes `<VALUE>text</VALUE>` with everything else in the file
      unchanged.
- [ ] AC3. A value containing `&`, `<` or `>` is written escaped, and re-reading the file yields the
      same string the user typed.
- [ ] AC4. Ctrl+Z after an edit restores the previous bytes and Ctrl+Y re-applies it; the result matches
      a byte comparison in both directions.
- [ ] AC5. The document becomes dirty after an edit and clean after save, and `revert` restores the file
      from disk and re-renders the view.
- [ ] AC6. A value that fails validation, and a value containing a character XML cannot represent, are
      each refused with a message, and the file's bytes are unchanged (parent AC9).
- [ ] AC7. An edit that does not change the value is a no-op and does not dirty the document.
- [ ] AC8. After an applied edit, an undo and a redo, the rendered values match the document; the view
      never shows a stale value.
- [ ] AC9. No file is created, and the only file modified is the one being edited (parent AC10).
- [ ] AC10. `npm run check-types`, `npm run lint` and `npm test` pass.

## Out of scope

- Structural edits: adding or removing a container, parameter or reference; renaming a short-name;
  retargeting a reference. Not attempted, and must not appear as a side effect (parent D3).
- Editing a value that is not a `<VALUE>` element (for example a `SHORT-NAME`).
- Cross-file effects of any kind (parent D7).
- Formatting, indentation normalisation, or any rewrite of the document as a whole.
- Conflict handling for a file changed on disk while the editor is dirty: VS Code's normal dirty-file
  behaviour applies and is not extended here.

## Constraints

- No new runtime dependency; escaping and validation are the core child's functions (parent D7).
- All validation happens before the write is applied; a refusal must not leave a partial edit.
- The write must go through `WorkspaceEdit` so it participates in undo, formatters and file watchers.
- A single edit produces exactly one undo step.
