# Design review for VS Code extension UI

The floor/reflex/finish gate names are internal review language, adapted for a desktop IDE.
Marketing-page rules, themes, photography and web-layout heuristics are deliberately not
imported. VS Code's design system and this repository's `DESIGN.md` win on every conflict.

Use this reference after the Preview and Host evidence exists, before scoring. It is a review
lens, not a second style system.

## Stance

- The product is an IDE surface, not a landing page. Density, scan speed, keyboard path and
  truthful state matter more than a hero, a composition or a scroll reveal.
- Every surface inherits VS Code: theme tokens, font, zoom, side bar, panel, command palette,
  focus behaviour and high-contrast mode.
- A design finding is still a user-facing defect. It is not a taste note unless it is explicitly
  a Finish finding.
- Review the rendered result first; read source only to locate a cause or quote copy.

## Floor gates — never waivable

A Floor failure is a defect even when the feature works.

1. **Theme tokens only.** Colours, surfaces, borders, focus and typography come from
   `--vscode-*` variables or the repository's declared tokens. No literal hex/rgb colour or
   hard-coded `font-family` outside the token block. Light, dark and high-contrast are derived,
   never inverted.
2. **Contrast.** Body text ≥ 4.5:1; large text, icons and UI boundaries ≥ 3:1; the focus ring
   ≥ 3:1 against both the control and its background.
3. **Keyboard and focus.** Every interactive control is reachable and operable by keyboard,
   in visual order, with a visible `:focus-visible` ring. Nothing is hover-only. No keyboard
   trap; Escape closes overlays.
4. **Reduced motion.** Every animation has a `prefers-reduced-motion: reduce` fallback. Never
   `transition: all`; never animate `width`, `height`, `top` or `left`.
5. **Truthful state.** Never say saved, copied, restarted or complete before the host
   acknowledges it. No invented counts, health or success. A failed save keeps the draft and
   markers; a success is shown by the result, not by a hopeful toast.
6. **State completeness.** For every custom control: default, hover, focus, active, disabled,
   loading, error and success. Disabled explains why; loading keeps the layout stable; error
   says what broke, why and what to do; success comes from the real result.
7. **Layout integrity.** No horizontal page scroll; no clipped, overlapping or off-pane control
   at realistic webview widths (about 786, 1082 and 1400 CSS px) and at 80/100/120/150% zoom.
   No `100vw`; no fixed pixel layout that ignores VS Code zoom.
8. **Recovery.** Reversible actions offer undo; destructive ones confirm. A stale/refused state
   has a discard, reload or retry path. No dead end where the user cannot get back to a clean
   state.

## Reflex gates — defaults to challenge

These are common machine-made defaults. A real product reason may overrule one on the record,
but the finding must name the reason.

- Toolbar labels vanish into anonymous icons at an ordinary width while half the row is empty;
  Merge/primary actions become glyphs; no labelled overflow.
- The same refusal is painted in three or four places with different colours, or a top strip
  contradicts the field.
- A disabled control is rendered as pressed/on, or an inert control keeps a focus/pressed state.
- Status is colour-only; decorative dots, badges or tint compete with real state.
- A view toggle is the loudest element on the page; nested cards/inset boxes add chrome without
  grouping.
- Placeholder used as a label; bare "No results" without what/why/action.
- Generic error copy, protocol constants, developer commands (`npm run …`) or internal ids in
  user-facing text.
- A success toast when the result is already visible; an optimistic save/copy with no rollback.
- `transition: all`; layout-animating properties; hover-only affordances; pixel breakpoints that
  ignore the editor's zoom/font settings.
- Duplicate navigation/steps for one goal; a command that requires leaving the surface to finish
  the obvious next step.

## State stability

A state can be correct in isolation and still move the interface when it appears. Compare a
baseline state with each variant at the same viewport and require stable controls to keep their
x/y/width/height (within 1 px), order and visible identity. Exclude only controls the state
intentionally shows/hides. Cover clean → dirty/invalid/stale, default → hover/focus/disabled/
loading/error, merge/sidebar/find/selection/swap, theme and zoom. A status, label, count, error or
loading indicator must take a stable slot; it must not push a toolbar/action under the pointer.
One unintended transition is one finding. See
[`STATE_STABILITY.md`](STATE_STABILITY.md) and the `state-diff.mjs` probe.

Floor when the movement blocks the action or moves a control under the pointer during a primary
action; Reflex otherwise.

## Finish checks — craft, not blockers

- Alignment, spacing and density are even; no orphan controls or one-off gaps.
- Icon set and tooltips are consistent; the label, tooltip and aria-label agree.
- Empty, loading and error copy is specific; counts are real (`1 of 3`, not `? of 3`).
- Row markers, dirty markers, copied markers and pane/sidebar state use one visual language.
- Focus order, reading order and visual order agree; the active surface is obvious.
- Copy is sentence case, specific and free of internal jargon.

## Scoring

- **Floor failure** → at least Major; a blocked primary loop, data-loss risk or inaccessible
  control is Critical.
- **Reflex failure** → Major when it blocks recognition/recovery, Minor otherwise.
- **Finish finding** → Minor.

Map the result into the existing four dimensions; do not add a fifth score:

| Gate | Usability | Visual hierarchy | Accessibility | Flow |
|---|---|---|---|---|
| Theme/contrast/focus | ✓ | ✓ | ✓ | |
| Truthful state/state completeness | ✓ | | ✓ | ✓ |
| Layout integrity | | ✓ | ✓ | ✓ |
| Recovery | ✓ | | | ✓ |
| Reflex chrome/copy | ✓ | ✓ | | ✓ |
| Finish craft | | ✓ | ✓ | |

## Cold review method

The thread that built the page is its weakest reviewer.

1. Give a fresh-context reviewer the evidence only: workbench + webview screenshots at the
   measured widths/zoom, the preview audits, the journey row, and the relevant source path.
2. Do not explain the intent first. Read the screenshot before the source.
3. First word: `rebuild` (the surface fails the idea or the system), `fix` (findings follow) or
   `ship` (nothing owed).
4. At most eight findings, ranked by user cost, each naming the gate and the location.
5. Name what must not be diluted while fixing.
6. The cold reviewer must not fix; the main session records dispositions.

IDE-specific checks the cold reviewer must make: keyboard-only path, focus ring, 80/120/150%
zoom, high-contrast, side bar/auxiliary bar widths, and whether the same action is duplicated.

## What not to import from web design guidance

- 44×44 touch targets as a universal rule (desktop pointer targets are smaller; keep the actual
  VS Code control size and a comfortable hit area).
- Marketing hero, 80-word screen budget, 50 themes/photography, scroll choreography, page
  sections, brand voice, or the "no eyebrow/tracked caps" rules as universal constraints.
- 320–1920 page breakpoints; use the extension's real panel widths and VS Code zoom.
- Any rule that would fight VS Code's own chrome, theme variables or accessibility behaviour.
