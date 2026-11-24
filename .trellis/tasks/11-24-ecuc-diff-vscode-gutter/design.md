# Design — built-in VS Code diff gutter and sash

## 1. Baseline on `main`

`src/webview/diffMonaco.ts` currently uses `buildAlignedSyntheticDocuments`, blank placeholders, custom placeholder decorations, glyph-margin merge arrows and `enableSplitViewResizing: false`. The native diff is rendered, but the body is pre-aligned and the merge UI is custom. This task replaces that shell with the actual VS Code/Monaco diff-view UI.

## 2. Architecture

```text
DiffDocument (semantic rows, changes, summary)
  ├─ buildDiffSyntheticDocuments(left/right)       per-side display + line-key maps
  ├─ buildDiffBody(...)                            topmost-row/hunk mapping
  └─ monaco.editor.createDiffEditor
       ├─ native indicators/fills/word spans/diagonal gaps
       ├─ native overview ruler + unchanged widgets
       ├─ renderGutterMenu: DiffEditorGutter (35px)
       │    ├─ DiffToolBar (hover / current-hunk showAlways)
       │    └─ DiffEditorSash (enableSplitViewResizing)
       └─ ARXML adapter
            ├─ MenuId.DiffEditorHunkToolbar actions
            ├─ hunk → topmost semantic row
            └─ host copy (stored side shown in the source pane)
```

No custom margin, arrow overlay, glyph merge arrow, placeholder mask, selection/subtree tint or semantic ruler decoration remains.

## 3. Diff editor options

- `renderSideBySide: true`, `useInlineViewWhenSpaceIsLimited: false`.
- `enableSplitViewResizing: true`; default 50/50; built-in sash double-click reset.
- `renderGutterMenu: true`.
- `renderMarginRevertIcon` is irrelevant because the gutter menu disables the old revert-arrow path; do not use it.
- `readOnly: true`, `originalEditable: false`; this hides the built-in “Revert Block” action via `diffEditorModifiedWritable`, while the inner editors stay read-only and our custom actions remain visible.
- `renderIndicators: true`, `renderOverviewRuler: true`, `ignoreTrimWhitespace: false`, `diffAlgorithm: 'advanced'`.
- `glyphMargin: true`, `lineNumbers: 'on'`, `lineNumbersMinChars: 3`, `lineDecorationsWidth: 14` to match the measured VS Code 1.125 gutter.
- **Intentional modified feature — folding:** the VS Code diff editor disables folding on its inner editors. Re-enable `folding: true` and `showFoldingControls: 'mouseover'` on both inner editors after creation and after every `diffEditor.updateOptions`/view toggle. The ARXML Collapse/Expand toolbar buttons call `editor.foldAll`/`editor.unfoldAll` on both sides. The per-side synthetic folding ranges are the source. This is a documented deviation from stock VS Code diff behavior.
- `hideUnchangedRegions` stays on the Show diff/Context path.

## 4. Per-side synthetic body

- Add `buildDiffSyntheticDocuments(document)` emitting each side’s module gaps, comments, cells and braces only on the owning side.
- Keep `leftLineKeys`/`rightLineKeys`, per-side `rowLine`, folding and native model text.
- Map a hunk to its topmost semantic row through the existing line-key arrays and `firstKeyInRange`; no separate body model is added.
- Remove placeholder decorations and CSS. A missing side has no line, so Monaco paints the diagonal gap and nothing is numbered there.
- Remove custom selection/subtree tints and semantic overview-ruler decorations; native Monaco paint is the only body paint.

## 5. Built-in gutter and ARXML actions

`DiffEditorGutter` creates a 35px gutter, a `DiffToolBar` per hunk and the sash. It reads actions from `MenuId.DiffEditorHunkToolbar` through the workbench menu service already bundled in `monaco-editor@0.57.0`.

Add a small adapter (`src/webview/monaco/diffGutterActions.ts`) that:

- imports `MenuRegistry`, `MenuId`, `CommandsRegistry`, `ContextKeyExpr` and `Codicon` from the pinned Monaco internals;
- registers exactly two commands/actions:
  - `Copy Block to Left` — icon `arrowLeft`;
  - `Copy Block to Right` — icon `arrowRight`;
- appends both to `MenuId.DiffEditorHunkToolbar`, group `primary`, no dependency on `diffEditorModifiedWritable`;
- receives the `ActionRunnerWithContext` payload (`mapping`, `originalWithModifiedChanges`, URIs), maps the hunk to the topmost semantic row, and posts the existing host `copy`;
- never edits the synthetic model.

The built-in Revert action is hidden by `readOnly: true`; there is no third button.

### 5.1 Hunk → row

- Use the displayed pane ranges (`mapping.original` / `mapping.modified`) and the per-side line-key arrays.
- Walk the hunk’s lines and take the first keyed changed/added/removed row (topmost semantic row).
- Copying a container row’s cell range carries its subtree.
- If no row is found, the action does nothing; availability filtering should prevent that state.

### 5.2 Direction and Swap

- Labels refer to displayed panes.
- Copy Left: source = displayed modified pane, target = displayed original pane; host side = stored side shown in the modified pane.
- Copy Right: source = displayed original pane; host side = stored side shown in the original pane.
- Swap reverses only the displayed mapping; the labels stay truthful.

### 5.3 Per-hunk availability

Both actions are registered permanently. A small `diffGutterAvailability` adapter sets two scoped context keys:

