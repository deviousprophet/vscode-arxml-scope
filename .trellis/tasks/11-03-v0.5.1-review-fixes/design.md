# Design: v0.5.1 review fixes

## Lookup construction

`WorkspaceIndex.ensureLookups` currently concatenates with `elements.push(...file.elements)`. Replace with a nested `for` loop, which has no argument-count limit. Build into fresh maps, and only publish them at the end. `ensureLookups` wraps the build in `try/catch`: on failure it installs empty lookups and records the generation, so later lookups return `undefined` instead of rethrowing. The index itself stays intact; only definition/element lookup degrades.

`buildRows` calls the definition lookup per row. `definitionFor` wraps the call in `try/catch` and returns `undefined` on failure, so one bad definition cannot block the row document.

## UUID and multiplicity

- `open()` stores the `UUID` attribute on any frame that can own one (`AR-PACKAGE`, module/container values, references, definitions). The existing `<UUID>` text path remains.
- Add `UPPER-MULTIPLICITY-INFINITE` to the text tags and `setDefinitionField`; `IndexDefinition.upperMultiplicityInfinite?: boolean`.
- `definitionInfo` maps an infinite flag to upper `-1` before `multiplicityText`, producing `0..*`.

## Rebuild lifecycle

```
runRebuild:
  building = true; updateStatus()
  try:
    uris = findFiles
    read every file
    dirty = drain dirtyDuringBuild
    replaceAll(files)
    for each dirty uri: await reindexFile(uri)
  finally:
    building = false; lastIndexedAt = now; publish()
```

`schedule` records the URI in `dirtyDuringBuild` when `building` is true. `reindexFile` does not call `publish` when called from the drain path; the final `publish` covers it.

`start()` calls `void this.rebuild().catch(() => undefined)`; `runRebuild` already swallows discovery/read failures so the previous index survives, but the catch removes the unhandled-rejection tail.

## Benchmark

`src/test/benchmarks/indexBenchmark.ts` builds a synthetic ECUC text with enough containers/parameters to exceed 150k elements, runs `IndexBuilder` over it, then resolves one element and one definition through `WorkspaceIndex`. It emits `_type: "large-file-load"` records (the existing renderer) plus a `large-file-summary`. Limits: 60 s per stage and 1 GiB retained; it must stay headless.

## Documentation

Extend `docs/ECUC_EDITOR.md` limitations with disk-only reads, UTF-8, global lookup rebuild and the parser split. No code change for these.

## Rollback

R1–R6 are independent small changes; revert the commit to restore the reviewed state.
