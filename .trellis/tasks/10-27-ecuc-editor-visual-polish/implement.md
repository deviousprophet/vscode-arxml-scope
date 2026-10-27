# Implementation plan: ECUC editor visual preview and UI polish

Ordered checklist. Design: `design.md`; the contracts this must not break are in
`../10-14-ecuc-editor-ux/design.md`, `../10-14-artext-custom-editor/design.md` and
`../10-14-ecuc-value-editing/design.md`.

**Do not start** until these artifacts are reviewed and `task.py start` has been run.

## Order

The harness comes first: it is the measuring instrument for everything else. The baseline captures are
taken **before** any production UI edit, so the "after" set is a real comparison rather than a
reconstruction.

- [x] 1. `scripts/preview-ecuc.js` + `package.json` — the harness (`design.md` §1): a
      `127.0.0.1`-only server over the production `renderHtml`, fixture/theme/sort query parameters, a
      stubbed `acquireVsCodeApi`, the preview panel (re-scan, value-changing re-scan, notices, message
      log, clear), `?chrome=0`, and `--check` for every fixture × theme plus a live HTTP request.
      Add `preview:ecuc` and `preview:check`; no dependencies.
- [x] 2. Baseline captures — open the harness in the in-app browser and capture `render.arxml` and
      `navigation.arxml` in light, dark and high-contrast themes at the available **912 × 670** (the
      planned 900 × 700 and 1400 × 900 sizes were not produced; see deviation 13). Store them under
      `research/visual/before/` and write down what is actually wrong in `implement.md` before changing
      production code. This is the gate for the UI work.
- [x] 3. `src/editor/renderHtml.ts` — the page shell (`design.md` §2.1): wrap `#main` in `#content`,
      add the `#inspector` aside, the details toggle (and `aria-pressed`/`aria-controls`), the
      responsive stack for narrow panels, and the empty-state placement. Keep `#main` the scroll
      container and keep `renderTree` as the swapped region.
- [x] 4. `src/editor/renderHtml.ts` — the row grid (`design.md` §3): split `ItemSpec` into
      `valueHtml` + `meta`, wrap secondary text in `.row-meta`, add `has-value`/`no-value`, put the
      value first, and apply the grid/ellipsis CSS. Keep `.value` a direct child of `.row`.
      Update `src/editor/filter.ts`'s `highlightableSpans` to reach `.row-meta .short`, and update the
      tests that assumed `.short` was a direct child. Do not change `matchRanges`.
- [x] 5. `src/editor/renderHtml.ts` — the inspector (`design.md` §2.2–2.4): emit the data attributes,
      add `updateInspector()` to the page script, build the panel with `textContent`, wire selection,
      re-render, initial focus, the details toggle, Reveal, Copy path and Copy value. The copy buttons
      post `{ type: 'copy', text }`; they do not write anything.
- [x] 6. `src/editor/renderHtml.ts` + `src/editor/ecucEditorProvider.ts` — source positions
      (`design.md` §4): add `lineIndex` to `RenderOptions`, pass it from the provider on first paint
      and in `push()`, emit the six range data attributes, and display 1-based `Lline:column` in the
      inspector.
- [x] 7. `src/editor/clipboard.ts` + `src/editor/ecucEditorProvider.ts` — the copy path
      (`design.md` §5): `copyText(clipboard, text)` with a stub-friendly signature, the `copy` message
      branch, and the success notice. Do not touch the document.
- [x] 8. `src/editor/filter.ts` + `src/editor/renderHtml.ts` — toolbar and empty state
      (`design.md` §6): the filter clear button, `data-state` on the count badge, the `#empty` block,
      fresh lookup after a re-render, the delegated clear action, and the toolbar icons/focus styles.
      Clearing must still restore the collapsed set.
- [x] 9. `src/editor/renderHtml.ts` — theme robustness (`design.md` §7): font stacks and sizes with
      fallbacks, non-transparent fallbacks where a theme may omit a variable, focus rings, and the
      inspector/sidebar colours. No colour literal outside a fallback.
