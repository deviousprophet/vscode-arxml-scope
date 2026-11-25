# Design — diff sticky-header parity

## Root cause

`createEcucEditor` sets:

```ts
folding: true,
showFoldingControls: 'mouseover',
stickyScroll: { enabled: true, defaultModel: 'foldingProviderModel' }
```

The diff editor leaves the inner editors on Monaco's defaults. `stickyScroll` defaults to `outlineModel`, and the diff's fold ranges currently start on the brace line, so the sticky widget shows `{`.

## Fix shape

After creating the diff editor, update both inner editors with the editor parity options:

```ts
{
  folding: true,
  showFoldingControls: 'mouseover',
  stickyScroll: { enabled: true, defaultModel: 'foldingProviderModel' },
  guides: { indentation: true, bracketPairs: false, highlightActiveBracketPair: true }
}
```

Rely on `11-25-diff-collapsed-row-parity` for node-start fold ranges; without it the sticky provider still sees the brace line.

## Test shape

- Extend the `diff-sticky` preview state with a deep `scrollLine` on the modified editor.
- Record `.sticky-widget` text, visibility, line count and the source fold start.
- Compare it with the editor sticky text for the same container row.
- Audit fails when the text is only `{`, empty or references a line without a row key.

## Rollback

Revert the child commit; sticky scroll returns to the Monaco default.
