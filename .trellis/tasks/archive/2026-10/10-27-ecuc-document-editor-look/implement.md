# Implementation plan: ECUC document view editor-like visual pass

Ordered checklist. Design: `design.md`; direction prototype: `research/prototype-editor.css` and
`research/prototype-dark.png`. Contracts: archived Document-view task
(`.trellis/tasks/archive/2026-10/10-27-ecuc-viewer-document-redesign/design.md`), value widget and
selection/a11y parent designs.

**Do not start** until the artifacts are reviewed and `task.py start` has run.

## Order

- [x] 1. `src/editor/renderHtml.ts` — editor surface (`design.md` §3): `#tree` editor font size 14px
      fallback, line-height 1.5, 8px top/24px bottom/3.5ch left padding; `.meta` same font size,
      foreground, 3.5ch left; `.row` absolute-positioned twisty/spacer, `gap: 1ch`, no padding,
      border or background; neutral `.label`.
- [x] 2. `src/editor/renderHtml.ts` — gutter/indent (§4): absolute twisty/spacer, children 4ch,
      braces `-4ch`; remove the old `1.2ch` flex track and the
      `calc(-4ch + 1.2ch + 2px)` brace margin.
- [x] 3. `src/editor/renderHtml.ts` — palette (§5): remove per-kind label colours; keep keyword
      module prefix and add `.meta .keyword`; short/string, numeric/hex, boolean; mute variant,
      condition, context, annotation; target foreground with no underline and hover link/underline.
- [x] 4. `src/editor/renderHtml.ts` — selection/focus (§6): override the list-selection background
      and focus background with the editor line highlight; `--ecuc-selection-fg` = editor
      foreground; remove the full outline, add a 2px inset focus edge; keep Tree view rules.
- [x] 5. `src/editor/renderHtml.ts` — value affordance (§7): remove the dotted value underline and
      hover pencil in Document view; keep the tooltip/cursor; normalize `.value-edit` height/font.
- [x] 6. `src/editor/renderHtml.ts` — slim document bar (§8): compact toolbar, filter cap, flat
      buttons and count; Tree view unchanged.
- [x] 7. `src/test/editor/uxDocument.test.ts` — update/extend the document tests: neutral labels,
      target no-underline/hover, `.meta .keyword`, absolute gutter/4ch braces, line-height/font,
      slim bar, subtle selection/focus, no dotted value. Do not weaken the existing default/toggle/
      content tests. Add any new assertion so it fails when the feature is removed.
- [x] 8. `src/test/editor/uxColors.test.ts` / `uxPolish.test.ts` — update expectations that assert
      the old per-kind label colours, target link, dotted value or selection background; keep the
      Tree-view assertions.
- [x] 9. Captures — Document light/dark/HC, Document selected/focused, Tree light/dark/HC. Use
      `npm run preview:ecuc`, `?view=document|tree&chrome=0`, 1200×700 (or the established 912×670
      for comparison) and store under `research/visual/{document,tree}/`. Label harness-observed.
- [x] 10. Docs/specs — `docs/ECUC_EDITOR.md` and `.trellis/spec/frontend/{component-guidelines,
      quality-guidelines,testing}.md` for the editor-like surface, restrained palette, gutter,
      selection and value affordance.
- [x] 11. Mutation checks — the table below; restore after each.
- [x] 12. Final record — update this file with the implementation record, AC verdicts, captures,
      mutation results, full validation; run `npm run check-types`, `npm run lint`, `npm test`,
      `npm run preview:check`; stop the preview server; commit and archive.

## Test coverage

| Assertion | Test |
|---|---|
| AC1 neutral labels + accents | `uxDocument`: `.label` editor foreground; keyword/string/number/boolean/description; no per-kind label rules |
| AC1 target no underline | `uxDocument`: `.target` no `text-decoration`; hover link/underline |
| AC2 editor surface | `uxDocument`: `#tree` font-size fallback 14px, line-height 1.5, row no padding/border/background |
| AC3 gutter/indent | `uxDocument`: absolute twisty, 4ch children, `-4ch` braces |
| AC4 slim bar | `uxDocument`: toolbar padding ≤3px, filter cap, flat tool |
| AC5 selection/focus | `uxDocument`: line highlight + focus edge; no active-selection background in document |
| AC6 value affordance | `uxDocument`/`uxPolish`: no dotted value border or hover pencil; editing suite green |
| AC7 parity/interactions | existing `uxTree`, `editing`, `uxFilter`, `uxReveal`, `references`; full suite |
| AC8 gates/mutations | commands + mutation table |
| AC9 docs/no core | docs/spec diff; `src/core/**` untouched |
| AC10 captures | light/dark/HC + selected/focused + Tree |

