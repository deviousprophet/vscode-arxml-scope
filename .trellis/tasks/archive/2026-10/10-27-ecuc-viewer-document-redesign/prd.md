# ECUC viewer document-style redesign

## Goal

Replace the default ECUC viewer presentation with a **dense, monospace, syntax-highlighted document**
modelled on the post-processed ARTEXT reference, because the current two-line row grid — fixed columns,
chips, per-row accents and a permanently open details panel — is hard to read and does not feel like
the ECUC data. The same tree data and interactions stay; the current tree becomes an optional **Tree**
view, and the details panel becomes secondary (hidden by default).

## Reference

`research/reference-artext/` contains the reference capture:

- `display-rules.artext` — output of the remote `ref/ecucvalues-for-vscode` tool (`mmx` +
  `Arxml2Artext.mm`) after the extension's `postProcessArtextGen` whitespace collapse (`[(A == B)]`
  → `[(A==B)]`).
- `display-rules-highlighted.html` — a research mock using the grammar scopes and VS Code Dark+
  token colours.
- `README.md` — the exact command, post-processing and scope mapping.

The reference is a monospace document: one entity per line, 4-space indentation, `{`/`}` around
children, semantic token colours, no chips/cards, and comments for conditions/annotations. It is a
reference for the *look*, not a file format to reintroduce; the ARTEXT text artefact remains dropped
(parent PRD).

## Scope

**In**

- A **Document** view as the default for the ECUC editor: monospace, one visual line per entity,
  4-space indentation, braces, semantic token colours, comments for conditions/annotations.
- A **Tree** view toggle retaining the current tree; the same DOM, data attributes, roles and
  interactions drive both.
- A details panel that is **hidden by default** in document view, shown from the toolbar; its state
  and the view mode persist through the webview state.
- Semantic token colours for schema/package/module/context keywords, strings/short names, numbers and
  hex, booleans, entity/type/variable names, reference targets, conditions and annotations.
- Visual verification in light, dark and high contrast; performance check on `sample/large` and
  `sample/huge`; tests and docs.

**Out**

- Changes to parsing, ordering, validation, the write path or `src/core/**`.
- A new runtime dependency, asset file, remote load, or an ARTEXT text file in the product.
- Structural editing, virtualisation, cross-file resolution, or a workspace index.
- Removing the current tree; it remains available as the **Tree** view.
- A real VS Code webview claim. The browser harness is page-side evidence only.

## Requirements

- **R-UI1 — Reference is captured and post-processed.** The reference `.artext` is generated from the
  remote branch's tool, then the extension's `postProcessArtextGen` is applied. The capture and the
  command are recorded in `research/reference-artext/`; the reference is not shipped.
- **R-UI2 — Document is the default.** The editor opens in Document view: one visual line per node,
  monospace editor font, 4-space indentation, `{`/`}` around child groups, no two-line grid, no chips,
  no fixed 26ch label column and no per-row coloured border.
- **R-UI3 — Content is unchanged.** The Document view still shows every parent §6 field: schema,
  package, module full `DEFINITION-REF`/short name/variant, container tail/short name, parameter
  name/value/hex, reference name/target/context, conditions and annotations. It changes presentation
  only.
- **R-UI4 — Semantic tokens.** The reference grammar scopes map to theme variables: keywords,
  strings/short names, numbers/hex, booleans, entity/type/variable names, reference targets,
  conditions and comments/annotations. Every colour is a `--vscode-*` variable with a fallback.
- **R-UI5 — The tree is still available.** A toolbar **View** toggle switches between Document
  (default) and Tree; the same rows/roles/aria/interactions are used, and the toggle state persists
  across a reload.
- **R-UI6 — Details are secondary.** The details panel starts hidden in Document view, giving the
  document the full width. The **Details** toolbar button shows it; its state persists. In Tree view
  the panel follows the same toggle.
