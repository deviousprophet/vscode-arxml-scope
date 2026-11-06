# Release 0.8.0: semantic renames, index robustness and bounded scans

## Goal

Ship one minor release that closes the v0.7.0 review findings: semantic rename matching works on the
motivating shape, the workspace index is race-free and encoding-aware, lookups and Find References
scale with workspace size, and text features plus validation no longer block the extension host on
large workspaces.

`0.7.1` is superseded. The open items add new behavior (encoding support, incremental lookups, a
reverse-reference map) and change performance characteristics, so the release is a minor bump.

## Context

The v0.7.0 review verified four semantic-matching defects, three index limitations (G5, G7, G8), a
linear Find References scan, and a synchronous validation pass. Two review statements need correction
before they become requirements:

- `textFeatures.ts` **does** have a size cap: `cached()` returns no features when
  `text.length > arxmlScope.index.maxFileSizeMB`. It has no debounce, but these providers are pull
  based, so the gap is repeated work per provider call, not debouncing.
- Validation already has a 400 ms debounce and diagnostic caps; the gap is that `validateWorkspace`
  runs as one synchronous pass.

## Requirements

### Semantic rename matching

- **R1 Name-first learning.** Substitutions must be learned from container names in the same bucket
  before child scoring, so children whose values embed the old name can match.
- **R2 Iteration.** Learning and assignment must repeat until no new substitution appears, with a
  bounded iteration count.
- **R3 Single rename.** One renamed container with most children embedding the old name must pair;
  replacement learning must not require two examples when the pair is unambiguous.
- **R4 Identical siblings.** Containers with identical children must pair deterministically using
  name and ordinal position instead of being rejected by the score margin.
- **R5 Cutoff.** A bucket above the 250,000 pair product must not be silently skipped. Apply a cheap
  name/position fallback and surface a count when the fallback still leaves the bucket unpaired.
- **R6 Strict parity.** `semanticMatching: false` must keep today's exact output.

### Index correctness

- **R7 Rebuild race (G5).** A file reindex that starts before a rebuild must not write stale content
  after the rebuild snapshot. The rebuild must win or re-read the file.
- **R8 Encoding (G7).** Index UTF-8 with or without BOM, UTF-16LE BOM and UTF-16BE BOM, plus the
  common encodings declared in the XML declaration. Unsupported encodings are skipped and reported,
  never decoded as mojibake.
- **R9 Incremental lookups (G8).** A single-file upsert or remove must update the path lookups
  without rebuilding every file's entries.

### Index performance

- **R10 Reverse-reference map.** `referencesFor` must answer from a per-generation map instead of
  resolving every reference on every call, and must stay correct after file changes.

### Bounded scans

- **R11 Text-feature caching.** Cache symbols and document links per document version so repeated
  provider calls do not rescan the same text. Keep and document the existing size cap.
- **R12 Asynchronous validation.** Keep the debounce and caps, but run the rule pass in cancellable
  slices so the extension host stays responsive; publish the same diagnostics as today.
- **R13 Progress and cancellation.** A newer index change cancels an in-flight validation run; the
  status surface reports that validation is running.

### Release

- **R14 Version and notes.** Version `0.8.0` in `package.json` / lockfile, a `CHANGELOG.md` section
  for the release, and updated `docs/DIFF.md` / `docs/ECUC_EDITOR.md` for the changed behavior.
- **R15 Gates.** Unit tests, benchmarks, production package and VSIX stay green; the release is
  tagged only after an explicit request.

## Acceptance Criteria

- **AC1** A four-container rename where 10 of 25 children embed the old name pairs all four
  containers; the same holds for 15, 20 and 25 embedded children.
- **AC2** A single renamed container with 20 of 25 embedded-name children pairs instead of appearing
  as one removal plus one addition.
- **AC3** Four identical-child siblings named `PDU_01`…`PDU_04` pair in order, deterministically.
- **AC4** A bucket above the pair limit runs the fallback; unique names pair, and any remaining
  unpaired bucket is reported in the diff result.
- **AC5** With `semanticMatching: false`, the existing semantic fixtures produce the same rows as
  before the change.
- **AC6** A reindex started before a rebuild and completed after `replaceAll` leaves the newest file
  content in the index.
- **AC7** UTF-8 BOM, UTF-16LE BOM and UTF-16BE BOM fixtures index their elements and definitions
  correctly; an unsupported encoding is reported as skipped.
- **AC8** A one-file change on a 200k-element index updates lookups without a full rebuild, measured
  below 50 ms.
- **AC9** Find References on the 42 MB workspace completes under 100 ms warm.
- **AC10** The 36 MB validation fixture yields between slices (no slice longer than 50 ms) and
  publishes exactly the diagnostics the synchronous pass produced.
- **AC11** `npm test`, `npm run lint`, `npm run benchmark`, `npm run package` and the VSIX listing
  pass; PR CI is green.
- **AC12** Version `0.8.0`, changelog and docs are updated, and `v0.8.0` is created only after merge
  and explicit approval.

## Constraints

- No new runtime dependencies.
- Existing settings keep their current defaults; new settings, if needed, default to today's
  behavior.
- Strict mode output and validation rule text/severity/caps are unchanged.
- The release follows the normal branch → PR → CI → merge → tag flow.

## Out of scope

- New validation rules or severity behavior.
- A worker-thread validation architecture.
- A UI redesign of the diff or the document surface.
- Replacing the ECUC scanner or the XML parser.
