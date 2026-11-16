# VS Code-style search options and replace

## Goal

Make Find in the ECUC document and diff views behave like the VS Code editor find
widget: the bar is hidden until `Ctrl+F`, exposes case-sensitive, whole-word and
regex toggles, and supports replace in the document view for editable ECUC fields.
The Rust engine owns matching and replacement planning.

## Requirements

### Find widget

- Hidden by default. `Ctrl+F` (and `Cmd+F` on macOS) shows it and focuses the field;
  `Ctrl+H` shows it with the replace row expanded.
- `Escape` closes the widget, clears highlights and returns focus to the tree/list.
- Layout follows VS Code: one compact row with query, option toggles, count,
  previous/next and close; a replace row expands under it with the replacement
  field and `Replace` / `Replace All`.
- Option toggles: `Aa` case sensitive, `ab|` match whole word, `.*` regular
  expression. Each is a toggle with `aria-pressed`, a tooltip and a visible active
  state.
- Count shows `current / total` for occurrence matches, `0 / 0` when nothing matches,
  and an invalid-regex state when the pattern does not compile.
- `Enter` / `Shift+Enter` and `F3` / `Shift+F3` move to the next/previous occurrence.
- The widget no longer occupies toolbar space while closed; the existing toolbar
  actions keep their layout.
- Both the document view and the diff view get the widget and options. The diff
  view has no replace row, matching VS Code's diff editor.

### Search semantics

- Search covers the text the row renderer shows: label, value and each meta chip.
  The document header (schema/packages) stays searchable by the page and is merged
  with engine results.
- Case-insensitive by default; `Aa` makes the match case-sensitive.
- Whole word uses ASCII word characters `[A-Za-z0-9_]`; it applies to literal and
  regex searches.
- Regex uses the Rust `regex` syntax; an invalid pattern is reported, not treated as
  a literal.
- Occurrence order is row order, then field order (label, value, meta), then offset.
- At most 20,000 matches are returned; the result carries `limited` when the cap is
  hit.

### Replace (document view only)

- Replace targets only validated ECUC fields: parameter values and container short
  names. Search can still find text in labels of modules, reference targets, meta
  chips and headers; those matches are marked not replaceable and a replace action
  refuses with an inline notice.
- `Replace` replaces the current occurrence; `Replace All` replaces every
  replaceable occurrence in one atomic engine plan set.
- A preserve-case toggle (`AB↔`) copies the matched text's case style onto the
  replacement, as VS Code does.
- Replacements run through the existing edit planner: every changed field is
  validated, the host applies one `WorkspaceEdit`, and undo/dirty state stay VS
  Code's.
- A replacement that would make an invalid value or short name is refused as a
  whole; nothing is written.
- After a replace, the page re-runs the active search and keeps the nearest match.
- Replace All stops at 500 fields and reports that it stopped; the user can run it
  again.

### Compatibility and limits

- No TypeScript search fallback. If the engine document handle is unavailable, the
  widget shows an error notice and returns no matches.
- The local webview matcher is used only for `<mark>` highlighting; the engine match
  list drives the count, navigation and replace.
- The existing `RowSearchEngine` is removed from both pages; its tests are replaced
  by engine search tests and widget tests.
- Keep the amber `match` / `match-active` tiers from `DESIGN.md`; do not switch to
  theme find colors.
- The diff view uses the same options and count rules but never writes.

## Acceptance criteria

- [ ] `Ctrl+F` opens the widget; before that it is absent from layout and tab order.
- [ ] `Ctrl+H` opens it with the replace row; `Escape` closes it.
- [ ] All three toggles change results and survive reopening the widget in the same
      page session.
- [ ] Invalid regex shows an error state and does not crash or fall back to literal.
- [ ] Document and diff search counts and navigation match the engine result list.
- [ ] Replace updates one value/short-name field and `Replace All` updates every
      replaceable occurrence; module labels, references and meta text refuse.
- [ ] A refused replace writes nothing and shows the reason.
- [ ] Engine search and replacement are covered by Rust tests; widget and page flows
      by webview/extension tests.
- [ ] `npm run check-types`, `npm run lint`, `npm test`, `cargo test`,
      `cargo fmt`, `cargo clippy -D warnings` pass.
- [ ] The PR targets `feat/engine-hardening` until PR #31 merges, then retargets to
      `main`.

## Constraints

- No new dependency beyond the Rust `regex` crate (MIT/Apache-2.0).
- No search or replace logic in the host beyond orchestration and `WorkspaceEdit`.
- Keep the existing engine document and edit-plan contracts additive.
