# UX-010 — A deleted first file is still compared from cached text, with no warning

- Severity: Minor
- Journey: ENTRY-16
- Surface: Compare commands / missing first file
- Heuristic: usability (truthfulness, error prevention)
- Confidence: medium — host deletion used `vscode.workspace.fs.delete`

## Expected

`Compare with First File` re-opens the stashed first file when it runs. If that file no longer
exists, the command warns, names it, and opens no panel (or shows a persistent banner in the
panel). The user must not be shown a comparison against content that is no longer on disk
without being told.

## Actual

Real Extension Development Host, `stale-first` scenario:

1. `stale-first.arxml` (a never-opened copy of `left.arxml`) is selected as the first file.
   `selectAsFirst` opens it with `workspace.openTextDocument` to gate it.
2. The file is deleted via `vscode.workspace.fs.delete`; `existsAfterDelete` is `false`.
3. `Compare with First File` on `right.arxml` opens
   `stale-first.arxml ↔ right.arxml` with the cached left content, **no warning**, and an empty
   notification list.

The panel title even keeps the now-missing file name. The comparison is deterministic, but it
presents deleted content as if it were current.

## Repro

1. Run the host with `UX_HOST_ONLY=stale-first`.
2. Read `scenarios[id=stale-first].observations` (`existsAfterDelete`, `notifications`, `tabs`).
3. Open `entry-16-stale-first-workbench.png`.

## Evidence

- `research/evidence/host/entry-16-stale-first-workbench.png`
- `research/evidence/host/driver-report.json` → `scenarios[id=stale-first].observations`

## Notes

The document stays in `vscode.workspace.textDocuments` because `selectAsFirst` opened it, so
`openTextDocument` returns the cached text rather than throwing. A real Explorer delete may close
and dispose it — which is why the confidence stays medium — but the same caching can occur when
the file was opened earlier in the session. Either way, the missing-resource step deserves an
explicit check and message.
