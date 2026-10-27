# ECUC editor quiet-source design implementation

## Goal

Implement the **quiet-source** design in `docs/ECUC_EDITOR_DESIGN_SPEC.md` and
`docs/ecuc-editor-prototype.html` on the existing ECUC custom editor. The Document view should read
like a source file: one monospace surface, real source line numbers, a fold gutter, sparse semantic
tokens, hover/focus/selection revealed only when needed, a 26px strip and a quieter details panel.
Tree view keeps its structure (two-line grid, 26ch label column, chips, per-kind glyphs) but shares
the surface language. The design spec and prototype are the **code-review baseline** for this task.

## Reference

- `docs/ECUC_EDITOR_DESIGN_SPEC.md` — the design specification (sections 1–10, implementation mapping
  and acceptance checklist).
- `docs/ecuc-editor-prototype.html` — the static design prototype; `research/prototype-spec.png` is
  the rendered overview.
- `docs/ECUC_EDITOR_DESIGN_CONTEXT.md` — the context and constraints handed to the designer.
- `docs/design/artext-syntax-highlight.png` and the current Document/Tree captures — the visual
  before/after reference.
- `.trellis/spec/frontend/*` — the webview DOM, theme, state and test contracts.

## Scope

**In**

- Document surface: 13px editor font with fallback, 1.55 line height, 4ch indent, horizontal scroll,
  real source line numbers (`data-line`), fold column, collapsed `{ … }` stub, unnumbered header and
  braces.
- 26px strip: compact filter, count only while filtering, collapse/expand icon buttons, a two-state
  `Document | Tree` switch, Details toggle.
- Token system: `--tok-*` variables (keyword, string, number, meta, comment, optional key, punctuation,
  dim), no per-kind colours; selection/hover/focus/editing/invalid states; high-contrast outlines.
- Details panel: docked right, `clamp(260px, 30%, 340px)`, stacked keys/values, flat actions, empty
  state, bottom sheet at ≤720px.
- Tree view surface alignment: strip, typography, shared token values, selection/hover/focus, target
  hover-only underline; keep the two-line grid, chips, glyphs, per-kind accents and dotted values.
- Narrow layout (≤720px): line numbers hidden, 3ch indent, compact strip, bottom-sheet details.
- Tests, docs/specs, captures, mutations; review against the design spec.

**Out**

- Changes to `src/core/**`, parsing, ordering, validation, the write path, the manifest priority or
  the node-id model.
- A second renderer, `.artext` parsing, `mmx`, a new dependency/asset/font, remote loads.
- Removing Tree view, the details panel, the filter, inline editing, reveal/follow, copy or keyboard
  navigation.
- Structural editing, virtualisation, cross-file resolution, soft wrap (deferred by the spec).
- A new `/`/`Ctrl+F` shortcut unless the requester explicitly approves decision D5.

## Requirements

- **R1 — Quiet source.** Document view is one editor-background surface; no chips, cards, filled
  boxes, per-row borders or permanent underlines at rest. Separation is by typeface, hairlines and
  spacing. Chrome is one 26px strip in the UI font.
- **R2 — Honest gutter.** Each entity row carries `data-line` with its real 1-based ARXML source line;
  `#tree` sets `--ln-digits`; header and braces are unnumbered; gaps are acceptable. The gutter has
  line numbers, a fold column and the text start; line numbers use
  `editorLineNumber-foreground`/`activeForeground`.
- **R3 — Fold behaviour.** Expanded chevrons appear only while `#tree` is hovered or focus is inside;
  collapsed chevrons are always visible; collapsed containers show `{ … }` after the row; braces stay
  on their own lines and align with the parent.
- **R4 — Tokens.** Define the `--tok-*` variables from spec §4 on `body[data-view]`; keyword, string,
  number, meta, comment, punctuation, dim, optional key accent; every colour is a `--vscode-*`
  variable with an in-`var()` fallback. No per-kind colours in Document view.
- **R5 — States.** Selection is a tint plus a brighter line number and keeps syntax colours; focus is
  a 2px gutter rail; hover is a tint; targets underline only on hover; parameter values show a hover
  background/cursor and an `F2` hint when selected; editing uses the input chrome; invalid keeps the
  typed text and shows the reason in error colour; high contrast uses outlines, not fills.
