# Monaco Surface Code-Spec

The editor and diff pages render through `monaco-editor@0.57.0`, pinned exactly and
bundled by esbuild. Monaco is a text editor, not a row renderer: the page serializes the
row model into a synthetic ECUC text and maps the editable field spans back. The row
store stays the source of truth; the Monaco model is a projection.

## Scope / Trigger

- `src/webview/monaco/synthetic.ts` — the single adapter between `EcucRow`/`DiffDocument`
  and Monaco models.
- `src/webview/monaco/setup.ts` — environment, worker, theme, editor factory and folding.
- `src/webview/monaco/findBridge.ts` — native-find bridge shared by both pages.
- `src/webview/editorMonaco.ts` — ECUC editor composition root.
- `src/webview/diffMonaco.ts` — semantic diff composition root.
- `src/webview/monaco/diffGutterActions.ts`, `diffGutterAvailability.ts`,
  `monacoInternals.d.ts` — the two copy actions and their per-hunk context keys.

Read together with [`editor-lifecycle.md`](./editor-lifecycle.md) (session/protocol),
[`diff-parity.md`](./diff-parity.md) (pinned release, patch, adapters) and
[`diff-matching.md`](./diff-matching.md) (semantic pairing).

## Synthetic document contract

### Editor

`buildSyntheticDocument(rows, header)` in `synthetic.ts` calls
`flattenRows(rows, { braces: true, moduleGaps: true })` and emits one model line per
display line:

- Distinct line kinds: `header`, `blank`, `module-gap`, `annotation`, `brace`, `module`,
  `container`, `parameter`, `reference` (diff sides add `diff`).
- The text is the display text, not XML. Empty containers append `{ }`; brace rows carry
  the container id.
- `rowLine` maps a node row id to its 1-based model line. Comments and braces are not node
  rows.
- `fieldSpans` lists the editable spans (`value`, `shortName`, `definitionRef`) with
  1-based, end-exclusive columns and the accepted text.
- `searchSpans` lists `label` / `value` / `meta` spans (with the meta part index) for the
  Rust search result mapping.
- `foldingRanges` comes from the open brace lines, sorted by start line.

The editor's model **always ends with one trailing newline**. Sticky scroll converts a
folding end to `end + 1`; without the trailing line a scope ending on the last row is
invalid and the whole sticky model is dropped.

### Diff

`buildDiffSyntheticDocuments(document)` serializes the merged `DiffDocument` rows into
two **independently shaped** documents plus `leftLineKeys`/`rightLineKeys`:

- Each side keeps its own line count. A row that exists on only one side is absent from
  the other model; the missing side is Monaco's native diagonal view zone, not a numbered
  placeholder line.
- Module gaps, annotations, braces, cells and field spans are emitted per side.
- Both diff models end with the same one trailing newline as the editor. Sticky scroll
  converts a folding end to `end + 1`; without it the outermost diff scope is invalid and
  every sticky candidate is dropped. The extra blank line is unchanged on both sides.
- Diff sticky scroll is enabled with `defaultModel: 'foldingProviderModel'`, matching the
  editor, so a deep scroll pins the full module and container headers.

### Must / must not

- **Must** rebuild the synthetic model from the row store after a document payload, a
  full re-scan or a structural change.
- **Must** update one line in place for a one-row `documentPatch`; keep the line map and
  folding ranges consistent.
- **Must not** treat the Monaco text as a second source of truth, parse it back into ECUC,
  or persist it.
- **Must not** add a second row renderer for the diff page.

## Editor page

`createEcucEditor(container, model)` sets `readOnly: false`, line numbers on, folding on,
sticky scroll on, minimap on, word wrap off, indentation guides on and bracket-pair
colourisation on. The page owns selection, the sidebar, the draft and the save gate;
Monaco owns text selection, scrolling, folding, find, sticky scroll, minimap and undo.

### Field edits and undo

