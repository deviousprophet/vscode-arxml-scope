# Editor Session and Protocol Code-Spec

Two independent webview surfaces use the same static-shell + `postMessage` pattern:

- the ECUC custom text editor (`EcucEditorProvider`, `VIEW_TYPE = 'vscode-arxml-scope.ecucEditor'`);
- the read-only semantic diff panel (`DiffPanel.viewType = 'vscode-arxml-scope.diff'`).

The host owns documents, scans, writes and persistence. Each page owns its row store, selection,
collapse, search and scroll state; the editor page also owns its sidebar state. The only cross-runtime
channel is the typed protocol in `src/webviewProtocol.ts` or `src/diffProtocol.ts`.

## Scenario: Open and coordinate one ECUC custom editor

### 1. Scope / Trigger

- Manifest: `contributes.customEditors` declares `vscode-arxml-scope.ecucEditor` for `*.arxml` with
  `priority: "option"`. A normal open still uses the text editor; activation is explicit.
- Triggers:
  - `vscode-arxml-scope.openEcucEditor` (`Open with ECUC Editor`) and the Explorer/editor context
    submenu `arxmlScope.actions`;
  - VS Code's **Open With…**;
  - `vscode-arxml-scope.revealInEcucEditor` / `EcucEditorProvider.selectNode(uri, nodeId)`;
  - `vscode-arxml-scope.revealInSource` in the opposite direction.
- The provider is registered in `src/extension.ts` as the custom editor for `VIEW_TYPE`; the command
  handlers live in `src/commands.ts`.

### 2. Signatures

```typescript
// src/host/ecucEditorProvider.ts
export const VIEW_TYPE = 'vscode-arxml-scope.ecucEditor';
export function gateReason(text: string, filePath: string): string | undefined;
export class EcucEditorProvider implements vscode.CustomTextEditorProvider {
  resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): void;
  selectNode(uri: vscode.Uri, nodeId: string): Promise<void>;
}

// src/core/ecuc
export function scanEcucValues(text: string): EcucDocumentModel;
export function buildRows(model: EcucDocumentModel, options?: RowBuildOptions): RowDocument;
export function buildNodeIndex(model: EcucDocumentModel): NodeIndex;

// src/host/webviewShell.ts
export function editorShell(assets: WebviewShellAssets): string;

// src/webviewProtocol.ts
export type EditorProviderToWebview =
  | { type: 'document'; document: EditorDocumentPayload }
  | { type: 'conditions'; entries: ConditionEntry[] }
  | { type: 'select'; nodeId: string }
  | { type: 'notice'; message: string; kind?: 'warn' | 'info'; inline?: boolean; scope?: 'details' | 'conditions' }
  | { type: 'error'; message: string };
export type EditorWebviewToProvider =
  | { type: 'ready' }
  | { type: 'select'; nodeId: string }
  | { type: 'reveal'; nodeId: string }
  | { type: 'follow'; nodeId: string }
  | { type: 'edit'; nodeId: string; field?: 'value' | 'shortName' | 'definitionRef'; value: string }
  | { type: 'delete'; nodeId: string }
  | { type: 'duplicate'; nodeId: string }
  | { type: 'conditions'; entries: ConditionEntry[] };
export function editorMessageType(message: unknown): string | undefined;
export function documentHeader(model: EcucDocumentModel): EditorDocumentHeader;

// src/host/ecucEdit.ts and ecucStructureEdit.ts
export function buildEdit(model: EcucDocumentModel, text: string, nodeId: string, value: string): EditPlan;
export function buildFieldEdit(
  model: EcucDocumentModel,
  text: string,
  nodeId: string,
  field: 'shortName' | 'definitionRef',
  value: string
): EditPlan;
export async function applyEdit(document: vscode.TextDocument, record: EcucEditRecord): Promise<ApplyResult>;
export function planDelete(model: EcucDocumentModel, text: string, nodeId: string): StructurePlan;
export function planDuplicate(
  model: EcucDocumentModel,
  text: string,
  nodeId: string,
  duplicateName?: string
): StructurePlan;
export async function applyStructureEdit(
  document: vscode.TextDocument,
  record: StructureEditRecord
): Promise<ApplyResult>;

// src/host/bootWatchdog.ts
export function watchBoot(onSilent: () => void, timeoutMs: number): BootWatchdog;
```

