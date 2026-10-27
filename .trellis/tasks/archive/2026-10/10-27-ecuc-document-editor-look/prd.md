# ECUC document view editor-like visual pass

## Goal

The Document view currently reproduces the ARTEXT structure but still **feels like a web tree**
wrapped in a monospace font: a heavy toolbar, a hidden twisty column that shifts every line, a bright
full-row selection bar, dotted underlines under every editable value, a pencil affordance on hover,
purple variants/conditions, and bright blue underlined reference targets. The raw `.artext` text
feels calmer because it is a text surface: one baseline, one gutter, restrained colour, and no
per-row web chrome.

Make the Document view feel like an editor document, not a tree widget. This is a **look and feel**
pass: the information, interactions, view toggle, details panel, editing and tests stay intact.
Tree view keeps its current appearance.

## Reference

- The raw post-processed `.artext` in
  `.trellis/tasks/archive/2026-10/10-27-ecuc-viewer-document-redesign/research/reference-artext/`.
- The throwaway prototype in `research/prototype-editor.css` and `research/prototype-dark.png`
  (production page with a nonce-bearing override style). It is evidence for the direction, not a
  shipped file.

## Scope

**In**

- A calm, editor-like Document surface: editor font size (14px fallback), 1.5 line height, a compact
  left gutter, exact 4ch indentation, braces aligned with the parent row.
- A restrained semantic palette: neutral labels, keyword `schema`/`package`/`module`, string short
  names and textual values, numeric/hex values, boolean values, muted comments/annotations. No
  per-kind label rainbow, no purple variants/conditions, no blue underlined reference targets.
- The hidden twisty moves out of the text flow into the gutter, so the text is not shifted by a
  twisty track at every level.
- Removes the dotted underline and hover pencil from Document values; editing stays available by
  click/F2 and the tooltip.
- A slim document bar: shorter toolbar, compact filter, flat buttons; no change to the actions.
- A subtle editor line highlight for selection/focus instead of the full-row list selection bar;
  a visible focus edge for keyboard accessibility.
- Visual verification in light/dark/HC; content/interaction parity; tests and docs.
- Tree view stays visually unchanged.

**Out**

- Changes to parsing, ordering, validation, the write path, `src/core/**`.
- A new renderer, a second model, `.artext` parsing, the legacy `mmx` binary, or a new asset/font.
- Removing Tree view, the details panel, the filter or any interaction.
- A real VS Code webview claim; the browser harness is page-side evidence only.
- Line numbers in this pass: the braces are decorative pseudo-elements and numbering only the entity
  rows would misrepresent the document. The gutter is the twisty/fold gutter. (If real line numbers
  are wanted, that is a separate structural task with real brace rows.)

## Requirements

- **R1 — Editor surface.** Document rows use the editor font at `--vscode-editor-font-size` with a
  14px fallback, `line-height: 1.5`, one baseline, no per-row vertical padding, no per-row cards,
  borders or backgrounds in the normal state. The document starts at a compact gutter.
- **R2 — Restrained palette.** Structural labels (module path, container, parameter, reference) use
  the editor foreground. Only `schema`/`package`/`module` keywords, string short names and textual
  values, numeric/hex values, booleans and annotations carry accent. Variants and conditions are
  muted; reference targets are foreground with **no underline** (underline/link colour on hover
  only). Every colour remains a `--vscode-*` variable with a fallback.
- **R3 — Gutter and indentation.** The twisty/spacer is positioned in the left gutter without
  occupying the text flow. Labels align at exact 4ch increments; braces align with the parent row's
  text start; the module prefix remains. No twisty-induced 1.2ch shift.
- **R4 — Slim document bar.** In Document view the toolbar is a compact editor-like bar: shorter
  padding, compact filter, flat text buttons, no heavy button backgrounds. All existing actions
  (filter, count, expand/collapse, View, Details) remain and Tree view keeps the current bar.
- **R5 — Selection and focus.** Selected/focused document rows use a subtle editor line highlight,
  not a full-row bright blue selection bar. Keyboard focus remains visible with a 1–2px focus edge
  and readable text in light/dark/HC.
- **R6 — Value affordance.** Document values lose the dotted underline and hover pencil. They stay
  editable by click/F2; the tooltip and cursor still advertise it. The inline editor keeps the
  direct `.value` contract and its first-listener event ownership.
- **R7 — Content and interactions unchanged.** Every parent §6 field remains; select/collapse/reveal/
  follow/filter/edit/copy/keyboard work in both views. Tree view's appearance and the details panel
  are unchanged.
- **R8 — Accessibility and contrast.** Real tree roles/levels/selection/expansion remain; focus and
  selected lines are readable in light/dark/HC; no colour literal outside a `var(...)` fallback.
- **R9 — Tests, docs and captures.** Existing tests stay green; new tests assert the neutral labels,
  no target underline, gutter/indent, slim bar, subtle selection and the no-dotted-value rule, and
  fail when the feature is removed. Update `docs/ECUC_EDITOR.md` and the frontend specs; capture
  Document and Tree in light/dark/HC.
- **R10 — Dev-only and safe.** No new dependency/asset, no manifest takeover, `src/core/**` untouched,
  no new write path; performance is unchanged (CSS/markup only, no second render pass).

## Acceptance Criteria

- [x] **AC1** Document structural labels compute to the editor foreground; keywords, string,
  numeric/hex, boolean and annotation accents remain. Variants/conditions are muted, and reference
  targets have `text-decoration: none` with a hover underline only. Light/dark/HC captures show it.
- [x] **AC2** Document rows have no normal-state border/background/vertical padding; font size uses
  `--vscode-editor-font-size` with a 14px fallback; line-height is 1.5; the surface starts at the
  gutter. A test asserts the CSS; captures show the baseline.
- [x] **AC3** The twisty/spacer is absolutely positioned in the gutter; labels align at 4ch
  increments and braces align with the parent text. A layout observation/capture confirms the
  alignment; the `children::before` negative margin matches the gutter.
- [x] **AC4** The Document toolbar is compact (≤32px observed) with a compact filter and flat
  buttons; all actions still work; Tree view's bar is unchanged.
- [x] **AC5** Selected/focused rows use a subtle line highlight plus a visible focus edge, not the
  active-selection list bar; the text remains readable. A test asserts the document selection
  selectors; a capture shows selected and focused rows.
- [x] **AC6** Document values have no dotted underline or hover pencil; click/F2 editing, the tooltip
  and the direct `.value` contract still work; the editing suite stays green.
- [x] **AC7** All Document/Tree interactions and content remain; the full suite is green; no field
  is hidden.
- [x] **AC8** `npm run check-types`, `npm run lint`, `npm test` and `npm run preview:check` are green;
  the mutations in `implement.md` each fail a test.
- [x] **AC9** `docs/ECUC_EDITOR.md` and the frontend specs describe the editor-like Document surface,
  the restrained palette and the selection/gutter rules; `src/core/**`, dependencies and the
  manifest priority are untouched.
- [x] **AC10** Light/dark/HC Document captures and a Tree capture are stored in the task research;
  the harness observations are labelled as such, not as a VS Code webview.

## Constraints

- CSS/presentation over the existing tree DOM. Do not create a second renderer or parse `.artext`.
- Keep `.value` a direct child of `.row`; keep the value widget's first-listener contract.
- Do not hide metadata to make the document look clean; keep every parent §6 field inline.
- No colour literal outside a `var(--vscode-*, …)` fallback; no font/asset file.
- Tree view's current look and the details panel are out of scope for visual changes.
- The prototype CSS is evidence only; production selectors stay scoped under
  `body[data-view="document"]`.
