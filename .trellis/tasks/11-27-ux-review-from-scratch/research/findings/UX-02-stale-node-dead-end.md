# UX-02 — A stale edit is a dead end: the blocked draft has no local surface and the only explanation sits at the bottom of the sidebar

- **Severity:** Major
- **Journey:** EDIT-14 (stale-node save), CONT-02 (dirty draft after a rebuild)
- **Heuristic:** Nielsen #5 error prevention, #9 help users recognise/diagnose/recover; user
  control and freedom
- **Confidence:** High — confirmed in the real host (`UX_HOST_ONLY=stale-node`): refusal text,
  dirty retained, no recovery control; the blocked draft has no local surface. The seeded preview
  (`editor-stale-save`) adds the editable-stale-row state.

## Repro (host)

1. Build `dist` and the debug engine, then:
   `$env:HOST_OUT='…/research/evidence/host'; $env:UX_HOST_ONLY='stale-node'; node .agents/skills/ux-review/scripts/host/run.mjs`
2. Select `Keep =` in `left.arxml`, edit its value, and rename its owning container
   (`ContKeep` → `ContKeepGone`) on disk while the draft is pending.
3. Press `Ctrl+S`.

Preview repro: `node .agents/skills/ux-review/scripts/preview/shotWebview.mjs --state editor-stale-save`.

## Expected

A visible, local state that says "this row no longer exists", with at least one explicit way out
(discard the draft, reload the rows, or undo). The Details fields for that row should not look
editable, because no edit they produce can ever be saved.

## Actual (host, confirmed)

- The save is refused — the driver records `#details-status` =
  **"The node is no longer in the file."** and the dirty strip stays visible.
- **The blocked draft has no local surface.** The Details panel never shows a "blocked" state:
  in the host capture it shows another live row (`ContParentA`, the probe's click point), and in
  the preview it keeps the **stale** node's editable Short name/Definition inputs live. Neither
  state tells the user which draft is blocked.
- The only explanation sits at the **bottom** of the sidebar, ~600 px below the fields:
  `The node is no longer in the file.`
- No control discards the draft, reloads the rows, or offers undo. Recovery requires guessing
  `Ctrl+Z` or closing the editor.
- Evidence: `research/evidence/host/edit-16-stale-workbench.png` (1440×900, webview 786×777,
  DPR 1), `research/evidence/host/driver-report-r2.json` (`stale-node` observations:
  `detailsStatus`, `dirtyHidden: false`).

## Actual (preview, additional)

- The Document keeps the removed row selected and tinted with the draft text and caret in place.
- Details keeps the **stale** node's editable Short name and Definition inputs
  (`Syntax`, `/P/Syn/Syntax`) plus `Find references` / `Reveal in source`.
- Evidence: `research/evidence/preview/editor-stale-save.png` (1400×900; status line at y≈886,
  last Details field at y≈210).

Documented intent: `docs/user/ECUC_EDITOR.md` — "a draft whose row disappears from the re-scan
blocks `Ctrl+S`, posts no save and explains that the node is gone".

## UX impact

The user is left holding an unsavable dirty document. The UI never says which draft is blocked:
the host capture happens to show a different live row, the preview keeps inviting edits on a row
that is gone, and the message is 600 px from the control being typed into. With no exit, this is
the classic "silent dead end" that makes people distrust save.

## Actionable fix

1. Put the stale notice **at the field**: a disabled/replaced input with
   `This row was removed by an external change.` directly under it.
2. Replace `Unsaved changes` in the toolbar with `Save blocked — row removed` and add one action
   next to it: **Discard draft** (and, where possible, **Reload rows**).
3. Keep the stale row selected (or show a "blocked draft" chip that reselects it) instead of
   moving the selection to an unrelated row; mark it with a warning glyph in the margin.
4. Make the bottom status line a fallback for the hidden-Details case only.

Not fixed in this task (review only).
