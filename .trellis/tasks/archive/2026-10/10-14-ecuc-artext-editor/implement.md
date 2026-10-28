# Implementation plan: ECUC ARTEXT editor

Execution plan for the parent task. Each child task owns its own `implement.md` checklist; this file
fixes the **order**, the **gates** and the **validation commands** shared across them.

Prerequisites already satisfied at planning time: requirement exploration (§`prd.md` decisions D1–D16)
and the reference analysis in `research/legacy-artext-analysis.md`.

## Execution order

```
Step 0  De-risking spikes            (parent, before any child starts)
Step 1  ecuc-model-scanner           (child, P1)  ── prerequisite for 2 and 3
Step 2  artext-custom-editor         (child, P1)  ── prerequisite for 3
Step 3  ecuc-value-editing           (child, P2)
Step 4  Parent integration review    (parent)
```

The parent is **not** the implementation target. Each step is performed in its own child task, started
with `task.py start` once that child's artifacts have been reviewed.

## Resume state — read this first when picking the work up on another machine

**Where the work lives.** Branch `feat/arxml-scope`, remote
`https://github.com/deviousprophet/vscode-arxml-scope`. Commits so far: `0c09d4c` (the plan plus the
scanner child's implementation) and `e094300` (the defects the quality check found).

**Task state at checkpoint.** No task is `current` — `task.py` runs in degraded mode here (no session
identity), so `task.py current` prints nothing on either machine. Use `task.py list` to see the tree:
the parent and `10-14-ecuc-model-scanner` are `in_progress`; `10-14-artext-custom-editor` and
`10-14-ecuc-value-editing` are still `planning` and must be reviewed before `task.py start`. The
scanner child is deliberately **not archived yet** — `task.py archive` moves the directory and would
break the relative references the other children's artifacts make to it; archive it in Step 4.

**Done.**

- Step 0: **Spike A's API half is settled** — `CustomTextEditorProvider` exposes only
  `resolveCustomTextEditor(document: TextDocument, …)`, so undo/redo/dirty/save are the real
  `TextDocument`'s own and no edit-event machinery exists to get wrong (the design was corrected
  accordingly). Its behavioural rows and all of **Spike B** still need a human in an Extension
  Development Host; the scaffolding and the checklist are ready. See "Spikes" below.
- Step 1 (`ecuc-model-scanner`) is **implemented and quality-checked** (Phase 2.2 complete). Core
  modules, 10 synthetic fixtures, 9 hand-authored expected models and the core test suites are
  committed. AC1–AC9 are all met. Three defects were found and fixed — empty-CDATA range corruption,
  annotations captured from the wrong XML layer, and an instance-reference sort key that ignored the
  context. Details and evidence: the child's `implement.md` `## Phase 2.2 check`.
- Step 2 (`10-14-artext-custom-editor`) is **implemented** (Phase 2.1) and **not yet checked**
  (Phase 2.2). The provider, rendering, filter, keyboard handling, both reveal directions and the
  same-file reference follow are in `src/editor/` and `src/commands.ts`, with editor fixtures and
  tests; `npm test` reports 67 passing. Two things the implementer corrected against this design, both
  now fixed here: `priority: "option"` is what enforces D14 (the manifest default is `"default"`, which
  would claim every `.arxml`), and the gate falls back to `vscode.openWith(uri, 'default')` rather than
  `workbench.action.reopenWithEditor`. Reveal is implemented as the two commands, assuming Spike B
  finds no live pairing.
- Recorded as known and deliberately unchanged in the scanner child: a comment inside a `<VALUE>` is
  included in `valueRange`, so a write deletes it (documented behaviour, not a defect); and the
  expected models' *authorship* cannot be proven from the repository, only their agreement with the
  legacy rules and their behaviour-sensitivity.

**Next, in order.**

1. Phase **2.2 quality check** of `10-14-artext-custom-editor` — dispatch `trellis-check` against its
   `prd.md` AC1–AC10. AC3 (no takeover) and AC9 (no file written) deserve independent eyes, since both
   are "nothing happened" criteria that a passing test can mask.
2. **Spike B**, then Spike A's behavioural rows — a human, in an Extension Development Host, using
   `research/spike-results.md`. If Spike B finds a live pairing is achievable, revisit `design.md` §10;
   otherwise the two commands stand.
3. **Step 3** (`10-14-ecuc-value-editing`) — its Spike A gate is now only the behavioural rows, not an
   unproven contract.
4. **Step 4** — the parent integration review, then archive the children.

**Spikes (both need a human at a running VS Code).** No agent can complete these headlessly — they
require opening the Extension Development Host, opening a file with the custom editor, pressing
Ctrl+Z/Ctrl+Y and watching the dirty indicator. Write throwaway scaffolding, hand the checklist to the
user, and record the outcome in this file.

**Environment notes.** `npm test` works: `.vscode-test/vscode-win32-x64-archive-1.141.2` is downloaded
and `.vscode-test/` is gitignored. The earlier `407 Proxy Authentication Required` from
`update.code.visualstudio.com` was transient and did not need a code change. On a fresh machine,
`npm install` first, then `npm test` will re-download VS Code once.

**Guardrails that survive the machine change.** Do not add `bin/` or `plugins/` from the legacy tool
(`reference/legacy-arxml2artext/README.md` explains why), do not reintroduce the ARTEXT text form,
grammar, `Open as ARTEXT` or Compare, do not let `src/core/` import `vscode`, and never commit a real
ECUC file.

## Step 0 — De-risking spikes (parent)

**Status:** scaffolding written, spikes not yet run. Procedure, the exact steps and the slots to
record the outcomes are in `research/spike-results.md`; the throwaway probe lives in `src/spikes/` and
`spike/`. Both spikes need a human in an Extension Development Host (F5) — an agent cannot press
Ctrl+Z or watch a dirty indicator. They gate Step 3 (A, the `CustomDocument` undo/redo contract) and
settle the reveal mechanism of Step 2 (B).

