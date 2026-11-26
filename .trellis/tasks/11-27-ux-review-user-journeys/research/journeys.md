# Journey inventory — ARXML Scope UX review

Status: Phase 1 complete, Phase 2 preview evidence attached. Host-only journeys are marked
`N/A — P3` (they need the real Extension Development Host and are scheduled for Phase 3).

> **Phase 3 update:** the real-host pass has run. Its per-journey verdicts and evidence are in
> [`host-runs.md`](host-runs.md). The verdict column below is the Phase 1–2 state and is not
> rewritten; where Phase 3 ran a journey, `host-runs.md` wins.

## How to read this matrix

- **Persona** — NU new user, IE integration engineer, RE release engineer, MA maintainer,
  KO keyboard-only user, LV low-vision user.
- **Evidence** — `PV:<state>` is a seeded preview capture in
  `evidence/preview/<state>.png` with `<state>.audit.json` read first.
  `HOST:P3` means it can only be exercised in the real host. `PV gap` means no seeded state
  renders the surface.
- **Verdict** — `good` / `friction` / `broken` / `N/A — <reason>`. A verdict is only recorded
  from evidence actually inspected; an unrun journey stays `N/A`.
- Ids are stable. `ENTRY`, `EDIT`, `DIFF`, `MERGE`, `INDEX`, `ENGINE`, `SET`, `A11Y`, `FIRST`.
- **Continuity** — after a host round-trip (save, copy, undo/redo, rename, refresh, settings),
  scroll, selection/caret, focus, folds, find and pane state must be preserved. The before/after
  probes are in "Continuity probes"; a data-correct rebuild that loses the user's place is a
  finding.
- **Capture fidelity** — `PV:` evidence is a standalone 1400×900 page, not the host design width.
  The host workbench was 1440×900 and the webview body measured 786–1082 CSS px depending on the
  side bar/auxiliary bar and zoom; width-sensitive verdicts state the measured width.

## Coverage proof

### Contributed commands (9/9)

| Command id | Palette title | Journeys |
|---|---|---|
| `vscode-arxml-scope.openEcucEditor` | ARXML Scope: Open with ECUC Editor | ENTRY-01…07 |
| `vscode-arxml-scope.revealInSource` | ARXML Scope: Reveal in ARXML Source | ENTRY-10, ENTRY-11 |
| `vscode-arxml-scope.revealInEcucEditor` | ARXML Scope: Reveal in ECUC Editor | ENTRY-12, ENTRY-13 |
| `vscode-arxml-scope.selectAsFirst` | ARXML Scope: Select as First File to Compare | ENTRY-14…16 |
| `vscode-arxml-scope.compareToStaged` | ARXML Scope: Compare with First File | ENTRY-17…19 |
| `vscode-arxml-scope.compareSelected` | ARXML Scope: Compare Two ARXML Files… | ENTRY-20…25 |
| `vscode-arxml-scope.rebuildIndex` | ARXML Scope: Rebuild Workspace Index | INDEX-04 |
| `vscode-arxml-scope.cycleCrossFileRules` | ARXML Scope: Cycle Cross-File Checks | INDEX-03 |
| `vscode-arxml-scope.showEngineStatus` | ARXML Scope: Show Engine Status | ENGINE-01, ENGINE-02 |

### Settings (12/12)

| Setting | Journeys |
|---|---|
| `arxmlScope.ecuc.editor.sort` | SET-01, EDIT-30 |
| `arxmlScope.ecuc.editor.sortExcept` | SET-02 |
| `arxmlScope.ecuc.editor.revealMode` | SET-03, ENTRY-11 |
| `arxmlScope.index.enabled` | SET-04, INDEX-05 |
| `arxmlScope.index.maxFileSizeMB` | SET-05, INDEX-06 |
| `arxmlScope.index.exclude` | SET-06, INDEX-07 |
| `arxmlScope.validation.enabled` | SET-07 |
| `arxmlScope.validation.severities` | SET-08 |
| `arxmlScope.validation.maxDiagnosticsPerFile` | SET-09 |
| `arxmlScope.validation.maxDiagnostics` | SET-10 |
| `arxmlScope.validation.crossFileRules` | SET-11, INDEX-03 |
| `arxmlScope.diff.semanticMatching` | SET-12, DIFF-03 |

## Prioritized execution order

**P0 — primary journeys (first host run, minimum product loop)**

ENTRY-01, ENTRY-14, ENTRY-17, ENTRY-20, DIFF-01, DIFF-03, DIFF-06, DIFF-07, MERGE-01,
MERGE-02, MERGE-15, EDIT-01, EDIT-03, EDIT-19, INDEX-01, INDEX-04, ENGINE-01, FIRST-01.

**P1 — core edge, failure and cancel paths**

ENTRY-02, ENTRY-05, ENTRY-06, ENTRY-15, ENTRY-16, ENTRY-18, ENTRY-19, ENTRY-21, ENTRY-24,
EDIT-04, EDIT-07, EDIT-09, EDIT-10, EDIT-11, EDIT-14, EDIT-16, EDIT-19, EDIT-23, DIFF-02,
DIFF-04, DIFF-05, DIFF-09, DIFF-11, DIFF-13, DIFF-16, MERGE-04, MERGE-05, MERGE-08, MERGE-10,
MERGE-13, INDEX-03, INDEX-08, INDEX-09, ENGINE-02, ENGINE-04, SET-01, SET-03, SET-04, SET-07,
SET-12, A11Y-01, A11Y-02, A11Y-04, FIRST-02, FIRST-04, FIRST-07.

**P2 — secondary flows and settings**