- Only spans in `fieldSpans` are editable. A typed change inside a span updates the local
  draft (`applyLocalField`); a change outside a span, a multi-line insertion or a
  whole-line change that cannot be recovered restores the model line.
- A paste containing a newline is stored as one escaped line; the raw multi-line insertion
  never reaches the model.
- Ctrl+S is the only save. Typing, deletion and Escape stay local; the host writes after a
  short idle pause and the save flushes pending edits.
- With a local draft or an active local undo, Ctrl+Z/Ctrl+Shift+Z undo/redo Monaco's local
  stack; otherwise the page posts `undo`/`redo` to the host document. Redo can restore a
  draft that an undo returned to the host value.
- The editor page keeps the model's caret/selection across model rebuilds by row id, not
  by line number.

### Find bridge

- `Ctrl+F` opens Monaco's native find widget; `Ctrl+H` opens the replace row.
- `installFindBridge` patches the model's `findMatches`/`findNextMatch`/
  `findPreviousMatch` so the widget asks the page instead of searching the synthetic
  text. The page answers from the Rust `doc.search` match list and maps field offsets
  through `searchSpans`; a cache miss requests the query and refreshes the open widget.
- `doc.replace` owns the plan; the native Replace/Replace All methods are intercepted and
  post a Rust replace request. The page never edits the synthetic text locally. Replace
  targets parameter values and container short names only.
- Requests are generation-guarded: a late `findResult` for an older request id is ignored
  after typing, clearing or closing.

## Diff page

`diffMonaco.ts` mounts `monaco.editor.createDiffEditor` with two per-side models and:
`readOnly: true`, `originalEditable: false`, `renderSideBySide: true`,
`useInlineViewWhenSpaceIsLimited: false`, `enableSplitViewResizing: true`,
`renderGutterMenu: true`, `renderIndicators: true`, `renderOverviewRuler: true`,
`diffAlgorithm: 'advanced'`, `ignoreTrimWhitespace: false`, and dynamic
`hideUnchangedRegions`.

Ownership:

- **Monaco owns** both panes, line numbers, status fills, word spans, the overview ruler,
  hidden unchanged regions, the diagonal gap, the gutter and the sash, scrolling and body
  paint.
- **The page owns** the ARXML toolbar (view mode, Context, Semantic/Strict, Prev/Next,
  Collapse/Expand, Swap, Merge), the fixed title strip, the two synthetic documents, the
  `data-merge` gate and the two copy actions.
- `Show all` / `Show diff` and `Context` change `hideUnchangedRegions`:
  `enabled = changesOnly`, `contextLineCount = contextActive ? 5 : 0`,
  `minimumLineCount: 3`. The toolbar control only changes these options.
- The ARXML Collapse/Expand actions call `editor.foldAll`/`editor.unfoldAll` on both inner
  editors. The diff editor rewrites sub-editor options on every update, so folding is
  re-enabled after each `updateOptions`/model change.
- **Prev/Next diff** use `diffNavigation.ts`: forward and backward are strictly adjacent and
  wrap, and the change line is mapped to the pane that is currently displayed. A reveal sets
  both inner editors so the synchronized scroll lands on the change after Swap too.

### Folding deviation (intentional)

Stock VS Code disables folding on the diff editor's inner editors. The ARXML diff
re-enables `folding` on both sides; this is the modified feature, not an accident. The
preview audit records the visible-row round trip (`visibleBefore`, `visibleCollapsed`,
`visibleExpanded`) because chevrons are hover-controlled.
`buildDiffSyntheticDocuments` starts every diff fold range on the owning node line, exactly
like `buildSyntheticDocument`; a collapsed container therefore keeps its full node header
with Monaco's `⋯` fold hint instead of leaving only the opening brace visible. Fold changes
on either inner editor are mirrored to the other side by row key through the pinned
`editor.contrib.folding` contribution, so collapsing from either pane folds both. Sync skips
keys that exist on only one side, so a one-sided removed/added container cannot be unfolded by
the pane that lacks it. A collapsed row whose subtree contains a changed/added/removed row gets
a glyph-margin dot (`.arxml-fold-has-diff`); it carries no count or text and is cleared on
expansion. The marker requires the collapsed row itself to exist on both sides, and a rename of
that row alone does not mark it; descendant changes still do.
The pinned `diffEditorViewZones.js` patch sets `showInHiddenAreas: false` for side-by-side
filler view zones, so a folded block does not leave a striped diagonal-fill gap. Expanded
one-sided hunks keep the native fill.

