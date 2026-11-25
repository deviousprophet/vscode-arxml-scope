# Match collapsed diff rows to the ECUC editor

## Goal

A collapsed container or module in the diff keeps its full node header visible and folds the same lines the ECUC editor folds, instead of leaving only the opening brace visible.

## Requirements

- Every diff-side fold range starts on the owning node line, matching `buildSyntheticDocument`.
- The opening and closing brace lines remain inside the folded range.
- Collapsing a module or container leaves its full synthetic node line visible with Monaco's fold hint.
- One-sided and swapped documents keep the same contract.
- No change to the visible text when nothing is folded.

## Acceptance criteria

- [ ] Every container/module fold range on both diff sides starts on a line whose key is the owning row key.
- [ ] A unit test asserts fold start lines for normal, one-sided and empty containers.
- [ ] The collapsed preview state shows the full node header, not only `{`.
- [ ] The ECUC editor and diff use the same fold start for the same container.
- [ ] Existing folding ranges, editor folding and Collapse All/Expand All still pass.

## Non-goals

- Replacing Monaco folding.
- Custom collapsed rendering or a second text layer.
- Changing the row builder or visible content.
