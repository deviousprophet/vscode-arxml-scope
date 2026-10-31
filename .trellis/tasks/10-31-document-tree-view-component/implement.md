# Implementation plan

## Preconditions

- Branch `feat/arxml-scope-batch`; `73ac0ce` is the current diff implementation.
- `npm test` green (406 passing).
- The current diff partial extraction is replaced, not extended.

## Steps

1. **Create `DocumentTreeView`**
   - Add `src/editor/documentTreeView.ts` with the mount/render/scroll API from the design.
   - Move the Document stylesheet and variables into `documentTreeStyles()`; remove the `STYLE`-slice helper.
   - Move row builders to `documentRows.ts` and use them for editor and diff rows.
   - Component owns `root > header + scroll > spacers + window`, rAF scroll, Shift+wheel, render-key skip.

2. **Migrate the editor**
   - Replace inline `#main/#tree` virtual plumbing with one instance.
   - Keep toolbar, sidebar, Details, search, collapse, selection and inspector behaviour.
   - `renderRow` uses the existing display-row logic; height/gap callbacks stay host-owned.
   - Gate: editor tests green; computed styles for a container/parameter row match `73ac0ce`.

3. **Migrate the diff**
   - Build the 50/50 pane grid with two instances; remove proxy bars and the single-list window.
   - Both instances receive the same aligned structural display rows; per-pane render uses shared builders.
   - Pane headers include file label and schema/packages through the component header slot.
   - Status tint is an optional diff render input; Document view never sets it.
   - Gate: container/token colours identical to editor; braces/comments/headers visible.

4. **Synchronize scrolling**
   - Host driver/follower sync for vertical; immediate mirror for horizontal.
   - Suppress programmatic scroll events; one rAF render; follower renders only on slice change.
   - Shift+wheel over either pane mirrors both; swap resets horizontal, preserves vertical.
   - Gate: drag either bar, both move; wheel with Shift, both move; plain wheel only vertical.

5. **Fix scrollbar sizing**
   - Native `overflow: auto` scroller, no fixed strip height, `scrollbar-gutter: stable`.
   - Gate: horizontal bar fully visible at 700px and 1200px.

6. **Tests and docs**
   - Component: window bounds, spacer heights, render-key skip, Shift+wheel.
   - Editor parity: one instance, styles from the component, existing behaviour.
   - Diff: two instances, per-pane virtual window, sync, swap reset, status optional.
   - Performance: 10k rows, bounded DOM, scroll frame does not render all rows.
   - Update `component-guidelines.md`, README and CHANGELOG.

## Validation

```bash
npm run check-types
npm run lint
npm test
npm run package
```

Manual: large fixture (10k rows) in both views; scroll rapidly; verify only visible rows in DOM, both panes stay aligned, horizontal bars are full height.

## Review gates

- Gate A: editor identical after migration.
- Gate B: diff colours/geometry identical to editor; status only diff.
- Gate C: two native scrollbars per pane, synchronized vertical/horizontal, no clipping.
- Gate D: 10k-row performance and full suite/package.

## Rollback

One commit. Revert to `73ac0ce` to restore the current editor and diff implementation.
