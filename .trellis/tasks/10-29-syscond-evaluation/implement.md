# SW-SYSCOND evaluation — implementation plan

## Ordered checklist

### Step 1 — Pure evaluator

- [ ] Add `src/core/ecuc/syscond.ts`:
  - tokenizer (numbers, strings, identifiers, operators, parentheses);
  - recursive-descent parser per design §2.1;
  - three-valued evaluator per design §2.2;
  - exact / last-segment identifier lookup;
  - `parseConditionValue`.
- [ ] Add `src/test/core/syscond.test.ts` for every grammar and semantic case. Keep the module free
  of `vscode` and Node APIs.

### Step 2 — Entry parsing and store

- [ ] Add `src/editor/conditionValues.ts`:
  - `ConditionEntry`, `parseConditionEntries`, `ConditionValueStore`;
  - limits, name validation, duplicate last-wins, invalid reporting.
- [ ] Add `src/test/editor/conditionValues.test.ts` with a fake Memento.

### Step 3 — Rows

- [ ] Extend `EcucRow` with `condition`, `disabled`, `disabledBy`; `MetaPart` with optional `state`.
- [ ] Add `conditions` to `RowBuildOptions` and `BuildContext`.
- [ ] Thread `disabledByAncestor` through module/container/parameter/reference builders.
- [ ] Set the condition chip state/title in `suffixParts`.
- [ ] Add row tests for container subtree, parameter self, reference, module, unknown, literal false.

### Step 4 — Provider

- [ ] Add the optional `ConditionValueStore` constructor dependency; keep the no-arg construction
  working for existing tests.
- [ ] Load entries once; pass `conditions` and `conditionEntries` into `renderHtml` and every
  `push()`.
- [ ] Handle `{ type: 'conditions', entries }` with shape validation, normalization, save and
  `push()`.
- [ ] Inject `new ConditionValueStore(context.workspaceState)` in `extension.ts`.

### Step 5 — Page

- [ ] Add the toolbar button and the conditions panel shell. Keep the panel outside `#tree` so it
  is not rebuilt by `setRows`.
- [ ] Embed normalized entries with an escaped JSON payload; add `encodeJsonForScript` and test it.
- [ ] Add page functions for render/add/remove/clear/read/schedule/send and the disabled count.
- [ ] Reuse `createFilterDebouncer(300)`.
- [ ] Update `buildNodeRow` (`data-disabled`, hidden suffix) and `metaSpan` (`data-state`).
- [ ] Update the inspector: condition text, state, reason, inherited-disabled row.
- [ ] Add CSS for dimming, chips, panel, inputs and `.sr-only` using theme variables.
- [ ] Add `src/test/editor/uxConditions.test.ts`.

### Step 6 — Gates and manual checks

- [ ] Open an editor, add `CANIPCORETYPE_SC=1`, verify the row with
  `[(CANIPCORETYPE_SC==0)]` and its subtree are dimmed; set `0` and verify it returns.
- [ ] Add a condition on a container in a fixture; verify descendants dim.
- [ ] Leave a symbol missing; verify unknown and no dimming.
- [ ] Close/reopen the editor in the same workspace; verify values restore.
- [ ] Confirm no file is created or modified.
- [ ] Run:

```text
npm run check-types
npm run lint
npm test
npm run package
```

- [ ] Update `CHANGELOG.md`.
- [ ] Record the evaluator and value-store invariants in `.trellis/spec/frontend/`.

## Risky files / rollback points

- `src/editor/renderRows.ts` — the ancestor flag must follow the existing recursion; do not add a
  second tree walk.
- `src/editor/renderHtml.ts` — the panel must live outside the rebuilt row window; keep the
  `uiState` shape unchanged to avoid breaking the saved-state tests.
- `src/editor/ecucEditorProvider.ts` — `push()` must use the same condition map for every rebuild.
- `src/core/ecuc/model.ts` — no type change is required; keep `syscond?: string` as is.

## Review checklist

- [ ] No evaluation in the webview; only rows and raw entries cross the boundary.
- [ ] Unknown never disables.
- [ ] A false container disables its subtree; a false parameter disables only itself.
- [ ] Disabled rows remain selectable, revealable and editable.
- [ ] Values are workspace state, never a file.
- [ ] No new runtime dependency, no `vscode` import in `src/core/**`.
- [ ] Existing render tests pass with no values configured.
