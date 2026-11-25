# Design — docs/ audience split and spec extraction

## 1. Audience model

| Home | Audience | What belongs |
|---|---|---|
| `docs/user/` | Extension users | Opening files, editing, comparing, merging, settings, limitations |
| `docs/contributor/` | Human contributors | Setup, build, tests, engine operation, preview commands, regression plan |
| `.trellis/spec/` | AI agents and implementers | Code-level contracts, invariants, parity hashes, audit rules, “must/must not” |
| `.agents/skills/` | AI agents | Executable workflows and commands for a tool (the preview skill) |
| Root `DESIGN.md` | Users/contributors | Visual identity; linked from the docs index, not moved |

Rule: if a page tells an agent **how to change code**, it belongs in `.trellis/spec/` or a
skill. If it tells a person **how to use or contribute to the product**, it belongs in
`docs/`.

## 2. Proposed target tree

```text
docs/
  README.md                    audience index + canonical links
  user/
    ECUC_EDITOR.md             moved from docs/ECUC_EDITOR.md
    DIFF.md                    moved from docs/DIFF.md
    MERGE.md                   moved from docs/MERGE.md
  contributor/
    DEVELOPMENT.md             new: setup, build, test, engine, preview links
    ENGINE.md                  moved from docs/ENGINE.md; link rust/README.md
    TEST_PLAN.md               human regression plan (trimmed)
    WEBVIEW_PREVIEW.md         contributor pointer + commands + states + limits
    legacy-dom-renderer.md     retired interaction reference (only if still owned)
```

Spec pages:

```text
.trellis/spec/frontend/
  monaco.md                    new: synthetic document, find bridge, diff editor, gutter ownership
  diff-matching.md             new: semantic scoring/budgets moved out of docs/DIFF.md
  diff-parity.md               moved from docs/vscode-diff-parity.md
  preview-audit.md             extracted from docs/WEBVIEW_PREVIEW.md
  testing.md                   extended with parity/preview gates and agent rules
  index.md                     updated index + related-docs links
.trellis/spec/guides/
  documentation-architecture-guide.md  new: audience/canonical-home rules
  index.md                     add the documentation boundary row
```

The exact folder names can change during implementation, but the audience boundary must
not. A flat `docs/` with a strict index is acceptable only if the user/contributor split
is obvious without opening a file.

The full evidence is in `research/docs-audit.md`: inventory, link graph, stale-content
table, duplication map and open questions.

## 3. One canonical source

| Fact | Canonical home | Docs link |
|---|---|---|
| Preview commands, states, outputs, cleanup | `.agents/skills/webview-preview/SKILL.md` | `docs/contributor/WEBVIEW_PREVIEW.md` |
| Preview audit invariants | `.trellis/spec/frontend/preview-audit.md` | contributor preview page |
| Diff parity/hashes/adapters | `.trellis/spec/frontend/diff-parity.md` | `docs/user/DIFF.md` “Implementation” or contributor development |
| Test gates and agent checks | `.trellis/spec/frontend/testing.md` | `docs/contributor/TEST_PLAN.md` |
| Engine operator behavior | `docs/contributor/ENGINE.md` | root README |
| Protocol details | `rust/README.md` | `docs/contributor/ENGINE.md` |

Do not copy a command block or an audit rule into two homes. Link.

## 4. Migration mechanics

1. Create `docs/user/` and `docs/contributor/`.
2. `git mv` the three user guides and the contributor pages.
3. Move `vscode-diff-parity.md` to `.trellis/spec/frontend/diff-parity.md`.
4. Extract the audit invariants from `WEBVIEW_PREVIEW.md` to
   `.trellis/spec/frontend/preview-audit.md`; leave a short pointer in the contributor
   page.
5. Split `TEST_PLAN.md`:
   - human layers/gates/known gaps stay in `docs/contributor/TEST_PLAN.md`;
   - agent execution rules and “always/never” checks go to
     `.trellis/spec/frontend/testing.md`;
   - one canonical command list, linked from both.
6. Rewrite `docs/README.md` with audience tables and no mojibake.
7. Update every relative link in root `README.md`, `AGENTS.md`, `DESIGN.md`,
   `.trellis/spec/frontend/index.md` and the task/skill docs.
8. If an old top-level path is likely to be linked externally, leave a one-line stub
   pointing to the new path; otherwise update all known links and delete the old path.

## 5. Link and encoding checks

- Verify every changed Markdown file is valid UTF-8 with no U+FFFD replacement
  characters. The research audit found **no on-disk mojibake**; apparent `�` in terminal
  output was a console-decoding artifact. Do not “repair” em dashes or arrows.
- `rg -n "docs/(ECUC_EDITOR|DIFF|MERGE|ENGINE|TEST_PLAN|WEBVIEW_PREVIEW|vscode-diff-parity)"`
  to find stale links.
- Resolve every relative Markdown link with a small one-off Node/PowerShell check; do not
  add a package script unless the check becomes permanent.
- `git diff --check`.

## 5.1 Stale claims to refresh

The research audit found these user-visible contradictions; the rework must fix them:

- `docs/DIFF.md` says the diff is read-only and still describes a custom fixed title
  strip/gutter; merge is shipped and the page is the Monaco diff.
- `docs/ECUC_EDITOR.md` says the Document is read-only by design and keeps a retired DOM
  renderer appendix as if it were current.
- `docs/TEST_PLAN.md` says merge is planned, engine restart/backoff is not implemented,
  and the diff is read-only; all three are stale.
- `docs/ENGINE.md` is orphaned from the docs index.
- `.trellis/spec/frontend` has stale preview paths and no Monaco/diff-matching page.

## 6. Risks and mitigations

- **Broken external links:** keep stubs for high-traffic moved pages, or verify all
  repository links and update the root README.
- **Duplication drift:** one canonical source table above; docs pages link, not copy.
- **Spec bloat:** move only code-level contracts; user prose stays in docs.
- **Lost content:** `git mv` first, then split/edit; review the diff for deletions without
  a destination.
- **Encoding:** rewrite `docs/README.md` from scratch rather than patching mojibake.
- **Scope creep:** no product or engine changes; if a code change is needed, split it into
  a separate task.

## 7. Rollback

Revert the docs task commits. No runtime, persisted-data or protocol change.
