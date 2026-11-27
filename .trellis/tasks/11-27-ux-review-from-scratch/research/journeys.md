# Journey matrix — ARXML Scope UX review (fresh run, 2026-11-27)

Sources: `docs/user/{ECUC_EDITOR,DIFF,MERGE}.md`, `package.json` → `contributes`
(9 commands, 1 submenu, 2 menus, 1 custom editor, 12 settings) and the host sources
(`src/commands.ts`, `src/host/engineStatus.ts`, `src/host/indexService.ts`,
`src/host/validationService.ts`). Nothing here is carried over from the archived review.

Verdict legend: `pending` (not run yet), `preview-pass` (the seeded preview state rendered and
its audit is clean; the host half of the journey is still unrun), `preview-finding` (a preview
state is the evidence for a filed finding), `pass`, `finding` (host-confirmed defect), `N/A`
(blocked, reason recorded).

Phase 1–3 status: inventory, preview capture and the real-host pass are done. `research/host-runs.md`
holds the per-journey host verdicts and every `N/A` reason; the host column in the tables below
names the scenario that produced the evidence. No row is marked `pass` on preview evidence alone.

Continuity is a **separate verdict column** on every row that triggers a host round-trip. A row
can be `pass` for the data result and `lost` for continuity; that is a finding.

---

## 0. Settings inventory (all 12)

Every `arxmlScope.*` setting is exercised here and again in the SET journeys or in the surface
that owns it.

| Setting | Type / default | Owning journey |
|---|---|---|
| `arxmlScope.ecuc.editor.sort` | `"all"` | SET-01 |
| `arxmlScope.ecuc.editor.sortExcept` | 15-entry array | SET-02 |
| `arxmlScope.ecuc.editor.revealMode` | `"beside"` | SET-03 |
| `arxmlScope.index.enabled` | `true` | SET-04, INDEX-02 |
| `arxmlScope.index.maxFileSizeMB` | `50` (≥1) | SET-05, INDEX-03 |
| `arxmlScope.index.exclude` | `[]` | SET-06, INDEX-04 |
| `arxmlScope.validation.enabled` | `true` | SET-07 |
| `arxmlScope.validation.severities` | per-rule map | SET-08 |
| `arxmlScope.validation.maxDiagnosticsPerFile` | `500` (≥0) | SET-09 |
| `arxmlScope.validation.maxDiagnostics` | `5000` (≥0) | SET-10 |
| `arxmlScope.validation.crossFileRules` | `"auto"` | SET-11, INDEX-06 |
| `arxmlScope.diff.semanticMatching` | `true` | SET-12, DIFF-08 |

## 0b. Command inventory (all 9) and surfaces

| Command id | Title (category) | Row(s) |
|---|---|---|
| `vscode-arxml-scope.openEcucEditor` | Open with ECUC Editor (ARXML Scope) | ENTRY-01…05 |
| `vscode-arxml-scope.revealInSource` | Reveal in ARXML Source | ENTRY-08, EDIT-25 |
| `vscode-arxml-scope.revealInEcucEditor` | Reveal in ECUC Editor | ENTRY-06, ENTRY-07 |
| `vscode-arxml-scope.selectAsFirst` | Select as First File to Compare | ENTRY-09, ENTRY-10 |
| `vscode-arxml-scope.compareToStaged` | Compare with First File | ENTRY-11, ENTRY-12 |
| `vscode-arxml-scope.compareSelected` | Compare Two ARXML Files… | ENTRY-13…16 |
| `vscode-arxml-scope.rebuildIndex` | Rebuild Workspace Index | INDEX-05 |
| `vscode-arxml-scope.cycleCrossFileRules` | Cycle Cross-File Checks | INDEX-06, SET-11 |
| `vscode-arxml-scope.showEngineStatus` | Show Engine Status | ENGINE-01…05 |

Surfaces: ECUC custom editor (`vscode-arxml-scope.ecucEditor`, priority `option`), semantic diff
panel, merge mode, Conditions panel, Details panel, status bar (index + engine), Problems panel,
plain text editor contribution, Output channel `ARXML Scope Engine`.

---

## 1. ENTRY — getting into the surfaces

