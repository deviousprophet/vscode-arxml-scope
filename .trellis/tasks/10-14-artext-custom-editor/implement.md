# Implementation plan: ARTEXT custom editor for ECUC-Values arxml

Ordered checklist for this child. Design: `design.md` + `../10-14-ecuc-artext-editor/design.md`
§6, §9, §10, §11. Do not start before child `../10-14-ecuc-model-scanner` is complete and parent
**Spike B** has been recorded, since §2.3 of the design depends on its outcome.

## Order

- [x] 1. `package.json` — `contributes.customEditors` (`vscode-arxml-scope.ecucEditor`,
      `selector: [{ filenamePattern: '*.arxml' }]`), the three commands, `explorer/context` and
      `editor/context` menu entries enabled for `.arxml`, and the two `arxmlScope.ecuc.editor.*`
      settings with the 15-entry default. Do **not** add an `activationEvents` entry for the view
      type that claims `.arxml` by default (parent D14). **Also `"priority": "option"` — see
      §Outcome 1; without it the selector *does* claim the default.**
- [x] 2. `src/commands.ts` — `openEcucEditor` gates on `.arxml` + detection, then
      `vscode.openWith(uri, 'vscode-arxml-scope.ecucEditor')`; a failed gate explains and returns.
      Register `revealInSource` and `revealInEcucEditor` here too.
- [x] 3. `src/editor/ecucEditorProvider.ts` — the lifecycle of `design.md` §1 in that exact order, so
      a rejected file never renders HTML.
- [x] 4. `src/editor/nodeId.ts` — path-based, re-scan-stable node ids (`design.md` §2.2).
- [x] 5. `src/editor/renderHtml.ts` — inlined CSS/JS, `nonce`, CSP meta, `--vscode-*` variables only.
- [x] 6. `src/editor/renderHtml.ts` — the display rules of parent §6: module path and variant,
      container tail, parameter value plus secondary hex, reference target plus instance context,
      `[SW-SYSCOND]`, `<Ref == value>` conditions, `/* [Label] text */` annotations including the
      unlabelled case, and the schema release. **The `/* … */` wrapper is dropped — see §Outcome 6.**
- [x] 7. `src/editor/renderHtml.ts` — full `DEFINITION-REF` path in `title` for containers and
      parameters (`design.md` §2.7).
- [x] 8. `src/editor/renderHtml.ts` — tree ARIA roles, `tabindex`, arrow traversal, Enter to activate,
      visible focus.
- [x] 9. `src/editor/filter.ts` — client-side filter over label/short-name/value, keeping ancestors of
      a match (`design.md` §2.5).
- [x] 10. `src/editor/navigation.ts` — both reveal directions over the shared mapping; the
      source-side offset → innermost node lookup is a binary search over ranges
      (`design.md` §2.3, §2.4).
- [x] 11. `src/editor/ecucEditorProvider.ts` — the `didChangeTextDocument` re-scan subscription and
      complete disposal; verify no listener outlives the panel.
- [x] 12. `src/test/fixtures/editor/*.arxml` — a render fixture exercising every display rule above,
      and a reference fixture with a same-file target, an absent path and an ambiguous suffix.
- [x] 13. `src/test/editor/*.test.ts` — per the table below.

## Test coverage

| Test file | Assertions |
|---|---|
| `activation.test.ts` | AC2, AC3 — non-ECUC and non-`.arxml` fall back with an explanation; a normal open still uses the text editor; AC9 — no file created |
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

- [x] AC1–AC10 in `prd.md` pass.
- [x] `npm run check-types`, `npm run lint`, `npm test` are green (67 passing, 0 failing).
- [x] AC3 is confirmed **explicitly** — a normally-opened `.arxml` still uses the text editor
      (`TabInputText` on the active tab), and the explicit command opens the custom editor.
