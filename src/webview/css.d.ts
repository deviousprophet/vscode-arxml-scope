/**
 * Colocated component stylesheets are side-effect imports.
 *
 * esbuild bundles them into `dist/editorViewer.css` / `dist/diffViewer.css`; the
 * host exposes those files through `asWebviewUri`. The test host has no CSS
 * loader, so `src/test/webview/cssImportHook.ts` teaches `require` to swallow
 * them before any component module loads.
 */
declare module '*.css';
