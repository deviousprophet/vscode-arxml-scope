# Implementation plan: ECUC viewer document-style redesign

Ordered checklist. Design: `design.md`; reference: `research/reference-artext/`. Contracts:
`../10-14-artext-custom-editor/design.md` (display rules/provider), `../10-14-ecuc-editor-ux/design.md`
(selection/collapse/state/a11y), `../10-14-ecuc-value-editing/design.md` (widget order/`.value`).

**Do not start** until these artifacts are reviewed and `task.py start` has been run.

## Order

- [x] 1. Baseline capture — render the current Tree view for `sample/display-rules` in light/dark/HC
      and store it under `research/visual/tree-baseline/`. The reference capture is already in
      `research/reference-artext/`; compare the document against it before changing CSS.
- [x] 2. `src/editor/renderHtml.ts` — page shell and defaults (`design.md` §2, §5): `data-view="document"`
      on `<body>`, a `#view-toggle` button, the inspector `hidden` by default and
      `#details-toggle aria-pressed="false"`. Keep `#main` the scroll container and the inspector
      outside it.
- [x] 3. `src/editor/renderHtml.ts` — document CSS (`design.md` §3, §4): mono editor font/line height,
      inline row, no two-line grid, no glyph/per-row border/chips, inline metadata, 4ch children,
      decorative `{`/`}` pseudo-elements, module prefix, kind label colours and token colours. Use
      `body[data-view="document"]` selectors only.
- [x] 4. `src/editor/renderHtml.ts` — selection/focus emphasis for document labels/prefixes and the
      existing token spans; ensure a selected/focused line does not keep a low-contrast kind colour.
- [x] 5. `src/editor/renderHtml.ts` — view/details state script (`design.md` §5): validate saved state;
      default `view=document`, `inspectorHidden=true`; apply on load; view toggle and details toggle
      update the body/`hidden`/`aria-pressed` and persist through `getState()/setState()`.
- [x] 6. `src/test/editor/uxDocument.test.ts` — the document markup/CSS/state tests in the table below;
      update the existing `uxPolish`/`uxTree`/`a11y` expectations that assumed the inspector was open
      or the tree was the only view. Do not weaken an assertion to make it pass.
- [x] 7. `docs/ECUC_EDITOR.md` — Document is the default, Tree is the toggle, Details starts hidden,
      the reference capture/post-processing, the token mapping and the limits.
- [x] 8. Visual captures — Document and Tree for `sample/display-rules` in light/dark/HC, plus
      `sample/large`/`sample/huge` in Document view; store under `research/visual/` and record the
      observed differences. Do not call the browser harness a VS Code webview.
- [x] 9. Performance — observe Document view on `sample/large` and `sample/huge` (page build, load,
      filter) and compare with the previous 1.3 s/7.3 s and 45 ms/125 ms observations; record whether
      the document mode regresses. No virtualisation.
- [x] 10. Mutation checks — remove the document default, document CSS, view toggle and hidden-details
      default one at a time; confirm the matching test fails. Record the mutation and failing test.
- [x] 11. Final record — update `implement.md` with AC verdicts, captures, performance, mutations and
      the remaining real-webview gaps; run the full validation.

## Test coverage

| Assertion | Test |
|---|---|
| AC1 — post-processed reference capture | files under `research/reference-artext/`; README command + postprocess; not shipped |
| AC2 — Document is default and one line | `uxDocument`: `data-view="document"`, `.row` document CSS, no grid/glyph/border; visual captures |
| AC3 — token classes/colours | `uxDocument`: document label/value/meta selectors and `--vscode-*` fallback chain; `uxColors` remains green |
| AC4 — content parity | `uxDocument`: all labels/short/variant/hex/context/conditions/annotations still present; `.value` direct child |
| AC5 — View toggle and persistence | `uxDocument`: toggle markup/script; `viewState.view`; `getState/setState` asserted; browser reload observation |
| AC6 — Details hidden by default | `uxPolish`/`uxDocument`: inspector `hidden`, `aria-pressed="false"`, toggle shows, state persisted |
| AC7 — interactions survive | existing `uxTree`, `editing`, `uxFilter`, `uxReveal`, `references` suites; browser click/key observation |
| AC8 — suite/type/lint/harness | `npm run check-types`, `npm run lint`, `npm test`, `npm run preview:check`; mutation table |
| AC9 — large-file performance | `sample/large`/`sample/huge` page build/load/filter observations in Document view |
| AC10 — docs/no core/deps | `docs/ECUC_EDITOR.md`; `src/core/**` untouched; `dependencies` undefined; manifest priority unchanged |

