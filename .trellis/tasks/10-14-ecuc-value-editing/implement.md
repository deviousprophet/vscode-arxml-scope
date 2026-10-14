# Implementation plan: ECUC value editing in the custom editor

Ordered checklist for this child. Design: `design.md` + `../10-14-ecuc-artext-editor/design.md` §8, §9.
**Do not start** until child `../10-14-artext-custom-editor` is complete. Parent **Spike A**'s API half is
already settled (`../10-14-ecuc-artext-editor/research/spike-results.md`): there is **no** custom-document
edit-event contract to satisfy, because undo, redo, dirty state and save belong to the real
`TextDocument`. Its behavioural rows (one press per undo, dirty dot, save persists) should be observed
before this child is closed out, but they do not gate starting it.

## Order

- [x] 1. `src/editor/ecucEdit.ts` — the edit record `{ nodeId, region, oldText, newText }` and the region
      resolution for both kinds (`design.md` §2.1). **No document class**: `resolveCustomTextEditor`
      receives the real `TextDocument`, and nothing is cached across a change.
- [x] 2. `src/editor/ecucEdit.ts` — `applyEdit(record)`: recompute the region by re-scan, replace via
      **one** `WorkspaceEdit`, re-scan, push the model (`design.md` §2.2, §2.3). No
      `CustomDocumentEditEvent` and no private history (`design.md` §2.4) — undo and redo come from the
      text document itself.
- [x] 3. `src/editor/ecucEditorProvider.ts` — the edit message handler: validate **before** applying,
      and return the refusal reason as a `notice` with no mutation (`design.md` §2.5).
- [x] 4. `src/editor/ecucValueEditor.ts` — the in-tree editor widget: shows the current value, commits
      on Enter, cancels on Escape, and displays the secondary hex where the model provides one.
- [x] 5. Verify save, revert and save-as **behaviour** rather than implementing hooks (R12, AC5): they
      are the ordinary text-document operations. If a revert does not refresh the view, the fault is in
      the re-scan subscription, not in a missing hook.
- [x] 6. `src/test/fixtures/editing/*.arxml` — a numeric parameter, a textual parameter, a self-closing
      `<VALUE/>`, a value needing escaping, a CDATA-backed value, and a CRLF document; plus the
      expected post-edit bytes for each.
- [x] 7. `src/test/editor/editing.test.ts` — per the table below.

## Test coverage

| Assertion | Test |
|---|---|
| AC1, AC2, AC3 — byte comparison after each edit kind | open a **copy** of each fixture in a temp directory, edit, compare bytes with the expected file |
| AC4 — undo and redo byte comparison | edit, undo, compare; redo, compare |
| AC5 — dirty, save, revert | assert dirty after edit, clean after save, and that revert restores the on-disk bytes and re-renders |
| AC6 — refusal leaves the file untouched | invalid value and XML-illegal character; compare bytes before and after |
| AC6 — a CDATA-backed value is refused | `regionOf` resolves neither kind for a CDATA span, and the handler refuses with text, disk bytes and `isDirty` all unchanged |
| AC6 — a record whose region no longer resolves | `applyEdit` refuses, and the bytes are unchanged |
| AC7 — unchanged value is a no-op | assert the document is not dirty afterwards |
| AC7 — a CRLF document is preserved | edit a copy of `crlf.arxml`, compare the whole text and the on-disk bytes with a hand-derived expectation, and count the `\r\n` pairs |
| AC8 — view never stale | assert the pushed model equals a fresh scan after edit, undo and redo |
| AC9 — only the edited file is touched | snapshot the directory before and after |

Editing tests run against a copy in a temporary directory, never against a committed fixture: a test
that edits its own fixture in place fails on the second run and silently rewrites the repository.

## Validation commands

| Purpose | Command |
|---|---|
| Types | `npm run check-types` |
| Lint | `npm run lint` |
| Full suite | `npm test` |

## Done when

- [x] AC1–AC10 in `prd.md` pass.
- [x] AC1, AC2 and AC4 are byte comparisons, not value comparisons — the criterion is that nothing else
      in the file moved.
- [x] `npm run check-types`, `npm run lint`, `npm test` are green.
- [x] A refusal path is confirmed to leave the bytes untouched (AC6), inspected rather than assumed.
- [x] Undo is confirmed to need exactly one press per edit (parent `design.md` §9).

## Built

| File | What it holds |
|---|---|
| `src/editor/ecucEdit.ts` | `EcucEditRecord`, `regionOf`, `touchesCdata`, `wrapElement`, `buildEdit`, `applyEdit` |
| `src/editor/ecucEditorProvider.ts` | the `edit` message handler (`editValue`), one `WorkspaceEdit` per action |
| `src/editor/ecucValueEditor.ts` | the in-tree editor widget, as the webview half of the script |
| `src/editor/renderHtml.ts` | `data-value` on a parameter node, the widget script and its CSS, one `acquireVsCodeApi()` |
| `src/test/fixtures/editing/*.arxml` | `numeric`, `textual`, `self-closing`, `escaping` + `.expected` bytes for each; `cdata` (refused) and `crlf` (byte-preserving) |
| `src/test/editor/editing.test.ts` | 20 tests: AC1–AC9, the §2.1 record shapes, the §2.2 recompute, the CDATA refusal, the CRLF path, the widget wiring |

