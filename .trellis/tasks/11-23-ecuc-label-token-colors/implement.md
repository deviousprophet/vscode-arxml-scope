# Implementation plan — label and short-name token colors

## Phase 0 — Red test

- [ ] Add a failing token-matrix test for `"EmptyDef" { }` and `"MissingDef" { }`; assert the
      leading quoted token is `string`, not `type`.
- [ ] Add a synthetic-line test for a container row with `label: ''`, `definitionRef: ''`,
      `shortName: 'EmptyDef'`; assert the line text and the short-name field span.

## Phase 1 — Tokenizer fix

- [ ] In `tokenizeEcucLine`, before `labelType`/`labelEnd`, handle a first non-space `"` as a
      `string` token using `quotedEnd`; advance `at` past it and let the existing loop handle
      braces/conditions.
- [ ] Keep `module`/label handling unchanged for lines with a definition label.
- [ ] Verify `""` (empty short name) and escaped quotes.

## Phase 2 — Audit matrix

- [ ] Add the full expected-token matrix test: no-label container, normal container, module,
      parameter numeric/text/boolean/empty/escaped, reference, condition, comment, annotation,
      schema/package header, context, braces.
- [ ] Add/verify a DOM row test for the tree: empty label + short meta renders the short name
      with the string class and no label type span.
- [ ] Confirm the Monaco diff tokenizer inherits the fix.

## Phase 3 — Preview

- [ ] Add an `editor-labels` preview fixture with a module, normal container, no-label container
      and parameter; select the no-label container.
- [ ] Add the audit: line text, first token computed color (string), normal container
      label/short-name colors.
- [ ] Add the screenshot/docs row.

## Phase 4 — Manual sample check

- [ ] Open `D:\workspace\sample\arxml\sample_edge.arxml` in the ECUC editor.
- [ ] Verify `EmptyDef`, `MissingDef`, `MissingDefOnRight`, a normal container, a parameter, a
      module and a condition row.
- [ ] Verify the Document tree and Details condition colors.
- [ ] Do not copy the sample or generator into the repo.

## Phase 5 — Verification

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] Focused token/synthetic/row tests
- [ ] `npm test --ignore-scripts`
- [ ] `npm run shots:webview`
- [ ] `node esbuild.js --production`
- [ ] `git diff --check`
- [ ] `git status --short` shows only intended repo changes.

## Review gates

- [ ] `"EmptyDef" { }` and `"MissingDef" { }` use the string color.
- [ ] Normal container label is type, short name is string.
- [ ] Module/parameter/reference/condition/annotation/header colors are unchanged and correct.
- [ ] Empty/escaped quoted short names are string.
- [ ] Tree and diff surfaces agree.
- [ ] No sample/generator/test fixture from the local sample pair entered the repo.
- [ ] Full suite, preview audit and production bundle pass.

## Rollback

- [ ] Revert the leading-quote branch, the tests and the preview state. No data/protocol change.