| ID | Journey / path | Expected result | Preview evidence | Host evidence | UX verdict | Continuity |
|---|---|---|---|---|---|---|
| ENTRY-01 | Explorer right-click `.arxml` → ARXML Scope → Open with ECUC Editor (happy) | Custom editor opens at top of file, module rows visible, toolbar + Document + Details render together | `editor` | `gate` | pass | n/a (first open) |
| ENTRY-02 | Active text editor right-click → same submenu | Same editor; source tab stays available | `editor` | `gate` | pending | n/a |
| ENTRY-03 | Palette → Open with ECUC Editor with **no** active file | `Open an .arxml file first.` information message; nothing opens | — | host `probe` (not scripted) | pending | n/a |
| ENTRY-04 | Open a non-ECUC / malformed `.arxml` | Warning with the gate reason; file stays/hands back to the text editor | — | host `stale-first` variant (not scripted) | pending | n/a |
| ENTRY-05 | `Open With…` → ECUC Values Editor | Same editor; picker lists the display name "ECUC Values Editor" | — | manual (native picker) | pending | n/a |
| ENTRY-06 | Text editor, cursor inside a container → Reveal in ECUC Editor | Editor opens/selects the innermost node; Details follows | `editor` (selection) | host `a11y`/`gate` (not scripted) | pending | n/a |
| ENTRY-07 | Reveal in ECUC Editor with no ECUC node at cursor / no file | `No ECUC node at the cursor.` / `Place the cursor in an .arxml file first.` | — | not scripted | pending | n/a |
| ENTRY-08 | Palette → Reveal in ARXML Source with no file/node | `Reveal needs an .arxml file and a node.` info message | — | not scripted | pending | n/a |
| ENTRY-09 | Explorer right-click first file → Select as First File | Info toast quotes the file name and tells the next step; second-file action becomes available | — | `compare-two` (setup) | pending | n/a |
| ENTRY-10 | Select as First on a non-ECUC file | Gate warning; stash **not** replaced | — | not scripted | pending | n/a |
| ENTRY-11 | Right-click second file → Compare with First File (happy) | Diff panel `<left> ↔ <right>` opens; stash clears; the Explorer action disappears | `diff-off` | `gate` | pass | n/a |
| ENTRY-12 | Compare with First File with **no** stash (palette) | Warning `Select a first file … before comparing.` | — | not scripted | pending | n/a |
| ENTRY-13 | Select exactly two files → Compare Two ARXML Files… | Panel opens with the clicked file as left side | `diff-off` | `compare-two` | pass | n/a |
| ENTRY-14 | Compare Two from palette → picker: cancel / 1 file / non-ECUC file | Cancel = silent no-op; 1 file = `Select exactly two .arxml files to compare.`; non-ECUC = gate warning | — | `compare-two` (variant) | pending | n/a |
| ENTRY-15 | Compare the same file twice | Same path on both sides; identical rows, no change classes; no crash | — | `same-file` | pass (refused with a warning) | n/a |
| ENTRY-16 | First file deleted/renamed before Compare with First | Refusal warning naming the file; stash kept so the user can retry | — | `stale-first` | finding UX-07 | preserved (stale stash kept) |
| ENTRY-17 | Status bar index item click | Cycles `auto → always → never → auto`, no dialog | — | `engine-index` | pending | n/a |
| ENTRY-18 | Palette → Rebuild Workspace Index | Rebuild runs; status bar re-counts; no blocking modal | — | `engine-index` | pass | preserved (index state) |
| ENTRY-19 | Palette → Show Engine Status (happy) | Output channel `ARXML Scope Engine` opens with the health block; info message offers **Restart Engine** / **Open Output** | — | `engine-index` | pass | n/a |
| ENTRY-20 | Status bar engine item click | Same as ENTRY-19 (item command is the status command) | — | `engine-index` | pending | n/a |

## 2. EDIT — ECUC editor