Two design risks from `design.md` §15 can invalidate large parts of the plan, so they are settled
before any child starts. Both are small, throwaway probes on the current scaffold; neither is a
deliverable and neither creates fixtures or tests that must be kept.

- [ ] **Spike A — custom editor lifecycle.** Scaffolding is written (`spike/`,
      `src/spikes/spikeProvider.ts`); the procedure and result slots are in
      `research/spike-results.md`. The API half is already **settled**: `CustomTextEditorProvider`
      declares only `resolveCustomTextEditor(document: TextDocument, …)` — no `openCustomDocument`,
      no `onDidChangeCustomDocument`, no save/revert hooks — so undo, redo, dirty state and save are
      VS Code's own and the invertible-`CustomDocumentEditEvent` machinery this step originally
      described must **not** be built. What remains is behavioural and needs a human: the probe does
      not claim `.arxml`; the dirty dot appears after an edit; Ctrl+Z and Ctrl+Y work with **one**
      press each; Ctrl+S persists; an external edit refreshes the view.
      **Settles `design.md` §9/§15.2**, both already revised for the API finding. If the behavioural
      rows disagree with that contract, report it before Step 3.
- [ ] **Spike B — reveal mechanics.** Determine whether our custom editor and the plain text editor
      can show the same `.arxml` at the same time (second group via *Open With…*), or whether
      `vscode.openWith(uri, 'default', { selection })` necessarily replaces the custom editor.
      **Settles `design.md` §10/§15.1.** Outcome decides whether R9 is delivered as two commands
      (always possible) or as live synchronisation (only if proven).

- [ ] Record both outcomes in this file, and, if either contradicts the design, revise `design.md`
      and re-review before Step 1.

## Step 1 — `ecuc-model-scanner` (P1)

**Status:** implemented (Phase 2.1), quality check (2.2) outstanding. Evidence in the child's
`implement.md` `## Implemented state`; AC9 is partial because `npm test` cannot download VS Code here.

Deliverable: the core, with no `vscode` imports. Every node carries source ranges; ordering and
validation semantics exist and are tested.

- [ ] `src/core/ecuc/model.ts` — node types and `Range` exactly as `design.md` §4.
- [ ] `src/core/ecuc/detect.ts` — `isEcucValues(text, filePath)`, `.arxml` check first (R2).
- [ ] `src/core/ecuc/scanner.ts` — single-pass, iterative-stack scanner per `design.md` §5, including
      the context-dependent `<VALUE>` rule and `pathIndex` construction.
- [ ] `src/core/ecuc/order.ts` — `SORT_EXCEPTIONS` (the 15 entries verbatim) and the ordering
      functions per `design.md` §6.
- [ ] `src/core/ecuc/resolve.ts` — exact-then-longest-suffix resolution over `targetRawPath` (§7).
- [ ] `src/core/ecuc/validate.ts` — literal-form validation and XML escaping (§8).
- [ ] `src/core/text/offsets.ts` — `LineIndex`.
- [ ] `src/test/fixtures/*.arxml` — synthetic, covering every case listed in `design.md` §14.
- [ ] `src/test/expected/*.json` — expected models authored from the research rules, **not** generated
      by the scanner.
- [ ] `src/test/core/*.test.ts` — scanner, ordering, resolution, validation.
- [ ] Add `src/test/data/` to `.gitignore` (D13).

**Done when:** AC1, AC3 and the core-level parts of AC2 pass; `npm run check-types`, `npm run lint`
and `npm test` are green.

**Gate:** review the scanner's `<VALUE>` handling and deep-nesting fixture against
`design.md` §5 before Step 2, since the editor's correctness rests on the ranges this produces.

## Step 2 — `artext-custom-editor` (P1)

Deliverable: the editor surface — the actual product.

- [ ] `contributes.customEditors` + the three commands + the two settings (`design.md` §11).
- [ ] `src/commands.ts` — detection-then-`vscode.openWith` for activation (D14).
- [ ] `src/editor/ecucEditorProvider.ts` — `resolveCustomTextEditor` per `design.md` §9, including the
      non-ECUC fallback, the re-scan subscription, and disposal.
- [ ] `src/editor/renderHtml.ts` — inlined HTML/CSS/JS, `nonce` + CSP, `--vscode-*` theme variables.
- [ ] Rendering per `design.md` §6, including variant, condition and annotation suffixes, and hover
      exposing the full `DEFINITION-REF` path.
- [ ] Filter box over the rendered tree (R14).
- [ ] Bidirectional reveal and same-file reference following per `design.md` §10 and Spike B's outcome
      (R9, R10).
- [ ] Keyboard navigation and focus handling (R16).
- [ ] `src/test/editor/*.test.ts` for AC2, AC4, AC5, AC6, AC10.

**Done when:** AC2, AC4, AC5, AC6 and AC10 pass; suite and lint green.

**Gate:** confirm AC4 explicitly — a normally-opened `.arxml` must still use the text editor.

## Step 3 — `ecuc-value-editing` (P2)

Deliverable: editing that cannot damage the file.

- [ ] `src/editor/ecucEdit.ts` — the edit record and `applyEdit`: recompute the region by re-scan,
      replace via `WorkspaceEdit` on the real `TextDocument`, re-scan, push the model (R12). **Do not
      build `CustomDocumentEditEvent` machinery** — `CustomTextEditorProvider` has no such hook, and
      undo/redo/dirty/save are the text document's own (parent `design.md` §9,
      `research/spike-results.md` §Spike A).
- [ ] Write shapes 1 and 2 from `design.md` §8 — text-content replacement, and whole-element
      replacement for an empty or self-closing `<VALUE>`.
