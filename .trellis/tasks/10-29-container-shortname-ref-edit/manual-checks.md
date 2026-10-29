# Manual checks — container short name / definition ref

## Status

Not run in this session. This environment has no Extension Development Host session, so the
real-webview rows below are **pending**, not passed. Everything listed under "Automated
evidence" ran in the repository's VS Code test host (`npm test`, 249 passing).

## Automated evidence

| Behaviour | Where |
|---|---|
| Short-name / definition-ref inner-text plans, tag and `DEST` untouched | `editing.test.ts` (R1/R2) |
| Container-only, missing/empty/CDATA refusals, unchanged refusals | `editing.test.ts` (R4/R5), `validate.test.ts` (R4) |
| One-span byte writes for both fields, one undo/redo | `editing.test.ts` (AC2/AC3/AC6/AC7) |
| Rename keeps the renamed container selected; ref edit keeps the id | `editing.test.ts` (AC2/AC6/AC7) |
| Stale bytes and unknown `field` write nothing | `editing.test.ts` (R5/R4) |
| Sibling short-name collision predicts the renamed node | `editing.test.ts` (R5) |
| Parameter value message shape unchanged | `editing.test.ts` (R3) |
| Details default visible; saved hide honoured; invalid state visible | `uxDocument.test.ts` (AC8) |
| Container controls, field ids, commit message, Tab target | `uxDocumentInteractions.test.ts` (R1/R2) |
| Distinct, opposite Expand/Collapse glyphs | `uxDocument.test.ts` (R7) |
| Committed fixtures never written | `editing.test.ts` (AC9), snapshot before/after |

## Pending host checks

Open `src/test/fixtures/basic.arxml` (or `editing/container.arxml`) with **Open with ECUC Editor**
in the Extension Development Host, then:

1. **Default visible** — first paint shows the details inspector with the "Select a line" state and
   the toggle reports pressed. Select `ContA`; the panel shows editable `Short name` / `Definition`.
2. **Short-name commit** — change `ContA` to `ContA1`, press Enter. The row label and selection stay;
   the panel keeps showing the container. Undo once restores `ContA`.
3. **Definition commit** — change `Definition` to a different path, press Enter. The row label
   follows the new tail, selection stays, `DEST` is unchanged in the source. Undo once restores it.
4. **Field navigation** — Tab from `Short name` focuses `Definition` after the re-scan;
   Shift+Tab from the first field leaves the panel instead of trapping focus; Escape restores a draft.
5. **Refusal rendering** — enter a short name with a space; the input stays, shows the reason and
   `aria-invalid`; the file stays clean.
6. **Hide/reload** — hide Details, run `Developer: Reload Webview`; it stays hidden. Show it, reload;
   it stays visible.
7. **Icons** — at 14px in dark and High Contrast, Collapse reads as squeezing inward and Expand as
   spreading outward; both keep their labels and accessible names.
8. **Tab order focus** — after a rename commit, the next field is focused (the id changed, the
   selection followed it).

## Known limitations (accepted for this task)

- A `SHORT-NAME` stored in CDATA shows the editor but is refused on commit. The row carries the
  decoded text, not a range/CDATA flag; hiding the control would need row-model work outside the
  task scope.
- Two container fields can be committed before the re-scan arrives; a warning attaches to the
  first pending field. Same single-pending limitation the value editor already had.
- `DEFINITION-REF` editing can reorder rows (it is the primary sort key); the selection follows the
  id and is scrolled into view.
