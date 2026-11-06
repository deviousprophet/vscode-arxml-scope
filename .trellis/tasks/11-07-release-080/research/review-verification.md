# Research — v0.7.0 review verification

Date: 2026-11-07
Scope: verify the review claims against `e05a7df` (main after v0.7.0 and the DESIGN.md change).

## Verified in code

| Finding | Evidence |
|---|---|
| Semantic child identity embeds values/targets | `sortIdentity` returns `value:` for parameters and `target:…|context:…` for references; `childKey` adds kind and definition ref |
| Name substitutions only from high-scoring seeds | `learnSubstitutions` skips seeds with `score < 0.8` |
| Acceptance floor and margin | `assignSemantic`: `score < 0.62` rejected; `leftMargin >= 0.08 && rightMargin >= 0.08` |
| Identical siblings fail | Equal scores give a zero margin on both sides |
| Pair-limit cutoff | `lefts.length * rights.length > 250_000` → `continue` |
| Single render of learned substitutions | `learnSubstitutions` returns early when the map is non-empty |
| Lookup rebuild | `ensureLookups` rebuilds both maps whenever `lookupsAt !== generation` |
| Reverse references are linear | `referencesFor` loops every file and resolves every reference |
| UTF-8 only | `readFileIndex` constructs `new TextDecoder('utf-8')` |
| Rebuild race surface | `reindexFile` can `upsert` after `replaceAll`; `dirtyDuringBuild` only receives events that fire while `building` is true |

## Corrections to the review

- **Text features do have a size cap.** `TextFeatures.cached()` returns `oversized: true` when
  `text.length > arxmlScope.index.maxFileSizeMB` (default 50 MB). There is no debounce, but these
  providers are pull based; the real cost is rescanning per provider call, so the plan adds
  per-version caches. A dedicated `textFeatures.maxFileSizeMB` setting is only added if the 40 MB
  benchmark still blocks.
- **Validation has a 400 ms debounce and diagnostic caps.** `ValidationService.schedule()` debounces,
  and `validationCaps()` limits per-file and total diagnostics. The gap is that
  `validateWorkspace` runs synchronously in one turn; the plan slices that pass.

## Why the current tests pass

- The semantic unit fixture uses children `A=1` and `A=2`, which do not embed the container name, so
  `childrenScore` is high and `NMH→NM` is learned from the container names.
- The semantic benchmark's parent containers have identical names on both sides; the renamed prefix
  is in child container ids/names, which are not part of `sortIdentity` for containers. The benchmark
  therefore exercises bucket size and substitution, not embedded-value children.

## Deadlock math

For a container with 25 children and 20 embedding the old name:

- `childrenScore` ≈ 5/25 = 0.20.
- `nameScore` for `NMH_MO_01` vs `NM_MO_01` ≈ 0.585 (token Jaccard 0.5, Levenshtein ≈ 0.67).
- `positionScore` ≈ 1.
- Total ≈ 0.55 × 0.20 + 0.30 × 0.585 + 0.10 × 1 = 0.385, below 0.62.
- No seed reaches 0.8, so `NMH→NM` is never learned, and the next pass cannot improve the score.

The loop is closed by learning `NMH→NM` from the container names before child scoring.

## Decisions carried into the design

- Single renamed containers need a single-seed substitution path; the review's "at least two
  consistent pairs" rule alone does not fix that case.
- Identical-child siblings need a separate acceptance path; relaxing the global margin would make
  every bucket less safe.
- The above-limit fallback uses names after known substitutions, then position for duplicates; it
  reports a count when it still cannot pair.
- Async validation keeps the same rules and caps; only scheduling changes.

## Commands used

```powershell
node -p "require('./package.json').version"
git describe --tags --abbrev=0 --match "v*" HEAD
Select-String -Path src/core/diff/diffModel.ts -Pattern 'semanticPass|0.62|250_000'
Select-String -Path src/core/validation/validate.ts -Pattern '^export function'
```
