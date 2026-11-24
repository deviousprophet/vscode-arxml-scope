# Design — VS Code-style ECUC diff body

## 1. Current gap

The shipped page (`src/webview/diffMonaco.ts` → `dist/diffViewer.js`) uses Monaco's diff editor, but feeds it `buildAlignedSyntheticDocuments`: two equal-length semantic row documents with brace rows, blank placeholders, comments and `@definitionRef` annotations. The page then:

- sets `renderMarginRevertIcon: false`, `useInlineViewWhenSpaceIsLimited: false`,
  `hideUnchangedRegions.enabled: false`;
- draws custom semantic line fills, glyph-margin copy arrows and a custom toolbar;
- for Show diff/Context it relies on Monaco's native `hideUnchangedRegions` widgets.
- computes navigation from Monaco `getLineChanges()` on the pre-aligned synthetic text.

The body therefore read as a custom semantic document, not an ARXML file diff. This plan keeps
the semantic body but replaces its visual/interaction shell with VS Code-style affordances.

Resolved on `feat/ecuc-diff-body-surface`: per-side synthetic documents, native paint and
overview ruler, the built-in margin right arrow rebound to the ARXML copy, and one copy-left
arrow with the same DOM/CSS.

## 2. Architecture

```text
DiffDocument (semantic rows, changes, summary, gaps)
  ├─ buildDiffSyntheticDocuments(left/right)            [per-side display]
  ├─ row -> left/right line map                          [unchanged core]
  └─ built-in Monaco diff body
       ├─ native +/− indicators, line/word fills, diagonal gaps
       ├─ native unchanged-region widgets (hideUnchangedRegions)
       ├─ built-in diff-margin right arrow + one copy-left arrow
       ├─ native overview ruler
       └─ semantic previous/next navigation from DiffRow status
```

The semantic pairing and merge model are the source of truth; the body is the
built-in diff over two per-side synthetic ECUC documents. No native raw-text
re-alignment and no custom row renderer.

## 3. Shared body contract (children must share)

The body surface and unchanged/ruler children both consume one adapter:

- `semanticLineFor(rowKey, side) -> line | undefined` — already available via `leftLineKeys` /
  `rightLineKeys` and `rowLine`.
- `semanticRowsAtLine(line, side)` — for merge/navigation mapping.
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
| Margin | built-in `arrow-revert-change` position and hover geometry |
| Line fills | inserted/deleted line background roles |
| Word fills | changed-word background roles and padding |
| Unchanged widget | chevron, label, height, context rows, expanded state |
| Ruler | native `.diffOverview` geometry and change marks |
| Density | font, line height, indentation, whitespace, scrollbar/gutter spacing |

The `microsoft/vscode` main tree is research only; the shipped `^1.125` / Monaco 0.57 behavior is the acceptance target.

## 5. Child boundaries

### 5.1 Body surface

- Per-side synthetic documents and native +/− signs, fills, word spans, diagonal gaps and overview ruler.
- The built-in diff-margin right arrow plus one copy-left arrow; no custom overlay or duplicate revert.
- Whitespace/indent/density from editor settings and diff CSS.
- Existing ARXML toolbar and merge/search/navigation behavior remain.

### 5.2 Unchanged regions and navigation

- Keep Monaco's native `hideUnchangedRegions` widgets used by Show diff/Context; verify and style
  their VS Code geometry, labels, chevrons, context rows and expanded behavior. Do not replace
  them with the legacy semantic `DiffGap` rows.
- Keep the native overview ruler and wire previous/next navigation to semantic changes; keep the
  current ARXML toolbar controls (not Monaco `getLineChanges()`).

### 5.3 Visual proof

- A checked-in VS Code reference capture/spec for a fixed ARXML diff state.
- An automated audit of the real diff body: classes, computed fills/colors, gutter geometry,
  built-in margin arrows, unchanged-widget geometry, native overview ruler, density.
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
