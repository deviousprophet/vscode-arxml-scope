# Edit container short name and definition ref in details

## Goal

Let the ECUC custom editor change a container's `SHORT-NAME` and `DEFINITION-REF` from the
details panel, not only a parameter's `<VALUE>`. Details are open on first paint. The toolbar's
Collapse and Expand controls stop looking like the same button.

## Background

Today the details panel edits one thing: a parameter's `<VALUE>`, through
`{ type: 'edit', nodeId, value }`. Container `Short name` and `Definition` are read-only rows.
A container rename or a wrong definition reference therefore requires the text editor, even
though the editor already knows the exact text range for both (the scanner records
`shortNameRange` / `definitionRefRange`).

The details inspector is also hidden on first paint, so every session starts by clicking
`Details` just to see the selected node. The Collapse-all and Expand-all toolbar buttons use
two hand-drawn diagonal glyphs with the same visual weight and near-identical shape; the
Collapse glyph even draws its arrowheads outward and Expand inward, so neither reads as its
label.

## Requirements

### R1 — Container short name is editable

- The details panel shows an editable `Short name` control for a selected **container** row.
- Committing writes only the text inside that container's `<SHORT-NAME>…</SHORT-NAME>`.
- The input starts at the container's current short name.

### R2 — Container definition ref is editable

- The details panel shows an editable `Definition` control for a selected **container** row.
- Committing writes only the text inside that container's `<DEFINITION-REF …>…</DEFINITION-REF>`;
  the element's own attributes (`DEST`), namespace prefix and spacing stay byte-identical.
- The input starts at the container's current full definition ref.

### R3 — Parameter value editing is unchanged

- The existing `<VALUE>` editing behaviour, message shape (without the new field), validation,
  refusal text, one-undo-step rule and rejection of CDATA-backed values stay as they are.

### R4 — Validation and refusal

- A short name must be non-empty and a legal AUTOSAR identifier
  (`[A-Za-z_][A-Za-z0-9_]*`). Whitespace, `/`, punctuation and XML-unrepresentable characters
  are refused with a reason; nothing is written and the document is not dirtied.
- A definition ref must be non-empty, an absolute `/`-separated path with no empty segment,
  no whitespace and no `<`, `>`, `&`, `"` or `'`. Invalid input is refused with a reason.
- An unchanged value is refused (`… is unchanged`) so idling cannot dirty the document.
- A stale write (the bytes under the range moved since the edit was prepared) is refused.

### R5 — Safe write

- Each commit is exactly one `WorkspaceEdit`, so one `Ctrl+Z` reverts it.
- The byte span is recomputed from a fresh scan, never replayed from a stored offset.
- A container rename keeps the renamed container selected after the re-scan, even though its
  path-based node id changes.
- A definition-ref edit keeps the container selected; row order may change because
  `DEFINITION-REF` is the primary sort key.

### R6 — Details visible by default

- First paint shows the details inspector open, with the empty "Select a line" state until a
  row is selected. The `Details` button still toggles it.
- An explicit hide/show choice is still persisted through `getState()/setState()`; only a
  missing or invalid saved state falls back to visible.

### R7 — Distinct Collapse / Expand icons

- Collapse-all and Expand-all use clearly different, semantically correct glyphs: Expand
  spreads outward (chevrons pointing away from the centre) and Collapse squeezes inward
  (chevrons pointing toward the centre), or another pair that is unambiguous at 14px.
- Labels, titles and accessible names stay: `Collapse` / `Expand`, `Collapse every container` /
  `Expand every container`.

## Non-goals

- Editing a reference's `TARGET-REF` / `VALUE-REF`.
- Editing a module's short name or definition ref (would renumber every container id).
- Adding or removing a `SHORT-NAME` / `DEFINITION-REF` element when one is absent, empty or
  self-closing.
- Editing inside CDATA sections.
- Bulk rename, rename propagation, or updating reference paths that mention a renamed
  container.
- Changing the document surface into editable rows.

## Acceptance Criteria

- [ ] AC1: Selecting a container shows editable `Short name` and `Definition` controls; selecting
      a parameter still shows the typed `Value` control; module/reference rows show no new editor.
      *(Rendered focus/visibility pending the host check; the controls and their row-kind gate are
      asserted in `uxDocumentInteractions.test.ts`.)*
- [x] AC2: Committing a short name rewrites only that `<SHORT-NAME>` text; a whole-file byte
      comparison against a hand-derived expected fixture shows one contiguous change.
- [x] AC3: Committing a definition ref rewrites only that `<DEFINITION-REF>` text, keeping its
      `DEST` attribute and tag spelling; a whole-file byte comparison shows one contiguous change.
- [x] AC4: One undo restores the previous bytes for both new fields; one redo re-applies them.
- [x] AC5: An invalid short name (empty, spaces, `/`, `&`), an invalid definition ref (relative,
      empty, whitespace) and an unchanged value are each refused with a reason, leave the bytes
      and the on-disk file untouched, and do not dirty the document.
- [x] AC6: After a container rename the re-scanned rows carry the new short name and the renamed
      container is still selected (the row id in the payload is the new id).
- [x] AC7: After a definition-ref edit the container is still selected and the row label follows
      the new ref tail.
- [x] AC8: First paint renders the inspector open and the toggle reports `aria-pressed="true"`.
      A saved `inspectorHidden: true` still hides it; an absent/invalid state shows it.
- [x] AC9: Collapse-all and Expand-all have different SVG path data and the semantic direction
      described in R7; their labels/titles/aria labels are unchanged.
- [ ] AC10: `npm run check-types`, `npm run lint` and `npm test` pass; webview interactions that
      need a real DOM are recorded as Extension Development Host observations, not claimed as
      automated tests.
      *(The three gates pass: 249 tests. The host rows are listed as pending in `manual-checks.md`;
      this checkbox stays open until they are observed.)*

## Notes

- Task type: complex (cross-layer: model range → write path → provider selection → webview
  inspector → CSS/HTML shell). `design.md` and `implement.md` are required before start.
- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- The repo has no webview DOM in CI; page-level behaviour is asserted with `scriptTestUtils`
  and finished by hand in the Extension Development Host.