ENTRY-03, ENTRY-04, ENTRY-07, ENTRY-08, ENTRY-10, ENTRY-12, ENTRY-13, ENTRY-22, ENTRY-23,
ENTRY-25, EDIT-02, EDIT-06, EDIT-08, EDIT-12, EDIT-13, EDIT-15, EDIT-17, EDIT-18, EDIT-20,
EDIT-21, EDIT-22, EDIT-25, EDIT-26, EDIT-27, EDIT-28, EDIT-35, EDIT-36, EDIT-37, DIFF-08,
DIFF-10, DIFF-12, DIFF-14, DIFF-15, DIFF-17, DIFF-21, MERGE-03, MERGE-06, MERGE-07, MERGE-09,
MERGE-11, MERGE-12, MERGE-14, MERGE-19, MERGE-20, INDEX-02, INDEX-06, INDEX-07, INDEX-10,
INDEX-12, ENGINE-03, SET-02, SET-05, SET-06, SET-08, SET-09, SET-10, SET-11, A11Y-03, A11Y-05,
A11Y-06, A11Y-07, FIRST-03, FIRST-05, FIRST-08.

**P3 — rarity, scale and reported limitations**

ENTRY-09, EDIT-05, EDIT-24, EDIT-29, EDIT-31, EDIT-32, EDIT-33, EDIT-34, EDIT-38, EDIT-39,
DIFF-18…24, MERGE-16…18, INDEX-11, INDEX-13, INDEX-14, INDEX-15, INDEX-16, ENGINE-05…07,
SET-13, A11Y-08, FIRST-06, FIRST-09, FIRST-10.

## ENTRY — open, reveal, select and compare

| id | persona | preconditions | steps | expected | failure / edge | evidence | verdict |
|---|---|---|---|---|---|---|---|
| ENTRY-01 | NU | Workspace with `left.arxml` ECUC-Values file | Explorer → right-click file → ARXML Scope → Open with ECUC Editor | ECUC editor opens, module rows render, Details shows the module | Non-ECUC file falls back to text editor with explanation | PV:editor; HOST:P3 | good (PV) |
| ENTRY-02 | IE | Text editor showing the same ECUC file | Right-click in editor → ARXML Scope → Open with ECUC Editor | Same ECUC editor opens; no duplicate tab confusion | If file is already open in ECUC editor the command must focus it, not open a second | HOST:P3 | N/A — P3 |
| ENTRY-03 | NU | Any `.arxml` open or not | Command Palette → "ARXML Scope: Open with ECUC Editor" | Uses the active editor's file, or asks for one | With no active file the command must explain instead of failing silently | HOST:P3 | N/A — P3 |
| ENTRY-04 | NU | File not open | Explorer → right-click → Open With… → ECUC Values Editor | Custom editor opens; `priority: option` means normal open stays text | Picker shows only once for `.arxml` | HOST:P3 | N/A — P3 |
| ENTRY-05 | NU | `.arxml` without `ECUC-MODULE-CONFIGURATION-VALUES` | Run Open with ECUC Editor on it | Explains the gate and hands the file to the text editor | Explanation must name the missing element and not leave a blank webview | HOST:P3 | N/A — P3 |
| ENTRY-06 | NU | Non-`.arxml` file active | Command Palette → Open with ECUC Editor | Refuses with a clear message | Command appears for non-ARXML via palette; must not create a webview | HOST:P3 | N/A — P3 |
| ENTRY-07 | NU | Malformed XML `.arxml` | Open with ECUC Editor | Explains parse failure and returns to text editor | Truncated XML and bad encoding are separate messages | HOST:P3 | N/A — P3 |
| ENTRY-08 | KO | ECUC editor active with a selected container | Keyboard: focus Document → `Ctrl+Enter` | Source editor opens at the node range; focus follows `revealMode` | Focus must not be lost when the source opens beside | HOST:P3 | N/A — P3 |
| ENTRY-09 | IE | `revealMode` = `replace`; ECUC editor dirty | Press `Ctrl+Enter` on an edited row | ECUC tab is replaced by the source editor; unsaved draft must be preserved | Dirty draft can be lost if replace disposes the webview — verify save prompt | HOST:P3 | N/A — P3 |
| ENTRY-10 | IE | ECUC editor showing a parameter | Details → **Reveal in source** | Source opens beside, at the exact `<VALUE>` range | Panel uses its own column, not the active tab's column | HOST:P3 | N/A — P3 |
| ENTRY-11 | IE | `revealMode` `beside` / `focus` / `replace` | Repeat ENTRY-10 for each value | Focus stays in tree for `beside`, moves to source for `focus`, tab swaps for `replace` | Invalid stored value must fall back to `beside` | HOST:P3 | N/A — P3 |
| ENTRY-12 | IE | Text editor active, cursor inside a container's `<SHORT-NAME>` | Command Palette → Reveal in ECUC Editor | ECUC editor opens/selects the innermost ECUC node and scrolls to it | Cursor on the XML declaration or a comment must explain, not open at row 1 | HOST:P3 | N/A — P3 |
| ENTRY-13 | IE | Text editor active, cursor in a non-ECUC ARXML file | Reveal in ECUC Editor | Clear refusal; no ECUC editor | Same command is context-menu hidden for non-`.arxml` | HOST:P3 | N/A — P3 |
| ENTRY-14 | IE | Explorer focused on one `.arxml` | Right-click → ARXML Scope → Select as First File to Compare | First file is remembered for the window; Compare with First File becomes visible | Stash is one-shot after a successful compare | HOST:P3 | N/A — P3 |
| ENTRY-15 | IE | No first file selected | Look for Compare with First File | Command hidden in explorer context and palette explains no selection | Palette invocation must not throw | HOST:P3 | N/A — P3 |
| ENTRY-16 | IE | First file selected, then deleted/renamed | Right-click second file → Compare with First File | Warning naming the missing first file; stash kept or cleared explicitly | Stale path must not open an empty diff | HOST:P3 | N/A — P3 |
| ENTRY-17 | IE | First file selected, second file readable | Right-click second → Compare with First File | Diff panel opens, stash clears, Compare with First File hides | Left/right orientation: first = left | HOST:P3 | N/A — P3 |
| ENTRY-18 | IE | Explorer focused on exactly two `.arxml` files | Right-click → Compare Two ARXML Files… | Clicked file is left, other file is right | Unsaved buffers are compared, not disk bytes | HOST:P3 | N/A — P3 |
| ENTRY-19 | NU | No selection | Palette → Compare Two ARXML Files… | Two-file picker opens | Cancel leaves no panel and no error | HOST:P3 | N/A — P3 |
| ENTRY-20 | NU | Picker open | Select exactly two files → Enter | Same as ENTRY-18 | — | HOST:P3 | N/A — P3 |
| ENTRY-21 | NU | Picker open | Select one or three files | Warning "exactly two"; no panel | Multi-select of 3 must not silently drop one | HOST:P3 | N/A — P3 |
| ENTRY-22 | IE | One side is a dirty text editor buffer | Compare two | Diff shows the unsaved text | Dirty side must raise no error and must not save | HOST:P3 | N/A — P3 |
| ENTRY-23 | IE | One side non-ECUC | Compare two | Refusal naming the side and the reason; no panel | Existing open diff must stay usable | HOST:P3 | N/A — P3 |
| ENTRY-24 | IE | Same file selected twice (alias/symlink) | Compare two | Identical comparison with an empty diff, not a crash | Same path twice must be allowed or explained | HOST:P3 | N/A — P3 |
| ENTRY-25 | IE | ECUC editor open on a file, then the file is also opened as text | Open same file twice | Custom editor is reused or a second tab is intentional; no conflicting drafts | Two independent drafts on one file are a data-loss risk | HOST:P3 | N/A — P3 |

