# ARTEXT custom editor for ECUC-Values arxml

The editor surface: renders the parent task's model as an interactive tree inside a VS Code custom
editor, and provides navigation between that tree and the raw XML.

Parent requirement IDs (R1–R18), decisions (D1–D16) and the full rationale live in
`../10-14-ecuc-artext-editor/prd.md` and `../10-14-ecuc-artext-editor/design.md`. The acceptance
criteria below are **child-local**; parent-level criteria that span children are in the parent PRD.

## Goal

A user can open an ECUC-Values `.arxml` in a readable, navigable view — the information the legacy
ARTEXT mapping conveys, presented as a document tree instead of text — and move between that view and
the raw XML without leaving VS Code.

## Prerequisites

- `../10-14-ecuc-model-scanner` complete: the model, ranges, ordering, resolution and validation all
  exist and are tested. This child consumes them and adds no parsing of its own.
- Parent plan **Spike B** (`../10-14-ecuc-artext-editor/implement.md` §Step 0) has settled whether a
  live two-way split with the text editor is achievable. The outcome decides the reveal mechanism
  only; the criteria below are satisfiable either way.

## Scope

- `package.json` contributions: the `customEditors` entry, three commands, two settings, menu entries.
- `CustomTextEditorProvider` and its document/panel lifecycle.
- HTML rendering of the model, including theming and focus handling.
- The activation gate, the filter, bidirectional reveal, and same-file reference following.
- Editor-level integration tests.

## Requirements

- Open a detected ECUC-Values `.arxml` in the custom editor **only** when explicitly asked, and never
  claim the default for `.arxml` (parent D14, R15).
- Refuse politely rather than render an empty shell: a file that is not `.arxml`, or is `.arxml`
  without ECUC values, falls back to the text editor with an explanation (parent R2).
- Present the information the legacy mapping conveys — module, containers, parameters, references,
  variant, conditions, annotations, schema release — with layout independence and no loss beyond the
  dropped text form (parent D4, D6, R7).
- Label an element by its `DEFINITION-REF` tail, expose the full path on hover, and show a numeric
  value's hexadecimal form as secondary information (parent D8, R8).
- Reveal a node's source range in the text editor, and, from the text editor, open the custom editor
  at the innermost node under the cursor (parent R9).
- Follow a same-file reference to its target; do nothing noisy when the target is absent or ambiguous
  (parent D9, R10).
- Provide a filter over labels, short-names and values, and full keyboard traversal (parent D10, R14,
  R16).
- Write nothing to the workspace, and leave no artefact beside the user's file (parent D15, R11).

## Acceptance criteria

- [ ] AC1. Every entity the model carries is rendered with the correct label and value: module with its
      dotted `DEFINITION-REF` path and variant, containers by tail, parameters by tail with value and
      numeric hex, references by tail with target, and all condition and annotation suffixes including
      an annotation with no label. The schema release is shown.
- [ ] AC2. A non-ECUC `.arxml` and a non-`.arxml` file each produce an explanation and the text editor,
      never an empty custom view.
- [ ] AC3. An `.arxml` opened normally still opens in the text editor; the custom editor claims the
      default only after the explicit command (parent D14).
- [ ] AC4. Invoking reveal from a parameter, a container and a reference selects the corresponding
      source range in the text editor, and an offset inside the element's own text selects that
      element, not an ancestor.
- [ ] AC5. Invoking reveal from a text cursor opens the custom editor with the innermost containing
      node selected — for a value range, the surrounding parameter; for a tag, that element.
- [ ] AC6. Following a same-file reference selects the target; an absent path and an ambiguous suffix
      each produce a message and no navigation, with no exception thrown.
- [ ] AC7. The filter hides non-matching nodes at every level, matches on label, short-name and value,
      and restoring the empty filter restores the full tree.
- [ ] AC8. Arrow keys traverse the tree, Enter activates the focused node, and focus is always visible
      with a theme colour.
- [ ] AC9. No file is created, modified or deleted anywhere near the opened file during activation,
      rendering or navigation (parent R11, AC10).
- [ ] AC10. `npm run check-types`, `npm run lint` and `npm test` pass.

## Out of scope

- Editing: this child renders and navigates only. Writes belong to `../10-14-ecuc-value-editing`.
- The ARTEXT text form, the TextMate grammar, `Open as ARTEXT` and Compare (parent D4).
- Cross-file resolution and any workspace index (parent D7).
- Virtualisation of very large trees: measure before optimising (parent `design.md` §15.5).
- Charts, dashboards, summaries — the view is a document tree.

## Constraints

- No new runtime dependency (parent D7). The webview is plain HTML, CSS and JavaScript; assets are
  inlined because the CSP forbids remote loads.
- All colours come from `--vscode-*` CSS variables so light, dark and high-contrast themes work
  (parent R16).
- The provider must not leak: every subscription and panel handler is disposed.
- The extension must remain usable with `ecucvalues-for-vscode` installed; no shared identifiers, no
  reading or writing `.artext_cache`.
