# ARXML Scope editor context submenu — implementation plan

## Checklist

- [ ] Add `contributes.submenus` with `arxmlScope.actions` / `ARXML Scope`.
- [ ] Replace the two flat `editor/context` entries with one
  `{ "submenu": "arxmlScope.actions", "when": "resourceExtname == .arxml && activeCustomEditorId != 'vscode-arxml-scope.ecucEditor'", "group": "navigation" }`.
- [ ] Replace the flat `explorer/context` open entry with the same submenu contribution.
- [ ] Add `contributes.menus["arxmlScope.actions"]`:
  - `openEcucEditor`, group `navigation`.
  - `revealInEcucEditor`, group `navigation`, `when`:
    `resourceExtname == .arxml && activeCustomEditorId != 'vscode-arxml-scope.ecucEditor' && editorTextFocus`.
- [ ] Add `src/test/editor/menus.test.ts` reading `package.json` and asserting AC1–AC5.
- [ ] Run `npm run check-types && npm run lint && npm test`.

## Review notes

- Keep `openEcucEditor` visible in the Explorer submenu; that is the replacement for the old flat
  entry.
- Do not add compare commands here; the diff child owns them.
- `editorTextFocus` is the discriminator that keeps Reveal out of the Explorer; do not drop it.
- If VS Code shows the submenu in your own custom editor despite the guard, add the same guard to
  the reveal item's `when` (already present) and verify in the Extension Development Host.

## Rollback

Manifest-only change. Revert the `submenus` block, the `arxmlScope.actions` menu block, and restore
the two flat `editor/context` entries plus the flat `explorer/context` entry.