- [x] AC9 is confirmed **explicitly** — a full activation-and-navigation flow creates no file.
- [x] No listener or panel handler survives disposal (inspected, not assumed: the two disposables and
      the `panels` entry are released in `panel.onDidDispose`).

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

## Outcome (as built)

Files: `src/editor/{nodeId,filter,renderHtml,navigation,ecucEditorProvider}.ts`, `src/commands.ts`,
`src/extension.ts` (wiring only), `package.json`, `src/test/fixtures/editor/{render,navigation}.arxml`,
`src/test/editor/{editorTestUtils,activation,render,reveal,references,filter,a11y}.ts`. `src/core/**`
and `src/spikes/**` untouched; `helloWorld` left in place.

**Spike B assumption (recorded here and in `navigation.ts`).** Spike B has not been run, so a live
two-way split is unproven. Reveal is implemented as the two commands of `design.md` §10: editor →
source opens the file in the text editor at the node's range, source → editor maps the cursor offset
to the innermost node and opens the custom editor at it. No second-pane mechanism was invented.

Decisions taken where the design was ambiguous or wrong:

1. **`"priority": "option"` on the `customEditors` entry.** `design.md` §2.1 assumes "registering a
   selector does not make it the default"; VS Code's default priority is `default`, which *does* take
   over the matching files. `option` is the mechanism that actually enforces D14, so it is set
   explicitly and asserted in `activation.test.ts` together with an empty `activationEvents` and the
   absence of a `workbench.editorAssociations` default.
2. **Gate fallback is `vscode.openWith(uri, 'default')`, not `workbench.action.reopenWithEditor`.**
   The latter opens the *Reopen With…* picker; AC2 asks for the text editor and an explanation, so the
   explanation is a warning message and the fallback is deterministic.
3. **No `ready` and no `filter` message.** The initial model is baked into the HTML; a re-scan posts
   `{ type: 'model', tree }`, where `tree` is the region `renderTree` builds; the filter is client-side
   (§2.5). A `ready` push or a filter round-trip would be a second, partial update path — the bug
   source §3 warns about. Protocol as built: in `reveal`, `follow`; out `model`, `select`, `notice`.
4. **`follow` is separate from `reveal`.** §2.2 lists only `reveal`, but AC4 wants a reference's *own*
   range while AC6 wants its *target*: one message cannot mean both. `follow` resolves the target and
   `reveal` selects the node; the command carries the same distinction as an optional third argument.
5. **A package is a header row, not a tree item.** `model.packages` entries are `{ path, range }` with
   no node object, so they cannot join the node index; the legacy form also emits `package A.B.C` as a
   plain line.
6. **No `/* … */` around annotations.** That wrapper is syntax of the dropped ARTEXT text form (D4);
   the label and the text are both still shown (`[Label] text`, and text alone when unlabelled).
7. **A textual parameter value is quoted** (`= "hello"`), a numerical one is bare (`= 63`, `(= 0x3F)`),
   matching the legacy emission, which is what tells the two apart at a glance.
8. **The filter's field semantics live on the host.** `filter.ts` owns `haystack()` and `renderHtml`
   writes it into `data-haystack`, so the webview only compares the lower-cased query and never
   re-derives which fields are searched.
9. **No test-only API was added to production code.** The AC5 outcome is asserted through the
   command's return value (the innermost node id) plus the `data-selected` marker in the rendered tree.
10. **Module-level `parameters`/`references` are absent from `ModuleNode` in core** and are therefore
    not rendered. That shape is unreachable in valid AUTOSAR (`PARAMETER-VALUES` live under
    `ECUC-CONTAINER-VALUE`), so it is not a defect and core was not modified.

Not covered by an automated assertion: the live webview's keyboard handling, the client-side filter
pass and the `model`-message swap are asserted on the rendered string, not by driving a live webview —
`@vscode/test-electron` exposes no webview key-press or DOM API. The re-scan subscription itself is
likewise asserted structurally (one refresh path, disposed with the panel) rather than by mutating a
document under a live panel.
