# ARXML Scope: semantic diff, context menus, filter clear and syscond evaluation

## Goal

Deliver four user-visible improvements to the ARXML Scope extension in one batch:

1. A **semantic diff view** for two `ecuc-values` ARXML files.
2. A single **ARXML Scope editor context submenu** that holds "Open with ECUC Editor" and
   "Reveal in ECUC Editor"; the reveal action is text-editor-only.
3. One visible **clear button** in the ECUC editor filter box instead of two.
4. **SW-SYSCOND evaluation** with user-supplied constant values, so rows whose condition is false
   are visibly disabled.

The four features are independent deliverables and are planned as child tasks. This parent owns
the source requirements, the task map, shared constraints, and the final integration review.

## Background

The user request (2026-10-29), verbatim intent:

1. "lets cook a diff view for this extension, semantic compare"
2. "Reveal in ECUC Editor" is only needed in the text editor when an arxml is open, not in the
   explorer context menu. In the editor context, both actions belong under an "ARXML Scope"
   submenu: "Open with ECUC Editor" and "Reveal in ECUC Editor".
3. The filter box currently has two "X" buttons; clean this up.
4. Condition evaluation should be implemented: the user enters SYSCOND values, and the extension
   shows which configuration might be disabled. Example:
   `SyscondInlineRef = true [(CANIPCORETYPE_SC==0)]` must be grayed out when the user sets
   `CANIPCORETYPE_SC=1`. Values are added manually for now.
5. Follow-up clarification: item 4 applies to a container or a parameter **based on which node owns
   the condition**; a false container disables its subtree.

Repository evidence:

- The ECUC model already carries `syscond` and `syscondRange` on modules, containers, parameters
  and references (`src/core/ecuc/model.ts:16`). `renderRows` already renders it as `[condition]`
  meta (`src/editor/renderRows.ts:399`), but no evaluator or value entry exists.
- The filter input is `type="search"` with a custom `#filter-clear` button
  (`src/editor/renderHtml.ts:220`). Chromium adds its own cancel button, which is the duplicate X.
- `package.json` contributes `openEcucEditor` to `explorer/context` and both
  `openEcucEditor` and `revealInEcucEditor` as flat entries in `editor/context`.
- There is no diff implementation and no runtime dependency. The extension is plain TypeScript +
  one inlined webview page; esbuild is the only build tool.
- `D:\workspace\vscode-hex-scope` contains a shipped diff view for a sibling extension. Its
  entry-point, panel, refresh and aligned-row patterns are the reference for the ARXML diff;
  findings are recorded in the child task's `research/hex-scope-diff-reference.md`.

## Task map

| Child task | Deliverable | Type | Order |
|---|---|---|---|
| `10-29-filter-clear-single` | One clear control in the filter box | Lightweight | 1 |
| `10-29-editor-context-submenu` | ARXML Scope submenu, text-editor-only reveal | Lightweight | 2 |
| `10-29-semantic-diff-view` | Semantic two-pane diff panel and compare commands | Complex | 3 |
| `10-29-syscond-evaluation` | SYSCOND value panel, evaluator, disabled rows | Complex | 4 |

Ordering rationale: the filter fix is isolated; the submenu is created before the diff adds its
compare commands to the same submenu; the SYSCOND change is last because it touches the editor
page, row builder and provider most deeply and should not be rebased under the other three.

Parent/child is not a dependency system. Each child has its own testable acceptance criteria and
can be archived independently. The ordering above only minimizes `package.json` and
`renderHtml.ts` conflicts.

## Cross-child requirements

- **No new runtime dependency.** Standard library and VS Code API only.
- **No file writes** except the existing explicit field edits. The diff is read-only; condition
  values are workspace state, never a file beside the user's ARXML.
- **No file claimed by default.** `customEditors[].priority` stays `"option"`.
- **Webviews keep the CSP + nonce pattern**, load no external script, and use `--vscode-*` theme
  variables for colour.
- **Rows stay data.** Model text is written with `textContent`, never `innerHTML`.
- **Dispose everything.** Every listener, watcher and panel handler is disposed with its owner.
- **Re-scan after every change.** No cached range survives a document change.
- **Existing behaviour stays green.** All current tests keep passing; new tests cover the new
  behaviour.
- **One implementation per rule.** Reuse `buildRows`, `buildNodeIndex`, `filterRows`,
  `flattenRows`, `virtualScroll`, `revealRangeInTextEditor` and the shared row-view primitives
  rather than copying them.

## Integration acceptance criteria

- [ ] All four child tasks meet their own acceptance criteria and are archived.
- [ ] `npm run check-types` passes with zero errors.
- [ ] `npm run lint` passes with zero findings.
- [ ] `npm test` passes with all pre-existing tests still present and passing.
- [ ] `npm run package` passes, including `scripts/check-webview-boot.cjs`.
- [ ] The manifest still has an empty `activationEvents`, one `*.arxml` custom editor with
  `priority: "option"`, and no default editor association.
- [ ] `package.json` has exactly one `ARXML Scope` submenu contribution; the editor context menu
  shows that submenu and no flat ARXML commands; the explorer context menu keeps
  "Open with ECUC Editor".
- [ ] The ECUC editor page shows one clear X in Chromium-based VS Code.
- [ ] Opening two ECUC files with the diff command shows a read-only comparison; editing either
  file refreshes it; no bytes are written.
- [ ] Entering `CANIPCORETYPE_SC=1` disables the row whose condition is
  `[(CANIPCORETYPE_SC==0)]`, and no unrelated row is disabled.

## Out of scope

- Text/line/byte diff, three-way merge, conflict resolution, Git or SCM integration.
- Editing `<SW-SYSCOND>` itself from the UI.
- Resolving `SYSC-REF` values from `SwSystemconst` ARXML files, DBCs, or any external source.
  Values are manual for now.
- Condition evaluation for `POST-BUILD-VARIANT` / `VARIANT` semantics beyond showing existing
  text; only `SW-SYSCOND` is evaluated.
- Auto-fixing or deleting disabled configuration.
- Persisting compare selections across sessions.
- A diff view inside the ECUC custom editor tab; the diff is its own panel.

## Open questions

None blocking. Deferred items are recorded in the child designs.
