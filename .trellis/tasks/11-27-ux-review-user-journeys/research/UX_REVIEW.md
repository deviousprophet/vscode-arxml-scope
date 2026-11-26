## Executive Summary

- **Overall UX Score:** 2.5 / 5.0
- **Critical finding:** UX-009 — when the engine is missing, activation fails, every command is
  absent, and the only feedback is a truncated message telling the user to run a source build.
  It is the first finding below and the reason Flow Efficiency is capped at 2.
- **What Works Well:**
  - **The edit-and-write path is fast and reliable.** In the real Extension Development Host,
    selecting `ContKeep`, typing `7`, and pressing `Ctrl+S` marked the page `● Unsaved changes`,
    mirrored the draft in Details, cleared the strip and wrote `Keep = 7` to the file
    (EDIT-01/03/19). The save itself lands; the selection jump after it is UX-011.
  - **Diff navigation is trustworthy.** Semantic is the default, Strict flips immediately, `Ctrl+F`
    finds matches, and Next diff jumped from the module header to a changed row in a generated
    300-row diff (DIFF-01/03/06/07). The 11 toolbar controls follow a clean keyboard order.
  - **A merge copy is visibly unsaved.** Copy Block to Right produced both a `right.arxml •` pane
    label and a separate dirty `right.arxml ●` tab, so the destination file is identifiable
    (MERGE-02/14).

The full journey matrix and verdicts are in
[journeys.md](journeys.md); the
evidence index is in
[evidence.md](evidence.md) and the
real-host record in
[host-runs.md](host-runs.md).

## Scorecard

| Dimension | Score | Primary Rationale |
| :--- | :--- | :--- |
| Usability & Clarity | 2/5 | Primary open/edit/diff/merge flows work, but a failed engine start is reported as a truncated developer toast, and a successful save moves the selection to an unrelated row. Two other save paths give no visible feedback. |
| Visual Hierarchy | 3/5 | Wide-width toolbars, diff tints and the file-name strip scan well; at ordinary split widths every toolbar label disappears into ambiguous icons, and the Details/Conditions tabs are rotated vertical text at the far edge. |
| Accessibility & Ergonomics | 3/5 | Palette-only entry, labelled controls and a logical diff focus order were verified; the Details/Conditions tabs are not reachable by plain Tab and rotated labels add a reading cost. High-contrast, reduced-motion, zoom and screen-reader paths remain untested. |
| Flow Efficiency | 2/5 | A first-run activation failure blocks every command (broken FIRST-02/ENGINE-04), which caps this dimension at 2. Merge completion requires leaving the diff for another tab to save, and a save loses the edited row's selection. |

## Prioritized Findings

- **[Critical] Missing-engine activation fails as a truncated developer message (First run / activation):**
  With the staged engine binary hidden, activation failed and no ARXML command was registered
  (`openEcucEditor`, `showEngineStatus`, `rebuildIndex` all false). The only feedback was two
  transient, width-clipped toasts telling the user to `run "npm run engine:build"` and mentioning
  "(1 is the host protocol)", while the window looked normal
  ([workbench capture](evidence/host/missing-engine/first-02-missing-engine-workbench.png),
  [run report](evidence/host/missing-engine/driver-report.json)).
  **UX Impact:** The product is completely unavailable with no workaround, and the guidance is
  addressed to a source-checkout developer, not an installed user; the failure is easy to miss and
  impossible to diagnose from the UI.
  **Actionable Fix:** Replace the toasts with a persistent notification/banner in plain language
  (“ARXML Scope cannot start its Rust engine on win32-x64”), a **Reinstall** / **Supported
  platforms** / **Open Output** action set, and the full path in the output channel. Never
  reference `npm` in a packaged build.

- **[Major] Ctrl+S in the diff does not save the copied document (Semantic diff / merge):**
  After Copy Block to Right, `right.arxml` was dirty and both the pane and its tab showed the
  bullet, but `Ctrl+S` with focus in the modified pane changed nothing: the document stayed dirty
  and the file remained 7,724 bytes. Clicking the `right.arxml` tab and pressing `Ctrl+S` saved
  it, as did Save All
  ([copied state](evidence/host/merge-02-copied-workbench.png),
  [save paths](evidence/host/merge-03-save-paths-workbench.png)).
  **UX Impact:** The most natural way to finish a merge silently does nothing while the user is
  looking at the result; closing the diff after `Ctrl+S` loses the copy.
  **Actionable Fix:** Add the same page-level `Ctrl+S` handler the ECUC editor has, posting the
  existing save message for the dirty side. Until then, show an explicit “Save right.arxml”
  action or hint in the pane, not just the dot.

