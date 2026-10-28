# Design: ECUC editor UX overhaul

## 1. What is wrong today, with evidence

Three reported problems, each rooted in a specific line. They are defects, not preferences.

### 1.1 Every click ejects the user into the XML

`src/editor/renderHtml.ts` registers one document-level click listener:

```js
const follow = event.target.closest('[data-follow]') !== null;
vscode.postMessage({ type: follow ? 'follow' : 'reveal', nodeId: item.dataset.nodeId });
```

So *any* click on a tree item — a container's label, a parameter's name, the blank space of its row —
posts `reveal`. The host then does (`src/editor/navigation.ts:87-95`):

```ts
await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default', { selection });
```

`openWith('default')` **replaces the custom editor's tab in the same group** — the file's own comment
says "this swaps the editor rather than opening a second pane". Focus moves to the text editor as well.
There is no select-only interaction anywhere in the tree, so the view cannot be browsed: every click
costs the view. `Enter` does the same (`renderHtml.ts`, keydown handler).

### 1.2 Containers cannot be collapsed

- `renderHtml.ts` `item()` writes `aria-expanded="true"` **unconditionally** whenever children exist.
  Nothing renders a toggle.
- `ArrowLeft` / `ArrowRight` do toggle `display: none`, but invisibly: no affordance, no marker, no
  indication that it happened.
- Worse, the state cannot survive anything: on every `model` message the script does
  `main.innerHTML = message.tree`, and the provider re-scans on every document change. Any collapse
  would be undone the moment the user types in the XML.

### 1.3 The tree is flat and theme-fragile

| Cause | Where |
|---|---|
| No per-kind distinction: module, container, parameter and reference all render as the same bold label | `renderHtml.ts` `item()` |
| Indent guides fall back to `transparent`, and many themes do not define `--vscode-tree-indentGuidesStroke`, so nesting is invisible | `STYLE`, `.children` |
| No row hover state at all | `STYLE` |
| Every secondary span is the same `descriptionForeground` | `STYLE` |
| Selection uses `list-activeSelectionBackground` even when the webview is unfocused | `.node[data-selected]` |
| Rows are `display: flex; flex-wrap: wrap`, so a long value wraps to a second line and values never align vertically | `.row` |

### 1.4 Discoverability defects found while reading

- Editing is invisible: only `F2` or a click landing exactly on the `.value` span starts an edit. The
  value has no hover, no cursor change and no tooltip.
- A refused write **discards the typed text**: `endValueEdit` removes the input before the host's
  `notice` arrives (`src/editor/ecucValueEditor.ts`).
- The re-scan calls `scrollIntoView({ block: 'center' })`, so the viewport jumps on every document
  change, including while a value is being edited.
- One feedback channel for everything, always warning-coloured.
- The filter hides nodes but never says how many matched, has no empty state, and does not highlight.

## 2. Interaction model

VS Code's own tree convention: **single click selects, the twisty toggles, and opening is a deliberate
action.** Adopt it.

| Interaction | Result |
|---|---|
| Single click on a row (label, meta, blank space) | Select the node in place. Nothing else. |
| Single click on the twisty | Toggle that node's children. |
| Double click on a row | Reveal in the source (§3). |
| `Enter` | Toggle the children if it has any; otherwise reveal. |
| `Ctrl+Enter` / `Alt+Enter` | Always reveal. |
| `F2` / click on a value | Begin editing that value (unchanged from today). |
| `Space` | Select only — an explicit "do not reveal" key for muscle memory. |

`Enter` becomes toggle-or-reveal rather than always-reveal: a leaf has nothing to toggle, so revealing
it is the only useful action, and a container can still be revealed with `Ctrl+Enter` or a double
click. This keeps `Enter` from being the accidental-eject key.

Double-click costs one extra click event, which selects — harmless, and it is what every file tree
does.

## 3. Reveal must not destroy the view

Replacing the tab is the actual defect. The new mechanism:

```ts
const existing = vscode.window.visibleTextEditors.find(
  (e) => e.document.uri.toString() === document.uri.toString()
);
const editor = existing ?? (await vscode.window.showTextDocument(document, {
  viewColumn: vscode.ViewColumn.Beside,
  preserveFocus: true,
  preview: true,
}));
editor.selection = new vscode.Selection(selection.start, selection.end);
editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
```