| ID | Journey / path | Expected result | Preview evidence | Host evidence | UX verdict | Continuity |
|---|---|---|---|---|---|---|
| EDIT-01 | Open a valid file (happy) | Document renders modules/containers/parameters; header lines are not nodes; no file-name strip; selection empty | `editor`, `editor-labels` | `gate` | pass | n/a (first open) |
| EDIT-02 | Arrow/Home/End/PageUp/PageDown through rows; click a line number | Cursor and row selection move together; Details follows; blank separator rows and annotations are not selectable | `editor` | `a11y` | N/A (no host scenario) | pending |
| EDIT-03 | Click a parameter → Details | Details shows kind/label/def-ref/short name/value/contexts/conditions; definition fields appear only when resolved | `editor` | `edit` | pass | n/a |
| EDIT-04 | Type in a value inline (happy) | Text + `● Unsaved changes` immediately, tab title `•`, host write after idle; no file write before `Ctrl+S` | `editor-dirty` | `edit` | pass | preserved (caret) |
| EDIT-05 | Type `abc` into an integer; press `Ctrl+S` | Red inline marker + error strip; save blocked; nothing written | `editor-invalid` | `edit` (variant) | N/A (no host scenario) | pending |
| EDIT-06 | Details edit → `Ctrl+S` (happy) | One raw edit, ack, save; host echo rebuild keeps Details focus/caret and the new value | `editor-details`, `editor-details-save` | `edit` | partial: save passes, focus/caret unproven | partial |
| EDIT-07 | Details edit → Undo → Redo | Undo restores the host value and clean toolbar; redo restores the draft + dirty marker; caret follows | `editor-details-undo`, `editor-details-redo` | not scripted (keys need host) | N/A (no host keys) | pending |
| EDIT-08 | Edit two fields → one `Ctrl+S` | Two edits then one save after both acks; both values stay visible | `editor-multi-save` | `edit` (variant) | N/A (no host scenario) | pending |
| EDIT-09 | Rename a container short name → save | Ack before re-scan; next save defers; post-flush keystroke submitted at the new id; Details at new id | `editor-details-rename` | `edit` (variant) | N/A (no host scenario) | pending |
| EDIT-10 | Rename whose re-scan lands first and the host refuses | Inline refusal at the new id; no save; typed text retained | `editor-rename-refusal` | `stale-node` (variant) | N/A (no host scenario) | pending |
| EDIT-11 | Rename where the re-scan lands before the ack | Draft and caret kept, submitted at the host id, then saved | `editor-rename-late-ack` | not scripted | N/A (no host scenario) | pending |
| EDIT-12 | Container right-click → Duplicate | Unique-short-name prompt first; copy inserted after the original; one undo step | — | not scripted | pending | pending |
| EDIT-13 | Right-click → Delete → confirm / cancel | Confirm removes the whole element; cancel writes nothing; one `Ctrl+Z` restores | — | not scripted | pending | pending |
| EDIT-14 | Edit a row that disappears from the re-scan, then `Ctrl+S` | Save blocked, no save posted, message explains the node is gone | `editor-stale-save` | `stale-node` | finding UX-02 (confirmed) | selection moved to another row |
| EDIT-15 | Paste text containing a newline into Document/Details | One escaped line (`\n`), one quote pair, no host edit (native paste path needs host) | `editor-paste` | manual | preview-pass | pending |
| EDIT-16 | Read-only file: type + `Ctrl+S` | Refusal is visible and nothing is written; no silent success (the user can still edit text locally) | — | not scripted | pending | pending |
| EDIT-17 | Select a CDATA-backed value | Displayed, not editable, with no dead input affordance | — | not scripted | pending | n/a |
| EDIT-18 | `Ctrl+F` → type → Enter / Shift+Enter / F3; `Ctrl+H` replace single/all; invalid regex | Rust count `1 of N`/`No results`; escaped row jumps keep focus in the find input; invalid pattern reported in Details | `editor-find` | manual (native widget keys) | preview-pass | pending |
| EDIT-19 | Fold one container; toolbar Collapse / Expand | Fold control and toolbar both fold; numbers do not renumber; subtree tint follows | — | not scripted | pending | pending |
| EDIT-20 | Scroll deep into `Items` | Nearest module/container header stays pinned by sticky scroll | `editor-sticky` | not scripted | preview-pass | preserved (scroll) |
| EDIT-21 | Long label/value, horizontal scroll | One line, horizontal scroll inside the editor; line numbers fixed | — | not scripted | pending | preserved (h-scroll) |
| EDIT-22 | Drag/double-click across ≥2 rows → copy | One line per display row with indentation; fold control/sidebar chrome not selectable | — | manual (OS clipboard) | pending | n/a |
| EDIT-23 | Conditions: Add draft, Save, Cancel, Clear values, invalid name | Add is unsaved until Save; Cancel restores; Clear empties committed values but keeps rows; invalid name refused inline | `editor-syscond` | not scripted | preview-pass (Details half) | pending |
| EDIT-24 | Details → Jump to target / Find references | Same-file target selects the row; cross-file opens the target; ambiguous/missing reported, never guessed; Quick Pick reveals in text editor | `editor-syscond` (context) | not scripted | pending | pending |
| EDIT-25 | Reveal in source under `beside` / `focus` / `replace` | `beside` keeps focus in the tree; `focus` moves it; `replace` swaps the ECUC tab for the text editor | — | manual (SET-03 variant) | pending | pending |
| EDIT-26 | Change `arxmlScope.ecuc.editor.*` while open | Panel re-renders with the new order/reveal mode, no reopen | — | not scripted (SET-01/02) | pending | pending |
| EDIT-27 | Reload the webview (crash / developer reload) | Page asks the host for rows/conditions again; sidebar width, tab, section sizes and visibility restored | `editor` (seeded) | `a11y`/manual | pending | pending |
| EDIT-28 | Toolbar Sidebar toggle off/on | Document takes full width; toggling back restores the previous tab (Details by default) | `editor` | not scripted | finding UX-03 (confirmed) | pending |

## 3. DIFF — semantic diff