## EDIT — ECUC editor surface

| id | persona | preconditions | steps | expected | failure / edge | evidence | verdict |
|---|---|---|---|---|---|---|---|
| EDIT-01 | KO | ECUC editor open | Focus Document; `Down` through 40 rows; `Home`/`End`; `PageDown` | Cursor and row selection move together; Details follows | Focus must stay visible; no row lost at fold boundaries | PV:editor, editor-sticky; HOST:P3 | good (PV) |
| EDIT-02 | IE | ECUC editor open | Click a parameter row; scroll it out of the rendered window | Details still shows the correct row | Details reads the row store, not the DOM | PV:editor | good (PV) |
| EDIT-03 | IE | Integer parameter selected | Type `42` over its value | Value and `• Unsaved changes` appear immediately; `Ctrl+S` writes | Typing must not move selection or lose the caret | PV:editor-dirty; HOST:P3 | friction (PV) — derived Decimal/Hex/Binary stay at the old value while the draft shows `042` |
| EDIT-04 | IE | Integer parameter selected | Type `abc` | Red marker + inline "Invalid integer value"; save blocked | Top strip must say why, not only "Invalid value" | PV:editor-invalid; HOST:P3 | good (PV) |
| EDIT-05 | IE | Parameter whose value is CDATA | Select it | Value is shown, not editable | No input affordance; explain why | HOST:P3 | N/A — P3 |
| EDIT-06 | IE | Textual parameter selected | Type in Details value | Document row updates live; dirty marker appears | `Enter` must not commit | PV:editor-details; HOST:P3 | good (PV) |
| EDIT-07 | IE | Details value edited | Press `Escape` | Field restores the accepted value; no write | Focus remains in Details | PV:editor-details-undo; HOST:P3 | good (PV) |
| EDIT-08 | IE | Container selected | Type a new short name in the Document row | Row label and Details update; dirty marker; save writes | Module rename must be impossible | PV:editor-details-rename; HOST:P3 | good (PV) |
| EDIT-09 | IE | Module selected | Try to edit its short name | No edit affordance; clear reason | Module rename would rewrite ids | HOST:P3 | N/A — P3 |
| EDIT-10 | IE | Container rename that the host refuses | Type an invalid/duplicate short name | Typed text stays, red marker, error strip, save blocked | Input itself should be marked, not only the message | PV:editor-rename-refusal; HOST:P3 | friction (PV) — generic "Invalid value — not saved" strip; field border not red |
| EDIT-11 | IE | Container selected | Row context menu → Duplicate | Asks for a unique short name, inserts copy after original | Cancel aborts | HOST:P3 | N/A — P3 |
| EDIT-12 | IE | Parameter selected | Row context menu → Duplicate | Inserts a copy after the original, same definition and value | Copy must not create duplicate ids | HOST:P3 | N/A — P3 |
| EDIT-13 | IE | Duplicate dialog open | Cancel | No change, no dirty marker | — | HOST:P3 | N/A — P3 |
| EDIT-14 | IE | Container with children selected | Row context menu → Delete, confirm | Whole subtree removed in one undo step | Confirmation must name the element and child count | HOST:P3 | N/A — P3 |
| EDIT-15 | IE | Delete confirmation open | Cancel | No change | — | HOST:P3 | N/A — P3 |
| EDIT-16 | IE | Row moved/removed in the file after selection | Edit value then `Ctrl+S` | Refusal explains the node is gone; nothing written | Failure visible next to the row/save action, not only bottom-right | PV:editor-stale-save; HOST:P3 | friction (PV) — only a bottom-right amber status line; no banner or row marker |
| EDIT-17 | IE | One accepted edit applied | `Ctrl+Z` | Exactly the one edit is undone | Redo stack matches | PV:editor-details-undo; HOST:P3 | good (PV) |
| EDIT-18 | IE | Edit undone | `Ctrl+Shift+Z` / `Ctrl+Y` | Edit is reapplied | — | PV:editor-details-redo; HOST:P3 | good (PV) |
| EDIT-19 | IE | Pending draft | `Ctrl+S` | Flushes edits, waits for validation, clears markers | Save blocked while invalid or validating, with reason | PV:editor-details-save, editor-multi-save; HOST:P3 | good (PV) |
| EDIT-20 | IE | Invalid draft | `Ctrl+S` | Save is blocked; visible reason | Must not silently drop the draft | PV:editor-invalid; HOST:P3 | good (PV) |
| EDIT-21 | IE | Two fields edited | `Ctrl+S` | Both acknowledged; one dirty state clears | Partial save is not allowed | PV:editor-multi-save; HOST:P3 | good (PV) |
| EDIT-22 | IE | Textual value focused | Paste text containing a newline | Newline is rejected or normalized; no broken XML | No silent truncation | PV:editor-paste; HOST:P3 | good (PV) |
| EDIT-23 | IE | File is read-only on disk | Edit and save | Refusal explains read-only; draft stays | Same message for permission denied and locked file | HOST:P3 | N/A — P3 |
| EDIT-24 | IE | Dirty draft; webview reloads/crashes | Reload the page | Rows and condition values are re-requested; draft state explained | Must not silently lose the draft | HOST:P3 | N/A — P3 |
| EDIT-25 | KO | Multi-row text selected | Copy, then paste outside | One line per display row with indentation | Fold control/sidebar chrome excluded | HOST:P3 | N/A — P3 |
| EDIT-26 | KO | ECUC editor focused | `Ctrl+F`, `Ctrl+H` | Monaco find opens; replace writes only permitted fields | `Escape` returns focus to Document | PV:editor-find; HOST:P3 | good (PV) |
| EDIT-27 | KO | Find open with no match | Type a missing query | `No results`; no row hidden | Jump must not move on zero matches | PV:editor-find only shows 1 of 2; HOST:P3 | N/A — P3 |
| EDIT-28 | IE | Conditions tab | Add a manual constant, Save | Committed per workspace; rows mark not-set vs false | Cancel restores committed value | HOST:P3 | N/A — P3 |
| EDIT-29 | IE | Conditions tab | Add an invalid name → Save | Refused before save with inline reason | Host drops invalid names and reports them | HOST:P3 | N/A — P3 |
| EDIT-30 | IE | `ecuc.editor.sort` `all` | Change to `declaration` with a panel open | Rows re-render in file order without reopening | Selection and scroll preserved where possible | HOST:P3 | N/A — P3 |
| EDIT-31 | IE | Sidebar visible | Toolbar → **Sidebar** | Whole shell hidden, Document full width; toggle restores previous tab | Width/tab persist across reload | PV:editor (sidebar visible only); HOST:P3 | N/A — P3 |
| EDIT-32 | IE | ECUC editor with containers | Toolbar **Collapse**, then **Expand** | All containers fold/unfold; selection and search survive | Fold state must not renumber lines | HOST:P3 | N/A — P3 |
| EDIT-33 | IE | One container | Click its fold control | Only that subtree folds; parent sticky header updates | Empty container shows `{ }` | HOST:P3 | N/A — P3 |
| EDIT-34 | IE | Long document | Scroll inside a container | Nearest parent header pins; stays fixed horizontally | Sticky header must not cover the selected row | PV:editor-sticky | good (PV) |
| EDIT-35 | IE | Reference row with a same-file target | Details → **Jump to target** | Target row is selected | Ambiguous/absent target reported, not guessed | HOST:P3 | N/A — P3 |
| EDIT-36 | IE | Reference to another ECUC file | Jump to target | That file opens in ECUC editor at the row | Non-ECUC target opens text editor at range | HOST:P3 | N/A — P3 |
| EDIT-37 | IE | Module/container selected | Details → **Find references** | Quick Pick lists every resolved reference; choosing reveals it | Empty result explains no references | HOST:P3 | N/A — P3 |
| EDIT-38 | IE | Rows copied in from the diff, unsaved | Look at margin | Copied rows carry a distinct margin bar + tint; page explains unsaved copies | Must not be confused with typed edits | PV:editor-copied | friction (PV) — copied rows show markers but no `Unsaved changes` strip, unlike typing |
| EDIT-39 | NU | `.arxml` with an empty `ECUC-MODULE-CONFIGURATION-VALUES` | Open with ECUC Editor | Header renders; empty-state copy explains no modules | No blank white page | HOST:P3 | N/A — P3 |

