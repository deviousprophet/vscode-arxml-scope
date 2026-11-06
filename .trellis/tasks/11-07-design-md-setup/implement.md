# Implement — DESIGN.md setup

## Checklist

1. **Tooling**
   - No dependency install. The published CLI's `zod@^3` tree carries a dev-only advisory, so the
     script fetches the pinned CLI through `npx` instead of adding it to the lockfile.
   - Confirm `package-lock.json` is unchanged.
2. **Document**
   - Create `DESIGN.md` at the repository root from the validated token block in `design.md`.
   - Write the eight sections in order; keep the theme-mapping table in Colors and the fixed
     geometry in Layout & Spacing.
   - State that `--vscode-*` variables are normative and the hex values are the Dark Modern reference.
3. **Scripts**
   - Add `"design:lint": "designmd lint DESIGN.md"`.
   - Append `&& npm run design:lint` to the existing `lint` script, after `eslint src`.
4. **Discoverability**
   - Add a `DESIGN.md` row to the `docs/README.md` guide table.
   - Add a short "Webview design" pointer in `AGENTS.md` after `<!-- TRELLIS:END -->`.
5. **Validate**
   - `npm run design:lint` → 0 errors, 0 warnings.
   - `npm run lint`, `npm run compile`, `npm test`.
   - `git diff --stat` → only `DESIGN.md`, `package.json`, `docs/README.md`, `AGENTS.md`, plus the
     Trellis task artifacts; `package-lock.json` stays unchanged.
6. **Finish**
   - Update the frontend spec index only if a new convention is introduced (none expected).
   - Commit only on an explicit request; archive the task after the commit.

## Gates

- **Gate A — document valid:** `designmd lint DESIGN.md` reports `0 errors`, `0 warnings`, exit 0.
- **Gate B — repository green:** `npm run lint`, `npm run compile` and `npm test` pass.
- **Gate C — scope:** no changes under `src/`, no version bump, no `CHANGELOG.md` entry.

## Rollback

Revert the five touched files (`DESIGN.md`, `package.json`, `package-lock.json`, `docs/README.md`,
`AGENTS.md`). No runtime code depends on the document or the script, so a revert needs no migration.

## Validation commands

```powershell
npm run design:lint
npm run lint
npm run compile
npm test
git diff --stat
```
