# Toolbar contrast evidence

Derived with the WCAG 2.x relative-luminance formula from `color-mix(in srgb, foreground 80%, background)` for labels and the unchanged 55% mix for icons. Theme foreground/background are the shipped VS Code theme values.

| Theme | Background | Label mix | Label contrast | Icon mix | Icon contrast |
|---|---|---|---|---|---|
| Default Light Modern | #FFFFFF | #626262 | 6.1:1 | #939393 | 3.07:1 |
| Default Dark Modern | #1F1F1F | #A9A9A9 | 7.01:1 | #7E7E7E | 4.06:1 |
| Default High Contrast | #000000 | #CCCCCC | 13.08:1 | #8C8C8C | 6.25:1 |
| Default High Contrast Light | #FFFFFF | #333333 | 12.63:1 | #737373 | 4.74:1 |

Host `theme-zoom` (Default Light Modern): label **6.1:1** (`color(srgb 0.385098 …)` on `rgb(255, 255, 255)`); Default High Contrast label **13.1:1** (204,204,204 on black). Icons in light stay on the original 3.1:1 `--tok-dim` mix; the glyphs were not changed.
