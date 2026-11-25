# Research: Documentation information architecture audit

- **Query**: Audit `docs/`, root `DESIGN.md` / `README.md` / `AGENTS.md`, `.trellis/spec/**`, and the preview skill; classify audiences, build the link graph, find broken/stale paths, duplication, encoding damage, and propose a target tree.
- **Scope**: internal repository audit (read-only outside this `research/` directory)
- **Date**: 2026-11-24
- **Method**: `git ls-files`, a Markdown link/existence/anchor checker, `git grep`, direct reads, `package.json` script verification. No `docs/`, source, or spec files were modified.

## 1. Inventory and audience

### 1.1 `docs/` and root documents

| File | Lines | Classification | Evidence / basis |
|---|---:|---|---|
| `docs/README.md` | 23 | **Mixed** (user index + contributor index) | Intro says "User-facing guides" (`:3-5`) but the table mixes the ECUC/diff/merge guides with the design system, test plan and preview harness (`:9-15`). |
| `docs/ECUC_EDITOR.md` | 357 | **Mixed** (user guide + retired-renderer appendix + implementation limitations) | User tasks: Opening a file, Editing rules, Conditions, Reveal (`:16`, `:206`, `:260`, `:279`). Retired DOM material: `:9-14` explicitly says the sections below describe the retired renderer; `:32-116` still documents roving focus, custom gutter and custom virtual scroll. `:318-357` is a limitations/implementation section. |
| `docs/DIFF.md` | 258 | **Mixed** (user guide + algorithm/scoring detail) | User tasks: Selecting the two files, Navigating the diff, Refresh (`:11`, `:200`, `:228`). Algorithm detail: change classes, semantic pairing scores and work budgets (`:85-156`). |
| `docs/ENGINE.md` | 49 | **Contributor-facing** (architecture/operator summary) | "operator-facing summary" (`:4`), Why a process, Lifecycle, Status/support, Limits (`:6`, `:15`, `:27`, `:44`). It describes internals, not an end-user workflow. No inbound links (see §2.2). |
| `docs/MERGE.md` | 56 | **User-facing** | Pure usage guide: Using it, What a copy does, Safety, Limits (`:7`, `:23`, `:40`, `:49`). No implementation or agent-only content. |
| `docs/TEST_PLAN.md` | 373 | **Contributor-facing** | Regression plan, layer/command table, per-area IDs and gates (`:8-37`, `:39-330`), known gaps (`:341-373`). Test files cite these IDs (see §2.2). |
| `docs/WEBVIEW_PREVIEW.md` | 276 | **Contributor-facing (agent-oriented)** | "development-only harness" (`:3`), AI skill section (`:46-54`), state table and self-audit checklist (`:56-198`). Not a user feature. |
| `DESIGN.md` (root) | 335 | **Contributor-facing** (design contract; also consumed by agents) | YAML design tokens (`:1-151`) and visual rules: Overview, Colors, Typography, Components, Do's/Don'ts (`:154-335`). Referenced by `AGENTS.md:26` and `package.json:329` (`design:lint`); not an end-user guide. |
| `README.md` (root) | 56 | **Mixed** (user quick start + contributor setup) | Quick start (`:13-22`), Documentation links (`:24-30`), Contributing commands and preview instruction (`:32-47`). |
| `AGENTS.md` (root) | 34 | **Agent-only** | Trellis instructions (`:2-21`) and Webview design/preview pointers (`:24-32`). |

### 1.2 `.trellis/spec/**` (25 files)

All are **agent-only implementation contracts** (Trellis coding specs), though human contributors may read them. None is end-user documentation.

