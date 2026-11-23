# Style the ECUC diff body like VS Code

## Goal

Restyle the pre-aligned semantic diff body to look like the VS Code diff view: VS Code-style
+/− gutter signs, directional copy-arrow merge margin, line and word-level highlights, and
whitespace/indentation/density from inherited editor settings. Keep the ECUC semantic diff and the
current ARXML Scope toolbar.

## Requirements

- **Gutter and margin**
  - Render +/− signs and the semantic added/removed/changed status in the VS Code diff gutter
    positions on the side that owns the row.
  - In merge mode, keep the directional copy-arrow buttons and make them the margin merge
    affordance, styled like VS Code diff controls.
  - Do not show a separate revert icon in merge mode. Outside merge mode, show +/− signs only.
  - Copy arrows appear only on the real owning side; missing-side placeholders stay neutral
    (`diff-one-sided` contract).
  - Merge clicks keep the current host copy/delete semantics.
- **Line and word highlights**
  - Use VS Code diff color roles for inserted/deleted line fills and changed-word spans.
  - Derive word spans from the semantic `DiffRow.changes` (and/or the two cell texts) without
    changing the semantic pairing.
  - Do not paint fills/words on missing-side placeholders.
- **Whitespace, indentation, density**
  - Apply the inherited `MonacoSettings` (font, size, line height, whitespace, guides, wrapping
    where already supported) to both diff editors and the body CSS.
  - Match the VS Code diff body geometry: gutter widths, line-number column, indentation,
    line spacing and content density.
  - Visual only: the semantic diff keeps ignoring formatting; no Ignore Whitespace toggle.
- **Preserve**
  - The pre-aligned semantic `DiffDocument` / synthetic row model, current ARXML toolbar,
    semantic Merge toggle, selection, search, collapse and `Show all`/`Show diff`.
  - The `diff-one-sided` placeholder behavior and audit.
- **Do not**
  - Fork VS Code, switch to raw ARXML text, or let Monaco re-align the body.
  - Add inline mode or the VS Code diff toolbar.

## Acceptance Criteria

- [ ] +/− signs, semantic status and copy arrows sit in VS Code-style gutter/margin positions.
- [ ] Merge mode shows the directional copy arrows; no duplicate revert icon.
- [ ] Copy arrows target the owning side and perform the existing host merge action.
- [ ] Line fills and word-level spans use VS Code diff color roles and never paint placeholders.
- [ ] Font, line height, whitespace, guides, indentation and density match the shipped VS Code
      reference within the semantic row model.
- [ ] The current ARXML toolbar and semantic behavior remain.
- [ ] `diff-one-sided` and the full suite/preview/production gates pass.
- [ ] The body class/DOM contract is stable for the unchanged/ruler and visual-proof children.

## Notes

- Branch only after PR #40 merges: create `feat/ecuc-diff-body-surface` from latest `main`.
- The pre-aligned semantic body is the source of truth; this is a visual/interaction layer.
