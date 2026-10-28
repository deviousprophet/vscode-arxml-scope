# ECUC editor UX overhaul

Make the ECUC editor usable for *reading*. Today a single click on any node replaces the custom editor
with the XML text editor, containers cannot be collapsed, and the tree has no visual hierarchy — so the
view cannot be used to browse a file, which is its primary purpose.

Parent requirement IDs (R1–R18), decisions (D1–D16) and the rationale live in
`../10-14-ecuc-artext-editor/prd.md` and `../10-14-ecuc-artext-editor/design.md`. The acceptance
criteria below are **child-local**.

## Goal

A user can open an ECUC file, read and browse it — expanding and collapsing containers, filtering,
selecting, following a reference — without being thrown into the raw XML, and can still reach the
source deliberately when they want it. The tree reads as a hierarchy in a light, dark or
high-contrast theme.

## Prerequisites

- `../10-14-artext-custom-editor` complete: the provider, the webview page, `renderTree`, the filter,
  `nodeId` and the navigation helpers all exist and are what this child changes.
- `../10-14-ecuc-value-editing` complete: the in-tree value widget registers its click and key
  handlers **first** and relies on `stopImmediatePropagation` to keep the tree from also acting on an
  interaction it claimed. Any change to the tree's click model must keep that contract.
- Not gated on a spike.

## Scope

**In**

- The interaction model: what a click, a double-click and each key do, and what "reveal" costs the
  user.
- Collapse and expand, with the state surviving a re-scan.
- Visual hierarchy: per-kind distinction, indentation, hover, selection, alignment.
- Discoverability of the existing edit feature, and keeping the typed text when a write is refused.
- Filter feedback, and the accessibility attributes that make the tree navigable.

**Out**

- What is displayed. The parent §6 display rules — which entity shows which parts, in which order —
  are unchanged. This child changes presentation, not content.
- The write path. No new write, no change to validation, no change to what is escaped.
- Structural editing, cross-file resolution, a workspace index.
- Virtualisation or lazy subtree rendering. The ceiling is noted in `design.md` and measured before it
  is raised.
- Any new runtime dependency, and any asset file (the CSP forbids remote loads and `esbuild.js` has no
  asset-copy step).

## Requirements

- **R-UX1 — A click must never change which editor is visible.** Selecting a node, toggling a
  container and clicking a row's empty space are all in-place interactions.
- **R-UX2 — Reveal is deliberate and non-destructive.** Reaching the source must not close or replace
  the custom editor, and must not steal focus by default. It is available from an explicit affordance
  and a key.
- **R-UX3 — Containers collapse.** A container or module with children has a visible toggle, clickable
  and reachable from the keyboard, with its state exposed to assistive technology.
- **R-UX4 — View state survives a re-scan.** The provider re-renders the tree on **every** document
  change. The collapsed set, the selection, the filter text and the scroll position must all survive
  that, or collapse is unusable.
- **R-UX5 — Kinds are distinguishable without relying on colour alone**, in light, dark and
  high-contrast themes.
- **R-UX6 — Indentation is visible** in themes that do not define the tree indentation variable.
- **R-UX7 — Editing is discoverable**, and a refused write keeps what the user typed.
- **R-UX8 — The filter reports what it did**: how many of how many, an explicit empty state, matches
  highlighted, and the ancestors of a match shown.
- **R-UX9 — Accessibility**: real `aria-expanded` / `aria-selected` / `aria-posinset` / `aria-setsize`,
  a complete key map including Home/End/PageUp/PageDown, and a focus ring taken from the theme.
- **R-UX10 — No new runtime dependency, no asset file, and every colour a `--vscode-*` variable with a
  usable fallback.** The webview is a plain inlined page with a nonce and a CSP.
- **R-UX11 — The read-only invariant is unchanged.** This child adds no write path.
- **R-UX12 — A new setting is declared with a default and documented** in `docs/ECUC_EDITOR.md`.
- **R-UX13 — Node identity is unambiguous.** Two siblings sharing a `SHORT-NAME` must not share an
  identifier, so a reveal or an edit can never land on the wrong node. Ids must stay stable across a
  re-scan, and must be derived from the document's own order rather than from the displayed order.

## Acceptance Criteria

- [ ] **AC1** Clicking a node — its label, its metadata, or the empty space of its row — selects it,
      keeps the custom editor open and focused, and opens no text editor.
- [ ] **AC2** A deliberate reveal (double-click, the row's affordance, or the key) shows the node's
      range in the source **without closing the custom editor**; the ECUC editor is still open
      afterwards, and focus stays in the tree unless the user asked otherwise.
- [ ] **AC3** A module or container with children renders a toggle; clicking it hides or shows its
      children, and `aria-expanded` follows the state. A node without children has no toggle.
- [ ] **AC4** With a container collapsed, a re-scan (a document change) preserves the collapsed set,
      the selection and the scroll position. Pruning: an id that no longer exists is dropped without
      affecting the others.
- [ ] **AC5** The toolbar offers expand-all and collapse-all, and both leave the selection intact.
- [ ] **AC6** Each kind — module, container, parameter, reference — carries a distinct class and a
      distinct marker, asserted on the rendered markup.
- [ ] **AC7** Indentation guides are visible when the theme does not define
      `--vscode-tree-indentGuidesStroke`: the declared fallback is not `transparent`.
- [ ] **AC8** A parameter's value advertises that it is editable (hover affordance and tooltip), and
      `F2` and a click on the value still start an edit. A refused write keeps the typed text in the
      input and marks it invalid rather than discarding it.
- [ ] **AC9** While filtering, the toolbar reports "shown of total"; a filter that matches nothing
      says so explicitly; matched text is wrapped in a highlight element; a collapsed ancestor of a
      match is shown, and clearing the filter restores the previous collapsed set.
- [ ] **AC10** `aria-expanded`, `aria-selected`, `aria-posinset` and `aria-setsize` are present and
      correct on the items that need them; Home, End, PageUp and PageDown move focus as expected.
- [ ] **AC11** `package.json` `dependencies` is unchanged, no asset file was added, and every colour
      introduced resolves to a `--vscode-*` variable with a non-transparent fallback where the theme
      may not define one.
- [ ] **AC12** `npm run check-types`, `npm run lint` and `npm test` are green (96 passing before this
      child), and no write path was added.
- [ ] **AC13** Two sibling containers with the same `SHORT-NAME` receive distinct ids, and revealing
      either one selects that one. The ids are unchanged by a sort-mode change and by a re-scan.

## Constraints

- The value widget's handlers must keep working unchanged: they are registered before the tree's and
  use `stopImmediatePropagation` (`src/editor/ecucValueEditor.ts`).
- The webview cannot fetch anything. Inline SVG is allowed; a font or image file is not.
- The custom editor must still never claim `.arxml` by default (`priority: "option"`), and the
  no-takeover criterion from the editor child must not regress.
- `src/core/**` is untouched by this child: nothing here changes parsing, ordering or validation.
- A behaviour that the test host cannot exercise — anything needing a real webview DOM — must be
  recorded as manually verified or unverified, never implied to have passed.

## Notes

- The three defects this child exists for are rooted in specific lines and are documented with
  evidence in `design.md` §1. They are not stylistic preferences.
- Because the tree re-renders on every document change, R-UX4 is a prerequisite for R-UX3, not a
  companion to it. Implementing collapse first would produce a tree that springs open while the user
  types in the XML.