| File | Lines | Notes |
|---|---:|---|
| `.trellis/spec/frontend/index.md` | 43 | Frontend spec index; links all 10 top-level frontend pages. Intro still describes the webview as "plain HTML/CSS/JS" (`:4`) and does not mention Monaco or link `rust/README.md`/`docs/`. |
| `.trellis/spec/frontend/component-guidelines.md` | 383 | Contains stale pre-Monaco/pre-skill sections: manual previews removed (`:266-277`), "read-only Document"/line-number anti-patterns (`:286`, `:292`), `RowSearchEngine` (`:229`, `:341`). |
| `.trellis/spec/frontend/css-guidelines.md` | 275 | Build/bundle section still says `scripts/previewWebview.mjs` writes `dist/preview/` (`:219-220`); that moved to the skill `.cache/`. |
| `.trellis/spec/frontend/directory-structure.md` | 113 | Layout block omits `src/webview/monaco/`, `editorMonaco.ts`, `diffMonaco.ts` and still lists deleted `render/rowSearch.ts` (`:37-53`). |
| `.trellis/spec/frontend/editor-lifecycle.md` | 567 | Current engine/Monaco/merge session contract; the main implementation page for the editor and diff. |
| `.trellis/spec/frontend/hook-guidelines.md` | 35 | Says no hooks; references deleted `render/rowSearch.ts` (`:14`). |
| `.trellis/spec/frontend/quality-guidelines.md` | 236 | "Before calling work done" claims the VSIX should list user `docs/`/`examples/` (`:232-233`), but `.vscodeignore:20-22` excludes both. Also references deleted `RowSearchEngine` (`:201`). |
| `.trellis/spec/frontend/state-management.md` | 161 | References deleted `render/rowSearch.ts` (`:57`) and says the preview harness was removed (`:159`). |
| `.trellis/spec/frontend/testing.md` | 262 | Manual-preview section duplicates the preview commands/state/audit docs and uses a stale artifact path `artifacts/webview/<state>.png` (`:87`); links `docs/WEBVIEW_PREVIEW.md` at `:88`. |
| `.trellis/spec/frontend/type-safety.md` | 205 | Engine boundary (`:121-141`) duplicates part of `editor-lifecycle.md`/`rust/README.md`; useful as the type contract. |
| `.trellis/spec/frontend/components/index.md` | 23 | Component index; links all 11 component specs plus the template. |
| `.trellis/spec/frontend/components/component-context-menu.md` | 70 | Component contract. |
| `.trellis/spec/frontend/components/component-details-editor.md` | 90 | Component contract. |
| `.trellis/spec/frontend/components/component-diff-view.md` | 133 | Diff component contract; describes the pre-Monaco `VirtualScroll`/`DocumentTreeView` pair (`:7-63`). Review for Monaco-era accuracy. |
| `.trellis/spec/frontend/components/component-document-tree.md` | 155 | Document tree contract; review for Monaco-era read-only/gutter claims. |
| `.trellis/spec/frontend/components/component-search-bar.md` | 92 | Component contract; links `editor-lifecycle.md`. |
| `.trellis/spec/frontend/components/component-sidebar-conditions-panel.md` | 82 | Component contract. |
| `.trellis/spec/frontend/components/component-sidebar-details-panel.md` | 84 | Component contract. |
| `.trellis/spec/frontend/components/component-sidebar.md` | 99 | Component contract. |
| `.trellis/spec/frontend/components/component-template.md` | 79 | Template; placeholders are intentional (`components/index.md:21-23`). |
| `.trellis/spec/frontend/components/component-toolbar.md` | 116 | Component contract. |
| `.trellis/spec/frontend/components/component-virtual-scroll.md` | 116 | Component contract. |
| `.trellis/spec/guides/index.md` | 97 | Thinking-guide index; links both guides. |
| `.trellis/spec/guides/code-reuse-thinking-guide.md` | 223 | Generic reuse guide; includes Trellis-template sections not specific to this repo. |
| `.trellis/spec/guides/cross-layer-thinking-guide.md` | 327 | Contains a near-verbatim duplicated block: `:126-219` and `:223-287` (see §4). |

### 1.3 `.agents/skills/**` referenced by `docs/`

`docs/WEBVIEW_PREVIEW.md` references the skill directory and these files:

| File | Lines | Role / reference |
|---|---:|---|
| `.agents/skills/webview-preview/SKILL.md` | 68 | Agent procedure, commands, outputs, workflow, limits. Referenced by `docs/WEBVIEW_PREVIEW.md:46-54`. |
| `.agents/skills/webview-preview/scripts/previewWebview.mjs` | 144 | Preview server. Cited at `docs/WEBVIEW_PREVIEW.md:205`. |
| `.agents/skills/webview-preview/scripts/shotWebview.mjs` | 185 | Capture runner. Cited at `docs/WEBVIEW_PREVIEW.md:229`. |
| `.agents/skills/webview-preview/preview/previewData.ts` | 408 | `STATES` manifest and page fixtures. Cited at `docs/WEBVIEW_PREVIEW.md:206,211,247`. |
| `.agents/skills/webview-preview/preview/previewPage.ts` | 979 | Real page gestures and audit publishing. Cited at `docs/WEBVIEW_PREVIEW.md:206,216`. |
| `.agents/skills/webview-preview/preview/previewAudit.ts` | 2089 | DOM/geometry audit. Cited at `docs/WEBVIEW_PREVIEW.md:223`. |
| `.agents/skills/webview-preview/preview/previewStateFields.ts` | 45 | Shared state-field types; imported by `previewData.ts`/`previewPage.ts` but not named in `docs/`. |
| `.agents/skills/webview-preview/.gitignore` | 2 | Ignores `.cache/` and `artifacts/`; implied by `docs/WEBVIEW_PREVIEW.md:39-40`. |

Other `.agents/skills/*` (`create-pr`, `fallow-fix`, `update-changelog`) are not referenced by `docs/` and are out of scope for this audit.

## 2. Link graph

### 2.1 Outbound links from `docs/` pages

| Source | Targets | Anchors? |
|---|---|---|
| `docs/README.md:9-15` | `ECUC_EDITOR.md`, `DIFF.md`, `MERGE.md`, `WEBVIEW_PREVIEW.md`, `TEST_PLAN.md`, `../DESIGN.md`, `../examples/README.md` | No |
| `docs/README.md:19-21` | `../README.md`, `../CHANGELOG.md`, absolute GitHub URL to `.trellis/spec/frontend/index.md` | No |
| `docs/TEST_PLAN.md:14` | `WEBVIEW_PREVIEW.md` | No |
| `docs/ECUC_EDITOR.md` | **none** | — |
| `docs/DIFF.md` | **none** | — |
| `docs/ENGINE.md` | **none** | — |
| `docs/MERGE.md` | **none** | — |
| `docs/WEBVIEW_PREVIEW.md` | **none** (it names paths in code/prose, not Markdown links) | — |

No docs page links to an in-page anchor. The only cross-guide link among the feature guides is `TEST_PLAN → WEBVIEW_PREVIEW`.

### 2.2 Inbound links to `docs/` pages

| Target | Referenced by |
|---|---|
| `docs/README.md` | `README.md:26` |
| `docs/ECUC_EDITOR.md` | `README.md:27`, `docs/README.md:9` |
| `docs/DIFF.md` | `README.md:28`, `docs/README.md:10` |
| `docs/MERGE.md` | `docs/README.md:12` **only** |
| `docs/ENGINE.md` | **none** (orphan) |
| `docs/TEST_PLAN.md` | `docs/README.md:14`; test-file header comments: `src/test/core/planConditions.test.ts:2`, `planDiff.test.ts:2`, `planIdentity.test.ts:2`, `planRows.test.ts:2`, `planRowsExtra.test.ts:2`, `planScan.test.ts:2`, `src/test/extension/planEnginePackaging.test.ts:2` |
| `docs/WEBVIEW_PREVIEW.md` | `README.md:44`, `AGENTS.md:32`, `docs/README.md:13`, `docs/TEST_PLAN.md:14`, `.trellis/spec/frontend/testing.md:88` |
| `DESIGN.md` | `AGENTS.md:26`, `docs/README.md:11` |

Root `README.md`, `CHANGELOG.md`, `LICENSE` and `examples/README.md` are linked from `docs/README.md`; all exist. `.vscodeignore:20-22` excludes `DESIGN.md`, `examples/**` and `docs/**` from the VSIX (see §6, open question 1).

## 3. Link issues and stale paths

### 3.1 Broken links

