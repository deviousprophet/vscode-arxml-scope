# Documentation Architecture Guide

> **Purpose**: keep every page in one audience home, with one canonical source per fact,
> so users are not handed build commands and agents are not handed stale prose.

This guide is the decision rule behind `docs/`, `.trellis/spec/` and `.agents/skills/`.
It exists because this repository accumulated duplicated preview commands, a test plan
mixed with agent gates, a code-level parity manifest in user docs, and retired renderer
instructions presented as current.

## Audience model

| Home | Audience | What belongs | What does not |
|---|---|---|---|
| `docs/user/` | Extension users | Opening, editing, comparing, merging, settings, user-visible limitations | Build/test/agent commands, source paths, audit rules, protocol details |
| `docs/contributor/` | Human contributors and operators | Setup, build, tests, regression plan, engine operation, preview commands and limits | Code-level contracts, step-by-step agent workflows, copied invariant lists |
| `.trellis/spec/` | AI agents and implementers | Code-level contracts, invariants, parity manifests, protocol details, “must/must not” | Product tutorials or human quick starts |
| `.agents/skills/` | AI agents | Executable workflows and commands for a tool (the preview harness) | Product documentation |
| Root `DESIGN.md` | Users/contributors | Visual identity and design tokens; the `design:lint` target | Moved under `docs/` (tooling depends on the root path) |

**The one-line test**: if a page tells an agent **how to change code**, it belongs in
`.trellis/spec/` or a skill. If it tells a person **how to use** the product, it belongs
in `docs/user/`. If it tells a person **how to contribute to** the product, it belongs in
`docs/contributor/`.

## Canonical home per fact

| Fact | Canonical home | Everything else links to it |
|---|---|---|
| Preview commands, flags, outputs, cleanup, agent workflow | `.agents/skills/webview-preview/SKILL.md` | Contributor preview page, testing spec, README |
| Preview audit invariants and proof boundaries | `.trellis/spec/frontend/preview-audit.md` | Contributor preview page, testing spec |
| Test layers, per-area gates, case IDs, known gaps | `docs/contributor/TEST_PLAN.md` | Testing spec, README, contributor development |
| Agent test execution rules | `.trellis/spec/frontend/testing.md` | Test plan |
| Diff parity, pinned hashes, patch, adapters | `.trellis/spec/frontend/diff-parity.md` | Contributor development |
| Monaco synthetic documents, find bridge, gutter ownership | `.trellis/spec/frontend/monaco.md` | Contributor development |
| Semantic matching scores, budget, fallback | `.trellis/spec/frontend/diff-matching.md` | User diff guide (behaviour only) |
| Engine protocol and crate layout | `rust/README.md` | Contributor engine page |
| Engine operator behaviour | `docs/contributor/ENGINE.md` | Root README |
| Visual identity and tokens | root `DESIGN.md` | Docs index, CSS guidelines |

A fact gets **one** home. A second page may summarize one sentence and link; it must not
copy the command block, the invariant checklist or the hash table.

## Adding, moving or splitting a page

1. **Choose the audience home** with the one-line test above. Do not leave a mixed page.
2. **State one purpose** in the title and the first paragraph. If the page needs “and”
   for two audiences, split it.
3. **Move with history**: `git mv`, then edit. Do not copy the file and delete the
   original in a second commit.
4. **Extract the agent-only part first** into `.trellis/spec/` or the skill, then trim the
   docs page to a link plus human context.
5. **Update every inbound link**: the docs index, both spec indexes, root `README.md`,
   `AGENTS.md` and test-file header comments. `rg` the old path; a moved page with one
   stale link is not moved.
6. **Delete the old path** unless an external link is likely. Git history is the archive;
   do not keep a page “for history”.
7. **Re-check encoding**: every Markdown file is UTF-8 without a BOM and without a
   replacement character (`U+FFFD`). A replacement glyph in terminal output is usually a
   console-decoding artifact; verify the bytes
   before “repairing” an em dash or arrow.

## Index rules

- `docs/README.md` lists **every** file under `docs/` exactly once, with audience and a
  one-line purpose. A file not in the index is not part of the library.
- `.trellis/spec/frontend/index.md` and `.trellis/spec/guides/index.md` list every page
  in their folder. A new spec page without an index row is invisible to the agent that
  needs it.
- Root `README.md`, `AGENTS.md` and `DESIGN.md` stay at the root. Update their links when
  a named docs path moves; do not move the files themselves without changing the tooling
  (`design:lint`, the Trellis block) in the same change.
- Index links are relative. Do not use an absolute GitHub URL for an in-repo spec: it
  bypasses the link checker and assumes the default branch.

## Link and encoding checks

Before calling a docs change done:

1. Resolve every relative Markdown link and every `#anchor` used by a changed page.
2. `rg` for the old path and for removed command names. Include test-file comments and
   skill pages, not just `docs/`.
3. Confirm the docs index covers every file under `docs/` once.
4. Confirm UTF-8 without U+FFFD for every changed Markdown file.
5. `git diff --check` is clean.
6. Run product gates only if the change touches product code; a docs-only change does not
   need `npm test`.

## Review checklist

- [ ] Every page is user-facing or contributor-facing, never agent-only.
- [ ] Every code-level contract lives in `.trellis/spec/` or the skill, with a docs link.
- [ ] The docs index lists every page with audience and purpose.
- [ ] No command block, hash table or audit checklist is copied in two homes.
- [ ] No stale command, removed path, broken relative link or replacement character.
- [ ] A split page keeps every retained fact in a canonical home; deleted text has a
      reason (duplicate, stale claim or retired behaviour), not an accident.
- [ ] Root `DESIGN.md` is still the `design:lint` target.

## Must not

- **Must not** put build/test/agent commands in `docs/user/`.
- **Must not** put a product tutorial in `.trellis/spec/`.
- **Must not** duplicate the `webview-preview` command block outside `SKILL.md`.
- **Must not** index a page that does not exist, or leave a page out of its index.
- **Must not** “fix” UTF-8 damage by rewriting em dashes or arrows from a console render.

## Related

- [Documentation index](../../../docs/README.md)
- [Thinking guides index](./index.md)
- [Frontend spec index](../frontend/index.md)
- [Preview audit](../frontend/preview-audit.md) — the invariant list this guide keeps in
  its canonical home.
