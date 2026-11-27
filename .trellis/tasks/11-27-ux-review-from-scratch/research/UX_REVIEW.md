## Executive Summary
- **Overall UX Score:** 2.3 / 5.0
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
| Usability & Clarity | 3/5 | The happy path and row editing are clear, but four Major issues sit in save, refusal and recovery feedback: a silent no-op `Ctrl+S` in the diff, a deleted first file compared without a word, a stale draft with no exit, and one invalid value reported in four places with stale derived formats. Two refusal messages also state an outcome that did not happen (text editor shown, module copy). |
| Visual Hierarchy | 2/5 | Content hierarchy (document, diff tints, Details sections) is strong, but the chrome inverts it: the least important control (sidebar show/hide) is the loudest element on the editor, the only write action in the diff loses its label at the default 1440×900 width, and an inert Context toggle is painted as switched on. |
| Accessibility & Ergonomics | 2/5 | Keyboard entry and focus order work, and the 150 % zoom layout stays inside the row; but the light theme was exercised in the host and its toolbar labels resolve to **3.1:1** (`--tok-dim` 55 % mix), a Floor contrast failure. The 80 % workbench layout is correct; focus-ring visibility, reduced motion and high-contrast control borders remain unverified. |
| Flow Efficiency | 2/5 | The primary loop and editor save are efficient, but two core flows dead-end: saving a merge from the pane that shows `•` does nothing, and a stale draft can never be committed or discarded. The missing change summary forces a Next-diff walk, and the module refusal does not lead to the row it asks for. |

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
  `research/findings/UX-01-invalid-feedback-duplication.md` (host-confirmed in the deep pass: the
  toolbar, strip, inline message and status line all show the invalid draft; the blocked save leaves
  the file unchanged). **UX Impact:** four competing copies with red/amber disagreement, and a numeric
  block that contradicts the field the user is typing in. **Actionable Fix:** keep one inline
  message plus a compact toolbar signal, write the status line only when Details is hidden, use one
  colour per severity, and replace derived formats with `— invalid draft —` while invalid.
- **[Major] Light-theme toolbar labels sit at ~3.1:1 contrast (all toolbar labels):** in Default
  Light Modern `--tok-dim` resolves to `color(srgb 0.577255 …)` (≈ `#939393`) on `#ffffff`, measured
  **3.1:1** — the icons pass the 3:1 UI threshold, the 10–12 px labels do not pass 4.5:1, and the
  host capture shows faint `Collapse`/`Expand`. Evidence:
  `research/evidence/host/deep-theme-light-webview.png`,
  `research/evidence/host/driver-report-deep-all.json` (theme-zoom: `toolContrast: 3.1`).
  Gate: **Floor — contrast**. **UX Impact:** light-theme users with low vision, or on a bright
  screen, cannot read the secondary toolbar labels and must rely on icons or hover. **Actionable
  Fix:** use `--vscode-descriptionForeground` (or a 75–80 % mix) for label text and keep the muted
  token for icons/meta; add a light/dark label-contrast check. Finding:
  `research/findings/UX-10-light-theme-label-contrast.md`.
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
- **[Minor] The gate warning promises a text editor that never opens (open-command notification):**
  on `empty.arxml`, `malformed.arxml` or `not-ecuc.arxml` the toast says
  `contains no ECUC values; showing the text editor instead`, but `/state.tabs` is empty after the
  command — no ECUC editor and no text editor. Evidence:
  `research/evidence/host/deep-first-gate-workbench.png`,
  `research/evidence/host/driver-report-deep-all.json` (first-gate: `tabs: []`). Gate: **Reflex —
  truthful copy**. **UX Impact:** the user follows the command, is told the file is being shown,
  and sees nothing; a first run ends in a dead end. **Actionable Fix:** show the text editor after
  the refusal, or change the copy to `has no ECUC values` and add an **Open as Text** action.
  Finding: `research/findings/UX-11-gate-copy-promises-editor.md`.
- **[Minor] The diff reuses the gate copy when a side stops being ECUC (diff notice):** replacing
  `right.arxml` with a non-ECUC document leaves the last-good comparison (correct) but the notice
  reads `"right.arxml" contains no ECUC values; showing the text editor instead.` — no text editor
  opens and the notice never says the comparison stopped updating. Evidence:
  `research/evidence/host/deep-diff-side-not-ecuc-webview.png`,
  `research/evidence/host/driver-report-deep-all.json` (diff-side-not-ecuc). Gate: **Reflex —
  truthful copy**. **UX Impact:** the user may keep reading or merging from a stale diff without
  knowing it stopped refreshing. **Actionable Fix:** a diff-specific notice that names the stale
  side and offers **Reload comparison** / **Open as Text**. Finding:
  `research/findings/UX-12-diff-stale-side-copy.md`.