Three things this buys: the custom editor's tab is untouched (the text editor opens **beside** it, or
is reused if it is already visible); focus stays in the tree so the user can keep clicking; and
`preview: true` means the source tab is reused rather than accumulating.

`ViewColumn.Beside` is relative to the active group, so when the custom editor is already in a split,
the source opens next to it rather than in a third column. The provider knows its own panel's
`viewColumn`, so it passes that through rather than relying on "active".

A setting keeps the old behaviour available for users who want the tab swapped:

| Setting | Values | Default |
|---|---|---|
| `arxmlScope.ecuc.editor.revealMode` | `beside` (open next to the tree, keep focus), `replace` (swap this tab, as today), `focus` (open beside and move focus there) | `beside` |

The `revealInSource` command keeps working for the command palette and for source → view; only the
tree's click path changes. `follow` (reference following) uses the same mechanism, since its current
path has the identical problem.

## 4. Collapse, and the state that must survive a re-scan

### 4.1 Where the state lives

In the **webview**, not the host. The host's job is to render a model; expansion is view state, and
keeping it out of the host avoids a round-trip on every toggle.

```js
const collapsed = new Set();   // node ids the user closed; everything else is open
let scrollTop = 0;
```

The `model` message handler becomes:

```js
scrollTop = main.scrollTop;                       // capture before the swap
main.innerHTML = message.tree;
pruneCollapsed();                                  // drop ids that no longer exist
applyCollapsed();                                  // re-hide, re-set aria-expanded
applyFilter();
prepareFocus();
main.scrollTop = scrollTop;                        // restore
```

`pruneCollapsed` is what makes this correct across a structural change: an id that disappeared is
simply dropped, and the rest of the set is unaffected.

### 4.2 Rendering

The toggle is an inline SVG triangle, rotated by CSS, inside the row and **before** the label:

```html
<span class="twisty" aria-hidden="true"><svg …></svg></span>
```

`aria-hidden` because the toggle is decoration: the semantics live on the `treeitem`, which carries
`aria-expanded="true" | "false"`. Assistive technology therefore gets one correct treeitem rather than
a button inside an item, and the keyboard path is the row's, matching how VS Code's own tree behaves.

Children stay in the DOM and are hidden with a class rather than removed:

```css
.node[aria-expanded="false"] > .children { display: none; }
```

Rendering every subtree and hiding it is the cheap correct option; the existing keyboard navigation
already filters by `offsetParent`, so hidden children are skipped for free. The ceiling — a very large
file builds the whole DOM — is noted in §11 and is not addressed here.

### 4.3 Expand/collapse all

Two toolbar buttons: clear or fill `collapsed` with the ids of every node that has children, then
`applyCollapsed()`. Selection and scroll are left alone.

### 4.4 Filter interaction

While a filter is active, a match inside a collapsed subtree would be invisible. `applyFilter` therefore
records the pre-filter collapsed set, expands the ancestors of every match, and restores the set when
the filter is cleared. This is why the filter is in this child rather than a later one: with collapse
shipped, a filter that hides its own matches is worse than no filter.

## 5. Visual hierarchy

All of it is `--vscode-*` variables with fallbacks that are visible in any theme.

