# Design — fix editor refusal and recovery feedback

## Invalid/refused value (UX-01)

Owner: `src/webview/editorMonaco.ts` invalid/refusal state and its render helpers, plus the
Details rendering and preview audit.

- Single source of truth: one refusal state per field (`nodeId`, `field`, `reason`, `display`).
- Render once at the strongest local surface:
  - Details visible → field border + inline reason + one page strip; status line secondary.
  - Details hidden → page strip with the same reason; no duplicate inline copy.
- Use one severity/colour for refusal; reserve red for invalid input, amber for a blocked-but-
  recoverable save. Do not mix them on the same event.
- Derived formats: compute Decimal/Hex/Binary from the current draft when it is a valid integer;
  otherwise label the block "last accepted value" or hide it. The panel must not silently show
  stale numbers.
- Tests: preview states `editor-invalid`, `editor-rename-refusal`; page/unit audit for the
  single-surface rule; host `stale-node`/rename once available.

## Stale node (UX-02)

Owner: the page's stale refusal path plus the host's save/refusal response.

- On a stale refusal, set a page-level `staleNode` state: mark the row, disable the Details
  controls for that node, and show a persistent banner: **"This row is no longer in the file."**
- Actions:
  - **Discard draft** — drop the local draft, restore the host value/none, clear dirty if no
    other drafts remain.
  - **Reload** — ask the host for the current document/re-scan; keep the draft until the user
    chooses discard.
- The row must not remain editable as a phantom; `Ctrl+S` must not loop on the dead node.
- Host: the existing refusal message remains, but the page owns the recovery controls. Do not
  add a second host protocol unless the reload needs one.
- Tests: preview `editor-stale-save` with audit assertions for the banner, disabled field and
  row marker; host `stale-node` for the real refusal and action.

## Compatibility

- The draft store and protocol shapes stay; this is UI state plus a recovery action.
- A valid node after reload behaves exactly as today.

## Rollback

Revert the child branch; no persisted data.
