# Match the ECUC diff content body to VS Code's built-in diff

## Goal

Make the ECUC semantic diff **look and feel like a modified version of the VS Code diff view**, while keeping the ECUC semantic diff as the source of truth. The body adopts VS Code's visual affordances and density; it does not replace semantic pairing, merge or the ARXML reading model with VS Code's native text-diff algorithm.

## Decisions from planning

- **Base:** Monaco's `createDiffEditor` (`monaco-editor@0.57.0`), the same approach used for the ECUC editor. Do not fork the VS Code diff editor source, replace the body with a custom DOM renderer, or switch to raw ARXML text.
- **Core:** the pre-aligned semantic `DiffDocument` / synthetic row model stays. VS Code's native line diff is not the pairing engine.
- **Reference:** VS Code `^1.125` / Monaco `0.57.0`; Dark+ and Light+ are full acceptance themes, high-contrast is a smoke check. `microsoft/vscode` main is research only.
- **Toolbar:** the current ARXML Scope diff toolbar stays. VS Code's diff toolbar is out of scope.
- **Merge mode:** the built-in diff-margin right arrow and one copy-left arrow are the merge-mode
  affordance. Both post the host copy; the synthetic model is never edited. There is no custom
  overlay, text/pill arrow or separate revert icon.
- **Whitespace:** visual parity only — inherit VS Code editor settings and diff-body metrics; the semantic diff keeps ignoring formatting. No Ignore Whitespace behavior or toggle.
- **Unchanged regions:** keep Monaco's native `hideUnchangedRegions` widgets, which the shipped
  page already uses when Show diff/Context is active. Verify and style their Show diff/Context
  behavior and VS Code geometry; do not replace them with the legacy semantic `DiffGap` rows.
- **Navigation:** previous/next hunks are driven by semantic changed/added/removed rows; the
  overview ruler is Monaco's native built-in diff overview, not a semantic decoration layer.
- **Visual proof:** a checked-in VS Code diff-body reference capture plus an automated audit of the real ARXML diff body; a plausible screenshot alone is not acceptance.
- **Deferred:** inline diff mode at narrow widths. Out of scope: VS Code diff toolbar, raw ARXML text diff, a new semantic alignment algorithm.

## Must-have body affordances

- +/− gutter signs, native status paint and the built-in diff-margin arrows.
- Inserted/deleted line fills and word-level changed spans using VS Code diff colors.
- VS Code-style unchanged-region widgets and context rows.
- Whitespace rendering, indentation guides, line height, spacing and density from inherited editor settings.
- Monaco's native overview ruler and semantic previous/next hunk navigation.
- Existing ARXML toolbar, navigation, search, collapse, merge and semantic status remain.

## Task map

- `.trellis/tasks/11-23-ecuc-diff-body-surface` — per-side built-in body paint, the built-in right arrow plus one copy-left arrow, native fills and density.
- `.trellis/tasks/11-23-ecuc-diff-unchanged-ruler` — unchanged-region widgets, the native overview ruler and hunk navigation.
- `.trellis/tasks/11-23-ecuc-diff-visual-proof` — VS Code reference capture and automated body audit.

Child ordering: body surface and unchanged/ruler can proceed in parallel; the visual-proof child starts after the first two have their final DOM/class contract, then the parent does the integrated review.

## Acceptance criteria

- [ ] The diff body shows VS Code-style +/− signs and the directional copy-arrow merge margin; merge mode has no duplicate revert icon.
- [ ] Line and word-level highlights use the VS Code diff color roles and the semantic status.
- [ ] Unchanged regions keep Monaco's native `hideUnchangedRegions` widgets, aligned with the VS Code reference and the Show diff/Context behavior.
- [ ] Ruler marks and previous/next navigation follow the semantic changed/added/removed rows.
- [ ] Whitespace, indentation, line height, gutter widths and density match the shipped VS Code reference within the semantic row model.
- [ ] The current ARXML Scope toolbar and all existing semantic diff features still work.
- [ ] The checked-in VS Code reference capture and automated body audit pass; the audit fails on fake/incorrect body painting.
- [ ] Dark+ and Light+ are verified; high-contrast passes a smoke check.
- [ ] Full suite, preview audit and production bundle pass.

## Non-goals

- No inline diff mode in this plan.
- No VS Code diff toolbar, Ignore Whitespace toggle or raw-text diff.
- No fork of `microsoft/vscode` and no new semantic matching algorithm.
- No change to the host protocol, merge semantics or ARXML data.
