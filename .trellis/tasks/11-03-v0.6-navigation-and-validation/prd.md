# v0.6: navigation and validation

## Goal

Deliver the v0.6 roadmap slice from `ARXML_EXTENSION_FEATURE_PLAN.md`:

- cross-file Jump to target, Find All References and broken-reference detection;
- ECUC validation diagnostics with per-rule severity;
- text-editor symbols, definition, references, document links, hover and diagnostics.

The v0.5 workspace index and definition resolver are the foundation. No new runtime dependency and no
derived file; diagnostics and navigation read the in-memory index.

## Task map

| Task | Delivers | Independent acceptance |
|---|---|---|
| `11-03-v0.6-cross-file-navigation` | `WorkspaceIndex` reference resolution, reverse lookup, provider jump/find-references, cross-file `followable` rows | Core + provider tests resolve a target in another file, refuse DEST mismatch/ambiguity, and list references |
| `11-03-v0.6-ecuc-validation` | Pure rule engine for seven rules, severity options, diagnostic collection, Problems panel + text-editor markers | Core rule tests and an extension test reading `languages.getDiagnostics` |
| `11-03-v0.6-text-editor` | Document symbols, definition, references, document links, hover for `.arxml` | Pure extraction tests plus `vscode.execute*Provider` extension tests |

The navigation child lands first because validation and the reference provider consume its resolver.
Validation lands before text-editor diagnostics so B3 only has to surface the existing collection.

## Cross-child acceptance criteria

- `npm run check-types`, `npm run lint`, `npm test` and `npm run benchmark` pass with all children.
- `src/core/**` keeps the no-`vscode`/no-DOM rule.
- An absent or ambiguous target never guesses and never throws; it becomes a diagnostic.
- Diagnostics are recomputed after an index change and cleared when validation is disabled.
- Text-editor providers return empty results for non-ARXML files and for a disabled index.
- Nothing is written beside a user file.

## Out of scope for v0.6

- Bundled XSDs and schema-aware completion (v0.7).
- Diff against Git and folder compare (v0.8).
- Editing from definitions, rename and quick fixes (v0.9+).