Every assertion must fail when the feature is deleted. A CSS selector test is not a rendered-layout
test; pair each with a capture or a script-level assertion. See `.trellis/spec/frontend/testing.md`.

## Visual verification matrix (in-app browser)

| View | Fixture | Themes | What to look at |
|---|---|---|---|
| Document | `sample/display-rules` | light, dark, hc | one line per entity, braces/indent, token colours, module prefix, no chips/grid |
| Tree | `sample/display-rules` | light, dark, hc | the current tree remains available and unchanged |
| Document | `sample/large` (4,001 nodes) | dark | page load, scroll, filter, collapse, inspector toggle |
| Document | `sample/huge` (12,001 nodes) | dark | stress load and filter; record whether usable |
| Document | `sample/display-rules` | dark | select a module/container/parameter/reference: labels remain readable; details show correctly |

Interactions in Document view:

1. Click a module, container, parameter and reference: select, no text editor; details can be opened.
2. Collapse a container with the twisty; filter a child; clear; the collapse returns.
3. Double-click / Ctrl+Alt+Enter: reveal in the source; tree stays open.
4. Click a reference target: follow; click a value: edit; refusal keeps text.
5. Toggle Document/Tree and Details; reload; both states persist.
6. Keyboard: arrows, Home/End, PageUp/PageDown, Enter, Space, F2, Escape.
7. Light/dark/HC: no invisible token, brace, selection or focus.

## Validation commands

| Purpose | Command |
|---|---|
| Types | `npm run check-types` |
| Lint | `npm run lint` |
| Full suite | `npm test` |
| Harness self-check | `npm run preview:check` |
| Harness | `npm run preview:ecuc` |
| Reference generation (research only) | the `mmx` command in `research/reference-artext/README.md` |
| Large sample | `D:\workspace\sample\large.arxml` |
| Huge sample | `D:\workspace\sample\huge.arxml` |

## Mutation checks

| Mutation | Expected failing test |
|---|---|
| `data-view="document"` default removed | `uxDocument` default-view test |
| document CSS block removed | `uxDocument` document-layout test |
| view toggle removed | `uxDocument` toggle test |
| inspector default changed back to visible | `uxPolish`/`uxDocument` details test |
| document label/prefix removed from the selection emphasis | `uxDocument` contrast/emphasis test |
| module prefix removed | `uxDocument` module-prefix test |

## Done when

- [x] AC1–AC10 pass, with the Document/Tree visual matrix observed and captured.
- [x] `npm run check-types`, `npm run lint`, `npm test` and `npm run preview:check` are green.
- [x] `docs/ECUC_EDITOR.md` matches the default view, toggles, hidden details and reference capture.
- [x] `sample/large`/`sample/huge` Document observations are recorded and honest.
- [x] `src/core/**` untouched, no new runtime dependency/asset, no manifest priority change, no write
      path change.

## Rollback

Set `data-view="tree"` as the default or remove the document CSS block and the view toggle; the tree
view, inspector content, write path and core are untouched. The default-hidden details panel is one
attribute plus the state default. No setting or migration is involved.

## Guardrails

- One DOM, two views. Do not parse `.artext` in the product or run the legacy `mmx` binary from the
  extension.
- Do not hide metadata to make the document look clean; inline all parent §6 fields.
- `.value` stays a direct child of `.row`; the value widget stays the first document listener.
- No colour literal outside a `var(--vscode-*, …)` fallback; no asset/font file.
- The reference capture is research evidence, not a shipped format.
- The browser harness is not a VS Code webview; real theme/focus/performance remains a host check.

## Implementation record (2026-10-27)

### Delivered

- `src/editor/renderHtml.ts`: `<body data-view="document">`, `#view-toggle`, inspector `hidden` by
  default, `#details-toggle aria-pressed="false"`; the document CSS block (monospace editor font,
  inline row, no glyph/chips/fixed column/per-row border, `4ch` children, decorative `{`/`}`,
  hover-revealed twisty, `module` prefix, keyword spans on `schema`/`package` and the Document token
  mapping); selection/focus emphasis extended to labels/prefixes (`:is(...)`); the page's
  `applyView`/`applyInspectorVisibility` with validated defaults and `getState()/setState()`
  persistence.
- `src/test/editor/uxDocument.test.ts` (new): default view, document layout, content parity, token
  mapping, the page's own helpers, defaults/persistence.
- Updated expectations: `uxPolish`, `uxColors`, `render.test`; `uxTree`/interaction suites unchanged
  and green.
