# Engine supervisor — implementation plan

1. Extend `engineClient.ts`:
   - constructor options `onExit?: (error: EngineError) => void`
   - getters `pid`, `pendingCount`
   - `abort()` on invalid frame, malformed header and fatal notification.
2. Add `engineSupervisor.ts` with the state machine, document registry, restart
   policy, replay, health and `createSupervisor(start, binary, root)`.
3. Extend `CoreEngine` with optional `health`, `restart`, `onDidChangeState`.
4. Change `engineLoader.resolveEngine` to build the supervisor; keep the same
   activation errors for a missing binary and protocol drift.
5. Add `formatHealth` and `registerEngineStatus`:
   - output channel, status bar, command in `extension.ts`
   - command id in `package.json`.
6. Tests:
   - pure supervisor tests with a fake client factory
   - real-engine restart test
   - health formatter test
7. Run: `npm run check-types`, `npm run lint`, `npm run compile-tests`,
   targeted `npm test`, `cargo test` (unchanged but confirm).
8. Update `rust/README.md` restart paragraph.

## Validation

```bash
npm run check-types
npm run lint
npm run compile-tests
npx vscode-test --grep "engine supervisor|engine"
cargo test --manifest-path rust/Cargo.toml --workspace
```

Manual: in the Extension Development Host, run `ARXML Scope: Show Engine Status`,
kill the engine from Task Manager, then edit a value; the status bar returns to
running and the edit applies.

## Rollback

The supervisor is one new module plus wiring. Reverting the commit restores the
single-client behavior; no protocol change is involved.
