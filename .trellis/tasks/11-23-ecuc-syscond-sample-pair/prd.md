# ECUC syscond palette and two-file sample pair

## Goal

Make system-condition expressions read like C macro/preprocessor code across every ECUC surface,
and replace the manual sample suite with exactly two large ARXML files plus a README:

- `sample_edge.arxml` — a large single-file edge-case document;
- `sample_diff.arxml` — a same-scale variant for the diff view, covering every diff case when
  compared with `sample_edge.arxml`.

## Source requirements

- Use the C macro/preprocessor color for system-condition names/references:
  - Dark+ `#569CD6`, Light+ `#0000FF`.
- Give syscond operators and literals distinct colors so the expression does not read as one blue
  run:
  - operators `#C586C0` dark / `#AF00DB` light;
  - literals `#4FC1FF` dark / `#0070C1` light;
  - numbers, strings and punctuation keep their current colors.
- Apply the palette to every surface, not only the Monaco condition expression:
  - the Document tree condition chip;
  - the Details `Condition` and `Conditions` rows;
  - the Conditions panel where it shows condition names/states;
  - the diff view if it shares the same tokenizer.
- Fix the underlying CSS gap: the `.syscond-*` rules currently live only in
  `documentTree.css`, so the Monaco page's Details condition code is uncolored. Move the token
  rules into a shared stylesheet loaded by both pages.
- The sample folder `D:\workspace\sample\arxml` must end with exactly three files:
  `sample_edge.arxml`, `sample_diff.arxml`, `README.md`.
- Remove the old suite: `sample.arxml`, `sample_backup.arxml`, `edge-single.arxml`,
  `edge-defs.arxml`, `edge-diff-left.arxml`, `edge-diff-right.arxml`.
- Both ARXML files must be large (at least the current `sample.arxml` scale, ~1.3 MB / 17k lines;
  target 2 MB+), self-contained, deterministic, and valid for the ECUC editor and diff view.
- `sample_edge.arxml` carries the definition bodies so Details resolves types, ranges, defaults,
  descriptions and multiplicity without a third file.
- `sample_diff.arxml` is a variant of `sample_edge.arxml` and exercises all diff cases, including
  changes near the top, middle and end of a large document.
- Generate with a deterministic **local-only** script outside the repository (not committed, not a
  package script or repo test) and add a README that maps each edge case to what to try.

## Task map

- `.trellis/tasks/11-23-ecuc-syscond-colors` — palette, shared token CSS, Monaco/tree/Details/
  Conditions/panel surfaces, preview state.
- `.trellis/tasks/11-23-ecuc-label-token-colors` — audit every synthetic row shape; fix the
  leading quoted short name being classified as a definition label.
- `.trellis/tasks/11-23-ecuc-diff-one-sided` — keep braces/placeholder fills on the side that
  owns a one-sided diff row; add a semantic diff capture/audit.
- `.trellis/tasks/11-23-ecuc-sample-pair` — local-only `sample_edge.arxml`,
  `sample_diff.arxml`, README, generator/verifier outside the repository. This child creates no
  repo scripts, fixtures, tests or package-script changes; only its task artifacts are tracked.

The palette child is the repository change. The sample pair is generated inline/local and is
verified by folder contents, sizes, XML/scanner/diff checks and manual editor/diff opens. The
sample pair can be generated first so the palette child can use it for screenshots.

## Cross-deliverable acceptance

- [ ] The palette is visible in dark, light and high-contrast themes on every condition surface.
- [ ] Every synthetic row shape uses the correct token color: no-label short names are string,
      definition labels keep the label color, and parameters/references/conditions stay correct.
- [ ] One-sided diff containers/modules have no fake braces or green placeholder on the missing
      side; the diff preview audit checks the actual aligned lines.
- [ ] The Monaco page's Details condition code is colored by the shared `.syscond-*` rules.
- [ ] The sample folder contains exactly `sample_edge.arxml`, `sample_diff.arxml`, `README.md`.
- [ ] The sample generator/verifier and generated ARXML files are local-only; the repository has
      no sample script, fixture, test or package-script change.
- [ ] The sample generator/verifier and generated ARXML files are local-only; the repository has
      no sample script, fixture, test or package-script change.
- [ ] Both ARXML files are large, valid and deterministic; `sample_edge` includes every
      single-file edge case; `sample_diff` exercises every diff case against it.
- [ ] The diff view handles the large pair without errors and shows the expected changed,
      renamed, added and removed rows near the top, middle and end.
- [ ] `npm run check-types`, `npm run lint`, focused/full tests, the preview audit and the
      production bundle pass.
- [ ] The generated README and the task result describe the exact coverage and any residual
      limitation.

## Non-goals

- No change to the ECUC value semantics, host protocol or index behavior.
- No new persisted index/cache or runtime dependency.
- No third sample file for definitions; they are embedded in `sample_edge.arxml`.
