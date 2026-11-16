# Search options and replace — implementation plan

## Order

1. **Engine matcher** — add `arxml-core/src/search.rs`, `regex` dependency, options,
   field selection, replacement planning, tests. No protocol yet.
2. **Protocol** — `doc.search`, `doc.replace`, `diff.search` in `main.rs`;
   `CoreEngine` types/methods; supervisor translation; engine smoke/parity.
3. **Host wiring** — editor `find`/`replace` handlers; diff `find`; error and
   `WorkspaceEdit` application; replace atomically.
4. **Widget** — rewrite `searchBar.ts`/CSS; move it out of the toolbars; add
   `Ctrl+F`/`Ctrl+H`/`Escape`; options, count, replace row.
5. **Editor page** — engine requests, generation guard, header merge, replace
   actions, highlight options.
6. **Diff page** — engine requests, changesOnly, header merge, options; no replace.
7. **Remove local search** — delete `RowSearchEngine` usage and module/tests that no
   longer apply; keep only the shared matcher.
8. **Docs/design** — update `DESIGN.md`, `docs/ECUC_EDITOR.md`, `docs/DIFF.md`,
   `.trellis/spec/frontend/editor-lifecycle.md` and the capability list.
9. **Verification** — full gates, review, changelog, PR.

## Contracts to add

```ts
export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface FindMatch {
  rowId: string;
  field: 'label' | 'value' | 'meta';
  part?: number;
  start: number;
  end: number;
  replaceable: boolean;
}
```

Diff result uses `key` instead of `rowId`; both use UTF-16 offsets inside the field.

## Validation commands

```bash
cargo test --manifest-path rust/Cargo.toml --workspace
cargo fmt --manifest-path rust/Cargo.toml --all -- --check
cargo clippy --manifest-path rust/Cargo.toml --workspace --all-targets -- -D warnings
npm run check-types
npm run lint
npm run engine:build
npm run engine:smoke
npm run parity
npm run parity:rows
npm run parity:diff
npm run parity:words
npm run parity:copy
npm test
```

## Review gates

- Engine: literal/case/whole-word/regex and invalid pattern tests; replace plans are
  atomic, preserve case and refuse read-only fields.
- Protocol: `doc.search`/`doc.replace`/`diff.search` tests at the engine boundary.
- Widget: hidden by default, `Ctrl+F`/`Ctrl+H`, Escape, toggles, count, focus, tab
  order, replace row.
- Editor: search over rows and headers; jump expands ancestors; replace one/all;
  refusal writes nothing; re-search after edit.
- Diff: options, changesOnly, navigation, no replace row and no write.
- Visual: `npm run shots:webview` plus the audit checklist in
  `docs/WEBVIEW_PREVIEW.md`; screenshots in the PR body.

## Rollback

- Revert the engine module/protocol first if the host contract is wrong; pages still
  compile only if the widget commit is also reverted.
- Keep the old `RowSearchEngine` deleted in a separate commit so restoring local
  search is a single revert while the engine path is validated.
- No file format or persisted state changes, so rollback is source-only.

## Out of scope

- Raw XML search/replace.
- Replace in the diff pane; merged-side write rules stay copy-only.
- Search in files/workspace across many documents.
- Replace through conditions, comments, references or definition refs.

## Results

- Engine: `search.rs` with literal/case/whole-word/regex matching, row-field
  occurrences, `doc.replace` plans with preserve case and atomic refusal, and
  `diff.search`. Rust unit tests cover options, invalid patterns, replaceability,
  preserve case and diff sides.
- Protocol: `doc.search`, `doc.replace`, `diff.search`; `invalid_regex`,
  `no_baseline` and `too_large` codes; engine smoke exercises search and diff search.
- Host: editor find/replace handlers wait for the in-flight engine document, apply
  all replace plans in one `WorkspaceEdit`, and post typed results; diff panel
  forwards find.
- Widget: floating VS Code-style find widget hidden until `Ctrl+F`; `Ctrl+H` opens
  replace, `Escape` closes; `Aa`, `ab|`, `.*`, count, previous/next, close, replace
  row, preserve case, Replace and Replace All. The diff widget has no replace row.
- Pages: engine result lists drive count/navigation; local matcher only marks text
  and header rows; stale answers are generation-guarded; document patches re-run
  the active query. `RowSearchEngine` and its tests are removed.
- Gates: 932 extension-host tests, 65 Rust tests, `check-types`, `lint`, `cargo fmt`,
  `cargo clippy -D warnings`, `engine:build`, `engine:smoke`, all parity scripts.
- Fallow: complexity is down to 4 test/one-key-handler items and one shared input
  style duplication; dead code 0. Not claimed green.
