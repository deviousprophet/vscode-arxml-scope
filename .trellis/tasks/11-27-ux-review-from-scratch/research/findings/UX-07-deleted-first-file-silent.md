# UX-07 — A deleted first file is compared silently, with no warning

- **Severity:** Major
- **Journey:** ENTRY-16 (first file deleted before Compare with First), MERGE-02 (copy out of a
  stale side), CONT-04
- **Heuristic:** Nielsen #1 visibility of system status, #5 error prevention; trust and safety
- **Confidence:** High — reproduced in the host (`stale-first` scenario)

## Repro

1. `$env:UX_HOST_ONLY='stale-first'; node .agents/skills/ux-review/scripts/host/run.mjs`
   (the runner copies `left.arxml` to `stale-first.arxml`, selects it as the first file, deletes
   it from the workspace, then runs **Compare with First File** on `right.arxml`).
2. Observe the notification area, the tab title and the left pane label.

## Expected

The extension refuses or clearly flags the missing side: a warning naming the deleted file, the
stash kept for a retry, and no normal-looking comparison — or, at minimum, a visible "this file
was deleted" notice inside the panel. `docs/user/DIFF.md` says both sides "must be readable" and
that a refused compare leaves the stash in place.

## Actual

- A full diff opens titled `stale-first.arxml ↔ right.arxml`; the left pane renders the deleted
  file's content from the still-open buffer.
- `notifications: []` — no warning at all.
- The Explorer no longer lists `stale-first.arxml`; the tab title and pane label still name it as
  a normal side.
- The comparison is fully operable (Merge is available), so a copy can be taken from a document
  that no longer exists on disk.
- Evidence: `research/evidence/host/entry-16-stale-first-workbench.png`,
  `research/evidence/host/driver-report-r3.json` (`stale-first`: `existsAfterDelete: false`,
  `notifications: []`, one diff tab).

## UX impact

The panel asserts a comparison against a file the user deleted. There is no cue that the left
bytes are an in-memory ghost, so a merge copy can write data derived from a file that is gone.
The only way to notice is to cross-check the Explorer.

## Actionable fix

1. On `compareToStaged`, stat the stashed URI (or check `document.isClosed` / the deleted flag)
   and show a warning such as
   `"stale-first.arxml" no longer exists. Select a first file again.`; keep the stash for a retry.
2. If an open buffer is intentionally used, label the pane `stale-first.arxml (deleted)` and show
   a notice strip `This file was deleted from disk; the comparison uses an unsaved buffer.`
3. Disable Merge while either side is a deleted buffer, or require an explicit confirmation.

Not fixed in this task (review only).