- `scripts/preview-ecuc.js`: `?view=document|tree` seeds the saved view for captures; theme presets
  gained `symbolIcon-functionForeground`.
- `docs/ECUC_EDITOR.md`: Document default, Tree toggle, hidden details, reference capture, token
  mapping and the new performance observations.

### Reference

`research/reference-artext/` contains the post-processed `.artext`, the scoped HTML mock and the
README. Generation: `Arxml2Artext.cmd <in> <out>` ? `mmx -M Arxml2Artext.mm -S in -T out -A "sort all
except ..."`, then
`content.replace(/\[([\s\S]*?)\]/g, (_, i) => "[" + i.replace(/\s+/g, "") + "]")`.
Raw `[(A == B)]` becomes `[(A==B)]`. The capture is research evidence, not a product file.

### Visual captures

| View | Path | Themes |
|---|---|---|
| Document | `research/visual/document/display-rules-{light,dark,hc}.png` | light, dark, HC |
| Document | `research/visual/document/large-dark.png`, `huge-dark.png` | dark |
| Tree | `research/visual/tree/display-rules-{light,dark,hc}.png` | light, dark, HC |
| Tree baseline | `research/visual/tree-baseline/display-rules-{light,dark,hc}.jpeg` | before the change |

The captures were taken with headless Edge at a 912x670 CSS viewport against the production harness
page (`?chrome=0&view=document|tree`). They are harness-observed, not VS Code webview screenshots.

### Performance (browser harness, Document view, dark)

| Sample | Rows | DOMContentLoaded | load | filter (`Alpha`) |
|---|---|---|---|---|
| `sample/large` | 4,001 | 609 ms | 688 ms | 54.1 ms (801 shown) |
| `sample/huge` | 12,001 | 1,605 ms | 1,833 ms | 134.1 ms (2,001 shown) |

Previous Tree observations: ~1.3 s / ~7.3 s load and ~45 ms / ~125 ms filter. Document mode is the
same DOM and render pass; the observed cost is comparable and no virtualisation was added.

### Mutation results

| Mutation | Result |
|---|---|
| `data-view="document"` removed | 1 failing (`uxDocument` default view) � restored |
| document row `flex` ? `grid` | 1 failing (`uxDocument` document layout) � restored |
| view toggle removed | 2 failing (`uxDocument`, `uxPolish`) � restored |
| inspector visible by default | 2 failing (`uxDocument`, `uxPolish`) � restored |
| module prefix removed | 2 failing (`uxDocument` layout + prefix) � restored |
| selection-label emphasis removed | 1 failing (`uxDocument`, "a selected/focused label uses the emphasis foreground") � restored |
| document selectors neutralized (`data-view="document-disabled"`) | 2 failing (`uxDocument` layout + token mapping) � restored |

### Validation

- `npm run check-types` � pass.
- `npm run lint` � pass.
- `npm test` � 157 passing.
- `npm run preview:check` � ok for all committed fixtures x themes.
- Focused runs: `editor document view`, `editor visual polish`, `editor semantic colours`,
  `editor interaction`, `editor accessibility` � 43 passing before the palette finalization; 20
  passing after it.

### AC verdicts

| AC | Verdict | Evidence |
|---|---|---|
| AC1 | Pass | `research/reference-artext/` capture + README with command and post-process regex |
| AC2 | Pass | markup/CSS test, `data-view="document"`, captures |
| AC3 | Pass | token selectors/fallbacks test, `uxColors`, dark/light/HC captures |
| AC4 | Pass | content-parity test (labels, short, variant, hex, context, conditions, annotations) |
| AC5 | Pass | toggle markup + page-helper test + persistence assertions; browser reload observation |
| AC6 | Pass | inspector `hidden`, `aria-pressed="false"`, helper test, full-width captures |
| AC7 | Pass | existing interaction/editing/filter/reveal/reference suites green; browser click/filter pass |
| AC8 | Pass | type/lint/test/preview:check green; mutation table above |
| AC9 | Pass | large/huge measurements recorded; no regression mechanism added |
| AC10 | Pass | docs updated; `src/core/**`, dependencies, manifest priority and write path untouched |

### Remaining gaps

- The browser harness is not a VS Code webview: VS Code's own theme-variable resolution, editor font
  metrics/size, focus behaviour and real webview layout/paint remain Extension Development Host
  checks.
- The document is deliberately one line per entity; a very long line scrolls the pane horizontally.
  That is the reference behaviour, not an overflow bug, but it is a real-webview usability item to
  confirm.
- No virtualisation: the huge sample is usable but the whole tree is in the DOM.
