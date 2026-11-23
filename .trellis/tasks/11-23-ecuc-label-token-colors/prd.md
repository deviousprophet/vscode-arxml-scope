# Fix ECUC label and short-name token colors

## Goal

Every synthetic ECUC line must use the correct token color for its actual content. A container
with an empty or missing `DEFINITION-REF` currently renders as:

```text
"EmptyDef" { }
"MissingDef" { }
```

The quoted short name is green (the definition/type color), but it is a short name and must use
the string color. Audit every row shape, not just this one.

## Root cause evidence

`sample_edge.arxml` rows `EmptyDef` and `MissingDef` have `label: ''`, `definitionRef: ''` and
`shortName: 'EmptyDef'/'MissingDef'`. `buildSyntheticDocument` emits the quoted short-name meta
as the first token on the line. `tokenizeEcucLine` assumes the first word is the definition
label and emits `type`; it never reaches the quoted-string branch for that leading token.

## Requirements

- A line whose first non-space token is a quoted short name (no definition label) must emit a
  `string` token for the whole quoted text, including its quotes.
- Preserve the correct classification for every other shape:
  - container label + quoted short name → label `type`, short name `string`;
  - module keyword + label + quoted short name → `module` keyword, label `variable`, short name
    `string`;
  - parameter label + value → label `variable`, value numeric/string/boolean/reference;
  - reference label + target → label `variable`, target reference/function color;
  - condition meta → syscond name/operator/literal/number/string/punctuation;
  - braces, annotations, comments, contexts, headers;
  - empty/absent label, empty/absent short name, empty/absent definition ref, empty value,
    quoted values containing quotes/escapes.
- The fix must apply to both the editor and the Monaco diff token provider.
- The Document tree/DOM renderer must keep the same semantic colors; verify it does not have the
  same misclassification.
- Add a token matrix test covering every row shape and an `editor-labels` preview state with a
  no-label container, a normal container, a module and a parameter.
- Use the local `sample_edge.arxml` for a manual visual check; do not commit the sample files or
  add them to the repo.

## Acceptance Criteria

- [ ] `"EmptyDef" { }` and `"MissingDef" { }` render the quoted short name in the string color,
      not green.
- [ ] The token matrix test asserts exact token types for every row shape above.
- [ ] A container with a label still colors the label as `type` and the short name as `string`.
- [ ] Parameters, references, conditions, annotations, braces and headers keep their colors.
- [ ] The Monaco diff view uses the same corrected tokenizer.
- [ ] The Document tree/DOM renderer shows the short name as string and the label as its label
      class.
- [ ] The `editor-labels` preview audit/screenshot is clean and shows the corrected colors.
- [ ] `npm run check-types`, `npm run lint`, focused/full tests, `npm run shots:webview` and the
      production bundle pass.
- [ ] Manual check on `D:\workspace\sample\arxml\sample_edge.arxml` shows correct colors for all
      rows, including `EmptyDef`, `MissingDef`, `MissingDefOnRight` and normal containers.

## Notes

- This is a follow-up to the syscond palette task; the parent is
  `.trellis/tasks/11-23-ecuc-syscond-sample-pair`.
- The local sample pair is manual-test data only; no sample generator, fixture or test may enter
  the repository.