`buildEdit` validates before `applyEdit` structurally: it returns a refusal or a record, and the handler
never reaches the write path without a record. The widget posts the same `{ type: 'edit', nodeId, value }`
the parent `design.md` §8 specifies; the existing `reveal` / `follow` / `model` / `select` / `notice`
protocol is unchanged.

Observed results — `npm run check-types` clean, `npm run lint` clean, `npm test` **93 passing, 0 failing**
(73 before this child; 88 when the child was first committed, plus the five the check pass added below).
The committed suite holds 15 tests, not the 14 the first version of this line claimed. Every editing test
passed on the first full run, including AC4's undo/redo and AC5's save/revert, which drive VS Code's own
`undo`, `redo` and `workbench.action.files.revert`.

## Decisions taken where the design left a gap

1. **There is no `elementRange` on the model.** The scanner sets `valueRange` to the *inner text* when
   there is text and to the *whole element* when the value is empty or self-closing, so the region kind
   is derived from the bytes (`text[valueRange.start] === '<'`) and no second range is needed. For a
   re-scan of a recorded `element` region that now has text, the element span is recovered by expanding
   `valueRange` outward to the enclosing tags. `src/core/**` was **not** modified: the existing ranges
   were sufficient, so there was no defect to report.
2. **No push after a successful write.** The checklist's "re-scan, push the model" is the existing
   `onDidChangeTextDocument` subscription. Pushing from the handler as well would be a second update
   path for one change, and `rescan.test.ts` counts pushes against the platform's own events.
3. **How an edit starts.** The tree's single click already posts `reveal`, which swaps the editor, so
   "click the value" (or F2) begins the edit and the widget stops that click from reaching the reveal
   handler; Enter commits, Escape cancels, and Enter on a node that is not being edited still reveals.
4. **One guard beyond the design.** `applyEdit` refuses when the recomputed region's `oldText` differs
   from the record's, so a record prepared against bytes that have since moved cannot overwrite what the
   user never saw. Covered by a test.
5. **CDATA-backed `<VALUE>` values are out of scope — and are refused, not written.** The scanner's
   `valueRange` points *inside* the CDATA section, and that byte range is not interchangeable with
   escaped text content. The check pass found that the first version of this decision was only a
   statement: the writer still reached the section, in three distinct ways, all of them wrong.
   `touchesCdata` (added by the check pass) refuses any region that is inside or straddles a
   `<![CDATA[…]]>` section, so the three are now refusals with a `notice` and no mutation:
   - `<VALUE><![CDATA[<b>]]></VALUE>` — the content begins with `<`, so the byte rule in `regionOf`
     picked the **element** shape, `wrapElement` wrapped the CDATA content in tags, and the file ended
     up holding `<b>42</b>` although the user typed `42`. A silent wrong write; the value no longer
     says what the user asked for.
   - `<VALUE><![CDATA[plain]]></VALUE>` typed as `a&b` — a shape-1 replacement put `a&amp;b` *inside*
     the section, where `&amp;` is the literal four characters, so a conforming XML parser reads a
     different value than the editor showed.
   - `<VALUE><![CDATA[a]]>b</VALUE>` and `<VALUE>a<![CDATA[b]]></VALUE>` — the scanner's range spans
     the markers, so the replacement deleted `]]>` or left a stray one. The first of those produces
     `<VALUE><![CDATA[42</VALUE>`, which is not well-formed XML at all.
   No acceptance criterion covers CDATA and no editing fixture had used it; `lexical.arxml` still has
   one and nothing edits it. `cdata.arxml` and two tests now pin the refusal.
   *Upgrade path if it is ever wanted:* write the value's raw text into the section without escaping
   (splitting any `]]>` across two sections) instead of refusing.

## What the check pass verified

Independently of the implementer's summary, and with the evidence named:

- **The expected-bytes fixtures are correct, re-derived from the rules.** Each `.expected` file differs
  from its input in exactly one contiguous span, and the delta accounts for it exactly: `numeric`
  `7`→`42` (+1), `textual` `bee`→`hello world` (+8), `self-closing` `<VALUE/>`→`<VALUE>42</VALUE>` and
  `<VALUE></VALUE>`→`<VALUE>named</VALUE>` (+14), `escaping` `&amp;plain`→`a&amp;b&lt;c&gt;d` (+7).
  Every other byte — indentation, line endings, comments, sibling values, attribute spacing — is
  identical, and each new text is what parent `design.md` §8 says to write (escape `&`, `<`, `>`;
  `<VALUE>encoded</VALUE>` for the element shape).