Every assertion must fail when the feature is deleted. A CSS selector test is not a rendered-layout
test; pair each with a capture or browser observation. See `.trellis/spec/frontend/testing.md`.

## Visual verification matrix

| View | Fixture | Themes | What to look at |
|---|---|---|---|
| Document | `sample/display-rules` | light, dark, hc | neutral labels, calm accents, gutter, braces, slim bar, no dotted values, no underlined targets |
| Document selected | `sample/display-rules` | light, dark, hc | subtle line highlight, focus edge, readable tokens |
| Tree | `sample/display-rules` | light, dark, hc | unchanged tree chips/columns/selection |
| Document | `sample/large`/`huge` | dark | load/filter still usable; no second render pass |

Interactions to re-check in Document view: click select, twisty collapse on hover, double-click/
Ctrl+Alt+Enter reveal, target follow, value click/F2 edit, filter/clear/empty, copy, keyboard arrows/
Home/End/PageUp/PageDown/Enter/Space.

## Mutation checks

| Mutation | Expected failing test |
|---|---|
| Restore per-kind label colours | `uxDocument` neutral-label test |
| Restore `.target` underline/textLink | `uxDocument` target test |
| Restore dotted `.value` underline | `uxDocument` value-affordance test |
| Put the twisty back in the flex flow | `uxDocument` gutter test |
| Restore the active-selection row bar | `uxDocument` selection test |
| Restore the 6px toolbar padding | `uxDocument` slim-bar test |
| Remove the `.meta .keyword` rule | `uxDocument` header-keyword test |

## Validation commands

| Purpose | Command |
|---|---|
| Types | `npm run check-types` |
| Lint | `npm run lint` |
| Full suite | `npm test` |
| Harness self-check | `npm run preview:check` |
| Harness | `npm run preview:ecuc` |
| Samples | `D:\workspace\sample\{display-rules,large,huge}.arxml` |

## Done when

- [x] AC1–AC10 pass, with the Document/Tree/selected captures observed.
- [x] `npm run check-types`, `npm run lint`, `npm test`, `npm run preview:check` are green.
- [x] Docs and frontend specs match the new surface and palette.
- [x] `src/core/**`, dependencies, manifest priority and the write path are untouched.
- [x] The preview server is stopped; no long-running shell remains.

## Rollback

Remove the document overrides (or set `data-view="tree"` as the default). Tree view, model, write
path and core are untouched; no setting or migration is involved.

## Implementation record (2026-10-27)

### Delivered

- `src/editor/renderHtml.ts`: the Document CSS is now an editor-like surface. Editor font at
  `--vscode-editor-font-size` with a 14px fallback, 1.5 line height, 3.5ch gutter and 4ch children;
  single-line flex rows with `gap: 1ch`, no normal-state padding/border/background; the twisty and
  spacer are absolute in the gutter; braces return to the parent text start with `-4ch`.
- Restrained palette: structural labels use the editor foreground; keywords, string/numbers/hex,
  booleans and annotations keep their accent; variants/conditions/context are muted; reference
  targets are plain until hover; the header uses the editor foreground with keyword spans.
- Quiet selection: `editor-lineHighlightBackground` plus the editor foreground on the selected line,
  and a 2px inset focus edge. No list-selection bar in Document view.
- Values are text: no dotted `.value` underline and no hover pencil in Document view; the tooltip,
  text cursor and click/F2 editing remain. The inline `.value-edit` uses the document font metrics.
- Compact document bar: 3px padding, 240px filter, flat transparent buttons, 11px count. Tree view
  keeps the base bar and its chips/columns/colours.
- `src/test/editor/uxDocument.test.ts`: the document suite (nine tests) updated/added for the
  neutral palette, target hover-only link, gutter, quiet selection, plain values and compact bar.
  Existing default, toggle, content and state tests stay green.
