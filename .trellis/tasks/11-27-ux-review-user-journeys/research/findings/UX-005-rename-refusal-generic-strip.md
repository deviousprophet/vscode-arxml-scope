# UX-005 — Rename refusal uses the generic "Invalid value — not saved" strip and leaves the input unmarked

- Severity: Minor
- Journey: EDIT-10
- Surface: ECUC editor / Details short name
- Heuristic: usability (feedback, consistency), hierarchy
- Confidence: high for the rendered state

## Expected

A refused container rename names the operation and the field: the short-name input carries the
error state, the message says the rename was refused and why, and the page-level strip uses
wording that matches a rename rather than a numeric value.

## Actual

`editor-rename-refusal.png` shows:

- top strip: **Invalid value — not saved** (generic; the refusal is a short name, not a value);
- the **Short name** input keeps its normal focus border (blue) — compare
  `editor-invalid.png`, where the Value input gets a red border;
- an inline warning line under the input with the reason;
- the Document row and the bottom-right status both repeat the reason.

So the reason is present three times, but the field itself is not marked, and the most
prominent text says the wrong kind of thing.

## Repro

1. `node .agents/skills/webview-preview/scripts/shotWebview.mjs --state editor-rename-refusal`
2. Compare with `--state editor-invalid`.
3. Read both audits (0 violations), then compare the field borders and top strips.

## Evidence

- `research/evidence/preview/editor-rename-refusal.png`
- `research/evidence/preview/editor-invalid.png`
- `research/findings/UX-001-stale-save-hidden-status.md` (same feedback-routing theme)

## Notes

The preview message text is test-injected ("refused by the test host"), so judge the shape and
placement, not the wording of the cause.