- **R6 — Details.** Docked right, hidden by default, width clamp, stacked key/value typography,
  existing content and handlers, empty copy, bottom sheet at ≤720px.
- **R7 — Tree alignment.** Tree view shares the strip, type family/size, `--tok-*` tokens, selection/
  hover/focus treatment, details/empty states and hover-only target underline. Its two-line grid,
  26ch label column, chips, per-kind glyphs/accents and dotted values stay.
- **R8 — Narrow.** At ≤720px hide line numbers, use `--gut: 3ch`, indent 3ch, compact the strip
  (icons/labels as specified), keep Document|Tree, and make Details a bottom sheet.
- **R9 — Accessibility.** Keep tree/treeitem/group roles, aria-level/expanded/selected/posinset/
  setsize, roving tabindex and all keys; focus visible; contrast ≥4.5:1 for body/tokens, ≥3:1 for
  hints; no colour-only cues; reduced motion stepped flash; high-contrast outlines.
- **R10 — Preserve contracts.** `.value` direct child; first-listener value widget and
  `stopImmediatePropagation`; `.row-meta` as the inspector source; node ids/`matchRanges`; state keys
  `{ view, inspectorHidden }`; one DOM/two views; no core/write/manifest changes; no new dependency/
  asset/font/remote load; no `.artext`.
- **R11 — Review baseline.** The implementation must be reviewable against
  `docs/ECUC_EDITOR_DESIGN_SPEC.md`; any deviation/deferment is recorded in the task implementation
  record with the reason.

## Acceptance Criteria

- [x] **AC1** Document view matches spec §2.2/§3: 13px fallback, 1.55 line height, 4ch indent,
  horizontal scroll, gutter line numbers from real source lines, unnumbered header/braces, collapsed
  `{ … }` stub. Captures show dark/light/HC.
- [x] **AC2** The token system from spec §4 is implemented with `--tok-*` variables and fallbacks;
  Document labels are neutral (or the approved D1 key accent); no per-kind colours.
- [x] **AC3** The strip is 26px with the specified filter/count/icons/Document|Tree/Details order and
  behaviour; all existing actions still work.
- [x] **AC4** Hover, selected, selected+focused, focus-visible, editing, invalid, collapsed, filtered,
  follow/reveal and high-contrast states match the spec's matrix; token colours stay on selection.
- [x] **AC5** Details panel matches spec §2.3: width clamp, stacked keys/values, existing actions,
  empty state, bottom sheet at ≤720px.
- [x] **AC6** Tree view surface is aligned (strip, typography, tokens, states, hover-only target
  underline) while its structure, chips, glyphs, accents and dotted values remain.
- [x] **AC7** Narrow layout matches spec §7 and remains usable at 360px.
- [x] **AC8** Accessibility/contrast/reduced-motion/HC checks pass; no colour-only cue.
- [x] **AC9** `npm run check-types`, `npm run lint`, `npm test`, `npm run preview:check` are green;
  new/updated document tests fail when the spec features are removed.
- [x] **AC10** Docs/specs updated; `src/core/**`, dependencies, manifest priority and the write path
  untouched; no new literal colour outside a `var()` fallback (existing `#80808040` excepted).

## Decisions (recommended; confirm before start)

- **D1 — key accent:** keep the single `--tok-key` accent on parameter/reference labels
  (`symbolIcon-variableForeground`). Recommended; one variable reverts to fully neutral.
- **D2 — line numbers:** show real source line numbers via `data-line`; recommended.
- **D3 — F2 hint:** show the muted `F2` hint on the selected parameter line; recommended.
- **D4 — Tree alignment:** align the Tree surface (strip/typography/tokens/states/target hover) but
  keep chips, glyphs, per-kind accents and dotted values; recommended.
- **D5 — filter shortcut:** defer the optional `/` and `Ctrl+F` filter shortcut in this task to avoid
  a new keybinding conflict; recommended.

## Constraints

- Presentation only; no new framework, dependency, asset, font or remote load.
- All colours are `--vscode-*` variables with in-`var()` fallbacks; `color-mix` is allowed (VS Code
  1.143 test host supports it) with a plain-variable fallback noted.
- CSP nonce: inline styles/scripts only; inline SVG allowed.
- One DOM, two views; no second renderer.
- The spec's "does not change" list is binding; the design spec and prototype are the review baseline.
