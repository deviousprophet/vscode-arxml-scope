# Implement — two-way copy merge (programme)

The parent owns the ordering, the revert, the integration gate and the final acceptance.
Implementation happens in the two children; this file is not an implementation checklist
for the parent itself.

## Order (revised 2026-11-14)

1. **Revert** the superseded three-way feature (parent, small). **Done.**
2. **`11-14-copy-merge-ui`** — host copy path, panel merge mode, page affordance, docs.
   The copy planner and the write path do not need the ported diff: the existing diff
   already carries element ranges on both cells.
3. **`11-14-diff-engine-port`** — Rust diff at exact parity, then the copy patch endpoint.
4. Wire the engine patch into the copy path, replacing the debounced rebuild.

Why the reorder: the port is a large parity effort with no user-visible result, while the
copy path delivers the feature. The copy UI's update path tolerates the existing refresh
(optimistic row + debounced rebuild); the port then makes it a patch, which is the
performance goal, not a prerequisite for correctness.

## Step 1 — Revert the three-way feature (parent)

- [x] Remove `core/merge/**` (planner, model, composer and line helpers), the conflict
      tests, `host/merge/*`, `webview/components/mergeBar/**`, the
      `merge`/`mergeResolve`/`mergeWrite` protocol entries, the merge command and its
      manifest entry.
- [x] The composer and line helpers were removed rather than kept: unused code fails the
      fallow gate, and they are recoverable from commit `5219ee6` when the copy UI lands.
- [x] Remove engine `doc.mergeIndex`, `arxml-cli merge-index`, `ecuc/merge.rs`, its tests
      and the now-unused `sha2` dependency.
- [x] Remove the three-way `docs/MERGE.md` and its README link; the copy-merge guide is
      written with the feature. The changelog entry is removed until it ships.
- [x] Rewrite the test plan's `MERGE` section for the two-way copy cases; the benchmark is
      owned by child 2.

Validation: `cargo test`, `clippy`, `fmt`, `tsc`, `lint`, `npm test`, `parity:rows`.

Gate met: no three-way symbol remains in production code; 779 tests, clippy, fmt, tsc,
eslint, engine smoke, parity 66/66 and fallow GREEN.

## Step 2 — Diff engine port (child)

Owned by `11-14-diff-engine-port`. Gate the parent needs:

- [x] Serialized `DiffDocument` from the engine equals the TS oracle on every fixture and
      a generated document, strict and semantic, keys included: 159/159 checks across
      strict, semantic and budget-limited runs.
- [x] The panel renders the engine diff with the existing page tests untouched: the panel
      asks `diff.compute` and 794 extension tests pass.
- [ ] `diffSemantic` / `renameScale` benchmarks are within the recorded ceilings. The
      engine has no benchmark entry yet; `npm run benchmark` still measures the TS path.

## Step 3 — Copy merge UI (child)

Owned by `11-14-copy-merge-ui`. Gate the parent needs:

- [x] Merge toggle on/off; read-only suite unchanged with it off.
- [x] Copy left→right and right→left; placeholder delete; ancestor synthesis; module
      refusal; container replace semantics.
- [x] One `WorkspaceEdit` per copy; undo in the edited pane; `•` dirty marker.
- [x] Engine patch applied, never a full rebuild for the patchable cases; an unpatchable
      answer rebuilds with a notice. Seven reasons are pinned; the panel applies the
      returned rows without re-requesting the document.
- [x] Stale modal Reload/Cancel; Cancel mutates nothing.
- [ ] Performance: < 100 ms visible change, < 250 ms consistency, 10 copies / 10 s.

## Parent integration review

- [ ] Cross-task acceptance in `prd.md` checked one by one with a named test or command.
- [ ] The read-only diff guarantee is still documented and tested.
- [ ] The two children are archived; the parent records what shipped.
- [ ] Specs updated: `editor-lifecycle.md` (merge mode + copy message), `state-management.md`
      (per-panel merge state, dirty documents), `testing.md` if fixtures changed.

## Rollback

Step 1 is a revert of the three-way commits; each child is a separate commit range. The
port switches the panel's diff source in one commit, revertable to the TypeScript diff
without touching the copy UI's protocol. The copy UI is additive: removing its commit
restores the read-only panel.
