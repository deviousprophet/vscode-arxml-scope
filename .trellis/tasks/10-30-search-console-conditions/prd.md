# Search on Enter, visible match marks, console-only errors and icon-only Conditions actions

## Goal

Finish the recent UX feedback in one pass:

1. Search runs only after the user types a query and presses **Enter**. Typing alone never searches,
   jumps or marks rows.
2. Every match is visibly highlighted, with the current match stronger, using the fixed yellow
   search tiers from the reference UI instead of theme find-match colours that can resolve to
   transparent.
3. Page errors go to the webview debug console only. The ECUC editor never paints a notice banner
   under the Search bar, including the former "The ECUC editor page failed" message.
4. The SW-SYSCOND **Edit / Save / Cancel** actions are icon-only (pencil / check / X) with tooltips
   and accessible names, matching the reference base-address field. Remove stays icon-only.

## Confirmed facts

- The Search input currently runs `refreshSearch` and jumps on every `input` event.
- `mark` uses `--vscode-editor-findMatchHighlightBackground`, which can resolve to a transparent
  theme value; the current mark uses `--vscode-editor-findMatchBackground` with the same risk.
- The editor page still renders `#notice` and installs the UI page-error surface, which writes the
  yellow "The ECUC editor page failed" banner.
- The Conditions row builds text `Save` and `Cancel` buttons; Edit and Remove already use the
  compact `.act-btn` icon primitive.
- The diff page uses the same `pageError.ts` module for its own notice and must keep working.

## Requirements

- **R1 Enter-only Search.** A blank query does nothing. Typing updates only the field and the clear
  control; it must not search, mark, scroll or jump. The first Enter on a changed query searches and
  jumps to the first match at/after the selection. Enter on the already-executed query cycles to the
  next match; Shift+Enter goes backwards. F3/Shift+F3 and the nav buttons keep working after a run.
  Editing an executed query invalidates the old marks until the next Enter.
- **R2 Visible highlights.** All matches use a fixed subtle yellow background; the current match's
  row uses a stronger yellow. Both remain visible without relying on theme find-match variables.
  High-contrast/forced-colors keeps the outline treatment.
- **R3 Console-only errors.** The editor page has no notice element and no page-error banner. An
  early console-only installer defines `window.ecucReportError`, forwards uncaught errors and
  unhandled rejections to `console.error`, and is installed before `acquireVsCodeApi`. The exact
  user-visible string "The ECUC editor page failed" is gone from the editor.
- **R4 Icon-only Conditions actions.** Edit, Save and Cancel are icon buttons with `title` and
  `aria-label`. Save uses a check, Cancel an X, Edit a pencil. Save/Cancel exist only in edit mode
  and stay visible while editing; Edit/Remove keep the row-action hover/focus affordance. No text
  labels are emitted. The delegated click handlers and keyboard behaviour are unchanged.
- **R5 Preserve the rest.** Re-scan keeps the current match by id, Search never writes the collapsed
  set, the Conditions data flow is unchanged, and the diff page keeps its own notice surface.
- **R6 Constraints.** No new dependency, no file write, no inline style. The only new colour
  literals are the two documented fixed search tiers.

## Acceptance criteria

- [ ] **AC1** Typing in Search creates no marks, count, jump or scroll; the clear X follows the typed
  text. Enter runs the query and selects the first match at/after the selection.
- [ ] **AC2** A second Enter cycles forward, Shift+Enter cycles backward, and F3/Shift+F3 still work.
- [ ] **AC3** Changing an executed query removes the old marks until Enter runs the new query.
- [ ] **AC4** Every match gets a visible yellow mark; the current match's row gets the stronger mark;
  both are verified in a real Chromium render.
- [ ] **AC5** The editor page contains no notice element, no notice CSS and no page-error UI; an
  uncaught error or rejection writes to `console.error` only.
- [ ] **AC6** Conditions Edit/Save/Cancel are icon-only, named, and work by click and keyboard; no
  visible `Save`/`Cancel` text remains.
- [ ] **AC7** Re-scan, Conditions editing, notice-free recoverable warnings, the diff page and all
  existing tests keep working; `check-types`, `lint`, `test` and `package` pass.
- [ ] **AC8** No dependency, file write, inline style or undocumented colour literal is introduced.

## Out of scope

- The diff page's own filter, search and notice surface.
- Changing Search's matched fields (label, short name, value).
- New search options, regex, case toggles or persistence across reloads.
- Redesigning the Conditions table beyond its row actions.
