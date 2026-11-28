# Verification — fix diff save and comparison truthfulness

Worktree: `H:\workspace\arxml-scope-worktrees\diff-save-compare` (branch `fix/diff-save-compare`).

## Gate results

| Command | Result |
| --- | --- |
| `npm run check-types` | pass |
| `npm run lint` | pass (design lint: 0 errors / 0 warnings) |
| `npm test` | 956 passing, 0 failing |
| `npm run engine:smoke` | pass (`diffOk`, `patchOk`, `exitCode: 0`) |
| `npm run rust:test` | pass (60 + 5 tests, 0 failed) |

Logs: `research/logs/check-types.log`, `research/logs/lint.log`,
`research/logs/test-run-final.log`, `research/logs/engine-smoke.log`,
`research/logs/rust-test.log`.

## Host scenarios

Both were run with `node esbuild.js` staging the page bundle first.

- `UX_HOST_ONLY=merge` — `research/evidence/host-merge/driver-report.json`
  - receiving pane shows `right.arxml •`
  - `right.arxml` is the dirty tab after the copy
  - `Ctrl+S` in the modified pane → `dirtyAfterSave: []`, `rightChanged: true`
- `UX_HOST_ONLY=stale-first` — `research/evidence/host-stale-first/driver-report.json`
  - `existsAfterDelete: false`
  - notification: `Cannot compare: "stale-first.arxml" no longer exists. Select it again as the first file.`
  - `tabs: []` (no diff panel)

Both scenarios were re-run after the final `npm test` build; logs are
`research/logs/host-merge-final.log` and `research/logs/host-stale-first-final.log`.

## Focused extension/protocol tests

- `npx vscode-test -f "UX-06"` — 2 passing
- `npx vscode-test -f "UX-07"` — 2 passing
- protocol suite included in the full run: valid `save` side accepted, `both`/missing side dropped.

## Main-checkout hygiene

All writes used absolute paths under the worktree. No file under
`H:\workspace\vscode-arxml-scope` was written by this session. The docs differences visible in
that checkout (`docs/user/DIFF.md`, `docs/user/MERGE.md`) belong to the sibling feedback task and
are not part of UX-06/UX-07, so they were not copied into this worktree.
