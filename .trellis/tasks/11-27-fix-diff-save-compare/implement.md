# Implementation plan — fix diff save and comparison truthfulness

## Phase 1 — Protocol

- [ ] Add `save` to `DiffWebviewToProvider` and its type guard/tests.
- [ ] Add a page-side invalid-side guard.

## Phase 2 — Diff save

- [ ] Add the page `Ctrl+S`/`Cmd+S` handler with focus-side selection and no optimistic clear.
- [ ] Handle `save` in `diffPanel`: find the open document, `save()`, keep the existing
      `onDidSaveTextDocument` label/copyDirty refresh.
- [ ] Prove with the host `merge` scenario: copy, focus pane, `Ctrl+S`, bytes change + markers
      clear.
- [ ] Prove the no-op path: clean diff `Ctrl+S` does not write.

## Phase 3 — Deleted first file

- [ ] Re-check the stashed URI before opening the comparison.
- [ ] Warn, keep the stash, open no panel.
- [ ] Add the extension test with a deleted stashed file.

## Phase 4 — Verification

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run engine:smoke`
- [ ] `npm run rust:test`
- [ ] `UX_HOST_ONLY=merge` and `UX_HOST_ONLY=stale-first` pass the new checks.
- [ ] No unrelated diff/merge behavior changes.

## Rollback

Revert the child branch; no migration.
