# Search options and replace — technical design

## Boundaries

- `arxml-core::search` owns option matching, row-field selection and replacement
  planning. It has no Node or VS Code dependency.
- `arxml-engine` exposes `doc.search`, `doc.replace` and `diff.search`; it keeps the
  same document handles, row store and last diff baseline it already has.
- Host providers only forward messages, translate error states and apply the one
  `WorkspaceEdit` the engine planned.
- Webview owns the widget DOM, focus, request ids and `<mark>` rendering. It does not
  decide which rows match; the engine result list does.

## Engine search model

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub row_id: String,
    pub field: SearchField, // "label" | "value" | "meta"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part: Option<usize>,
    pub start: usize, // UTF-16, inside that field's text
    pub end: usize,
    pub replaceable: bool,
}
```

`search_rows(rows, query, options)` builds a matcher once:

- Literal: `regex::escape(query)`; `case_insensitive(!options.case_sensitive)`.
- Regex: the user pattern; invalid -> `SearchError::InvalidPattern(message)`.
- Whole word: after every match, reject when the char before/after is ASCII
  `[A-Za-z0-9_]`.
- Matches are non-overlapping and ordered by row, field order, then offset.
- Cap: `MAX_SEARCH_MATCHES = 20_000`; the result sets `limited`.

Fields per row mirror what the renderer shows:

| Field | Text | Replaceable |
|-------|------|-------------|
| `label` | `row.label` | container only, via `shortName` |
| `value` | `row.shown_value` when present, else `row.value` | parameter only, and only when shown text equals raw value |
| `meta` | each `row.meta[i].text` | never |

`replaceable` is true only when the raw editable text equals the searched text, so
a match offset is always valid in the field the planner edits. Numeric formatting
that changes the text makes the match search-only.

## Replacement plan

`doc.replace` request:

```json
{"docId": 3, "query": "Foo", "options": {...}, "replacement": "Bar",
 "preserveCase": true, "all": false,
 "match": {"rowId": "...", "field": "value", "start": 10, "end": 13}}
```

- The engine re-runs the search against the current rows.
- `all=false`: select the exact match; `all=true`: every replaceable match.
- Group by `(rowId, field)`. For each group:
  - `label`: `edit::plan_field_edit(..., "shortName", newText)`
  - `value`: `edit::plan_value_edit(..., newValue)`
- `preserveCase` copies the matched text's case style (all lower, all upper, title)
  onto the replacement, as VS Code does.
- Any refusal (invalid value, stale range, non-container label) returns
  `{ok:false, reason}` and no plans; nothing is written.
- Success returns
  `{ok:true, plans:[{record:{nodeId,range,oldText,newText},...}], replacedFields, replacedOccurrences}`.
- `all=true` stops after 500 fields and sets `stopped:true`.

Host sorts plans by `range.start` descending, applies one `vscode.WorkspaceEdit`, and
lets the normal document-change path update the engine. No other write path is
added.

## Protocol additions

| Operation | Request | Answer |
|-----------|---------|--------|
| `doc.search` | `{docId, query, options}` | body `{matches, total, limited}`; `code:"invalid_regex"` on a bad pattern |
| `doc.replace` | replace request above | body `{ok, plans?, reason?, replacedFields, replacedOccurrences, stopped}` |
| `diff.search` | `{left:{docId}, right:{docId}, query, options, changesOnly}` | body `{matches:[{key, field, part?, start, end}], total, limited}` |

`diff.search` uses `last_diff`; a missing or stale baseline answers
`code:"no-baseline"`. Rows excluded by `changesOnly` are not searched. Diff matches
are search-only.

All operations are additive; protocol stays `1`.

## Webview find widget

Markup (`searchBar.ts`) becomes a floating `div.find-widget[hidden]`:

```
find-row:    [replace toggle] [query] [Aa] [ab|] [.*] [count] [prev] [next] [close]
replace-row: [replacement] [AB↔] [Replace] [Replace All]
```

- `.find-widget` is `position: fixed; top: 60px; right: 18px; z-index` above the
  content; it does not reserve toolbar space.
- `show(expandReplace)`, `hide()`, `isVisible()`, `options()`, `setOptions()`,
  `setReplaceValue()`, `setCount()`, `setBusy()`, `setInvalid()`.
- Toolbar keeps only its existing actions; the shell appends the find widget after
  the toolbar. `renderEditorToolbarHtml`/`renderDiffToolbarHtml` no longer take
  search HTML.
- `Ctrl+F` calls `show(false)`, `Ctrl+H` calls `show(true)`, `Escape` and the close
  button call `hide()` and clear the active search.
- Toggle buttons write `aria-pressed`; CSS uses `[aria-pressed="true"]` for the
  active state.
- Count is inside the widget; no count/arrow space is reserved in the toolbar.

### Page search flow

Editor and diff keep a generation id. On input/options change:

1. Increment `searchGeneration`; show busy.
2. Post `{type:'find', requestId, query, options, changesOnly?}`.
3. On `findResult` with the current id, install the match list, map `rowId`/`key` to
   the page candidate index, keep the nearest previous row, then jump.
4. `setHighlightQuery(query, options)` so visible rows mark the same fields locally.
5. Ignore stale results and stale errors.

Header (schema/packages) matches are computed in the page with the same matcher and
prepended to the engine list; the engine does not own header text.

Replace:

1. `replace` posts `{type:'replace', requestId, query, options, replacement,
   preserveCase, all, match?}`.
2. Host calls `engine.replaceDocument`, applies the plans, posts
   `{type:'replaceResult', requestId, ok, replacedFields, reason?}`.
3. Page shows an inline notice on refusal; on success re-runs the active search and
   keeps the nearest row.

## Matcher parity

`src/webview/render/searchPattern.ts` implements the same literal/whole-word/regex
matcher for highlighting (and header text). The Rust and TS matchers share a test
corpus: options, escaped literals, regex, whole word, empty query and invalid regex.
A `parity:search` script compares them over generated row fields; adding it to CI is
part of the task if the runtime stays small.

## Failure and edge cases

- Empty/whitespace query: no request, empty count, no marks.
- Invalid regex: engine returns `invalid_regex`; widget shows the input in error
  state and count `Invalid pattern`; no matches.
- Engine unavailable: page shows `Search unavailable: <reason>` as a notice, count
  `0 / 0`; no local fallback.
- Replace with no replaceable current match: notice, no write.
- Replace All with more than 500 fields: applies 500, reports stopped.
- Document edit while a search is in flight: generation increment on document
  message; stale results dropped.
- Collapsed rows remain searchable and a jump expands ancestors, as today.
- Diff view changesOnly filters rows; collapsed rows still navigate.

## Rollout

One branch stacked on `feat/engine-hardening`, PR base `feat/engine-hardening`,
retarget to `main` after #31 merges. Commits: engine search core, protocol + host,
widget + editor, diff, tests/docs. Revert points are the engine module, the protocol
ops, then the widget; the old local `RowSearchEngine` is deleted only after both
pages use engine results.
