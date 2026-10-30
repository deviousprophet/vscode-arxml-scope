# Conditions panel action visibility

## Goal

Make the Conditions panel's **Add value** and **Clear all** actions obvious at a glance. Today both are rendered as transparent, dim `.tool` text buttons, so they read as labels rather than controls. The fix gives them real affordances and adds an empty state that teaches the first action.

## Confirmed facts

- The panel shell is built in `renderHtml.ts`: header (`Condition values`, `#conditions-count`, Add, Clear), list, hint and status.
- `#conditions-add` and `#conditions-clear` use the shared `.tool` class, which is transparent with dim text and only changes on hover (`renderHtml.ts` `.tool`).
- The page already has `addConditionEntry`, `clearConditionEntries`, `renderConditionEntries`, `applyDisabledCount` and the 300 ms debounced message; only the presentation changes.
- The panel is outside `#tree`, so a re-scan does not rebuild it.
- The panel is opened by the toolbar **Conditions** toggle and starts closed.

## Requirements

- **R1** Move the two actions out of the header into a footer action row below the list.
- **R2** **Add value** is a solid primary button using `--vscode-button-background` / `--vscode-button-foreground` / `--vscode-button-hoverBackground`, with a visible `+` icon and the text `Add value`. It must be recognisable without hovering.
- **R3** **Clear all** is a bordered secondary button using theme border/foreground colours, with a trash icon and the text `Clear all`. It is disabled when the panel has no rows, and its tooltip says it removes every condition value.
- **R4** When the list is empty, show an empty state inside the panel: a short `No condition values yet` line, the hint (for example `CANIPCORETYPE_SC = 1`), and a primary **Add value** button. The footer action remains.
- **R5** The header keeps the title and the disabled-row count, and adds a `N values` count when there is at least one entry.
- **R6** Behaviour is unchanged: Add appends an empty row and focuses its name input; Clear removes every row; input changes are debounced; values are saved per workspace; row states update.
- **R7** Accessibility: buttons keep `type="button"`, have accessible names, a visible `:focus-visible` outline, a discernible disabled state, and no action depends on hover.
- **R8** Use only `--vscode-*` theme variables (or fallbacks inside them). No new colour literal, no inline style, no dependency, no second set of actions.
- **R9** The footer must not overflow horizontally at narrow panel widths; long labels wrap or the action row stacks.

## Acceptance criteria

- [ ] **AC1** At a glance, without hovering, **Add value** is a solid, high-contrast button with a `+` icon and text.
- [ ] **AC2** **Clear all** is visibly a button (border/background), has a trash icon and text, and is disabled while the list is empty.
- [ ] **AC3** With no entries, the panel shows the empty-state text and a primary Add action; clicking it creates the first row and focuses its name input.
- [ ] **AC4** Add/remove/clear still produce the same entries, debounced messages, persistence and disabled counts as before.
- [ ] **AC5** The header shows the value count and the disabled count when applicable.
- [ ] **AC6** Tab reaches the primary action, the clear action (when enabled) and each row control; focus is visible and the disabled clear action is announced as disabled.
- [ ] **AC7** The existing Conditions page tests still pass, with new assertions for the primary action style, the disabled clear state and the empty state.
- [ ] **AC8** No hard-coded colour, inline style, dependency or duplicate action set is introduced.

## Out of scope

- Changing the toolbar **Conditions** toggle itself.
- Confirmation dialogs or undo for Clear all.
- New condition syntax, value parsing or evaluator behaviour.
- Reworking the row inputs or the panel's persistence model.

## Notes

- Lightweight task: `prd.md` is the only planning artifact.
- The panel is a webview surface; real rendering and contrast must still be checked in the Extension Development Host.
