# Semantic ARXML diff view — implementation plan

## Ordered checklist

### Step 1 — Extract shared row primitives (behaviour-preserving)

- [ ] Create `src/editor/rowView.ts` with `appendHighlighted`, `valueSpan`, `metaSpan` moved from
  `TREE_SCRIPT` and export `rowViewScript()`.
- [ ] Inject `${rowViewScript()}` into `renderHtml` before the declarations that call it; remove the
  local definitions.
- [ ] Add a test that `functionSource(editorPage, 'valueSpan')` equals
  `functionSource(diffPage, 'valueSpan')` once the diff page exists, and that all editor tests still
  find the functions.
- [ ] Run `npm test` before continuing. No visual or behavioural change is allowed here.

### Step 2 — Pure diff model

- [ ] Add `src/diff/diffModel.ts`:
  - projection of `EcucRow` → `DiffCell`;
  - `diffChanges(left, right)`;
  - recursive match with the base-id fallback;
  - merged ordering, recomputed `level` / `parentKey` / `hasChildren` / `subtreeSize`;
  - `summarizeDiff`, `diffVisibility`, `flattenDiffRows`, `nextChangeIndex`;
  - `compareTitle` / basename disambiguation.
- [ ] Add `src/test/diff/diffModel.test.ts` for every rule in design §2 and §3.3.
- [ ] Use synthetic models built through `scanEcucValues` on small inline fixtures, plus the
  existing fixture style from `src/test/core/modelTestUtils.ts`.

### Step 3 — Diff page

- [ ] Add `src/diff/diffPage.ts` with the static shell, `DIFF_STYLE`, and serialized page script.
- [ ] Reuse `matchRanges`, `rowViewScript`, `virtualScrollScript`, `diffVisibility`,
  `flattenDiffRows`, `nextChangeIndex`.
- [ ] Build rows with DOM APIs only; no model text in `innerHTML`.
- [ ] Style with `--vscode-*` variables; status colours for changed/added/removed must remain
  legible in light, dark and high-contrast themes. Use outlines as well as tint where needed.
- [ ] Add `src/test/diff/diffPage.test.ts`: shell contains one filter input of `type="text"`, one
  clear control, tree roles, changes-only toggle, summary, detail strip, and the serialized function
  names; script boots under the page-error surrogate.
- [ ] Extend `scripts/check-webview-boot.cjs` to also import `renderDiffHtml`, scan two fixtures,
  build a diff, and boot its inline scripts in the stub DOM.

### Step 4 — Host panel

- [ ] Add `src/diff/diffPanel.ts`:
  - `viewType`, `open`, title;
  - `openTextDocument` + gate + `scanEcucValues`;
  - initial document embed;
  - `ready` / `reveal` handling;
  - debounced refresh on both documents;
  - full disposal.
- [ ] Add `src/diff/compareSelection.ts` with the context key.
- [ ] Add `src/test/diff/compare.test.ts`:
  - command registration;
  - `compareSelected` opens a `vscode-arxml-scope.diff` tab;
  - compare selection stash updates;
  - non-ECUC refusal shows a warning and opens no panel.
- [ ] Add fixtures `src/test/fixtures/diff/left.arxml` and `right.arxml` covering changed,
  added, removed, reordered and duplicate-name cases. Keep them synthetic.

### Step 5 — Commands and manifest

- [ ] Register `selectAsFirst`, `compareToStaged`, `compareSelected` in `src/commands.ts`; pass the
  compare store through activation.
- [ ] Add command contributions and `arxmlScope.actions` menu items per design §4.2. The submenu
  contribution already exists from the sibling task; add items only.
- [ ] Add a manifest test: the three commands exist, the compare items target
  `arxmlScope.actions`, and no diff command is a flat `editor/context` entry.
- [ ] Verify the palette fallback opens a two-file dialog when no Explorer selection is passed.

### Step 6 — End-to-end and gates

- [ ] Manually open two fixtures, exercise filter/changes-only/collapse/F7/reveal.
- [ ] Edit one document and confirm the panel refreshes without losing UI state.
- [ ] Confirm no fixture mtime or bytes change.
- [ ] Run:

```text
npm run check-types
npm run lint
npm test
npm run package
```

- [ ] Update `CHANGELOG.md`.
- [ ] Record any new invariant in `.trellis/spec/frontend/` (diff surface, row primitive reuse).

## Risky files / rollback points

- `src/editor/renderHtml.ts` — extraction must be mechanical. Roll back to the local function bodies
  if any render test changes.
- `src/commands.ts` — keep existing command signatures unchanged.
- `package.json` — add to the existing submenu; do not create a second submenu.
- `scripts/check-webview-boot.cjs` — a failure here blocks packaging; fix the page script, never
  weaken the gate.

## Review checklist

- [ ] No `vscode` import under `src/diff/diffModel.ts` or `src/diff/diffPage.ts`.
- [ ] No new runtime dependency.
- [ ] No `innerHTML` for model text.
- [ ] No hard-coded colour outside the documented `--vscode-*` fallbacks.
- [ ] Only the viewport window is built into the DOM.
- [ ] Both panes scroll together and always show the same row count.
- [ ] The diff never writes and never claims an editor association.