- **No broken relative Markdown links** in `docs/`, root docs, specs or skill docs. All relative file links resolve, and no in-repo anchor links are used.
- `docs/README.md:21` uses an **absolute** GitHub URL (`https://github.com/.../blob/main/.trellis/spec/frontend/index.md`) instead of a relative link. It is not broken today, but it bypasses the relative-link checker and assumes the default branch is `main`.
- `README.md:43-44` says: "run `npm run shots:webview` and inspect **`npm run shots:webview`** under `.agents/skills/webview-preview/artifacts/` before review." The second command should be "the PNGs/audits" — a copied-command typo, not a path link.
- `.fallowrc.json:12` still lists `src/test/preview/preview*.ts`; that directory no longer exists (stale config, not documentation). Remove the entry, or update both the entry and the `.agents/**` ignore pattern if fallow should scan the skill.
- `.trellis/spec/frontend/hook-guidelines.md:14`, `state-management.md:57`, `component-guidelines.md:229,341`, and `quality-guidelines.md:201` still name deleted `render/rowSearch.ts` / `RowSearchEngine`.
- `component-guidelines.md:268` says the preview harness and `scripts/` directory "have been removed"; both are false: the harness lives in `.agents/skills/webview-preview/`, and `scripts/` still contains build/parity runners.
- `css-guidelines.md:219-220` still says the preview runs `scripts/previewWebview.mjs` and writes `dist/preview/`; the live paths are `.agents/skills/webview-preview/scripts/previewWebview.mjs` and the skill `.cache/`.
- `testing.md:87` says captures go to `artifacts/webview/<state>.png`; the canonical path is `.agents/skills/webview-preview/artifacts/<state>.png` (`docs/WEBVIEW_PREVIEW.md:39`, `SKILL.md:46`).
- `quality-guidelines.md:232-233` says `vsce ls` should list user `docs/`/`examples/`; `.vscodeignore:20-22` excludes both. Either the spec or the package policy is stale.
- `docs/TEST_PLAN.md:269` cites task `11-14-arxml-config-merge`, which does not exist under `.trellis/tasks/` or the archive.

**Verified live (do not remove):** `package.json:330-338` defines `preview:webview`, `shots:webview`, `parity`, `parity:rows`, `parity:diff`, `parity:copy`, `parity:words`; the referenced `scripts/parity*.mjs` files and `.agents/skills/webview-preview/scripts/*.mjs` exist. The `npm run` references in `docs/WEBVIEW_PREVIEW.md:20-31`, `docs/TEST_PLAN.md:14,17`, `rust/README.md:22-26`, `README.md:43` and `AGENTS.md:30` are current; the stale part of `README.md:43-44` is the duplicated command wording, not the command itself.

### 3.2 Stale content vs. the built-in diff gutter / Monaco

| Location | Stale claim | Why it is stale |
|---|---|---|
| `docs/DIFF.md:6-9` vs `:43-62` | The renderer note says "the diff gutter come[s] from Monaco", but `:43` still describes a fixed file-name strip and `:53-62` describes a custom line-number gutter with redrawn 3px rails. | The page mixes the old custom DOM diff with the Monaco diff editor; the gutter/rail ownership is contradictory. |
| `docs/ECUC_EDITOR.md:9-14` vs `:32-116` | The note says the Document is now Monaco and the sections below describe the retired DOM renderer "kept as the ECUC interaction reference"; the old sections are still presented as current instructions (fixed gutter, `Space`, type-ahead, custom virtual scroll). | Readers cannot tell which interactions still work in Monaco. |
| `docs/ECUC_EDITOR.md:206-216` vs `:347` | Editing rules say values/short names are typed directly and saved with `Ctrl+S`; Limitations says "The Document is read-only by design" and edits are limited to values/container fields. | The Document is no longer read-only; the limitation sentence is a pre-Monaco leftover. |
| `.trellis/spec/frontend/component-guidelines.md:286,292` | Anti-patterns say re-adding line numbers or making `.value` editable fails; "Document is read-only". | Contradicts the Monaco editor and direct typing added in `08a96fa`. |
| `.trellis/spec/frontend/component-diff-view.md:7-63` | Describes the diff as two `DocumentTreeView` panes with a shared `VirtualScroll` and per-pane custom gutters. | Review against `diffMonaco.ts`; at minimum the page needs a "pre-Monaco legacy surface" note or a rewrite. |
| `docs/TEST_PLAN.md:240` | "Read-only: no merge, no apply, no repair, no generated file." | `MERGE.md`, `DESIGN.md:272-279`, `editor-lifecycle.md:3-8` and CHANGELOG `0.10.0` all document the merge copy path. |