| ID | Journey / path | Expected result | Preview evidence | Host evidence | UX verdict | Continuity |
|---|---|---|---|---|---|---|
| DIFF-01 | Open a comparison (happy) | Two independent models, fixed file-name strip, shared vertical scroll, per-pane horizontal scroll | `diff-off` | `gate` | finding UX-05 (confirmed) | n/a |
| DIFF-02 | Open a large comparison | `Loading comparison…` until rows arrive; never a false `No differences` | — | `probe-diff` | pending | n/a |
| DIFF-03 | Toolbar at 1400/1200/1024/900/800/640 CSS px | Labels drop in the documented order; icon-only at ≤1024; left group stays left; nothing overlaps | `toolbar-1400`…`toolbar-640` | `diff` (widths via capture) | finding UX-04 (confirmed) | n/a |
| DIFF-04 | Show all ↔ Show diff; Context on/off | Show diff keeps 5 context rows + native hidden-region controls; Context disabled under Show all; never changes the result | `diff-off`, `toolbar-1400` | `diff` | finding UX-05 (confirmed) | pending |
| DIFF-05 | Prev/Next diff and F7/Shift+F7 through every change | Visits changes in order and wraps; view mode/query unaffected | `diff-nav`, `diff-rail` | `diff` | pass | pending |
| DIFF-06 | Collapse / Expand; fold a shared container | Every container folds on the owning side; shared header + `⋯` + margin dot on the modified side; children hidden | `diff-collapsed`, `diff-collapsed-onesided`, `diff-collapse-all` | `diff` (variant) | N/A (no host scenario; preview retry clean) | pending |
| DIFF-07 | Swap sides | Headers/values mirror; copy direction follows displayed panes; vertical scroll kept, horizontal reset | `diff-swap` | `diff` | N/A (no host scenario) | pending |
| DIFF-08 | Semantic ↔ Strict | Group flips at once with spinner + `Switching to …`; Strict reproduces strict output; cache hit when no renames | — | `diff` | pass (toggle flips; pending state uncaptured) | pending |
| DIFF-09 | `Ctrl+F` in the modified pane; `Aa`/`ab\|`/`.*`; Enter/Shift+Enter | Native widget in the focused pane; Rust count; options re-commit; no replace row | `diff-find` | `diff` | finding UX-09 | pending |
| DIFF-10 | Drag the sash; double-click it | Resizes both panes; reset returns to 50/50 and survives document replacement/swap | `diff-sash` | `diff` (variant) | preview-pass | preserved (sash) |
| DIFF-11 | Deep scroll into `Items` | Both panes pin the full module/container header | `diff-sticky` | not scripted | preview-pass | preserved (scroll) |
| DIFF-12 | Long parameter names; pan 600 px | Panes overflow horizontally; native scrolling stays inside the pane | `diff-wide`, `diff-wide-panned` | not scripted | preview-pass | preserved (h-scroll) |
| DIFF-13 | One-sided module added / removed | Native diagonal fill for the missing side; both copy directions offered under Merge | `diff-one-sided`, `diff-added`, `diff-removed` | `merge` | pass | n/a |
| DIFF-14 | Compare two identical files | An explicit empty/"identical" result, not a blank pane | — | `same-file` | pending | n/a |
| DIFF-15 | A side stops being ECUC-Values while the panel is open | Last good comparison stays + warning explains why it stopped updating | — | not scripted | pending | preserved (view) |
| DIFF-16 | Edit either file (150 ms debounce) | One re-scan; document replaced but view mode, swap, match mode, collapse set, selection, search and scroll preserved where rows exist | — | not scripted | pending | pending |
| DIFF-17 | Refresh throws | Last good document stays; error in the notice strip | — | not scripted | pending | pending |
| DIFF-18 | Definition missing / index disabled | Diff still renders; definition fields absent or `N definitions found`; no guessing | — | not scripted (SET-04) | pending | n/a |
| DIFF-19 | Close the panel | Listeners and pending refresh timer disposed; no stray notifications | — | `gate` (cleanup) | pass | n/a |
| DIFF-20 | Open a third comparison while one is open | Defined behaviour: new panel or reuse, with no lost merge/copied-marker state | — | not scripted | pending | pending |

## 4. MERGE — two-way copy

