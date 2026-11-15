# Copy planner in Rust — technical design

## Core module

```rust
pub struct CopyRange { pub start: usize, pub end: usize }   // UTF-16
pub struct CopySpan { pub start: usize, pub end: usize, pub text: String }

pub struct CopyRequest<'a> {
    pub target: &'a SourceText,
    pub source: &'a SourceText,
    pub source_range: CopyRange,
    pub target_range: Option<CopyRange>,
    pub anchor_after: Option<CopyRange>,
    pub anchor_before: Option<CopyRange>,
    pub ancestors: &'a [MissingAncestor],
}

pub enum CopyPlan { Ok(CopySpan), Refused(String) }
```

`SourceText::slice_utf16` supplies the element text; `as_str()` supplies the line
break check. `indentation_at` reads the prefix on the line that contains `offset`.

The algorithms are a direct port:

- `replacement`: slice source range, reindent to the target range's line indent,
  return `{target.start, target.end, text}`.
- `insertion`: reindent, then insert after `anchor_after.end` with
  `separator + target_indent + block`, or before `anchor_before.start` with
  `block + separator + target_indent`.
- `deletion`: `removal_span` chooses the whole line when the element owns both ends,
  including the line break.
- `wrap_with_ancestors`: the TS loop, using the same four-space step and list tags.
  `line_break` defaults to the element text but the engine passes the target's.

Names and reasons are exported constants so tests compare exact strings.

## CLI

```
arxml-cli copy --request <file.json>
```

JSON: `{targetText, sourceText, source:{start,end}, target?, anchorAfter?,
anchorBefore?, ancestors?, lineBreak?}`. Output: the `CopyPlan` JSON. This is only a
parity/probe surface; the engine operation uses document ids.

## Engine operation

`copy.plan` in `main.rs`:
1. Resolve `targetDocId` and optional `sourceDocId` in `documents`.
2. Build `CopyRequest` with `target.text()` / `source.text()`.
3. `kind:"delete"` calls `plan_delete`; `kind:"copy"` calls `plan_copy`.
4. Serialize the plan to the body with `ok:true` on the header.

`ancestors` deserializes to `MissingAncestor { shortName, definitionRef,
definitionDest, childKind }`.

## Host

`CoreEngine` gains:

```ts
planCopy?(request: EngineCopyRequest): Promise<EngineCopyPlan>;
```

`diffPanel`:
- `copyInto`: `engine.planCopy({kind:'copy', targetDocId, sourceDocId, source,
  target, anchorAfter, anchorBefore})`.
- `copyDelete`: `kind:'delete'`.
- `synthesizeInto`: `engine.planCopy({kind:'copy', ..., ancestors: chain.ancestors})`
  using the anchor computed by the existing row walk; the engine computes indent,
  wrapping and insertion.
- On `ok`, `applyPlan` as today; `patchAfterCopy` sends the same span to
  `doc.update`/`diff.patch`.
- If the method is missing (a test double), post an error instead of silently doing
  nothing.

The host keeps `preparedLeft/Right` versions and range discovery; those are data,
not copy arithmetic.

## Parity harness

`scripts/parityCopy.mjs`:
1. Build the TS oracle (`src/test/parity/oracleCopy.ts`) with esbuild.
2. For each case (fixtures + generated indents/line endings/ancestor chains), call
   the oracle and `arxml-cli copy --request <tmp>`.
3. Deep-compare the plans; one failure exits non-zero.
Add `parity:copy` to `package.json` and the Rust CI job.

## Tests

Rust unit tests port every `planCopy.test.ts` case, plus:
- UTF-16: an element preceded by `é` and one containing an emoji; start/end must stay
  in UTF-16 units.
- CRLF target with LF source.
- Two-level ancestor chain.
TS keeps the existing suite, now labeled oracle.