## DIFF — semantic diff surface

| id | persona | preconditions | steps | expected | failure / edge | evidence | verdict |
|---|---|---|---|---|---|---|---|
| DIFF-01 | IE | Two comparable files | Open diff | Panel titled `<left> ↔ <right>`, panes render, no false "No differences" while loading | Loading shows `Loading comparison…` | PV:diff-merge; HOST:P3 | good (PV) |
| DIFF-02 | IE | Open diff | Toolbar **Swap sides** | Panes mirror, titles swap, word colours mirror; vertical position kept | No re-comparison | PV:diff-swap | good (PV) |
| DIFF-03 | IE | Renamed container pair | Toggle **Strict** then **Semantic** | Immediate group flip; spinner + `Switching to …`; matching output | Setting must not change | PV:diff-merge (semantic state); HOST:P3 | N/A — P3 for the toggle |
| DIFF-04 | IE | Open diff | **Collapse**, then **Expand** | Every container folds/unfolds in both panes | Removed/added containers fold on owning side | PV:diff-collapse-all | good (PV) |
| DIFF-05 | IE | One changed container | Click its fold control | Both panes fold the matching container; margin dot only when hidden changes exist | Selection/focus preserved | PV:diff-collapsed, diff-collapsed-onesided | good (PV) |
| DIFF-06 | KO | Open diff | `Ctrl+F` → type → `Enter` / `Shift+Enter` | Native widget, `1 of N`, jumps and marks; never hides rows | In Show diff only changed rows are candidates | PV:diff-find; HOST:P3 | good (PV) |
| DIFF-07 | KO | Diff focused | `F7` / `Shift+F7`; toolbar Prev/Next | Moves to next/previous change, wraps at ends | Wrap must keep focus | PV:diff-nav | good (PV) |
| DIFF-08 | IE | Open diff | Drag sash, then double-click it | Resizes both panes; double-click resets 50/50; swap keeps ratio | Must not overflow | PV:diff-sash | good (PV) |
| DIFF-09 | IE | Scroll a long diff | Scroll within a container | Nearest parent header pins per pane | Header must match the ECUC editor | PV:diff-sticky | good (PV) |
| DIFF-10 | IE | Diff with Merge off | Hover a hunk | No copy actions, no writes; sash still works | Read-only must be unmistakable | PV:diff-off | good (PV) |
| DIFF-11 | IE | Open diff | Toggle **Show all** / **Show diff**; toggle **Context** | Show all disables Context; Show diff keeps 5 context rows | Toggle state survives refresh | PV:diff-merge (Show all); HOST:P3 | N/A — P3 |
| DIFF-12 | IE | Show diff | Click a hidden-unchanged region row | Expands; label switches Show/Hide; both panes clickable | Hidden rows skipped by F7 and search | HOST:P3 | N/A — P3 |
| DIFF-13 | IE | File with added or removed elements | Open diff | One-sided rows use diagonal fill on the missing side, no placeholders or shared padding | Added/removed keep full-cell tint, no word highlight | PV:diff-one-sided, diff-added, diff-removed | good (PV) |
| DIFF-14 | IE | Diff with an unpaired container group near a budget threshold | Open diff | Note above rows: how many containers were unmatched and why; found pairs stay visible | Note must not look like an error | HOST:P3 | N/A — P3 |
| DIFF-15 | IE | Diff open; edit a file in another editor | Type in the source file | One re-scan after 150 ms; view/swap/match/collapse/search/scroll preserved | — | HOST:P3 | N/A — P3 |
| DIFF-16 | IE | Diff open; make one side non-ECUC | Break the ECUC gate | Last good comparison stays; warning explains stopped updates | — | HOST:P3 | N/A — P3 |
| DIFF-17 | IE | Diff open; refresh throws | Force an error | Last good document stays; error in notice strip | — | HOST:P3 | N/A — P3 |
| DIFF-18 | IE | Diff open | Close the panel | Listeners and pending timer disposed | No zombie refresh | HOST:P3 | N/A — P3 |
| DIFF-19 | NU | Identical files | Compare | Empty comparison with clear "no differences" state | Must not flash while loading | HOST:P3 | N/A — P3 |
| DIFF-20 | IE | Very large diff with renames | Switch Semantic/Strict | One rebuild + transfer; progress visible | Budget fallback note | HOST:P3 | N/A — P3 |
| DIFF-21 | KO | Diff find open | Query with no matches, then a valid query | `No results`, then `1 of N`; switching view re-runs query | Current key preserved where possible | HOST:P3 | N/A — P3 |
| DIFF-22 | IE | `diff.semanticMatching` off | Open diff, then toggle Semantic | Setting off means Strict default; toolbar can still switch panel only | Setting unchanged by toolbar | HOST:P3 | N/A — P3 |
| DIFF-23 | IE | Diff open; comparison file deleted on disk | Delete one side, edit the other | Warning; last good diff stays; no crash | Reopen requires reselect | HOST:P3 | N/A — P3 |
| DIFF-24 | LV | Panel ~640 px wide | Open diff at narrow split | All toolbar actions reachable; labels legible or tooltips named | 11 controls in ~312 px | PV:toolbar-640, toolbar-800, toolbar-900, toolbar-1024 | friction (PV) — labels disappear; icon-only, ~28 px targets, three near-identical square icons |