The page boot order is `mountEditor()` from `src/webview/editorViewer.ts`: install the console error
reporter, subscribe to `message`, wire the sidebar, Conditions panel, Details editor, toolbar and
search components, mount one `DocumentTreeView('#tree', 'document', …)`, initialize an empty row
store, then `postToHost({ type: 'ready' })`.

### 3. Contracts

1. **Gate before shell.** `resolveCustomTextEditor` calls `gateReason(document.getText(), uri.fsPath)`.
   A refusal shows one warning and executes `vscode.openWith` with `'default'`; `webview.html` is never
   set, so no empty page flashes. A successful gate then sets `webview.options`
   (`enableScripts: true`, `localResourceRoots: [extensionUri]`) and `webview.html = editorShell(...)`.
2. **Scan per document change, then build rows.** `resolveCustomTextEditor` scans the open document
   once into `model`; `onDidChangeTextDocument` re-scans it into the same `model`. Every push reads
   `arxmlScope.ecuc.editor.sort` / `sortExcept`, adds the normalized condition map, and calls
   `buildRows(model, options)`. The result is posted as one `document` envelope:
   `{ type: 'document', document: { rows, selectedId, header: documentHeader(model) } }`.
   There is no HTML/tree markup in the payload.
3. **One refresh path.** A change to this document re-scans `model` and pushes. An
   `onDidChangeConfiguration` for `arxmlScope.ecuc.editor` and the `conditions` message rebuild rows
   from the current `model` and push. A successful write does not push separately: it relies on the
   document-change event.
4. **Boot handshake.** The host arms `watchBoot` for 10 s. The page posts `{ type: 'ready' }`; the host
   answers with the current `conditions` entries and then the `document` payload. A reload therefore
   cannot show an empty tree or stale condition values.
5. **Message dispatch.** `panel.webview.onDidReceiveMessage((raw: unknown))` first checks
   `editorMessageType(raw)`; anything without a string `type` is ignored. `ready` and `conditions` are
   handled first; the remaining messages must carry a string `nodeId`. `edit` also requires a string
   `value`; a missing `field` normalizes to `'value'`, and an unknown field is ignored. `select` only
   updates the host's selection map.
6. **One user action, one write.** `editField` scans the current text, builds an `EditPlan` with
   `buildEdit` (parameter `<VALUE>`) or `buildFieldEdit` (container `<SHORT-NAME>` /
   `<DEFINITION-REF>`), and applies exactly one `WorkspaceEdit` through `applyEdit`. Delete and
   duplicate go through `planDelete` / `planDuplicate` and `applyStructureEdit` after a modal
   confirmation. A refusal posts a `notice` (for a field, `inline: true`, `scope: 'details'`) and leaves
   the bytes untouched.
7. **Renames follow the id.** A container rename changes its path-based id. Before writing,
   `editField` stores `plan.nextNodeId`; the re-scan that follows the document change carries that
   surviving id. A refused write restores the previous selection entry.
8. **Reveal and follow are navigation only.** `reveal` maps the node id through
   `buildNodeIndex(model).byId` and calls `revealRangeInTextEditor` with the panel's column;
   `arxmlScope.ecuc.editor.revealMode` (`beside`, `focus`, `replace`) decides where the source opens.
   `follow` resolves a same-file reference through `followReference`; the resolved range is mapped back
   to a node id and posted as `select`. Failure is a Details notice, never a write.
9. **Dispose everything.** The panel's `onDidDispose` disposes the boot watchdog and every subscription
   and deletes the document's panel, selection and pending entries (`forget`).
10. **Layout survives a re-scan.** The toolbar, sidebar, tabs, inspector and Conditions panel are
    outside the row window. The row store, flattened display list, virtual range and selected subtree
    are rebuilt in place; the shell and panels are not replaced.