- **R-UI7 — Interactions survive.** Click selects, twisty collapses, double-click/Ctrl+Alt+Enter
  reveals, reference target follows, filter/count/empty state, inline value editing, reveal, copy and
  the keyboard map all work in Document view. The value widget's event ownership and
  `stopImmediatePropagation` contract are unchanged.
- **R-UI8 — Accessibility and contrast.** Real tree roles/levels/selection/expansion, focus ring,
  Home/End/PageUp/PageDown and aria attributes remain. Selected and focused rows are readable in
  light/dark/high contrast; the document uses the editor font fallback and a readable line height.
- **R-UI9 — Performance does not regress.** `sample/large` (4,001 nodes) and `sample/huge` (12,001)
  still load and filter; the document mode is CSS/presentation over the same DOM, not a second render
  pass. Record the page load/filter observations; no virtualisation.
- **R-UI10 — Dev-only and tested.** No new dependency/asset, no manifest takeover, `src/core/**`
  untouched, no new document write. Existing tests stay green; new tests cover the default view,
  toggles, hidden details, document CSS and token classes; documents and the reference capture are
  updated.

## Acceptance Criteria

- [x] **AC1** `research/reference-artext/` contains the post-processed `.artext`, the scoped HTML
      mock and a README with the exact `mmx` command and the `postProcessArtextGen` regex. The raw
      output before post-processing is described, not claimed as the reference.
- [x] **AC2** The editor opens with `data-view="document"`; a row is one visual line; the document
      uses the editor monospace font, 4-space indentation and braces; no chips, two-line grid, fixed
      label column or per-row coloured border. Light/dark/HC captures show it.
- [x] **AC3** Document tokens have distinct classes/colours for keyword, string, number/hex, boolean,
      entity/type/variable, reference target, condition and annotation; every colour is a
      `--vscode-*` variable with a fallback. A test asserts the classes and the fallback chain.
- [x] **AC4** Module/container/parameter/reference rows still show all parent §6 fields; a content
      test compares the document and tree views for the same labels/values/suffixes.
- [x] **AC5** The View toggle switches Document/Tree, exposes its state, and the choice survives a
      reload through `getState()/setState()`; Tree view still looks/works as before.
- [x] **AC6** Details is hidden by default; the Details toggle shows it and gives the document full
      width when hidden; the state persists; the inspector content is unchanged when shown.
- [x] **AC7** All interactions still work in Document view: select/collapse/reveal/follow/filter/
      inline edit/copy/keyboard; the value widget's first-listener contract still holds.
- [x] **AC8** `npm run check-types`, `npm run lint`, `npm test` and `npm run preview:check` are green;
      new tests fail when the document class/view toggle/default-hidden details are removed.
- [x] **AC9** `sample/large` and `sample/huge` load/filter in Document view; the page-load/filter
      observations are recorded against the previous 1.3 s/7.3 s, 45 ms/125 ms observations; no
      virtualisation.
- [x] **AC10** `docs/ECUC_EDITOR.md` describes Document as the default, the Tree toggle, the hidden
      details panel and the reference capture; `src/core/**`, `dependencies`, the manifest priority and
      the write path are untouched.

## Constraints

- The Document view is **CSS/presentation over the existing tree DOM**, not a second renderer and not
  a new model. It must not break `.value` as a direct child, the value-widget listener order,
  `matchRanges`, filter/collapse state or the node ids.
- No new runtime dependency or asset. Inline SVG is allowed; fonts are the editor font with a system
  fallback; no remote loads.
- The reference `.artext` capture is synthetic sample data and stays in the task research; it is not
  wired into the product and does not reintroduce the `.artext` file format.
- Any behaviour needing a real webview DOM is recorded as harness-observed or unverified; the browser
  harness is not a VS Code webview. Real VS Code theme/performance/focus remains an Extension
  Development Host check.
- The current tree, inspector content, write path and core parser/ordering/validation remain
  functionally unchanged.
