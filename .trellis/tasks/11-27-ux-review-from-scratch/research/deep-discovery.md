# Deep discovery — second pass

Status: complete. The first pass produced UX-01…UX-09; this pass added UX-10…UX-15 and took the
host from 14 to 21 scenarios (`driver-report-deep-all.json`).

## Paths exercised

| Path | Method | Result |
|---|---|---|
| Invalid value + blocked save | Host `edit-invalid` | Four feedback channels confirmed; UX-01 |
| Details-first save / multi-field save | Host `edit-details-save`, `edit-multi-save` | Pass: one save, focus/caret kept, values visible |
| Row context menu | Host `row-menu` | Menu opens; Delete/Duplicate confirmation probe failed to observe native dialogs; not scored |
| Conditions tab | Host `conditions-tab` | Open/save/invalid/clear pass |
| Reveal in source (beside/focus/replace) | Host `reveal-modes` | `replace` leaves the ECUC tab open; UX-15 |
| Find/replace | Host `find-replace` | Native widget opens; count `? of 1`; UX-09 |
| Settings sort | Host `settings-sort` | Live re-order pass |
| Diff Collapse All / Swap / Show diff / Context | Host `diff-collapse-all`, `diff-showdiff-swap` | Pass |
| Identical files | Host `diff-identical` | Stated empty result pass |
| Side stops being ECUC | Host `diff-side-not-ecuc` | Stale comparison explained with the wrong copy; UX-12 |
| Merge collision / subtree / merge off | Host `merge-collision`, `merge-subtree`, `merge-off` | Collision copy vague; UX-13 |
| Index toggles / size cap / exclude / cycle | Host `index-toggles` | Skip reason vague; UX-14 |
| Engine restart | Host `engine-restart` | Process replaced; pass |
| Light / HC / 150% zoom | Host `theme-zoom` | Light toolbar labels 3.1:1; UX-10 |
| Empty/malformed/non-ECUC gate | Host `first-gate` | Copy promises a text editor that never opens; UX-11 |

## New findings

| ID | Severity | Gate | Finding |
|---|---|---|---|
| UX-10 | Major | Floor — contrast | Light-theme toolbar labels ~3.1:1 |
| UX-11 | Minor | Reflex — truthful copy | Gate warning promises a text editor that never opens |
| UX-12 | Minor | Reflex — truthful copy | Diff reuses gate copy when a side stops being ECUC |
| UX-13 | Minor | Reflex — recovery | Module-missing refusal names neither the module nor a way to it |
| UX-14 | Minor | Finish — specific copy | Skipped-file tooltip gives three alternative reasons |
| UX-15 | Minor | Reflex — duplicate state | `replace` reveal leaves the ECUC tab open |

## Remaining gaps

- Native Delete/Duplicate confirmation could not be observed over CDP (`row-menu`); the menu and
  prompt appear, but no dialog was captured. Not scored.
- Native find inputs sit in a closed shadow root; the widget text is readable, the input is not.
- Stale-snapshot Reload/Cancel still does not reproduce deterministically.
- Screen-reader output, reduced motion, VSIX packaging and multi-root workspaces remain unrun.
- 80% element screenshots mis-clip; workbench captures are used for width/zoom claims.

## Evidence

- `research/evidence/host/driver-report-deep-all.json`
- `research/evidence/host/deep-*.png` (conditions, diff, edit, engine, first gate, index, merge,
  reveal, row menu, settings, themes)
- Findings: `research/findings/UX-10…UX-15`
- Report: `research/UX_REVIEW.md`
