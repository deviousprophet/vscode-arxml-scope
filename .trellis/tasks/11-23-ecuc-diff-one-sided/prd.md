# Fix one-sided diff placeholders and capture coverage

## Goal

When a container or module exists on only one side of the diff, the missing side must stay blank.
It must not synthesize a fake empty container with `{`/`}` or paint the placeholder as an added
line.

Reported from the local sample pair:

```text
"EmptyDef" { }
"MissingDef" { }
AddedContainerDef "AddedContainer"
{
    Value = added
}
vs
"EmptyDef" { }
"MissingDef" { }
{
}
```

The screenshot also shows a green empty row on the missing side of a removed container.

## Root cause evidence

- `src/core/diff/diffModel.ts` `braceDisplayRow` already sets `left: row.left ? kind : 'blank'`
  and `right: row.right ? kind : 'blank'`.
- `src/webview/monaco/synthetic.ts` `buildAlignedSyntheticDocuments` ignores that and always emits
  `${indent(row.level)}{` and `${indent(row.level)}}` to **both** text arrays.
- The missing side therefore gets a blank node line plus real braces, forming a valid-looking
  empty container.
- Monaco's own line diff sees the blank placeholder against the one-sided node and paints the
  placeholder line as inserted (green).
- The preview diff fixtures have no one-sided container/module, and the audit only checks
  geometry, so the harness reports the state clean.

## Requirements

- `buildAlignedSyntheticDocuments` must emit opening/closing braces only on the side that owns
  the row. The missing side gets blank lines, not braces.
- Keep both text arrays the same length; line alignment, folding, selection, keys, navigation and
  merge arrows must keep working.
- The missing-side placeholder line must not look like an added/removed content line:
  - add a neutral placeholder decoration/class on the side where the cell is absent;
  - override Monaco's inserted/deleted line background for that placeholder;
  - keep the row available for selection/navigation only where a real cell exists, or mark it
    explicitly as a placeholder.
- One-sided modules, containers, parameters and references must not synthesize content on the
  missing side.
- Add a `diff-one-sided` preview state with:
  - a module only on the left, a container only on the left, a module only on the right and a
    container only on the right;
  - an audit that reads the actual aligned models and asserts the missing side has no `{`/`}`
    for those rows, line counts stay equal, and the placeholder line has a neutral fill;
  - a screenshot.
- Verify the local sample pair (`sample_edge.arxml` vs `sample_diff.arxml`) for the removed
  module/container and added container; no sample files or scripts enter the repo.

## Acceptance Criteria

- [ ] A one-sided container renders no braces on the missing side; the block is blank there.
- [ ] A one-sided module renders no module line/braces on the missing side.
- [ ] The missing-side placeholder is neutral, not a green inserted line or red removed line.
- [ ] Both aligned models keep equal line counts and correct folding/selection/keys.
- [ ] The diff navigation and merge arrows still target the real side.
- [ ] `diff-one-sided` captures the actual aligned lines and fails if a fake brace reappears.
- [ ] The local sample pair shows no empty `{ }` block and no green empty placeholder.
- [ ] Full suite, preview audit and production bundle pass.

## Notes

- This is a follow-up to the sample pair and diff work; the sample files are local-only.
- The preview fixture is synthetic; it must not copy the local sample.