### 3.3 Stale content vs. the webview-preview skill

| Location | Stale claim | Correct live source |
|---|---|---|
| `component-guidelines.md:266-277` | Harness removed; observe only in Extension Development Host. | `.agents/skills/webview-preview/SKILL.md`; `npm run preview:webview` / `shots:webview` exist in `package.json:330-331`. |
| `css-guidelines.md:219-220` | Preview bundle under `dist/preview/` from `scripts/previewWebview.mjs`. | Skill `.cache/`; `previewWebview.mjs` moved in `05d9e7c`. |
| `testing.md:82-94` | Commands and artifact path; `artifacts/webview/...`. | Skill `SKILL.md:14-48` and `docs/WEBVIEW_PREVIEW.md:39-40`. |
| `state-management.md:154-161` | "the preview harness ... were removed". | Harness was reintroduced as the skill; only the old in-repo copy is gone. |

### 3.4 Stale content vs. the Rust engine

| Location | Stale/ambiguous claim | Evidence |
|---|---|---|
| `docs/TEST_PLAN.md:258` (`ENG-01`) | Engine restart/backoff "not implemented yet". | `CHANGELOG.md:12` (Unreleased) and `editor-lifecycle.md:36-51` document supervisor restart/backoff; `docs/ENGINE.md:19-22` also describes it. |
| `docs/TEST_PLAN.md:343` (known gap 1) | "Engine restart/backoff and `cancel` (ENG-01) are not implemented". | Restart/backoff is implemented; only `cancel` remains a real gap. Split the sentence. |
| `docs/TEST_PLAN.md:112,116` (`EDIT-05`, `EDIT-09`) | "TypeScript fallback" for edits. | `docs/ENGINE.md:12` and `type-safety.md:121-141` say no runtime core fallback. The host does keep a TypeScript-panel path when an engine handle cannot be opened (`ecucEditorProvider.ts:1302-1318`, `docs/ECUC_EDITOR.md:242-244`), so the wording needs a precise distinction: no core fallback vs. panel-session fallback. |
| `docs/TEST_PLAN.md:267-288` | Merge section says "Planned". | Merge shipped in `0.10.0`; `docs/MERGE.md` is a current guide. |
| `docs/ENGINE.md:49` | "The first row store is still built in TypeScript; row windows are planned." | `ecucEditorProvider.ts:285` still calls `buildRows`; the first part is current. The "row windows are planned" half is not documented anywhere else — verify before keeping or remove it. |

## 4. Duplication map and canonical homes