| ID | Journey / path | Expected result | Preview evidence | Host evidence | UX verdict | Continuity |
|---|---|---|---|---|---|---|
| MERGE-01 | Press Merge / press again | Gutter copy actions appear only in Merge; off restores read-only diff, sash stays; panel-local and off by default | `diff-merge` | `merge` | pass | preserved (sash) |
| MERGE-02 | Copy Block to Right / to Left on a changed pair | Target replaced, source untouched; one undo step | `diff-merge` | `merge` | pass | pending |
| MERGE-03 | Copy from the empty side | Deletes the element on the side that has it; both directions offered | `diff-removed`, `diff-added` | `merge` (variant) | N/A (no host scenario) | pending |
| MERGE-04 | Copy a container | Whole subtree moves; target-only children removed | — | `merge` (variant) | pending | pending |
| MERGE-05 | Target lacks a parent container | Minimal containers created (short name, def-ref, copied chain only); unrelated children not imported | — | not scripted | pending | pending |
| MERGE-06 | Missing chain needs a module / module collision | Copy refused with a message; nothing written; refusal is inline/visible | `diff-added` (copy affordance) | not scripted | pending | pending |
| MERGE-07 | Stale snapshot → modal Reload / Cancel | Reload rebuilds keeping unsaved copies; Cancel leaves everything unchanged | — | `stale-copy` | N/A (did not reproduce) | pending |
| MERGE-08 | After a copy, before save | Received side shows margin bar only; source side clean; `•` pane label; cleared after successful Save / undo / typed-over | `diff-copied`, `editor-copied` | `merge` | pass | pending |
| MERGE-09 | `Ctrl+Z` in the receiving pane | One copy undone; other copies/edits keep their markers | — | `merge` (variant) | pending | pending |
| MERGE-10 | Copy attempt while Merge is off | No gutter actions; no write path | `diff-off` | `merge` (variant) | pending | n/a |
| MERGE-11 | Save the diff-changed file | Normal save; copied markers clear after ack; pane label clean; scroll/selection kept | `diff-copied` | `merge` | finding UX-06 | pending |
| MERGE-12 | Multi-row/range selection → copy | Not supported; action targets the topmost semantic row in the hunk | `diff-one-sided` | not scripted | pending | n/a |

## 5. INDEX — workspace index, navigation, validation

| ID | Journey / path | Expected result | Preview evidence | Host evidence | UX verdict | Continuity |
|---|---|---|---|---|---|---|
| INDEX-01 | Activate with `.arxml` files present | Status bar `ARXML Scope: N files indexed` + cross-file mode; hover shows element/reference/definition/package counts | — | `engine-index` | pass | n/a |
| INDEX-02 | `index.enabled: false` | No index work; status bar explains/updates; editor stays text-only for definitions | — | not scripted (SET-04) | pending | n/a |
| INDEX-03 | File above `maxFileSizeMB` | Skipped and counted in the status-bar tooltip; the file still opens | — | not scripted | pending | n/a |
| INDEX-04 | `index.exclude` matches a tree | Files never indexed/validated/navigated; still editable as text; excluded count in the tooltip | — | not scripted | pending | n/a |
| INDEX-05 | Rebuild Workspace Index | Full replacement; diagnostics recomputed; no modal; counts refresh | — | `engine-index` | pass | pending |
| INDEX-06 | Cycle Cross-File Checks: status bar click and command | `auto → always → never`; workspace-scoped update; validation re-runs; no dialog | — | `engine-index` | N/A (not scripted) | pending |
| INDEX-07 | Plain text editor: outline, Go to Definition, Find References, links, hover | Cross-file symbols resolve; ambiguous suffix refused; unsaved buffer participates; > max size file gets no features | — | not scripted | pending | n/a |
| INDEX-08 | No workspace folder / empty workspace | No crash; status bar shows zero/absent index; commands stay usable on a single file | — | not scripted | pending | n/a |
| INDEX-09 | Unsupported encoding / huge workspace | Unsupported encoding skipped and reported; validation stays responsive and capped | — | not scripted | pending | n/a |
| INDEX-10 | Create/delete/save a file | Index follows; reverse-reference map updated on value/reference save, lazily rebuilt after a structural change | — | not scripted | pending | n/a |

## 6. ENGINE

| ID | Journey / path | Expected result | Preview evidence | Host evidence | UX verdict | Continuity |
|---|---|---|---|---|---|---|
| ENGINE-01 | Engine running | Status bar `$(pulse) ARXML Engine`, tooltip `ARXML Scope engine running, pid N` | — | `engine-index` | pass | n/a |
| ENGINE-02 | Show Engine Status → Restart Engine / Open Output | Health block written to the output channel; Restart shows `engine restarted` or a failure error | — | `engine-index` | pass (Open Output) | n/a |
| ENGINE-03 | Restart fails | Error message with the cause; status item reflects `failed` | — | not scripted | pending | n/a |
| ENGINE-04 | Engine binary missing / unsupported platform | Extension still activates; features degrade to the TS path and say why (no silent dead UI) | — | `missing-engine` | pass (hard activation failure) + UX-08 | n/a |
| ENGINE-05 | Crash then restart | Status goes starting→running; open editor keeps working (TS fallback for the session) | — | not scripted | pending | pending |
| ENGINE-06 | Engine busy / large upload | No frozen UI; a visible busy state; cancellation or a bounded wait | — | not scripted | pending | pending |
| ENGINE-07 | Engine does not report health | `this engine does not report health` warning; no empty output window | — | not scripted | pending | n/a |

## 7. SET — settings behaviour

