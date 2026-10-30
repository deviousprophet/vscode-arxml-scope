# Parent design: integration shape

This file records the boundaries shared by the four child tasks. Child-specific technical design
lives in each child's `design.md` where the task is complex.

## 1. Layer map

```
src/core/ecuc/*            pure text/model logic, no vscode import
  scanner.ts               existing model scan
  model.ts                 existing model types
  syscond.ts               NEW: parse + evaluate SW-SYSCOND (child 4)

src/editor/*               host-side editor helpers, no DOM
  renderRows.ts            EcucRow builder; gains condition state (child 4)
  renderHtml.ts            ECUC page; shares row primitives (child 1 refactor)
  rowView.ts               NEW: serialized page row primitives (child 1 refactor)
  ecucEditorProvider.ts    host panel; gains condition store (child 4)
  navigation.ts            existing reveal helper; reused by diff

src/diff/*                 NEW: diff host + page (child 1)
  diffModel.ts             pure row diff over EcucRow[]; no vscode
  diffPage.ts              HTML + serialized page script
  diffPanel.ts             WebviewPanel lifecycle + document refresh
  compareSelection.ts      session-only first-file stash
  diffCommands.ts          command handlers (or commands.ts extension)

scripts/check-webview-boot.cjs   packaging gate; boots every generated page
```

Dependency rule: `src/core/**` never imports `vscode`; `src/editor/**` and `src/diff/**` may import
`vscode` on the host side. Pure modules that are serialized into a page must not use Node or
`vscode` APIs.

## 2. Shared contracts

### `EcucRow` remains the unit of display

Both the ECUC editor and the diff compare `EcucRow` values from `buildRows`. The diff does not
re-implement labels, values, types, formatting or meta. Child 1 extracts the page-side primitives
(`appendHighlighted`, `valueSpan`, `metaSpan`) into `src/editor/rowView.ts` and injects them into
both pages with `Function.prototype.toString()`. This keeps one formatting implementation and
satisfies the "no second renderer" quality rule.

### Condition values are host-owned

The webview only submits `{ name, value }` strings. The host parses, validates, persists and
re-evaluates. Rows carry derived `condition` / `disabled` fields; the page only styles them.

### Page message protocol

ECUC editor (existing + child 4):
- host → page: `model`, `select`, `notice`
- page → host: `ready`, `reveal`, `follow`, `edit`, `select`, `conditions` (new)

Diff panel (child 1):
- host → page: `diff` (full `DiffDocument`), `error`
- page → host: `ready`, `reveal` (`side`, `key`)

Every new message is validated for shape on the host. No page message may cause an arbitrary write.

## 3. Manifest surface

One submenu is contributed:

```json
"submenus": [{ "id": "arxmlScope.actions", "label": "ARXML Scope" }]
```

It is attached to:
- `explorer/context` — Open with ECUC Editor + compare commands.
- `editor/context` — Open with ECUC Editor + Reveal in ECUC Editor + compare commands, guarded by
  `activeCustomEditorId != 'vscode-arxml-scope.ecucEditor'`.

No flat ARXML command remains in `editor/context`. `explorer/context` never contributes
`revealInEcucEditor`. Command palette entries stay available.

## 4. Ordering and conflict zones

1. **Filter clear** — `renderHtml.ts` CSS/HTML + tests.
2. **Submenu** — `package.json` + manifest tests.
3. **Diff** — new `src/diff/**`, `renderHtml.ts` row-primitive extraction, `package.json`
   commands/submenu items, `scripts/check-webview-boot.cjs`.
4. **SYSCOND** — `model.ts`? (no type change needed), `syscond.ts`, `renderRows.ts`,
   `renderHtml.ts`, `ecucEditorProvider.ts`, `extension.ts`, tests.

Conflict zones are `package.json` (2 then 3) and `renderHtml.ts` (1 then 3 then 4). The order
above avoids overlapping edits within one implementation step.

## 5. Compatibility

- Existing node ids, row ids and model ranges do not change.
- Existing `renderHtml` output may gain the extracted row primitives but must render the same DOM
  and pass the existing assertions. This is a refactor, not a visual change.
- Existing commands keep their ids and behaviour. `revealInEcucEditor` remains executable from the
  command palette and from the text-editor submenu.
- No `activationEvents` entry is added; commands still activate the extension.
- Condition values use a new `workspaceState` key, so a downgrade simply ignores it. No migration.

## 6. Rollback shape

Each child is one commit-able unit. Reverting a child leaves the other three intact:
- Filter: one markup/CSS change.
- Submenu: manifest-only.
- Diff: new files + manifest command/menu block + boot-check extension. Removing the commands makes
  the panel unreachable; no other surface depends on it.
- SYSCOND: one pure module + row fields + toolbar panel + store. With no stored values, evaluation
  is `unknown` for every symbolic condition, so rows render as before.

## 7. Final integration review

After all four children:
- Run the full gate (`check-types`, `lint`, `test`, `package`).
- Open a real ECUC fixture in the text editor and verify the editor context submenu contents.
- Open two fixtures with the diff command; verify counts, navigation, reveal and live refresh.
- Set `CANIPCORETYPE_SC=1`; verify only the row with `[(CANIPCORETYPE_SC==0)]` and its subtree are
  disabled; clear the value and verify the row returns to normal.
- Verify the filter box shows one X with a non-empty query.
- Verify no file is created beside any fixture.
