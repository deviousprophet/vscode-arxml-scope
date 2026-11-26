# UX-006 — Details / Conditions tabs are rotated vertical text at the far-right edge

- Severity: Minor
- Journey: EDIT-31, A11Y-02
- Surface: ECUC editor / sidebar
- Heuristic: hierarchy, accessibility & ergonomics
- Confidence: high for the rendering; screen-reader behaviour untested

## Expected

Panel tabs sit at the top of the sidebar next to the panel they switch, with horizontal labels
that scan in one pass. The active tab is obvious without reading rotated text.

## Actual

In `editor.png` the two tabs are rendered as 90°-rotated words **DETAILS** and **CONDITIONS**
along the extreme right edge of the window, separated from the Details content by the whole
panel width. Reading them requires turning the head or tilting the screen; the active tab is
marked only by a slightly brighter background/underline. The Details panel's own header
(`⌄ DETAILS`) repeats the tab name, so the two labels compete.

## Repro

1. `node .agents/skills/webview-preview/scripts/shotWebview.mjs --state editor`
2. Read `editor.audit.json` (selected: `Details`, 0 violations), then open `editor.png`.
3. Locate the tab labels on the right edge and compare with the Details header.

## Evidence

- `.agents/skills/webview-preview/artifacts/editor.png`
- `.agents/skills/webview-preview/artifacts/editor.audit.json`

## Notes

Rotated labels are not automatically an accessibility failure, but they are a scannability
cost for every user and an extra burden for low-vision and dyslexic users. Confirm with the
host keyboard pass (A11Y-02) whether focus order also follows the visual edge placement.
