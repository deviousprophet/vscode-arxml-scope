# Design — collapsed diff row parity

## Root cause

`buildSyntheticDocument` records the owning node line as the fold start:

```ts
state.openBraceLines.set(row.id, line); // line of the node row
```

`buildDiffSyntheticDocuments` currently returns the opening brace line:

```ts
const startLine = build[sideName].text.length + 1;
emitSideLine(build[sideName], `${indent(row.level)}{`, row.key);
```

Monaco folds from that start, so the node header stays outside the fold and the collapsed widget sits on `{`. Sticky scroll also reads the fold start, so it renders `{`.

## Fix shape

`walkSideRow` already sets `rowLine` for the node. `openSideBlock` should take the node line from `build[side].rowLine.get(row.key)` as its start, then emit the brace lines only for content. `closeSideBlock` keeps the range end on the closing brace.

This makes both collapsing and sticky headers use the node line. Empty containers have no block and no fold range, same as the editor.

## Tests

- Extend `src/test/webview/syntheticDocument.test.ts` to assert every diff fold range start equals `rowLine` for its key, for normal and one-sided documents.
- Add a `diff-collapsed` preview state that folds the `Items` container and records the visible first line and fold-hint text.
- Audit fails when the visible collapsed line is only `{` or the fold start has no row key.

## Rollback

Revert the child commit; fold ranges return to brace starts.
