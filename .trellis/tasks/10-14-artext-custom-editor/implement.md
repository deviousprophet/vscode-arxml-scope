# Implementation plan: ARTEXT custom editor for ECUC-Values arxml

Ordered checklist for this child. Design: `design.md` + `../10-14-ecuc-artext-editor/design.md`
§6, §9, §10, §11. Do not start before child `../10-14-ecuc-model-scanner` is complete and parent
**Spike B** has been recorded, since §2.3 of the design depends on its outcome.

## Order

- [ ] 1. `package.json` — `contributes.customEditors` (`vscode-arxml-scope.ecucEditor`,
      `selector: [{ filenamePattern: '*.arxml' }]`), the three commands, `explorer/context` and
      `editor/context` menu entries enabled for `.arxml`, and the two `arxmlScope.ecuc.editor.*`
      settings with the 15-entry default. Do **not** add an `activationEvents` entry for the view
      type that claims `.arxml` by default (parent D14).
- [ ] 2. `src/commands.ts` — `openEcucEditor` gates on `.arxml` + detection, then
      `vscode.openWith(uri, 'vscode-arxml-scope.ecucEditor')`; a failed gate explains and returns.
      Register `revealInSource` and `revealInEcucEditor` here too.
- [ ] 3. `src/editor/ecucEditorProvider.ts` — the lifecycle of `design.md` §1 in that exact order, so
      a rejected file never renders HTML.
- [ ] 4. `src/editor/nodeId.ts` — path-based, re-scan-stable node ids (`design.md` §2.2).
- [ ] 5. `src/editor/renderHtml.ts` — inlined CSS/JS, `nonce`, CSP meta, `--vscode-*` variables only.
- [ ] 6. `src/editor/renderHtml.ts` — the display rules of parent §6: module path and variant,
      container tail, parameter value plus secondary hex, reference target plus instance context,
      `[SW-SYSCOND]`, `<Ref == value>` conditions, `/* [Label] text */` annotations including the
      unlabelled case, and the schema release.
- [ ] 7. `src/editor/renderHtml.ts` — full `DEFINITION-REF` path in `title` for containers and
      parameters (`design.md` §2.7).
- [ ] 8. `src/editor/renderHtml.ts` — tree ARIA roles, `tabindex`, arrow traversal, Enter to activate,
      visible focus.
- [ ] 9. `src/editor/filter.ts` — client-side filter over label/short-name/value, keeping ancestors of
      a match (`design.md` §2.5).
- [ ] 10. `src/editor/navigation.ts` — both reveal directions over the shared mapping; the
      source-side offset → innermost node lookup is a binary search over ranges
      (`design.md` §2.3, §2.4).
- [ ] 11. `src/editor/ecucEditorProvider.ts` — the `didChangeTextDocument` re-scan subscription and
      complete disposal; verify no listener outlives the panel.
- [ ] 12. `src/test/fixtures/editor/*.arxml` — a render fixture exercising every display rule above,
      and a reference fixture with a same-file target, an absent path and an ambiguous suffix.
- [ ] 13. `src/test/editor/*.test.ts` — per the table below.

## Test coverage

| Test file | Assertions |
|---|---|
| `activation.test.ts` | AC2, AC3 — non-ECUC and non-`.arxml` fall back with an explanation; a normal open still uses the text editor |
| `render.test.ts` | AC1 — rendered HTML contains the expected label, value, hex, variant, condition and annotation for the fixture |
| `reveal.test.ts` | AC4, AC5 — both directions, including an offset inside a value selecting its parameter and an offset on a tag selecting that element |
| `references.test.ts` | AC6 — same-file target selected; absent and ambiguous each noticed, nothing thrown |
| `filter.test.ts` | AC7 — narrowing and restoring |
| `a11y.test.ts` | AC8 — the rendered tree exposes tree roles and the expected keyboard affordances |

Assertions on rendered HTML are made against the string returned by `renderHtml`, not through a live
webview, wherever the webview adds no coverage. Only the cases that need the real document lifecycle
(AC2, AC4, AC5, AC9) use a live editor, since webview-driven tests are slow and brittle.

## Validation commands

| Purpose | Command |
|---|---|
| Types | `npm run check-types` |
| Lint | `npm run lint` |
| Full suite | `npm test` |

## Done when

- [ ] AC1–AC10 in `prd.md` pass.
- [ ] `npm run check-types`, `npm run lint`, `npm test` are green.
- [ ] AC3 is confirmed **explicitly** — a normally-opened `.arxml` still uses the text editor.
- [ ] AC9 is confirmed **explicitly** — a full activation-and-navigation flow creates no file.
- [ ] No listener or panel handler survives disposal (inspect, do not assume).

## Rollback

Additive: new files under `src/editor/` and `src/test/editor/`, plus `package.json` contribution
entries. Nothing in the core child changes. If Spike B's outcome makes live pairing impossible, AC4
and AC5 remain satisfiable as two commands — record the degradation in `prd.md` rather than inventing a
second editor pane the platform cannot show.

## Guardrails

- Do not claim `.arxml` by default, and do not add a default `workbench.editorAssociations` entry
  (parent D14).
- Do not add a runtime dependency; the webview is plain HTML/CSS/JS.
- Do not hard-code a colour; `--vscode-*` variables only (parent R16).
- Do not reintroduce the ARTEXT text form, grammar, `Open as ARTEXT` or Compare (parent D4).
- Do not write any file (parent D15).