- `arxml.copyLeftAvailable`
- `arxml.copyRightAvailable`

They are updated for:

- the current hunk on cursor changes (so the `showAlways` toolbar is correct);
- the hovered `.gutterItem` on gutter mouseover/mouseleave (so a hovered one-sided hunk hides the impossible action).

The menu items use `ContextKeyExpr` with those keys. The built-in toolbar rebuilds its buttons when the keys change; no toolbar DOM is rebuilt by us. The hovered hunk is found from the `.gutterItem` vertical range via the modified editor’s line geometry and `getLineChanges()`.

If this adapter cannot be made reliable using the internal menu/context-key API, stop and return to design with evidence; do not ship a dead button or a custom toolbar replacement.

### 5.4 Merge gating

- The gutter and sash stay mounted in all modes.
- Outside `#diff-monaco.arxml-diff-merge`, hide only `.gutter .gutterItem` (buttons and separator); the 35px gutter and `.sash` remain, so panes resize.
- Inside Merge, use the built-in hover and `showAlways` behavior.
- No extra always-visible action is registered.

### 5.5 Short-hunk overflow

VS Code’s `DiffToolBar` uses `overflowBehavior.maxItems = 1` when the hunk starts at line 1 and is shorter than 30px, rendering a “More Actions…” button. Keep that behavior; the submenu exposes the two copy actions with their normal labels/tooltips. The audit must open the overflow menu rather than requiring both icons inline on that hunk.

### 5.6 Scoped per-item context (accepted patch)

The stock `DiffToolBar` creates one menu context for every hunk. Hiding one direction on a
one-sided hunk therefore requires a context-key service scoped to that hunk’s `.buttons`
element. We checked in `patches/monaco-editor+0.57.0.patch`, applied by `patch-package`
from `postinstall`:

- `gutterFeature.js` creates a scoped service per `.gutterItem`, exposes the hovered
  hunk as `__arxmlGutterItem` and initialises `arxml.copyLeftAvailable` /
  `arxml.copyRightAvailable` from `globalThis.__ARXML_GUTTER_AVAILABILITY__`;
- `toolbar.js` lets `MenuWorkbenchToolBar` use `options.contextKeyService`.

This is the only upstream modification. `docs/vscode-diff-parity.md` records the patched
file hashes and `diffCodeParity.test.ts` fails on drift. A fresh `npm ci` must run
`patch-package`; without it the impossible direction cannot be hidden per hunk.

## 6. Sash and ratio

- The built-in `DiffEditorSash` is enabled by `enableSplitViewResizing` and exists because the gutter has actions.
- A 50/50 default, drag and double-click reset are Monaco behavior; do not reimplement.
- Keep the ratio across `setModel` updates and Swap. Verified in `diff-sash`: initial
  panes `637/672` (left content plus the 35px gutter equals the right pane), dragged
  `777/532`, unchanged after a document replacement and after Swap, and double-click
  reset back to `637/672`. No ratio adapter is needed; Monaco preserves it.
- The preview audit measures the real `.monaco-sash` drag and records all width pairs.

## 7. Code-level parity proof

Check in `docs/vscode-diff-parity.md`:

- VS Code `1.125.0`, Monaco `0.57.0`, npm package integrity.
- Upstream paths: `features/gutterFeature.js`, `components/diffEditorSash.js`, `diffEditorWidget.js`, `diffEditor.contribution.js`, `style.css`.
- Our adapter files and the exact internal imports.
- Rule: upstream files are unmodified; only the adapter/options/content are ours.

Automated proof:

- `src/test/webview/diffCodeParity.test.ts`:
  - assert `monaco-editor` version/integrity;
  - hash the upstream gutter/sash/diff-editor/contribution files against constants;
  - assert the page enables `renderGutterMenu` and `enableSplitViewResizing`;
  - assert no custom `arxml-diff-merge-margin`, `arxml-merge-arrow`, `arxml-copy-left-margin`, `arrow-revert-change` or placeholder paint remains;
  - assert exactly two `DiffEditorHunkToolbar` registrations and no built-in Revert dependency.
- Preview audit (`previewAudit.ts`):
  - `.gutter` width, `.gutterItem` presence, `.sash`;
  - hover/current-hunk reveals the built-in toolbar;
  - labels/icons for changed and one-sided hunks;
  - Merge gating hides items outside Merge but keeps the sash;
  - copy click posts the correct host side/key;
  - sash drag changes pane widths and double-click resets to 50/50;
  - native paint, overview ruler and unchanged widgets remain.
- No screenshot or reference-image acceptance.

## 8. Risks and mitigations

- **Internal Monaco imports** can drift on upgrade: pin the version and hash the upstream files; fail the parity test on drift.
- **Per-hunk context filtering** could flicker or lag on hover: test the real DOM; if unreliable, return to design rather than custom-render the toolbar.
- **Sash ratio across `setModel`** may reset: test; use the smallest built-in-compatible restoration if needed.
- **Topmost-row mapping** for a multi-row hunk is intentional; document it in the adapter and tests.
- **Read-only context key**: `readOnly: true` hides the built-in Revert action; confirm our actions remain visible and the gutter/sash still mount.
- **No placeholder paint**: a missing side must rely on native diagonal fill; verify `diff-one-sided`.

## 9. Rollback

- The branch is isolated from `main`; rollback is deleting the branch or reverting the task commits. No protocol, persisted format or host data migration.
