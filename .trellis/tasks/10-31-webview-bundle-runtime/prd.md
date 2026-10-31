# Bundle webview runtime and remove scripts

## Goal

Replace host-generated HTML pages and serialized page functions with bundled webview entrypoints and
typed protocols, matching Hex Scope. Delete the `scripts/` folder.

## Requirements

- `src/webview/editorViewer.ts` and `src/webview/diffViewer.ts` become browser entrypoints.
- Host renders a static shell with CSP and `asWebviewUri` for the bundled script/style.
- `webviewProtocol.ts` and `diffProtocol.ts` define host→webview data/commands and webview→host
  intents.
- Providers no longer embed JSON documents or serialize functions into HTML.
- esbuild emits `dist/editorViewer.js`, `dist/diffViewer.js` and CSS.
- Delete `scripts/check-webview-boot.cjs`, `scripts/css-loader.cjs`, `scripts/copy-webview-css.cjs`.
- Remove every `scripts/` reference from package scripts, test config, ignore lists and fallow config.
- Editor and diff behavior is unchanged.

## Acceptance

- [ ] Both webviews load from bundled assets with a strict nonce/CSP.
- [ ] No `Function.prototype.toString()` page injection remains.
- [ ] `scripts/` is deleted.
- [ ] `npm run check-types`, lint, test, package pass.
- [ ] Large-file scrolling still bounded in both views.
