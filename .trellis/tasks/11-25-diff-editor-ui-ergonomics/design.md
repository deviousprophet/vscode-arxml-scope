# Design — diff and editor UI ergonomics

## 1. Title strip

`diffViewRender.ts` currently renders a two-column grid with a `::after` divider at 50%.
The sash can move, so that divider is a lie. Replace it with:

```html
<div id="diff-title-strip">
  <span id="diff-title-left"></span>
  <span class="diff-title-sep">↔</span>
  <span id="diff-title-right"></span>
</div>
```

Use `display:flex`, `gap:6px`, two `flex:1 1 0` cells and right-align the last cell. Remove
the fixed 50% divider. `setTitle` drops the `· schema` suffix and keeps path/schema in the
tooltip.

## 2. One-sided copy and delete

The host already supports an empty-side click: `locateCopy(side, key)` returns
`clickedCell: undefined, otherCell` and `applyLocatedCopy` calls `copyDelete`. The webview
blocked it by requiring a key on the source side.

- `gutterAvailabilityFor`: both keys are true when either the displayed modified or original
  range owns a semantic row. A header/gap hunk with no row leaves both false.
- `copyTarget`: return both source and target sides (`side`, `range`, `keys`).
- `gutterCopyRequest`: use the source key when present; otherwise use the target key and keep
  the empty side as `side`. The host then deletes from the owning side.
- Preview audit: `diff-removed`/`diff-added` require both rendered labels; the first action's
  host copy proves the empty-side source/key. The old “hide the impossible direction” checks
  are removed.

## 3. Ctrl+F / Ctrl+H scroll

Root cause candidate: `findBridge.findMatches` calls `adapter.request(searchString, options)`
when the result is empty. On an empty query this posts a host search; the returned matches
can reveal the first match and scroll the editor. Guard every find entry point:
`searchString.length === 0` returns `[]`/`null` without calling `matches` or `request`.
Keep `startFindController` able to clear the widget.

Regression: a unit test drives `installFindBridge` with an adapter that records
`matches`/`request`; an empty query must not call either and must return no matches.

## 4. Find-tooltip blink (diagnosing-bugs)

Feedback loop: load `diff-find` in the in-app browser, hover `.codicon-widget-close`
with a real pointer, sample `.monaco-hover.workbench-hover` opacity and
`mouseenter`/`mouseleave` counts for 2 s.

Red evidence: `enter: 9`, `leave: 9`, `classChanges: 9`, `fade: 9`; opacity cycled
1 → ~0.3 → 1 → 0. `elementFromPoint` at the button centre alternated between the button
and `.workbench-hover-container` / `.context-view` because the tooltip overlaps its anchor.

Hypotheses:
1. The compact tooltip accepts pointer events and steals hover from the close button.
2. The find widget is re-created on a timer.
3. The hover service is repositioned by a layout loop.

Evidence: the close button stays connected and its rect is stable; the tooltip element is
created once; the only changing element is the hover container/context view over the button.
This selects #1.

Fix: keep compact tooltips non-interactive:
`.monaco-hover.workbench-hover.compact`, `.workbench-hover-container:has(...compact)` and
`.context-view:has(...compact)` get `pointer-events: none`. After the fix the loop is
`enter: 1`, `leave: 0`, `fade: 1`, opacity stable at 1.

Regression: a source-contract assertion in `diffCodeParity.test.ts` pins the three CSS
rules. The browser loop is the behavioural evidence in the task notes; a real pointer cannot
be synthesized in the preview harness.

## 5. Swap alignment

Remove `toolbar-center` and place `#diff-swap` in `.toolbar-left` after `#diff-merge`.
Change the diff toolbar CSS from a three-column grid to a flex row; `.toolbar-left` is
`flex: 0 1 auto` with horizontal overflow, `.toolbar-right` gets `margin-left:auto`.
Update toolbar tests and the preview/docs labels that said “Swap over the divider”.

## 6. Editor toolbar

Move the flexible `.grow` slot after Expand and before the Sidebar toggle. The editor order
becomes: dirty status, Collapse, Expand, grow, Sidebar (Details) on the right. Update the
toolbar test and the component spec.

## Verification

- `npm run check-types`
- `npm run lint`
- `npm run compile-tests` + `npm test --ignore-scripts`
- full preview skill set
- fallow GREEN
- `node esbuild.js --production`
- `git diff --check`
- Browser loop for #3 and #4; record counts/scrollTop in implement notes.
