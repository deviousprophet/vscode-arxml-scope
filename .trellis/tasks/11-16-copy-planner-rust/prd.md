# Copy planner in Rust

## Goal

Move the merge-mode copy planner out of TypeScript. The Rust engine becomes the only
implementation of element replacement, insertion, deletion, re-indentation and
missing-ancestor wrapping; the host keeps only range discovery and `WorkspaceEdit`
application.

## Requirements

- Add `arxml-core/src/copy.rs` with:
  - `plan_copy` — replace, insert after/before, or refuse with the existing reasons;
  - `plan_delete` — remove the target's whole line when it owns it;
  - `reindent` — shift every line by the indent delta and adopt the target line break;
  - `wrap_with_ancestors` — minimal container chain with one child list per ancestor;
  - `removal_span`, `indentation_at`, `line_break_of`.
- Add a `copy.plan` engine operation. It takes document ids, not full texts:
  `{kind: "copy"|"delete", targetDocId, sourceDocId?, source?, target?, anchorAfter?, anchorBefore?, ancestors?}`.
  The engine slices its own retained documents by UTF-16 offsets.
- Response: `{ok:true, span:{start,end,text}}` or `{ok:false, reason}`. Offsets are
  UTF-16, matching the diff and `WorkspaceEdit`.
- Host `diffPanel` calls `engine.planCopy` (new optional `CoreEngine` method) and
  keeps no copy arithmetic. The TypeScript module becomes a test oracle only.
- `wrapWithAncestors` in the host's `synthesizeInto` is replaced by one engine call
  that returns the full insertion span.
- Add a CLI `copy` command that accepts a JSON request with explicit texts, for
  parity and manual probes.
- Port the TypeScript unit tests to Rust and add `scripts/parityCopy.mjs` comparing
  the TypeScript oracle with the CLI on the same request corpus.

## Acceptance criteria

- [ ] Every existing `planCopy` test case produces byte-identical spans in Rust.
- [ ] CRLF targets get CRLF output; LF targets get LF; mixed source is converted.
- [ ] Replace, insert-after, insert-before, delete-whole-line and inline delete work.
- [ ] Missing ancestors wrap in the right order with the right `DEST` and child list.
- [ ] `copy.plan` refuses stale/no-anchor cases with the current messages.
- [ ] No `planCopy`, `wrapWithAncestors` or `reindent` import remains in `src/host/`.
- [ ] `parityCopy` passes on the corpus; `copy` is listed in `rust/README.md`.
- [ ] UTF-16 offsets are correct for a non-ASCII and an emoji fixture.

## Constraints

- Do not send 50 MiB document texts over stdio per copy; use document ids.
- Keep `planCopy.ts` as an oracle until the copy path has parity, then stop importing
  it from production code.
- Refusals must leave bytes untouched.
