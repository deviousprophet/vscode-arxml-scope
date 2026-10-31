# Type and Validation Contracts

TypeScript is the only type system. There is no runtime schema library and no generated client; the
compiler protects the source tree, and hand-written guards protect the two runtime seams that the
compiler cannot see: persisted webview state and `postMessage` payloads.

## Type Ownership

| Module | Owns |
|---|---|
| `src/core/ecuc/model.ts` | The scanned document model: `Range`, `Suffixes`, `ModuleNode`, `ContainerNode`, `ParameterNode`, `ReferenceNode`, `EcucDocumentModel`, `SortMode`, `lastShortName`. Offsets are UTF-16 code units into the source text. |
| `src/core/ecuc/renderRows.ts` | The row document the page receives: `EcucRow`, `RowDocument`, `RowBuildOptions`, `MetaPart`, `RowCondition`, `ParameterFormat`, plus `buildRows`, `parameterType`, `parameterFormats`, `conditionTooltip`. |
| `src/core/diff/diffModel.ts` | The diff value model: `DiffCell`, `DiffStatus`, `DiffChange`, `DiffRow`, `DiffSummary`, `DiffDocument`, `DiffHeader`, `FileLabel`, `RangeLookup`, `FlatDiffRow`, `DiffDisplayRow`, plus `buildDiffDocument`, `diffRows`, `summarizeDiff`, `diffVisibility`, `flattenDiffRows`, `flattenDiffDocument`, `nextChangeIndex`, `baseId`, `disambiguatedLabels`, `compareTitle`. |
| `src/core/diff/wordDiff.ts` | The token-level comparison: `WordSegment`, `WordPair` and `diffWords`. Pure; the diff page renders its segments. |
| `src/webviewProtocol.ts` | The editor surface's two message unions (`EditorProviderToWebview`, `EditorWebviewToProvider`), `EditorDocumentHeader`, `EditorDocumentPayload`, `documentHeader`, `editorMessageType`, `isEditorProviderMessage`. |
| `src/diffProtocol.ts` | The diff surface's two message unions (`DiffProviderToWebview`, `DiffWebviewToProvider`) and `diffMessageType` / `isDiffProviderMessage`. |
| `src/host/ecucEdit.ts` | The write plan: `EditRegion`, `EditableField`, `EcucEditRecord`, `EditPlan`, `ApplyResult`; `buildEdit`, `buildFieldEdit`, `applyEdit`. |
| `src/host/ecucStructureEdit.ts` | Structural plans: `StructureAction`, `StructureEditRecord`, `StructurePlan`; `planDelete`, `planDuplicate`, `applyStructureEdit`. |
| `src/core/ecuc/syscond.ts` | `ConditionValue` (`string \| number \| boolean`), `ConditionState` (`'true' \| 'false' \| 'unknown'`) and `ConditionResult`. |
| `src/webview/vscodeApi.ts` | The webview API seam: `WebviewApi<State>`, `vscodeApi()`, `postToHost(message: unknown)` and `readPageState<T>()` / `writePageState<T>()`. |
| `src/webview/css.d.ts` | The ambient stylesheet contract: `declare module '*.css'`. Browser bundles emit `dist/<entry>.css`; the test hook mirrors the same files into `out/`. |
| Page-local modules | Only shapes one page needs: `InspectorFields` in `components/sidebar/detailsPanel/detailsPanel.ts`, `DiffViewCallbacks`, `SearchBarCallbacks`, `EditorToolbarCallbacks`, `DiffToolbarCallbacks`, `ContextMenuHost`, `DetailsEditorHost`. |

Rules:

- A type that crosses a layer lives in the lowest layer that can own it. `core/` has no `vscode` or DOM
  import; `webview/` imports `core/` and never `host/` or `vscode` at runtime.
- Use `import type` for every type-only import across a layer (`webviewProtocol.ts` and
  `diffProtocol.ts` do this for `EcucDocumentModel`, `EcucRow`, `ConditionEntry` and `DiffDocument`).
  A value import of a type module is forbidden.
- CSS imports are side-effect modules. `src/webview/css.d.ts` declares `*.css` once; never cast a CSS
  import or add a second declaration. esbuild emits `dist/editorViewer.css` / `dist/diffViewer.css`
  for the browser pages, stubs CSS in the extension-host bundle, and `cssImportHook.ts` mirrors the
  source stylesheets into `out/` for the tests.
