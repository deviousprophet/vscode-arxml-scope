# Light-theme toolbar label contrast — implementation evidence

## Change

- `src/webview/styles/tokens.css`
  - Added `--tok-label` next to the existing quiet-source tokens.
  - Plain fallback: `var(--vscode-editor-foreground)` (hosts without `color-mix`).
  - `@supports (color: color-mix(...))`: `color-mix(in srgb, var(--vscode-editor-foreground) 80%, var(--vscode-editor-background))`.
  - `--tok-dim` (55% mix) is unchanged and remains the icon/meta token.
- `src/webview/components/toolbar/toolbar.css`
  - `.tool` text colour now uses `--tok-label` (editor and diff strips share it).
  - `.tool svg` pins the glyph to `--tok-dim` so icons keep the 3:1 UI threshold.
  - `.tool:hover svg` / `.tool[aria-pressed="true"] svg` inherit the interaction colour again.
  - No geometry, width, font-size or display rules changed.
- `src/test/webview/page/uxDocument.test.ts`
  - Pins the `--tok-label` 80% mix, `.tool` label token and `.tool svg` icon token.

No literal colour was introduced; both values derive from `--vscode-editor-*`.

## Measured contrast (WCAG 2.x, `color-mix` in sRGB)

| Theme | Toolbar bg | Label mix | Label contrast | Icon mix | Icon contrast |
|---|---|---|---|---|---|
| Default Light Modern | `#FFFFFF` | `#626262` | **6.1:1** | `#939393` | 3.07:1 |
| Default Dark Modern | `#1F1F1F` | `#A9A9A9` | **7.01:1** | `#7E7E7E` | 4.06:1 |
| Default High Contrast | `#000000` | `#CCCCCC` | **13.08:1** | `#8C8C8C` | 6.25:1 |
| Default High Contrast Light | `#FFFFFF` | `#333333` | **12.63:1** | `#737373` | 4.74:1 |

Host `UX_HOST_ONLY='theme-zoom'`: all checks pass; light label `6.1:1`
(`color(srgb 0.385098 …)` on `rgb(255, 255, 255)`), high-contrast label `13.1:1`.
Note: in VS Code 1.148 Default Light Modern, `--vscode-descriptionForeground`
resolves to `#3B3B3B` (same as the foreground), so the documented 80% foreground
mix is used to keep the muted hierarchy while clearing the text threshold.

## Verification

- `node esbuild.js` — pass
- `npm run check-types` — pass
- `npm run lint` (eslint + `design:lint`) — pass
- `npm test` — 947 passing
- `npm run engine:smoke` — pass
- `npm run rust:test` — pass
- `UX_HOST_ONLY='theme-zoom' node .agents/skills/ux-review/scripts/host/run.mjs` — exit 0; see `host/driver-report.json`
- Preview `editor` and `diff-merge` — audits pass, no violations.
- Preview dark pixel diff (`baseline/` vs `after/`, see `preview-diff.json`):
  - `editor`: 313 / 1,260,000 pixels changed (0.0248%), rows 37–45 only (the label band), max channel delta 43.
  - `diff-merge`: 1,155 / 1,260,000 pixels changed (0.0917%), rows 37–45 only, max channel delta 47.
  - Everything outside the label text is byte-identical.
