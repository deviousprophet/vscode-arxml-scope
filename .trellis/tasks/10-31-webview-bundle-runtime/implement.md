# Implementation plan

1. **Protocol modules**
   - Define editor/diff message unions and shared payload types.
   - Add host dispatch + webview entrypoint handlers.

2. **Host shells**
   - Replace embedded JSON + inline scripts with static HTML + `asWebviewUri`.
   - Update CSP and webview options.

3. **Editor bundle**
   - Move `editorViewer` page code into the entrypoint.
   - Mount components and wire protocol.
   - Remove serialized builder/script injection.

4. **Diff bundle**
   - Move `diffViewer` page code into the entrypoint.
   - Mount two DocumentTreeView panes; wire sync and protocol.

5. **Delete scripts**
   - Delete `scripts/check-webview-boot.cjs`, `css-loader.cjs`, `copy-webview-css.cjs`.
   - Remove references from `package.json`, `.vscode-test.mjs`, `.vscodeignore`, `.fallowrc.json`.

6. **Gates**
   - `npm run check-types`, `npm run lint`, `npm test`, `npm run package`.
   - Open editor + diff in Extension Development Host; verify no inline-script CSP errors.

## Rollback

One child commit. Revert to restore the previous server-rendered pages and scripts folder.
