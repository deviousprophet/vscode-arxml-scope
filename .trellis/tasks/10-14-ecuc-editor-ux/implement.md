# Implementation plan: ECUC editor UX overhaul

Ordered checklist. Design: `design.md`; the contracts this must not break are in
`../10-14-artext-custom-editor/design.md` (the provider, the protocol, the reveal mechanism) and
`../10-14-ecuc-value-editing/design.md` (the widget's claim on click and key events).

**Do not start** until the artifacts here are reviewed and `task.py start` has been run. Not gated on a
spike.

## Order

Sequence matters: **§4 state preservation comes before §3 collapse**, because the provider re-renders
on every document change and collapse without persistence is worse than no collapse.

- [ ] 1. `src/editor/renderHtml.ts` — the interaction model (`design.md` §2). Split the single click
      handler: a click selects; a click on the twisty toggles; a double click reveals; `Enter` is
      toggle-or-reveal; `Space` selects only. Keep the widget's handler first and keep deferring to
      `stopImmediatePropagation`.
- [ ] 2. `src/editor/navigation.ts` + `src/editor/ecucEditorProvider.ts` + `src/commands.ts` —
      `revealRangeInTextEditor` gains the non-destructive mechanism (`design.md` §3): reuse a visible
      text editor for the uri, otherwise `showTextDocument(..., { viewColumn: Beside, preserveFocus:
      true, preview: true })`; the provider passes its own panel's `viewColumn`. `follow` uses the same
      path.
- [ ] 3. `package.json` + the provider — the `arxmlScope.ecuc.editor.revealMode` setting (`beside` |
      `focus` | `replace`, default `beside`), read per reveal so a change takes effect without a reload.
- [ ] 4. `src/editor/renderHtml.ts` — re-render state preservation (`design.md` §4.1): capture scroll
      before the `innerHTML` swap, restore after; keep the collapsed set, prune ids that no longer
      exist, re-apply; do not disturb the existing filter re-apply or `prepareFocus`.
- [ ] 5. `src/editor/renderHtml.ts` — collapse (`design.md` §4.2, §4.3): an inline-SVG twisty in the
      row, `aria-hidden`, real `aria-expanded`, children hidden by class, expand-all / collapse-all in
      the toolbar, and a count badge on a collapsed container.
- [ ] 6. `src/editor/renderHtml.ts` — visual hierarchy (`design.md` §5): kind classes and accents,
      kind glyphs, the indent-guide fallback chain, row hover, focused/inactive selection split, the
      two-column grid with ellipsis and `title`, value colouring unchanged.
- [ ] 7. `src/editor/ecucValueEditor.ts` — discoverability and refusal (`design.md` §6): the value
      span's affordance and tooltip, keeping the typed text on refusal with `aria-invalid`, the
      success flash, and `Tab`/`Shift+Tab` committing and moving to the next value.
- [ ] 8. `src/editor/filter.ts` + `renderHtml.ts` — filter feedback (`design.md` §7): a shared
      `matchRanges`, `<mark>` highlighting, `N of M`, the empty state, ancestors expanded while
      filtering with the collapsed set restored on clear, `Escape` to clear.
- [ ] 9. `src/editor/renderHtml.ts` — keyboard map and accessibility (`design.md` §8, §9):
      Home/End/PageUp/PageDown, type-ahead, `aria-posinset` / `aria-setsize` / `aria-selected`, the
      count announced through the live region, reduced-motion handling.
- [ ] 10. `src/editor/nodeId.ts` — the sibling collision (R-UX13, AC13). Ids must remain stable across a
      re-scan and independent of the sort mode, so the disambiguating ordinal is computed from the
      **raw** model's document order, exactly as parameter ids already do. `src/core/**` is not
      touched: this is an identity scheme, not a parsing rule.
- [ ] 11. `docs/ECUC_EDITOR.md` — document the reveal behaviour and the new setting (R-UX12), and
      describe the interaction model (click selects, double-click reveals) where it currently implies
      that revealing is what a click does.
- [ ] 12. Tests per the table below.

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
- [ ] The value widget still works end to end (edit, refusal, undo, redo, save) — the editing child's
      suite is the regression test.
- [ ] The no-takeover criterion still holds: a normally-opened `.arxml` uses the text editor.
- [ ] `npm run check-types`, `npm run lint` and `npm test` are green.
- [ ] `docs/ECUC_EDITOR.md` matches the new interaction model and lists the new setting.

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
