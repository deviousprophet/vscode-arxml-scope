# Implementation plan: text-editor integration

1. Add `core/text/arxmlFeatures.ts` with ref tokens and symbol data; test it against the existing
   `references.arxml`/`basic.arxml` fixtures.
2. Add `host/textFeatures.ts` with the five providers and a URI+version scan cache.
3. Register the providers in `extension.ts`.
4. Add `src/test/extension/textFeatures.test.ts` driving the VS Code provider commands.
5. Run `npm run check-types`, `npm run lint`, `npm test`.

Rollback: remove the registration; the providers are self-contained and the custom editor unchanged.
