# ARXML Scope editor context submenu

## Goal

Put the two ARXML editor actions under one **ARXML Scope** submenu in the text editor's context
menu, and keep "Reveal in ECUC Editor" out of the Explorer context menu. "Open with ECUC Editor"
remains available where a file can be opened.

## Confirmed facts

- `package.json` currently contributes `openEcucEditor` to `explorer/context`, and both
  `openEcucEditor` and `revealInEcucEditor` as flat, top-level entries in `editor/context`
  (`package.json`, `contributes.menus`).
- No submenu is contributed today.
- `revealInEcucEditor` maps the cursor in the active text editor to an ECUC node and opens the
  custom editor at it (`src/commands.ts:76`). It is meaningful only when a text editor has a
  cursor, so the Explorer has nothing useful to reveal from.
- The sibling extension `vscode-hex-scope` uses a contributed submenu (`hexScope.actions`) with a
  label and attaches it to `explorer/context`, `editor/context` and title menus. Its editor entry
  is suppressed for its own custom editor via
  `activeCustomEditorId != 'hexScope.hexEditor'` (`package.json`).
- `activeCustomEditorId` and `editorTextFocus` are standard VS Code context keys. A submenu item's
  `when` is evaluated in the current context, so a shared submenu needs an editor-specific key to
  keep an item out of the Explorer.

## Requirements

- **R1** Contribute one submenu:

  ```json
  "submenus": [{ "id": "arxmlScope.actions", "label": "ARXML Scope" }]
  ```

- **R2** `editor/context` contributes only the submenu for ARXML actions; the two commands are no
  longer flat entries.
- **R3** The submenu contains:
  - "Open with ECUC Editor" — visible for `.arxml` files in both contexts.
  - "Reveal in ECUC Editor" — visible only in a focused text editor and never for the extension's
    own custom editor. Use a `when` that combines `resourceExtname == .arxml`,
    `activeCustomEditorId != 'vscode-arxml-scope.ecucEditor'` and `editorTextFocus`.
- **R4** `explorer/context` uses the same submenu (so a future compare action has one home) and
  does not contribute `revealInEcucEditor` directly. The reveal item's `when` is false in the
  Explorer, so it never appears there.
- **R5** Command ids, titles and categories do not change; both commands remain available from the
  command palette and keep their current behaviour.
- **R6** No second submenu with the same label is contributed.

## Acceptance criteria

- [ ] **AC1** `package.json` has exactly one submenu with label `ARXML Scope`.
- [ ] **AC2** The submenu item list contains `vscode-arxml-scope.openEcucEditor` and
  `vscode-arxml-scope.revealInEcucEditor`.
- [ ] **AC3** `editor/context` contributes the submenu and has no flat entries for either command.
- [ ] **AC4** The reveal item's `when` excludes the ECUC custom editor and requires text-editor
  focus, so it cannot appear in the Explorer.
- [ ] **AC5** `explorer/context` contributes the submenu and no direct reveal entry.
- [ ] **AC6** Running both commands from the palette still works (existing activation tests pass).
- [ ] **AC7** All existing manifest assertions (custom editor selector/priority, empty activation
  events, no default association) still pass.

## Out of scope

- Adding new commands or changing command titles.
- A title-bar or tab context menu contribution.
- Removing commands from the command palette.
- Changing how `revealInEcucEditor` maps a cursor to a node.

## Dependencies

- None for the submenu itself.
- The semantic diff task adds its compare commands to this submenu after it exists. Do not create
  a second submenu there.
