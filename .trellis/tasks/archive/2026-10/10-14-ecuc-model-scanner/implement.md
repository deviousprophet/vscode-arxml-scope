# Implementation plan: ECUC scanner and ARTEXT model (core)

Ordered checklist for this child. Design: `design.md` + `../10-14-ecuc-artext-editor/design.md`.
No de-risking spike is required before starting; this child has no `vscode` dependency and no
interaction with editor lifecycle.

## Order

- [ ] 1. `src/core/ecuc/model.ts` — `Range`, `Suffixes`, `ModuleNode`, `ContainerNode`,
      `ParameterNode`, `ReferenceNode`, `EcucDocumentModel`, `SortMode`, exactly as
      `../10-14-ecuc-artext-editor/design.md` §4.
- [ ] 2. `src/core/ecuc/detect.ts` — `.arxml` check first, then the namespace-tolerant
      `ECUC-MODULE-CONFIGURATION-VALUES` test. Must not read from disk.
- [ ] 3. `src/core/text/offsets.ts` — `LineIndex`: one pass to collect line-start offsets, binary
      search for `positionAt`. No per-call re-slicing of the text.
- [ ] 4. `src/core/ecuc/scanner.ts` — lexer modes (`text`, `tag`, `comment`, `cdata`, `pi`, `doctype`),
      attribute scanning that respects quotes, iterative element stack, prefix-stripped names.
- [ ] 5. `src/core/ecuc/scanner.ts` — capture records for the tag list in parent §5, with per-child raw
      ranges; `<VALUE>` resolved from the stack top (`design.md` §2.1); `AUTOSAR`
      `xsi:schemaLocation` captured for the schema release.
- [ ] 6. `src/core/ecuc/scanner.ts` — suffix capture: `SW-SYSCOND`, `POST-BUILD-VARIANT-CONDITION` with
      `MATCHING-CRITERION-REF`, `VALUE` and operator, and `ANNOTATIONS`/`ANNOTATION`/`LABEL`/
      `ANNOTATION-TEXT`/`VERBATIM`.
- [ ] 7. `src/core/ecuc/scanner.ts` — `pathIndex` construction and the `hexValue` derivation (numeric
      values other than `true`/`false`).
- [ ] 8. `src/core/ecuc/order.ts` — `SORT_EXCEPTIONS` (the 15 entries verbatim from
      `research/legacy-artext-analysis.md` §2.4) and the ordering functions per parent §6.
- [ ] 9. `src/core/ecuc/resolve.ts` — exact, then longest-suffix, ambiguous → nothing (`design.md` §2.3).
- [ ] 10. `src/core/ecuc/validate.ts` — accepted literal forms, XML-illegal character refusal, unchanged
      value refusal, XML escaping (`design.md` §2.5).
- [ ] 11. `src/test/fixtures/*.arxml` — synthetic; one per case in the fixture list below.
- [ ] 12. `src/test/expected/*.json` — expected models **hand-authored** from the rules in
      `research/legacy-artext-analysis.md`, never produced by the scanner.
- [ ] 13. `src/test/core/*.test.ts` — assertions per the coverage table below.
- [ ] 14. `.gitignore` — add `src/test/data/` (parent D13).

## Fixture list

| Fixture | Purpose |
|---|---|
| `basic.arxml` | one module, nested containers, numeric/textual parameters, a reference, an instance reference with context |
| `namespaced.arxml` | every tag namespace-prefixed |
| `deep.arxml` | container nested six levels |
| `suffixes.arxml` | `SW-SYSCOND`, post-build-variant conditions, annotations with and without a label |
| `value-ambiguity.arxml` | `<VALUE>` as a parameter value **and** inside a `POST-BUILD-VARIANT-CONDITION` |
| `lexical.arxml` | CDATA, entity references, comments and processing instructions between elements, attribute value containing `>`, self-closing `<VALUE/>`, `<!DOCTYPE>` |
| `formatting.arxml` | identical model to `basic.arxml` with different indentation, line endings and attribute order |
| `references.arxml` | an exact-match target, a unique-suffix target, an ambiguous suffix, an absent path |
| `exceptions.arxml` | parameters whose `DEFINITION-REF` tails are exception entries, interleaved with sortable ones |
| `not-ecuc.arxml` | `.arxml` with no ECUC values, for detection |