| ID | Journey / path | Expected result | Preview evidence | Host evidence | UX verdict | Continuity |
|---|---|---|---|---|---|---|
| SET-01 | `ecuc.editor.sort`: `all` ↔ `declaration` (+ invalid string) | Order changes live in an open panel; invalid value falls back safely with no crash | — | not scripted | pending | pending |
| SET-02 | `ecuc.editor.sortExcept`: add/remove a tail; invalid entry | Matching tails keep declaration order; bad entries ignored; live re-render | — | not scripted | pending | pending |
| SET-03 | `ecuc.editor.revealMode`: `beside` / `focus` / `replace` (+ invalid) | Documented focus/placement per mode; invalid falls back to `beside` | — | manual | pending | pending |
| SET-04 | `index.enabled` off → on | Index torn down/rebuilt; definitions and status update; editor keeps working | — | not scripted | pending | pending |
| SET-05 | `index.maxFileSizeMB`: `1`, `0`, negative, non-number | `1` skips almost everything; out-of-schema `0`/negative does not crash or index unbounded silently | — | not scripted | pending | n/a |
| SET-06 | `index.exclude`: add/remove; malformed glob `[` | Globs exclude exactly the matching tree; malformed pattern does not crash discovery | — | not scripted | pending | n/a |
| SET-07 | `validation.enabled` off → on | Problems and text markers clear/repopulate; no stale diagnostics | — | not scripted | pending | n/a |
| SET-08 | `validation.severities`: each level + `off`; invalid value | Severity changes in Problems; `off` hides the rule; invalid value does not crash | — | not scripted | pending | n/a |
| SET-09 | `maxDiagnosticsPerFile`: `0` (unlimited), small cap | `0` publishes all; a cap adds the hidden-problems summary | — | not scripted | pending | n/a |
| SET-10 | `maxDiagnostics`: `0`, small cap | Workspace cap plus summary; `0` unlimited | — | not scripted | pending | n/a |
| SET-11 | `crossFileRules`: `auto` / `always` / `never`; invalid | Cross-file diagnostics follow the mode; status bar reflects it; invalid falls back to `auto` | — | `engine-index` | pending | n/a |
| SET-12 | `diff.semanticMatching` off → on vs toolbar toggle | Setting affects new panels; toolbar changes only the current panel and does not write the setting | — | not scripted | pending | preserved (per-panel mode) |

## 8. A11Y — accessibility, themes, zoom

| ID | Journey / path | Expected result | Preview evidence | Host evidence | UX verdict | Continuity |
|---|---|---|---|---|---|---|
| A11Y-01 | Keyboard-only: palette → open → select → details → save | No mouse required for the primary edit; focus never traps outside the webview | `editor` | `a11y` | pass | preserved (focus) |
| A11Y-02 | Tab order through toolbar → Document → Details/sidebar | Logical order, visible focus ring on every stop, no invisible stop | `editor` | `a11y` | pass (order); focus ring unverified | preserved |
| A11Y-03 | High-contrast theme | Outlines replace fills; text/chips/diff tints remain legible; no invisible control | — | `capture-fidelity` (theme variant not scripted) | pending | preserved |
| A11Y-04 | Light theme | Diff tints, syntax tokens and copied markers keep contrast | — | not scripted | pending | preserved |
| A11Y-05 | Zoom 80% and 150% at a realistic workbench | Toolbar never overlaps; labels/icon-only breakpoints still sane at the effective webview width | `toolbar-*` (CSS px) | `capture-fidelity` | pass at 100%; 80% element capture unreliable | preserved |
| A11Y-06 | Reduced motion | Spinner/progress and sash/swap transitions respect `prefers-reduced-motion` | — | not scripted | N/A (not scripted) | pending |
| A11Y-07 | Screen-reader labels on icon-only buttons and diff gutter | `aria-label`/tooltip on every icon control; diff actions announce direction and side | `toolbar-640` (visual) | manual | pending | n/a |
| A11Y-08 | Target sizes at 640/800/1024 | 28/32/36 px tools stay ≥24 px hit area; no adjacent-action misclick | `toolbar-640`…`toolbar-1024` | `capture-fidelity` | pending | n/a |

## 9. FIRST — first run, bad input, packaging

| ID | Journey / path | Expected result | Preview evidence | Host evidence | UX verdict | Continuity |
|---|---|---|---|---|---|---|
| FIRST-01 | Fresh profile, no engine built | Extension activates, says the engine is unavailable, and core read paths work | — | `missing-engine` | pass with observation (hard fail, explained) | n/a |
| FIRST-02 | Unsupported platform | Clear unsupported message; no crash loop or repeated toasts | — | N/A (win32 only here) | pending | n/a |
| FIRST-03 | Open an empty `.arxml` | A clear empty/"not ECUC" state, not a blank editor or a spinner forever | — | not scripted | pending | n/a |
| FIRST-04 | Compare an empty/malformed/non-ARXML file | Gate warning names the problem; no half-open panel | — | not scripted | pending | n/a |
| FIRST-05 | Comparison file closed/deleted while the panel is open | Last good comparison + warning; no crash | — | not scripted | pending | preserved |
| FIRST-06 | Install from a packaged VSIX | Activation, menus and custom editor registered the same as dev host | — | N/A (not packaged here) | pending | n/a |