### 4. Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Path is not `.arxml` | `gateReason` refuses; one warning; file reopens in the text editor; no webview HTML is written. |
| File has no `ECUC-MODULE-CONFIGURATION-VALUES` | Same refusal path as above. |
| Page does not post `ready` within 10 s | `watchBoot` shows one warning naming the file and the Webview Developer Tools; the panel is left open. |
| Message without a string `type` | Ignored (`editorMessageType` returns `undefined`). |
| `conditions.entries` is not an array | Ignored; it is not treated as “clear all”. |
| Condition entries contain invalid names | Normalized entries are kept/saved; invalid names are dropped and one `notice` with `kind: 'warn'`, `scope: 'conditions'` lists up to five. |
| `edit` without a string `value` | Ignored. |
| `edit.field` is absent | Normalized to `'value'`. |
| `edit.field` is not `value` / `shortName` / `definitionRef` | Ignored. |
| Node id no longer exists | `notice` (warn, details); no write. |
| Region moved, disappeared, or is CDATA | `applyEdit` refuses with a reason; for a field edit the notice is inline and the prior selection is restored. |
| Container field edit targets a non-container / module | `buildFieldEdit` refuses; no write. |
| Delete/duplicate plan is stale | Refusal notice in Details; no partial write. |
| Modal confirmation is cancelled | No plan is applied and no message is posted. |
| `follow` target is unresolved or not an ECUC row | `notice` (warn, details); no selection change. |
| `reveal` node id is unknown | No-op; no editor is opened. |

### 5. Good/Base/Bad Cases

- **Good:** an integer `<VALUE>` edit goes from details input → `{ type: 'edit', nodeId, value }` →
  `buildEdit` → one `WorkspaceEdit` → `onDidChangeTextDocument` re-scan → `document` push with the same
  selected id. The on-disk bytes differ only inside `<VALUE>`.
- **Base:** the panel opens on a valid file with no selection. `buildRows` emits the module and its
  containers; the page posts `ready`, receives `conditions` then `document`, and paints the viewport
  window with the Details tab showing the empty state.
- **Good:** a container rename predicts the new id before `applyEdit`, so the renamed container stays
  selected after the re-scan.
- **Bad:** building a full-tree HTML string in the provider and assigning it to `webview.html` on every
  change. It bypasses the protocol, loses selection/collapse/search state, and defeats the virtual
  window.
- **Bad:** writing a stored offset after a previous edit changed the value length. `applyEdit` must
  recompute the region by re-scanning; a stale region is a refusal, not a shifted write.

### 6. Tests Required

- `src/test/extension/activation.test.ts` — opt-in activation and the gate/refusal path.
- `src/test/extension/bootWatchdog.test.ts` — silent page, settle, dispose.
- `src/test/extension/editing.test.ts` — plan/apply, one edit, refusal, bytes on disk, undo.
- `src/test/extension/rescan.test.ts` — one refresh path, selection survival, settings change.
- `src/test/extension/reveal.test.ts`, `references.test.ts` — source↔editor mapping and same-file follow.
- `src/test/extension/structureEdit.test.ts` — delete/duplicate plans, stale bytes, one edit.
- `src/test/extension/uxConditions.test.ts`, `conditionValues.test.ts` — normalization, invalid names,
  persistence and row re-push.
- Page suites: `src/test/webview/page/render.test.ts`, `virtualPage.test.ts`,
  `uxDocumentInteractions.test.ts`, `search.test.ts` — static shell, row payload, windowing, message
  handling and search; component suites under `src/test/webview/components/` for the mounted controls.
- The write criterion is bytes, not a model field: compare the whole file and confirm one contiguous
  span moved. Real focus/hover/scroll behaviour still needs the Extension Development Host.

### 7. Wrong vs Correct

```ts
// Wrong: set the shell before the gate. A refused file flashes an empty document tree.
panel.webview.html = this.html(panel.webview);
const reason = gateReason(document.getText(), document.uri.fsPath);
if (reason) { void vscode.window.showWarningMessage(reason); return; }

// Correct: the gate runs first; a refusal opens the text editor and never writes webview.html.
const reason = gateReason(document.getText(), document.uri.fsPath);
if (reason) {
  void vscode.window.showWarningMessage(reason);
  void vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
  panel.onDidDispose(() => this.forget(key));
  return;
}
panel.webview.html = this.html(panel.webview);
```