- **[Minor] The module-missing refusal does not name the module or offer a way to it (merge
  notice):** copying a child hunk from a module the target lacks shows
  `the module is missing on the target side; copy it first` — no module name, no reveal action, and
  "copy it first" reads circular right after a refused copy. Evidence:
  `research/evidence/host/deep-merge-collision-workbench.png`,
  `research/evidence/host/driver-report-deep-all.json` (merge-collision). Gate: **Reflex —
  recovery**. **UX Impact:** on a long diff the user must hunt for the module header and may abandon
  the merge. **Actionable Fix:** name the module (`ColX (/P/ColX) has no module on the right`) and
  add a **Reveal module** action that selects its hunk. Finding:
  `research/findings/UX-13-merge-module-refusal-copy.md`.
- **[Minor] The skipped-file tooltip gives three alternative reasons for one file (index status):**
  a file over `arxmlScope.index.maxFileSizeMB` is skipped correctly (count 16 → 15), but the tooltip
  reads `Skipped: huge.arxml (size limit, encoding or unreadable)` instead of naming the reason
  that applied and the threshold. Evidence:
  `research/evidence/host/deep-index-toggles-workbench.png`,
  `research/evidence/host/driver-report-deep-all.json` (`index-toggles.capped.text`);
  `research/findings/UX-14-index-skipped-reason.md`. Gate: **Finish — specific copy**. **UX Impact:** the user cannot tell whether
  raising the cap will help or the file is unreadable. **Actionable Fix:** record one reason per
  file and render `over arxmlScope.index.maxFileSizeMB = 1 MB` for the size case.
- **[Minor] Reveal in source in `replace` mode leaves the ECUC tab open (editor tab strip):** the
  documented mode says it swaps the ECUC editor tab for the text editor, but `/state` reports both
  `left.arxml:vscode-arxml-scope.ecucEditor` and `left.arxml` — two identical labels. `beside` and
  `focus` behave correctly. Evidence: `research/evidence/host/deep-reveal-replace-workbench.png`,
  `research/evidence/host/driver-report-deep-all.json` (`reveal-modes.modes.replace`);
  `research/findings/UX-15-reveal-replace-tab.md`. Gate: **Reflex — duplicate state**. **UX Impact:** the mode meant to avoid a split
  leaves a duplicate tab the user must close manually. **Actionable Fix:** close the custom editor
  tab after showing the text editor in `replace`, or rename the custom tab to `(ECUC editor)` and
  document the behavior.
- **[Minor] The find count reads "? of N" in both the diff and the editor (find widget):** the total
  is right, the current index is a literal question mark — `? of 3` in the diff and `? of 1` in the
  ECUC editor — contrary to the documented `1 of N`. Evidence:
  `research/evidence/host/diff-03-find-workbench.png`,
  `research/evidence/host/deep-find-webview.png`,
  `research/evidence/host/driver-report-deep-all.json` (`findCount: "? of 3"`,
  `find-replace.widgetText: "? of 1"`); `research/findings/UX-09-diff-find-count.md`.
  Gate: **Finish — real counts**. **UX Impact:** the user cannot tell whether Enter advanced or how
  many matches remain. **Actionable Fix:** populate the current index in the shared native-find
  bridge and render `1 of N`; gate the host check on `\d+ of \d+`.
- **[Minor] Activation failure leaks an internal protocol constant and is shown twice (first-run
  notification):** both toasts end with `run "npm run engine:build" (1 is the host protocol)`, an
  absolute build path, and the same failure is reported by VS Code and by the extension. Evidence:
  `research/evidence/host/first-02-missing-engine-workbench.png`,
  `research/evidence/host/driver-report-missing-engine.json`; `research/findings/UX-08-activation-error-jargon.md`.
  **UX Impact:** a user-facing error looks like an internal crash and offers a command an installed
  extension cannot use. **Actionable Fix:** drop the protocol constant, emit one actionable error
  (`Open Log` / `Report Issue`) and keep the path/protocol in the Output channel.
