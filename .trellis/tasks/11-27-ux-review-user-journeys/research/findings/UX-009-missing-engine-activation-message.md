# UX-009 — Missing engine fails activation with a truncated, developer-facing message

- Severity: Critical
- Journey: FIRST-02, ENGINE-04
- Surface: First run / engine supervision
- Heuristic: usability (error recovery, clarity), trust
- Confidence: high (real host, engine binary hidden)

## Expected

When the extension cannot start its engine, the user sees a persistent, plain-language message
that names the cause and the platform and offers a next step they can actually take (reinstall,
choose a supported platform, open the output). The extension's absence is obvious; nothing
suggests running a build command from a source checkout.

## Actual

Real Extension Development Host with `dist/engine/win32-x64/arxml-engine.exe` hidden:

- Activation fails. **No ARXML command is registered** (`openEcucEditor`, `showEngineStatus`,
  `rebuildIndex` all `false`); the status bar has no ARXML Scope item.
- Two transient toasts appear bottom-right:
  `Activating extension 'deviousprophet.vscode-arxml-scope' failed: Rust …` and
  `ARXML Scope: Rust engine is not built at h:\…\arxml-engine.exe; run "npm run engine:build"
  (1 is the host protocol)`.
- Both are **truncated** by the notification width, disappear on their own, and the actionable
  text is developer-only (`npm run engine:build`, plus an unrelated protocol note).
- The window itself looks normal: an empty editor, no panel, no persistent banner. A user has
  no obvious way to learn that the extension is present but dead.

## Repro

1. Hide the staged engine binary (the task runner does this with `UX_HOST_MODE=missing-engine`).
2. `$env:UX_HOST_MODE='missing-engine'; node .trellis/tasks/11-27-ux-review-user-journeys/research/host/run.mjs`
3. Read `missing-engine/driver-report.json`, then open `first-02-missing-engine-workbench.png`.

## Evidence

- `research/evidence/host/missing-engine/first-02-missing-engine-workbench.png`
- `research/evidence/host/missing-engine/driver-report.json`
  (`notifications`, `commands`, `statusBar`)
- `research/evidence/host/missing-engine/host-activation.json`

## Notes

The engine-missing path is a packaging/architecture failure, but it is exactly the first-run
case the PRD asks about. The unsupported-platform variant (ENGINE-05) was not run; it reportedly
lists the four shipped targets, but the same toast-only presentation applies. This is the only
`broken` journey in the Phase 3 pass, so it caps Flow efficiency at 2 until it is addressed.
