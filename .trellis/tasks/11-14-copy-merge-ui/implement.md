# Implement — two-way copy merge UI

Order: host path → panel/protocol → page affordance → ancestors/module → docs.

## M1 — Copy planner (landed)

- [x] `core/copy/planCopy.ts`: replace, insert, delete, stale, re-indent, line removal.
- [x] `src/test/core/planCopy.test.ts` (8 cases).

Validation: `npm test` (copy planner).

## M2 — Panel state and copy path

- [x] `mergeMode` per panel; toggle message; refuse copies when off.
- [x] Copy handler: resolve cells, build `CopyRequest`, apply one `WorkspaceEdit`, refusal
      notice; one copy in flight at a time.
- [x] Stale detection via `expectedTarget`, with a Reload/Cancel modal.
- [ ] Extension tests: replace, delete, insert, undo, stale, mode-off. (The page messages
      and the planner are covered; the panel's copy handler is not. The host suite opens
      real panels but cannot post a webview `copy` message.)

Validation: `npm test` (extension), `check-types`, `lint`.

Gate: the three copy shapes change exactly the expected bytes; one undo restores.

## M3 — Page affordance

- [x] Title-strip merge toggle; `mergeMode` message; arrows on changed rows; `Alt+←/→`;
      row selection on click; dirty marker; arrows follow Swap.
- [x] Page tests for visibility, message shape, keys, marker.

Validation: `npm test` (page), `design:lint`.

Gate: arrows only in merge mode and only on changed rows; no arrow on unchanged rows.

## M4 — Ancestors and module rules

- [x] Minimal ancestor containers synthesized from the source parent chain (own fields +
      one child list), inserted at the nearest matched sibling.
- [x] Refuse when the chain needs a module.
- [x] Refuse a module name collision; a module copy inserts after the nearest module
      sibling, and refuses when the target has no module to anchor it.
- [x] Planner tests for the wrapper: single level, nested chain, DEST. The panel wiring has
      no direct test yet (see M2's remaining extension tests).

## M5 — Docs and finish

- [x] `docs/MERGE.md` (copy model), changelog `Added`, editor-lifecycle spec (merge mode +
      copy message).
- [x] Copy benchmark on the 26 MiB document: plan < 1 ms, ceiling 100 ms.
- [x] The copy now reaches the engine as `doc.update` + `diff.patch`; a refusal rebuilds
      with a notice instead of waiting for the debounced rebuild.

## Rollback

M2 is the behavioural commit; reverting it restores the read-only panel. M3 is pure UI and
reverts independently.
