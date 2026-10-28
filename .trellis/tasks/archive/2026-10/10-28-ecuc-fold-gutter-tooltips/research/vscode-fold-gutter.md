# VS Code fold-gutter research

Sources checked on 2026-10-28 (microsoft/vscode `main`):

## Width and placement

`src/vs/editor/common/config/editorOptions.ts`:

- `lineDecorationsWidth` defaults to **10px**.
- When folding is enabled and folding controls are shown, the layout adds **16px**:
  `lineDecorationsWidth += 16`.
- The margin order is glyph margin, line numbers, **line decorations**, then content.
  With line numbers off, the line-decoration gutter is the far-left content gutter.

Result for this editor: a fixed **26px** fold gutter (10 + 16), with document text starting after it.

## Icon and visibility

`src/vs/editor/contrib/folding/browser/folding.css`:

- Fold icons have a **2px left margin**, are flex-centred, use a 140% icon size and
  start at `opacity: 0`.
- Hovering the margin overlays reveals the icons.
- A collapsed icon is always visible (`codicon-folding-collapsed`).
- The transition is 0.5s; reduced motion removes it.

`src/vs/editor/contrib/folding/browser/foldingDecorations.ts`:

- Expanded ranges use `foldingExpandedIcon` (chevron-down).
- Collapsed ranges use `foldingCollapsedIcon` (chevron-right).

Our chosen match:

- 16px outline Codicon chevron, 2px inset, full row-height hit area.
- Expanded chevrons hidden at rest, revealed while the tree is hovered or focused.
- Collapsed chevrons always visible.
- The right chevron rotates 90 degrees for the expanded down chevron.

## Codicon path

`microsoft/vscode-codicons` `src/icons/chevron-right.svg`:

```text
M6.14601 3.14579C5.95101 3.34079 5.95101 3.65779 6.14601 3.85279L10.292
7.99879L6.14601 12.1448C5.95101 12.3398 5.95101 12.6568 6.14601 12.8518C6.34101
13.0468 6.65801 13.0468 6.85301 12.8518L11.353 8.35179C11.548 8.15679 11.548
7.83979 11.353 7.64478L6.85301 3.14479C6.65801 2.94979 6.34101 2.95079 6.14601
3.14579Z
```

The path is MIT-licensed; the implementation inlines it as SVG and keeps the
attribution in a code comment. No icon font or asset file is added.

## Deliberate difference

VS Code hides expanded chevrons until the margin is hovered. This editor does the
same for pointer hover/focus, but keeps the rest of the Document interaction model
unchanged.