- [x] 10. Tests — add `src/test/editor/uxPolish.test.ts` and `src/test/editor/copy.test.ts` (or fold
      the copy tests into the same file if they read better). Cover the table below. Update the
      existing selectors that moved with `.short`; do not weaken an assertion to make it pass.
- [x] 11. Mutation checks — break each new feature one at a time (inspector shell, line data, grid
      class, empty state, copy branch, details toggle) and confirm the matching test fails. Record the
      mutation and the failing test in `implement.md`.
- [x] 12. `docs/ECUC_EDITOR.md` — document the details panel, Reveal/Copy, the empty state, and the
      preview command with its stubbed-host limitation. Update the UX task's manual-verification table
      with what the harness observed and what still needs a real Extension Development Host.
- [x] 13. After captures — repeat the baseline matrix against the finished UI at the same available
      912 × 670 (see deviation 13), store the captures under `research/visual/after/`, and write the
      observed differences and any remaining visual concern in `implement.md`. Do not call a row
      verified in VS Code when only the browser saw it.

## Test coverage

| Assertion | Test |
|---|---|
| AC1 — the harness serves the real page and `--check` is green | `preview:check`: every fixture × theme, live `/health` + `/preview`, whitelist, no dependency |
| AC2 — re-scan preserves collapse/selection/scroll; the log records messages | in-app browser observation, recorded in `implement.md`; the page's existing `reRenderTree` test stays green |
| AC3 — before/after captures exist for 2 fixtures × 3 themes | files under `research/visual/**`, referenced in `implement.md` |
| AC4 — inspector fields and correct source range | `uxPolish`: `#inspector` shell; each row's `data-definition-ref`/`data-short-name`/`data-value`/`data-target`/`data-line`/`data-column`; a `LineIndex` unit assertion on a known fixture; browser observation for the panel update |
| AC5 — Reveal/Copy post the right message; the host copies exactly | `uxPolish`: the script's reveal/copy branches; `copy.test`: `copyText` with a stub clipboard receives the exact text and returns the notice |
| AC6 — two-line grid, aligned value, direct `.value` | `uxPolish`: `.row.has-value`/`.no-value`, `.row-meta`, `.value` direct parent, ellipsis CSS; the existing widget/filter selectors stay green |
| AC7 — clear button, count state, empty state, collapsed restore | `uxPolish`: the markup and script branches; `uxFilter` units for `matchRanges`/filter tree; browser observation for the DOM pass |
| AC8 — details toggle and survival | `uxPolish`: `aria-pressed`/`aria-controls`, `hidden`; the shell is outside `#main` so it survives a swap |
| AC9 — theme variables, no dependency, no asset | `uxPolish`: the CSS fallback chain and the `package.json` dependency check; captures for the three themes |
| AC10 — types, lint, full suite, mutation checks | the three commands; the mutation table below; the existing no-takeover/widget-order tests |
| AC11 — docs and honest manual rows | `docs/ECUC_EDITOR.md` review; the UX task's table updated |

Every assertion must fail when the feature is deleted. A test that only asserts a class name appears
is not evidence that the interaction works; pair each markup assertion with the behaviour it stands
for. See `.trellis/spec/frontend/testing.md`.

## Visual verification matrix (in-app browser)

Run against the real page served by the harness. Record the result, the viewport and the capture path.

| Fixture | Themes | What to look at |
|---|---|---|
| `editor/render.arxml` | light, dark, hc | module/container/parameter/reference rows, values, hex, conditions, annotations, indentation, selection/focus, inspector for all four kinds |
| `editor/navigation.arxml` | light, dark, hc | long reference targets, context, follow affordance, filter match inside a collapsed ancestor, empty state |

Interactions to exercise in each theme (where meaningful):

1. Click a module, a nested container, a parameter and a reference: the inspector follows, the tree
   stays open, no text editor appears.
2. Hover a row, a value and a reference target: hover background, edit affordance, follow affordance.
3. Collapse a container, type in the filter, clear it: the ancestor expands for the match and the
   collapse returns.