## MERGE — two-way copy merge

| id | persona | preconditions | steps | expected | failure / edge | evidence | verdict |
|---|---|---|---|---|---|---|---|
| MERGE-01 | IE | Read-only diff open | Click **Merge** | Toggle is pressed; hover gutter offers copy actions | Panel-only, off by default | PV:diff-merge; HOST:P3 | good (PV) |
| MERGE-02 | IE | Merge on; changed hunk | Hover → **Copy Block to Right** | Right side gets the element; `•` + margin marker on right; one undo step | Source side never marked | PV:diff-copied | good (PV) |
| MERGE-03 | IE | Merge on | **Copy Block to Left** | Mirrors MERGE-02 | — | HOST:P3 | N/A — P3 |
| MERGE-04 | IE | Element only on left | Copy left→right | Inserts under matched parent | — | PV:diff-added, diff-one-sided | good (PV) |
| MERGE-05 | IE | Element only on left | Copy from the empty right side | Deletes it from the left | Empty-side actions must be discoverable | PV:diff-removed, diff-one-sided | good (PV) |
| MERGE-06 | IE | Changed container | Copy container | Whole subtree moves; target-only children removed | — | HOST:P3 | N/A — P3 |
| MERGE-07 | IE | Target lacks a parent container | Copy element | Minimal ancestors created with only the copied chain | Unrelated siblings not imported | HOST:P3 | N/A — P3 |
| MERGE-08 | IE | Missing chain needs a module | Copy | Refused with a message; nothing written | Refusal must name the module | HOST:P3 | N/A — P3 |
| MERGE-09 | IE | No matching sibling | Copy | Refused with a message | — | HOST:P3 | N/A — P3 |
| MERGE-10 | IE | Comparison stale (file changed after snapshot) | Copy | Modal offers **Reload** / **Cancel** | Cancel leaves everything unchanged | HOST:P3 | N/A — P3 |
| MERGE-11 | IE | Stale modal open | Choose **Reload** | Rebuilds from in-editor documents, keeps unsaved copies | — | HOST:P3 | N/A — P3 |
| MERGE-12 | IE | Stale modal open | Choose **Cancel** | Nothing changes; previous markers stay | — | HOST:P3 | N/A — P3 |
| MERGE-13 | IE | One copy applied | `Ctrl+Z` in the receiving pane | Exactly the copy is undone; marker clears | — | HOST:P3 | N/A — P3 |
| MERGE-14 | IE | Copy applied | Look at pane label | `•` marks the dirty side | Covers typed and copied changes | PV:diff-copied (pane label not rendered in preview chrome) | N/A — P3 for the label |
| MERGE-15 | IE | Copy applied | **Save** the modified file | Markers clear after host save | Failed save keeps markers | HOST:P3 | N/A — P3 |
| MERGE-16 | IE | Read-only target file | Copy | Refusal; nothing written; markers unchanged | — | HOST:P3 | N/A — P3 |
| MERGE-17 | IE | Merge off | Hover hunk / invoke copy | No actions; panel refuses writes | — | PV:diff-off | good (PV) |
| MERGE-18 | IE | Multi-row selection | Attempt to copy a range | Only one semantic block is copied; limit explained | — | HOST:P3 | N/A — P3 |
| MERGE-19 | IE | Short hunk at line 1 | Hover | Actions collapse into **More Actions…**; menu opens with both directions | Menu must not obscure the hunk | PV:diff-one-sided | friction (PV) — overflow menu floats over the target rows at the top of the pane |
| MERGE-20 | IE | Target has a module name collision | Copy | Refused with a message naming the collision | — | HOST:P3 | N/A — P3 |