- `docs/ECUC_EDITOR.md` and `.trellis/spec/frontend/{component-guidelines,quality-guidelines,
  testing}.md` updated for the editor-like look and its limits.

### Prototype correction

The first prototype capture still showed the old `.row.k-parameter > .value` dotted underline,
including under `=`. It was removed from `research/prototype-editor.css` and the dark/light captures
were regenerated before implementation; `zoom-values-{dark,light}.png` shows the plain `= true` /
`= 63` values. The implementation removes the same rule and the hover pencil.

### Captures

| View | Path | Theme |
|---|---|---|
| Document | `research/visual/document/display-rules-{light,dark,hc}.png` | light, dark, HC |
| Document selected | `research/visual/document/display-rules-selected.png` | dark |
| Tree | `research/visual/tree/display-rules-{light,dark,hc}.png` | light, dark, HC |
| Direction prototype | `research/prototype-{dark,light}.png`, `zoom-values-{dark,light}.png` | dark, light |

Captured with headless Edge against the production harness page (`?chrome=0&view=document|tree`,
1200x700). Harness-observed, not a VS Code webview.

### Performance (browser harness, Document view, dark)

| Sample | Rows | DOMContentLoaded | load | filter (`Alpha`) |
|---|---|---|---|---|
| `sample/large` | 4,001 | 798 ms | 901 ms | 56.3 ms (801 shown) |
| `sample/huge` | 12,001 | 2,200 ms | 2,512 ms | 119.6 ms (2,001 shown) |

The previous Document run observed 609/688 ms and 54.1 ms, and 1,605/1,833 ms and 134.1 ms. The
latest run is within machine-load variation; the change adds no DOM and no second render pass.
No virtualisation was added.

### Mutation results

| Mutation | Result |
|---|---|
| Restore per-kind label colours | 1 failing � "no module-path label colour" |
| Restore `.target` link + underline | 1 failing � "the target is plain text, not a permanent blue underline" |
| Restore dotted `.value` underline | 1 failing � the `border-bottom: 0` assertion |
| Put the twisty back in the flex flow | 1 failing � "the twisty lives in the gutter, not the text flow" |
| Restore the active-selection row bar | 1 failing � "a document selection is a line highlight, not the list bar" |
| Restore the 6px toolbar padding | 1 failing � the compact-bar assertion |
| Remove the `.meta .keyword` rule | 1 failing � the header-keyword assertion |

All restored from the pre-mutation backup after each run.

### Validation

- `npm run check-types` � pass.
- `npm run lint` � pass.
- `npm test` � 160 passing.
- `npm run preview:check` � ok.
- Focused `editor document view` � 9 passing after the final restore; each mutation run had exactly
  the expected failure.

### AC verdicts

| AC | Verdict | Evidence |
|---|---|---|
| AC1 | Pass | neutral-label/restrained-palette test; target hover-only test; light/dark/HC captures |
| AC2 | Pass | editor-surface test (font/line-height/padding/no chrome); captures |
| AC3 | Pass | gutter/absolute-twisty/4ch/brace test; rendered captures |
| AC4 | Pass | compact-bar test; dark capture at 1200px |
| AC5 | Pass | quiet-selection/focus-edge test; selected capture |
| AC6 | Pass | no-dotted-value/no-hover-pencil test; editing suite green |
| AC7 | Pass | full suite; content parity and interaction tests unchanged |
| AC8 | Pass | type/lint/test/preview:check; mutation table above |
| AC9 | Pass | docs/specs updated; `src/core/**`, dependencies and manifest untouched |
| AC10 | Pass | Document/Tree/selected captures stored; harness limitation stated |

### Remaining gaps

- The browser harness is not a VS Code webview: real theme resolution, editor font metrics, focus
  behaviour and webview paint remain Extension Development Host checks.
- No synthetic line numbers in this pass: the braces are decorative pseudo-elements, so numbering
  only entity rows would misrepresent the file. The gutter is the twisty/fold gutter; real line
  numbers need structural brace rows.
- Long module lines scroll horizontally by design.
- The selected line uses the editor foreground for contrast; its token colours return when the
  selection moves away.
