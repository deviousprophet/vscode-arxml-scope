# Implementation plan: ECUC editor UX overhaul

Ordered checklist. Design: `design.md`; the contracts this must not break are in
`../10-14-artext-custom-editor/design.md` (the provider, the protocol, the reveal mechanism) and
`../10-14-ecuc-value-editing/design.md` (the widget's claim on click and key events).

**Do not start** until the artifacts here are reviewed and `task.py start` has been run. Not gated on a
spike.

## Order

Sequence matters: **§4 state preservation comes before §3 collapse**, because the provider re-renders
on every document change and collapse without persistence is worse than no collapse.

- [x] 1. `src/editor/renderHtml.ts` — the interaction model (`design.md` §2). Split the single click
      handler: a click selects; a click on the twisty toggles; a double click reveals; `Enter` is
      toggle-or-reveal; `Space` selects only. Keep the widget's handler first and keep deferring to
      `stopImmediatePropagation`.
- [x] 2. `src/editor/navigation.ts` + `src/editor/ecucEditorProvider.ts` + `src/commands.ts` —
      `revealRangeInTextEditor` gains the non-destructive mechanism (`design.md` §3): reuse a visible
      text editor for the uri, otherwise `showTextDocument(..., { viewColumn: Beside, preserveFocus:
      true, preview: true })`; the provider passes its own panel's `viewColumn`. `follow` uses the same
      path.
- [x] 3. `package.json` + the provider — the `arxmlScope.ecuc.editor.revealMode` setting (`beside` |
      `focus` | `replace`, default `beside`), read per reveal so a change takes effect without a reload.
- [x] 4. `src/editor/renderHtml.ts` — re-render state preservation (`design.md` §4.1): capture scroll
      before the `innerHTML` swap, restore after; keep the collapsed set, prune ids that no longer
      exist, re-apply; do not disturb the existing filter re-apply or `prepareFocus`.
- [x] 5. `src/editor/renderHtml.ts` — collapse (`design.md` §4.2, §4.3): an inline-SVG twisty in the
      row, `aria-hidden`, real `aria-expanded`, children hidden by class, expand-all / collapse-all in
      the toolbar, and a count badge on a collapsed container.
- [x] 6. `src/editor/renderHtml.ts` — visual hierarchy (`design.md` §5): kind classes and accents,
      kind glyphs, the indent-guide fallback chain, row hover, focused/inactive selection split, the
      two-column grid with ellipsis and `title`, value colouring unchanged.
- [x] 7. `src/editor/ecucValueEditor.ts` — discoverability and refusal (`design.md` §6): the value
      span's affordance and tooltip, keeping the typed text on refusal with `aria-invalid`, the
      success flash, and `Tab`/`Shift+Tab` committing and moving to the next value.
- [x] 8. `src/editor/filter.ts` + `renderHtml.ts` — filter feedback (`design.md` §7): a shared
      `matchRanges`, `<mark>` highlighting, `N of M`, the empty state, ancestors expanded while
      filtering with the collapsed set restored on clear, `Escape` to clear.
- [x] 9. `src/editor/renderHtml.ts` — keyboard map and accessibility (`design.md` §8, §9):
      Home/End/PageUp/PageDown, type-ahead, `aria-posinset` / `aria-setsize` / `aria-selected`, the
      count announced through the live region, reduced-motion handling.
- [x] 10. `src/editor/nodeId.ts` — the sibling collision (R-UX13, AC13). Ids must remain stable across a
      re-scan and independent of the sort mode, so the disambiguating ordinal is computed from the
      **raw** model's document order, exactly as parameter ids already do. `src/core/**` is not
      touched: this is an identity scheme, not a parsing rule.
- [x] 11. `docs/ECUC_EDITOR.md` — document the reveal behaviour and the new setting (R-UX12), and
      describe the interaction model (click selects, double-click reveals) where it currently implies
      that revealing is what a click does.
- [x] 12. Tests per the table below.

## Test coverage

| Assertion | Test |
|---|---|
| AC1 — a click selects and opens no text editor | markup-level: no `reveal` on a plain click path; plus a real-editor test that a click-driven interaction leaves the custom editor open |
| AC2 — reveal does not close the custom editor | real editor: reveal, then assert the ECUC editor is still open and the text editor is in another column; `replace` mode still swaps |
| AC3 — the twisty toggles and `aria-expanded` follows | markup: twisty present only with children; state reflected |
| AC4 — collapsed set, selection and scroll survive a re-scan | extract the inline script and drive its `model` handler, or assert the handler's shape; state the limit honestly if the former is not feasible |
| AC5 — expand-all / collapse-all | markup plus script-level |
| AC6 — kinds are distinct | markup: `k-*` classes and glyphs per kind |
| AC7 — indent guides are not transparent | markup: the CSS fallback chain |
| AC8 — the value is advertised as editable, refusal keeps the text | markup: affordance and tooltip; host: a refused edit leaves the widget's text intact |
| AC9 — filter count, empty state, highlight, ancestor expansion, restore | markup and filter unit tests |
| AC10 — aria attributes and the key map | markup: `aria-*`; script-level: the key handler's branches |
| AC11 — no new dependency, no asset, colours are theme variables | `package.json` `dependencies` unchanged; grep the new CSS for a colour literal that is not a fallback |
| AC12 — suite, types, lint, and no new write path | the three commands, plus a grep for `WorkspaceEdit` / `writeFile` in the changed files |
| AC13 — sibling `SHORT-NAME` collision | a fixture with two sibling containers sharing a short-name: assert distinct ids, that each maps to its own range, and that both survive a re-scan and a sort-mode change |

Every assertion must fail when the feature is deleted — see `.trellis/spec/frontend/testing.md`. In
particular, a test that only asserts a class name appears is not evidence that the interaction works;
pair each markup assertion with the behaviour it stands for.

## Manual verification (required, because the test host has no webview DOM)

The user's complaints are all about feel, so they are checked by hand in an Extension Development Host
and the outcome is recorded in this task's `implement.md`. Not optional, and not to be reported as
passing until observed:

1. Open a synthetic fixture with many containers; click a container's label — the tree stays, the node
   selects, no XML appears.
2. Double-click a container — the XML opens **beside** the tree with the range selected, and the tree is
   still there and still focused.
3. Collapse a container with the twisty; type in the XML beside it; the container is still collapsed
   and the scroll position has not jumped.
4. Hover a row and a value: the hover background and the edit affordance are visible.
5. Click a value, type garbage, press Enter: the refusal message appears **and the typed text is still
   there**.
6. Filter to something inside a collapsed container: the ancestor expands, the count is shown, matches
   are highlighted; clearing the filter restores the collapse.
7. Repeat 1–4 in a light theme, a dark theme and a high-contrast theme; nothing becomes invisible.

## Validation commands

| Purpose | Command |
|---|---|
| Types | `npm run check-types` |
| Lint | `npm run lint` |
| Full suite | `npm test` |
| Core suites only, after `npm run compile-tests` | `npx mocha --ui tdd "out/test/core/*.test.js"` |

## Done when

- [ ] AC1–AC12 in `prd.md` pass, with the manual rows above observed and recorded.
- [x] The value widget still works end to end (edit, refusal, undo, redo, save) — the editing child's
      suite is the regression test.
- [x] The no-takeover criterion still holds: a normally-opened `.arxml` uses the text editor.
- [x] `npm run check-types`, `npm run lint` and `npm test` are green.
- [x] `docs/ECUC_EDITOR.md` matches the new interaction model and lists the new setting.

The first box stays unchecked on purpose: the seven manual rows are a human check in an Extension
Development Host and were **not** performed here. See §Manual verification status below.


## Rollback

Additive within `src/editor/` plus one setting and a doc update. `src/core/**` is untouched, so the
scanner and validation cannot be affected. If state preservation (item 4) cannot be made reliable,
**revert items 5–9 with it** rather than shipping collapse on top of a tree that springs open: the
current behaviour is bad, but a tree that fights the user while they type is worse.

## Guardrails

- One interaction, one effect. A click must not both select and reveal; a toggle must not move the
  selection.
- The value widget's listeners stay registered first and keep using `stopImmediatePropagation`. Do not
  reorder them to make a tree handler simpler.
- No colour literal anywhere except as a fallback inside a `var()` for a `--vscode-*` variable.
- No new runtime dependency and no asset file; glyphs are inline SVG because the CSP is
  `default-src 'none'` and `esbuild.js` has no asset-copy step.
- Do not touch `src/core/**`. Nothing here changes what is parsed, ordered or validated.
- Do not change what is displayed (parent design §6): this child changes presentation, not content.
- Do not add a second definition of "the filter matches this row" — highlighting and filtering must
  share `matchRanges`.
- Anything the test host cannot exercise is recorded as manually verified or unverified. Never imply a
  DOM behaviour was tested when it was not.

---

# Implementation record (all 12 items done; AC1–AC13)

## Validation (final state)

| Command | Result |
|---|---|
| `npm run check-types` | clean |
| `npm run lint` | clean |
| `npm test` (compile-tests + esbuild + lint, then the real host) | **131 passing, 0 failing** |
| `npm run compile-tests` then `npx mocha --ui tdd "out/test/core/*.test.js"` | 36 passing |

Baseline was 97; the 34 added tests are the four new files below.

## AC verdicts and evidence

| AC | Verdict | Evidence |
|---|---|---|
| AC1 | **pass (markup + host), gesture unverified** | `uxTree` "a plain click selects and never reveals" — the extracted `onRowClick` calls `selectItem(item)`, never `revealItem`, and both the twisty and the follow branch return before it. `uxReveal` "a select from the tree opens no text editor and survives the next re-scan" — the provider's own listener, `visibleTextEditors` unchanged, and the next `model` push carries the selection. The click *gesture* itself needs a webview; manual row 1. |
| AC2 | **pass** | `uxReveal` "a reveal leaves the custom editor open and shows the range in the source" (real custom editor via the real command: the custom tab is still open, still the focused tab under `beside`, and the range is selected in a visible text editor), "the reveal mode is read per reveal, and defaults to beside", "replace mode swaps the tab". `reveal.test.ts` AC4/AC6 and `references.test.ts` AC6 now look the editor up in `visibleTextEditors`. The double-click gesture itself: manual row 2. |
| AC3 | **pass** | `uxTree` "a toggle is rendered only where there is something to toggle" (module/container have `.twisty`, parameter/reference have `.spacer`, only the toggle carries `aria-expanded`), "aria-expanded is decided in one place, from the collapsed set" (`applyCollapsed` is the single writer; the page's own `toggleCollapsed` is compiled and driven), "toggling flips membership and never collapses a leaf". |
| AC4 | **pass (order), scroll value unverified** | `uxTree` "pruning drops the ids that are gone and leaves the rest alone", "a re-render reads the scroll first and writes it back last" (the seven-step order and the scroll round-trip, 42), "the page re-renders through the same sequence, over the #main scroll box" (the page's own `reRenderTree` compiled and driven). `uxReveal` AC1: the selection survives a re-scan. A live scroll position needs a layout; manual row 3. |
| AC5 | **pass** | `uxTree` "expand-all and collapse-all are offered and touch nothing but the collapsed set" (both buttons wired; `collapseAll` = `collapsedIdsFor`, `expandAll` = the empty set; neither touches `selectedId`/`setSelection`; the page's `collapsedIdsFor` driven). |
| AC6 | **pass** | `uxTree` "each kind has its own class, its own marker shape and its own accent" — `k-*` and `g-*` per kind, four distinct SVG shapes (filled square / hollow square / dot / arrow), and a per-kind accent from `--vscode-symbolIcon-*`. |
| AC7 | **pass** | `uxTree` "the indent guide falls back to a visible colour, never transparent" — asserts the exact chain `var(--vscode-tree-indentGuidesStroke, var(--vscode-panel-border, #80808040))` and rejects `transparent`. |
| AC8 | **pass (script), live input unverified** | `uxTree` "a value advertises that it is editable, by tooltip and by hover" (`title="Click to edit, or press F2"`, `cursor: text`, the `::after` pencil, `F2`, `input.value = item.dataset.value`), "a refused write keeps the typed text and marks the input invalid" (`commitValueEdit` neither removes the input nor clears its value; the `warn` notice sets `aria-invalid`; `.value-edit[aria-invalid="true"]` is styled; the widget's click listener is registered before the tree's). Host refusal with no mutation is the pre-existing `editing.test.ts` AC6. Manual row 5. |
| AC9 | **pass (script), DOM pass unverified** | `uxFilter` — six tests: `matchRanges` units; the page's own `matchRanges` compiled and driven against the host's; `shown of total` / `No matches` / the `role="status" aria-live="polite"` count; `<mark>` creation with the original text preserved and de-duplicated; `ancestors.add` + `applyCollapsed(ancestors)` with **no** assignment to `collapsed` anywhere in the filter; Escape clears and re-runs, and the filter runs on load. Manual row 6. |
| AC10 | **pass** | `uxTree` "an item carries its position, its group size and its selection state" (`aria-posinset`/`aria-setsize`/`aria-selected`; ContA's six members are 1–6 of 6; the module is 1 of 1), "Home, End, PageUp and PageDown move focus as expected" (host and page copies, clamping, unknown key, empty tree), "the key handler wires movement, expansion, type-ahead and the live count". `a11y.test.ts` keeps the roles/levels coverage. |
| AC11 | **pass** | `uxTree` "no runtime dependency was added and nothing is fetched" (`dependencies` is still absent, no `src=`, no `<link>`, no remote `url()`, only `.ts` files in `src/editor`), "every colour literal is a fallback inside a --vscode-* variable" (the single literal in the stylesheet is `#80808040`, inside `var(--vscode-panel-border, …)`). |
| AC12 | **pass** | `uxTree` "the presentation changes add no write path" — exactly one `new vscode.WorkspaceEdit(` across `src/editor` (in `ecucEdit.ts`), no `fs.writeFile`, and exactly one `type: 'edit'` in the page. The three commands are green (table above). |
| AC13 | **pass** | `uxNodeId` — five tests over the new synthetic fixture `src/test/fixtures/editor/sibling-collision.arxml`: the two `Twin` siblings get distinct ids (`…#0` / `…#1`, from the raw document order), each slices its own `<VALUE>1</VALUE>` / `<VALUE>2</VALUE>`, `innermostNodeIdAt` on each `shortNameRange` lands on that one, the nested `Leaf` twins and their parameters are disambiguated too, and the ids are unchanged by `sort all` / `declaration` and by a re-scan that edits the first twin. `src/core/**` untouched. |

## Decisions beyond the design

1. **The pure helpers are exported and serialized, and the tests drive the page's own copy.**
   `pruneCollapsed`, `toggleCollapsed`, `collapsedIdsFor`, `moveTarget` and `reRenderTree` live in
   `renderHtml.ts` and are emitted into the page with `Function.prototype.toString()`.
   `src/test/editor/scriptTestUtils.ts` locates a function in the page by brace matching and **compiles
   and drives it** (`evaluateFunction`), so "the page and the tests share one definition" is an
   assertion rather than a claim — and it is formatting-proof, which matters because the page is
   bundled by esbuild and the tests by tsc.
2. **`#main` became the scroll container.** `body` is a flex column with `overflow: hidden` and
   `#main { flex: 1; overflow: auto }`. Without this `main.scrollTop` is permanently 0 and item 4's
   capture/restore is a no-op — see *Wrong in the design* below.
3. **`reRenderTree(tree, hooks)` takes the seven view operations as hooks**, so the sequence
   `read → writeHtml → prune → applyCollapsed → applyFilter → prepareFocus → writeScrollTop` is
   asserted without a DOM.
4. **A new `{ type: 'select', nodeId }` webview → host message**, stored in the provider's
   `selections` map so the selection survives a re-scan (AC4). It deliberately does *not* go through
   `selectNode`, which would `reveal()` the panel — that would make a click move the editor.
5. **`moveTarget(key, from, count, page)`** owns the six movement keys; `page` is measured as
   `#main.clientHeight / rowHeight()` so PageUp/PageDown move by a screen instead of a fixed count.
6. **Two sibling tests were updated, not weakened.** `reveal.test.ts` AC4 and `references.test.ts`
   AC6 asserted `vscode.window.activeTextEditor` after a reveal. The focus behaviour deliberately
   changed (the source opens beside and keeps focus in the tree), so that assertion *was* the defect
   this child fixes; they now look the editor up in `vscode.window.visibleTextEditors`.
7. **Four test files, not one**, matching the existing per-topic naming: `uxTree` (interaction,
   collapse, hierarchy, guardrails), `uxReveal` (the host half of AC1 and all of AC2), `uxNodeId`
   (AC13), `uxFilter` (AC9).
8. **The selection survives a re-scan through host state, not the webview.** The webview keeps
   `selectedId` for its own `aria-selected`, but the provider's `selections` is what the `model`
   payload carries — otherwise a re-scan would move the selection back to whatever node the editor
   was opened at.

## Wrong or undefined in the design (reported, not silently fixed)

1. **§4.1's scroll capture could not work as written.** "Capture the scroll before the `innerHTML`
   swap" assumes the tree's scroll container is `#main`; in the pre-change page `body` scrolled and
   `#main.scrollTop` was always 0, so the feature would have been a silent no-op. The container had to
   move to `#main` first (decision 2). Item 4 in this plan does not mention it.
2. **§5's two-column CSS grid conflicts with the value widget's contract.** The widget (and
   `filterScript`'s `highlightableSpans`, and `editing.test.ts`) select `:scope > .row > .value`; a
   grid wrapper between `.row` and `.value` breaks that. Implemented as a flex row with
   `.label { flex: 0 0 22ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }`, which
   gives the same fixed label column and ellipsis with `title` on the row. **Deviation.**
3. **The plan's item 5 asks for "a count badge on a collapsed container"** that the design never
   defines and no AC requires (AC3 asks only for the toggle and `aria-expanded`). **Omitted** rather
   than guessing what it counts; the twisty's `aria-expanded` and the toolbar count are the reported
   state. **Deviation.**
4. **§7's count is ambiguous.** Implemented as the design's `N of M` over **visible rows** (which is
   what AC9 says — "shown of total"), not the number of matches. `No matches` is the zero case.
5. **`replace` mode does not close the custom editor.** `vscode.openWith(uri, 'default')` swaps the
   group's *active* tab; the custom editor tab remains in the group's background. That is the honest
   behaviour and what the docs and the test now say, but "swaps the tab" in §3/§10 reads as though the
   tab disappears.

## Manual verification status — **7/7 unverified in VS Code** (browser harness follow-up below)

The test host has no webview DOM and no layout, so none of these were observed **in VS Code**. A
browser harness later observed the page-side behaviour recorded below; each row still needs a human in
an Extension Development Host where noted:

1. Click a container's label → selects, no XML appears. *(Gesture unverified; the handler and the host
   effect are tested.)*
2. Double-click a container → XML opens beside with the range selected, tree still focused. *(The mode
   and tab behaviour are tested with the real editor; the gesture is not.)*
3. Collapse a container, type in the XML beside it → still collapsed, scroll has not jumped. *(The
   seven-step re-render order is tested; the scroll value needs a layout.)*
4. Hover a row and a value → hover background and the edit affordance visible. *(CSS is asserted; the
   rendered hover is not.)*
5. Click a value, type garbage, Enter → refusal message appears **and the typed text is still there**.
   *(The script is asserted; the live input is not.)*
6. Filter to something inside a collapsed container → ancestor expands, count shown, matches
   highlighted; clearing restores the collapse. *(The script is asserted; the DOM pass is not.)*
7. Repeat 1–4 in a light, a dark and a high-contrast theme → nothing invisible. *(Every colour is a
   `--vscode-*` variable with a non-transparent fallback, asserted; no theme was rendered.)*

Nothing above is implied to have passed: the markup-level tests are named so ("a toggle is rendered
only where…", "the page re-renders through the same sequence…") and never claim a DOM behaviour.

### Browser harness follow-up (2026-10-27)

Task `10-27-ecuc-editor-visual-polish` rendered the real page in the in-app browser with stubbed
VS Code variables (`npm run preview:ecuc`). Observations:

| Row | Harness observation | Still needs VS Code |
|---|---|---|
| 1 | Clicking a container label selected it and left the tree visible; no text editor was opened. | The real webview gesture/focus model, and that no custom-editor tab is replaced. |
| 2 | Not exercised as a gesture; the page posted `reveal` for the selected node. | The real double-click gesture, the source opening in another column, and focus staying in the tree. |
| 3 | Collapsed `Cont04` in the 51-node `editor/large.arxml`, scrolled to 180, selected `Beta`, dispatched a `model` re-scan; the container stayed collapsed, the selection and inspector stayed, and `scrollTop` was still 180. | Typing in the real XML beside the webview, with VS Code's own re-scan events. |
| 4 | Hovering `IniValue` showed the row hover background and the pencil affordance. | Rendered hover in a real webview is the same CSS; still worth a visual check. |
| 5 | Clicked `IniValue`, typed `garbage`, Enter: the input stayed open with `garbage`; a simulated warn notice set `aria-invalid=true` and kept the red border. | The real host refusal; `editing.test` AC6 covers the refusal and no mutation, but the live input/focus is a VS Code check. |
| 6 | Filtering `IniValue` inside a collapsed `ContA` expanded the ancestor and reported `3 of 9`; clearing restored `aria-expanded=false`. A nonsense filter showed the empty state and its Clear action restored the tree. | The browser DOM is real; VS Code's own webview is still the acceptance environment. |
| 7 | Light, dark and high-contrast captures showed the tree, values, chips, selection and inspector; selected-row contrast was 6.11:1 in light and 11.99:1 in dark after the selection-foreground fix. | VS Code's own theme variables and high-contrast borders; the harness variables are approximations. |

The harness also exercised the details panel for a module, container, parameter and reference, the
Copy path/value/target messages, the Details toggle persistence across a reload, and no horizontal
scroll at 912 CSS px. None of this is a VS Code webview pass, and row 2 remains a real-host gesture
check.

## Files changed

Modified: `package.json`, `src/commands.ts`, `src/editor/{ecucEditorProvider,ecucValueEditor,filter,
navigation,nodeId,renderHtml}.ts`, `src/test/editor/{references,reveal}.test.ts`, `docs/ECUC_EDITOR.md`,
this file.

Added: `src/test/editor/{scriptTestUtils,uxTree,uxReveal,uxNodeId,uxFilter}.ts`,
`src/test/fixtures/editor/sibling-collision.arxml` (synthetic; `.gitattributes` pins
`src/test/fixtures/** -text`).

`src/core/**` untouched; no new dependency; no asset file; no git write performed.

---

## Phase 2.2 check

Independent check of the implementation record above. Everything below was observed here: the
commands were run, the mutants were applied and reverted in the working tree, and each verdict is
against evidence, not against the record's claim.

### Verification (final state, after this check's fixes)

| Command | Result |
|---|---|
| `npm run check-types` | clean |
| `npm run lint` | clean |
| `npm test` | **134 passing, 0 failing** |
| `npm run compile-tests` + `npx mocha --ui tdd "out/test/core/*.test.js"` | 36 passing |

The record's own numbers (131 passing, clean types/lint, 36 core) reproduce exactly. 134 is 131 plus
the three tests this check added.

### Mutation results

Each mutation was applied to `src/**`, the full suite run, and the file restored. "Passed" means the
suite was still green with the feature broken — i.e. no test held it.

| Mutation | Before this check | After the fixes below |
|---|---|---|
| `.node[aria-expanded="false"] > .children { display: none }` → `display: block` (renderHtml.ts:550) | **131 passing — gap** | 1 failing (`uxTree` AC3) |
| `pruneCollapsed: prune,` removed from the `model` handler (renderHtml.ts:873) | **131 passing — gap** | 1 failing (`uxTree` AC4) |
| `applyCollapsed: () => applyCollapsed(),` removed from the `model` handler (renderHtml.ts:874) | **131 passing — gap** | 1 failing (`uxTree` AC4) |
| container ordinal taken from the ordered list instead of the raw model (`nodeId.ts` module loop) | **131 passing — gap** | 1 failing (`uxNodeId` AC13) |
| container ordinal dropped (R-UX13 collision) | 4 failing | 5 failing |
| twisty never rendered | 1 failing | 1 failing |
| a refused write calls `closeValueEdit()` (the old defect) | 1 failing | 1 failing |
| `preserveFocus: false` in `revealRangeInTextEditor` | 1 failing | 1 failing |
| `.row:hover` background removed | (unasserted) | 1 failing |
| unfocused selection switched back to the active colours | (unasserted) | 1 failing |

The four "gap" rows are the substance of this check: the collapse, the collapsed-set restore and the
sort-independence of the id scheme could each have been deleted with a green suite.

### Findings, and what was done

1. **HIGH — the collapse's hiding rule was asserted by nothing.** `renderHtml.ts:550-552`
   (`.node[aria-expanded="false"] > .children { display: none }`) is the only thing that makes a
   toggle change what is on screen; deleting it left 131 passing. AC3's "clicking it hides or shows
   its children" therefore rested on `aria-expanded` alone. **Fixed**: `uxTree.test.ts` AC3 now
   asserts the rule; `display: block` fails it.
2. **HIGH — the `model` handler's hook wiring was asserted by nothing.** `renderHtml.ts:868-880`
   passes the seven view operations; the test asserted only that the call site exists
   (`reRenderTree(message.tree, {`), so dropping `pruneCollapsed: prune` or `applyCollapsed: () =>
   applyCollapsed()` — which is exactly R-UX4's "the collapsed set survives a re-scan" — left 131
   passing. **Fixed**: `uxTree.test.ts` AC4 asserts all seven hooks by name; each of the two mutants
   above now fails.
3. **MEDIUM — AC13's sort-independence test was tautological.** `uxNodeId.test.ts` "the ids are
   unchanged by the sort setting" rebuilt the index from the same unchanged `model` object between
   two pure `renderTree` calls, and the collision fixture's two `Twin` siblings share
   `(definitionRef, shortName)`, so `orderContainers` cannot reorder them — the fixture comment's
   claim that "the declaration order deliberately differs from the sorted order" was false. The
   ordinal-from-display-order mutant passed 131/131. This is the requirement whose failure silently
   breaks the editing child's re-resolution, so it needed a falsifiable test. **Fixed**: new fixture
   `src/test/fixtures/editor/sibling-sort-order.arxml` (two same-`SHORT-NAME` siblings declared in the
   opposite order to the one `sort all` produces) and a new test that asserts the ordinal is the
   declaration order *and* that the sorted render really shows the other order — the assertion is
   only falsifiable because the two orders disagree. The mutant now fails. The old test was kept,
   with its false comment corrected.
4. **LOW — `replace` mode's "the custom editor is still open" was not asserted.** AC2's claim is
   "without closing the custom editor"; the replace test asserted only that the custom editor is no
   longer the *active tab*. **Fixed**: it now asserts `customTabOpen(uri)` as well, and that is true
   — `vscode.openWith(uri, 'default')` swaps the group's active tab and leaves the custom tab in the
   background. The implementer's deviation 5 is confirmed, not just claimed.
5. **LOW — the "opens beside, not on top" claim was unasserted, and the `beside` test could pass on
   an editor another suite had left open.** `implement.md`'s own test-coverage table promises "the
   text editor is in another column"; no test checked a column, and `textEditorsFor(uri)[0]` would
   have found an editor left visible by `reveal.test.ts` even if the reveal had done nothing.
   **Fixed**: the `beside` test closes the file's text tabs first, asserts none is visible, and
   asserts the source tab is in a different group from the custom editor; a new `focus`-mode test
   does the same and asserts focus really moved. Both pass.
6. **LOW — accepted, not changed.** The new toolbar CSS uses `transparent` as the fallback for
   `--vscode-button-secondaryBackground` and `--vscode-button-border` (and the pre-existing
   `--vscode-input-border`). AC11 asks for a non-transparent fallback "where the theme may not define
   one"; those two are defined by every built-in theme, the fallback is VS Code's own documented
   pattern for `-border`, and the *visible* property (the text colour) falls back to
   `--vscode-foreground`, so nothing becomes invisible. Every other new colour has a visible
   fallback, and `#80808040` is the only literal in the whole stylesheet, inside
   `var(--vscode-panel-border, …)`.
7. **LOW — reported, not changed.** AC2's parenthetical lists "the row's affordance" among the reveal
   triggers, and no per-row reveal affordance is rendered: `revealItem` is reached only by
   double-click and `Ctrl`/`Alt`+`Enter` (plus the contributed command). The design's §2 interaction
   table specifies no such control, so this is an AC-wording gap rather than a behaviour defect, and
   adding UI the design does not describe is not a check's call.
8. **LOW — reported, not changed.** Design §5 wants the fixed label column "ellipsised, `title` with
   the full text"; the `title` on the row carries the `DEFINITION-REF` (the pre-existing hover
   contract, which AC1 and the parent docs rely on), so a clipped label's full text is not exposed.
   No AC requires it.

### Deviation verdicts

| Deviation (implementer) | Verdict |
|---|---|
| flex row instead of the two-column grid | **Accept.** `:scope > .row > .value` still matches: the row is still the direct parent of `.value` (`renderHtml.ts:246`), which is what `beginValueEdit`, `highlightableSpans` and the widget tests select on, and what a grid wrapper would have broken. `.label { flex: 0 0 22ch }` gives the fixed, ellipsised label column. The widget works: `uxTree` AC8 and the pre-existing `editing.test.ts` pass. |
| `#main` became the scroll container | **Accept, and the restoration is real.** `body { overflow: hidden }` + `#main { overflow: auto }` (`renderHtml.ts:424`, `466`), `readScrollTop` reads `main.scrollTop` before `main.innerHTML = tree` and `writeScrollTop` writes it back last (`renderHtml.ts:869-879`). AC4's scroll claim is stated honestly ("the scroll value needs a layout; manual row 3"), and the order is asserted. The design's §4.1 capture would indeed have been a no-op — the report is correct. |
| count badge on a collapsed container omitted | **Accept.** No AC requires it, and the design never defines what the badge counts. AC3 asks only for the toggle and `aria-expanded`, and the filter's `shown of total` is the reported count. |
| `N of M` counts visible rows, not matches | **Accept.** AC9's wording is "reports 'shown of total'", which is visible rows; `shown` counts every visible item (matches *and* the ancestors shown for them) and `items.length` is every item. `No matches` is the zero case. The design's `12 of 240` is the ambiguous one, and AC9 governs. |
| `replace` swaps the active tab; the custom tab stays in the background | **Accept, verified.** `customTabOpen(uri)` is true after a replace-mode reveal, and the text editor takes the tab and the focus. AC2 ("the ECUC editor is still open afterwards") therefore holds in all three modes: `beside` and `focus` asserted, `replace` now asserted. `docs/ECUC_EDITOR.md` says "swaps the ECUC editor's tab for the text editor, as older versions did" — faithful to design §10 and not a stale claim; the only remaining ambiguity is that "swaps the tab" could read as "closes it", which is why the test now pins it. No doc still claims the old click behaviour: `docs/ECUC_EDITOR.md` now reads "clicking the label selects the node, it does not reveal it", and the only other reveal-shaped line in `docs/` (`FEATURES_PLAN.md:110`, "Click a node to jump to its source") belongs to the unbuilt architecture-graph view. |

### The two changed pre-existing tests

Not a weakened assertion — the change follows from the new reveal contract, and no coverage was lost.

- `reveal.test.ts` AC4 and `references.test.ts` AC6 asserted `vscode.window.activeTextEditor`. Under
  `beside` the reveal deliberately preserves focus (`navigation.ts:150`), so the *focused* editor is
  no longer necessarily the revealed one; the old assertion was the defect `design.md` §1.1
  describes. Both now find the editor in `visibleTextEditors` **for the same uri**, and the
  assertions that carry the meaning are unchanged and still present: the document text at the
  returned range, and (in `reveal.test.ts`) the selection's start line, start character and end
  character. A reveal that did nothing would still fail both.
- The stronger form of the same claim now lives in `uxReveal.test.ts`: the custom editor's tab is
  still open, is still the active tab under `beside`, the source is in another column, and the range
  is selected.

### Guardrails, each verified rather than assumed

- `git diff --name-only` lists no `src/core/**` path. Confirmed.
- `package.json`: no `dependencies` key (baseline had none); `arxmlScope.ecuc.editor.revealMode`
  declared with `enum` + `"default": "beside"` (package.json:118-127) and documented in
  `docs/ECUC_EDITOR.md` §Settings (R-UX12). The `customEditors` entry, the spike provider and
  `"priority": "option"` (package.json:58) are untouched by the diff.
- No asset file: `src/editor` holds `.ts` only, and the glyphs and the twisty are inline SVG inside
  a `default-src 'none'` CSP with no `img-src`/`font-src`.
- Colours: `#80808040` is the only literal in the stylesheet and sits inside
  `var(--vscode-panel-border, …)`; the indent guide replaces the old `transparent` with
  `var(--vscode-tree-indentGuidesStroke, var(--vscode-panel-border, #80808040))` (AC7). See finding 6
  for the two accepted `transparent` fallbacks.
- Write path: exactly one `new vscode.WorkspaceEdit(` under `src/editor` (`ecucEdit.ts:236`), one
  `type: 'edit'` in the page, no `fs.writeFile` anywhere in `src/**` (the only other `WorkspaceEdit`
  is the pre-existing one in `src/spikes/**`, untouched).
- Value-widget contract: the emitted script order is `filterScript()` → `acquireVsCodeApi()` →
  `valueEditorScript()` → `TREE_SCRIPT` (`renderHtml.ts:64-69`), so the widget's `click`/`keydown`
  listeners are registered before the tree's, and they still claim their events with
  `stopImmediatePropagation` (`ecucValueEditor.ts:103, 110, 131, 138`). `uxTree` AC8 asserts both the
  ordering and the claim. The click model changed underneath the widget and the ordering is intact.

### What remains unverified

- The seven rows of §Manual verification status are still 7/7 unverified, each with what a human must
  look at, and no AC verdict implies a DOM behaviour passed. The qualified verdicts (AC1 "gesture
  unverified", AC4 "scroll value unverified", AC8 "live input unverified", AC9 "DOM pass
  unverified") are the honest ones, and AC3 now has the one thing it was missing: the rule that hides
  the children is asserted, so the claim is no longer markup-only in the way it was.
- Still markup/script-level only, and named as such: the twisty's hit area, hover rendering, the
  double-click gesture, the live scroll value, the live input after a refusal, and the filter's DOM
  pass. This check did not add a webview DOM and did not observe any of them.
- The three new tests this check added are markup/script-level like their neighbours (a stylesheet
  rule, the hook wiring, the id scheme and the tab/column behaviour through the real editor). The
  tab/column and focus assertions are the only ones here that exercise the real platform.

### Files this check changed

Modified: `src/test/editor/uxTree.test.ts` (AC3 hide rule, AC4 hook wiring + filter box, a row-state
test), `src/test/editor/uxReveal.test.ts` (`closeTextTabs`, `groupIndexFor`, beside column, replace
`customTabOpen`, a focus-mode test), `src/test/editor/uxNodeId.test.ts` (the discriminating sort test,
and the false comment in the old one corrected). Added:
`src/test/fixtures/editor/sibling-sort-order.arxml` (synthetic, covered by the existing
`src/test/fixtures/** -text` pin). No change to `src/**` production code: every finding was either an
evidence gap or a documented deviation, and no defect was found in the shipped behaviour.


