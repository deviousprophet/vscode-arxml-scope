# Parent implementation plan

The parent does not implement product code. It sequences children and runs the integration gate.

## Ordered checklist

- [ ] Start and finish `10-29-filter-clear-single`.
  - Gate: `npm run check-types`, `npm run lint`, `npm test`.
- [ ] Start and finish `10-29-editor-context-submenu`.
  - Gate: manifest tests + existing activation tests.
- [ ] Start and finish `10-29-semantic-diff-view`.
  - Gate: core diff tests, page boot check, integration test, full suite, `npm run package`.
- [ ] Start and finish `10-29-syscond-evaluation`.
  - Gate: evaluator tests, row tests, page tests, full suite, `npm run package`.
- [ ] Integration review from `design.md` §7.
- [ ] Update spec/guidelines with any new invariants learned (row primitives, diff page,
  condition store, submenu).
- [ ] Update `CHANGELOG.md`.
- [ ] Archive the four children, then archive this parent.

## Validation commands

```text
npm run check-types
npm run lint
npm test
npm run package
```

`npm test` runs the compiled tests under the VS Code test host; `npm run package` also runs the
production webview boot gate.

## Review gates

- After child 1: the boot gate must still boot the ECUC page, and all existing render tests must
  pass unchanged in meaning.
- After child 2: the manifest test must prove there is exactly one submenu and no flat reveal entry
  in `editor/context`.
- After child 3: a manual two-file compare must be read-only; confirm no fixture mtime changes.
- After child 4: with an empty value list, no row may be disabled by an unresolved symbol; only a
  literal false expression may disable.

## Rollback points

- Each child is its own commit. Revert the child commit if the full suite regresses.
- The parent has no direct code, so it needs no rollback beyond reverting children.

## Risks

- **Diff scope creep** — resist text diff, merge, Git integration, and editing from the diff.
- **Second renderer drift** — the row-primitive extraction is mandatory; do not duplicate
  `valueSpan` / `metaSpan`.
- **Condition semantics** — three-valued logic and ancestor propagation must be unit-tested before
  wiring the UI.
- **Manifest conflicts** — complete the submenu before adding diff commands.
- **Large files** — the diff page must virtualize; do not render every row.
