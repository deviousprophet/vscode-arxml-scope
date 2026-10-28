# ECUC editor: blank tree, no error surfaced

## Goal

When the ECUC webview page fails in a real window the user sees only the schema/package
header: rows never render and nothing explains why. Make that failure visible and
self-reporting, so the next report names a cause instead of "nothing to display".

## Context (measured, not assumed)

Target file: `Can_HVCANFD_EcucValues.arxml` (0.53 MB, 13 modules, 1231 rows).

Ruled out:

- Parser: `scanEcucValues` = 13 modules / 1231 rows in 32 ms; all 22 arxml files in that
  folder parse (largest 22 MB -> 46 410 rows in 337 ms).
- Legacy baseline: `.artext_cache/Can_HVCANFD_EcucValues.artext` has the same 13 modules.
- Renderer in a real webview (VS Code 1.143.1 test host): 1231 rows parsed, 30 rows
  drawn; the 22 MB file (52.9 MB page) also renders.
- Extension binary: installed `dist/extension.js` sha256 equals a fresh build of this
  source.
- User settings (`window.zoomLevel: -2`, `workbench.experimental.modernUI: true`, ...)
  copied into the test profile: still renders.
- Payload size as a cause: a 52.9 MB page renders, so inlining rows is NOT the defect.
  (A payload decoupling was considered and dropped; it would be a refactor without a
  failing case.)

So in the affected window the page script never runs or throws at boot, and the page
reports nothing.

## Requirements

- R1. Any uncaught error or rejected promise in the page is shown in the existing
  `#notice` region, with a pointer to Webview Developer Tools. No new UI surface.
- R2. A missing or unparseable row payload is reported the same way (today
  `readInitialRows` swallows the parse error and returns `{ rows: [] }`).
- R3. A live page tells the host it booted (`{ type: 'ready' }`). If that message does
  not arrive within 10 s, the host shows a warning naming the file and the DevTools
  command — the only signal available when a page's scripts are blocked outright.
- R4. No change to parsing, ordering, row data, CSP/nonce handling, or the existing
  `type: 'model'` contract.

## Acceptance Criteria

- [x] AC1. The page arms its error surface before `acquireVsCodeApi()` and asserts in a
      test that both `error` and `unhandledrejection` are surfaced (R1).
- [x] AC2. An unreadable `ecuc-rows` payload reports once via `ecucReportError` and still
      returns an empty row list (test drives the page's own `readInitialRows`).
- [x] AC3. The page posts `{ type: 'ready' }` after boot; the host clears its 10 s
      watchdog on that message and warns otherwise (R3).
- [x] AC4. `npm run check-types`, `npm run lint` and the extension suite pass.
- [x] AC5. Target file still renders in a real webview (probe, before/after: 30 of 1231
      rows drawn).

## Constraints

- No new runtime dependency; no new settings.
- Keep the single `acquireVsCodeApi()` call and the nonce'd CSP.
- The provider stays the single owner of scan -> rows; the page stays the single owner of
  windowing/filtering.

## Out of scope

- Whatever breaks the page in the user's specific window (needs their Webview DevTools
  console line). This task makes that failure visible; it does not guess at it.

## Notes

- Evidence harness (`src/test/probe/`, `.vscode-test.probe.mjs`) was temporary and is
  removed: it needs a customer sample outside the repo. The invariant it checked is
  covered by AC1/AC2 plus the existing suite.
