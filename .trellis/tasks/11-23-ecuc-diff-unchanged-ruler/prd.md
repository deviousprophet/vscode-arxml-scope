# Align unchanged regions and semantic navigation

## Goal

Keep the VS Code-native unchanged-region widgets that the shipped Monaco diff already uses, verify
and align their behavior/geometry with the reference, keep Monaco's built-in overview ruler, and
drive previous/next hunk navigation from the semantic changed/added/removed rows.

## Requirements

- **Unchanged regions**
  - Keep Monaco's native `hideUnchangedRegions` (Show diff/Context) on the pre-aligned semantic
    body. Do not replace it with the legacy semantic `DiffGap` rows.
  - Verify and align the native widget geometry/labels/chevrons/context rows/expanded behavior with
    VS Code: Show all vs Show diff, Context on/off, context line count, minimum line count.
  - Do not let native hide/show operate on missing-side placeholders incorrectly; preserve the
    `diff-one-sided` placeholder contract.
- **Overview ruler**
  - Keep Monaco's built-in `renderOverviewRuler` on; it is the same diff overview VS Code uses.
  - Do not add semantic `overviewRuler` decorations or a selected-row ruler emphasis.
  - Do not derive marks from Monaco `getLineChanges()` on the synthetic text.
- **Previous/next hunk**
  - Wire the current ARXML toolbar controls to semantic changed/added/removed rows (including
    renames and semantic pairs), reveal the target row, wrap/disable at the ends.
  - Keep the current ARXML toolbar; do not add the VS Code diff toolbar.
- **Preserve**
  - Semantic merge, search, collapse, Show all/Show diff, selection and existing audits.
- **Do not**
  - Re-align the body natively, add inline mode, Ignore Whitespace or VS Code toolbar controls.

## Acceptance Criteria

- [ ] Show diff/Context uses the native unchanged-region widgets with VS Code-like geometry,
      labels and context behavior; Show all expands them correctly.
- [ ] The native widgets do not paint/own missing-side placeholders or break `diff-one-sided`.
- [ ] Monaco's built-in `.diffOverview` is present; the page adds no semantic ruler decorations.
- [ ] Previous/next hunk moves through semantic changes, not Monaco line changes, and handles the
      ends.
- [ ] Current ARXML toolbar, merge, search, collapse and Show all/Show diff remain.
- [ ] Full suite/preview/production gates pass; Dark+/Light+ reference checks and HC smoke.

## Notes

- Continue on `feat/ecuc-diff-body-surface` (user decision: finish all tasks on one branch); do
  not create a separate `feat/ecuc-diff-unchanged-ruler` branch.
- Consume the body adapter/classes from `11-23-ecuc-diff-body-surface`; do not create a second
  semantic map or a custom gap renderer.
- **Scope change (2026-11-24):** the user confirmed strict built-in parity, so the semantic overview
  ruler is removed. This child now owns the native unchanged widgets and semantic Prev/Next only.