```ts
// Wrong: send markup, or use a stale message name.
void panel.webview.postMessage({ type: 'model', html: renderTree(model) });

// Correct: send the row document under the protocol's `document` envelope.
void panel.webview.postMessage({
  type: 'document',
  document: { rows: rows.rows, selectedId, header: documentHeader(model) },
});
```

```ts
// Wrong: post `select` after a rename without predicting the new id; the re-scan loses the row.
await applyEdit(document, plan.record);
await panel.webview.postMessage({ type: 'select', nodeId });

// Correct: store the predicted id before the write; a refusal restores the previous entry.
this.selections.set(key, plan.nextNodeId!);
const applied = await applyEdit(document, plan.record);
if (!applied.ok) { this.selections.set(key, previous!); /* post inline notice */ }
```

## Scenario: Compare two ECUC files in the read-only diff panel

### 1. Scope / Trigger

- View type: `vscode-arxml-scope.diff`, created by `DiffPanel.open(context, leftUri, rightUri)`.
- Selection commands:
  - `vscode-arxml-scope.selectAsFirst` (`Select as First File to Compare`);
  - `vscode-arxml-scope.compareToStaged` (`Compare with First File`, guarded by the
    `arxmlScope.hasCompareSelection` context key);
  - `vscode-arxml-scope.compareSelected` (`Compare Two ARXML Files…`, guarded by `listDoubleSelection`).
- The diff is read-only. It never creates a `WorkspaceEdit`, writes a file, repairs a difference or
  generates a derived document.

### 2. Signatures

```typescript
// src/host/diffPanel.ts
export class DiffPanel {
  public static readonly viewType = 'vscode-arxml-scope.diff';
  public static open(
    context: vscode.ExtensionContext,
    leftUri: vscode.Uri,
    rightUri: vscode.Uri
  ): Promise<boolean>;
  private static read(uri: vscode.Uri): Promise<vscode.TextDocument | undefined>;
}

// src/core/diff/diffModel.ts
export interface DiffDocument { left: FileLabel; right: FileLabel; leftHeader: DiffHeader; rightHeader: DiffHeader; labels: [string, string]; rows: DiffRow[]; summary: DiffSummary; }
export function buildDiffDocument(
  left: FileLabel,
  right: FileLabel,
  leftRows: readonly EcucRow[],
  rightRows: readonly EcucRow[],
  leftRanges?: RangeLookup,
  rightRanges?: RangeLookup,
  headers?: { left: DiffHeader; right: DiffHeader }
): DiffDocument;
export function diffRows(leftRows: readonly EcucRow[], rightRows: readonly EcucRow[], leftRanges?: RangeLookup, rightRanges?: RangeLookup): DiffRow[];
export function summarizeDiff(rows: readonly DiffRow[]): DiffSummary;
export function nextChangeIndex(rows: readonly DiffRow[], visible: readonly boolean[] | undefined, from: number, direction: 1 | -1): number;
export function disambiguatedLabels(a: FileLabel, b: FileLabel): [string, string];
export function compareTitle(left: FileLabel, right: FileLabel): string;

// src/core/diff/wordDiff.ts
export interface WordSegment { text: string; changed: boolean; }
export interface WordPair { left: WordSegment[]; right: WordSegment[]; }
export function diffWords(left: string, right: string): WordPair;

// src/host/webviewShell.ts
export function diffShell(assets: WebviewShellAssets): string;

// src/diffProtocol.ts
export type DiffProviderToWebview =
  | { type: 'document'; document: DiffDocument }
  | { type: 'error'; message: string };
export type DiffWebviewToProvider =
  | { type: 'ready' }
  | { type: 'reveal'; side: 'left' | 'right'; key: string };
export function diffMessageType(message: unknown): string | undefined;
export function isDiffProviderMessage(message: unknown): message is DiffProviderToWebview;

// src/host/navigation.ts
export async function revealRangeInTextEditor(
  document: vscode.TextDocument,
  range: Range,
  options?: { viewColumn?: vscode.ViewColumn; mode?: 'beside' | 'focus' | 'replace' }
): Promise<vscode.Range>;
```

