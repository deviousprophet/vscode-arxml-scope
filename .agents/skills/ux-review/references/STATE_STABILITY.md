# State stability — cross-state geometry checks

A state can look correct in every individual screenshot and still move a control when another state
appears. This reference makes that class of defect explicit. It is general: dirty status, invalid
state, merge mode, sidebar, find, selection, loading, error, theme and zoom are all just state
transitions.

## When to run

For every surface with a stable control set, compare a baseline state with each variant at the same
viewport:

- clean → dirty / invalid / stale / saved;
- default → hover / focus / disabled / loading / error / success;
- merge off → merge on; copy pending → copied → saved;
- sidebar shown → hidden; find closed → open; selection/fold/swap changed;
- compare two files → second comparison; one side changes;
- theme light / dark / high contrast; zoom 80 / 100 / 120 / 150 %.

A state that changes a control's position or visibility is only acceptable when the product
explicitly intends it (for example a status message appearing in its own reserved slot). Record the
intent; otherwise it is a finding.

## Stable controls to name

Name the controls that should keep their position and size:

- primary toolbar actions (and their order);
- pane divider / sash, close/reveal actions, row and column anchors;
- the first row/header and the editor/panel edges;
- a status region whose slot is fixed;
- a button that is already visible and not intentionally hidden.

Do not include a control that is intentionally hidden/shown by the state; compare it separately as
an expected visibility change.

## Probe

```powershell
node .agents/skills/ux-review/scripts/preview/state-diff.mjs `
  --baseline editor --state editor-dirty `
  --selector "#collapse-all" --selector "#expand-all"
```

The command loads both states at the state's viewport, reads the selected rects, and writes a JSON
report (default: the skill's ignored `artifacts/state-diff.json`). It exits non-zero when a selector
moves by more than `--tolerance` (default 1 px), disappears, or changes display/visibility/hidden.

Use the report as evidence; add one finding per unintended transition, not one per selector. A
single control moving in the same transition is one finding.

## What the probe does not see

- Intentional layout changes (a status slot opening, a label collapsing, a pane resizing) — record
  the intent and exclude that selector.
- Scroll position, focus, caret, folds and search state — the host continuity probe covers those;
  compare the preview's page scroll/height as a secondary signal.
- Colour, contrast, text wrapping and pointer position — use the screenshot/audit and the design
  gates.
- A control that moves only during an animation — inspect the transition and the reduced-motion
  state.

## Reporting

Finding shape:

```text
[Minor/Major] <control> moves <N> px when <state> appears (surface)
Expected: the control keeps its baseline x/y/w/h; the status/label gets a reserved slot.
Actual: baseline rect -> variant rect; evidence report path.
Gate: Reflex — state-transition stability (Floor if it moves a control under the pointer during a
primary action or blocks the action).
Fix: reserve the slot / move the status / reflow the group without moving the stable controls; add
the selector pair to the cross-state probe.
```