| Element | Treatment |
|---|---|
| Kind | A class on the row (`k-module`, `k-container`, `k-parameter`, `k-reference`) plus a left accent (`border-left: 2px solid …`) and a small kind glyph. Colour **and** shape, so high-contrast themes and colour-blind users still see the difference. |
| Module / container | Accent from `--vscode-symbolIcon-classForeground`; glyph a filled/outlined square |
| Parameter | `--vscode-symbolIcon-fieldForeground`; glyph a small dot; value in the editor font, `--vscode-symbolIcon-numberForeground` for numeric and `--vscode-symbolIcon-stringForeground` for textual (as today) |
| Reference | `--vscode-symbolIcon-referenceForeground`; glyph an arrow; the target keeps its underline and becomes the row's affordance rather than the whole row |
| Indentation | `border-left: 1px solid var(--vscode-tree-indentGuidesStroke, var(--vscode-panel-border, #80808040))` — the fallback chain is the fix for §1.3 |
| Row hover | `background: var(--vscode-list-hoverBackground)` |
| Selection, focused | `list-activeSelectionBackground` / `list-activeSelectionForeground` (as today) |
| Selection, unfocused | `list-inactiveSelectionBackground` / `list-inactiveSelectionForeground` — today's single rule is wrong whenever the webview is not focused |
| Alignment | The row becomes a two-column CSS grid: label column (fixed, ellipsised, `title` with the full text) and a details column. Values then line up vertically instead of wrapping. |
| Collapsed container | A count badge (`12`) in the details column so a closed container still says how much is inside |

Glyphs are **inline SVG** in the markup: the CSP is `default-src 'none'`, which blocks a font or image
file, but inline SVG is not a fetch, so no CSP change and no asset pipeline is needed.

## 6. Editing: make it visible, and stop discarding input

- The `.value` span gets `title="Click to edit, or press F2"`, a dotted bottom border, and a pencil
  glyph that appears on row hover. Its `cursor` becomes `text`.
- Since a click no longer reveals, clicking the value is unambiguous.
- On refusal, the input **stays open with the typed text**, gets `aria-invalid="true"` and a red-ish
  border, and the notice explains why. `endValueEdit(false)` is only called for `Escape`, a click
  outside, or a successful commit.
- On success the row is briefly highlighted so the change is visible in place.
- `Tab` / `Shift+Tab` inside the input commit and move to the next/previous editable value — the
  fastest way to fix several values in a row.

The widget's handler order and its `stopImmediatePropagation` calls are unchanged; the tree's click
handler keeps deferring to it. This is a contract between the two children and is called out in the
task's guardrails.

## 7. Filter feedback

- The toolbar shows `12 of 240` next to the filter box, and `No matches` when the count is zero.
- Matched substrings are wrapped in `<mark>` so the eye lands on the reason a row is shown.
- The filter keeps ancestors visible (it already does) and, per §4.4, expands them.
- `Escape` in the filter clears it and restores the collapsed set.

`filter.ts` gains a `matchRanges(haystack, query)` helper so the highlighting and the filtering use one
definition of "matches" — two definitions would drift.

## 8. Keyboard map

| Key | Action |
|---|---|
| `ArrowUp` / `ArrowDown` | Move focus among visible items |
| `ArrowRight` | Expand; if already expanded, focus the first child |
| `ArrowLeft` | Collapse; if already collapsed or a leaf, focus the parent |
| `Home` / `End` | First / last visible item |
| `PageUp` / `PageDown` | Move by a viewport of visible items |
| `Enter` | Toggle, or reveal for a leaf |
| `Ctrl+Enter` / `Alt+Enter` | Reveal |
| `F2` | Edit the value |
| `Space` | Select only |
| Printable characters | Type-ahead over visible labels (2 s window) |
| `Escape` (in the filter) | Clear the filter |

`PageUp`/`PageDown` move by `Math.max(1, Math.floor(main.clientHeight / rowHeight))` items, computed
from the average row height, rather than a fixed count.

## 9. Accessibility contract

- Every item: `role="treeitem"`, `aria-level`, `aria-posinset`, `aria-setsize` (within its group),
  `aria-expanded` on nodes with children, `aria-selected` on the selected node.
- The roving `tabindex` stays as it is (one `0`, the rest `-1`).
- The twisty and the kind glyph are `aria-hidden="true"`.
- The filter reports its result count through the existing `role="status"` live region, so a screen
  reader hears "3 of 240" as it changes.
- Focus is drawn with `--vscode-focusBorder`, which is already guaranteed to contrast in
  high-contrast themes; the background fill is supplementary, not the only signal.
- `prefers-reduced-motion` disables the twisty rotation transition.

## 10. Settings

| Setting | Values | Default | Meaning |
|---|---|---|---|
| `arxmlScope.ecuc.editor.revealMode` | `beside`, `focus`, `replace` | `beside` | Where the source opens and whether focus moves |

