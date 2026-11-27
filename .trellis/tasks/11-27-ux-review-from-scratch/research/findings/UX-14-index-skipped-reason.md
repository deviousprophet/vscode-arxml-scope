# UX-14 — The skipped-file tooltip does not say which reason applied

- **Severity:** Minor
- **Gate:** Finish — specific copy
- **Journey:** INDEX-03 (size cap), INDEX-09 (encoding/unreadable)
- **Heuristic:** Nielsen #9 diagnose and recover; error copy should say what/why/next
- **Confidence:** High — reproduced in the host

## Repro

1. Run the host with `UX_HOST_ONLY='index-toggles'`.
2. Write a ~1.7 MB ECUC file, set `arxmlScope.index.maxFileSizeMB` to `1`, and rebuild the index.
3. Read the status-bar tooltip.

## Expected

The skipped file names the reason that applied, e.g.
`Skipped: huge.arxml (over arxmlScope.index.maxFileSizeMB = 1 MB)`.

## Actual

- The index correctly skips the file (file count 16 → 15).
- The tooltip reports **three alternative reasons for one file**:
  `Skipped: huge.arxml (size limit, encoding or unreadable)`.
- The user cannot tell whether raising the cap will help or whether the file is unreadable.

Evidence: `research/evidence/host/deep-index-toggles-workbench.png`,
`research/evidence/host/driver-report-deep-all.json` (`index-toggles.capped.text`),
`src/host/indexService.ts` (`appendSkippedLine`).

## UX Impact

The diagnostic is present but non-specific. On a large workspace with several skipped files the
user cannot decide whether to change the cap, fix an encoding, or ignore the file.

## Actionable Fix

1. Record the skip reason per file (`too-large`, `unsupported-encoding`, `unreadable`).
2. Render one reason per file, with the threshold value for the size case.
3. Group identical reasons if the list is long.

Not fixed in this task (review only).
