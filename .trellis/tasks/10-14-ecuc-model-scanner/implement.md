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

AC1–AC8 have direct test evidence. **AC9 is partial:** `check-types` and `lint` pass, `npm test` does
not run in this environment. The `pathIndex` open item in `design.md` §2.2 is settled — see that
section for the decision and its consequences.

## Done when

- [x] AC1–AC8 in `prd.md` pass (test evidence in the table above).
- [ ] AC9 — `npm run check-types` ✅, `npm run lint` ✅, `npm test` blocked by the environment, not by
      the code. Re-run once the VS Code download path works.
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
