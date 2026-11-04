# Make the diff Semantic/Strict toggle respond immediately

## Goal

Switching the diff between **Semantic** and **Strict** must feel immediate. The toggle must not
re-scan, re-sort or rebuild either file model when neither file changed, and the toolbar must
acknowledge the click before the host finishes any work.

## Problem

`matchMode` in `src/host/diffPanel.ts` currently calls `refreshNow()`, which:

1. reopens both documents,
2. re-runs `gateReason` over both full texts,
3. re-runs `rowsFor` (scan + node index + row build) for both sides,
4. rebuilds the whole diff in the requested mode,
5. posts the entire `DiffDocument` to the webview.

Only the pairing mode changed. On the 20 MB manual pair (78,852 rows per side) the re-scan alone
takes ~1.5 s, the rebuild ~0.3–0.4 s, and the document payload is ~61 MB. The toolbar also shows no
new state until the replacement document arrives.

## Requirements

- **R1** A mode toggle must reuse the prepared rows, ranges and headers from the last successful
  refresh. It must not call `scanEcucValues`, `buildNodeIndex` or `buildRows`.
- **R2** Prepared data is invalidated when either document version changes. A toggle that races an
  edit must fall back to a full refresh instead of showing stale rows.
- **R3** Each prepared revision caches the document for both modes; toggling back must reuse the
  cached document.
- **R4** When semantic matching finds no rename, the strict and semantic documents are identical.
  The existing document is reused and no full-document message is posted.
- **R5** The toolbar flips `aria-pressed` and its label immediately on click, shows a spinner and a
  live “Switching to …” status, and marks the button busy until the document or a lightweight
  acknowledgement arrives.
- **R6** The host sends a lightweight `matchModeState` acknowledgement when no document post is
  needed, so the busy state always clears.
- **R7** A failed rebuild reverts the mode, keeps the last good document and shows the existing error
  notice.
- **R8** Strict output is unchanged; the setting, its default and the protocol's document payload
  stay compatible.
- **R9** No new dependency, no persisted state, no writes: the diff remains read-only.

## Acceptance criteria

- **AC1** On a 78k-row pair with no semantic renames, switching modes after the panel is open does
  not re-scan either file and reuses the current document.
- **AC2** On a renamed pair, the first switch builds only the target mode; switching back returns
  the cached document.
- **AC3** Editing a file and toggling before the debounce fires runs the full refresh path and shows
  the edited content, never the stale rows.
- **AC4** The toolbar label and `aria-pressed` change on click, a spinner and “Switching to …”
  status appear immediately, `aria-busy` is set while waiting, and the status clears on the document
  or `matchModeState`.
- **AC5** Existing strict/semantic document output and the 511 passing tests are unchanged.
- **AC6** A committed toggle benchmark reports the first-build and cached-switch times.

## Constraints

- Keep `buildDiffDocument` and `DiffOptions` as the single owner of diff output.
- Keep core free of `vscode` and DOM imports.
- Do not cache across document versions or across a panel refresh.
- Do not add page-side document caching: the webview keeps one document, so large renamed diffs
  still pay one post per actual document change.