- **[Major] A refused stale-node save is reported only in the bottom-right Details status (ECUC editor / save):**
  After a draft was typed and the container was renamed underneath it, `Ctrl+S` did not write. The
  top strip still read `● Unsaved changes`, the row kept its normal selection tint, and the only
  refusal text was “The node is no longer in the file.” in `#details-status`
  ([capture](evidence/host/edit-16-stale-workbench.png)).
  **UX Impact:** The page looks like a normal pending save, so a user can move on or close the
  editor believing the edit was written.
  **Actionable Fix:** Route the refusal to the top strip with the reason, mark the affected row,
  and keep the Details status as secondary. The save action itself should report “Not saved —
  node no longer in the file”.

- **[Major] A successful save moves the selection and Details to an unrelated row (ECUC editor / save):**
  A large ECUC document was scrolled to the bottom, `P99` was edited and saved. The write landed,
  the scroll anchor (`P68 = 68` … `}`) and focus survived, but Details moved from `P99` to `P85`
  while the edited row stayed `P99` on screen
  ([before](evidence/host/save-continuity-before-webview.png),
  [after](evidence/host/save-continuity-after-webview.png),
  [run report](evidence/host/driver-report.json) → `save-continuity`).
  **UX Impact:** The user loses track of the row they just changed; a follow-up Details edit would
  target `P85`, not the row they saved. The page rebuilds the model and applies the host’s older
  `selectedId` over the user’s click.
  **Actionable Fix:** Keep the page’s selected node across the save echo and ignore a host
  `selectedId` that predates the user’s click, or make the host echo the current selection. Add
  the `save-continuity` scenario as a regression guard.

- **[Minor] Toolbar labels disappear at everyday split widths and the icons are ambiguous (Editor and diff toolbars):**
  At a ~990 px webview all 11 diff controls were icon-only; at ~780 px the editor toolbar showed
  only Collapse / Expand / Sidebar; at ~1,076 px the labels returned. Show all, Show diff and
  Context become three near-identical square glyphs, and Prev/Next arrows sit beside the Swap
  arrow ([narrow editor](evidence/host/gate-01-editor-workbench.png),
  [1,200 px preview](../../../../.agents/skills/webview-preview/artifacts/toolbar-1200.png)).
  **UX Impact:** Users must hover or guess to navigate the diff at a normal split-editor width,
  slowing the primary comparison loop.
  **Actionable Fix:** Keep labels until they genuinely stop fitting, then collapse the secondary
  controls into a labelled overflow menu instead of unlabeled icons. Give the three view glyphs
  distinct shapes and keep tooltips on every control.

- **[Minor] Details derived integer formats do not follow the local draft (ECUC editor / Details value):**
  Typing `7` over `Keep = 1` showed Value `7` and the document row `Keep = 7`, while Decimal stayed
  `1`, Hexadecimal `0x01` and Binary `0b00000001`
  ([capture](evidence/host/edit-01-dirty-webview.png)).
  **UX Impact:** The panel contradicts itself while the user types and gives a misleading numeric
  reading of the value about to be saved.
  **Actionable Fix:** Recompute Decimal/Hexadecimal/Binary from the draft, or label those rows as
  the last accepted value until the host acknowledges the edit.

- **[Minor] A deleted first file is still compared from cached text with no warning (Compare commands / missing first file):**
  The first file was selected, deleted (`existsAfterDelete=false`), and `Compare with First File`
  still opened `stale-first.arxml ↔ right.arxml` with the cached left content and no notification
  ([capture](evidence/host/entry-16-stale-first-workbench.png);
  medium confidence — the deletion ran through the workspace file API).
  **UX Impact:** The comparison presents content that is no longer on disk as if it were current;
  the user cannot tell the file is gone.
  **Actionable Fix:** Re-check the stashed URI before building the panel; on a missing file, warn
  with its name, keep the stash, and open no panel.

- **[Minor] Rename refusal uses the generic “Invalid value — not saved” strip and leaves the field unmarked (ECUC editor / Details short name):**
  A refused container short name showed the generic value-error strip while the **Short name**
  input kept its normal blue border; only the inline line and the distant status named the rename
  ([capture](../../../../.agents/skills/webview-preview/artifacts/editor-rename-refusal.png)).
  **UX Impact:** The most prominent message describes the wrong kind of problem, and the field
  itself does not look rejected, weakening trust in the save state.
  **Actionable Fix:** Use operation-specific copy (“Short name refused — not saved”) and apply the
  same error border to the short-name input that the numeric value input gets.

- **[Minor] Details/Conditions tabs are rotated vertical text at the far-right edge (ECUC editor / sidebar):**
  The two tabs render as 90°-rotated words separated from the panel by its full width, with the
  active state marked only by a subtle background change; the Details header repeats the tab name
  ([capture](evidence/host/gate-01-editor-webview.png)).
  **UX Impact:** Reading the panel switcher requires tilting the head or screen, and the duplicated
  labels compete instead of orienting the user.
  **Actionable Fix:** Move the tabs to the top of the sidebar as horizontal labels with a clear
  active underline; reserve a vertical strip for a genuinely narrow layout.