4. Filter to nonsense: the count says `No matches`, the empty state appears, its clear action restores
   the tree.
5. Collapse a container, press **Re-scan**: it stays collapsed and the selection/scroll survive; press
   **Re-scan with value change**: the value updates and the tree does not spring open.
6. Toggle Details off and on: the tree widens, the panel returns, the selection is intact.
7. Reveal and both Copy actions: the message log shows the exact messages; the copy text matches the
   inspector.
8. Keyboard: arrows, Home/End, PageUp/PageDown, Enter, Space, F2, Escape in the filter.
9. Resize to 700 px wide: the inspector stacks, the toolbar wraps, nothing overlaps.

## Validation commands

| Purpose | Command |
|---|---|
| Types | `npm run check-types` |
| Lint | `npm run lint` |
| Full suite | `npm test` |
| Core suites only, after `npm run compile-tests` | `npx mocha --ui tdd "out/test/core/*.test.js"` |
| Harness self-check | `npm run preview:check` |
| Harness | `npm run preview:ecuc` |

## Mutation checks

Apply each mutation to `src/**`, run the full suite, restore the file, and record the failing test.

| Mutation | Expected failing test |
|---|---|
| `#inspector` removed from `renderHtml` | `uxPolish` inspector shell |
| `data-line`/`data-column` removed from `item()` | `uxPolish` source positions |
| `.row-meta` wrapper removed (secondary text back to direct children) | `uxPolish` grid contract; filter selector test |
| `#empty` removed from `renderTree` | `uxPolish` empty state |
| `copy` branch removed from the provider | `copy.test` |
| details toggle's `aria-pressed`/`hidden` wiring removed | `uxPolish` toggle |
| `.value` moved behind a wrapper | the existing value-widget/filter tests |

## Done when

- [x] AC1–AC11 pass. The visual matrix was observed and captured for the rows recorded above at
      912 × 670; the planned 900 × 700/1400 × 900 sizes, the keyboard map, the focus ring and the
      700 px stacked layout remain CSS/test-asserted only (see "What the harness still cannot verify").
- [x] `npm run check-types`, `npm run lint`, `npm test` and `npm run preview:check` are green.
- [x] `docs/ECUC_EDITOR.md` matches the new panel and the preview command.
- [x] The UX task's seven manual rows say what the harness observed and what is still unverified in a
      real VS Code webview.
- [x] No new runtime dependency, no asset file, no `src/core/**` change, no document write from the
      inspector or the copy path.

## Rollback

The UI changes are additive within `src/editor/` plus one host message and two dev scripts. If the
grid or the inspector proves wrong, revert `renderHtml.ts` and `filter.ts` together; the harness and
`clipboard.ts` are independent. `src/core/**` is untouched, so parsing, ordering and validation
cannot be affected. There is no setting and no migration to roll back.

## Guardrails

- The preview must wrap the production output; a second renderer is the failure mode this task must
  not create.
- `.value` stays a direct child of `.row`. The widget, `highlightableSpans` and `editing.test.ts`
  all depend on it.
- The value widget's listeners stay first and keep `stopImmediatePropagation`; the tree's new click,
  key and inspector handlers must not steal an event the widget claimed.
- `matchRanges` remains the only definition of a match; filtering and `<mark>` highlighting share it.
- The inspector builds text nodes, never `innerHTML` from model text.
- No colour literal outside a `var(--vscode-*, …)` fallback; no new asset, font or runtime dependency.
- Do not touch `src/core/**`, the write path or the manifest `priority`.
- Anything the browser harness cannot prove is recorded as harness-observed or unverified. Never
  imply a real VS Code webview behaviour passed when it was not run there.

---

# Baseline visual review (before production UI changes)

