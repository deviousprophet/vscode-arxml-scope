# UX-03 — The sidebar show/hide toggle is painted as the primary action and looks permanently "on"

- **Severity:** Minor
- **Journey:** EDIT-28 (sidebar toggle), EDIT-01 (first render), A11Y-02 (focus order)
- **Heuristic:** Visual hierarchy / primary-action prominence; consistency with VS Code chrome
- **Confidence:** High — **confirmed in the host** at 1082 px and 786 px webview widths
  (`gate-02-diff-workbench.png`, `capture-zoom-100-webview.png`, `edit-16-stale-workbench.png`);
  the judgement that it is "too prominent" is the only subjective part.

## Repro

1. Capture `editor` (or any `editor-*` state) at 1400×900.
2. Look at the top-right of the toolbar.

## Expected

A view preference rendered as a quiet icon button (like VS Code's own panel toggle), visually
subordinate to the editing surface and the Details fields. Its pressed state should be a subtle
tint, not the saturated "active option" fill.

## Actual

`#toggle-sidebar` ships as `class="tool diff-tool" aria-pressed="true"` while the sidebar is
visible (`src/webview/components/toolbar/toolbar.ts`, `renderEditorToolbarHtml` / `setSidebarHidden`).
The shared `.tool[aria-pressed="true"]` rule paints it with
`--vscode-inputOption-activeBackground` at the full 60×48 tool size. Measured fill in the capture:
`rgb(9, 71, 113)` at (1350, 30) — a solid saturated blue block, by far the strongest colour on the
page. `Collapse` / `Expand` next to it are low-contrast grey icons.

Because the toggle is "on" whenever the sidebar is visible, the page looks like a primary button
is permanently pressed, and the eye lands on a view preference before the document or the
Details panel.

Evidence: `research/evidence/preview/editor.png` (1400×900, DPR 1).

Host confirmation: `research/evidence/host/capture-zoom-100-webview.png` (1082×777, DPR 1) and
`research/evidence/host/edit-16-stale-workbench.png` (786 px webview, Chat open) show the same
saturated 60×48 blue block at the top right of the editor, with `Collapse`/`Expand` as low-contrast
grey icons beside it.

## UX impact

Visual hierarchy inverts: the least important control on the strip is the most prominent. On a
narrow host width this is the only saturated element in the whole webview, which competes with
the dirty/invalid toolbar status that users do need to see.

## Actionable fix

1. Style the sidebar toggle with `--vscode-toolbar-activeBackground` (or a 1px outline) instead
   of `inputOption-activeBackground`; reserve the saturated fill for real option toggles
   (`Semantic`/`Strict`).
2. Or make it a plain action icon with a changing tooltip (`Hide sidebar` / `Show sidebar`) and
   no pressed fill.
3. Keep it at 28–32 px like the other chrome controls rather than the 60×48 primary slot.

Not fixed in this task (review only).