- [ ] Validation before every write, surfaced as a message, with no mutation on refusal (R13).
- [ ] Re-scan and refresh the view after every applied edit, including undo/redo.
- [ ] Verify the save, revert and save-as behaviour rather than implementing it (R12, AC5): they are
      the ordinary text-document operations and dirty state is VS Code's own. If a revert does not
      refresh the view, the fault is in the re-scan subscription, not in a missing hook.
- [ ] `src/test/editor/*.test.ts` for AC7, AC8, AC9.

**Done when:** AC7 (byte comparison), AC8 and AC9 pass; suite and lint green.

## Step 4 — Parent integration review

- [x] Walk every cross-child acceptance criterion in `prd.md` and record its evidence. — see
      **Step 4 report** and **Step 4 report — second pass** at the end of this file.
- [x] Confirm no `vscode` import exists under `src/core/` (D16). — `git grep vscode -- src/core` finds
      one doc comment in `model.ts` and nothing else.
- [x] Confirm no derived artefacts are written anywhere near a user's file (AC10). — no filesystem
      write API anywhere in `src/**` outside tests; one `WorkspaceEdit.replace` on the open document.
- [x] Confirm no real customer file is tracked, and that `src/test/data/` is ignored (AC11). — every
      tracked `.arxml` is a synthetic fixture; the vendored reference has no `bin/`, `plugins/` or
      `license.dat`.
- [x] Update `CHANGELOG.md` and the `README.md` feature list. — done by the session in `eb50a33`,
      which also corrected the command name in all three documents. One line still needs a bump when
      this review's changes land: `docs/ECUC_EDITOR.md:9` says "96 passing tests", the suite is 97.
- [x] Write `docs/ECUC_EDITOR.md` if it has drifted from what was built (D12). — the document
      describes what was built; the drift the first pass reported was fixed in `eb50a33`. See the
      second-pass section for what remains true about it.
- [ ] Archive the children. — **not done here**: `task.py archive` would move
      `10-14-ecuc-model-scanner/` and break the relative references the sibling artifacts make to it.
      Do it once the sibling `10-14-ecuc-editor-ux` (added to this parent mid-review) has landed.

## Validation commands

| Purpose | Command |
|---|---|
| Types | `npm run check-types` |
| Lint | `npm run lint` |
| Full suite (compiles core, bundle, lint, then `vscode-test`) | `npm test` |
| Tests only, after `npm run compile-tests` | `npx vscode-test` |

## Review gates

1. **Before Step 1** — this plan, `prd.md` and `design.md` reviewed; parent and child artifacts present
   (complex tasks require `prd.md` + `design.md` + `implement.md` before `task.py start`).
2. **After Step 0** — spike outcomes recorded; design revised if contradicted.
3. **After each child** — its acceptance criteria reviewed before the next child starts.
4. **Step 4** — final integration review, then Phase 3.

## Rollback points

- Each child's work is additive and self-contained, so a child can be reverted without touching the
  others, except that Step 3 assumes Step 2's document wiring.
- If Step 2's reveal mechanism proves unworkable, R9 degrades to two commands without invalidating
  Step 1.
- If Spike A contradicts `design.md` §9, stop before Step 3 rather than working around it in the
  editor: the document-lifecycle contract is not patchable from the outside.
- Reverting everything needs no cleanup: no derived files, no persisted state, no migration.

## Guardrails for execution

- Do not reintroduce the ARTEXT text form, the grammar, `Open as ARTEXT` or Compare (D4).
- Do not add a runtime dependency for XML parsing (D7, constraints).
- Do not add a `win32` platform gate or any reference to `mmx`/`license.dat` (constraints).
- Do not commit any real ECUC file (D13).
- Do not let `src/core/` import `vscode` (D16).

## Step 4 report — parent integration review

Run against `739e1bc` (branch `feat/arxml-scope`), covering the three children named above. The
session committed the first of the two fixes below as `dbfc727` while this review was running; the
second is an uncommitted working-tree change. A fourth child, `10-14-ecuc-editor-ux`, was added to
this parent mid-review and is not covered here.

### Evidence observed

```
npm run check-types   -> exit 0
npm run lint          -> exit 0
npm test              -> exit 0, "96 passing" (93 before this review + 3 added below)
git grep vscode -- src/core
  -> src/core/ecuc/model.ts:6  (a doc comment; no import)
git grep -E "writeFile|createFile|mkdir|appendFile|unlink|fs\." -- src   (excluding src/test/)
  -> no match
git grep -E "WorkspaceEdit|applyEdit" -- src   (excluding src/test/)
  -> src/editor/ecucEdit.ts only (plus the throwaway src/spikes/spikeProvider.ts)
git grep -E "process\.platform|mmx|license\.dat" -- src spike
  -> no match
```

Three throwaway probes were run against the compiled `out/` from a scratch directory (not committed,
not part of the repo). They are the evidence for the seam findings:

1. **Seam probe, 17 fixtures / 30 parameters.** For every parameter of every committed fixture:
   resolved both write shapes with `regionOf`, asserted the shape the scanner intended (an element
   slice starts with a `VALUE` tag and ends a tag; a text slice sits directly between `>` and `</`),
   applied the replacement by offset, and re-scanned. Result: `SEAM PROBE OK` — the byte rule
   `text[valueRange.start] === '<'` agrees with the scanner's intent in every case, `wrapElement`
   produces a well-formed `<TAG>…</TAG>` preserving any namespace prefix, and **every node id present
   before a write is present after it, with the same kind, and the edited node's id still covers the
   new value**.
2. **Expected-model probe, all 9 committed models.** Re-derived each model's ranges from the fixture
   bytes with no scanner involved: every `range` slices the element it claims and covers its closing
   tag, every `shortNameRange`/`definitionRefRange`/`targetRange` equals the string it names, every
   text `valueRange` is trimmed and decodes to `displayValue`, every `hexValue` is a well-formed hex
   literal, and every `pathIndex` entry points at a real container/module/package. Result:
   `EXPECTED-MODEL PROBE OK`.