### Gutter and copy actions

- `installDiffGutterActions` registers exactly two commands
  (`arxml.diff.copyBlockToLeft`, `arxml.diff.copyBlockToRight`) and two
  `MenuId.DiffEditorHunkToolbar` items titled **Copy Block to Left** / **Copy Block to
  Right**. The built-in Revert action stays hidden by the diff editor's read-only context;
  the ARXML actions deliberately do not depend on the built-in writable context key.
- `diffGutterAvailability.ts` sets `arxml.copyLeftAvailable` / `arxml.copyRightAvailable`
  per hunk from the hunk mapping. Both keys are true when either side owns a semantic row;
  both are false on a header/gap hunk. A one-sided hunk therefore shows both directions:
  copying from the owning side adds, copying from the empty side deletes.
- The checked-in `patches/monaco-editor+0.57.0.patch` scopes a context-key service per
  `.gutterItem` and initialises the two keys from
  `globalThis.__ARXML_GUTTER_AVAILABILITY__`; `toolbar.js` uses that scoped service. Without
  the patch, the no-row hunk would hide or show actions globally.
- The gutter action posts `{ type: 'copy', side, key }`, where `side` is the **host** side
  mapped from the displayed pane (after Swap, the displayed pane's side wins). Merge mode
  is the only write path; the host refuses a copy while it is off.

### Worker, theme and CSP

- The worker is fetched once from the `arxml-worker-uri` meta tag and started from a blob;
  a failed fetch falls back to a no-op worker and logs an error. The shell CSP allows
  `worker-src blob:`, `connect-src` for the fetch, `style-src 'unsafe-inline'` and the
  packaged font.
- `defineEcucTheme()` maps the ECUC token palette onto the Monaco theme; the page defines
  the editor theme before creating models. Do not add colour literals outside the token
  module.

## Tests Required

- `src/test/webview/syntheticDocument.test.ts` — per-side line counts, keys, editable
  spans, folding ranges and one-sided shape.
- `src/test/webview/diffCodeParity.test.ts` — version/integrity, upstream hashes, patch
  contents, page options, exactly two action registrations and no legacy classes.
- `webview-preview` skill — the diff and editor states in the full seeded set; the audit
  reads the real `.gutter`, `.gutterItem`, `.monaco-sash`, action availability, folding
  ranges, native body paint and the hunk-toolbar alignment captured before any scroll. See
  [`preview-audit.md`](./preview-audit.md).

## Wrong vs Correct

| Wrong | Correct |
|---|---|
| Parse the Monaco text back into ECUC rows | Keep the row store as the source of truth and read `rowLine`/`fieldSpans` |
| Add a numbered placeholder line for a missing diff side | Leave the side without a line; Monaco paints the native diagonal gap |
| Rebuild both diff models for a one-row patch | Apply `applyDiffPatch` and update the mapped line |
| Mount a second row renderer for the diff | Use `buildDiffSyntheticDocuments` and Monaco's diff editor |
| Let Monaco search the synthetic text | Patch the find hooks and answer from `doc.search`/`diff.search` |
| Add a third hunk action | Register exactly the two copy directions; hide with context keys |
| Disable folding to match stock VS Code | Re-enable folding on both inner editors; it is the intentional deviation |