- Do not re-declare a protocol message, row field or diff field locally. Import the owning type. A local
  copy drifts silently when the owner adds a discriminator or a field.

## Boundary Pattern

External values start as `unknown`, are validated once, and only then become typed.

```typescript
// Host: the only entry point for webview messages. `raw` is unknown on purpose.
panel.webview.onDidReceiveMessage((raw: unknown) => {
  if (!editorMessageType(raw)) {
    return; // no string discriminator: not a protocol message
  }
  const message = raw as EditorWebviewToProvider;
  if (message.type === 'conditions') {
    if (!Array.isArray(message.entries)) {
      return; // a malformed payload is not "clear every entry"
    }
    const parsed = parseConditionEntries(message.entries);
    // ...
  }
});
```

```typescript
// Condition values are persisted user input; normalize at that boundary.
export function parseConditionEntries(input: unknown, limit = ENTRY_LIMIT): ParsedConditions;

// Page state is validated by the consumer before it is used.
export function readPageState<T>(): T | undefined;
```

Rules:

- The host's `onDidReceiveMessage` callback takes `unknown`. Validate the discriminator
  (`editorMessageType` / `diffMessageType`) and then narrow once to that surface's union. Never cast a
  field that has not been checked with `typeof`, `Array.isArray` or a dedicated normalizer.
- `editorMessageType` / `diffMessageType` return `string | undefined`; they never throw and never cast
  the payload. `isEditorProviderMessage` / `isDiffProviderMessage` are the exported host-shape guards.
- The page listener receives a host message and narrows on `message.type` inside
  `handleEditorMessage` / `handleDiffMessage`. An unrecognized type falls through and does nothing; it is
  not executed and it is not an error. This whole-payload narrowing is the one documented exception to
  the no-blind-`as` rule below.
- `readPageState<T>()` is generic because the persisted object is per-page; the page validates fields
  (sidebar tab, width and pane map) before applying them. A missing or invalid field falls back to the
  documented default.
- Pure functions return discriminated results for expected failures
  (`EditPlan = EditPlanOk | { ok: false; reason: string }`). Do not throw for a user-correctable
  refusal; throw only for a programming error.

## Protocol Rules

- **One union per direction per surface.** The editor has `EditorProviderToWebview` (host → page) and
  `EditorWebviewToProvider` (page → host). The diff has `DiffProviderToWebview` and
  `DiffWebviewToProvider`. Do not merge the surfaces: the diff page never imports the editor union and
  the editor page never imports the diff union.
- **Every message has a literal `type` discriminator.** The `document` message carries its payload under
  `document: { rows, selectedId, header }`; it is not a flat `rows`/`selectedId` message and it is not
  named `model`.
- **Dispatch is exhaustive.** Every member of the union has a branch in the host handler and the page
  handler. Adding a member means touching the union, the sender, the receiver and the tests in one
  change. Do not add a `default` branch that casts.
- **`postMessage` is checked at the call site.** `postToHost` and `WebviewApi.postMessage` accept
  `unknown` because one singleton serves both pages; every call site must pass an object literal whose
  `type` belongs to the current page's union. When the object is built separately, use
  `satisfies EditorWebviewToProvider` / `satisfies DiffWebviewToProvider` so the compiler checks it.
- **Unknown inbound messages are ignored, not cast.** The host checks the discriminator first; the page
  checks `message.type` in its handler. A message with a valid discriminator but an invalid field (a
  non-string `nodeId`, a non-array `entries`, a non-string `value`) is dropped or refused explicitly.
- **Keep the payload data-only.** No HTML string, no function and no `Date` travels over `postMessage`.
  Rows, headers, condition entries and the diff document are plain serializable values.
- **Both directions stay symmetric with the tests.** A protocol change updates
  `src/test/webview/page/*.test.ts` and the extension suites that post the message; a source-level grep
  is not a substitute for driving the page's handler.

## Numeric and Value Rules

- **ECUC values are strings.** `ParameterNode.displayValue`, `EcucRow.value` and `EcucRow.shownValue`
  are strings. A boolean parameter is the text `'true'` / `'false'`; `EcucRow.valueKind` is the display
  union `'numeric' | 'textual' | 'boolean'`. The details editor chooses its `<select>` from the
  AUTOSAR Boolean type (`row.parameterType`), not from `valueKind`. Never put a JS `boolean` or
  `number` into `EcucRow.value`.
