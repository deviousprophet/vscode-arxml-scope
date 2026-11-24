# VS Code diff parity

The ARXML diff is a modified VS Code 1.125 diff view. The gutter, hunk toolbar, sash,
overview ruler, unchanged widgets, indicators and native body paint come from the pinned
`monaco-editor` package. Only the ARXML toolbar, the synthetic ECUC documents and the two
copy actions are ours.

## Pinned release

| Item | Value |
|---|---|
| VS Code | `1.125.0` |
| `monaco-editor` | `0.57.0` |
| npm integrity | `sha512-5BkI9KGoqrNvBGUe15/QlZq3OooZ8WLg1AxTpaqHRCP3HNpzPPZKE2EDz8M7c+VRmCeUw1Brp4cx/PWm3kI/5A==` |
| package pin | `package.json` `dependencies.monaco-editor = "0.57.0"` |

`src/test/webview/diffCodeParity.test.ts` asserts the version, integrity and file hashes
below. A dependency bump fails that test until the manifest is updated and the new
surface is reviewed.

## Upstream files

| Path under `node_modules/monaco-editor/esm/vs/` | SHA-256 |
|---|---|
| `editor/browser/widget/diffEditor/features/gutterFeature.js` | `26895e826aa577208097ddd126ecae16b1785f1cdf45cea9b6e17ce5aa9dd13a` |
| `editor/browser/widget/diffEditor/components/diffEditorSash.js` | `0ada5415d0c7716760816f11f9b01a12f2f508cf511e49dee2a5d30c1fcdd5a3` |
| `editor/browser/widget/diffEditor/diffEditorWidget.js` | `b7095044c8e7e01a9b4a5aeb105c9502aa90bc32cbed0042f0a0a809fc2afc3a` |
| `editor/browser/widget/diffEditor/diffEditor.contribution.js` | `4872c4050da0c60b1f6e7cdecf636b176584dcc16d72b3ded77d983ef3693bbd` |
| `platform/actions/browser/toolbar.js` | `27f3ba3c9398042a6a777a0f6677b45ae4c7f690cbad9b9e04ebf5de38e1f71b` |

The first and last hashes are the **patched** files. The other three are the unmodified
release files.

## The checked-in patch

`patches/monaco-editor+0.57.0.patch` is applied by `patch-package` from the
`postinstall` script. It changes two upstream files:

- `gutterFeature.js` creates a scoped context-key service per `.gutterItem`, exposes the
  hovered hunk as `__arxmlGutterItem` and initialises `arxml.copyLeftAvailable` /
  `arxml.copyRightAvailable` from `globalThis.__ARXML_GUTTER_AVAILABILITY__`.
- `toolbar.js` lets the hunk toolbar use that scoped context-key service instead of the
  global one.

The stock `DiffToolBar` uses one menu context for every hunk. Without the patch, hiding
one impossible copy direction would hide it for every hunk. The patch is deliberately
scoped to the gutter toolbar; it does not change the diff algorithms, row model or host
protocol.

A fresh `npm install` / `npm ci` must run `patch-package`; if the patch does not apply,
the gutter audit fails and `diffCodeParity.test.ts` fails on the file hashes.

## Our adapters

| File | Responsibility |
|---|---|
| `src/webview/diffMonaco.ts` | Creates the diff editor with `renderGutterMenu`, `enableSplitViewResizing`, `renderSideBySide`, `readOnly`, native indicators/ruler and the per-side models. Re-enables folding on both inner editors. |
| `src/webview/monaco/diffGutterActions.ts` | Registers exactly two commands and two `MenuId.DiffEditorHunkToolbar` items: `Copy Block to Left` / `Copy Block to Right`, with the scoped `ContextKeyExpr`s. |
| `src/webview/monaco/diffGutterAvailability.ts` | Sets the per-item context keys from the hunk mapping and the displayed side; publishes a preview/debug snapshot. |
| `src/webview/monaco/monacoInternals.d.ts` | Types the pinned internal imports used by the adapter. |
| `src/webview/monaco/synthetic.ts` | Builds the independently shaped left/right ECUC documents and the line-key maps. |

No custom margin, arrow overlay, glyph merge arrow, placeholder mask, selection/subtree
tint or semantic ruler decoration remains. `diffCodeParity.test.ts` scans the webview
TypeScript and CSS for those class names.

## Intentional deviations

- **Folding is enabled in both diff panes.** VS Code's diff editor disables folding on
  its inner editors. This is the intentional modified feature: the ARXML Collapse/Expand
  toolbar actions call `editor.foldAll` / `editor.unfoldAll` on both sides. The preview
  audit records the visible-row round trip.
- **The ARXML toolbar stays.** VS Code's editor-title diff toolbar, the selection hunk
  toolbar and the accessible diff viewer are out of scope.
- **Per-side synthetic body.** Each side owns its module gaps, comments, cells and
  braces. A missing side is not padded with numbered placeholders; Monaco paints its
  native diagonal view zone.
- **Scoped hunk availability.** One-sided hunks show only the meaningful copy direction.
  The patch above makes that per-hunk rather than global.

## Verification

- `src/test/webview/diffCodeParity.test.ts` — pinned version/integrity, upstream hashes,
  patch contents, page options, exactly two action registrations and no legacy classes.
- `src/test/webview/syntheticDocument.test.ts` — per-side line counts, keys, folding and
  one-sided shape.
- `webview-preview` skill — `diff-merge`, `diff-swap`, `diff-removed`, `diff-added`,
  `diff-sash` and the full seeded set. The audit reads the real `.gutter`, `.gutterItem`,
  `.monaco-sash`, action availability, host copy side/key, folding ranges and native body
  paint.

Acceptance is code/DOM evidence, not a reference screenshot or pixel diff.
