# Component Spec — DiffView shell

> The Monaco diff page owns the body. This component owns the shell around it.

## Scope / Trigger

`src/webview/components/diffView/` owns the fixed file-name strip, the `#diff-list` host box, the
empty state and the matching component CSS. The two panes, body paint, scrolling, gutter, sash and
folding are Monaco's, mounted by `src/webview/diffMonaco.ts`.

The `DiffView` class is a legacy shell controller; the shipped diff page imports
`renderDiffViewHtml()` and `diffView.css`, not the class. Do not extend the class for new diff work.

## Layout

```text
src/webview/components/diffView/
    diffView.ts          renderDiffViewHtml() + legacy shell class
    diffViewRender.ts    pure shell markup
    diffView.css         shell, title strip, empty state
src/webview/diffMonaco.ts   Monaco composition root
src/test/webview/components/diffView.test.ts
src/test/webview/diffCodeParity.test.ts
```

## Contract

- `renderDiffViewHtml()` returns the static shell with `#diff-body`, `#diff-title-strip`,
  `#diff-title-left` / `#diff-title-right`, `#diff-list`, `#diff-empty` and `#diff-notice`.
- `diffMonaco.ts` sets `#diff-list` to `.monaco-diff-host` and appends `#diff-monaco`; it mounts
  `monaco.editor.createDiffEditor`.
- `diffView.css` must not own `.diff-row`, `.diff-cell`, `.word-changed`, a copy-arrow strip or a
  custom pane grid.
- Merge visibility is `#diff-monaco:not([data-merge="true"]) .gutterItem { visibility: hidden;
  pointer-events: none; }`; the `.gutter` and `.monaco-sash` stay mounted and the items keep their
  layout so Monaco can center their button toolbar. The toolbar keeps `aria-pressed`.
- Title labels come from `DiffDocument.labels`; `Swap sides` swaps the two labels and the model
  pair.
- `#diff-empty` is the explicit no-difference state; `#diff-notice` is the error banner.

## Rules

- The fixed title strip sits above `#diff-list` and never scrolls. It is one flex bar: left label,
  separator, right label. It is not split at 50%, because the sash can move.
- The diff body is not a `VirtualScroll` or `DocumentTreeView` surface. Monaco owns line numbers,
  status fills, word spans, diagonal gaps, overview ruler, unchanged widgets and both scroll axes.
- The ARXML Collapse/Expand toolbar actions call `editor.foldAll`/`editor.unfoldAll` on both inner
  editors; the shell does not render folding controls.
- `Copy Block to Left` / `Copy Block to Right` are `MenuId.DiffEditorHunkToolbar` actions registered
  by `diffGutterActions.ts`; a one-sided hunk offers both directions.
- The preview audit reads the real `.gutter`, `.gutterItem`, `.monaco-sash`, action labels, folding
  round trip and sash widths. A deleted feature must fail the audit.

## Validation & error matrix

| Condition | Behaviour |
|---|---|
| One-sided hunk | Both copy actions are rendered; the missing side uses Monaco's diagonal gap |
| Merge off | `.gutterItem` hidden with `visibility`, `.gutter`/`.monaco-sash` still mounted |
| Swap | Title labels and model pairs flip; horizontal offsets reset; sash ratio and vertical position stay |
| Change-only view | `hideUnchangedRegions` owns the collapsed runs; no custom body rows |
| Empty document | `#diff-empty` shown, no editor rows |
| Engine/compare error | `#diff-notice` shows the error banner |

## Tests Required

- `src/test/webview/components/diffView.test.ts`: shell markup, title strip and CSS ownership.
- `src/test/webview/diffCodeParity.test.ts`: static source/hash contract for the pinned Monaco surface.
- `ux-review` Preview mode: `diff-merge`, `diff-swap`, `diff-one-sided`, `diff-removed`, `diff-added`,
  `diff-sash` and the full seeded set; the audit proves the real DOM.
