# Webview preview and screenshots

A development-only harness that serves the **production** webview shell and the real
bundled pages, seeds each page through the host protocol, and captures every state with
a local headless Chrome or Edge. Every capture also writes a rendered-geometry audit:
the page measures its own panes, toolbar, built-in diff gutter/sash, folding and native
diff paint after the gestures, and the runner fails when an action escapes its pane,
overlaps a neighbour or a gutter item renders the wrong copy action. The audit exists
because a screenshot can look plausible while the geometry is wrong — a toolbar control
can sit under the Search field, a one-sided hunk can show a dead direction —
and the jsdom suites cannot see layout at all.

The harness wraps the production shell (`webviewShell.ts`) and mounts the production
entries (`diffMonaco.ts`, `editorMonaco.ts`). There is no second renderer, no forked
markup and no extra dependency.

## Commands and workflow

The executable workflow, command flags, outputs and cleanup rules are owned by the
[`webview-preview` skill](../../.agents/skills/webview-preview/SKILL.md). In short, run
`node .agents/skills/webview-preview/scripts/shotWebview.mjs` to capture the full seeded
set, add `--state <name>` for one state and `--list` for the names. There is no
`package.json` alias; the runner lives only in the skill.

The capture exits non-zero and prints every violation when the audit fails. Read the
`<state>.audit.json` for the measured boxes, scroll offsets and the full violation list;
the PNG is the visual check, the JSON is the proof of placement. Captures and audits are
written under `.agents/skills/webview-preview/artifacts/`, which is gitignored; they are
evidence for the change under review, not committed fixtures.

The first capture starts a private preview server on a free port. Stop a manually
started `previewWebview.mjs` before relying on a fixed port; a stale server keeps serving
its old bundle.

## States

`STATES` in `.agents/skills/webview-preview/preview/previewData.ts` is the executable
source of this table; `--list` prints the current names. The table is the human-readable
projection for choosing a state.

| State | Page | Size | What it exercises |
|---|---|---|---|
| `diff-off` | diff | 1400×900 | baseline diff; the built-in gutter and sash are mounted, copy actions are hidden outside Merge without collapsing their layout, and the sash drag/reset runs |
| `diff-merge` | diff | 1400×900 | Merge pressed; the built-in hunk toolbar offers Copy Block to Left/Right and its arrows start centered on the hunk |
| `diff-swap` | diff | 1400×900 | Swap pressed; headers and values mirror, the copy direction/host side follow the displayed panes, and the sash ratio survives |
| `diff-rail` | diff | 1400×900 | long document; Next diff jumps to the change near line 1000 and scrolls |
| `diff-nav` | diff | 1400×900 | Next/Prev visit every change in order and wrap; the probe repeats the sequence after Swap |
| `diff-collapsed` | diff | 1400×900 | the `Items` container is folded from each side in turn; both panes keep the node header, `⋯` hint and a glyph-margin difference dot, and hide child rows |
| `diff-collapsed-onesided` | diff | 1400×900 | a shared `Items` container with a left-only child is folded; no visible diagonal fill remains while folded, and the native fill returns after expansion |
| `diff-sticky` | diff | 1400×900 | deep scroll into `Items`; both diff panes pin the full module/container header through sticky scroll |
| `diff-one-sided` | diff | 1400×900 | per-side models with changed pairs; native fills and diagonal gaps, no placeholder layers |
| `diff-removed` | diff | 1400×900 | a left-only module deletion; both copy directions are offered, including the empty-side delete |
| `diff-added` | diff | 1400×900 | a right-only module insertion; both copy directions are offered, including the empty-side delete |
| `diff-sash` | diff | 1400×900 | built-in sash drag, document replacement and Swap preserve the ratio; double-click resets to 50/50 |
| `diff-wide` | diff | 1400×900 | long parameter names; the panes overflow horizontally |
| `diff-wide-panned` | diff | 1400×900 | the same rows panned 600px; native scrolling stays inside the panes |
| `editor` | editor | 1400×900 | editor toolbar, gutter and selected Details row |
| `editor-syntax` | editor | 1400×900 | decimal, binary, text, reference and system-condition values; binary matches the numeric colour, references use the reference colour, and condition names/operators/numbers stay distinct |
| `editor-syscond` | editor | 1400×900 | the `Condition` row selected; the Monaco editor condition line and Details Condition code share the macro-blue name, magenta operator, cyan literal and number, and the Conditions panel uses the same name/state colours |
| `editor-labels` | editor | 1400×900 | a module, a normal container, a parameter and a container with no `DEFINITION-REF`; the no-label line starts with its quoted short name in the string colour, and the normal container keeps the label in the type colour and the short name in the string colour |
| `editor-dirty` | editor | 1400×900 | a typed parameter shows the `● Unsaved changes` toolbar marker and posts no host edit before `Ctrl+S` |
| `editor-invalid` | editor | 1400×900 | invalid direct input shows the red marker/error and a `Ctrl+S` attempt is blocked |
| `editor-details` | editor | 1400×900 | typing in the Details value stays local; focus/caret kept, the line repainted, no host edit |
| `editor-details-save` | editor | 1400×900 | `Ctrl+S` sends one raw edit, waits for its ack, saves, then the host echo rebuild keeps Details focus/caret |
| `editor-details-rename` | editor | 1400×900 | a rename is acknowledged before the re-scan; the next save defers and the post-flush keystroke is submitted at the new id |
| `editor-rename-refusal` | editor | 1400×900 | the re-scan lands first, then the host refuses the remapped rename; the refusal is shown inline at the new id and no save follows |
| `editor-rename-late-ack` | editor | 1400×900 | the re-scan lands before the rename acknowledgement; the page keeps the post-flush draft and caret, submits it at the host id and saves |
| `editor-multi-save` | editor | 1400×900 | two fields are edited locally, one `Ctrl+S` posts two edits then one save after both acks, and both new values stay visible |
| `editor-paste` | editor | 1400×900 | a paste containing a newline becomes one escaped line (`\n`), keeps one quote pair and posts no host edit |
| `editor-stale-save` | editor | 1400×900 | a draft whose row disappears from the re-scan blocks `Ctrl+S`, posts no save and explains that the node is gone |
| `editor-details-undo` | editor | 1400×900 | a local undo after a Details edit restores the host value, caret and clean toolbar |
| `editor-details-redo` | editor | 1400×900 | redo after that undo restores the draft, caret and dirty marker without a host edit |
| `editor-delete` | editor | 1400×900 | type, backspace, word-delete, select-and-replace, clear and retype stay local and end at `Text = "R"` |
| `editor-sticky` | editor | 1400×900 | deep scroll into the `Items` container; its header stays pinned by Monaco sticky scroll |
| `editor-find` | editor | 1400×900 | native find widget open on `Items`, with the Rust result count and field highlight |
| `diff-find` | diff | 1400×900 | native find widget in the modified pane, with the Rust diff match count |
| `toolbar-1400` | diff | 1400×900 | full labels; Merge active; Swap follows Merge on the left |
| `toolbar-1200` | diff | 1200×900 | secondary labels hidden; Context/Semantic/Strict/Merge labels remain |
| `toolbar-1024` | diff | 1024×900 | icon-only 40px tools; the left group stays left |
| `toolbar-900` | diff | 900×900 | 36px tools; dividers hidden |
| `toolbar-800` | diff | 800×900 | 32px tools; the left group stays left |
| `toolbar-640` | diff | 640×900 | 28px tools; native find widget hidden until `Ctrl+F` |

