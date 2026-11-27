# UX-002 — Diff toolbar loses labels at everyday panel widths and becomes ambiguous icon-only

- Severity: Minor
- Journey: DIFF-24, A11Y-06, A11Y-07
- Surface: Semantic diff / toolbar
- Heuristic: usability (discoverability), hierarchy, accessibility (target size)
- Confidence: high (preview + host); tooltips not tested

## Expected

The diff toolbar keeps a readable label on every control until the panel is genuinely too
narrow, and degrades in a way that preserves which control does what. Adjacent controls are
visually distinct, and each target stays at a comfortable size.

## Actual

Captured at the same 900 px height:

- **1400 px** — all 11 controls show icon + label (`Show all`, `Show diff`, `Context`,
  `Semantic`, `Strict`, `Prev diff`, `Next diff`, `Merge`, `Swap sides`,
  `Collapse`, `Expand`).
- **1200 px** — mixed: `Context`, `Semantic`, `Strict`, `Merge` and `Swap sides`
  keep labels; `Show all`, `Show diff`, `Prev diff`, `Next diff`, `Collapse` and
  `Expand` are icon-only. The three square glyphs for Show all / Show diff / Context are
  nearly identical, and Prev/Next arrows sit next to the Swap arrow.
- **1024 px, 800 px, 640 px** — every label is gone. The audit still reports
  `clipped: 0`, because the labels are removed rather than clipped. At 640 px the left group
  is 312 px wide for 11 controls (≈28 px each), below a comfortable pointer target.

The empty right-hand group and the large unused centre mean space is available even when the
labels disappear.

## Repro

1. `node .agents/skills/ux-review/scripts/preview/shotWebview.mjs --state toolbar-1200`
2. Repeat for `toolbar-1024`, `toolbar-800`, `toolbar-640`.
3. Read each `.audit.json` (0 violations, 11 controls, no clipping), then compare the PNGs.

## Evidence

- `research/evidence/preview/toolbar-1200.png`
- `research/evidence/preview/toolbar-1024.png`
- `research/evidence/preview/toolbar-800.png`
- `research/evidence/preview/toolbar-640.png`
- matching `.audit.json` files (toolbar group rects and scroll widths)

## Notes

A split editor at 1200–1024 px is a normal working width, so this is not an extreme case.
Tooltips are the likely workaround, which is why the severity is Minor; the three
indistinguishable square icons are the part that most needs a fix.

## Host confirmation (2026-11-27)

Confirmed in the real host, and it is not diff-only:

- ~780 px webview (`gate-01-editor-workbench.png`): the **editor** toolbar shows only the
  Collapse / Expand / Sidebar icons.
- ~990 px webview (`diff-01-loaded-workbench.png`): the 11 diff controls are icon-only.
- ~1076 px webview (`edit-01-dirty-webview.png`): the editor labels are visible again.

The threshold is therefore between roughly 990 and 1080 px, i.e. inside a normal split-editor
range. The DOM probe also measured the diff buttons at **40 × 48 px** at the narrow width —
wider than the preview's 28 px, but still icon-only. Confidence: **high**.
