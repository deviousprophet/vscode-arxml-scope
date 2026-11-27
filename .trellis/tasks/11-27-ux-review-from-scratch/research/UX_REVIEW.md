## Executive Summary
- **Overall UX Score:** 2.5 / 5.0
- **What Works Well:**
  - The primary loop is real: open the ECUC editor, select a row, stash the first file, compare, and
    read the diff end-to-end in the Extension Development Host. Save continuity holds on a
    400-parameter document scrolled to `P68 = 68` … `}`: the anchor, the `P99` selection, Details,
    keyboard focus and the cleared dirty marker all survive `Ctrl+S`
    (`research/evidence/host/save-continuity-before-webview.png`,
    `research/evidence/host/save-continuity-after-webview.png`).
  - The editor's local-first draft model is visible and trustworthy in the host: `● Unsaved changes`
    appears on the first keystroke, Details mirrors the draft, and one `Ctrl+S` writes exactly one
    edit (`<VALUE>7</VALUE>`) and clears the marker; copied rows are marked on the receiving side
    only (`research/evidence/host/merge-02-copied-workbench.png`).
  - The diff content surface is well built: independently shaped per-side models, native diagonal
    fills for missing sides, word-level highlights, sticky module/container headers, a fixed
    file-name strip, and a logical keyboard order that skips the unavailable Context toggle.

## Scorecard
| Dimension | Score | Primary Rationale |
| :--- | :--- | :--- |
| Usability & Clarity | 3/5 | The happy path and row editing are clear, but four Major issues sit in save, refusal and recovery feedback: a silent no-op `Ctrl+S` in the diff, a deleted first file compared without a word, a stale draft with no exit, and one invalid value reported in four places with stale derived formats. |
| Visual Hierarchy | 2/5 | Content hierarchy (document, diff tints, Details sections) is strong, but the chrome inverts it: the least important control (sidebar show/hide) is the loudest element on the editor, the only write action in the diff loses its label at the default 1440×900 width, and an inert Context toggle is painted as switched on. |
| Accessibility & Ergonomics | 3/5 | Keyboard entry and focus order work (palette → editor; 11 diff tools with `aria-label`/`title`; disabled Context skipped), and the 80 % zoom layout reflows correctly; but the tab rail uses 10 px rotated labels, focus-ring visibility was not captured, and light/high-contrast/reduced-motion are unverified. |
| Flow Efficiency | 2/5 | The primary loop and editor save are efficient, but two core flows dead-end: saving a merge from the pane that shows `•` does nothing, and a stale draft can never be committed or discarded. The missing change summary forces a Next-diff walk just to learn the size of the comparison. |

## Prioritized Findings
- **[Major] `Ctrl+S` in the diff does not save the merged document (diff pane / receiving file tab):**
  after a copy the pane label reads `right.arxml •` and the separate `right.arxml` tab is dirty, but
  `Ctrl+S` with focus in the pane leaves the tab dirty and the bytes unchanged (`7724 → 7724`);
  saving from the separate text tab works (`dirtyAfterTabSave: []`). Evidence:
  `research/evidence/host/driver-report-r2.json` (merge observations),
  `research/evidence/host/merge-02-copied-workbench.png`,
  `research/evidence/host/merge-03-save-paths-workbench.png`; `research/findings/UX-06-diff-save-noop.md`.
  **UX Impact:** the documented save action silently does nothing on the surface that shows the
  unsaved marker, so the user either believes the merge is persisted or hunts for a second,
  identically named tab. **Actionable Fix:** handle `save` in the diff webview and save every dirty
  document the panel owns, mark the diff tab dirty so VS Code's save path applies, or add a visible
  `Save right.arxml` action while a copy is unsaved.
- **[Major] A deleted first file is compared silently (diff panel title and left pane):** after
  `Select as First File` and deleting that file, `Compare with First File` opens
  `stale-first.arxml ↔ right.arxml` from the still-open buffer with **zero notifications**; the
  Explorer no longer lists the file. Evidence:
  `research/evidence/host/entry-16-stale-first-workbench.png`,
  `research/evidence/host/driver-report-r3.json` (stale-first: `existsAfterDelete: false`,
  `notifications: []`); `research/findings/UX-07-deleted-first-file-silent.md`.
  **UX Impact:** the panel asserts a comparison against a file the user deleted, and Merge can copy
  bytes out of that ghost, so a merge can write data derived from a document that no longer exists.
  **Actionable Fix:** stat the stashed URI before opening and warn
  `"stale-first.arxml" no longer exists. Select a first file again.`; if a buffer is used
  deliberately, label the pane `(deleted)` and disable Merge until confirmed.
