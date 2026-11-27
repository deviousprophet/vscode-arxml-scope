# UX-10 — Light-theme toolbar labels sit at ~3.1:1 contrast

- **Severity:** Major
- **Gate:** Floor — contrast
- **Journey:** A11Y-04 (light theme), A11Y-02 (toolbar labels), EDIT-01/DIFF-03
- **Heuristic:** WCAG 1.4.3 contrast; Nielsen #8 aesthetic and minimalist design
- **Confidence:** High — measured in the real host in both the editor and the diff

## Repro

1. Run the host with the theme scenario:
   `$env:UX_HOST_ONLY='theme-zoom'; node .agents/skills/ux-review/scripts/host/run.mjs`
2. Set `workbench.colorTheme` to **Default Light Modern**.
3. Read the computed colours of `.tool` and `.toolbar` inside the webview.

## Expected

Toolbar labels are small text (10–12 px; the diff labels are 10 px). Floor requires ≥ 4.5:1 for
that text; icons and boundaries need ≥ 3:1. The label colour should come from a VS Code token that
meets the text threshold (for example `--vscode-descriptionForeground`, which is `#717171` in
Light Modern).

## Actual

- `src/webview/styles/tokens.css` defines the muted token in the light block as
  `--tok-dim: color-mix(in srgb, var(--vscode-editor-foreground) 55%, var(--vscode-editor-background))`.
- In Default Light Modern the resolved colour is `color(srgb 0.577255 0.577255 0.577255)`
  (≈ `#939393`) on `rgb(255, 255, 255)`.
- Measured contrast: **3.1:1**. The icons themselves pass the 3:1 UI threshold, the **labels do
  not** pass 4.5:1; the host capture shows faint `Collapse` / `Expand` and the diff labels would be
  equally weak at a width where they are shown.
- Body text in the same theme is fine (11.2:1), so the failure is the muted token, not the theme.

Evidence: `research/evidence/host/deep-theme-light-webview.png`,
`research/evidence/host/deep-theme-light-workbench.png`,
`research/evidence/host/driver-report-deep-all.json` (theme-zoom: `toolContrast: 3.1`,
`tfgRaw`, `tbgRaw`).

## UX Impact

On a light theme the secondary toolbar labels fade into the white surface. A user with low vision,
or anyone on a bright screen, cannot read `Collapse`, `Expand`, `Show all`, `Merge` and the other
labels reliably; they must rely on the icons or hover tooltips.

## Actionable Fix

1. Use `--vscode-descriptionForeground` for label text, or a 75–80 % mix of foreground and
   background, and keep `--tok-dim` for icons/meta only.
2. Add a contrast check for `.lbl` in both light and dark to the design/preview tests.
3. Re-measure the diff labels at 1200 px, where they are visible in the light theme.

Not fixed in this task (review only).
