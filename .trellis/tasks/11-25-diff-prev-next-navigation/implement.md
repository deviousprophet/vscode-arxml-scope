# Implementation plan — diff Prev/Next navigation

- [x] Write the failing pure test for forward/backward/wrap.
- [x] Add `src/webview/monaco/diffNavigation.ts`.
- [x] Replace `findForwardChange` / `findBackwardChange` / `changeIndex` in `diffMonaco.ts`.
- [x] Make reveal swap-aware and set both inner editors.
- [x] Add the `diff-nav` preview state/probe and audit violation.
- [x] Verify Next/Prev before and after Swap in the live preview.
- [x] `npm run check-types`, `npm run lint`, `npm run compile-tests`, `npm test --ignore-scripts`.
- [x] Capture `diff-nav` and the full preview set.
- [x] Commit the child and record the commit in the parent. (7449d3f)

## Evidence

Root cause: `findForwardChange` used `changeLine >= current`, so the current change
re-matched. `changeLine` also ignored Swap and always read the modified model.

The pure test covers strict forward/backward, wrap, one change, empty lists, Swap mapping
and pure insert/delete fallbacks. `diff-nav` records:

- change lines `[7, 10, 14, 25]`
- Next `[10, 14, 25, 7, 10]`
- Prev `[7, 25, 14, 10, 7]`
- Next after Swap `[7, 10, 14, 25, 7]`

Every sequence covers all four changes and wraps exactly once. `diff-rail` and the focused
checks pass. Full product tests run at parent integration.