## 10. CONTINUITY — after every host round-trip

Every row records before/after: exact `scrollTop` + anchor row, selection/caret, focus target,
folds + sticky header, active tab/sidebar/pane, find query/match, sash, dirty/copied markers and
the edited row's visibility. **Scroll and selection are scored independently.**

| ID | Journey | Expected result | Preview evidence | Host evidence | UX verdict | Continuity |
|---|---|---|---|---|---|---|
| CONT-01 | Inline edit + save, document scrolled away from top, edited row off-screen | Same `scrollTop`/anchor, same caret/focus, folds intact, dirty marker cleared; Details still on the same row | `editor-dirty`, `editor-sticky` | `save-continuity` | pass | scroll anchor/selection/focus/dirty preserved; folds N/A; exact scrollTop not measured |
| CONT-02 | Details edit + save (host echo rebuild) | Details focus/caret and the selected row preserved; no jump to top | `editor-details-save` | `edit` | N/A (no host probe; preview covers the page side) | preview-only |
| CONT-03 | Multi-field save | Both values visible, scroll/selection unchanged, one save | `editor-multi-save` | `edit` (variant) | pending | pending |
| CONT-04 | Diff save after a merge copy | Pane scroll/sash/selection/find preserved; markers clear | `diff-copied` | `merge` | N/A (no dedicated probe) | pending |
| CONT-05 | Merge copy round-trip | Row stays selected; scroll does not jump; the other pane's scroll stays aligned | `diff-copied` | `merge` | N/A (no probe) | pending |
| CONT-06 | Undo/redo | Local draft first, then file; caret and folds preserved | `editor-details-undo/redo`, `editor-delete` | not scripted (keys) | pending | pending |
| CONT-07 | Rename | Selection/Details move to the new id as one pair with scroll/focus | `editor-details-rename` | not scripted | pending | pending |
| CONT-08 | Diff refresh (150 ms debounce) | View mode, swap, match mode, collapse set, selection, search and scroll preserved where rows exist | — | not scripted | N/A (no probe) | pending |
| CONT-09 | Settings/theme change with a panel open | Re-render keeps scroll, selection and sidebar tab; no model reset when a patch suffices | — | not scripted | N/A (no probe) | pending |
| CONT-10 | One-row document patch after an accepted edit | Only that row is replaced; the rest of the view is untouched (no full reset) | `editor-details` | `edit` | N/A (no probe) | pending |
| CONT-11 | Sidebar toggle / webview reload | Sidebar width, tab, section sizes, collapsed sections and visibility restored | `editor` | manual | N/A (no probe) | pending |
| CONT-12 | Index rebuild with an editor open | Diagnostics update without moving the document or clearing the selection | — | `engine-index` | N/A (no probe) | pending |

---

## Execution order

P0 — prove the product works end to end first:

1. ENTRY-11 / DIFF-01 (gate) — open → select first → compare → diff.
2. EDIT-01 / EDIT-03 / EDIT-04 / EDIT-06 — render, Details, inline edit, save.
3. CONT-01 / CONT-02 — save continuity scrolled away from the top.
4. DIFF-03 / A11Y-05 + `capture-fidelity` — two effective widths at 100% and 80%.
5. ENTRY-15 / DIFF-14 — same file twice; identical result.
6. ENGINE-01 / INDEX-01 / ENTRY-18 / ENTRY-19 — status bar and index basics.
7. FIRST-01 / ENGINE-04 — missing engine activation.
8. MERGE-01 / MERGE-02 / MERGE-11 — merge on, copy, save.
9. SET-11 / INDEX-06 — cross-file mode cycle.
10. A11Y-01 / A11Y-02 — keyboard and focus order.

P1 — edge/refusal coverage once P0 has evidence:

11. EDIT-05 / EDIT-14 / MERGE-06 / MERGE-07 / ENTRY-12 / ENTRY-16 — invalid, stale, refusal, no-stash, deleted first file.
12. DIFF-04…DIFF-09 / DIFF-13 — show diff, nav, collapse, swap, semantic, find, one-sided.
13. SET-01…SET-12 — every setting on/off/invalid.
14. INDEX-02…INDEX-04, INDEX-08, INDEX-09 — disabled, size cap, exclude, no workspace, huge workspace.
15. CONT-04…CONT-12 — remaining continuity probes.
16. FIRST-02, FIRST-05, FIRST-06, EDIT-16…EDIT-28, MERGE-04/05/09/12 — limits and manual-only paths.