## INDEX — workspace index, definitions and validation navigation

| id | persona | preconditions | steps | expected | failure / edge | evidence | verdict |
|---|---|---|---|---|---|---|---|
| INDEX-01 | NU | Workspace with `.arxml` files | Open the window | Status bar shows `ARXML Scope: N files indexed` and check mode | Index rebuilt on activation | HOST:P3 | N/A — P3 |
| INDEX-02 | IE | Index built | Hover the status bar | Tooltip lists element, reference, definition, package counts and skipped/excluded files | Long counts must be readable | HOST:P3 | N/A — P3 |
| INDEX-03 | IE | Index built | Click the status bar; verify `auto`→`always`→`never` | Setting cycles and the mode label updates | Also reachable from the palette command | HOST:P3 | N/A — P3 |
| INDEX-04 | IE | Index built; many files | Palette → Rebuild Workspace Index | Whole index replaced; status reflects progress and final count | Rebuild must cancel/supersede an in-flight validation pass | HOST:P3 | N/A — P3 |
| INDEX-05 | IE | `index.enabled` false | Open a definition file/panel | No definitions resolved; status says indexing is off | Toggle back on rebuilds without reload? | HOST:P3 | N/A — P3 |
| INDEX-06 | IE | File larger than `maxFileSizeMB` | Open it | File opens; text features stay off; tooltip counts it as skipped | Size limit must be visible, not silent | HOST:P3 | N/A — P3 |
| INDEX-07 | IE | `index.exclude` covers a tree | Detect a definition inside it | No definitions, links, hover, diagnostics from it; tooltip reports excluded count | Exclude glob syntax errors must be reported | HOST:P3 | N/A — P3 |
| INDEX-08 | IE | Definition in another file | Select a container in Details | Definition type/range/default/multiplicity/values/file resolve by unique suffix | — | HOST:P3 | N/A — P3 |
| INDEX-09 | IE | Two definition bodies share a path | Select the row | `N definitions found`; no silent pick | — | HOST:P3 | N/A — P3 |
| INDEX-10 | KO | Plain text editor on `.arxml` | Go to Definition, Find References, outline, hover, document links | All resolve across files, using unsaved text | Definition files list definitions instead | HOST:P3 | N/A — P3 |
| INDEX-11 | IE | Duplicate AR path across files | Save | One diagnostic with related locations; cross-file duplicate = information | Same-file duplicate uses configured severity | HOST:P3 | N/A — P3 |
| INDEX-12 | NU | No folder opened | Open a single `.arxml` file | Extension works on the open file; status explains no workspace index | Commands must not throw | HOST:P3 | N/A — P3 |
| INDEX-13 | IE | Huge workspace | Wait for validation | UI stays responsive; caps keep Problems bounded; summary diagnostic | — | HOST:P3 | N/A — P3 |
| INDEX-14 | IE | Unsaved definition file | Edit the definition without saving | Panel does not pick up the change until save; no false resolution | Documented limitation; must not lie | HOST:P3 | N/A — P3 |
| INDEX-15 | IE | Virtual workspace | Open | Index unavailable; clear explanation, not silent empty results | — | HOST:P3 | N/A — P3 |
| INDEX-16 | IE | UTF-16/legacy-encoding file | Open | Unsupported encoding skipped and reported, not mojibake | — | HOST:P3 | N/A — P3 |

## ENGINE — Rust engine supervision

