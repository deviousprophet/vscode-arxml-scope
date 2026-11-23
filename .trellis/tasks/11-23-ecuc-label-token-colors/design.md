# Design — label and short-name token colors

## 1. Current tokenizer flow

`src/webview/monaco/tokens.ts` `tokenizeEcucLine`:

1. Skips leading whitespace; handles comments and brace-only lines.
2. Handles `schema`/`package` headers.
3. Sets `labelType = 'type'` (or `'variable'` after `module `).
4. `labelEnd` scans the first word up to a space followed by `=`, `"`, `(`, `[`, `<`, `@`, `{`
   or `context`.
5. If the label is non-empty, pushes `variable` when the line contains ` = `, else `labelType`.
6. The remaining loop handles `=`, quoted strings, `@`, conditions, `<...>`, braces, `context`
   and words.

For a container with an empty `definitionRef`, `row.label` is `''` and the synthetic line starts
with the quoted short name:

```text
    "EmptyDef" { }
```

`labelEnd` starts at the quote and scans through the closing quote (the next space is followed by
`{`), so the whole `"EmptyDef"` becomes one `type` token. The loop never sees a leading `"` and
never emits `string`.

## 2. Fix

Before the label logic, detect a leading quote at the first non-space character:

```ts
if (text[at] === '"') {
    const close = quotedEnd(text, at);
    push(at, close, 'string');
    at = close;
} else {
    // existing module/label logic
}
```

Then the existing while loop handles the rest (`{ }`, conditions, annotations, etc.). This is
content-based, not id/path-based, and only changes a line that has no definition label.

## 3. Expected token matrix

| Synthetic line | Expected tokens |
|---|---|
| `"EmptyDef" { }` | `string`, `delimiter` |
| `SharedContainerDef "MissingDefOnRight" { }` | `type`, `string`, `delimiter` |
| `module P.Syn "Syn"` | `keyword`, `variable`, `string` |
| `Label = 42` | `variable`, `operator`, `number` |
| `Label = "text"` | `variable`, `operator`, `string` |
| `Next = P.Syn.Target` | `variable`, `operator`, function/reference color |
| `Condition = 1 [(CANIPCORETYPE_SC==0)]` | `variable`, `operator`, `number`, `delimiter`, syscond tokens, `delimiter` |
| `/* comment */` | `comment` |
| `@annotation` | `comment` |
| `schema 00048` | `keyword`, `number` |
| `package P.Syn` | `keyword`, `namespace` |
| `context Pkg/Path` | `keyword`, `variable` |
| `Label = true` | `variable`, `operator`, `keyword` (boolean) |
| `Label = ""` | `variable`, `operator`, `string` |
| `Label = "a\"b"` | `variable`, `operator`, `string` with escape |
| `"" { }` | `string`, `delimiter` |
| `EmptyLabel "Short" { }` | `type`, `string`, `delimiter` |

The test should assert exact start/length/type, not only colors.

## 4. DOM/tree renderer

The legacy tree writes `row.label` and the `short` meta part separately; an empty label produces
only the quoted short-name span with class `short` (string). Add/verify a jsdom row test so the
tree does not regress. The Monaco page has no Document tree; the legacy `editorViewer` page is
covered by the shared CSS and row tests.

## 5. Preview

Add `editor-labels`:

- a small fixture with a module, a normal container, a no-label container (`EmptyDef`-like) and
  a parameter;
- select the no-label container so Details is populated;
- audit the line text and the first token's computed color (string color), plus a normal
  container's label/short-name colors;
- screenshot the state.

The local `sample_edge.arxml` is the manual check, not a committed fixture.

## 6. Compatibility / risks

- No protocol or data change; tokenizer only.
- The leading-quote branch is safe because synthetic lines with a definition label start with
  the label word; a leading quote can only be the short-name meta.
- Quoted values always follow ` = `, so they remain in the loop's string branch.
- Empty short names `""` remain string tokens.
- The diff view reuses `tokenizeEcucLine`; no separate fix.
- Rollback: revert the branch, tests, preview state.

## 7. Tests / gates

- Token matrix unit test (all rows above).
- Synthetic line test for a no-label container (text + field span).
- DOM row test for the tree.
- `editor-labels` preview/audit.
- Full `npm test --ignore-scripts`, `check-types`, `lint`, `shots:webview`, production build.
- Manual `sample_edge.arxml` check for `EmptyDef`, `MissingDef`, `MissingDefOnRight`, a normal
  container, a parameter and a module.