## Preview gaps

Rendered journeys with **no seeded state** (they need a host pass or a new preview state; no
state was added in this run because nothing required it for the mapped journeys):

| Journey | What is missing | Consequence for this review |
|---|---|---|
| EDIT-12 / EDIT-13 | Duplicate/Delete row context menu + confirmation | Structural edits unproven in preview; host only |
| EDIT-16 / EDIT-17 | Read-only file, CDATA-backed value | Two refusal surfaces have no visual evidence |
| EDIT-19 | A statically folded container and the folded-diff margin dot | `diff-collapsed` folds then expands, so the final PNG is expanded |
| EDIT-23 | Conditions tab (Add/Save/Cancel/Clear/invalid name) | Only `editor-syscond`'s condition field is seeded |
| EDIT-24 / EDIT-25 | Jump to target, Find references Quick Pick, the three reveal modes | Navigation confirmations and focus placement unproven |
| EDIT-28 | Sidebar hidden / full-width Document | Toggle's "off" layout not captured |
| DIFF-02 | `Loading comparison…` | Anti-flash loading state not captured |
| DIFF-04 | Show diff with hidden unchanged regions + Context off | The primary review mode and its native hidden-region rows are never captured (only Show all is) |
| DIFF-08 | Semantic→Strict pending spinner/status | `aria-busy` transition not captured |
| DIFF-14 / DIFF-15 / DIFF-17 | Identical files, side stops being ECUC, refresh error | Empty/notice states not captured |
| MERGE-06 / MERGE-07 | Module-collision refusal, stale-snapshot modal | Two safety-critical refusals not captured |
| FIRST-03 | Empty / malformed ECUC file | The gate's first-run state has no state |
| A11Y-03 / A11Y-04 / A11Y-06 | Light, high-contrast and reduced-motion | The preview seeds dark tokens only; host check required |
| INDEX / ENGINE / SET | Status bar, Problems, settings, engine | Not webview surfaces; host only |

No test-only preview state was added: the mapping above is adequate for Phase 2, and the
remaining gaps are exactly the journeys the host pass must cover.

## Deep discovery additions

The second pass adds host evidence for paths the first pass marked `N/A` or preview-only. Where a
row below conflicts with the matrix above, the host result wins.

| Journey | Deep verdict | Evidence |
|---|---|---|
| EDIT-05 / EDIT-10 invalid/rename refusal | **finding UX-01**, four channels host-confirmed; invalid draft not written | `driver-report-deep-all.json` → `edit-invalid` |
| EDIT-06 Details-first save | pass; one save, Details keeps focus/caret, dirty clears | `edit-details-save` |
| EDIT-08 multi-field save | pass; one `Ctrl+S` writes both, values stay visible | `edit-multi-save` |
| EDIT-24 row menu / duplicate / delete | menu + prompt work; native delete confirmation not observable over CDP, not scored | `row-menu` |
| EDIT-25 reveal modes | `beside`/`focus` pass; `replace` leaves the ECUC tab open — **UX-15** | `reveal-modes` |
| EDIT-28 Conditions tab | open/save/invalid/clear pass | `conditions-tab` |
| DIFF-06 Collapse All | pass; the preview flake did not reproduce | `diff-collapse-all` |
| DIFF-07 Swap / Show diff / Context | pass; Show diff hides rows, Context enables/disables correctly | `diff-showdiff-swap` |
| DIFF-14 identical files | pass; stated empty result | `diff-identical` |
| DIFF-15 side stops being ECUC | **finding UX-12**; stale copy | `diff-side-not-ecuc` |
| MERGE-06 module collision | **finding UX-13**; vague refusal | `merge-collision` |
| MERGE subtree / merge off | pass | `merge-subtree`, `merge-off` |
| INDEX-03/09 size cap/exclude/encoding | **finding UX-14**; skip reason vague | `index-toggles` |
| ENGINE restart | pass; process replaced | `engine-restart` |
| SET sort | pass; live re-order | `settings-sort` |
| A11Y-04 light | **finding UX-10**; toolbar labels 3.1:1 | `theme-zoom` |
| FIRST-03 empty/malformed/non-ECUC | **finding UX-11**; copy promises a text editor that never opens | `first-gate` |


Preview PNGs are 1 CSS px : 1 image px (DPR 1) at the requested state size; the page's audit
reports `window.innerWidth × innerHeight = (width − 16) × 805`. All 43 audits were read first and
carry `violations: []`, `overlaps: []`, `outside: []`, `clipped: []`, `pageOverflow: false`
after one retry of `diff-collapse-all` (first capture reported two Collapse All violations;
the retry was clean). Full table, commands and the state→journey map: `research/evidence.md`.