| Duplicated topic | Copies | Best canonical home | Recommended action |
|---|---|---|---|
| Preview commands/flags | `docs/WEBVIEW_PREVIEW.md:16-44`; `.agents/skills/webview-preview/SKILL.md:14-42`; `README.md:43-44`; `AGENTS.md:30-32`; `testing.md:82-94` | `.agents/skills/webview-preview/SKILL.md` + `package.json:330-331` | Keep one short command block in the skill; docs/README/AGENTS/spec link to it. Do not restate flags in four places. |
| Preview state table | `docs/WEBVIEW_PREVIEW.md:56-95` (33 rows) and `previewData.ts:25-66` (`STATES`) | `previewData.ts` (`STATES`) | Keep the human table in `docs/contributor/WEBVIEW_PREVIEW.md` as a checked projection, or replace it with `--list`. Currently 33/33 names match; add a sync test if kept. |
| Preview audit rules | `docs/WEBVIEW_PREVIEW.md:97-198`; `previewAudit.ts` (e.g. `:534`, `:1858`, `:1896`, `:1932`); `testing.md:82-94` | `previewAudit.ts` for implementation; docs page for the human checklist | Keep the rationale/checklist in the contributor page; `testing.md` should link, not summarize. |
| Test layers/gates | `docs/TEST_PLAN.md:8-37`; `testing.md:58-80`; `README.md:37-47`; `quality-guidelines.md:229-233` | `docs/TEST_PLAN.md` for gates/IDs; `testing.md` for conventions; README for quick start | Remove the gate table from specs/README; link to TEST_PLAN. Keep README's 3-command quick start only. |
| Merge vs. read-only diff | `docs/DIFF.md:240`; `docs/MERGE.md`; `DESIGN.md:272-279`; `editor-lifecycle.md:3-8`; `TEST_PLAN.md:267-288` | `docs/user/DIFF.md` + `docs/user/MERGE.md` for behavior; `editor-lifecycle.md` for protocol | Update DIFF's limitations and TEST_PLAN's "Planned" framing; cross-link DIFF ↔ MERGE. |
| Diff change classes / semantic scoring | `docs/DIFF.md:85-156`; `component-guidelines.md:303-369` (diff surface invariants) | `docs/user/DIFF.md` for user-visible classes; source `core/diff` plus a spec page for scores/budgets | Split scoring/benchmarks into `frontend/diff-matching.md`; keep user-facing change classes in DIFF. |
| Engine protocol/lifecycle | `docs/ENGINE.md:3-49`; `rust/README.md:34-104`; `type-safety.md:121-141`; `editor-lifecycle.md:26-58`; `TEST_PLAN.md:251-265` | `rust/README.md` for the protocol table/numbers; `editor-lifecycle.md` for host session contract; `docs/ENGINE.md` for a short operator summary | Keep `ENGINE.md` short, link to `rust/README.md`; specs link instead of repeating chunk/cap/platform numbers. |
| Editor/DOM interaction rules | `docs/ECUC_EDITOR.md:32-116`; `component-guidelines.md:8-231`; `component-document-tree.md` | `docs/user/ECUC_EDITOR.md` for current Monaco behavior; spec for implementation | Move the retired DOM interaction reference to a clearly labeled contributor appendix; delete pre-Monaco "read-only" claims. |
| Design tokens | `DESIGN.md:4-151,165-207`; `css-guidelines.md:37-72,232-243`; `src/webview/styles/tokens.css` | `DESIGN.md` for the token catalog/meaning; `css-guidelines.md` for coding rules/exception log; `tokens.css` for values | Keep one token table; have css-guidelines link to DESIGN instead of restating every hex/exception. |
| Preview/parity command inventories | `rust/README.md:14-27`; `docs/TEST_PLAN.md:16-18`; `testing.md:58-80` | `rust/README.md` for parity command semantics; `TEST_PLAN.md` for when each gate runs | Add a contributor parity note only if humans need the oracle/hash model; otherwise link. |
| Cross-layer guide content | `cross-layer-thinking-guide.md:126-219` and `:223-287` are near-verbatim duplicates (the second omits only the Versioned Documentation Boundary section) | `cross-layer-thinking-guide.md` single copy | Delete the second block; no content is lost. |

## 5. Encoding

**No on-disk mojibake or invalid UTF-8 was found.**

- All 7 `docs/` pages, the 3 root documents, all 25 `.trellis/spec/**` pages, and the referenced `.agents/skills/webview-preview/**` files decode as valid UTF-8; LF-only; no BOM; no U+FFFD; no `â€”`/`â†’`/`Ã` byte sequences.
- Apparent mojibake in terminal output is a **console decoding artifact**, not file damage:
  - `docs/ECUC_EDITOR.md:9` contains U+2014 em dash (`E2 80 94`), not `â€”`.
  - `README.md:28` contains U+2014 em dash.
  - `.trellis/tasks/11-24-webview-preview-skill/implement.md:39` contains U+2192 arrow (`E2 86 92`), not `â†’`.
- If the parent saw `�` in a tool result, it came from a cp1252 stdout wrapper (e.g. the first `ctx_execute` read), not from the tracked file. Do not "repair" these characters.

## 6. Proposed target tree and dispositions

### 6.1 Target tree

