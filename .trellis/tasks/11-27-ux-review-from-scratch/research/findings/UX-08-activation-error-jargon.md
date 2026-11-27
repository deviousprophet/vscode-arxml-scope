# UX-08 — Activation failure leaks an internal protocol constant and is shown twice

- **Severity:** Minor
- **Journey:** FIRST-01 / ENGINE-04 (engine missing or unsupported)
- **Heuristic:** Nielsen #2 match between system and the real world, #9 help users recognise and
  recover; error microcopy
- **Confidence:** High — reproduced in the host (`UX_HOST_MODE=missing-engine`)

## Repro

1. `$env:UX_HOST_MODE='missing-engine'; node .agents/skills/ux-review/scripts/host/run.mjs`
2. Read the two error notifications and the activation failure.

## Expected

One clear, user-facing message that says the engine is unavailable, with an action the user can
take. Internal build instructions and protocol numbers belong in the Output channel.

## Actual

Two notifications, both containing the same developer-oriented text:

```
Activating extension 'deviousprophet.vscode-arxml-scope' failed: Rust engine is not built at
h:\workspace\vscode-arxml-scope\dist\engine\win32-x64\arxml-engine.exe;
run "npm run engine:build" (1 is the host protocol).

ARXML Scope: Rust engine is not built at …\arxml-engine.exe;
run "npm run engine:build" (1 is the host protocol)
```

- `(1 is the host protocol)` is an internal constant leaking into the UI
  (`src/host/engine/engineLoader.ts:63`; the sibling message in `engineClient.ts:82` does not
  have it).
- The same failure is reported by VS Code's activation notification **and** the extension's own
  `showErrorMessage`, so the user dismisses the same toast twice.
- The absolute path and `npm run engine:build` are build-machine instructions; an installed
  extension cannot use them.

Evidence: `research/evidence/host/first-02-missing-engine-workbench.png`,
`research/evidence/host/driver-report-missing-engine.json` (`notifications`).

## UX impact

The failure is understandable ("Rust engine is not built") but the trailing protocol note and the
duplicate toast make it look like an internal crash. A user cannot act on `npm run engine:build`.

## Actionable fix

1. Drop `(${EXPECTED_PROTOCOL} is the host protocol)` from the activation error; keep the
   protocol in the Output channel.
2. Emit **one** user-facing error with an action (`Open Log` / `Report Issue`) instead of two
   overlapping notifications.
3. Say what the user can do: `ARXML Scope could not start its engine. Reinstall the extension or
   open the log for details.`

Not fixed in this task (review only).
