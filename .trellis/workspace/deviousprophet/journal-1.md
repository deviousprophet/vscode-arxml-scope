# Journal - deviousprophet (Part 1)

> AI development session journal
> Started: 2026-10-27

---



## Session 1: ECUC visual preview, samples and semantic colours
<!-- trellis-session: v=2 fp=96ad8671fa56090c -->

**Date**: 2026-10-27
**Task**: ECUC visual preview, samples and semantic colours
**Branch**: `feat/arxml-scope`

### Summary

Browser preview harness, details inspector, semantic element colours, synthetic 4k/12k samples and benchmark, plus the code-review fixes.

### Main Changes

- Preview harness and details inspector
- Semantic colours and selected-row contrast
- Synthetic large samples and renderer benchmark
- Code-review fixes and test isolation

### Git Commits

| Hash | Message |
|------|---------|
| `1dc1cd9` | feat(editor): add a visual preview harness and details inspector |
| `d8f25fa` | feat(editor): colour ECUC elements by their ARTEXT scope |
| `f3fcc26` | feat(dev): generate ECUC samples and benchmark the renderer |
| `84f4aa7` | fix(editor): keep value kinds and selected markers legible |
| `66e0a41` | fix(dev): guard sample output and share the out loader |
| `2bce121` | docs(spec): clarify the inspector data contract |

### Testing

- [OK] 151 passing; preview:check ok
- [OK] 4,001/12,001-node benchmark and browser load observations

### Status

[OK] **Completed**

## Session 2: ECUC document-style viewer redesign

**Date**: 2026-10-27
**Task**: ECUC viewer document-style redesign (archived)
**Branch**: `feat/arxml-scope`

### Summary

Replaced the chip-heavy default tree presentation with a dense, monospace Document view modelled on the post-processed ARTEXT reference, keeping the previous Tree view behind a toolbar toggle and hiding the details inspector by default.

### Main Changes

- Captured the reference by running the remote branch's `Arxml2Artext.cmd` (`mmx`) and applying `postProcessArtextGen`; stored the post-processed `.artext`, scoped HTML mock and README in the task research.
- Document view default: one entity per line, editor monospace, 4-space indentation, braces, inline metadata, no chips/fixed columns/per-row borders.
- Semantic token colours mapped from the reference TextMate scopes to `--vscode-*` variables; module prefix and selected/focused label emphasis.
- View and Details toggles, both persisted through `getState()/setState()`; details hidden on first paint.
- Preview harness `?view=document|tree` seeding, document tests, docs and frontend spec updates.

### Git Commits

| Hash | Message |
|------|---------|
| `2d328df` | feat(editor): make the ECUC document view the default presentation |
| `e95c62f` | chore(task): archive 10-27-ecuc-viewer-document-redesign |

### Testing

- [OK] `npm run check-types`, `npm run lint`
- [OK] 157 passing; `preview:check` ok
- [OK] Document mode: large 609/688 ms load, 54.1 ms filter; huge 1,605/1,833 ms load, 134.1 ms filter
- [OK] Six mutations (default view, row layout, view toggle, inspector default, module prefix, selection emphasis) each failed a test

### Status

[OK] **Completed**