## Test coverage

| Test file | Assertions |
|---|---|
| `scanner.test.ts` | AC1, AC2, AC3, AC4 |
| `order.test.ts` | AC5, AC6, including the `DEFINITION-REF` prefix case and exception declaration order |
| `resolve.test.ts` | AC7 |
| `validate.test.ts` | AC8 |
| `offsets.test.ts` | `LineIndex` against CRLF and LF documents, first line, last line, offset at a line boundary |

## Validation commands

| Purpose | Command |
|---|---|
| Types | `npm run check-types` |
| Lint | `npm run lint` |
| Full suite | `npm test` |

## Implemented state

Phase 2.1 done; Phase 2.2 quality check still outstanding.

| Artifact | Result |
|---|---|
| `src/core/ecuc/model.ts` | node types, `Range`, `lastShortName` |
| `src/core/ecuc/detect.ts` | `isArxmlPath`, `isEcucValues` — path gate before content |
| `src/core/ecuc/scanner.ts` | single-pass lexer + element stack + capture/attribution (~770 lines) |
| `src/core/ecuc/order.ts` | `SORT_EXCEPTIONS` (15 entries) and the ordering functions |
| `src/core/ecuc/resolve.ts` | exact-then-longest-suffix resolution |
| `src/core/ecuc/validate.ts` | `validateValue`, `isNumericLiteral`, `escapeXml` |
| `src/core/text/offsets.ts` | `LineIndex` over LF, CRLF and lone CR |

Fixtures: `basic`, `formatting` (CRLF), `namespaced`, `deep` (6 levels), `suffixes`,
`value-ambiguity`, `lexical`, `exceptions`, `references`, `not-ecuc`. Nine expected models are
committed; `formatting` has none on purpose — it is compared to `basic` through `stripRanges`, since
the point of that fixture is that layout does not change the model.

Evidence at implementation time:

```
npm run check-types   -> exit 0
npm run lint          -> exit 0
npx mocha --ui tdd "out/test/core/*.test.js"  -> 32 passing
npm test              -> NOT RUN: vscode-test cannot reach update.code.visualstudio.com (407)
```

AC1–AC8 have direct test evidence. The `pathIndex` open item in `design.md` §2.2 is settled — see that
section for the decision and its consequences.

Superseded at check time (Phase 2.2): `npm test` was blocked only by the environment (the VS Code
download hit a proxy `407`), and that block is gone — see "Phase 2.2 check" below, where AC9 is met
with a full `npm test` run.

## Done when

- [x] AC1–AC8 in `prd.md` pass (test evidence in the table above).
- [x] AC9 — `npm run check-types` ✅, `npm run lint` ✅, `npm test` ✅ (see "Phase 2.2 check").
- [x] No file under `src/core/` imports `vscode`.
- [x] No expected model was generated by the scanner.

## Rollback

This child is additive and self-contained: new files under `src/core/` and `src/test/`, plus one
`.gitignore` line. Reverting it cannot affect the editor child because nothing else depends on it yet.
If the `pathIndex` chain semantics (`design.md` §2.2) cannot be settled, ship resolution as
suffix-match-only and record that in the child's `prd.md` rather than guessing a chain.

## Guardrails

- No new runtime dependency; the scanner is hand-written (parent D7).
- No file I/O in `src/core/` — text in, model out.
- Do not add an ARTEXT text serializer or grammar (parent D4).
- Do not commit a real ECUC file (parent D13).

## Phase 2.2 check

Run against commit `0c09d4c`. Every AC was re-verified independently of the implementation summary.

Evidence observed at check time:

```
npm run check-types  -> exit 0
npm run lint         -> exit 0
npm test             -> exit 0, "34 passing" (1 bootstrap test + 33 core tests)
npx mocha --ui tdd "out/test/core/*.test.js" -> 33 passing
git grep vscode -- src/core  -> only a doc comment in model.ts, no import
```

`npm test` runs because `.vscode-test/vscode-win32-x64-archive-1.141.2` now exists: the download the
implementer could not do succeeded at check time, so the earlier `407` was environmental and is no
longer reproducible. Nothing in the code had to change for it.

Defect fixed at check time:

- `src/core/ecuc/scanner.ts` — an empty `<![CDATA[]]>` registered a zero-length text chunk, which set
  the element's `textStart`/`textEnd` to the marker itself. For `<VALUE><![CDATA[]]>abc</VALUE>` the
  recorded `valueRange` came out as `]]>abc` (and `<VALUE>abc<![CDATA[]]></VALUE>` as `abc<![CDATA[`),
  so a write would have replaced part of a CDATA marker and produced unbalanced markup. The CDATA
  branch now only appends a chunk when it is non-empty. Asserted by a new test in
  `src/test/core/scanner.test.ts`; both shapes fail without the guard and pass with it.

Parity gaps found at check time, both **fixed** afterwards (decision + fixture below). The legacy
toolchain is not runnable here, so both are settled against `reference/legacy-arxml2artext/Arxml2Artext.mm`
read directly, and both fixes are semantic, not byte-exact (parent D6):

1. **Annotation capture now reads the layered AUTOSAR shape — FIXED.**
   `src/core/ecuc/scanner.ts`: the capture set no longer treats `LABEL` / `ANNOTATION-TEXT` /
   `VERBATIM` as text tags. `L-4` inside a `LABEL` sets the label and `L-5` inside
   `ANNOTATION-TEXT/VERBATIM` sets the text (`.mm:61`), both `decode(...).trim()`-ed to match
   `MMstring\trim`. Per `.mm:61` there is no language predicate, so the **first** `L-4`/`L-5` in
   document order wins and later layers are ignored (only the first close assigns, guarded by
   `hasAncestor`). The label stays optional. Annotations stay a **list** — a documented deviation
   from the legacy single `/* … */` run, with the comment in the `annotation` case.
   `src/test/fixtures/suffixes.arxml` now uses the layered shape: an annotation with a two-layer
   `LABEL`/`ANNOTATION-TEXT` (EN then DE) and one with text but no label.
   `src/test/expected/suffixes.json` was **hand-authored** from the rules (offsets by literal
   arithmetic, not by the scanner). Tests: `AC1: annotations are read from the layered … shape` and
   `AC1: a flat annotation yields no label and no text` (the flat case pins the legacy behaviour —
   no fallback is invented).

2. **Instance-reference sort identity now includes the context — FIXED.**
   `src/core/ecuc/order.ts`: `referenceIdentity` returns `(targetRawPath ?? '') + contextPaths.join('')`,
   reproducing `.mm:139`'s `child[?VALUE-IREF].data` (target then context refs, document order, no
   separator). Non-instance references are unchanged (their context list is empty). The
   inter-element-whitespace approximation is recorded in the function comment. The exception-list
   branch and the parameter/reference separation are untouched. Test: `AC5: an instance reference
   orders by target plus context, not target alone`, which also asserts the old target-only ordering
   differs.

Both new tests were run against a temporary revert of their fix and failed (see the report), then the
revert was undone. Full validation after the fixes: `npm run check-types` exit 0, `npm run lint` exit 0,
`npx mocha --ui tdd "out/test/core/*.test.js"` 36 passing, `npm test` exit 0 / 37 passing (1 bootstrap +
36 core).

Unverified by construction: the expected models' provenance (no generator, snapshot or update path
exists anywhere in the repository — `git grep writeFileSync|snapshot|update` finds only the reader —
but authorship cannot be proven from the repository). The offsets in `expected/basic.json` were
re-derived independently from `basic.arxml` by literal-offset arithmetic, not by the scanner.
