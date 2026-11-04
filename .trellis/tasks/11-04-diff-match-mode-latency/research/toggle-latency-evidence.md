# Evidence — diff match-mode latency

## Code path (before the fix)

`src/host/diffPanel.ts`:

- `matchMode` → `semantic = next` → `void refreshNow()`.
- `refreshNow()` reopens both documents, runs `gateReason` over both texts, calls `rowsFor` for
  both sides, calls `buildDiffDocument`, and posts the whole document.

`rowsFor` performs `scanEcucValues` + `buildNodeIndex` + `buildRows`; none of it depends on the
semantic mode.

## Measurements

Local Windows machine, Node 24, `out/` build, 20 MB manual pair:

- `H:\workspace\sample\arxml\all-cases.arxml`
- `H:\workspace\sample\arxml\all-cases copy.arxml`

| Step | Result |
|---|---|
| Left rows | 77,852 rows, 743 ms |
| Right rows | 77,852 rows, 761 ms |
| Strict diff build from prepared rows | 408 ms |
| Semantic diff build from prepared rows | 294 ms (`renamed = 0`) |
| Current toggle cost (rows + one build) | ≈ 1.5–1.9 s |
| `JSON.stringify(document)` | 61.1 MB, 226–238 ms |
| `structuredClone(document)` | ≈ 623–653 ms (proxy for one postMessage) |

The pair has `changed: 1, added: 1, removed: 1, unchanged: 77,850` and **no semantic renames**, so
strict and semantic output are identical. This is the common large-file case and the cheapest to
short-circuit.

## Conclusion

- The re-scan is the largest removable cost.
- A prepared-side/document cache removes the scan and rebuild on every toggle.
- When semantic finds no rename, the two documents are identical; reuse the current object and skip
  the 61 MB post entirely.
- The toolbar can confirm the click before the host work, so the user gets immediate feedback even
  on a large renamed diff where a document still has to be posted.
