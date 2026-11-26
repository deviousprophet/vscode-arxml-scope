# UX-003 — Copied rows are unsaved but the editor does not show the unsaved-changes strip

- Severity: Minor
- Journey: EDIT-38, MERGE-15
- Surface: ECUC editor / copied-row markers
- Heuristic: usability (consistency, feedback), flow
- Confidence: medium — preview only; the host tab bullet may partly cover this

## Expected

Any unsaved state in the ECUC editor is announced the same way. Copied rows are explicit
unsaved changes, so the page-level indicator that appears for typed edits should also appear
for a merge copy, or the copied-row marker should carry its own "unsaved copy" explanation.

## Actual

- `editor-dirty.png` (typed edit): the top strip shows **• Unsaved changes**.
- `editor-copied.png` (rows copied from the diff): the top strip is empty; the only signal is
  the amber margin bar and faint line tint at the copied rows.

The two unsaved states look different and only one of them says "unsaved" in words. The host
tab title carries a `•` for both (`docs/user/MERGE.md`), so the page itself is inconsistent,
and a user looking at the page after a merge copy can miss that `Ctrl+S` is still required.

## Repro

1. `node .agents/skills/webview-preview/scripts/shotWebview.mjs --state editor-copied`
2. Compare with `--state editor-dirty`.
3. Read both audits (0 violations) and compare the top strips and margin markers.

## Evidence

- `.agents/skills/webview-preview/artifacts/editor-copied.png`
- `.agents/skills/webview-preview/artifacts/editor-dirty.png`
- `.agents/skills/webview-preview/artifacts/editor-copied.audit.json`

## Notes

The preview shell has no tab title, so this may be partially masked in the real host. Keep the
confidence at medium until EDIT-38 runs against the host.

## Disposition (Phase 4)

**Limitation, not a report finding.** `docs/user/MERGE.md` defines the copied-row marker as a
deliberately distinct signal from typed edits, and the real host shows the receiving file's own
dirty tab plus the pane bullet. The preview difference is consistent with that design; no
separate page strip is required. Kept here for traceability, not scored.
