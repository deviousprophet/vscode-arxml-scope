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

- Step 0 is **not** done: neither Spike A nor Spike B has been run, and neither can be finished by an
  agent — both need a human in a running Extension Development Host. See "Spikes" below.
- Step 1 (`ecuc-model-scanner`) is **implemented and quality-checked** (Phase 2.2 complete). Core
  modules, 10 synthetic fixtures, 9 hand-authored expected models and the core test suites are
  committed. AC1–AC9 are all met: `npm test` passes with 37 tests, `check-types` and `lint` are clean,
  and `src/core/` imports no `vscode`. Three defects were found and fixed — empty-CDATA range
  corruption, annotations captured from the wrong XML layer, and an instance-reference sort key that
  ignored the context. Details and evidence: the child's `implement.md` `## Phase 2.2 check`.
- Two items are recorded in the child as known and deliberately not changed: a comment inside a
  `<VALUE>` is included in `valueRange`, so a write deletes it (documented behaviour, not a defect);
  and the expected models' *authorship* cannot be proven from the repository, only their agreement
  with the legacy rules and their behaviour-sensitivity.

**Next, in order.**

1. **Step 2** (`10-14-artext-custom-editor`) — review its artifacts, then `task.py start`. Only the
   *reveal mechanism* detail of `design.md` §10 depends on Spike B; the activation gate, rendering,
   filter, keyboard handling and the re-scan subscription do not, and the two-command reveal described
   in §10 works either way. Do not let an unrun spike block the whole step.
2. **Spike B** — a human runs it in an Extension Development Host and records the outcome here.
3. **Step 3** (`10-14-ecuc-value-editing`) — gated on **Spike A**. Do not start it while the
   `CustomDocument` undo/redo contract is unproven: that contract is not patchable from the outside.
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

**Status:** not started. Both spikes are still open; they gate Step 3 (A, the `CustomDocument`
undo/redo contract) and the reveal mechanism of Step 2 (B).

Two design risks from `design.md` §15 can invalidate large parts of the plan, so they are settled
before any child starts. Both are small, throwaway probes on the current scaffold; neither is a
deliverable and neither creates fixtures or tests that must be kept.

- [ ] **Spike A — custom editor lifecycle.** Register a minimal `CustomTextEditorProvider` for a
      throwaway `viewType`, render static HTML, and confirm: it does *not* become the default for
      `.arxml`; `onDidChangeCustomDocument` with a `CustomDocumentEditEvent` makes Ctrl+Z and Ctrl+Y
      apply `undo()`/`redo()`; the dirty indicator appears; `saveCustomDocument` persists.
      **Settles `design.md` §9/§15.2.** If the invertible-event contract behaves differently than
      designed, revise §9 before Step 3 is planned.
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

- [ ] `src/editor/ecucDocument.ts` — `CustomDocument` with invertible `CustomDocumentEditEvent`s,
      wired as proven by Spike A (R12).
- [ ] Write shapes 1 and 2 from `design.md` §8 — text-content replacement, and whole-element
      replacement for an empty or self-closing `<VALUE>`.
- [ ] Validation before every write, surfaced as a message, with no mutation on refusal (R13).
- [ ] Re-scan and refresh the view after every applied edit, including undo/redo.
- [ ] `saveCustomDocument`, `saveCustomDocumentAs`, `revertCustomDocument`.
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
