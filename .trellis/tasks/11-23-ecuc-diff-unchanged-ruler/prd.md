# Align unchanged regions and semantic navigation

## Goal

Keep the VS Code-native unchanged-region widgets that the shipped Monaco diff already uses, verify
and align their behavior/geometry with the reference, and drive the overview ruler and previous/next
hunk navigation from the semantic changed/added/removed rows.

## Requirements

- **Unchanged regions**
  - Keep Monaco's native `hideUnchangedRegions` (Show diff/Context) on the pre-aligned semantic
    body. Do not replace it with the legacy semantic `DiffGap` rows.
  - Verify and align the native widget geometry/labels/chevrons/context rows/expanded behavior with
    VS Code: Show all vs Show diff, Context on/off, context line count, minimum line count.
  - Do not let native hide/show operate on missing-side placeholders incorrectly; preserve the
    `diff-one-sided` placeholder contract.
- **Overview ruler**
  - Add semantic changed/added/removed marks to both panes' overview ruler using VS Code diff
    color roles and current/selected emphasis.
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
- [ ] Overview-ruler marks correspond to semantic changed/added/removed rows on both panes.
- [ ] Previous/next hunk moves through semantic changes, not Monaco line changes, and handles the
      ends.
- [ ] Current ARXML toolbar, merge, search, collapse and Show all/Show diff remain.
- [ ] Full suite/preview/production gates pass; Dark+/Light+ reference checks and HC smoke.

## Notes

- Branch only after PR #40 merges: create `feat/ecuc-diff-unchanged-ruler` from latest `main`.
- Consume the body adapter/classes from `11-23-ecuc-diff-body-surface`; do not create a second
  semantic map or a custom gap renderer.