| id | persona | preconditions | steps | expected | failure / edge | evidence | verdict |
|---|---|---|---|---|---|---|---|
| ENGINE-01 | MA | Extension active | Palette → Show Engine Status | Prints state, version, protocol, pid, uptime, restarts, open docs, pending, memory, last error | — | HOST:P3 | N/A — P3 |
| ENGINE-02 | MA | Status open | Choose **Restart Engine** | Engine restarts; live documents reopen; panels keep working | Panels must not blank | HOST:P3 | N/A — P3 |
| ENGINE-03 | MA | Kill the engine process | Observe status, then edit | Backoff restart; in-flight requests reject; recovery message | Repeated failures stop with actionable error | HOST:P3 | N/A — P3 |
| ENGINE-04 | NU | Engine binary missing | Activate the extension | Activation fails with an actionable message listing the expected binary/platform | No commands exist — this is the whole product | HOST:P3 | N/A — P3 |
| ENGINE-05 | NU | Unsupported platform target | Activate | Message lists `linux-x64`, `win32-x64`, `darwin-x64`, `darwin-arm64` | No partial activation | HOST:P3 | N/A — P3 |
| ENGINE-06 | IE | Document near the upload cap | Open it | Chunked upload with progress; over 64 MiB single-frame is refused, over 512 MiB rejected clearly | Busy state must not look frozen | HOST:P3 | N/A — P3 |
| ENGINE-07 | IE | Engine busy with a large search/diff | Issue another action | Busy/latency is communicated; no silent hang | Cancel is unsupported; restart is the coarse cancel | HOST:P3 | N/A — P3 |

## SET — every `arxmlScope.*` setting

| id | persona | preconditions | steps | expected | failure / edge | evidence | verdict |
|---|---|---|---|---|---|---|---|
| SET-01 | IE | Settings UI open | Set `ecuc.editor.sort` to `declaration`; reopen the editor | Rows keep file order; open panels re-render | Switching back restores display order | PV:editor-labels (default `all`); HOST:P3 | N/A — P3 |
| SET-02 | IE | Settings UI open | Add a `DEFINITION-REF` tail to `sortExcept` | Matching rows keep declaration order under `all` | Bad tail must be ignored, not crash | HOST:P3 | N/A — P3 |
| SET-03 | IE | `revealMode` | Try `beside`, `focus`, `replace` | Focus/column behaviour matches the label | Invalid value falls back to `beside` | HOST:P3 | N/A — P3 |
| SET-04 | IE | `index.enabled` | Turn off, then on | Status and definition details follow; on rebuilds | Off must not clear diagnostics silently | HOST:P3 | N/A — P3 |
| SET-05 | IE | `maxFileSizeMB` | Enter `0`, `-1`, `abc`, then a large value | Invalid input rejected by VS Code; limit applies to skip/report | No crash, no partial index | HOST:P3 | N/A — P3 |
| SET-06 | IE | `index.exclude` | Enter `**/_gen/**`, then an invalid glob | Excluded files drop out of index/validation/navigation; invalid glob reported | Exclude must not hide the file from editing | HOST:P3 | N/A — P3 |
| SET-07 | IE | `validation.enabled` | Turn off, then on | Diagnostics disappear then return after the next pass | Problems panel explains off? | HOST:P3 | N/A — P3 |
| SET-08 | IE | `validation.severities` | Set `duplicateShortName` to `off`, `warning`, `error` | Rule severity follows; `off` hides it | Unknown rule key ignored | HOST:P3 | N/A — P3 |
| SET-09 | IE | Low cap `maxDiagnosticsPerFile` | Validate a file with more problems | Cap plus one summary diagnostic reports hidden count; `0` unlimited | — | HOST:P3 | N/A — P3 |
| SET-10 | IE | Low cap `maxDiagnostics` | Validate a workspace with more problems | Same summary behaviour at workspace scope | — | HOST:P3 | N/A — P3 |
| SET-11 | IE | `crossFileRules` | Try `auto`, `always`, `never` | `auto` requires an indexed definition; `never` disables cross-file rules | Status bar reflects the mode | HOST:P3 | N/A — P3 |
| SET-12 | IE | `diff.semanticMatching` | Off → open diff; on → open diff | Default match mode follows the setting; toolbar changes only the panel | Rename pairing disappears/appears as expected | HOST:P3 | N/A — P3 |
| SET-13 | NU | `settings.json` with wrong types (e.g. `sort: 3`) | Open a panel | VS Code flags/ignores the invalid override; extension falls back to defaults | No crash; no silent wrong ordering | HOST:P3 | N/A — P3 |

## A11Y — themes, keyboard, focus and zoom

| id | persona | preconditions | steps | expected | failure / edge | evidence | verdict |
|---|---|---|---|---|---|---|---|
| A11Y-01 | KO | Fresh window, no mouse | Palette → open editor → navigate → edit → save → reveal | Every primary step is reachable by keyboard | No dead end in Details or diff | HOST:P3 | N/A — P3 |
| A11Y-02 | KO | ECUC editor open | `Tab` through toolbar, Document, sidebar, conditions | Logical order; focus ring always visible | Focus must not enter hidden sidebar | PV:editor (layout); HOST:P3 | N/A — P3 |
| A11Y-03 | KO | Diff open | `Tab` through 11 toolbar controls and hunk actions | Focus order matches visual order; focus visible | Disabled Context skipped | HOST:P3 | N/A — P3 |
| A11Y-04 | LV | High-contrast theme | Open editor and diff | Outlines instead of fills; no invisible text | Diff tints keep meaning | HOST:P3 | N/A — P3 |
| A11Y-05 | LV | OS reduced motion | Open editor/diff, switch modes | Spinner/status does not rely on motion alone | Static status text present | HOST:P3 | N/A — P3 |
| A11Y-06 | LV | 200% zoom / large editor font | Open editor and diff | Toolbar and Details reflow; no clipped labels; content scrolls | At 640 px labels disappear (DIFF-24) | PV:toolbar-640 (narrow proxy); HOST:P3 | friction (PV) |
| A11Y-07 | KO | Diff toolbar | Inspect accessible names of icon-only controls | Every control has a name/title matching its label | At narrow widths only icons remain | PV:toolbar-640; HOST:P3 | N/A — P3 (DOM names not in audit) |
| A11Y-08 | KO | Diff hidden-region control | Screen reader on Show/Hide control | Announcement switches Show/Hide | — | HOST:P3 | N/A — P3 |

## FIRST — first run, empty and error states

