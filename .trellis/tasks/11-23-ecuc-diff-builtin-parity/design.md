# Design — VS Code-style ECUC diff body

## 1. Current gap

The shipped page (`src/webview/diffMonaco.ts` → `dist/diffViewer.js`) uses Monaco's diff editor, but feeds it `buildAlignedSyntheticDocuments`: two equal-length semantic row documents with brace rows, blank placeholders, comments and `@definitionRef` annotations. The page then:

- sets `renderMarginRevertIcon: false`, `useInlineViewWhenSpaceIsLimited: false`,
  `hideUnchangedRegions.enabled: false`;
- draws custom semantic line fills, glyph-margin copy arrows and a custom toolbar;
- for Show diff/Context it relies on Monaco's native `hideUnchangedRegions` widgets.
- computes navigation from Monaco `getLineChanges()` on the pre-aligned synthetic text.

The body therefore reads as a custom semantic document, not an ARXML file diff. This plan keeps the semantic body but replaces its visual/interaction shell with VS Code-style affordances.

## 2. Architecture

```text
DiffDocument (semantic rows, changes, summary, gaps)
  ├─ buildAlignedSyntheticDocuments(left/right)          [unchanged core]
  ├─ row -> original/modified line map                   [unchanged core]
  └─ VS Code-style body layer (new)
       ├─ gutter/margin decorations: +/−, copy arrows, status
       ├─ line/word highlight decorations from DiffRow.changes
       ├─ native Monaco unchanged-region widgets (hideUnchangedRegions)
       ├─ semantic overview-ruler marks + hunk navigation
       └─ whitespace/indent/density from MonacoSettings + diff CSS
```

The semantic pre-alignment and merge model are the source of truth. No native re-alignment, no raw text, no source fork.

## 3. Shared body contract (children must share)

The body surface and unchanged/ruler children both consume one adapter:

- `semanticLineFor(rowKey, side) -> line | undefined` — already available via `leftLineKeys` /
  `rightLineKeys` and `rowLine`.
- `semanticRowsAtLine(line, side)` — for gutter/margin/ruler decorations.
- `mergeActionFor(rowKey, side)` — the existing copy/delete action used by merge mode.
- `unchangedRegionState()` — the current `hideUnchangedRegions` options and Show diff/Context
  mode; child 2 verifies the native widgets against the reference.
- `diffBodyMetrics()` — gutter width, line height, font, indent, context lines and diff color
  roles, derived from `MonacoSettings` / `--vscode-*` / the shared diff theme.

The visual-proof child audits those contracts and the rendered DOM; it must not re-implement them.

## 4. VS Code reference mapping

Use the shipped VS Code/Monaco diff body as the visual reference for:

| Area | Reference |
|---|---|
| Gutter | line-number width, diff status column, +/− signs, margin width |
| Margin | revert/copy affordance position, hover/focus geometry |
| Line fills | inserted/deleted line background roles |
| Word fills | changed-word background roles and padding |
| Unchanged widget | chevron, label, height, context rows, expanded state |
| Ruler | change marks, current mark, colors |
| Density | font, line height, indentation, whitespace, scrollbar/gutter spacing |

The `microsoft/vscode` main tree is research only; the shipped `^1.125` / Monaco 0.57 behavior is the acceptance target.

## 5. Child boundaries

### 5.1 Body surface

- Gutter +/− signs, semantic status, copy-arrow merge margin, no duplicate revert in merge mode.
- Line and word highlights from `DiffRow.changes`, with VS Code color roles.
- Whitespace/indent/density from editor settings and diff CSS.
- Existing ARXML toolbar and merge/search/selection behavior remain.

### 5.2 Unchanged regions and navigation

- Keep Monaco's native `hideUnchangedRegions` widgets used by Show diff/Context; verify and style
  their VS Code geometry, labels, chevrons, context rows and expanded behavior. Do not replace
  them with the legacy semantic `DiffGap` rows.
- Add semantic overview-ruler marks and previous/next navigation; keep the current ARXML toolbar
  controls (wire them to semantic changes, not Monaco `getLineChanges()`).

### 5.3 Visual proof

- A checked-in VS Code reference capture/spec for a fixed ARXML diff state.
- An automated audit of the real diff body: classes, computed fills/colors, gutter geometry,
  copy-arrow positions, unchanged-widget geometry, ruler marks, density.
- The audit must fail on the old custom body and on plausible-but-wrong captures.

## 6. Compatibility / constraints

- No host protocol or data change; the merge actions remain the existing host operations.
- The diff is read-only; no edit/revert writes to the synthetic model.
- The current ARXML toolbar is unchanged in structure; only body-related affordances may be added
  inside it if a child needs a control.
- Inline mode, VS Code toolbar and Ignore Whitespace are out of scope.
- Rollback: revert the body-layer CSS/decorations/adapter and the reference/audit child; the
  semantic diff and host behavior remain.

## 7. Integration order

1. Body surface establishes the gutter/margin/highlight/density classes and DOM contract.
2. Unchanged/ruler consumes that contract for widgets and navigation.
3. Visual proof locks the reference and audits the integrated body.
4. Parent runs the final cross-child review, full tests, preview shots and production build.