- **AC4 and AC5 are not tautological.** Both `waitFor` a *fresh* `document.getText()`: AC4 fails if one
  `undo` does not restore the original bytes (so it also proves one press per edit), and AC5 fails if
  `workbench.action.files.revert` does not reload from disk, then asserts the re-render separately by
  requiring the pushed tree to contain `= 42` and not `= 99`. `isDirty` is asserted `false`→`true`→
  `false` across the edit and the save, and the on-disk bytes are read back with `fs.readFileSync`.
- **AC6 refusals leave the bytes untouched**, each verified through text, disk bytes and `isDirty`: the
  invalid numerical value, the XML-illegal character (the disk read was added by the check pass), the
  CDATA value, and the region-that-no-longer-resolves path through `applyEdit`. The mismatched-bytes
  guard is covered by the stale-region test, which asserts the competing bytes survive.
- **AC9 isolation, proved rather than assumed.** The committed fixtures were hashed before and after
  four full `npm test` runs: every pre-existing file is byte-identical, and `git status` shows only the
  intended modifications. The CRLF/LF pins in `.gitattributes` (`src/test/fixtures/** -text`) hold.
- **AC8 compares the pushed output against an independently produced scan.** `expectedTree` re-scans
  `document.getText()` at assertion time; the pushed tree comes from the provider's own cached model. If
  the subscription did not fire, `waitFor` times out on the previous message.
- **One `WorkspaceEdit` per user action, and nothing writes outside the recomputed region.** `applyEdit`
  is the only `applyEdit` call and builds one `WorkspaceEdit` with one `replace` of the computed range;
  `grep` finds no `writeFile`, `fs.` or `createFile` anywhere in `src/editor/**`. The byte comparisons
  above are what proves the region is the right one.
- **The CRLF path, which had no coverage.** `LineIndex.positionAt` matches `document.positionAt` on a
  CRLF document everywhere a region boundary can fall; the only divergence is the offset of the `\n`
  inside a `\r\n`, where VS Code reports the `\r` instead. A region never begins or ends there — the
  value's bytes are whitespace-trimmed first — and `crlf.arxml` plus two tests now pin both the
  byte-exact CRLF edit and that divergence. (The core `offsets.test.ts` states the non-clamping
  behaviour as its own contract; it is not a defect, but its "follow VS Code" comment is loose for that
  one offset. `src/core/**` was not touched.)

## Still unobserved

- **Spike A's behavioural rows A1–A8 remain unobserved.** A human must still press Ctrl+Z, watch the
  dirty dot and save in an Extension Development Host, per
  `../10-14-ecuc-artext-editor/research/spike-results.md`. The editor tests above drive the same
  platform behaviour through its commands, which is not the same as the manual observation the rows ask
  for; do not record them as passed.
- **The widget's DOM behaviour is not covered by a test.** `@vscode/test-electron` has no webview DOM, so
  `editing.test.ts` asserts the widget is rendered, styled and wired (the edit message, the id it posts,
  the Enter/Escape branch) but never that a click opens the input. The inline script is parsed by
  `node --check` and `acquireVsCodeApi()` is asserted to appear once.
- **The click gesture is therefore unverified against child 2's reveal.** Child 2's reveal tests drive
  the `vscode-arxml-scope.revealInSource` **command**, never the webview's click listener, so nothing
  exercises the interaction decision 3 describes. The intended consequence should be confirmed by hand:
  clicking a **parameter's** `= value` span now starts an edit instead of revealing (the label,
  short-name and hex spans still reveal, and Enter still reveals); clicking a **reference's** target
  still follows, because `beginValueEdit` declines a non-parameter. If that split is not wanted, the
  gesture belongs in a decision, not in the widget.
- **Live pairing of the custom editor and the text editor** is Spike B, untouched here.

## Rollback

Additive: new files under `src/editor/` and `src/test/editor/`, plus the edit message handler in the
provider. The scanner child is untouched and there is no document class to remove. If Spike A's
behavioural rows show that undo needs more than one press per edit, **stop** rather than implementing a
private undo stack: a custom editor whose undo diverges from VS Code's is worse than one that does not
edit yet.

The check pass added `touchesCdata` and one refusal branch to `src/editor/ecucEdit.ts`, five tests and
two fixtures (`cdata.arxml`, `crlf.arxml`). Nothing in `src/core/**`, `src/spikes/**`, `spike/**` or
`research/spike-results.md` was modified. `npm run check-types`, `npm run lint` and `npm test`
(93 passing, 0 failing) were re-run after the change.

## Guardrails

- One `WorkspaceEdit` per user action, so one action is exactly one undo step; do not batch two edits
  into one, and do not split one into two.
- Never write outside the recorded region, and never rewrite the document as a whole for formatting
  (parent D3).
- Never skip validation to make a test pass; AC6 exists to make that visible.
- Do not reintroduce the ARTEXT text form, grammar, `Open as ARTEXT` or Compare (parent D4).
- Do not write any derived file (parent D15).
- Keep all validation in `src/core/`; version guards and editor code do not belong in the scanner.
