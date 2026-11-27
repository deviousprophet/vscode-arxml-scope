# UX-16 — The dirty status pushes Collapse/Expand 112 px to the right

- **Severity:** Minor
- **Gate:** Reflex — layout stability / state transition
- **Journey:** EDIT-01/EDIT-03 (typing), A11Y-02 (toolbar order), CONT-02 (dirty state)
- **Heuristic:** Nielsen #1 visibility of system status, #4 consistency; motor memory of a toolbar
- **Confidence:** High — measured in the production preview DOM at 1400×900

## Expected

The `● Unsaved changes` status appears without moving the primary toolbar controls. Collapse and
Expand keep their position; the status gets a stable slot (reserved width, a slot after the
controls, or the free space before the sidebar). A user reaching for Collapse/Expand does not miss
because the dirty state arrived.

## Actual

| Control | Clean `editor` x | `editor-dirty` x |
|---|---:|---:|
| `#editor-dirty-status` | hidden, width 0 | **8**, width **106.25** |
| `#collapse-all` | 8 | **120.25** |
| `#expand-all` | 74 | **186.25** |
| `#toggle-sidebar` | 1332 | 1332 |

The status is the first flex item, so showing it consumes 106.25 px and shifts both left-side
controls by **112.25 px**. The same layout is used in the real editor; this is a production DOM
measurement, not a preview-only wrapper.

## Repro

```powershell
node .out/measure-dirty.mjs
```

It loads the `ux-review` Preview states `editor` (clean) and `editor-dirty` (typed draft) at
1400×900 and prints the four control rects. The measured JSON is
`research/evidence/dirty-toolbar-shift.json`.

## Evidence

- `research/evidence/dirty-toolbar-shift.json`
- `research/evidence/preview/editor.png`
- `research/evidence/preview/editor-dirty.png`
- `research/evidence/preview/editor-dirty.audit.json` (0 violations; the audit checks overlap/
  outside/clipped, not position stability across states)

## Actionable Fix

1. Reserve a fixed slot for the dirty status, or move it out of the leading flex position
   (after Collapse/Expand, or into the free space before the sidebar) so the controls do not move.
2. Keep the status visible and announced (`role="status"`, `aria-live="polite"`).
3. Add a preview audit assertion comparing `#collapse-all`/`#expand-all` rects between `editor`
   and `editor-dirty`; fail on a >1 px shift.
4. Confirm in the host editor with a typed draft.

## Not a product regression in the audit

The current preview audit passed because it checks overlaps, outside-pane and clipping within each
state. It does not compare the same control's position across a state transition. The new assertion
closes that gap.
