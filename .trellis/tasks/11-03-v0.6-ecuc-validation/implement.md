# Implementation plan: ECUC validation

1. Add `sourcePath`, `value` to `IndexElement`; `lineStarts` to `FileIndex`; record them in
   `IndexBuilder` and the parameter/reference finish paths. Add `WorkspaceIndex.files()`.
2. Add `core/validation/types.ts`, `rules.ts`, `position.ts`; implement the seven rules and severity
   filtering.
3. Add `host/validationService.ts`; wire it into `extension.ts`.
4. Add the two settings and the diagnostic collection lifecycle.
5. Add core tests per rule and the position helper test.
6. Add the extension diagnostics test.
7. Run `npm run check-types`, `npm run lint`, `npm test`.

Rollback: remove `ValidationService` and the settings; the index additions are backward-compatible.
