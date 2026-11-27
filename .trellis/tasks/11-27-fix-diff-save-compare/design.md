# Design — fix diff save and comparison truthfulness

## Diff save

Owners:

- `src/diffProtocol.ts` — add one webview→host message: `{ type: 'save'; side: 'left' | 'right' }`.
  Keep `DiffProviderToWebview` unchanged; the existing `labels`/`copyDirty` messages carry the
  result.
- `src/webview/diffMonaco.ts` — handle `Ctrl+S`/`Cmd+S` on the page (capture phase) when the diff
  has focus, `preventDefault`, and post `{ type: 'save', side: focusedSide }`. Do not post if the
  side is not dirty; the host still re-checks.
- `src/host/diffPanel.ts` — handle `save`: find the open `TextDocument` for that side's URI and
  call `document.save()`. The normal `onDidSaveTextDocument` path clears the copied/dirty state
  and posts `labels`/`copyDirty`; do not add a second clear path.
- Keep `Save All` and the tab save untouched.

Focused side: derive from the page's active editor/pane (`original` vs `modified`) or the last
clicked copy target. If neither is focused, no message. The page should not guess a side from a
stale copy marker.

Failure: if the document is not open or the save rejects, post the existing error path; keep the
dirty markers. Do not clear optimistically.

Tests:

- Protocol test for a valid save side and an invalid side (drop/refuse).
- Host/extension test: copy, focus pane, `Ctrl+S`, wait for the file bytes and the tab dirty
  marker to clear.
- Unit-level guard for the side mapping if extracted.

## Deleted first file

Owner: the first-file stash open path (`src/host/compareSelection.ts` and/or the command in
`src/host/diffPanel.ts`/`src/commands.ts`). Before constructing the panel:

```ts
try {
  await vscode.workspace.fs.stat(firstUri);
} catch {
  await vscode.window.showWarningMessage(
    `Cannot compare: ${basename} no longer exists. Select it again as the first file.`
  );
  return; // keep the stash
}
```

Use the same path for `Compare with First File` and any staged comparison command. Do not treat a
permission failure as "deleted"; distinguish `FileNotFound` from other errors if the API allows.

Tests: extension test that deletes the stashed file and asserts no panel, a warning, and the stash
still set.

## Compatibility

- No change to copy/patch or the diff model.
- The save message is additive; older host/page pairs are not supported at runtime (the extension
  and webview ship together).
- The dirty marker remains host-owned.

## Rollback

Revert the child branch; no persisted data or migration.