`rowsFor(document)` is the panel's only row builder: `scanEcucValues` → `buildNodeIndex` → `buildRows`
with `sort: 'all'` and `SORT_EXCEPTIONS`; it returns `{ rows, rangeOf, header }`. `rangeOf` reads the
same node index that produced the ids, because `EcucRow` deliberately carries no source range.

### 3. Contracts

1. **First file is a one-shot session stash.** `selectAsFirst` reads the target, applies `gateReason`,
   calls `compare.set(uri)` and tells the user to open the second file. `CompareSelectionStore` is not
   persisted; `set`/`clear` also maintain `arxmlScope.hasCompareSelection`.
2. **Compare validates both sides before creating a panel.** `compareToStaged` requires a stash and
   clears it only after `DiffPanel.open` returns `true`. `compareSelected` takes the clicked file as the
   left side plus exactly one other selected file; a palette invocation with no selection opens a
   two-file dialog. Anything other than exactly two files warns and returns.
3. **Unsaved buffers are compared.** Both sides are read with `workspace.openTextDocument`; a read
   error warns and returns `false`. Both must pass the same `gateReason` as the editor.
4. **The model is deterministic.** Each side is scanned and its rows built with `sort: 'all'` and
   `SORT_EXCEPTIONS`, then `buildDiffDocument` pairs the rows, assigns `status` and recomputes the
   merged pre-order list, `labels` and `summary`.
5. **One static shell, one document payload.** `DiffPanel.open` creates the panel with
   `enableScripts: true`, `retainContextWhenHidden: true` and `localResourceRoots: [extensionUri]`, sets
   `diffShell(...)`, arms the 10 s boot watchdog, and answers `ready` with the current `DiffDocument` on
   the `document` channel.
6. **Refresh is a full re-scan after 150 ms.** A change to either URI schedules one `refreshNow`; a
   generation token makes an older async refresh stale. A successful read rebuilds both sides and posts
   a new `document`. If a side stops being ECUC, the last good document stays visible and `error`
   explains why it stopped updating.
7. **Reveal is host-side and side-aware.** The page posts `{ type: 'reveal', side, key }` with the
   **host's original side**: `hostSide` maps the displayed pane through the current swap before posting,
   because the host has no swap state and indexes `row.left` / `row.right` directly. The host finds the
   row by key, takes that cell, maps its range through `revealRangeInTextEditor`, and forces
   `mode: 'beside'` so the diff tab survives `arxmlScope.ecuc.editor.revealMode: 'replace'`.
8. **Swap is display-only.** `displayLeft` / `displayRight` / `displayStatus` re-project a row;
   `hostSide` maps the displayed side back to the host's original side for reveal. The compared
   documents are not rebuilt and the vertical position is not reset. Swap resets horizontal offsets to
   zero in both panes.
9. **The comparison chrome scrolls with its rows.** Each pane header lives inside that pane's
   `.document-tree-scroll` above the top spacer, so it scrolls away with the content; the pane's
   measured header height joins the row-offset math. The header is presentation-only. The diff adds no
   inter-module blank row: every diff row is exactly one base row high.
10. **The page owns view state.** Show all / Show diff only, Prev diff / Next diff, selection, collapse,
    search and scroll survive a refresh. Search is Enter-only, chunked and cancellable; it never removes
    a row. `nextChangeIndex` wraps and skips unchanged or hidden rows. A changed row may render inline
    word runs for the fields it displays (label, value/target, condition, variant, context) on the
    displayed sides; added/removed rows keep only the full-cell tint, and a search `<mark>` keeps its
    background inside an outlined changed word. One `selectedKey` computes the merged subtree key set,
    so node, brace and annotation rows highlight in both panes; an added/removed row highlights only
    the pane that owns its cell.
11. **Dispose everything.** `panel.onDidDispose` sets `disposed`, disposes the watchdog, clears the
    pending refresh timer and every subscription. In-flight async work checks `disposed` before posting.

