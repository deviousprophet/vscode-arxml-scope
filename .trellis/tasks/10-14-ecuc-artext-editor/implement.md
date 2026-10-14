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

- [ ] Walk every cross-child acceptance criterion in `prd.md` and record its evidence.
- [ ] Confirm no `vscode` import exists under `src/core/` (D16).
- [ ] Confirm no derived artefacts are written anywhere near a user's file (AC10).
- [ ] Confirm no real customer file is tracked, and that `src/test/data/` is ignored (AC11).
- [ ] Update `CHANGELOG.md` and the `README.md` feature list.
- [ ] Write `docs/ECUC_EDITOR.md` if it has drifted from what was built (D12).

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
