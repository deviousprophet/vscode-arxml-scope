# Design — one-sided diff placeholders

## 1. Current flow

```text
DiffDocument rows
  └─ buildAlignedSyntheticDocuments()
       ├─ node line: cellLine(row.left), cellLine(row.right)
       ├─ brace-open: `${indent}{` on BOTH sides
       ├─ children
       └─ brace-close: `${indent}}` on BOTH sides
```

`cellLine(undefined, row)` returns an empty text for the missing side, but the braces are hardcoded
on both sides. `braceDisplayRow` in `diffModel.ts` already has the correct side awareness, but the
Monaco adapter does not use it.

Monaco's diff editor then computes its own line changes from the two text models. A blank
placeholder line opposite a one-sided node is seen as an insertion/deletion and receives the
inserted/removed background. That is the green empty row in the screenshot.

## 2. Fix

In `buildAlignedSyntheticDocuments`:

```ts
const leftOpen = row.left !== undefined ? `${indent(row.level)}{` : '';
const rightOpen = row.right !== undefined ? `${indent(row.level)}{` : '';
emit(leftOpen, rightOpen, row.key);
// children...
const leftClose = row.left !== undefined ? `${indent(row.level)}}` : '';
const rightClose = row.right !== undefined ? `${indent(row.level)}}` : '';
emit(leftClose, rightClose, row.key);
```

Folding ranges stay side-specific (`row.left`/`row.right` guards already exist). Both arrays still
receive one line per display row, so line counts and keys stay aligned.

The missing side's node line is already blank. Its brace lines become blank too. Children of a
one-sided container already render blank via `cellLine(undefined)`; no further change is needed
for nested content.

## 3. Neutral placeholder fill

Monaco's line diff still sees a blank line opposite a real line. Add a placeholder decoration on
the missing side in `diffMonaco.ts`:

- iterate `documentModel.rows`;
- if `row.left === undefined` and the row has a right line, add
  `arxml-diff-placeholder` to the modified line;
- if `row.right === undefined` and the row has a left line, add it to the original line;
- add the class only to the **node line**, not the brace/child lines, unless the whole block is
  one-sided (then every blank line of that block may need the neutral class).

CSS:

```css
.monaco-editor .arxml-diff-placeholder {
	background-color: transparent !important;
}
```

Use a z-index/whole-line decoration that outranks Monaco's inserted/deleted line decoration. If
the line-number/gutter still shows the insertion color, add a matching line-number decoration or
accept a neutral blank line; verify in the preview.

Do not remove the real change fill from the side that owns the row.

## 4. Preview and audit

Add a `oneSidedPair` fixture in `previewData.ts`:

- left: module `LeftOnly` + container `LeftOnlyContainer`, plus a shared module/container;
- right: module `RightOnly` + container `RightOnlyContainer`, plus the shared rows;
- enough children/parameters to exercise braces and line alignment.

Add `diff-one-sided` state and audit:

- read both `__ARXML_DIFF_EDITOR__` models (or the aligned documents exposed by the page);
- assert line counts are equal;
- assert the missing side has no `{`/`}` line for the one-sided container/module;
- assert the placeholder line has the neutral class/computed background;
- assert the real side still has the node line and braces;
- assert the diff still has the expected added/removed line changes and navigation;
- screenshot.

The audit must fail on the current bug: the missing side contains `{`/`}` today. Do not make the
audit only check geometry.

## 5. Manual sample check

Open `D:\workspace\sample\arxml\sample_edge.arxml` vs `sample_diff.arxml`:

- `RemovedMod` and `SharedContainerDef "Inner"` (left-only);
- `AddedContainer`/`DiffExtraMod` (right-only);
- `RenamedModOld`/`RenamedModNew`;
- `EmptyDef`/`MissingDef` (unchanged).
Verify no fake `{ }` on the missing side and no green empty placeholder. Keep the sample files
local; do not commit them.

## 6. Risks / compatibility

- Folding ranges: only add a range for the side that owns the row (already).
- Selection/keys: the missing side's blank line still has the row key; selection may tint it.
  Either mark it as placeholder or skip selection decoration on the missing side. Keep merge
  arrows on the real side.
- Monaco line changes: a blank placeholder can still be classified as inserted; the placeholder
  class must override the background. If the gutter remains colored, document it or add a
  line-number decoration.
- No protocol/data change; diff adapter and preview only.
- Rollback: revert the brace guards, placeholder class, fixture/state/audit.

## 7. Tests / gates

- `buildAlignedSyntheticDocuments` unit test for a one-sided container/module: no braces on the
  missing side, equal line counts, side-specific folding.
- Diff preview audit as above.
- Full `npm test --ignore-scripts`, `check-types`, `lint`, `shots:webview`, production build.
- Manual local sample check.