One setting only. A "collapse everything on open" preference is speculative and is not added until
someone asks for it.

## 11. Risks and ceilings

- **State preservation is the hard part, and it is a prerequisite.** The provider re-renders on every
  document change. If `applyCollapsed` / scroll restoration is wrong, the tree visibly jumps while the
  user types in the XML — worse than today. This is why §4 ships with R-UX4 in the same change.
- **Double-click and the second click event.** The first click of a double-click already selects; that
  is harmless and is what file trees do. Do not "fix" it by delaying selection.
- **The value widget's claim on the click.** The widget's listener runs first and stops propagation.
  Any new tree click handling must keep working when the widget has claimed the event; the ordering is
  load-bearing.
- **Lazy rendering is not implemented.** A very large file builds the entire DOM. The scanner is
  already a single pass, so this is the remaining scaling risk; measure before changing it, and do not
  add virtualisation speculatively.
- **No asset pipeline.** Everything is inline. If a future change wants a font or an image, it needs a
  CSP change (`font-src` / `img-src`) *and* an esbuild asset step; neither exists today, which is why
  the glyphs are inline SVG.
- **Reveal when the custom editor is in a single group.** `ViewColumn.Beside` creates a split. That is
  the intended behaviour (the tree stays visible), but it changes the layout the user had, so
  `revealMode: replace` exists for anyone who prefers the old behaviour.

## 12. Testing strategy, and what cannot be tested

The test host has no webview DOM, so the split is explicit:

- **Asserted on the rendered markup string** (most of it): the twisty's presence and absence, the
  `aria-expanded` value, the kind classes and glyphs, the indent-guide fallback, the `N of M` text,
  the `<mark>` wrapping, the empty state, `aria-posinset` / `aria-setsize`, the value span's
  editability affordance.
- **Asserted through the real editor**: that a click-driven reveal leaves the custom editor open
  (the tab is still there and the text editor is in a different column), and that a reveal in
  `replace` mode still swaps as documented.
- **Asserted through the host**, by extracting the inline script: that the `model` handler restores the
  collapsed set and the scroll position — the script can be exercised against a stub DOM, or at
  minimum its shape asserted. If a stub DOM is not feasible, this must be stated as manually verified,
  not implied.
- **Manually verified, and recorded as such**: the twisty's hit area, hover affordances, the
  double-click gesture, and the drag-free feel of the tree. These are exactly what the user is
  complaining about, so the checklist in `implement.md` has a manual section and the outcomes go in
  this task's `implement.md` when someone runs it.

## 13. Node identity: a collision this child has to fix

The parent integration review found that `nodeId.ts` builds a container id from the container's path
and short-name only:

```
container:<containerPath>/<shortName>
```

Two sibling containers that share a `SHORT-NAME` therefore produce the **same** id — observed as
`byId.size === 4` for a 5-node fixture. Nothing writes wrongly today (the write path resolves by id and
the bytes are then guarded), but a *reveal* can select the wrong sibling, which is squarely this
child's subject: it is about where a click takes you.

Parameters already solved this: their id carries a per-owner ordinal (`<owner>/param:<tail>#<n>`).
Containers and modules simply never got one. The fix is to give them the same treatment:

```
container:<containerPath>/<shortName>#<ordinal>
```

Two properties must hold, and both are why the ordinal cannot be the obvious one:

- **Stable across a re-scan.** The ordinal comes from the **raw** model's document order, not from the
  display order. Ordering functions are pure and the model is unchanged by them, so this is the same
  source `nodeId` already uses — but it must be computed before any ordering is applied, or changing
  `arxmlScope.ecuc.editor.sort` would renumber ids and break the editing child's re-resolution
  (parent design §2.2 of that child).
- **Independent of the sort mode.** Covered by the same rule; asserted by a test that renders under
  both `all` and `declaration` and compares ids.

`src/core/**` is not touched: this is an identity scheme, not a parsing rule, and the ordinal is
derivable from the model that already exists.

Nothing persists an id across sessions — the webview holds them in memory and the host rebuilds them
from the model — so changing the scheme breaks no stored state. The editing child's suite is the
regression test for that claim.