The diff states use a synthetic module with ten changed values; the long states use a
zero-padded parameter list so the first change is near line 1000. To add a state, extend
`STATES` and the fixture payload, run the capture, then update this table; the skill
owns the step-by-step procedure.

## Audit invariants

The visual invariants — toolbar placement, translucent fills, per-side body, folding,
value/condition colours, dirty/invalid/rename/draft behaviour, gutter availability, sash
and swap — are agent contracts in
[`preview-audit.md`](../../.trellis/spec/frontend/preview-audit.md). Read that page before
changing the preview audit or interpreting a new violation; this page deliberately does
not restate them.

## Limits

The harness proves geometry and paint in Chromium at the listed sizes. All preview
source lives in `.agents/skills/webview-preview/`; do not reintroduce a copy under
`src/test` or `scripts/`. The audit is a set of placement invariants, not a taste
judgement: still inspect the PNG for colour, spacing and clipping the invariants do not
encode. The diff body is Monaco's; the audit reads its per-side models, native diagonal
fill, fills and gutter rather than a rebuilt DOM. The checked-in Monaco patch only scopes
the gutter menu context; a fresh `npm install`/`npm ci` must run `patch-package` (the
`postinstall` script) or the gutter audit fails. Folding is an intentional deviation from
stock VS Code diff behavior: both inner editors re-enable `folding` and the ARXML
Collapse/Expand actions drive them.

The preview does not prove VS Code theme fidelity (tokens are seeded), real
keyboard/IME input, screen-reader output or performance; those still need the Extension
Development Host, and a host observation belongs in the task notes as a manual check. The
condition palette is fixed per VS Code theme class, so the screenshot proves the dark
palette; the light and high-contrast values are asserted by the stylesheet tests, not by
the preview. It does prove focus and caret in the Details panel across a local repaint and
a host echo, and it invokes the registered Undo/Redo actions after a Details edit; the
Ctrl+Z/Ctrl+Shift+Z keybindings themselves cannot be driven from the harness, so that
route still needs the Extension Development Host. The paste probe dispatches a
clipboard-shaped event to the editor's capture guard; it does not exercise the OS
clipboard or Monaco's own paste handler. The overview ruler marks the change region; the
missing side relies on Monaco's diagonal view zone, which is not a model line and carries
no added or removed tint.