- **[Major] A stale edit is a dead end (Details panel and its status line):** the host refuses the
  save and reports `The node is no longer in the file.` only in `#details-status` at the bottom of
  the sidebar, while the draft stays dirty. The blocked draft has no local surface: in the host
  capture Details shows another live row (`ContParentA`, the probe's click point) and in the
  preview it keeps the stale row's editable Short name/Definition inputs live — neither state says
  "this draft is blocked", and there is no discard or reload action.
  Evidence: `research/evidence/host/edit-16-stale-workbench.png`,
  `research/evidence/host/driver-report-r2.json` (stale-node: `detailsStatus`, `dirtyHidden: false`);
  `research/evidence/preview/editor-stale-save.png`;
  `research/findings/UX-02-stale-node-dead-end.md`.
  **UX Impact:** an unsavable dirty document with no exit and feedback ~600 px from the field; the
  user cannot tell which row is blocked or how to recover, short of guessing `Ctrl+Z`.
  **Actionable Fix:** disable/replace the stale field with an inline notice, change the toolbar to
  `Save blocked — row removed`, add **Discard draft** (and **Reload rows**), and keep the blocked
  row visible/selectable.
- **[Major] One invalid value is reported four times, and numeric formats go stale (ECUC editor
  toolbar, error strip, Details, status line):** `Invalid value — not saved` in the toolbar,
  `Invalid value — Invalid integer value` above the Document, `/* Invalid integer value */` under
  the field, and the same message in the bottom status line in a different colour, plus the
  squiggle; meanwhile Decimal/Hexadecimal/Binary still show the last accepted value (`0`, `0x00`,
  `0b00000000`) for the draft `0abc`. Evidence:
  `research/evidence/preview/editor-invalid.png`,
  `research/evidence/preview/editor-rename-refusal.png`;
  `research/findings/UX-01-invalid-feedback-duplication.md` (preview-only: no host scenario types an
  invalid value). **UX Impact:** four competing copies with red/amber disagreement, and a numeric
  block that contradicts the field the user is typing in. **Actionable Fix:** keep one inline
  message plus a compact toolbar signal, write the status line only when Details is hidden, use one
  colour per severity, and replace derived formats with `— invalid draft —` while invalid.
- **[Minor] Every diff label disappears at the default 1440×900 width (diff toolbar):** at 100 %
  zoom with the Explorer open the webview is **1082 px**, below the 1150 px breakpoint, so all 11
  controls are icon-only although the labelled 1200 px strip needs only **588 px** — over half of
  the 1082 px row is empty. Evidence: `research/evidence/host/gate-02-diff-workbench.png`,
  `research/evidence/host/diff-01-loaded-webview.png`, `research/evidence/host/capture-zoom-100-webview.png`;
  `research/evidence/preview/toolbar-1024.png`, `research/evidence/preview/toolbar-1200.png`;
  `research/findings/UX-04-toolbar-labels-dropped-at-1024.md`.
  **UX Impact:** at a very common laptop width the only write action (Merge) is an anonymous glyph
  next to Swap/Collapse, so discovery becomes a hover hunt. **Actionable Fix:** drop labels on
  measured overflow rather than a fixed width, and keep the Merge label (or an accent) longest.
- **[Minor] The diff opens in Show all with an inert, pressed Context toggle and no change summary
  (diff toolbar):** `Show all` is pressed on open; `Context` is disabled yet keeps the blue pressed
  fill (measured `rgb(20,48,67)` vs `rgb(9,71,113)`) and is skipped by the keyboard order; the
  panel shows no changed/added/removed count. Evidence: `research/evidence/host/diff-01-loaded-webview.png`,
  `research/evidence/preview/diff-off.png`, `research/evidence/preview/toolbar-1400.png`;
  `research/findings/UX-05-diff-default-show-all-context-inert.md`.
  **UX Impact:** the first view is a wall of unchanged rows plus a control that looks on but does
  nothing, and the user cannot judge the size of the comparison. **Actionable Fix:** default to
  Show diff, render Context unpressed+disabled with an explanation, and put a compact
  `4 changes · 2 modules` summary in the existing `#diff-match-status` live region.
- **[Minor] The sidebar show/hide toggle is painted as the primary action (ECUC editor toolbar):**
  `#toggle-sidebar` ships `aria-pressed="true"` while the sidebar is visible and the shared pressed
  style paints it with `--vscode-inputOption-activeBackground` at 60×48, measured `rgb(9,71,113)`
  — the strongest colour on the page — while Collapse/Expand beside it are low-contrast grey icons.
  Evidence: `research/evidence/host/capture-zoom-100-webview.png`,
  `research/evidence/host/edit-16-stale-workbench.png`, `research/evidence/preview/editor.png`;
  `research/findings/UX-03-sidebar-toggle-primary-weight.md`.
  **UX Impact:** the least important control outranks the document and the dirty status. **Actionable
  Fix:** use `toolbar-activeBackground` or an outline for a stateful toggle; reserve the saturated
  fill for real option toggles.
- **[Minor] The diff find count reads "? of 3" (diff find widget):** the total is right, the current
  index is a literal question mark, contrary to the documented `1 of N`. Evidence:
  `research/evidence/host/diff-03-find-workbench.png`,
  `research/evidence/host/driver-report-r2.json` (`findCount: "? of 3"`);
  `research/findings/UX-09-diff-find-count.md`.
  **UX Impact:** the user cannot tell whether Enter advanced or how many matches remain. **Actionable
  Fix:** populate the current index and render `1 of 3`; gate the host check on `\d+ of \d+`.
- **[Minor] Activation failure leaks an internal protocol constant and is shown twice (first-run
  notification):** both toasts end with `run "npm run engine:build" (1 is the host protocol)`, an
  absolute build path, and the same failure is reported by VS Code and by the extension. Evidence:
  `research/evidence/host/first-02-missing-engine-workbench.png`,
  `research/evidence/host/driver-report-missing-engine.json`; `research/findings/UX-08-activation-error-jargon.md`.
  **UX Impact:** a user-facing error looks like an internal crash and offers a command an installed
  extension cannot use. **Actionable Fix:** drop the protocol constant, emit one actionable error
  (`Open Log` / `Report Issue`) and keep the path/protocol in the Output channel.