- **Integers are formatted with `BigInt`.** `parameterFormats` parses decimal, `0x` and `0b` literals
  into `bigint` (`integerValue`), keeps the sign and pads the magnitude (`padStart(2, '0')` for hex,
  `padStart(8, '0')` for binary). Do not use `Number`, `parseInt` or `parseFloat` for an ECUC integer,
  and do not round-trip through a 64-bit value's `number` representation.
- **Formatting follows the type.** Boolean, textual, string, enumeration, function-name and
  linker-symbol parameters get no Decimal/Hexadecimal/Binary rows. Float gets Decimal only. An integer
  gets all three. A non-integer numeric value gets Decimal only.
- **Offsets are UTF-16 ranges.** `Range.start` / `Range.end` are offsets into `TextDocument.getText()`,
  not line/column and not byte offsets. Convert through `src/core/text/offsets.ts` (`LineIndex`) at the
  VS Code boundary. Never carry a source range on `EcucRow`; the diff's `RangeLookup` supplies it from
  the node index.
- **Node ids are opaque strings.** They are path-based and include a declaration-order `#n`. Do not
  parse them. The diff's `baseId` is the one place that removes ordinals, for pairing only.
- **Conditions are three-valued.** `ConditionState` is `'true' | 'false' | 'unknown'`; only `'false'`
  disables a row, and `unknown` never does. The page sends raw `{ name, value }` text; the host
  normalizes it and the evaluator receives `ConditionValue`. Do not conflate an absent value with an
  empty string: an empty committed value is absent from the evaluation map and leaves the condition
  `unknown`.
- **`undefined` means “not provided”.** Optional metadata (`comments`, `condition`, `disabledBy`,
  `contextPaths`, `formats`) stays absent or empty rather than being filled with an invented value.
  `value` and `target` are text fields and may legitimately be `''`. Consumers use `??` / explicit
  checks; do not use truthiness to tell a missing optional field from an empty one.

## Forbidden Patterns

| Never | Why / use instead |
|---|---|
| `any` in new code | Use `unknown` plus a guard, a generic, or the owning union. The existing browser-page `any` at DOM seams is debt to narrow when touched, not a pattern to copy. |
| A blind `as` | Narrow with `typeof` / `Array.isArray` / a type guard first. The single whole-payload cast in the page's `message` listener is the documented boundary exception; per-field casts downstream are forbidden. |
| `@ts-ignore` / `@ts-expect-error` without a written reason | Fix the type, or use a guard. A suppression hides the next regression. |
| An unchecked `postMessage` | Send a member of the surface's union; use `satisfies` when the shape is not obviously assignable. |
| A locally declared copy of a protocol message, row or diff field | Import the owner from `webviewProtocol.ts`, `diffProtocol.ts`, `renderRows.ts` or `diffModel.ts`. |
| `parseInt` / `Number` / `toString(16)` on an ECUC integer | `BigInt` and string formatting preserve the full value. |
| Writing a `number`/`boolean` into a value field | `EcucRow.value` is text; `valueKind` carries the kind. |
| `import … from 'vscode'` under `src/core/**` or `src/webview/**` | The core is pure and the page is browser-only; only `import type` of an allowed host type is acceptable. |
| A cast that changes a `Range` to line/column or bytes | Convert through `LineIndex`; offsets are UTF-16 code units. |
| Treating `unknown` as `'false'` | Only the literal condition result `'false'` disables a row. |

## Verification

- `npm run check-types` — the compiler is the first gate; a protocol mismatch must fail here.
- `npm run lint` — `eslint src` plus the repository's HTML-escape rule test
  (`eslint-rules/require-escaped-html.test.mjs`).
- Protocol and boundary coverage:
  - `src/test/webview/page/render.test.ts`, `virtualPage.test.ts`, `diffPage.test.ts` mount the compiled
    page module in jsdom and drive its own handlers and imported helpers.
  - `src/test/extension/editing.test.ts`, `rescan.test.ts`, `structureEdit.test.ts`,
    `conditionValues.test.ts` drive the host boundaries and write plans.
  - `src/test/core/renderRows.test.ts`, `syscond.test.ts` and
    `src/test/core/diffModel.test.ts` cover the pure value rules.
- A type-level claim is only proven when the test breaks on a mutation: add a union member without a
  handler, send a message with the wrong payload, or replace a `BigInt` format with `Number` and confirm
  a test fails.