### 4. Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| A side cannot be read | One warning naming the file; `open` returns `false`; no panel. |
| A side is not `.arxml` or has no ECUC values | One warning from `gateReason`; no panel. |
| `compareToStaged` has no stash | Warning: select a first file first; no panel. |
| `compareSelected` sees fewer/more than two files | Warning: select exactly two; no panel. |
| A side becomes non-ECUC while open | Last good document stays; `error` banner explains the refresh stopped. |
| A refresh throws | Last good document stays; `error` carries the exception text. |
| Panel is disposed during a refresh | Generation check returns; nothing is posted. |
| `reveal` key is missing or has no cell on that side | No-op. |
| Reveal source cannot be opened | `error` banner reports the failing side. |
| Search has no matches | `0 / 0` count; no jump. |
| Swap is pressed | Panes re-project; horizontal offsets reset; vertical holds; no re-scan. |

### 5. Good/Base/Bad Cases

- **Good:** `selectAsFirst` on `a.arxml`, then `compareToStaged` on `b.arxml` opens one panel and clears
  the stash. A value change in `b.arxml` saves and triggers one debounced refresh; the changed row keeps
  its selection and scroll position.
- **Base:** two identical files produce zero changed rows; Show diff only shows the roots required to
  reach any change (none), and the empty/summary state remains honest.
- **Good:** duplicated container names are paired by content/subtree identity first, so a reordered
  declaration is not reported as add + remove, and a changed duplicate lands on one changed row.
- **Bad:** treating a formatting change or a reordered parameter as a change. Both sides are sorted and
  only the compared fields are diffed; XML layout and annotation text are not compared.
- **Bad:** computing a new comparison on Swap. That changes pairing and scroll; swap must only
  re-project the displayed labels, cells and status.

### 6. Tests Required

- `src/test/extension/compare.test.ts` — stash lifecycle, command guards, two-file selection, gate
  refusals and panel creation.
- `src/test/core/diffModel.test.ts` — pairing (content, subtree, sort identity, base id), status,
  merged order, summary, visibility, flattening, next-change wrap, labels/title.
- `src/test/core/wordDiff.test.ts` — tokenizer (whitespace, identifiers, one-character punctuation,
  hex literal, path slashes), LCS, empty sides and adjacent-segment merging.
- `src/test/webview/components/diffView.test.ts` — two `DocumentTreeView` instances, single vertical
  driver, horizontal mirror, swap reset, optional status, word-colour CSS and the absent module gap.
- `src/test/webview/page/diffPage.test.ts` — toolbar both ways, search wiring, display projection,
  reveal-side mapping, refresh state retention, header-in-scroller order and non-searchability,
  changed-word runs in both panes, swapped colours, search overlap, added/removed rows without word
  spans, unchanged rows, module height and no `data-gap`.
- `src/test/webview/page/search.test.ts` — Enter-only chunked search and count states.
- Reveal is asserted through `reveal.test.ts` / `uxReveal.test.ts`; the source-level `beside` forcing
  is a regression guard, while the real panel behaviour is observed in the Extension Development Host.

### 7. Wrong vs Correct

```ts
// Wrong: a "fix" action that writes the right value into the left file.
await vscode.workspace.applyEdit(new vscode.WorkspaceEdit());

// Correct: the diff is read-only; the page only asks the host to reveal a row.
if (message.type === 'reveal') {
  void reveal(message.side, message.key);
}
```

```ts
// Wrong: rebuild the comparison when the user swaps sides.
onSwap: () => { current = buildDiffDocument(...); }

// Correct: swap is display-only; the host keeps the original side for reveal.
function displayLeft(row: DiffRow): DiffCell | undefined { return swapped ? row.right : row.left; }
function hostSide(side: 'left' | 'right'): 'left' | 'right' {
  return swapped ? (side === 'left' ? 'right' : 'left') : side;
}
```

```ts
// Wrong: send a flat rows payload on the diff's `document` channel.
void panel.webview.postMessage({ type: 'document', rows });

// Correct: the diff protocol posts the whole DiffDocument.
void panel.webview.postMessage({ type: 'document', document: next });
```

```ts
// Wrong: post the displayed side after a swap. The host indexes row.left/row.right directly,
// so the revealed file is the wrong one.
postToHost({ type: 'reveal', side: swapped ? 'left' : 'right', key });

// Correct: map the displayed pane back to the host's original side before posting.
const side = displayLeft(row) ? hostSide('left') : hostSide('right');
postToHost({ type: 'reveal', side, key });
```