```text
docs/
├── README.md                         # audience-split index
├── user/
│   ├── ECUC_EDITOR.md                # current Monaco user guide
│   ├── DIFF.md                       # compare + change classes + navigation
│   └── MERGE.md                      # two-way copy merge
└── contributor/
    ├── ENGINE.md                     # operator/architecture summary; links rust/README
    ├── TEST_PLAN.md                  # regression gates and IDs
    ├── WEBVIEW_PREVIEW.md            # human preview guide + checklist
    └── legacy-dom-renderer.md        # moved retired interaction reference

.trellis/spec/
├── frontend/
│   ├── index.md                      # + related-docs links + Monaco page row
│   ├── monaco.md                     # NEW: synthetic document, find bridge, diff editor, gutter ownership
│   ├── diff-matching.md              # NEW (if algorithm detail leaves docs/DIFF)
│   ├── directory-structure.md        # update: add src/webview/monaco, remove rowSearch
│   ├── component-guidelines.md       # remove stale preview/read-only/gutter sections
│   ├── css-guidelines.md             # fix preview paths; link DESIGN
│   ├── testing.md                    # link preview docs; fix artifacts path
│   ├── state-management.md           # fix preview/rowSearch stale lines
│   ├── hook-guidelines.md            # fix rowSearch path
│   ├── quality-guidelines.md         # fix docs-in-VSIX claim
│   ├── editor-lifecycle.md           # keep as session/protocol contract; link rust/README
│   ├── type-safety.md                # keep engine boundary; link instead of duplicate
│   └── components/ …                 # keep; audit old DOM claims against Monaco
└── guides/
    ├── index.md                      # + documentation-architecture-guide.md row
    ├── documentation-architecture-guide.md  # NEW: audience/canonical-home rules
    ├── code-reuse-thinking-guide.md
    └── cross-layer-thinking-guide.md # dedupe :223-287
```

`DESIGN.md`, `README.md` and `AGENTS.md` stay at the repository root: `DESIGN.md` is the `design:lint` target (`package.json:329`), `README.md` is the marketplace/GitHub quick start, and `AGENTS.md` is the platform-managed agent block. `DESIGN.md` should be linked from the contributor index rather than duplicated in `docs/`.

### 6.2 Disposition for every `docs/` file

| Current | Disposition | Target | Notes |
|---|---|---|---|
| `docs/README.md` | **Keep + rewrite** | `docs/README.md` | Split into "Using ARXML Scope" and "Developing/contributing"; remove the claim that all pages are user-facing (`:3-5`); add `ENGINE`; put contributor pages below the user guides. |
| `docs/ECUC_EDITOR.md` | **Split + keep** | `docs/user/ECUC_EDITOR.md` + `docs/contributor/legacy-dom-renderer.md` | Keep the current Monaco user workflow (opening, Details, editing, Conditions, reveal, settings, limitations). Move the explicitly retired DOM sections (`:32-116`) to the appendix; delete the contradictory "read-only by design" line (`:347`) after replacing it with the real editable-field rule. No content lost. |
| `docs/DIFF.md` | **Split + keep** | `docs/user/DIFF.md` + `.trellis/spec/frontend/diff-matching.md` | Keep file selection, change classes, word changes, context, navigation, refresh, limitations. Move scoring thresholds/budgets/benchmarks (`:110-156`) to the spec page. Rewrite `:43-62` in Monaco terms and replace the "read-only/no merge" limitation (`:240`) with a merge link. |
| `docs/MERGE.md` | **Keep** | `docs/user/MERGE.md` | Pure user guide; add a back-link to `DIFF.md`. No deletion recommended. |
| `docs/ENGINE.md` | **Move** | `docs/contributor/ENGINE.md` | Contributor/operator page; add to the contributor index and link `rust/README.md` as the protocol source. |
| `docs/TEST_PLAN.md` | **Move** | `docs/contributor/TEST_PLAN.md` | Update the 7 test-file header comments to the new path; refresh merge/restart/fallback rows and the removed task ID. |
| `docs/WEBVIEW_PREVIEW.md` | **Move + trim** | `docs/contributor/WEBVIEW_PREVIEW.md` | Keep the human overview, state table and checklist. Replace duplicated command/flag lists with a link to `SKILL.md`; keep the state table as a checked projection of `STATES`; update links in README, AGENTS, TEST_PLAN and `testing.md`. |
| `DESIGN.md` | **Keep** | `DESIGN.md` | Tooling and `AGENTS.md` depend on the root path; classify as contributor/design contract, not a user guide. |
| `README.md` | **Keep + fix** | `README.md` | Keep quick start. Fix `:43-44`; add `MERGE` to the documentation list; move contributor-only preview detail behind a link. |
| `AGENTS.md` | **Keep** | `AGENTS.md` | Agent-only Trellis block. Only update the `docs/WEBVIEW_PREVIEW.md` path if it moves. |

