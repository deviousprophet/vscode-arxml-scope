# Implement — cached match-mode switching

## Ordered checklist

1. **Add the pure session**
   - Create `src/core/diff/diffSession.ts` with `DiffPreparedSide`, `DiffSessionResult` and
     `DiffSession`.
   - Cache per mode; reuse the last document when a semantic build reports `renamed === 0`; expose
     `invalidate()`.
   - No `vscode` or DOM imports.

2. **Unit-test the session**
   - `src/test/core/diffSession.test.ts`:
     - a renamed fixture returns different strict/semantic documents and caches both;
     - a no-rename fixture returns the same object for both modes with `changed === false` after the
       first build;
     - an initial strict build is not treated as proof that semantic is identical;
     - `invalidate()` forces a new build;
     - cached toggles return the same object and `changed === false`.

3. **Refactor the host panel**
   - Replace the ad-hoc `buildDiffDocument` calls with prepared sides + `DiffSession`.
   - Keep document, version, rows, ranges and header per side.
   - Add `applyMatchMode(next)`:
     - stale version → `refreshNow()`;
     - fresh → session lookup/build;
     - post a document only when the object changed;
     - otherwise post `matchModeState`;
     - on failure restore the previous mode, ack it and post the error.
   - Keep the full refresh path for edits, initial load, gate failures and stale toggles.

4. **Extend the protocol**
   - Add `{ type: 'matchModeState'; semantic: boolean }` to `DiffProviderToWebview`.
   - Update `src/test/webview/protocol.test.ts` coverage.

5. **Make the toolbar optimistic**
   - `DiffToolbar.setMatchMode(semantic, pending = false)` sets `aria-pressed`, `aria-busy`, the
     label and a live `Switching to …` status.
   - The page flips the mode and sets pending before posting `matchMode`; `document` and
     `matchModeState` clear it and restore the summary.
   - Add the busy spinner/status styling to `toolbar.css` with theme tokens.
   - Extend `src/test/webview/page/diffPage.test.ts`:
     - click flips the label/`aria-pressed` before any host message;
     - the status names the pending target;
     - `aria-busy` is set and then cleared by `matchModeState`;
     - a `document` message also clears it and restores the summary.

6. **Add the toggle benchmark**
   - `src/test/benchmarks/diffToggleBenchmark.ts` builds prepared rows once, creates a
     `DiffSession`, measures the first semantic build, first strict build and a cached switch.
   - Print JSON with `_type: "diff-toggle"`, `firstMs`, `cachedMs`, `renamed`.
   - Budget: first build under 1.5 s, cached switch under 50 ms, retained memory under 512 MiB.

7. **Verify**
   - `npm run check-types`
   - `npm run lint`
   - `npm test`
   - `npm run benchmark` (including the new toggle benchmark)
   - `npm run package`
   - `npx @vscode/vsce ls`
   - Manual: open `H:\workspace\sample\arxml\diff-cases-left.arxml` vs
     `diff-cases-right.arxml`, toggle Semantic/Strict, confirm the summary table in
     `diff-cases-README.md` and that the button responds immediately.
   - Manual large pair: `all-cases.arxml` vs `all-cases copy.arxml`; the no-rename case must not
     re-scan or re-post the 61 MB document.

## Review gates

- **Gate A (after step 2):** session tests pass and strict output is byte-for-byte identical to the
  existing fixtures.
- **Gate B (after step 5):** page/protocol tests pass; the toolbar flips before the host reply.
- **Gate C (after step 7):** all commands green; manual pair summaries match the README.

## Rollback points

- After step 2: the session is unused; deleting it leaves the panel unchanged.
- After step 5: revert the protocol and page changes independently of the host cache.
- After step 6: the benchmark is additive and can be removed without touching runtime code.
