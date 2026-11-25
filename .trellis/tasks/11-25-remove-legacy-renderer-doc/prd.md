# Remove the retired legacy DOM renderer doc

## Goal

Delete the historical `docs/contributor/legacy-dom-renderer.md` page, which documents a renderer that no longer exists and is kept only “for history”.

## Requirements

- Delete `docs/contributor/legacy-dom-renderer.md`.
- Remove its rows from `docs/README.md` and `docs/contributor/DEVELOPMENT.md`.
- Leave the docs index complete: every remaining file under `docs/` is listed once.
- Leave no `legacy-dom-renderer` path references.
- Do not change the row parity suite, `oracleRows.ts` or `diffCodeParity.test.ts`.

## Acceptance criteria

- [x] The retired page no longer exists.
- [x] `rg legacy-dom-renderer` returns no matches.
- [x] The docs index still covers every file under `docs/`.
- [x] Every relative Markdown link in the changed pages resolves.
- [x] `git diff --check` is clean.
- [x] Docs-only change: no product test suite required.

## Non-goals

- Removing the Rust/TypeScript row parity suite.
- Removing the Monaco patch source contract.
- Rewriting historical git history.
