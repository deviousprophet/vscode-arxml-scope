# Design: bundled webview runtime

## Shape

```text
src/webview/editorViewer.ts   editor entrypoint
src/webview/diffViewer.ts     diff entrypoint
src/webviewProtocol.ts        editor host/webview union
src/diffProtocol.ts           diff host/webview union
src/webview/components/...    components
src/webview/render/...        helpers
src/webview/styles/...        tokens/base
```

Host shells:

```html
<script nonce="..." src="${editorViewerUri}"></script>
<link rel="stylesheet" href="${webviewCssUri}">
```

CSP: `default-src 'none'; style-src ${cspSource}; script-src ${cspSource}; img-src ${cspSource} data:`.

## Protocol

- Host → webview: `document` (rows/model/header), `refresh`, `select`, `error`.
- Webview → host: `ready`, `edit`, `reveal`, `select`, `compare`.
- Protocol types are the single seam; components never post directly.

## Build

`esbuild.js` adds:

- `src/webview/editorViewer.ts` → `dist/editorViewer.js` (browser IIFE)
- `src/webview/diffViewer.ts` → `dist/diffViewer.js` (browser IIFE)
- CSS from component imports → `dist/editorViewer.css` / `dist/diffViewer.css`

No `.css` text loader and no script copies.

## Migration order

1. Add protocol modules and host-side `asWebviewUri` shells.
2. Convert editor page script into `editorViewer.ts`; components keep current behavior.
3. Convert diff page script into `diffViewer.ts`.
4. Remove serialized function injection and `scripts/`.
5. Update package/test/ignore/fallow configs.
6. Gates: boot both webviews, full tests, package, large-file probe.

## Rollback

Revert the child commit; host falls back to the previous page generation. Protocol and bundle files
are additive until the switch.