| id | persona | preconditions | steps | expected | failure / edge | evidence | verdict |
|---|---|---|---|---|---|---|---|
| FIRST-01 | NU | Fresh install, engine binary present | Open a workspace | Activation succeeds; status bar appears; one file opens | — | HOST:P3 | N/A — P3 |
| FIRST-02 | NU | Fresh install, engine binary missing | Activate | Actionable error naming the missing binary and platform; no half-working UI | Documented as activation failure, no fallback | HOST:P3 | N/A — P3 |
| FIRST-03 | NU | Unsupported platform | Activate | Error lists supported targets | — | HOST:P3 | N/A — P3 |
| FIRST-04 | NU | Malformed ARXML | Open with ECUC Editor and as text | Text editor opens with parse error path; no blank panel | — | HOST:P3 | N/A — P3 |
| FIRST-05 | NU | Empty (0-byte) `.arxml` | Open with ECUC Editor | Explains empty/not-ECUC; stays usable | — | HOST:P3 | N/A — P3 |
| FIRST-06 | NU | Non-ARXML file (`.xml`) | Try all commands | Commands are hidden or refuse with a reason | — | HOST:P3 | N/A — P3 |
| FIRST-07 | NU | Two identical ECUC files | Compare | Clear empty comparison; no toolbar actions that imply changes | — | HOST:P3 | N/A — P3 |
| FIRST-08 | IE | Diff open; comparison file closed | Close the source tab | Panel warns and keeps the last good document | — | HOST:P3 | N/A — P3 |
| FIRST-09 | IE | Diff open; comparison file deleted | Delete it | Same as FIRST-08 plus a save refusal if merged | — | HOST:P3 | N/A — P3 |
| FIRST-10 | IE | Read-only file | Edit and save | Refusal explains permissions; draft stays visible | — | HOST:P3 | N/A — P3 |

## Surface coverage summary

| Surface | Happy | Cancel / back-out | Invalid | Missing resource |
|---|---|---|---|---|
| Open / reveal | ENTRY-01, 02, 10, 12 | ENTRY-09 | ENTRY-05, 06, 07 | ENTRY-13, 16 |
| Compare | ENTRY-14, 17, 18, 20 | ENTRY-19 | ENTRY-21, 23 | ENTRY-15, 16, 24 |
| Editor | EDIT-01, 02, 03, 06, 08, 19 | EDIT-07, 13, 15 | EDIT-04, 05, 10, 23 | EDIT-16, 24, 39 |
| Diff | DIFF-01, 02, 03, 04, 06, 07, 08, 09, 11 | DIFF-18 | DIFF-17, 21 | DIFF-16, 19, 23 |
| Merge | MERGE-01, 02, 04, 06, 15 | MERGE-12, 13 | MERGE-08, 09, 18, 20 | MERGE-10, 16 |
| Index | INDEX-01, 02, 03, 04, 08, 10 | INDEX-05, 07 | INDEX-09, 15, 16 | INDEX-06, 12, 13, 14 |
| Engine | ENGINE-01, 02, 06 | ENGINE-07 | ENGINE-03, 05 | ENGINE-04 |
| Settings | SET-01…12 | SET-04, 07 | SET-05, 06, 08, 13 | SET-03 |
| A11y | A11Y-01…06 | A11Y-03 | A11Y-07, 08 | A11Y-04, 05 |
| First run | FIRST-01, 07 | — | FIRST-04, 05, 06, 09, 10 | FIRST-02, 03, 08 |

## Continuity probes

The Phase 3 `EDIT-19` check covered the write and the dirty strip only; it did **not** compare
scroll, selection or focus. `EDIT-40` is the continuity probe and supersedes that part of
EDIT-19. Every mutating journey needs the same before/after snapshot.

| id | action | preconditions | snapshot | expected | evidence | verdict |
|---|---|---|---|---|---|---|
| EDIT-40 | Save a typed edit | Large document scrolled to its last parameter; edited row off-screen initially | scrollTop, selected row/caret, focus, folds, edited row visibility | All preserved after the host echo; no jump to the top | `HOST:P3` — `save-continuity-*` | friction — scroll and focus preserved, but Details jumped from `P99` to `P85` (**UX-011**) |
| EDIT-41 | Undo / redo | Scrolled draft with a copied marker | scroll, caret, markers | The view stays where the user was | `HOST:P3` | N/A — not run |
| DIFF-25 | Semantic toggle / refresh | Diff scrolled deep with a fold and find query | scroll both panes, folds, find, sash | Rebuild keeps the user's place | `HOST:P3` | N/A — not run |
| MERGE-16 | Copy then save | Diff scrolled to a one-sided hunk | scroll, selection, pane split, markers | Copy and save do not reset the panes | `HOST:P3` | N/A — not run |
| SET-13 | Settings / theme change | Scrolled editor with a selection | scroll, selection, theme tokens | Content and place survive the repaint | `HOST:P3` | N/A — not run |

## Preview gaps (rendered journey with no seeded state)

| Journey | Missing surface | Disposition |
|---|---|---|
| DIFF-19 / FIRST-07 | Identical comparison / empty diff | PV gap — needs a host run; no seeded state |
| DIFF-01 loading | `Loading comparison…` interim state | PV gap — no seeded state |
| DIFF-16 / DIFF-17 | Warning and error notice strip | PV gap — no seeded state |
| MERGE-08 / MERGE-10 | Refusal message and stale snapshot modal | PV gap — host-only modal |
| EDIT-39 / FIRST-05 | Empty ECUC document | PV gap — no seeded state |
| EDIT-05 | CDATA value read-only | PV gap — no seeded state |
| EDIT-28 / EDIT-29 | Conditions tab rows, add/save/refusal | PV gap — no seeded state |
| A11Y-04 / A11Y-05 | High contrast, reduced motion | PV gap — preview is dark-theme only (skill limit) |