3. **Element-span probe.** See finding 1.

### Parent acceptance criteria

| AC | Verdict | Evidence |
|---|---|---|
| AC1 | **Met** | Probe 2 re-derives all 9 committed models from the fixture bytes independently of the scanner; `scanner.test.ts` `AC1: every fixture matches its committed expected model`. `deep.json` nests a container 6 levels (`R4` asks for 5+); `suffixes.json` carries a `syscond`, two post-build variants, a labelled annotation and an unlabelled one, across module/container/parameter. |
| AC2 | **Met** | `detect.isEcucValues` is a pure function of `(path, text)` that returns on the path check first, and `scanner.test.ts` `AC3: detection is namespace-tolerant and gate-ordered` asserts `isEcucValues(basicText, 'basic.xml') === false` — the content is not consulted. Editor surface: `gateReason` + `activation.test.ts` AC2 (non-ECUC `.arxml` and non-`.arxml` each explain and leave the text editor). |
| AC3 | **Met, after a fix** | Ordering: `order.test.ts` (sort all, exception declaration order, the prefix case, no interleaving) and `rescan.test.ts` §2.2 (ordering is pure, so ids do not move with the setting). Setting → render: **was broken for an already-open panel** — see finding 2 — and is now covered by `rescan.test.ts` `AC3: toggling the sort setting re-renders an open panel`. |
| AC4 | **Met** | `activation.test.ts` `AC3: a normally opened arxml still uses the text editor` uses `vscode.open` (the normal resolution path) and asserts `TabInputText`, no custom view and the active text editor; the manifest test asserts `priority: "option"`, an empty `activationEvents` and no `workbench.editorAssociations` default. |
| AC5 | **Met** | `reveal.test.ts`: editor → source for a parameter, a container and a reference (asserting the selected range is the node's own range); source → editor for an offset inside a value (→ its parameter) and on a module/container tag (→ that element). The *nested*-container and *reference*-offset cases of the source → editor direction are covered by the generic `innermostNodeIdAt` mapping rather than by a direct assertion. |
| AC6 | **Met** | `references.test.ts`: a same-file target is selected through the command; an absent path and an ambiguous suffix each produce a notice and no navigation, nothing thrown. A cross-file target is the absent case in a same-file index. |
| AC7 | **Met** | `editing.test.ts` AC1/AC2/AC3/AC7 byte-compare against hand-derived `.expected` files (numeric `7`→`42`, textual `bee`→`hello world`, `<VALUE/>`→`<VALUE>42</VALUE>`, escaping `&amp;plain`→`a&amp;b&lt;c&gt;d`, and a CRLF file with every `\r\n` counted). Probe 1 confirms the same property over all 30 parameters of the committed fixtures. |
| AC8 | **Met, partly manual** | `editing.test.ts` AC4 (one `undo` restores the original bytes; one `redo` re-applies them) and AC5 (`isDirty` false→true→false, save writes the expected bytes, `workbench.action.files.revert` reloads from disk and re-renders). The dirty *indicator* is a UI artefact, so `isDirty` stands in for it; Spike A's rows A3–A6 are still unobserved. |
| AC9 | **Met** | `editing.test.ts` AC6 ×4 refusal paths — invalid numerical value, XML-illegal character, CDATA-backed value, and a region whose bytes moved — each asserting the notice text, the document text, the on-disk bytes and `isDirty`. |
| AC10 | **Met** | No filesystem write API anywhere in `src/**` outside tests; the only write in the extension is one `WorkspaceEdit.replace` of the computed region on the open document. `activation.test.ts` AC9 snapshots a fixture directory through a full activation-and-navigation flow; `editing.test.ts` AC9 snapshots the edited file's directory. No `.artext_cache`, no lock file, no hashing anywhere. |
| AC11 | **Met** | `.gitignore` carries `src/test/data/` (and the directory does not exist on disk). Every tracked `.arxml` is a synthetic fixture (`PkgA/ModA/ContA`, `PkgN/NavMod`, `PkgE/EditMod`, …) or the explicitly-labelled `spike/sample.spike.arxml`; `git ls-files` finds no `.artext`, no `license.dat`, no binary. `reference/legacy-arxml2artext/` holds only `Arxml2Artext.mm` (8 326 B), `Arxml2Artext.cmd` (437 B) and its `README.md` — no `bin/`, no `plugins/`, no `license.dat` — and `.gitattributes` pins those files `-text`. |
| AC12 | **Met** | `npm test` 96 passing / 0 failing; `npm run check-types` and `npm run lint` clean. |

### Integration seams

- **`nodeId` stability across the actual write path — holds.** Child 2's ids are derived from
  `containerPath` + `SHORT-NAME` + a per-owner declaration-order ordinal, built from the **raw** model,
  never from the display-ordered view, and the ordering functions are pure. Probe 1 re-scanned after a
  real write for all 30 parameters and every id survived with the same kind and label. The seam that no
  child test reached — take the id out of the **re-scanned tree**, exactly as the widget takes it from
  `data-node-id`, and edit with it after an undo — is now covered by `editing.test.ts` §2.2 *the id in
  the re-scanned tree is the id the next edit resolves*.
- **`valueRange` / verbatim-slice semantics — sound, not accidentally true.** The scanner sets
  `valueRange` to the *trimmed inner text* when there is text and to the *whole element* when the value
  is empty or self-closing (`scanner.ts:476-479`), which is what child 3's byte rule
  (`text[valueRange.start] === '<'`) and its two write shapes depend on. A raw `<` cannot appear in XML
  text content outside CDATA, so the discriminator cannot misfire — and the one case where the bytes
  *do* look like an element (`<![CDATA[<b>]]>`, whose captured text starts with `<`) is refused by
  `touchesCdata` rather than written. Child 3 is not compensating for a false assumption; the only gap
  is that the empty-value half of the contract lives in a scanner code comment rather than in
  `design.md` §4, which says only "text content inside `<VALUE>`".
- **One validator, and it is the core one — confirmed.** `buildEdit` calls
  `core/ecuc/validate.ts:validateValue` and the provider never writes without a plan from `buildEdit`;
  the webview carries only `data-value` and posts the typed string, so there is no second, weaker
  check to drift from the core one. Refusals return a reason, and the write path's only `WorkspaceEdit`
  is created after validation.
- **One push per change, no double push — confirmed.** `rescan.test.ts` §1.5 counts the platform's own
  `onDidChangeTextDocument` events for the document and asserts `stub.messages.length === events`, so a
  second subscription would fail it. The write handler deliberately does not push (the subscription
  does); the settings listener added below is a separate trigger that fires only on a configuration
  change, never on a document change.
- **End-to-end path — already covered, so not duplicated.** `editing.test.ts` AC8 is the chain:
  `resolveCustomTextEditor` renders → the widget's `{ type: 'edit', nodeId, value }` goes through the
  provider's handler → the write lands → the subscription re-scans → the pushed tree is asserted equal
  to a fresh `renderTree` of the document. AC1 on the same fixture asserts the document text and the
  on-disk bytes against a hand-derived `.expected` file. Together they are the requested
  open → render → edit → re-scan → rendered-reflects → file-otherwise-byte-identical chain; the two new
  tests below add the id-from-the-rendered-tree step and the live settings re-render.

### Findings, by severity

**1. Medium (latent, not reachable from the shipped UI flow) — the element span of a value whose text
ends in a raw `>` stopped short of the closing tag. FIXED.**
`src/editor/ecucEdit.ts` `elementSpan` searched for the closing tag's `>` starting at the text region's
last character. `>` is legal unescaped in XML text, so for `<VALUE>a></VALUE>` the value's own `>` was
mistaken for the closing tag's: `regionOf(parameter, text, 'element')` returned `<VALUE>a>`, and a write
would have produced `<VALUE>42</VALUE></VALUE>` — not well-formed XML. The shipped flow cannot reach it
(`buildEdit` picks the element shape only when `valueRange` *is* the element, so a record with
`region: 'element'` and a text region can only come from a caller of the exported `applyEdit`, and the
stale-bytes guard then refuses the write), but the function's own contract and comment claimed
otherwise. The closing `>` is now found from the `</` that follows the text. Regression test:
`editing.test.ts` §2.2 *the element span of a value ending in a raw `>` still reaches `</VALUE>`* —
which failed against the old code (`AssertionError`, observed) and passes now.

**2. Medium — `arxmlScope.ecuc.editor.sort` / `sortExcept` had no effect on an already-open panel.
FIXED.**
`editorSettings()` is read at every render, but nothing re-rendered an open panel, and there was no
`onDidChangeConfiguration` subscription anywhere in `src/**`. Concrete failure: a user opens an ECUC
file in the custom editor, changes *Sort* to `declaration` in Settings, and the tree does not change —
contradicting parent AC3's "toggling the setting changes the result" and both user-facing documents,
which present the setting as controlling the view. The provider now re-pushes the tree when
`arxmlScope.ecuc.editor` changes, reusing the existing push so a document change still produces exactly
one message. Test: `rescan.test.ts` `AC3: toggling the sort setting re-renders an open panel`, which
asserts the pushed tree switches from sorted to declaration order and restores the setting in a
`finally`. It failed with the listener disabled (`timed out waiting for the settings re-render`,
observed) and passes now.

**3. Low — two sibling containers with the same `SHORT-NAME` collide on one node id. NOT FIXED.**
`buildNodeIndex` gives a container `container:<containerPath>/<shortName>` with no ordinal, so
`<ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME>…` twice under one parent indexes one entry, and the
rendered tree carries `data-node-id="container:P/M/C"` twice; reveal/select can then land on the wrong
one. Confirmed with a probe (two containers, `byId.size` 4 for 5 nodes). Only parameters are editable
and their ordinal *does* disambiguate them (`…/param:T#0`, `…/param:T#1`), so no write hazard; and the
input is schema-invalid (AUTOSAR requires unique short-names among siblings), which is F5's scope. Left
alone deliberately: adding a container ordinal changes every container id and is a design decision, not
a check-pass edit.

**4. Low — documentation drift. NOT FIXED (reported as instructed).**
The command is titled **`Open with ECUC Editor`** in `package.json:26` (category `ARXML Scope`), so the
palette shows `ARXML Scope: Open with ECUC Editor`. Three documents name a command that does not exist:
`README.md:25`, `docs/ECUC_EDITOR.md:32` and `CHANGELOG.md:16` all say `ARXML Scope: Open ECUC
Configuration`. Either the manifest title or the three documents is wrong; the manifest is what ships.
`docs/ECUC_EDITOR.md:9` also says "93 passing tests" (96 now). Otherwise `docs/ECUC_EDITOR.md`
describes what was built, including the CDATA refusal, the read-only reference values, the
`priority: "option"` mechanism and the `src/spikes/` scaffolding; and `README.md`'s feature list matches
what exists once its "the rest of the feature list below is planned" status note is applied.

**5. Informational.** The throwaway spike provider is still registered in `extension.ts:41-53` and in
the manifest, and its `customEditors` entry has **no** `priority`, so it claims `*.spike.arxml` as the
*default* editor. That is inside the throwaway's own selector and does not touch `.arxml`, so AC4 is
unaffected — but it must be deleted with `src/spikes/` and `spike/`, and it is a reminder that the
`priority` default is `"default"`.

**6. Informational.** `commands.ts` `openEcucEditor` and `revealInEcucEditor` call
`openTextDocument(target)` before `gateReason`, so a non-`.arxml` target is loaded as a document before
it is refused. `detect.isEcucValues` itself is correctly ordered (AC2), and nothing parses or writes in
between, so this is an ordering nuance with no failure scenario rather than a defect; changing it would
also change user-visible behaviour (the rejected file is currently opened in the text editor).

**7. Informational, owned elsewhere.** A single click on any node reveals the source and so swaps the
custom editor for the text editor, which makes the view unusable for browsing. R9 is satisfied (the two
commands are a complete implementation), so this is not an acceptance-criteria failure, and the session
has opened `10-14-ecuc-editor-ux` for it. The editing child's interaction decision 3 (a click on a
parameter's `= value` starts an edit instead of revealing) is part of the same rework.

### Still unverified, and why

- **Spike A rows A1–A8 and all of Spike B.** Both need a human at a running Extension Development Host
  — pressing Ctrl+Z, watching the dirty dot, and trying *Open With…* in a second group. `spike/` and
  `src/spikes/spikeProvider.ts` are still present and their `customEditors` entry is live for
  `*.spike.arxml`; `research/spike-results.md` §Outcomes still says "not yet observed". The API half of
  Spike A is settled and is what the design records: `CustomTextEditorProvider` has no edit-event hook,
  so there is no `CustomDocument` machinery and none was built.
- **The live webview's DOM behaviour.** `@vscode/test-electron` exposes no webview DOM, so keyboard
  traversal, the client-side filter pass and the click-to-edit gesture are asserted on the generated
  HTML/script string, not by driving a webview. Spike A's manual rows are the only path to observing
  them.
- **The provenance of the expected models' *content*.** Probe 2 proves every range in all 9 models is
  the text it claims, which is what AC1's "matches the committed expected model" can be checked
  against; it cannot prove the labels, ordering and annotation text were derived from
  `Arxml2Artext.mm` rather than from the scanner. Child 1's check read the `.mm` for the annotation and
  instance-reference cases; I did not re-derive the remaining semantics from it.
- **Large-file performance and large-tree rendering** (`design.md` §15.4–15.5) remain unmeasured.
- **Cross-file reference following** is out of scope by design (D7/F2), so AC6's cross-file case is
  only the same-file absent case.

## Step 4 report — second pass

Re-run of the parent integration review. Two things about the dispatch were wrong and are worth
recording: the tree was **not** clean (the session had already committed `dbfc727` and then `eb50a33`
while the first pass ran) and the first pass did **not** record nothing — its report is the section
above, committed in `eb50a33`. So this pass reviews `eb50a33` plus two uncommitted files, not
`dbfc727`.

`eb50a33` contains three things beyond the `dbfc727` span fix: the first pass's report above, the
README/CHANGELOG/`docs/ECUC_EDITOR.md` correction so all three now say `ARXML Scope: Open with ECUC
Editor` (matching `package.json:26`), and the `onDidChangeConfiguration` re-push that closes the first
pass's finding 2. A fourth child, `10-14-ecuc-editor-ux`, was added to this parent mid-review; it is
not covered here and was not touched.

Uncommitted at the end of this pass:

- `src/editor/ecucEdit.ts` — the quote-aware tag end of finding 8.
- `src/test/editor/editing.test.ts` — the regression test for it.

Everything else reviewed here is committed and unchanged by this pass.

### Evidence this pass observed itself

```
npm run check-types   -> exit 0
npm run lint          -> exit 0
npm test              -> exit 0, "97 passing" (96 at eb50a33 + 1 added below)
git grep -n vscode -- src/core
  -> src/core/ecuc/model.ts:6  (a doc comment; no import)
git grep -nE "writeFile|createFile|mkdir|appendFile|unlink|fs\." -- src ":(exclude)src/test"
  -> no match
git grep -nE "WorkspaceEdit|applyEdit" -- src ":(exclude)src/test"
  -> src/editor/ecucEdit.ts:236,242 (the only WorkspaceEdit), src/editor/ecucEditorProvider.ts:22,210,229
     (the call site and comments), src/spikes/spikeProvider.ts (throwaway)
git ls-files -> 226 tracked files, 23 tracked .arxml, every one a synthetic fixture or the labelled
     spike/sample.spike.arxml
git check-ignore -v src/test/data/real.arxml -> .gitignore:6:src/test/data/
reference/legacy-arxml2artext/ -> Arxml2Artext.cmd, Arxml2Artext.mm, README.md only
```

**Carried over, not re-observed by this pass.** The first pass's three probes over the compiled
`out/` (the 17-fixture/30-parameter seam probe, the 9-model expected-model probe, the element-span
probe) were scratch programs that were never committed and cannot be re-run from the tree. Their
claims are consistent with what I read, but the evidence *in this pass* for those properties is the
committed tests and my own reading, not a re-run. Where this table cites a probe, it means the first
pass's evidence, quoted because it is still the only evidence for that property.

**Byte-diff of the `.expected` pairs — mine, and it corrects the first pass's wording.** Common-prefix
/ common-suffix reconstruction (`src == prefix + expected-mid + suffix`) holds for all four pairs, so
each expected file is its input with the value spans replaced and nothing else. `escaping` is one span
(`&amp;plain` → `a&amp;b&lt;c&gt;d`), `numeric` one (`7` → `42`), `textual` one (`bee` → `hello
world`) — but **`self-closing` is two**, not one: `<VALUE/>` → `<VALUE>42</VALUE>` *and*
`<VALUE></VALUE>` → `<VALUE>named</VALUE>`, i.e. both element-shape writes in one file. `crlf.arxml`
has 31 `\r\n` and 0 bare LFs. There is no `crlf.expected.arxml`; AC7 covers it by counting line
endings instead.

### Parent acceptance criteria — this pass's verdicts

| AC | Verdict | Evidence (this pass) |
|---|---|---|
| AC1 | **Met** | `scanner.test.ts` `AC1: every fixture matches its committed expected model` (9 models). `deep.json` nests a container 6 levels (`R4` wants 5+); `suffixes.json` carries a `syscond`, two post-build variants and a labelled plus an unlabelled annotation across module/container/parameter. My byte-diff above confirms the 4 editing `.expected` files are their inputs with only the value spans changed. |
| AC2 | **Met** | `detect.isEcucValues` returns on the path check first; `scanner.test.ts` `AC3: detection is namespace-tolerant and gate-ordered` asserts `isEcucValues(basicText, 'basic.xml') === false`, so the content is not consulted. Editor surface: `activation.test.ts` AC2 (a non-ECUC `.arxml` and a non-`.arxml` each explain and leave the text editor). |
| AC3 | **Met** | `order.test.ts` (sort all, exception declaration order, prefix case, no interleaving) and `rescan.test.ts` §2.2 ×3 prove the ordering functions are pure, so ids do not move with the setting. Setting → render is the listener at `ecucEditorProvider.ts:123-129`, asserted by `rescan.test.ts:267` `AC3: toggling the sort setting re-renders an open panel`, which switches the pushed tree from sorted to declaration order and restores the setting in a `finally`. |
| AC4 | **Met** | `activation.test.ts` AC3 uses `vscode.open` (the normal resolution path) and asserts `TabInputText`, no custom view, active text editor; the manifest test asserts `priority: "option"`, empty `activationEvents` and no `workbench.editorAssociations` default. |
| AC5 | **Met** | `reveal.test.ts`: editor → source for a parameter, a container and a reference (the selected range is the node's own range); source → editor for an offset inside a value (→ its parameter) and on a module/container tag (→ that element). The nested-container and reference-*offset* cases of source → editor ride on the generic `innermostNodeIdAt` mapping rather than a direct assertion — unchanged from the first pass, still acceptable. |
| AC6 | **Met** | `references.test.ts`: a same-file target is selected through the command; an absent path and an ambiguous suffix each produce a notice and no navigation, nothing thrown. |
| AC7 | **Met** | `editing.test.ts` AC1/AC2/AC3/AC7 byte-compare to `.expected` files (numeric, textual, self-closing, escaping, and a CRLF file with every `\r\n` counted). My own byte-diff above is the independent half. |
| AC8 | **Met, partly manual** | `editing.test.ts` AC4 (one `undo` restores the original bytes; one `redo` re-applies them) and AC5 (`isDirty` false→true→false, save writes the expected bytes, `workbench.action.files.revert` reloads and re-renders). The dirty *indicator* is a UI artefact, so `isDirty` stands in; Spike A rows A3–A6 are still unobserved. |
| AC9 | **Met** | `editing.test.ts` AC6 ×4 refusals — invalid numerical value, XML-illegal character, CDATA-backed value, region whose bytes moved — each asserting the notice text, the document text, the on-disk bytes and `isDirty`. |
| AC10 | **Met** | No filesystem write API anywhere in `src/**` outside tests (my grep); the only write is the one `WorkspaceEdit` at `ecucEdit.ts:236-242`. `activation.test.ts` AC9 and `editing.test.ts` AC9 snapshot fixture directories across a full flow. No `.artext_cache`, no lock file, no hashing. |
| AC11 | **Met** | 226 tracked files; 23 tracked `.arxml`, all synthetic fixtures or the labelled `spike/sample.spike.arxml`; `git check-ignore -v src/test/data/real.arxml` → `.gitignore:6:src/test/data/`; `reference/legacy-arxml2artext/` holds only `Arxml2Artext.cmd`, `Arxml2Artext.mm` and `README.md`, and `.gitattributes` pins those `-text`. |
| AC12 | **Met** | `npm test` 97 passing / 0 failing; `npm run check-types` and `npm run lint` clean. |

### Integration seams — this pass

- **`nodeId` stability across the write path — holds.** Ids come from `containerPath` + `SHORT-NAME` +
  a per-owner declaration-order ordinal, built from the **raw** model, never from the display-ordered
  view; the ordering functions are pure (`rescan.test.ts` §2.2 ×3). The seam no child test reached —
  take the id out of the **re-scanned** tree, exactly as the widget takes it from `data-node-id` — is
  `editing.test.ts` §2.2 *the id in the re-scanned tree is the id the next edit resolves*.
- **`valueRange` / verbatim-slice semantics — sound.** `scanner.ts:476-479`: text present → the
  *trimmed inner text* span; empty or self-closing → the *whole element* span (`textRange(entry) ??
  entry.rec?.range`). That is what the byte rule `text[valueRange.start] === '<'` and the two write
  shapes depend on. A raw `<` cannot appear in XML text outside CDATA, so the discriminator cannot
  misfire, and the one case where the bytes *do* look like an element (`<![CDATA[<b>]]>`) is refused by
  `touchesCdata`. The empty-value half of the contract lives in a scanner code comment rather than in
  `design.md` §4 (which says only "text content inside `<VALUE>`") — a documentation gap, not a code
  one. My byte-diff of `self-closing` is the fixture-level confirmation that both element-shape writes
  are what the tests claim.
- **One validator, and it is the core one — confirmed.** `buildEdit` calls
  `core/ecuc/validate.ts:validateValue` (`ecucEdit.ts:190`) and the provider never writes without a
  plan from `buildEdit` (`ecucEditorProvider.ts:229`). The webview carries only `data-value` and posts
  the typed string, so there is no second, weaker check to drift from the core one.
- **One push per change, no double push — confirmed.** `rescan.test.ts` §1.5 counts the platform's own
  `onDidChangeTextDocument` events for the document and asserts `stub.messages.length === events`, so a
  second subscription would fail it. The write handler deliberately does not push
  (`ecucEditorProvider.ts:210-214`); the settings listener added in `eb50a33` fires only on a
  configuration change.
- **End-to-end chain — already covered, so not duplicated.** `editing.test.ts` AC8 is the chain:
  `resolveCustomTextEditor` renders → the widget's `{ type: 'edit', nodeId, value }` reaches the
  provider's handler → the write lands → the subscription re-scans → the pushed tree is asserted equal
  to a fresh `renderTree` of the document; AC1 on the same fixture asserts the document text and the
  on-disk bytes. I did not add a second E2E test.

### Findings

**8. Medium — the writer was not quote-aware, so a `>` inside an attribute value truncated the element
being wrapped. FIXED (uncommitted).**
`elementSpan` found the closing tag's `>` from the first `>` after the text, and `wrapElement` took the
open tag as everything up to the first `>` of the slice. `>` is legal unescaped inside an attribute
value, so for a self-closing `<VALUE DEST="a>b"/>` the open tag was cut at `a>`, the closing tag was
then derived from that truncated open string, and the write produced `<VALUE DEST="a>42</VALUE>` —
dropping the closing quote and `b`, i.e. not well-formed XML. This is the same defect class as
`dbfc727` (a raw `>` inside the *value*) one level out: the scanner's lexer is quote-aware for exactly
this reason (`design.md` §5) and the writer was not. Fixed with one helper, `tagEnd(text, start)`
(quote-aware; returns the offset just past the tag's `>` or `-1`), used by both `elementSpan` and
`wrapElement`, plus a `-1` guard so malformed input cannot build an inverted range. Regression test
`editing.test.ts` §2.2 *a `>` inside an attribute does not truncate the element being wrapped* —
mutation-proven: with the old `wrapElement` restored it fails (`AssertionError` at
`out/test/editor/editing.test.js:532`); restored, the suite passes.

Reachability, honestly: unlike finding 1, this one **is** reachable through the shipped gesture. A
parameter whose `<VALUE …/>` is self-closing or `<VALUE …></VALUE>` with no text has `valueRange` = the
whole element, so `buildEdit` picks the `element` shape and calls `wrapElement` on the element bytes
(`editing.test.ts` AC3's `self-closing` fixture is exactly that path). The trigger is only an
*attribute containing `>`* on that element — legal XML, unusual for AUTOSAR `<VALUE>`, and in no
fixture — so the exposure is narrow, but it is not latent the way finding 1 was.

**Corrections to the first pass's findings.** Finding 4 (doc drift) is now **partly resolved**: the
command-title drift is gone (`README.md`, `docs/ECUC_EDITOR.md`, `CHANGELOG.md` and `package.json:26`
all say `ARXML Scope: Open with ECUC Editor`). Two items remain, both report-only:
`docs/ECUC_EDITOR.md:9` still says "96 passing tests" (97 now — a one-line bump best folded into the
same commit as finding 8); and the three `design.md` drifts stand — §3's file list still names
`editor/ecucDocument.ts` (line 63), §8 still says the write "fires an invertible edit event" (line
263), and §9 step 4 still lists `ready` and `filter` messages (line 304). All three contradict what
both children built and what `ecucEdit.ts:9-12` documents.

Findings 1–7 of the first pass were re-checked and stand as written: 1 fixed by `dbfc727`; 2 fixed by
`eb50a33`; 3 (sibling containers with one `SHORT-NAME` collide on `container:<path>/<shortName>`),
5 (throwaway spike provider still registered, `customEditors` entry with no `priority`), 6
(`commands.ts` reads the document before gating) and 7 (a click reveals the source and swaps the editor;
owned by `10-14-ecuc-editor-ux`) are all still as described. None was re-opened.

### Still unverified, and why

- **Spike A rows A1–A8 and all of Spike B.** Need a human in a running Extension Development Host
  (Ctrl+Z, the dirty dot, *Open With…* in a second group). `spike/` and `src/spikes/spikeProvider.ts`
  are still present and live for `*.spike.arxml`, and `research/spike-results.md` §Outcomes still says
  "not yet observed". Spike A's API half is settled and is what the design records:
  `CustomTextEditorProvider` has no edit-event hook, so no `CustomDocument` machinery exists.
- **The live webview's DOM behaviour.** `@vscode/test-electron` exposes no webview DOM, so keyboard
  traversal, the client-side filter pass and the click-to-edit gesture are asserted on the generated
  HTML/script string, not by driving a webview.
- **The provenance of the expected models' *content*.** My byte-diff proves every range is the text it
  claims, which is what AC1 can be checked against; it cannot prove the labels, ordering and annotation
  text were derived from `Arxml2Artext.mm` rather than from the scanner. Child 1's check read the `.mm`
  for the annotation and instance-reference cases; I did not re-derive the rest.
- **Large-file performance and large-tree rendering** (`design.md` §15.4–15.5) remain unmeasured.
- **Cross-file reference following** is out of scope by design (D7/F2), so AC6's cross-file case is only
  the same-file absent case.

### Where two children disagree about a contract

- **Quote-awareness of `>` inside an attribute value.** The core scanner is quote-aware (`design.md`
  §5, and `scanner.ts`'s lexer); the editing child's writer was not. Same defect class as `dbfc727`.
  Resolved by finding 8. This is the one place a child's assumption about another child's contract was
  actually wrong.
- **No `CustomDocument`, no `ready`/`filter`.** Both children agree and built accordingly; `design.md`
  §3/§8/§9 still describe the opposite. Documentation drift, reported.
- **The click model.** The editing child's interaction decision 3 (a click on a parameter's `= value`
  starts an edit) and the UX child's focus/click rework overlap; `10-14-ecuc-editor-ux` owns it (R-UX2)
  and its PRD should win. Not a defect in either — just the parent must not treat the editing child's
  gesture as final.