**No whole-file deletion is recommended.** Every docs file is either user content to preserve or contributor content with a replacement home. The only deletions are passage-level: the duplicate cross-layer block, the stale read-only/planned claims, and the retired-renderer text after it is moved to the appendix.

### 6.3 Spec index additions / links

- `.trellis/spec/frontend/index.md`: all 10 top-level pages and the component sub-index are already linked, so it has **no orphan pages**. Add:
  - a `Monaco` row for the new `frontend/monaco.md`;
  - a `Related docs` section linking `../../../docs/README.md`, `../../../DESIGN.md`, `../../../docs/contributor/WEBVIEW_PREVIEW.md`, and `../../../rust/README.md` (protocol);
  - update the "plain HTML/CSS/JS" intro (`:4`) to mention the bundled Monaco editor.
- `.trellis/spec/frontend/components/index.md`: complete for the current component folders; no missing link.
- `.trellis/spec/guides/index.md`: both existing guides are linked. Add a row for the proposed `documentation-architecture-guide.md`; if that page is not created, add a "Documentation boundary" trigger that links to the cross-layer guide's `Versioned Documentation Boundary` section (`cross-layer-thinking-guide.md:162`).
- Priority additions: `frontend/monaco.md` (largest uncovered area), then `guides/documentation-architecture-guide.md` (prevents the audience/canonical-home drift this audit found), then `frontend/diff-matching.md` only if the DIFF algorithm detail is split out.

## 7. Open questions

1. **Are `docs/` meant to ship to users?** `.vscodeignore:20-22` excludes `docs/**`, `DESIGN.md` and `examples/**`, yet `quality-guidelines.md:232-233` says the VSIX should list them. If user-facing guides are intended for the extension package, either include a curated docs subset or make README/online docs the official channel and fix the spec.
2. **Is `docs/ENGINE.md` for end users or contributors?** It is the only engine troubleshooting page but reads as architecture. If users need it for activation failures, keep a short user section and link the deep protocol table; otherwise move it fully to contributor.
3. **Should `TEST_PLAN.md` stay under `docs/` or move under `.trellis/spec/frontend/`?** Test comments and contributors cite `docs/TEST_PLAN.md`; moving it requires updating 7 source comments. The target tree above keeps it contributor-facing under `docs/`, which preserves those references.
4. **Should the preview state table live in the skill or docs?** The code `STATES` is the only executable source; the human table has descriptive value. Choose either a checked projection in `docs/contributor/WEBVIEW_PREVIEW.md` or replace it with `npm run shots:webview -- --list`.
5. **Should retired DOM-renderer details be preserved?** `docs/ECUC_EDITOR.md:9-14` says they are kept as an interaction reference. If no owner needs that history, the appendix could be dropped; the safe recommendation here is to preserve and label it.
6. **Should `DESIGN.md` move under `docs/contributor/`?** Not recommended while `design:lint` and `AGENTS.md` use the root path. If it moves, update both tooling and links in the same change.
7. **Should the absolute GitHub spec link in `docs/README.md:21` become relative?** Yes for repo browsing and link checking; confirm the default branch if it stays absolute.
8. **Is there a requirement for a parity/oracle narrative?** The commands are documented in `rust/README.md` and gates in `TEST_PLAN.md`; the SHA-256 fixture manifest (`scripts/parity.mjs:13-23`) and `src/test/parity/oracle*.ts` adapters are only documented in script comments. Add `docs/contributor/PARITY.md` only if humans need that explanation.
9. **What is the intended audience split for `docs/ECUC_EDITOR.md` and `docs/DIFF.md`?** They currently contain both end-user steps and implementation detail. The target tree assumes user behavior stays in `docs/user/` and algorithm/spec detail moves to `.trellis/spec/frontend/`.
