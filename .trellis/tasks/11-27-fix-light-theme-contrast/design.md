# Design — fix light-theme toolbar contrast

## Owner

The toolbar label token and its consumers in `src/webview/components/toolbar/` and any shared
webview token file. Icons and meta may keep a dimmer token; the label is text and needs 4.5:1.

## Change

- Identify the token behind `.lbl`/toolbar label text (currently `--tok-dim`).
- Make the label use `--vscode-descriptionForeground`, or a `color-mix(... 75–80%, transparent)`
  derived from the foreground token if that is the established pattern.
- Keep icon-only controls on the 3:1 icon token; do not raise every muted element.
- High contrast: verify the chosen token resolves to the HC foreground/description pair; add a
  fallback if the token is missing.
- No hard-coded hex/rgb; no new theme system.
- Do not change label visibility/overflow logic; UX-04 remains child 3.

## Verification

- Host `UX_HOST_ONLY='theme-zoom'`: light labels ≥ 4.5:1, icons ≥ 3:1; dark/HC remain readable.
- Preview `editor`, `diff-merge`: audits unchanged, labels visible at 1400.
- Style-level check: if the token can be computed in one place, assert the light/dark pair.
- Optional: add the measured pair to `DESIGN.md` only if it becomes a shared contract.

## Rollback

Revert the child branch; the token change is isolated.