Captured with the harness on 2026-10-27 in the in-app browser. CSS viewport was **912 × 670** (the
screenshots are 1140 × 838 at the app's device scale). Files:
`research/visual/before/{render,navigation}-{dark,light,hc}.jpeg`.

## What is actually wrong

1. **The module's primary label is truncated.** In `render.arxml`, `PkgA.PkgB.ModDefs.ModX` renders
   as `PkgA.PkgB.ModDefs.Mo…` because the label column is a fixed 22ch. The full path exists only in
   the node's `title` tooltip. `navigation.arxml` happens to fit because its path is shorter, so this
   is a real-file failure waiting to happen, not a cosmetic nit.
2. **Rows have one line, so metadata competes with values.** The module row reads as a single long
   sentence: path, `"ModX"`, `(VariantPreCompile)`, two condition spans and an annotation. The
   parameter rows put the value and its hex/conditions inline after the label. There is no visual
   second level; every field has the same weight.
3. **The value column has no stable meaning for non-value rows.** A container's short name starts
   where a parameter's value starts, so the eye cannot use the column as a value column.
4. **The toolbar is visually part of the tree.** The filter is a 240 px box whose placeholder is
   clipped (`Filter labels, short names and value…`), there is no clear button, and the count is
   invisible until a filter is typed. The expand/collapse buttons are plain text at the far right.
5. **The right ~60% of the view is unused.** There is no selected-node details view, no visible
   Reveal, no Copy. The only way to see the full definition path or source location is a hover
   tooltip; the only way to reveal is a double-click or a key, which is not discoverable.
6. **The schema/package context is quiet but unstructured.** It is two gray lines with no separation
   from the tree; it is the only cue for which file/package is open.
7. **Duplicate short names are only distinguishable by position.** `navigation.arxml` has `X/Dup` and
   `Y/Dup`; the tree shows two identical `"Dup"` rows. The inspector must show the full path and the
   line range so a user can tell which one is selected.
8. **High-contrast capture looks acceptable.** The condition text in the JPEG has blue fringing from
   chroma compression, but the computed style is white; no contrast defect was observed. Selection and
   focus were not exercised in the baseline; check them after the UI pass.
9. **No horizontal scrolling at this width,** but the filter placeholder is clipped and the module
   row's metadata extends to ~900 px; a longer annotation would push past the viewport.

## What the baseline does not show

- No selection or focus state was captured; the baseline is a cold render.
- No filter, collapse or keyboard interaction was captured; those are in the after matrix.
- The browser harness supplies VS Code variables; it does not prove VS Code's own theme resolution.
  The condition-color fringing above is a JPEG artifact, not evidence of a product color.

## Decisions taken from the baseline


- The label column becomes `26ch` for rows with a value and spans both tracks for rows without one.
  This fixes the truncated module path without losing value alignment. (Design §3.2 corrected from
  the original per-row `fr` tracks, which would not align across rows.)
- The hex moves into the second metadata line; it is secondary information and a trailing `auto`
  column would have shifted the value column on rows without a hex.
- The details inspector is the place for the full definition path, source range and actions; the tree
  keeps the compact label so a real file with deep paths stays scannable.
- The toolbar gets a real filter width, a clear button, a count badge and a details toggle; the filter
  placeholder is shortened only if the wider box still clips it.
- The empty state and selection states were checked in the after matrix. The focus ring and the
  700 px stacked layout were CSS-asserted only; the browser viewport was 912 × 670, so they are
  listed under "What the harness still cannot verify", not claimed as observed.

---

# Implementation record (all 13 items done; deviations in "Decisions beyond the design")

## Validation (final state)

| Command | Result |
|---|---|
| `npm run check-types` | clean |
| `npm run lint` | clean |
| `npm test` (compile-tests + esbuild + lint, then the real host) | **147 passing, 0 failing** |
| `npm run preview:check` | **ok** — 20 fixtures × 3 themes, plus the server/theme/fixture/dependency checks |
| `npm run preview:ecuc` | serves the real page at `http://127.0.0.1:4173/` |

Baseline was 134; the 13 added tests are `uxPolish` (10) and `copy` (3). The 131→134→147 numbers
are the UX child's check plus this task, not a changed baseline.

## What was built

- **Harness** — `scripts/preview-ecuc.js`, plain Node, built-ins only. It reads a whitelisted
  committed fixture, calls the production `renderHtml`, and wraps that exact output with
  a stubbed `acquireVsCodeApi`, a theme preset, a preview panel and a message log. Fixture/theme/sort
  selectors, Re-scan, Re-scan + value, info/warn notices, Clear log, `?chrome=0` and `--check`.
  It binds to `127.0.0.1`, never serves arbitrary files, and is not imported by the extension.
- **Details inspector** — `renderHtml` emits `#inspector` outside `#main`, with a toolbar toggle,
  `aria-pressed`/`aria-controls`, and a script that builds the panel from model-derived data
  attributes and text nodes (never `innerHTML` from model text). It shows kind, label, full
  `DEFINITION-REF`, short name/variant, value/hex, target/context, conditions, annotations and
  `Lline:column` source range, with Reveal/Copy path/Copy value (or Copy target).
- **Source positions** — `RenderOptions.lineIndex`; the provider passes a fresh `LineIndex` on first
  paint and every `push()`. Data attributes are 0-based, the panel displays 1-based.
- **Row grid** — a fixed `26ch` label column, a value column and a second `.row-meta` line; values
  remain direct children of `.row`; long labels/values ellipsize; the value title carries the full
  value.
- **Toolbar/filter** — clear button, count badge (`none`/`filtered`/`empty`), a real empty state with
  a delegated Clear action, and the Details toggle.
- **Selection contrast** — selected rows use the theme's active/inactive selection foreground for
  token-coloured value/metadata spans; light selected contrast went from 1.25–1.33:1 to 6.11:1.
- **Copy path** — `src/editor/clipboard.ts` (`copyText` with a stub-friendly clipboard interface) and
  the provider's `{ type: 'copy', text }` branch. It does not touch the document.
- **Density fixture** — `src/test/fixtures/editor/large.arxml` (synthetic, 51 nodes) for the scroll
  and density checks. It is not in the core expected-model list; only the harness uses it.

## Visual verification (in-app browser)

Viewport was **912 × 670 CSS px** (captures 1140 px wide at the app's device scale). The harness
served the real page with stubbed VS Code variables; the browser DOM is real, but this is **not** a
VS Code webview.

### Captures

`research/visual/before/`: `render-{dark,light,hc}.jpeg`, `navigation-{dark,light,hc}.jpeg`.

`research/visual/after/`: `render-{dark,light,hc}.jpeg`, `navigation-{dark,light,hc}.jpeg`,
`render-{dark,light,hc}-selected.jpeg`, `render-dark-module.jpeg`, `render-dark-refusal.jpeg`,
`large-dark.jpeg`, `filter-empty-dark.jpeg`, `hover-dark.jpeg`, `render-{light,hc}-empty.jpeg`.

### Observations

- **Baseline → after.** The module path `PkgA.PkgB.ModDefs.ModX` was truncated at 22ch; with the
  fixed 26ch label on value rows and the label spanning both tracks on module/container rows, it is
  fully visible. Values and hex are on separate lines; the tree no longer reads as one long sentence.
- **Inspector.** Clicked a module, `ContA`, `IniValue` and `PeerIref`; the panel showed the right
  kind, definition, short name/variant, value/hex, target/context, conditions/annotations and source
  range. Example: `IniValue` → `L54:41 - L57:70`; `PeerIref` → target
  `/PkgA/PkgB/ModX/ContA/ContB`, context `PkgA.PkgB.ModX.ContA`.
- **Reveal/Copy.** The inspector buttons produced the exact messages:
  `{type:'reveal', nodeId:…}`,
  `{type:'copy', text:'/PkgA/PkgB/ModDefs/ModX/ContA/IniValue'}`,
  `{type:'copy', text:'63'}`.
- **Filter.** `inivalue` → `3 of 9` visible and one `<mark>`; the ancestor `ContA` expanded while the
  filter was active and returned to `aria-expanded="false"` on clear. A nonsense query showed the
  empty state and `No matches`; its Clear action restored all 9 rows.
- **Refusal.** Clicked `IniValue`, typed `garbage`, Enter: the input stayed open with `garbage`; a
  simulated warn notice set `aria-invalid="true"`, kept the red border and the text. The real host
  refusal is `editing.test` AC6.
- **Re-scan / scroll.** In `editor/large.arxml` (51 nodes, 1665 px content, 634 px viewport),
  collapsed `Cont04`, scrolled to 180, selected `Beta`, dispatched a `model` re-scan: the container
  stayed collapsed, the selection and inspector stayed, and `scrollTop` was still 180.
- **Details persistence.** Toggled Details off; `localStorage` held
  `{"inspectorHidden":true}`; navigating to another fixture kept the panel hidden and
  `aria-pressed="false"`. Toggling it back wrote `false`.
- **Layout/contrast.** No horizontal scroll at 912 CSS px (`body` and `#main` scrollWidth ==
  clientWidth). Selected-row contrast: light 6.11:1, dark 11.99:1, HC 21:1 after the selection
  foreground fix. Hover on `IniValue` showed the row background and the pencil affordance.
- **Themes.** Light, dark and high-contrast captures are legible; the empty-state badge uses
  `inputValidation-warningBackground/Border`, so it reads in all three.

### What the harness still cannot verify

- A real VS Code webview's theme-variable resolution and contrast borders (the harness themes are
  approximations), the real custom-editor tab/column/focus behaviour, and the double-click reveal
  gesture. The UX task's manual table was updated with the same distinction.
- The host clipboard permission/actual system clipboard. `copyText` is unit-tested with a stub; the
  harness logs the exact message and attempts the browser clipboard. The provider's copy-failure
  notice branch is source-asserted only; the helper's rejection path is unit-tested.
- The real host's `getState`/`setState` persistence across a webview reload. The harness observes the
  same page path with a localStorage-backed stub, which is not VS Code's webview state.
- Keyboard focus rings and focus styling: the CSS is asserted and the harness supplies `focusBorder`,
  but no focused capture was taken.
- The exact 900 × 700 and 1400 × 900 capture sizes: the in-app browser viewport was 912 × 670, and the
  700 px stacked layout was not visually exercised (the media query is CSS-asserted only).
- The tree keyboard map (arrows, Home/End, PageUp/PageDown, Enter, Space, F2) is asserted by the
  existing `uxTree` tests but was not exercised in the browser pass; the filter input and the edit
  commit were.
- Real large-file performance; `large.arxml` is a density fixture, not a benchmark.

## Mutation checks

Focused suites: `editor visual polish` + `editor clipboard copy` (12 passing, 1 failing per mutation;
after each restore, 147 passing). Each mutation was applied to `src/**`, compiled, tested and the
file restored.

| Mutation | Failing assertion |
|---|---|
| `#inspector` shell removed | `uxPolish` — the page has a details inspector outside the re-rendered tree region |
| `data-line`/`data-column` removed | `uxPolish` — the parameter carries its real source position |
| `.row-meta` wrapper removed | `uxPolish` — the secondary fields have their own line |
| `#empty` block removed | `uxPolish` — the filter has a clear button, a count state and an empty state |
| provider `copy` branch removed | `copy` — the provider recognises the copy message |
| details-toggle wiring removed | `uxPolish` — selection and a re-scan update the panel; the toggle controls it |
| `.value` wrapped in a cell | `uxPolish` — the value is still a direct child |
| selected-row foreground override removed | `uxPolish` — the selection does not keep a low-contrast token colour |

## Decisions beyond the design

1. **`.row-meta`, not `.meta`.** `.meta` was already the schema/package container in `renderTree`;
   using it for the row's second line would have inherited the old padding. The new class is
   `.row-meta` and `highlightableSpans` was updated deliberately.
2. **Fixed `26ch` label + `1fr` value, not the design's per-row `fr` tracks.** Each row is its own
   grid; a `1fr` label would size to its content and the value column would start at a different x on
   every row. The design was corrected in §3.2.
3. **Hex in `.row-meta`, not a trailing auto column.** An auto column would change the value track on
   rows without a hex.
4. **Selection foreground override.** The token colours are for the normal background; on the light
   theme's blue selection, the green value was 1.33:1. Selected rows now use the selection foreground
   for value/short/variant/hex/condition/annotation/context.
5. **Details preference via `getState`/`setState`.** The shell is outside `#main`, so a re-scan
   preserves it; the host state preserves it across a webview reload. The harness stub uses
   `localStorage` to make the same path observable across fixture/theme navigation.
6. **Value title includes the full value.** A clipped value now has `Click to edit, or press F2: =
   <full value>`; the reference value has `Follow to the target: = <full target>`.
7. **The context row strips the redundant `context ` prefix.** The inspector's key already says
   `Context`; the row text remains `context …` for the tree.
8. **Count badge uses `inputValidation-warning*` for the empty state.** The normal badge foreground on
   the badge background is readable; the warning background/border is the explicit empty cue.
9. **`preview:check` uses Node 24's `fetch` and a fixed preview nonce.** The harness is dev-only and
   the repository already requires Node 24 types; no dependency was added.
10. **`editor/large.arxml` is synthetic and outside the core expected-model list.** It exists to make
    the scroll/density rows observable; it is not a customer file and no scanner test consumes it.
11. **Toolbar icons were not added.** Design §6 calls for inline-SVG icons plus text on Expand all,
    Collapse all and Details; the buttons remain text-only. The PRD requires the controls, not icons,
    and the after captures show the text buttons. This is a design deviation, not a hidden change.
12. **Conditions and annotations share one inspector line.** Design §2.3 says one per line; the panel
    joins them with spaces. The field labels and the complete text are present.
13. **Captures are 912 × 670, not 900 × 700 and 1400 × 900.** Plan item 2 asked for both sizes; the
    in-app browser available for the pass was 912 × 670, and both the six baseline and sixteen after
    captures are at that size. The required two fixtures × three themes matrix is complete.

## Files changed

Modified: `package.json`, `src/editor/{renderHtml,filter,ecucEditorProvider}.ts`,
`src/test/editor/{editing,uxTree}.test.ts`, `docs/ECUC_EDITOR.md`, the UX task's `implement.md`,
`.trellis/tasks/10-14-ecuc-artext-editor/task.json` (child link), this file.

Added: `scripts/preview-ecuc.js`, `src/editor/clipboard.ts`,
`src/test/editor/{uxPolish,copy}.test.ts`, `src/test/fixtures/editor/large.arxml`,
`research/ux-verification-gap.md`, `research/visual/before/*` (6 captures),
`research/visual/after/*` (16 captures).

`src/core/**` untouched; no new runtime dependency; no asset file in the extension or webview (the
captures are task documentation); no document write from the inspector or the copy path.

## AC verdicts

| AC | Verdict | Evidence |
|---|---|---|
| AC1 | **pass** | `preview:check`: 20 fixtures × 3 themes, live `/health`/`/preview`, whitelist, no dependency; each wrapped page is asserted to contain the production `renderTree` output verbatim plus the stub, inspector and empty state |
| AC2 | **pass (harness)** | 51-node `large` fixture: collapse + selection + `scrollTop=180` survived a model re-scan; message log shows select/reveal/copy/edit; the same stub records `follow`, which the visual pass did not separately capture; info/warn notices render |
| AC3 | **pass (912 × 670)** | 6 baseline + 16 after captures under `research/visual/**`, listed above; the planned 900 × 700/1400 × 900 sizes were not produced (deviation 13) |
| AC4 | **pass (tests + harness)** | `uxPolish` data attributes/`LineIndex`; browser panel for module/container/parameter/reference; `IniValue` → `L54:41 - L57:70`; the initial host selection now fills the panel from the rendered `aria-selected` |
| AC5 | **pass** | `copy.test` exact-text + failure propagation; provider wiring is a source-level assertion; harness logged the exact Copy path/value/target messages; no file mutation |
| AC6 | **pass (912 × 670)** | `uxPolish` grid/direct-child/ellipsis; harness no horizontal scroll at 912 px; values aligned within a nesting level; labels, values and metadata ellipsize with a title. The exact 900 × 700/1400 × 900 sizes and the 700 px stacked layout are unverified below. |
| AC7 | **pass** | `uxPolish`/`uxFilter` markup+script; harness `3 of 9`, ancestor expand/restore, empty state and Clear action |
| AC8 | **pass (harness)** | toggle aria state, `hidden`, re-scan survival and `localStorage` persistence observed; `vscode.getState/setState` asserted; real host reload persistence is unverified |
| AC9 | **pass** | no new dependency/asset; CSS literal test; light/dark/HC captures; selected contrast 6.11/11.99/21:1; the focus ring is CSS-asserted, not captured |
| AC10 | **pass** | 147 passing; 8 mutation checks; existing widget-order/no-takeover tests green |
| AC11 | **pass** | `docs/ECUC_EDITOR.md` updated; the UX task's manual table now records harness observations and real-host gaps |

## Remaining unverified

- The real VS Code webview: double-click reveal gesture, tab/column/focus behaviour, live input focus,
  keyboard focus rings, VS Code's own theme-variable resolution, and real `getState`/`setState`
  persistence across a reload. The UX task's seven rows are still not a VS Code pass.
- Host clipboard permissions and the actual system clipboard; only the helper, the message and the
  provider's success wiring are verified. The provider's copy-failure notice is source-asserted only.
- The exact 900 × 700/1400 × 900 viewports and the 700 px stacked layout: the browser was 912 × 670
  and the stacked mode is CSS-asserted only.
- The tree keyboard map and the reference-target hover were not exercised in the browser pass; the
  map is asserted by `uxTree` and the hover CSS is unchanged from the UX child.
- Real large-file performance; the density fixture is not a benchmark.

## Check pass (2026-10-27)

`check-types`, `lint`, `test` (147 passing) and `preview:check` were re-run, and these corrections
were made. The in-app browser was disconnected for this pass, so the visual observations above are
the implementer's captures and the harness self-check, not a fresh browser run.

- `preview:check` now asserts that each wrapped page contains the exact production `renderTree` output
  (not just an `id="tree"` marker), the stub's `window.__preview`, the inspector, the empty state and a
  theme variable. `GET /preview` and `?chrome=0` use the same containment assertion.
- `prepareFocus` adopts a host-rendered `aria-selected` node on first paint, so opening the editor from
  a source cursor fills the details panel instead of leaving it empty until the first click. The page's
  own `prepareFocus` is driven by the test with a stubbed DOM, and removing the adoption fails it.
- The `uxPolish` re-scan assertion is scoped to the tree's `model` handler (the value editor has
  another one), the empty-state assertion checks the swapped `renderTree` region, the colour-literal
  assertion covers 8-digit literals (the only literal remains the existing indent-guide fallback), and
  the unfocused selection foreground is asserted.
- `.row-meta` spans now ellipsize with a `title` (short name, variant, hex, context, conditions,
  annotations), closing the metadata part of R-VP6/AC6. The captures show only metadata that fits, so
  they remain representative.
- The value widget's document click listener is the first one registered again: the filter's delegated
  empty-state clear now comes after it, and `uxTree` asserts that the widget owns the first document
  click. It was inert for tree/value targets before, but the literal ordering contract is restored.
- `docs/ECUC_EDITOR.md`'s test count was corrected from 145 to 147.
- The original eight mutations were re-run and each failed its recorded assertion (12 passing,
  1 failing). Two additional mutations — removing the `aria-selected` adoption and removing the tree
  handler's `updateInspector()` — also failed the AC4/AC8 test; the restored focused suites were 13
  passing.
- The first full `npm test` on this machine hit the pre-existing 2 s timeout in the `uxReveal` focus
  mode test (145 passing, 2 failing; the timeout's `finally` leaked `revealMode` into the next test).
  A rerun was 147 passing. This is a pre-existing timing flake, not a change in this task's code.

